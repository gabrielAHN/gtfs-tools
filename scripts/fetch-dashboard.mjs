#!/usr/bin/env node
/**
 * Installs the gtfs-viz dashboard that the CLI serves, from the release asset pinned in dashboard.lock.json.
 *
 *   node scripts/fetch-dashboard.mjs [--from <file|url>] [--lock <file>] [--out <dir>] [--allow-unpinned]
 *
 * It downloads the lock's `url` (or reads --from), checks the archive's sha256 against the lock, and extracts
 * it safely: gzip-compressed POSIX ustar only, read here with Node built-ins; every entry a regular file or a
 * directory under dashboard/; no absolute paths, `..`, links or devices. The archive is fully validated in
 * memory, including dashboard/dashboard-manifest.json (cliApi 1) and dashboard/index.html, then written to a
 * temporary sibling directory that is renamed into place. An existing dashboard is removed only after that.
 * Any failure exits non-zero and leaves the existing dashboard untouched.
 *
 * --allow-unpinned skips only the checksum comparison, with a warning. It is for development; publishing and
 * CI never use it.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOP = "dashboard/";
const MANIFEST = "dashboard-manifest.json";
const CLI_API = 1;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const USAGE =
  "Usage: node scripts/fetch-dashboard.mjs [--from <file|url>] [--lock <file>] [--out <dir>] [--allow-unpinned]";

class FetchDashboardError extends Error {}
const fail = (message) => {
  throw new FetchDashboardError(message);
};

const parseArgs = (argv) => {
  const options = { allowUnpinned: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--allow-unpinned") {
      options.allowUnpinned = true;
      continue;
    }
    const match = /^--(from|lock|out)(?:=(.*))?$/s.exec(arg);
    if (!match) fail(`unknown argument ${JSON.stringify(arg)}\n${USAGE}`);
    let value = match[2];
    if (value === undefined) {
      value = argv[index + 1];
      index += 1;
    }
    if (!value || value.startsWith("--")) fail(`--${match[1]} needs a value\n${USAGE}`);
    options[match[1]] = value;
  }
  return options;
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const readLock = async (file) => {
  let lock;
  try {
    lock = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`cannot read the dashboard lock ${file}: ${error.message}`);
  }
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) fail(`${file} is not a JSON object`);
  return lock;
};

const readLimited = async (body, label) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > MAX_ARCHIVE_BYTES) fail(`${label} is larger than ${MAX_ARCHIVE_BYTES} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

// GitHub release downloads answer with a redirect to their storage host; fetch follows it.
const download = async (url) => {
  let response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    fail(`download of ${url} failed: ${error.cause?.message ?? error.message}`);
  }
  if (!response.ok || !response.body) fail(`download of ${url} failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_ARCHIVE_BYTES) fail(`${url} is larger than ${MAX_ARCHIVE_BYTES} bytes`);
  return readLimited(response.body, url);
};

const readSource = async (source) => {
  if (/^https?:\/\//i.test(source)) return download(source);
  const file = source.startsWith("file:") ? fileURLToPath(source) : path.resolve(source);
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    fail(`cannot read the dashboard archive ${file}: ${error.message}`);
  }
  if (!info.isFile()) fail(`${file} is not a file`);
  if (info.size > MAX_ARCHIVE_BYTES) fail(`${file} is larger than ${MAX_ARCHIVE_BYTES} bytes`);
  return readFile(file);
};

const utf8 = new TextDecoder("utf-8", { fatal: true });
const text = (bytes, what) => {
  try {
    return utf8.decode(bytes);
  } catch {
    return fail(`${what} is not valid UTF-8`);
  }
};
const cString = (header, offset, length, what) => {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return text(end === -1 ? field : field.subarray(0, end), what);
};
const octal = (header, offset, length, what) => {
  const raw = header.subarray(offset, offset + length).toString("latin1").replace(/[\0 ]+$/, "").replace(/^ +/, "");
  if (!/^[0-7]+$/.test(raw)) fail(`malformed tar header: ${what} field ${JSON.stringify(raw)} is not octal`);
  return Number.parseInt(raw, 8);
};
const isZeroBlock = (block) => block.every((byte) => byte === 0);

const unsupportedTypes = {
  1: "hard link",
  2: "symbolic link",
  3: "character device",
  4: "block device",
  6: "FIFO",
  7: "contiguous file",
  x: "pax extended header",
  g: "pax global header",
  L: "GNU long name",
  K: "GNU long link name",
};

// Checks one entry name and returns its path relative to dashboard/ ("" for dashboard/ itself).
const relativeEntryPath = (name, isDirectory) => {
  const shown = JSON.stringify(name);
  if (!name) fail("unsafe entry with an empty name");
  if (/[\u0000-\u001f\u007f\\]/u.test(name)) fail(`unsafe entry name ${shown}: control character or backslash`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) fail(`unsafe absolute path ${shown} in the archive`);
  if (name.split("/").includes("..")) fail(`unsafe path ${shown}: ".." would leave dashboard/`);
  if (!name.startsWith(TOP)) fail(`entry ${shown} is outside dashboard/; every entry must sit under dashboard/`);
  if (isDirectory !== name.endsWith("/")) fail(`unsafe entry ${shown}: only directory names end with "/"`);
  const relative = name.slice(TOP.length).replace(/\/$/, "");
  if (relative && relative.split("/").some((part) => part === "" || part === "."))
    fail(`unsafe path ${shown}: empty or "." path segment`);
  return relative;
};

// Reads a POSIX ustar archive into { directories, files } keyed by path relative to dashboard/.
const readUstar = (tar) => {
  const directories = new Set();
  const files = new Map();
  const seen = new Set();
  let offset = 0;
  let entries = 0;
  for (;;) {
    if (offset + 512 > tar.length) fail("truncated tar archive: no end-of-archive marker");
    const header = tar.subarray(offset, offset + 512);
    if (isZeroBlock(header)) {
      const next = tar.subarray(offset + 512, offset + 1024);
      if (next.length !== 512 || !isZeroBlock(next)) fail("malformed tar archive: a lone zero block");
      break;
    }
    entries += 1;
    if (entries > MAX_ENTRIES) fail(`the archive has more than ${MAX_ENTRIES} entries`);
    const checksum = octal(header, 148, 8, "checksum");
    let sum = 0;
    for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 32 : header[index];
    if (sum !== checksum) fail(`malformed tar header at byte ${offset}: checksum mismatch`);
    if (header.subarray(257, 263).toString("latin1") !== "ustar\0" || header.subarray(263, 265).toString("latin1") !== "00")
      fail(`unsupported tar format at byte ${offset}: only POSIX ustar archives are accepted`);
    const name = cString(header, 0, 100, "entry name");
    const prefix = cString(header, 345, 155, "entry name prefix");
    const fullName = prefix ? `${prefix}/${name}` : name;
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    if (type !== "0" && type !== "5") {
      const kind = unsupportedTypes[type] ?? `type ${JSON.stringify(type)}`;
      fail(`unsupported entry ${JSON.stringify(fullName)}: ${kind}; only regular files and directories are accepted (no links or devices)`);
    }
    const isDirectory = type === "5";
    const relative = relativeEntryPath(fullName, isDirectory);
    const size = octal(header, 124, 12, "size");
    if (isDirectory && size !== 0) fail(`malformed directory entry ${JSON.stringify(fullName)} with data`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) fail(`truncated tar archive: ${JSON.stringify(fullName)} is cut short`);
    const key = relative.toLowerCase();
    if (seen.has(key)) fail(`duplicate entry ${JSON.stringify(fullName)} in the archive`);
    seen.add(key);
    if (isDirectory) directories.add(relative);
    else if (!relative) fail("unsafe entry: dashboard/ must be a directory");
    else files.set(relative, tar.subarray(dataStart, dataEnd));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  // No entry may sit below a path that the archive gives as a file.
  for (const entry of [...directories, ...files.keys()]) {
    const parts = entry.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      if (files.has(parts.slice(0, depth).join("/")))
        fail(`unsafe entry dashboard/${entry}: its parent is a file in the archive`);
    }
  }
  return { directories, files };
};

const checkManifest = (files) => {
  const body = files.get(MANIFEST);
  if (!body) fail(`the archive has no ${TOP}${MANIFEST} (dashboard manifest missing)`);
  let manifest;
  try {
    manifest = JSON.parse(text(body, MANIFEST));
  } catch (error) {
    if (error instanceof FetchDashboardError) throw error;
    fail(`${TOP}${MANIFEST} is not valid JSON (malformed manifest)`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    fail(`${TOP}${MANIFEST} is not a JSON object (malformed manifest)`);
  if (manifest.cliApi !== CLI_API)
    fail(`the dashboard manifest declares cliApi ${JSON.stringify(manifest.cliApi)}; this CLI serves CLI API ${CLI_API} and needs cliApi: ${CLI_API}`);
  const keys = Object.keys(manifest).sort().join(",");
  if (keys !== "cliApi,commit,name,version")
    fail(`malformed dashboard manifest: expected exactly the keys name, version, commit and cliApi, got ${keys}`);
  if (manifest.name !== "gtfs-viz-dashboard")
    fail(`malformed dashboard manifest: name is ${JSON.stringify(manifest.name)}, not "gtfs-viz-dashboard"`);
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(manifest.version))
    fail(`malformed dashboard manifest: version ${JSON.stringify(manifest.version)} is not a semver version`);
  if (typeof manifest.commit !== "string" || !/^[0-9a-f]{40}$/.test(manifest.commit))
    fail(`malformed dashboard manifest: commit ${JSON.stringify(manifest.commit)} is not a 40-hex git commit`);
  if (!files.has("index.html")) fail(`the archive has no ${TOP}index.html`);
  return manifest;
};

// Writes the validated entries to a temporary sibling of `outDir`, then swaps it into place.
const install = async ({ directories, files }, outDir) => {
  const parent = path.dirname(outDir);
  const base = path.basename(outDir);
  if (!base || outDir === path.parse(outDir).root) fail(`refusing to replace ${outDir}`);
  const existing = await stat(outDir).catch(() => null);
  if (existing && !existing.isDirectory()) fail(`${outDir} exists and is not a directory`);
  await mkdir(parent, { recursive: true });
  const tag = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const staging = path.join(parent, `.${base}.new-${tag}`);
  const previous = path.join(parent, `.${base}.old-${tag}`);
  const inside = (relative) => {
    const target = path.resolve(staging, ...relative.split("/"));
    if (!target.startsWith(staging + path.sep)) fail(`unsafe path dashboard/${relative}`);
    return target;
  };
  try {
    await mkdir(staging, { mode: 0o755 });
    for (const directory of [...directories].filter(Boolean).sort())
      await mkdir(inside(directory), { recursive: true, mode: 0o755 });
    for (const [relative, body] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const target = inside(relative);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, body, { mode: 0o644, flag: "wx" });
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (existing) await rename(outDir, previous);
  try {
    await rename(staging, outDir);
  } catch (error) {
    if (existing) await rename(previous, outDir);
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (existing) await rm(previous, { recursive: true, force: true });
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const lockFile = path.resolve(options.lock ?? path.join(packageRoot, "dashboard.lock.json"));
  const outDir = path.resolve(options.out ?? path.join(packageRoot, "dashboard"));
  const lock = await readLock(lockFile);
  const pinned = typeof lock.sha256 === "string" && /^[0-9a-f]{64}$/.test(lock.sha256) ? lock.sha256 : undefined;
  if (!pinned && !options.allowUnpinned) fail(`${lockFile} has no sha256 (64 lowercase hex characters)`);
  const source = options.from ?? lock.url;
  if (typeof source !== "string" || !source) fail(`${lockFile} has no url and --from was not given`);

  const archive = await readSource(source);
  const actual = sha256(archive);
  if (options.allowUnpinned) {
    console.error(
      `WARNING: --allow-unpinned: the dashboard archive is NOT verified against ${lockFile} ` +
        `(pinned ${pinned ?? "nothing"}, got ${actual}${actual === pinned ? ", which happens to match" : ""}). ` +
        "Development only: never publish or ship this dashboard.",
    );
  } else if (actual !== pinned) {
    fail(
      `sha256 mismatch for ${source}: ${lockFile} pins ${pinned}, the archive is ${actual}. ` +
        "The existing dashboard was left untouched.",
    );
  }

  let tar;
  try {
    tar = gunzipSync(archive, { maxOutputLength: MAX_EXTRACTED_BYTES });
  } catch (error) {
    fail(`${source} is not a gzip-compressed archive (or expands past ${MAX_EXTRACTED_BYTES} bytes): ${error.message}`);
  }
  const entries = readUstar(tar);
  const manifest = checkManifest(entries.files);
  await install(entries, outDir);
  console.log(
    `Installed gtfs-viz dashboard ${manifest.version} (commit ${manifest.commit.slice(0, 12)}, cliApi ${manifest.cliApi}) ` +
      `to ${outDir} from ${source}${options.allowUnpinned ? " (unpinned)" : ` (sha256 ${actual} matches ${path.basename(lockFile)})`}`,
  );
};

main().catch((error) => {
  console.error(`fetch-dashboard: ${error instanceof FetchDashboardError ? error.message : error.stack ?? error}`);
  process.exitCode = 1;
});
