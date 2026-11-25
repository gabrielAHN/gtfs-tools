import { stat } from "node:fs/promises";
import path from "node:path";
import type { Args } from "../args.js";
import { buildDuckDbSessionSql } from "../duckdb/config.js";
import { defaultExtensionStartup, runDuckDb } from "../duckdb/runner.js";
import { safeTerminalText } from "../output/safe-text.js";
import { parseValidationOutput, renderTable } from "./report.js";
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
  const date = typeof args.flags.date === "string" ? args.flags.date : today();
  return { feed: args.positionals[0], format: format as Format, date };
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
  const directory = path.resolve(options.feed);
  const label = path.basename(directory);
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error(`Not a directory: ${options.feed}`);
    const result = await runValidation(directory, options.date);
    process.stdout.write(renderTable(result, label, options.date));
    return result.summary.some((row) => row.severity === "ERROR" && row.totalNotices > 0) ? EXIT_ERRORS : EXIT_PASSED;
  } catch (error) {
    console.error(`Validation failed: ${safeTerminalText(label)}`);
    console.error(safeTerminalText(error instanceof Error ? error.message : String(error)));
    return EXIT_FAILED;
  }
};
