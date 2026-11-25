import * as fsPromises from "node:fs/promises";
import { mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Args } from "../args.js";
import { buildDuckDbSessionSql } from "../duckdb/config.js";
import { defaultExtensionStartup, runDuckDb } from "../duckdb/runner.js";
import { extractZipEntry, listZipEntries, validateFeed } from "../feed/zip.js";
import { safeTerminalText } from "../output/safe-text.js";
import { cleanupOnSignal, downloadFeed } from "../remote/download.js";
import type { RemoteFeedSource, SignalCleanup } from "../remote/download.js";
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

// What a validation needs: the date, and whether to fetch every notice (json and csv) or only the summary (table).
type Run = { date: string; notices: boolean };

// Control characters (a line break, an escape) are refused in a directory path, which reaches the SQL.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

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

const NOTICES_SQL =
  "SELECT code, severity, filename, csv_row_number, notice::VARCHAR AS notice FROM gtfs_validation_notices ORDER BY code, filename NULLS FIRST, csv_row_number NULLS FIRST, notice::VARCHAR;";

// PRAGMA gtfs_validate, then its notices when the format prints them, in one in-memory DuckDB with the
// gtfs extension loaded.
const runValidation = async (directory: string, run: Run): Promise<ValidationResult> => {
  const { repository, args } = await defaultExtensionStartup();
  const sql = [
    buildDuckDbSessionSql(),
    `PRAGMA gtfs_validate(${sqlString(directory)}, ${sqlString(run.date)});`,
    ...(run.notices ? [NOTICES_SQL] : []),
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

const isValidatedFile = (name: string) => (VALIDATED_FILES as readonly string[]).includes(name.toLowerCase());

// The name `file` has among `names`, found as the official validator finds files (it lowercases names):
// the exact name, else the first name equal to it without case.
const findFile = (names: string[], file: string) => (names.includes(file) ? file : names.find((name) => name.toLowerCase() === file));

// Extraction stops before it would leave less than this much free space on the temporary directory's disk.
const FREE_SPACE_RESERVE = 512 * 1024 ** 2;

// The bytes the extracted files may take: the free space of the disk holding `directory`, less the
// reserve. Unlimited where Node.js cannot tell (fs.statfs needs Node.js 18.15 or later).
const extractionBudget = async (directory: string) => {
  if (typeof fsPromises.statfs !== "function") return Infinity;
  const { bavail, bsize } = await fsPromises.statfs(directory);
  return Math.max(0, Number(bavail) * Number(bsize) - FREE_SPACE_RESERVE);
};

// Extracts the files the rules cover into `directory`, read as the official validator reads a zip: only
// entries at the root, names compared without case. A missing file is left out (the validator reports
// missing files itself), files in folders are named on stderr, and two entries with the same name are
// refused, since `unzip` would join them.
const extractFeed = async (zipPath: string, directory: string) => {
  const entries = await listZipEntries(zipPath);
  const root = entries.filter((entry) => !entry.includes("/"));
  const files: [string, string][] = [];
  for (const file of VALIDATED_FILES) {
    const entry = findFile(root, file);
    if (!entry) continue;
    const copies = root.filter((name) => name === entry).length;
    if (copies > 1) throw new Error(`The zip has ${copies} entries named ${entry}: remove the extra ones and validate again.`);
    files.push([file, entry]);
  }
  const inFolders = entries.filter((entry) => entry.includes("/") && isValidatedFile(entry.slice(entry.lastIndexOf("/") + 1)));
  if (inFolders.length > 0) {
    const shown = inFolders.slice(0, 5).join(", ") + (inFolders.length > 5 ? ` and ${inFolders.length - 5} more` : "");
    console.error(safeTerminalText(`Not validated, in a folder of the zip (the official validator reads only its root): ${shown}`));
  }
  let budget = await extractionBudget(directory);
  for (const [file, entry] of files) budget -= await extractZipEntry(zipPath, entry, path.join(directory, file), budget);
};

// Runs `validate` on a new private (0700) temporary directory, which is always removed afterwards: on
// success, on failure and, through `cleanup`, on Ctrl-C or SIGTERM (which also kill DuckDB).
const inTemporaryDirectory = async <T>(cleanup: SignalCleanup, validate: (directory: string) => Promise<T>) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-validate-"));
  cleanup.add(directory);
  try {
    return await validate(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

// Validates a zip from a temporary directory holding only the extracted files.
const validateZip = (zipPath: string, run: Run, cleanup: SignalCleanup) =>
  inTemporaryDirectory(cleanup, async (directory) => {
    await extractFeed(zipPath, directory);
    return runValidation(directory, run);
  });

// A directory is validated as it is. When a file's name has another case (Stops.txt), which the official
// validator reads but the extension does not find on a case-sensitive disk, it is validated through a
// temporary directory of links with the lowercase names.
const validateDirectory = async (directory: string, run: Run, cleanup: SignalCleanup) => {
  const names = (await readdir(directory, { withFileTypes: true })).filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  const files = VALIDATED_FILES.flatMap((file) => {
    const name = findFile(names, file);
    return name ? [[file, name] as const] : [];
  });
  if (files.every(([file, name]) => file === name)) return runValidation(directory, run);
  return inTemporaryDirectory(cleanup, async (links) => {
    for (const [file, name] of files) await symlink(path.join(directory, name), path.join(links, file));
    return runValidation(links, run);
  });
};

// A directory of .txt files is validated as it is; a zip path gets import's checks.
const validateLocal = async (input: string, run: Run, cleanup: SignalCleanup) => {
  const resolved = path.resolve(input);
  if ((await stat(resolved).catch(() => undefined))?.isDirectory()) {
    if (CONTROL_CHARACTER.test(resolved)) throw new Error("The directory path has a control character, such as a line break: rename it and validate again.");
    return validateDirectory(resolved, run, cleanup);
  }
  return validateZip(await validateFeed(input), run, cleanup);
};

// Downloads exactly as import does (downloads/<random>.zip, checked to be a zip), then validates the
// zip. The download is removed once extracted, and on failure or Ctrl-C/SIGTERM.
const validateRemote = async (source: RemoteFeedSource, run: Run, cleanup: SignalCleanup) => {
  const download = await downloadFeed(source, downloadsDir, cleanup);
  try {
    return await validateZip(download.file, run, cleanup);
  } finally {
    await rm(download.file, { force: true });
  }
};

const validateSource = async (source: FeedSource, run: Run) => {
  const cleanup = cleanupOnSignal();
  try {
    return source.kind === "local" ? await validateLocal(source.path, run, cleanup) : await validateRemote(source, run, cleanup);
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
  const label = source.kind === "local" ? path.basename(path.resolve(source.path)).replace(new RegExp(CONTROL_CHARACTER, "g"), "\ufffd") : source.label;
  try {
    const result = await validateSource(source, { date: options.date, notices: options.format !== "table" });
    if (options.format === "json") process.stdout.write(`${JSON.stringify(buildReport(result, label, options.date), null, 2)}\n`);
    else if (options.format === "csv") process.stdout.write(renderCsv(result));
    else process.stdout.write(renderTable(result, label, options.date));
    return result.summary.some((row) => row.severity === "ERROR" && row.totalNotices > 0) ? EXIT_ERRORS : EXIT_PASSED;
  } catch (error) {
    // DuckDB and fetch errors may echo the URL with its query string.
    return validationFailed(label, redactSource(error instanceof Error ? error.message : String(error), options.feed));
  }
};
