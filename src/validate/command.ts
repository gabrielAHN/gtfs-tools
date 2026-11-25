import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Args } from "../args.js";
import { buildDuckDbSessionSql } from "../duckdb/config.js";
import { defaultExtensionStartup, runDuckDb } from "../duckdb/runner.js";
import { extractZipEntry, findGtfsEntry, listZipEntries, validateFeed } from "../feed/zip.js";
import { safeTerminalText } from "../output/safe-text.js";
import { cleanupOnSignal, downloadFeed } from "../remote/download.js";
import type { RemoteFeedSource } from "../remote/download.js";
import { parseFeedSource, redactSource, sourceLabel } from "../remote/source.js";
import type { FeedSource } from "../remote/source.js";
import { downloadsDir } from "../session/metadata.js";
import { VALIDATED_FILES, buildReport, parseValidationOutput, renderCsv, renderTable } from "./report.js";
import type { ValidationResult } from "./report.js";
import { VALIDATE_USAGE } from "./usage.js";

// Exit codes: no ERROR notice, at least one ERROR notice, validation could not run.
export const EXIT_PASSED = 0;
export const EXIT_ERRORS = 1;
export const EXIT_FAILED = 2;

const FORMATS = ["table", "json", "csv"] as const;
type Format = (typeof FORMATS)[number];

class UsageError extends Error {}

type Options = { feed: string; format: Format; date: string };

const today = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const parseOptions = (args: Args): Options => {
  for (const flag of Object.keys(args.flags)) {
    if (flag !== "date" && flag !== "format") {
      throw new UsageError(`validate does not take --${flag}: it prints a report (--format table, json or csv).`);
    }
  }
  const format = args.flags.format ?? "table";
  if (typeof format !== "string" || !(FORMATS as readonly string[]).includes(format)) {
    throw new UsageError("Use --format table, --format json or --format csv.");
  }
  if (args.positionals.length !== 1) throw new UsageError(`Usage: ${VALIDATE_USAGE} [--date YYYY-MM-DD] [--format table|json|csv]`);
  const date = args.flags.date === undefined ? today() : args.flags.date;
  if (typeof date !== "string" || !isCalendarDate(date)) {
    throw new UsageError("Use --date YYYY-MM-DD with a real calendar date, such as --date 2026-06-01.");
  }
  return { feed: args.positionals[0], format: format as Format, date };
};

// YYYY-MM-DD naming a day that exists (no 2026-02-30, no month 13, no year 0).
const isCalendarDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

// What DuckDB says when the loaded gtfs extension predates gtfs_validate (1.0.x).
const MISSING_PRAGMA = /Pragma Function with name gtfs_validate does not exist/;

const tooOldExtension = (repository: string, cause: unknown) =>
  new Error(
    repository === "community"
      ? 'The loaded gtfs extension has no gtfs_validate: validation needs the gtfs extension 1.1.0 or later. Update it from the DuckDB community repository with duckdb -c "UPDATE EXTENSIONS (gtfs)". UPDATE EXTENSIONS and FORCE INSTALL are never run automatically.'
      : `The loaded gtfs extension has no gtfs_validate: validation needs the gtfs extension 1.1.0 or later. gtfs installs from ${repository} (GTFS_EXTENSION_REPOSITORY): install gtfs 1.1.0 or later from it. UPDATE EXTENSIONS and FORCE INSTALL are never run automatically.`,
    { cause },
  );

// PRAGMA gtfs_validate, then its notices, in one in-memory DuckDB with the gtfs extension loaded.
const runValidation = async (directory: string, date: string): Promise<ValidationResult> => {
  const { repository, args } = await defaultExtensionStartup();
  const sql = [
    buildDuckDbSessionSql(),
    `PRAGMA gtfs_validate(${sqlString(directory)}, ${sqlString(date)});`,
    "SELECT code, severity, filename, csv_row_number, notice::VARCHAR AS notice FROM gtfs_validation_notices ORDER BY code, filename NULLS FIRST, csv_row_number NULLS FIRST;",
  ].join("\n");
  let stdout: string;
  try {
    ({ stdout } = await runDuckDb(["-bail", "-json", ...args, ":memory:", "-c", sql], repository));
  } catch (error) {
    if (error instanceof Error && MISSING_PRAGMA.test(error.message)) throw tooOldExtension(repository, error);
    throw error;
  }
  return parseValidationOutput(stdout);
};

// Extracts the files the rules cover, found as `import` finds them, into `directory`. A missing file
// is left out: the validator reports missing files itself.
const extractFeed = async (zipPath: string, directory: string) => {
  const entries = await listZipEntries(zipPath);
  for (const file of VALIDATED_FILES) {
    const entry = findGtfsEntry(entries, file);
    if (entry) await extractZipEntry(zipPath, entry, path.join(directory, file));
  }
};

// Validates a zip from a new private temporary directory holding only the extracted files. The
// directory is always removed afterwards.
const validateZip = async (zipPath: string, date: string) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-validate-"));
  try {
    await extractFeed(zipPath, directory);
    return await runValidation(directory, date);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

// A directory of .txt files is validated as it is; a zip path gets import's checks.
const validateLocal = async (input: string, date: string) => {
  const resolved = path.resolve(input);
  if ((await stat(resolved).catch(() => undefined))?.isDirectory()) return runValidation(resolved, date);
  return validateZip(await validateFeed(input), date);
};

// Downloads exactly as import does (downloads/<random>.zip, checked to be a zip), then validates the
// zip. The download is removed once extracted, and on failure or Ctrl-C/SIGTERM.
const validateRemote = async (source: RemoteFeedSource, date: string) => {
  const cleanup = cleanupOnSignal();
  try {
    const download = await downloadFeed(source, downloadsDir, cleanup);
    try {
      return await validateZip(download.file, date);
    } finally {
      await rm(download.file, { force: true });
    }
  } finally {
    cleanup.dispose();
  }
};

const validationFailed = (label: string, message: string) => {
  console.error(`Validation failed: ${safeTerminalText(label)}`);
  console.error(safeTerminalText(message));
  return EXIT_FAILED;
};

// Runs `gtfs-tools validate` and returns its exit code.
export const commandValidate = async (args: Args): Promise<number> => {
  let options: Options;
  try {
    options = parseOptions(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    return EXIT_FAILED;
  }
  // As for import, a source is only ever shown parsed and validated, or as "<scheme>://…".
  let source: FeedSource;
  try {
    source = parseFeedSource(options.feed);
  } catch (error) {
    return validationFailed(sourceLabel(options.feed), error instanceof Error ? error.message : String(error));
  }
  const label = source.kind === "local" ? path.basename(path.resolve(source.path)) : source.label;
  try {
    const result = source.kind === "local" ? await validateLocal(source.path, options.date) : await validateRemote(source, options.date);
    if (options.format === "json") process.stdout.write(`${JSON.stringify(buildReport(result, label, options.date), null, 2)}\n`);
    else if (options.format === "csv") process.stdout.write(renderCsv(result));
    else process.stdout.write(renderTable(result, label, options.date));
    return result.summary.some((row) => row.severity === "ERROR" && row.totalNotices > 0) ? EXIT_ERRORS : EXIT_PASSED;
  } catch (error) {
    // DuckDB and fetch errors may echo the URL with its query string.
    return validationFailed(label, redactSource(error instanceof Error ? error.message : String(error), options.feed));
  }
};
