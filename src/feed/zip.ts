// Local GTFS zip handling shared by `import` and `validate`: the checks a local zip path must pass,
// listing a zip's entries and extracting one entry with the system unzip.
import { createWriteStream } from "node:fs";
import { access, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { runProcess } from "../duckdb/runner.js";
import { cleanupOnSignal } from "../remote/download.js";

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

// unzip reads its zip argument as a pattern when the path has *, ? or [, and then reads each zip of that
// folder whose name matches, one after the other: feed[1].zip reads feed1.zip, and feed*.zip reads
// feed1.zip too. Such a zip is read through a link named feed.zip in a new private directory, removed
// afterwards and on Ctrl-C or SIGTERM. unzip opens the folders of a path as they are and matches only its
// last part, so the link's plain name is enough even when the temporary directory has such characters.
const UNZIP_PATTERN_CHARACTER = /[*?[]/;

const withUnzipPath = async <T>(zipPath: string, read: (unzipPath: string) => Promise<T>): Promise<T> => {
  if (!UNZIP_PATTERN_CHARACTER.test(zipPath)) return read(zipPath);
  const directory = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-zip-"));
  const cleanup = cleanupOnSignal();
  cleanup.add(directory);
  const link = path.join(directory, "feed.zip");
  try {
    await symlink(path.resolve(zipPath), link);
    return await read(link);
  } catch (error) {
    // unzip's messages name the zip it was given: name the user's zip instead of the link.
    if (error instanceof Error) error.message = error.message.replaceAll(link, zipPath);
    throw error;
  } finally {
    cleanup.dispose();
    await rm(directory, { recursive: true, force: true });
  }
};

// unzip also reads an entry name as a pattern ([a]/stops.txt names a/stops.txt, */stops.txt every
// stops.txt in a folder) and one starting with -d as its extraction folder option. A \ before each *, ?, [
// and \, and before a leading -, makes the name match that entry alone.
const unzipEntryName = (entry: string) => entry.replace(/^-|[*?[\\]/g, "\\$&");

// Extracts `entry` to `targetPath` and resolves to its size once the file is written. Past `maxBytes`
// the extraction stops and fails with EntryTooLargeError (a zip bomb would otherwise fill the disk).
export const extractZipEntry = (zipPath: string, entry: string, targetPath: string, maxBytes = Infinity) =>
  withUnzipPath(zipPath, (unzipPath) => extractEntry(unzipPath, entry, targetPath, maxBytes));

const extractEntry = (zipPath: string, entry: string, targetPath: string, maxBytes: number) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn("unzip", ["-p", zipPath, unzipEntryName(entry)], {
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

export const listZipEntries = (zipPath: string) =>
  withUnzipPath(zipPath, async (unzipPath) => {
    const { stdout } = await runProcess("unzip", ["-Z1", unzipPath]);
    return stdout.split(/\r?\n/).filter(Boolean);
  });

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
