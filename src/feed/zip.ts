// Local GTFS zip handling shared by `import` and `validate`: the checks a local zip path must pass,
// listing a zip's entries and extracting one entry with the system unzip.
import { createWriteStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { runProcess } from "../duckdb/runner.js";

// Thrown when an entry is larger than extractZipEntry's maxBytes.
export class EntryTooLargeError extends Error {
  readonly entry: string;
  readonly maxBytes: number;
  constructor(entry: string, maxBytes: number) {
    super(`${entry} is larger than the ${maxBytes} bytes that may be extracted.`);
    this.name = "EntryTooLargeError";
    this.entry = entry;
    this.maxBytes = maxBytes;
  }
}

// Extracts `entry` to `targetPath` and resolves to its size once the file is written. Past `maxBytes`
// the extraction stops and fails with EntryTooLargeError (a zip bomb would otherwise fill the disk).
export const extractZipEntry = (zipPath: string, entry: string, targetPath: string, maxBytes = Infinity) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn("unzip", ["-p", zipPath, entry], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = createWriteStream(targetPath);
    const stderr: Buffer[] = [];
    let bytes = 0;
    let tooLarge = false;
    let exitCode: number | null | undefined;
    let written = false;
    const settle = () => {
      if (exitCode === undefined || !written) return;
      if (tooLarge) reject(new EntryTooLargeError(entry, maxBytes));
      else if (exitCode === 0) resolve(bytes);
      else reject(new Error(Buffer.concat(stderr).toString("utf8") || `Failed to extract ${entry}`));
    };
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes && !tooLarge) {
        tooLarge = true;
        child.kill();
      }
    });
    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) =>
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    child.on("error", reject);
    output.on("error", reject);
    output.on("close", () => {
      written = true;
      settle();
    });
    child.on("close", (code) => {
      exitCode = code;
      output.end();
      settle();
    });
  });

export const listZipEntries = async (zipPath: string) => {
  const { stdout } = await runProcess("unzip", ["-Z1", zipPath]);
  return stdout.split(/\r?\n/).filter(Boolean);
};

// A GTFS file at the zip's root or in any folder of it.
export const findGtfsEntry = (entries: string[], fileName: string) =>
  entries.find((e) => e === fileName || e.endsWith(`/${fileName}`));

// The resolved path of a local file that exists and is named *.zip.
export const validateFeed = async (feedPath: string) => {
  const resolved = path.resolve(feedPath);
  await access(resolved).catch(() => {
    throw new Error(`GTFS file not found: ${feedPath}`);
  });
  const s = await stat(resolved);
  if (!s.isFile()) throw new Error(`Not a file: ${feedPath}`);
  if (!resolved.toLowerCase().endsWith(".zip")) throw new Error("Requires a .zip file");
  return resolved;
};
