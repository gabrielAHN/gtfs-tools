import { safeTerminalText } from "../output/safe-text.js";

export type Severity = "ERROR" | "WARNING" | "INFO";

// One row of PRAGMA gtfs_validate: a code and how many notices it has.
export type SummaryRow = { severity: Severity; code: string; totalNotices: number };

// One row of gtfs_validation_notices; `notice` is the MobilityData notice object as JSON text.
export type NoticeRow = {
  code: string;
  severity: string;
  filename: string | null;
  csvRowNumber: number | null;
  notice: string;
};

export type ValidationResult = { summary: SummaryRow[]; notices: NoticeRow[] };

// The files the validated rules cover: the ones the gtfs extension imports.
export const VALIDATED_FILES = [
  "stops.txt",
  "pathways.txt",
  "routes.txt",
  "trips.txt",
  "stop_times.txt",
  "shapes.txt",
  "calendar.txt",
  "calendar_dates.txt",
] as const;

const unexpected = (detail: string) => new Error(`Unexpected DuckDB output from gtfs_validate: ${detail}`);

// The JSON arrays DuckDB's -json mode printed, one per statement, skipping any other line (DuckDB 2.0
// can print WARNING lines on stdout). Each array starts on a line of its own.
const jsonArrays = (stdout: string) => {
  const arrays: unknown[][] = [];
  let pending: string[] | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!pending && !line.startsWith("[")) continue;
    pending = [...(pending ?? []), line];
    try {
      const value = JSON.parse(pending.join("\n"));
      if (Array.isArray(value)) arrays.push(value);
      pending = undefined;
    } catch {}
  }
  if (pending) throw unexpected("an incomplete JSON result");
  return arrays;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toSummaryRow = (row: Record<string, unknown>): SummaryRow => {
  const { severity, code } = row;
  const totalNotices = Number(row.total_notices);
  if ((severity !== "ERROR" && severity !== "WARNING" && severity !== "INFO") || typeof code !== "string" || !Number.isFinite(totalNotices)) {
    throw unexpected("a summary row without severity, code and total_notices");
  }
  return { severity, code, totalNotices };
};

const toNoticeRow = (row: Record<string, unknown>): NoticeRow => {
  const { code, severity, filename } = row;
  const csvRowNumber = row.csv_row_number === null || row.csv_row_number === undefined ? null : Number(row.csv_row_number);
  // A JSON-typed column may arrive as an object rather than as text.
  const notice = typeof row.notice === "string" ? row.notice : JSON.stringify(row.notice ?? {});
  if (typeof code !== "string" || typeof severity !== "string") throw unexpected("a notice row without code and severity");
  return {
    code,
    severity,
    filename: typeof filename === "string" ? filename : null,
    csvRowNumber: csvRowNumber !== null && Number.isFinite(csvRowNumber) ? csvRowNumber : null,
    notice,
  };
};

// The summary (PRAGMA gtfs_validate) and the notices (gtfs_validation_notices) from DuckDB's -json
// output. Each result is recognised by its columns, so an empty result printed as [] or not at all
// reads the same.
export const parseValidationOutput = (stdout: string): ValidationResult => {
  const result: ValidationResult = { summary: [], notices: [] };
  for (const rows of jsonArrays(stdout)) {
    for (const row of rows) {
      if (!isRecord(row)) throw unexpected("a row that is not an object");
      if ("total_notices" in row) result.summary.push(toSummaryRow(row));
      else if ("notice" in row) result.notices.push(toNoticeRow(row));
      else throw unexpected(`a row with columns ${Object.keys(row).join(", ")}`);
    }
  }
  return result;
};

export type Counts = { errors: number; warnings: number; infos: number };

export const countNotices = (summary: SummaryRow[]): Counts => {
  const total = (severity: Severity) =>
    summary.filter((row) => row.severity === severity).reduce((sum, row) => sum + row.totalNotices, 0);
  return { errors: total("ERROR"), warnings: total("WARNING"), infos: total("INFO") };
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const countsLine = ({ errors, warnings, infos }: Counts) =>
  `${plural(errors, "error")}, ${plural(warnings, "warning")}, ${plural(infos, "info")}`;

// The terminal report. Codes and the source label may come from the feed or a server, so every value
// goes through safeTerminalText.
export const renderTable = (result: ValidationResult, label: string, date: string) => {
  const lines = [`Validated ${safeTerminalText(label)} for ${date} with the gtfs DuckDB extension`, ""];
  if (result.summary.length === 0) {
    lines.push(`No notices: the feed passed the validated rules for ${VALIDATED_FILES.slice(0, -1).join(", ")} and ${VALIDATED_FILES.at(-1)}.`);
  } else {
    const header = ["severity", "code", "notices"];
    const rows = result.summary.map((row) => [row.severity, safeTerminalText(row.code), String(row.totalNotices)]);
    const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index].length)));
    const render = (values: string[]) => values.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
    lines.push(render(header), widths.map((width) => "─".repeat(width)).join("  "), ...rows.map(render));
  }
  lines.push("", countsLine(countNotices(result.summary)));
  return lines.join("\n") + "\n";
};
