// Local GTFS zip handling shared by `import` and `validate`: the checks a local zip path must pass,
// listing a zip's entries and extracting one entry with the system unzip.
import { createWriteStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { runProcess } from "../duckdb/runner.js";

export const extractZipEntry = (zipPath: string, entry: string, targetPath: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn("unzip", ["-p", zipPath, entry], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = createWriteStream(targetPath);
    const stderr: Buffer[] = [];
    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) =>
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    child.on("error", reject);
    output.on("error", reject);
    child.on("close", (code) => {
      output.end();
      if (code === 0) resolve();
      else
        reject(new Error(Buffer.concat(stderr).toString("utf8") || `Failed to extract ${entry}`));
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
