// Acceptance contract for the split from gabrielAHN/gtfs-viz (see the split CONTRACT.md).
// Requires `npm run build` first (dist/index.js). Never skips: a missing build is a failure.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const compatDir = path.join(root, "compat", "gtfs-viz-cli")

const scratch = () => mkdtemp(path.join(os.tmpdir(), "gtfs-tools-split-"))
const run = (args, options = {}) =>
  spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 60_000,
    ...options,
    env: { ...process.env, AI_AGENT: "", ...options.env },
  })

// Minimal POSIX ustar writer for synthetic dashboard archives.
const field = (buffer, offset, length, value) => buffer.write(value, offset, length, "utf8")
const octal = (buffer, offset, length, value) => field(buffer, offset, length, value.toString(8).padStart(length - 1, "0") + "\0")
const ustarEntry = (name, { type = "0", body = Buffer.alloc(0), linkname = "" } = {}) => {
  const header = Buffer.alloc(512)
  field(header, 0, 100, name)
  octal(header, 100, 8, type === "5" ? 0o755 : 0o644)
  octal(header, 108, 8, 0)
  octal(header, 116, 8, 0)
  octal(header, 124, 12, type === "0" ? body.length : 0)
  octal(header, 136, 12, 0)
  header.fill(" ", 148, 156)
  field(header, 156, 1, type)
  field(header, 157, 100, linkname)
  field(header, 257, 6, "ustar\0")
  field(header, 263, 2, "00")
  let sum = 0
  for (const byte of header) sum += byte
  field(header, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ")
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512)
  body.copy(padded)
  return Buffer.concat([header, type === "0" ? padded : Buffer.alloc(0)])
}
const archive = (entries) =>
  gzipSync(Buffer.concat([...entries.map(([name, options]) => ustarEntry(name, options)), Buffer.alloc(1024)]))
const file = (text) => ({ body: Buffer.from(text) })
const manifest = (extra = {}) =>
  file(JSON.stringify({ name: "gtfs-viz-dashboard", version: "1.6.0", commit: "0".repeat(40), cliApi: 1, ...extra }))
const goodEntries = () => [
  ["dashboard/", { type: "5" }],
  ["dashboard/assets/", { type: "5" }],
  ["dashboard/assets/app.js", file("console.log('dashboard')")],
  ["dashboard/dashboard-manifest.json", manifest()],
  ["dashboard/index.html", file("<!doctype html><title>dashboard</title>")],
]
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex")

// Writes the archive and a lock pinning `pinned` (defaults to the archive's own hash), then runs the fetch script.
const fetchDashboard = async (bytes, { pinned, extraArgs = [] } = {}) => {
  const dir = await scratch()
  const tarball = path.join(dir, "gtfs-viz-dashboard.tar.gz")
  await writeFile(tarball, bytes)
  const lock = path.join(dir, "dashboard.lock.json")
  await writeFile(
    lock,
    JSON.stringify({
      repository: "gabrielAHN/gtfs-viz",
      tag: "v1.6.0",
      asset: "gtfs-viz-dashboard.tar.gz",
      url: "https://github.com/gabrielAHN/gtfs-viz/releases/download/v1.6.0/gtfs-viz-dashboard.tar.gz",
      sha256: pinned ?? sha256(bytes),
    }),
  )
  const out = path.join(dir, "dashboard")
  await mkdir(out)
  // An older installed dashboard: the only kind of existing directory fetch-dashboard may replace.
  await writeFile(path.join(out, "dashboard-manifest.json"), JSON.stringify({ name: "gtfs-viz-dashboard", version: "1.5.9", commit: "1".repeat(40), cliApi: 1 }))
  await writeFile(path.join(out, "previous.txt"), "previous dashboard")
  const result = run([path.join(root, "scripts", "fetch-dashboard.mjs"), "--from", tarball, "--lock", lock, "--out", out, ...extraArgs])
  return { dir, out, result }
}
const previousDashboard = ["dashboard-manifest.json", "previous.txt"]
const outsideFiles = (dir) => readdirSync(dir).filter((name) => !["dashboard", "dashboard.lock.json", "gtfs-viz-dashboard.tar.gz"].includes(name) && !name.startsWith("."))

test("no source, script or test imports @gtfs-viz packages", () => {
  const offenders = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === "dashboard" || name.startsWith(".")) continue
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(m?[jt]s|tsx?|json)$/.test(name) && full !== fileURLToPath(import.meta.url)) {
        if (/@gtfs-viz\//.test(readFileSync(full, "utf8"))) offenders.push(path.relative(root, full))
      }
    }
  }
  for (const dir of ["src", "scripts", "tests", "compat"]) if (existsSync(path.join(root, dir))) walk(path.join(root, dir))
  for (const name of ["package.json", "tsconfig.json"]) if (/@gtfs-viz\//.test(readFileSync(path.join(root, name), "utf8"))) offenders.push(name)
  assert.deepEqual(offenders, [])
})

test("the CLI is @gabrielahn/gtfs-tools with a single gtfs-tools command", () => {
  assert.equal(pkg.name, "@gabrielahn/gtfs-tools")
  assert.deepEqual(pkg.bin, { "gtfs-tools": "dist/index.js" })
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.match(pkg.repository?.url ?? "", /github\.com\/gabrielAHN\/gtfs-tools/)
  assert.ok(pkg.files.includes("dashboard"), "the npm package ships the bundled dashboard")
  assert.equal(pkg.repository?.directory, undefined)
})

test("@gabrielahn/gtfs-viz-cli is a compatibility package pinned to the same version", () => {
  const compat = JSON.parse(readFileSync(path.join(compatDir, "package.json"), "utf8"))
  assert.equal(compat.name, "@gabrielahn/gtfs-viz-cli")
  assert.equal(compat.version, pkg.version)
  assert.deepEqual(compat.bin, { "gtfs-viz": "bin/gtfs-viz.js" })
  assert.deepEqual(compat.dependencies, { "@gabrielahn/gtfs-tools": pkg.version })
  for (const hook of ["preinstall", "install", "postinstall", "preuninstall"]) assert.equal(compat.scripts?.[hook], undefined, hook)
  assert.ok(existsSync(path.join(compatDir, "bin", "gtfs-viz.js")))
})

test("dashboard.lock.json pins one gtfs-viz release asset by sha256", () => {
  const lock = JSON.parse(readFileSync(path.join(root, "dashboard.lock.json"), "utf8"))
  assert.equal(lock.repository, "gabrielAHN/gtfs-viz")
  assert.match(lock.tag, /^v\d+\.\d+\.\d+$/)
  assert.equal(lock.asset, "gtfs-viz-dashboard.tar.gz")
  assert.equal(lock.url, `https://github.com/gabrielAHN/gtfs-viz/releases/download/${lock.tag}/gtfs-viz-dashboard.tar.gz`)
  assert.match(lock.sha256, /^[0-9a-f]{64}$/)
})

test("fetch-dashboard installs a pinned archive", async () => {
  const { out, result } = await fetchDashboard(archive(goodEntries()))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(path.join(out, "index.html"), "utf8"), "<!doctype html><title>dashboard</title>")
  assert.equal(readFileSync(path.join(out, "assets", "app.js"), "utf8"), "console.log('dashboard')")
  assert.equal(JSON.parse(readFileSync(path.join(out, "dashboard-manifest.json"), "utf8")).cliApi, 1)
  assert.equal(existsSync(path.join(out, "previous.txt")), false, "the old dashboard is replaced")
})

const rejected = async (bytes, options, pattern) => {
  const { dir, out, result } = await fetchDashboard(bytes, options)
  assert.notEqual(result.status, 0, "must fail")
  assert.match(result.stderr + result.stdout, pattern)
  assert.deepEqual(readdirSync(out).sort(), previousDashboard, "the existing dashboard is untouched")
  assert.equal(readFileSync(path.join(out, "previous.txt"), "utf8"), "previous dashboard")
  assert.deepEqual(outsideFiles(dir), [], "nothing is written outside the output directory")
  return result
}

test("fetch-dashboard refuses an archive whose sha256 differs from the lock", async () => {
  const bytes = archive(goodEntries())
  const result = await rejected(bytes, { pinned: "f".repeat(64) }, /sha256|checksum/i)
  assert.match(result.stderr + result.stdout, new RegExp(sha256(bytes)))
})

test("fetch-dashboard refuses unsafe or incompatible archives", async () => {
  const traversal = [...goodEntries(), ["dashboard/../escaped.txt", file("escaped")]]
  await rejected(archive(traversal), {}, /unsafe|outside|\.\./i)
  const absolute = [...goodEntries(), ["/tmp/gtfs-tools-absolute.txt", file("absolute")]]
  await rejected(archive(absolute), {}, /unsafe|outside|absolute/i)
  const link = [...goodEntries(), ["dashboard/link", { type: "2", linkname: "/etc/passwd" }]]
  await rejected(archive(link), {}, /link|unsafe|unsupported/i)
  const stray = [...goodEntries(), ["elsewhere/file.txt", file("stray")]]
  await rejected(archive(stray), {}, /outside|dashboard\//i)
  const wrongApi = goodEntries().map(([name, options]) =>
    name.endsWith("dashboard-manifest.json") ? [name, manifest({ cliApi: 2 })] : [name, options],
  )
  await rejected(archive(wrongApi), {}, /cliApi/)
  const noIndex = goodEntries().filter(([name]) => !name.endsWith("index.html"))
  await rejected(archive(noIndex), {}, /index\.html/)
  const noManifest = goodEntries().filter(([name]) => !name.endsWith("dashboard-manifest.json"))
  await rejected(archive(noManifest), {}, /manifest/i)
})

test("fetch-dashboard only ever replaces an empty directory or an older dashboard", async () => {
  const bytes = archive(goodEntries())
  const dir = await scratch()
  const tarball = path.join(dir, "gtfs-viz-dashboard.tar.gz")
  await writeFile(tarball, bytes)
  const lock = path.join(dir, "dashboard.lock.json")
  await writeFile(lock, JSON.stringify({ repository: "gabrielAHN/gtfs-viz", tag: "v1.6.0", asset: "gtfs-viz-dashboard.tar.gz",
    url: "https://github.com/gabrielAHN/gtfs-viz/releases/download/v1.6.0/gtfs-viz-dashboard.tar.gz", sha256: sha256(bytes) }))
  const fetchInto = (out, cwd = dir) =>
    run([path.join(root, "scripts", "fetch-dashboard.mjs"), "--from", tarball, "--lock", lock, "--out", out], { cwd })

  // A project directory (no dashboard manifest) is refused and left exactly as it was, including `--out .`.
  const project = path.join(dir, "project")
  await mkdir(path.join(project, "src"), { recursive: true })
  await mkdir(path.join(project, ".git"))
  await writeFile(path.join(project, "src", "main.ts"), "code")
  await writeFile(path.join(project, "package.json"), "{}")
  for (const [out, cwd] of [[project, dir], [".", project], [path.join(project, "src"), dir]]) {
    const result = fetchInto(out, cwd)
    assert.notEqual(result.status, 0, `--out ${out} must be refused`)
    assert.match(result.stderr + result.stdout, /refus|not a dashboard|non-dashboard/i)
    assert.deepEqual(readdirSync(project).sort(), [".git", "package.json", "src"])
    assert.equal(readFileSync(path.join(project, "src", "main.ts"), "utf8"), "code")
  }
  // A manifest that is not a gtfs-viz dashboard's does not count.
  const other = path.join(dir, "other")
  await mkdir(other)
  await writeFile(path.join(other, "dashboard-manifest.json"), JSON.stringify({ name: "something-else" }))
  await writeFile(path.join(other, "keep.txt"), "keep")
  assert.notEqual(fetchInto(other).status, 0)
  assert.equal(readFileSync(path.join(other, "keep.txt"), "utf8"), "keep")

  // An empty directory and a missing directory are fine.
  const empty = path.join(dir, "empty")
  await mkdir(empty)
  assert.equal(fetchInto(empty).status, 0)
  assert.ok(existsSync(path.join(empty, "index.html")))
  const fresh = path.join(dir, "fresh", "dashboard")
  assert.equal(fetchInto(fresh).status, 0)
  assert.ok(existsSync(path.join(fresh, "index.html")))
})

test("--allow-unpinned skips only the checksum, with a warning", async () => {
  const { out, result } = await fetchDashboard(archive(goodEntries()), { pinned: "e".repeat(64), extraArgs: ["--allow-unpinned"] })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /unpinned|not verified|warning/i)
  assert.ok(existsSync(path.join(out, "index.html")))
})

test("help and version use the command name: gtfs-tools, or gtfs-viz through the compatibility package", async () => {
  const cli = path.join(root, "dist", "index.js")
  assert.ok(existsSync(cli), "run `npm run build` first")
  const home = await scratch()
  const env = { HOME: home }
  const version = run([cli, "--version"], { env })
  assert.equal(version.status, 0, version.stderr)
  assert.equal(version.stdout.trim(), `gtfs-tools ${pkg.version}`)
  const help = run([cli, "--help"], { env })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /gtfs-tools import/)
  assert.doesNotMatch(help.stdout, /gtfs-viz import/)

  // Install the compatibility package next to a linked gtfs-tools, as npm would.
  const prefix = await scratch()
  const compatInstall = path.join(prefix, "node_modules", "@gabrielahn", "gtfs-viz-cli")
  await cp(compatDir, compatInstall, { recursive: true })
  await symlink(root, path.join(prefix, "node_modules", "@gabrielahn", "gtfs-tools"), "dir")
  const shim = path.join(compatInstall, "bin", "gtfs-viz.js")
  const compatVersion = run([shim, "--version"], { env })
  assert.equal(compatVersion.status, 0, compatVersion.stderr)
  assert.equal(compatVersion.stdout.trim(), `gtfs-viz ${pkg.version}`)
  const compatHelp = run([shim, "--help"], { env })
  assert.equal(compatHelp.status, 0, compatHelp.stderr)
  assert.match(compatHelp.stdout, /gtfs-viz import/)
  assert.doesNotMatch(compatHelp.stdout, /gtfs-tools import/)
  assert.equal(existsSync(path.join(home, ".gtfs-viz-cli", "daemon.json")), false, "help never starts a daemon")
  assert.equal((await readFile(shim, "utf8")).includes("GTFS_TOOLS_COMMAND_NAME"), true)
})
