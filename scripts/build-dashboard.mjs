#!/usr/bin/env node
/**
 * Installs the gtfs-viz dashboard that the CLI serves, built from the gtfs-viz git submodule.
 *
 *   node scripts/build-dashboard.mjs [--source <dir>] [--dist <dir>] [--out <dir>]
 *
 * Without --dist it builds first: <source> (default gtfs-viz/ in the package root, the submodule) must hold a
 * gtfs-viz checkout, `yarn` must be on PATH, and it runs `yarn install --frozen-lockfile --ignore-engines` and
 * `yarn build:dashboard` there with AI_AGENT unset. That leaves the CLI-mode web app and its
 * dashboard-manifest.json in <source>/packages/web/dist. --dist <dir> skips the build and installs an already
 * built CLI-mode dashboard.
 *
 * The built dashboard is read and validated in full before anything is written: every entry must be a regular
 * file or a directory (no symbolic links, hard links or devices), dashboard-manifest.json must name
 * "gtfs-viz-dashboard" with cliApi 1, and index.html must exist. Source maps (*.map) and .DS_Store are skipped.
 * It is then written to a temporary sibling directory of --out (default dashboard/) that is renamed into place;
 * an existing dashboard is removed only after that. Any failure exits non-zero and leaves the existing
 * dashboard untouched.
 *
 * --out only ever replaces a dashboard: a missing directory (its parents are created), an empty one, or one
 * holding a dashboard-manifest.json named "gtfs-viz-dashboard". Anything else is refused untouched, and so is
 * the current directory, the package root, $HOME, / or a parent of one of them, even when empty.
 *
 * On start, if --out is missing and exactly one .<name>.old-* sibling holds a valid dashboard (a crash between
 * the two renames of an earlier run), it is restored first. Names that the file system stores as one file
 * (case or NFC/NFD variants) are refused with a clear error.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOP = "dashboard/";
const MANIFEST = "dashboard-manifest.json";
const CLI_API = 1;
const MAX_DASHBOARD_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const USAGE = "Usage: node scripts/build-dashboard.mjs [--source <gtfs-viz checkout>] [--dist <built dashboard>] [--out <dir>]";
const SUBMODULE_HINT =
  "run `git submodule update --init` in the gtfs-tools checkout (or clone it with `git clone --recurse-submodules`)";

class BuildDashboardError extends Error {}
const fail = (message) => {
  throw new BuildDashboardError(message);
};

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    const match = /^--(source|dist|out)(?:=(.*))?$/s.exec(arg);
    if (!match) fail(`unknown argument ${JSON.stringify(arg)}\n${USAGE}`);
    let value = match[2];
    if (value === undefined) {
      value = argv[index + 1];
      index += 1;
    }
    if (!value || value.startsWith("--")) fail(`--${match[1]} needs a value\n${USAGE}`);
    options[match[1]] = value;
  }
  if (options.source && options.dist)
    fail(`--source and --dist exclude each other: --dist installs a dashboard that is already built\n${USAGE}`);
  return options;
};

// Builds the CLI-mode dashboard in a gtfs-viz checkout and returns its dist directory.
const buildFromSource = async (source) => {
  const manifest = await lstat(path.join(source, "package.json")).catch(() => null);
  if (!manifest?.isFile())
    fail(`${source} holds no gtfs-viz checkout (no package.json): the gtfs-viz submodule is missing. To build the dashboard, ${SUBMODULE_HINT}.`);
  const env = { ...process.env };
  delete env.AI_AGENT;
  const shell = process.platform === "win32";
  const probe = spawnSync("yarn", ["--version"], { env, encoding: "utf8", shell });
  if (probe.error || probe.status !== 0)
    fail(
      `yarn is not on PATH (${probe.error?.code ?? `yarn --version exited ${probe.status}`}). Building the dashboard ` +
        "runs gtfs-viz's yarn 1 scripts: install yarn 1.x (`npm install -g yarn`, or `corepack enable`) and try again.",
    );
  for (const args of [["install", "--frozen-lockfile", "--ignore-engines"], ["build:dashboard"]]) {
    console.error(`build-dashboard: yarn ${args.join(" ")} (in ${source}, yarn ${probe.stdout.trim()})`);
    // The build's own output goes to stderr, so this script's stdout stays one summary line.
    const result = spawnSync("yarn", args, { cwd: source, env, shell, stdio: ["ignore", 2, 2] });
    if (result.error) fail(`yarn ${args.join(" ")} could not run in ${source}: ${result.error.message}`);
    if (result.status !== 0)
      fail(`yarn ${args.join(" ")} failed in ${source} (exit ${result.status ?? result.signal}); the existing dashboard was left untouched`);
  }
  return path.join(source, "packages", "web", "dist");
};

// Case-insensitive, normalization-insensitive file systems (APFS, NTFS) store names that differ only in case
// or Unicode normalization (NFC/NFD) as one file, so the dashboard may not hold two such names.
const sameNameKey = (relative) => relative.normalize("NFC").toLowerCase();

// Files the dashboard never ships.
const isSkipped = (name) => name === ".DS_Store" || name.endsWith(".map");

// Reads a built dashboard directory into { directories, files } keyed by path relative to it. Only regular
// files and directories are accepted; a link, a device or a file with more than one hard link is refused.
const readDist = async (dist) => {
  const root = await realpath(dist).catch((error) => fail(`cannot read the dashboard build ${dist}: ${error.message}`));
  if (!(await lstat(root)).isDirectory()) fail(`the dashboard build ${dist} is not a directory`);
  const directories = new Set([""]);
  const files = new Map();
  const seen = new Set();
  const skipped = [];
  let entries = 0;
  let bytes = 0;
  const refuse = (relative, what) =>
    fail(
      `refusing the dashboard build: ${JSON.stringify(relative)} in ${dist} is ${what}; ` +
        "only regular files and directories are accepted (no links or devices)",
    );
  const claim = (relative) => {
    const key = sameNameKey(relative);
    if (seen.has(key))
      fail(`duplicate entry ${JSON.stringify(relative)} in the dashboard build (names that differ only in case or Unicode normalization count as one)`);
    seen.add(key);
  };
  const walk = async (directory, prefix) => {
    for (const name of (await readdir(directory)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (/[\u0000-\u001f\u007f\\]/u.test(name))
        fail(`unsafe entry name ${JSON.stringify(relative)} in the dashboard build: control character or backslash`);
      entries += 1;
      if (entries > MAX_ENTRIES) fail(`the dashboard build has more than ${MAX_ENTRIES} entries`);
      const full = path.join(directory, name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) refuse(relative, "a symbolic link");
      if (info.isDirectory()) {
        claim(relative);
        directories.add(relative);
        await walk(full, relative);
        continue;
      }
      if (!info.isFile()) refuse(relative, "not a regular file (a device, FIFO or socket)");
      if (isSkipped(name)) {
        skipped.push(relative);
        continue;
      }
      claim(relative);
      // Opened without following links and checked again on the descriptor, so a swap after lstat is caught.
      const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((error) =>
        error.code === "ELOOP" ? refuse(relative, "a symbolic link") : Promise.reject(error),
      );
      try {
        const opened = await handle.stat();
        if (!opened.isFile()) refuse(relative, "not a regular file");
        if (opened.nlink > 1) refuse(relative, `a hard link (${opened.nlink} names share it)`);
        bytes += opened.size;
        if (bytes > MAX_DASHBOARD_BYTES) fail(`the dashboard build is larger than ${MAX_DASHBOARD_BYTES} bytes`);
        files.set(relative, await handle.readFile());
      } finally {
        await handle.close();
      }
    }
  };
  await walk(root, "");
  return { directories, files, skipped };
};

// What is wrong with a parsed dashboard manifest, or undefined when it is valid. A manifest has exactly the
// keys name, commit and cliApi. gtfs-viz no longer has versions; dashboards built before that also carry a
// semver `version`, and that older shape is still accepted so an installed one can be restored or replaced.
const manifestProblem = (manifest) => {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    return `${MANIFEST} is not a JSON object (malformed manifest)`;
  if (manifest.cliApi !== CLI_API)
    return `the dashboard manifest declares cliApi ${JSON.stringify(manifest.cliApi)}; this CLI serves CLI API ${CLI_API} and needs cliApi: ${CLI_API}`;
  const keys = Object.keys(manifest).sort().join(",");
  if (keys !== "cliApi,commit,name" && keys !== "cliApi,commit,name,version")
    return `malformed dashboard manifest: expected exactly the keys name, commit and cliApi (older dashboards also have version), got ${keys}`;
  if (manifest.name !== "gtfs-viz-dashboard")
    return `malformed dashboard manifest: name is ${JSON.stringify(manifest.name)}, not "gtfs-viz-dashboard"`;
  if ("version" in manifest && (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(manifest.version)))
    return `malformed dashboard manifest: version ${JSON.stringify(manifest.version)} is not a semver version`;
  if (typeof manifest.commit !== "string" || !/^[0-9a-f]{40}$/.test(manifest.commit))
    return `malformed dashboard manifest: commit ${JSON.stringify(manifest.commit)} is not a 40-hex git commit`;
  return undefined;
};

// How messages name a dashboard: its short commit.
const dashboardLabel = (manifest) => `commit ${manifest.commit.slice(0, 7)}`;

const checkManifest = (files, dist) => {
  const body = files.get(MANIFEST);
  if (!body)
    fail(`the dashboard build ${dist} has no ${MANIFEST} (dashboard manifest missing); build it with gtfs-viz's \`yarn build:dashboard\``);
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    fail(`${MANIFEST} in ${dist} is not valid JSON (malformed manifest)`);
  }
  const problem = manifestProblem(manifest);
  if (problem) fail(problem);
  if (!files.has("index.html")) fail(`the dashboard build ${dist} has no index.html`);
  return manifest;
};

// A directory and every directory above it, both as given and with symlinks resolved.
const withParents = async (dir) => {
  const found = [];
  for (const start of new Set([path.resolve(dir), await realpath(dir).catch(() => path.resolve(dir))])) {
    for (let current = start; ; current = path.dirname(current)) {
      found.push(current);
      if (path.dirname(current) === current) break;
    }
  }
  return found;
};

// Directories --out may never name, even when empty: the current directory, the package root, $HOME and /,
// and every parent of them.
const protectedDirectories = async () =>
  new Set((await Promise.all([process.cwd(), packageRoot, os.homedir()].map(withParents))).flat());

const isDashboardDirectory = async (dir) => {
  const manifestFile = path.join(dir, MANIFEST);
  const info = await lstat(manifestFile).catch(() => null);
  if (!info?.isFile()) return false;
  try {
    return JSON.parse(await readFile(manifestFile, "utf8"))?.name === "gtfs-viz-dashboard";
  } catch {
    return false;
  }
};

// Decides whether `outDir` may be replaced; returns whether it exists. Refuses (touching nothing) unless it is
// missing, an empty directory, or a dashboard directory, and never accepts a protected directory.
const checkOutDir = async (outDir) => {
  const refuse = (why) => fail(`refusing to replace ${outDir}: ${why}. Pick an --out that is missing, empty or an installed dashboard.`);
  const guarded = await protectedDirectories();
  const real = await realpath(outDir).catch(() => outDir);
  if (guarded.has(outDir) || guarded.has(real))
    refuse("it is the current directory, the package root, the home directory or a parent of one, not a dashboard directory");
  let info;
  try {
    info = await lstat(outDir);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    fail(`cannot inspect ${outDir}: ${error.message}`);
  }
  if (info.isSymbolicLink()) refuse("it is a symbolic link, not a dashboard directory");
  if (!info.isDirectory()) refuse("it is not a directory, so not a dashboard directory");
  if ((await readdir(outDir)).length === 0 || (await isDashboardDirectory(outDir))) return true;
  return refuse(`it is not a dashboard directory (it is not empty and has no ${MANIFEST} naming "gtfs-viz-dashboard")`);
};

// install() renames the old dashboard to .<base>.old-<tag> and then the new one into place. A crash between the
// two renames leaves `outDir` missing; when exactly one such copy holds a valid dashboard, put it back.
const restoreInterruptedSwap = async (outDir) => {
  const missing = await lstat(outDir).then(
    () => false,
    (error) => error.code === "ENOENT",
  );
  if (!missing) return;
  const parent = path.dirname(outDir);
  const prefix = `.${path.basename(outDir)}.old-`;
  const copies = (await readdir(parent).catch(() => [])).filter((name) => name.startsWith(prefix));
  if (copies.length > 1) {
    console.error(`build-dashboard: ${outDir} is missing and ${copies.length} older copies (${prefix}*) sit next to it; restoring none of them`);
    return;
  }
  if (copies.length !== 1) return;
  const copy = path.join(parent, copies[0]);
  if (!(await lstat(copy).catch(() => null))?.isDirectory()) return;
  const manifestFile = path.join(copy, MANIFEST);
  if (!(await lstat(manifestFile).catch(() => null))?.isFile()) return;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch {
    return;
  }
  if (manifestProblem(manifest)) return;
  await rename(copy, outDir);
  console.error(
    `build-dashboard: restored ${outDir} (dashboard ${dashboardLabel(manifest)}) from ${copies[0]}, left behind by an interrupted update`,
  );
};

// Writes the validated entries to a temporary sibling of `outDir`, then swaps it into place.
const install = async ({ directories, files }, outDir) => {
  const parent = path.dirname(outDir);
  const base = path.basename(outDir);
  if (!base || outDir === path.parse(outDir).root) fail(`refusing to replace ${outDir}: not a dashboard directory`);
  const existing = await checkOutDir(outDir);
  await mkdir(parent, { recursive: true });
  const tag = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const staging = path.join(parent, `.${base}.new-${tag}`);
  const previous = path.join(parent, `.${base}.old-${tag}`);
  const inside = (relative) => {
    const target = path.resolve(staging, ...relative.split("/"));
    if (!target.startsWith(staging + path.sep)) fail(`unsafe path ${TOP}${relative}`);
    return target;
  };
  let current = "";
  try {
    await mkdir(staging, { mode: 0o755 });
    for (const directory of [...directories].filter(Boolean).sort()) {
      current = directory;
      // Not recursive: parents come first in sorted order, so an existing directory here means two names
      // that this file system stores as one (for example "s" and "\u017f" on APFS) and is a collision.
      await mkdir(inside(directory), { mode: 0o755 });
    }
    for (const [relative, body] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
      current = relative;
      const target = inside(relative);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, body, { mode: 0o644, flag: "wx" });
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    // Two entries that this file system stores under one name (case, NFC/NFD or another folding).
    if (["EEXIST", "ENOTDIR", "EISDIR"].includes(error?.code))
      fail(
        `the dashboard entry ${TOP}${current} collides with another entry on this file system ` +
          `(their names differ only in case, Unicode normalization or another folding) (${error.code}); the existing dashboard was left untouched`,
      );
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
  const outDir = path.resolve(options.out ?? path.join(packageRoot, "dashboard"));
  // First undo an interrupted swap, so a failure below still leaves the previous dashboard in place.
  await restoreInterruptedSwap(outDir);
  // Refuse a non-dashboard --out before building anything; install() checks again before the swap.
  await checkOutDir(outDir);
  const dist = options.dist
    ? path.resolve(options.dist)
    : await buildFromSource(path.resolve(options.source ?? path.join(packageRoot, "gtfs-viz")));
  const entries = await readDist(dist);
  const manifest = checkManifest(entries.files, dist);
  await install(entries, outDir);
  console.log(
    `Installed gtfs-viz dashboard ${dashboardLabel(manifest)} (cliApi ${manifest.cliApi}) ` +
      `to ${outDir} from ${dist}: ${entries.files.size} files` +
      (entries.skipped.length ? `, skipped ${entries.skipped.length} source maps and .DS_Store files` : ""),
  );
};

export { BuildDashboardError, install, readDist };

// Runs only as a script (`node scripts/build-dashboard.mjs`); tests import install() directly.
const invokedAsScript = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invokedAsScript) {
  main().catch((error) => {
    // Our own failures and file system errors (EACCES, ENOSPC, …) are reported as one line, not a stack trace.
    const clear = error instanceof BuildDashboardError || typeof error?.code === "string";
    console.error(`build-dashboard: ${clear ? error.message : error?.stack ?? error}`);
    process.exitCode = 1;
  });
}
