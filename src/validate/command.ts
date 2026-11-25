import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Args } from "../args.js";
import { buildDuckDbSessionSql } from "../duckdb/config.js";
import { defaultExtensionStartup, runDuckDb } from "../duckdb/runner.js";
import { extractZipEntry, findGtfsEntry, listZipEntries, validateFeed } from "../feed/zip.js";
import { safeTerminalText } from "../output/safe-text.js";
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

// PRAGMA gtfs_validate, then its notices, in one in-memory DuckDB with the gtfs extension loaded.
const runValidation = async (directory: string, date: string): Promise<ValidationResult> => {
  const { repository, args } = await defaultExtensionStartup();
  const sql = [
    buildDuckDbSessionSql(),
    `PRAGMA gtfs_validate(${sqlString(directory)}, ${sqlString(date)});`,
    "SELECT code, severity, filename, csv_row_number, notice::VARCHAR AS notice FROM gtfs_validation_notices ORDER BY code, filename NULLS FIRST, csv_row_number NULLS FIRST;",
  ].join("\n");
  const { stdout } = await runDuckDb(["-bail", "-json", ...args, ":memory:", "-c", sql], repository);
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

// Validates a directory of .txt files as it is, or a zip from a new private temporary directory
// that is always removed.
const validateLocal = async (input: string, date: string) => {
  const resolved = path.resolve(input);
  if ((await stat(resolved).catch(() => undefined))?.isDirectory()) return runValidation(resolved, date);
  const zipPath = await validateFeed(input);
  const directory = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-validate-"));
  try {
    await extractFeed(zipPath, directory);
    return await runValidation(directory, date);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
  const label = path.basename(path.resolve(options.feed));
  try {
    const result = await validateLocal(options.feed, options.date);
    if (options.format === "json") process.stdout.write(`${JSON.stringify(buildReport(result, label, options.date), null, 2)}\n`);
    else if (options.format === "csv") process.stdout.write(renderCsv(result));
    else process.stdout.write(renderTable(result, label, options.date));
    return result.summary.some((row) => row.severity === "ERROR" && row.totalNotices > 0) ? EXIT_ERRORS : EXIT_PASSED;
  } catch (error) {
    console.error(`Validation failed: ${safeTerminalText(label)}`);
    console.error(safeTerminalText(error instanceof Error ? error.message : String(error)));
    return EXIT_FAILED;
  }
};
