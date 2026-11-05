// scripts/fetch-dashboard.mjs beyond the split acceptance cases: release downloads that redirect, failed
// downloads, archives that are not plain ustar, and --out directories it must never replace. Every failure
// leaves the existing dashboard untouched.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"
import { FetchDashboardError, install } from "../scripts/fetch-dashboard.mjs"

const script = fileURLToPath(new URL("../scripts/fetch-dashboard.mjs", import.meta.url))

const field = (buffer, offset, length, value) => buffer.write(value, offset, length, "utf8")
const octal = (buffer, offset, length, value) => field(buffer, offset, length, value.toString(8).padStart(length - 1, "0") + "\0")
const entry = (name, { type = "0", body = Buffer.alloc(0), magic = "ustar\0", version = "00" } = {}) => {
  const header = Buffer.alloc(512)
  field(header, 0, 100, name)
  octal(header, 100, 8, type === "5" ? 0o755 : 0o644)
  octal(header, 108, 8, 0)
  octal(header, 116, 8, 0)
  octal(header, 124, 12, type === "5" ? 0 : body.length)
  octal(header, 136, 12, 0)
  header.fill(" ", 148, 156)
  field(header, 156, 1, type)
  field(header, 257, 6, magic)
  field(header, 263, 2, version)
  let sum = 0
  for (const byte of header) sum += byte
  field(header, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ")
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512)
  body.copy(padded)
  return Buffer.concat([header, type === "5" ? Buffer.alloc(0) : padded])
}
const tarOf = (entries) => Buffer.concat([...entries.map(([name, options]) => entry(name, options)), Buffer.alloc(1024)])
const file = (text) => ({ body: Buffer.from(text) })
const goodEntries = () => [
  ["dashboard/", { type: "5" }],
  ["dashboard/dashboard-manifest.json", file(JSON.stringify({ name: "gtfs-viz-dashboard", version: "1.6.0", commit: "a".repeat(40), cliApi: 1 }))],
  ["dashboard/index.html", file("<!doctype html><title>dashboard</title>")],
]
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const previousManifest = JSON.stringify({ name: "gtfs-viz-dashboard", version: "1.5.9", commit: "1".repeat(40), cliApi: 1 })
const previousDashboard = ["dashboard-manifest.json", "previous.txt"]

const run = (args, { cwd, env, scriptPath = script } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", reject)
    child.on("close", (status) => resolve({ status, stdout, stderr }))
  })

// A lock pinning `bytes`, an existing dashboard, and a run of the script with `--from source`.
const fetchFrom = async (t, bytes, source) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-fetch-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const lock = path.join(dir, "dashboard.lock.json")
  await writeFile(lock, JSON.stringify({ repository: "gabrielAHN/gtfs-viz", tag: "v1.6.0", asset: "gtfs-viz-dashboard.tar.gz", url: "https://example.invalid/unused", sha256: sha256(bytes) }))
  const out = path.join(dir, "dashboard")
  await mkdir(out)
  // An older installed dashboard: the only kind of non-empty directory fetch-dashboard may replace.
  await writeFile(path.join(out, "dashboard-manifest.json"), previousManifest)
  await writeFile(path.join(out, "previous.txt"), "previous dashboard")
  const from = source ?? path.join(dir, "gtfs-viz-dashboard.tar.gz")
  if (!source) await writeFile(from, bytes)
  const result = await run(["--from", from, "--lock", lock, "--out", out])
  return { dir, out, result }
}

const serve = async (t, handler) => {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

test("a release download that redirects is followed and verified", async (t) => {
  const bytes = gzipSync(tarOf(goodEntries()))
  const requests = []
  const base = await serve(t, (req, res) => {
    requests.push(req.url)
    if (req.url === "/releases/download/v1.6.0/gtfs-viz-dashboard.tar.gz") res.writeHead(302, { location: "/storage/asset?token=x" }).end()
    else if (req.url === "/storage/asset?token=x") res.writeHead(200, { "content-length": bytes.length }).end(bytes)
    else res.writeHead(404).end()
  })
  const { out, result } = await fetchFrom(t, bytes, `${base}/releases/download/v1.6.0/gtfs-viz-dashboard.tar.gz`)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(requests, ["/releases/download/v1.6.0/gtfs-viz-dashboard.tar.gz", "/storage/asset?token=x"])
  assert.deepEqual((await readdir(out)).sort(), ["dashboard-manifest.json", "index.html"])
  assert.equal(await readFile(path.join(out, "index.html"), "utf8"), "<!doctype html><title>dashboard</title>")
})

test("a failed download exits non-zero and keeps the existing dashboard", async (t) => {
  const base = await serve(t, (_req, res) => res.writeHead(404).end("not found"))
  const { dir, out, result } = await fetchFrom(t, Buffer.from("unused"), `${base}/missing.tar.gz`)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /HTTP 404/)
  assert.deepEqual((await readdir(out)).sort(), previousDashboard)
  assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith(".")), [], "no staging directory is left behind")
})

const refuses = async (t, bytes, pattern) => {
  const { dir, out, result } = await fetchFrom(t, bytes)
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, pattern)
  assert.deepEqual((await readdir(out)).sort(), previousDashboard)
  assert.deepEqual((await readdir(dir)).sort(), ["dashboard", "dashboard.lock.json", "gtfs-viz-dashboard.tar.gz"])
}

test("only gzip-compressed POSIX ustar archives of files and directories are accepted", async (t) => {
  await refuses(t, tarOf(goodEntries()), /not a gzip-compressed archive/)
  await refuses(t, gzipSync(tarOf(goodEntries())).subarray(0, 60), /not a gzip-compressed archive/)
  await refuses(t, gzipSync(tarOf(goodEntries()).subarray(0, 1024)), /truncated|cut short/)
  await refuses(t, gzipSync(tarOf([["dashboard/index.html", { ...file("x"), magic: "ustar ", version: " \0" }]])), /only POSIX ustar/)
  await refuses(t, gzipSync(tarOf([["dashboard/pax", { type: "x", body: Buffer.from("30 path=dashboard/index.html\n") }], ...goodEntries()])), /pax extended header/)
  await refuses(t, gzipSync(tarOf([["dashboard/dev", { type: "3" }], ...goodEntries()])), /character device/)
  await refuses(t, gzipSync(tarOf([...goodEntries(), ["dashboard/index.html", file("again")]])), /duplicate entry/)
  await refuses(t, gzipSync(tarOf([...goodEntries(), ["dashboard/index.html/inner.txt", file("x")]])), /parent is a file/)
  await refuses(t, gzipSync(tarOf([...goodEntries(), ["dashboard/./x.txt", file("x")]])), /unsafe path/)
  const extraKey = goodEntries().map(([name, options]) =>
    name.endsWith("dashboard-manifest.json") ? [name, file(JSON.stringify({ name: "gtfs-viz-dashboard", version: "1.6.0", commit: "a".repeat(40), cliApi: 1, extra: true }))] : [name, options],
  )
  await refuses(t, gzipSync(tarOf(extraKey)), /malformed dashboard manifest/)
  const corrupt = tarOf(goodEntries())
  corrupt[0] ^= 1
  await refuses(t, gzipSync(corrupt), /checksum mismatch/)
})

test("the lock must pin a sha256 unless --allow-unpinned is given", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-fetch-lock-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const archive = path.join(dir, "gtfs-viz-dashboard.tar.gz")
  await writeFile(archive, gzipSync(tarOf(goodEntries())))
  const lock = path.join(dir, "dashboard.lock.json")
  await writeFile(lock, JSON.stringify({ url: "https://example.invalid/unused", sha256: "PLACEHOLDER" }))
  const out = path.join(dir, "dashboard")
  const pinned = await run(["--from", archive, "--lock", lock, "--out", out])
  assert.notEqual(pinned.status, 0)
  assert.match(pinned.stderr, /has no sha256/)
  const unpinned = await run(["--from", archive, "--lock", lock, "--out", out, "--allow-unpinned"])
  assert.equal(unpinned.status, 0, unpinned.stderr)
  assert.match(unpinned.stderr, /WARNING: --allow-unpinned/)
  assert.deepEqual((await readdir(out)).sort(), ["dashboard-manifest.json", "index.html"])
  const unknown = await run(["--from", archive, "--lock", lock, "--out", out, "--pinned"])
  assert.notEqual(unknown.status, 0)
  assert.match(unknown.stderr, /unknown argument "--pinned"/)
})

// A scratch "package" holding a copy of the script (so the package root is scratch, never this checkout),
// a pinned archive and its lock.
const sandbox = async (t) => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-fetch-out-")))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const pkg = path.join(dir, "pkg")
  await mkdir(path.join(pkg, "scripts"), { recursive: true })
  const scriptCopy = path.join(pkg, "scripts", "fetch-dashboard.mjs")
  await copyFile(script, scriptCopy)
  const bytes = gzipSync(tarOf(goodEntries()))
  const archive = path.join(dir, "gtfs-viz-dashboard.tar.gz")
  await writeFile(archive, bytes)
  const lock = path.join(dir, "dashboard.lock.json")
  await writeFile(lock, JSON.stringify({ url: "https://example.invalid/unused", sha256: sha256(bytes) }))
  const home = path.join(dir, "home")
  await mkdir(home)
  const fetchInto = (out, { cwd = dir, from = archive } = {}) =>
    run(["--from", from, "--lock", lock, "--out", out], { cwd, env: { HOME: home }, scriptPath: scriptCopy })
  return { dir, pkg, home, fetchInto }
}
const listing = async (dir) => (await readdir(dir)).sort()

test("--out never names the current directory, the package root, $HOME, / or a parent of one, even when empty", async (t) => {
  const { dir, pkg, home, fetchInto } = await sandbox(t)
  const emptyCwd = path.join(dir, "cwd")
  await mkdir(emptyCwd)
  // A parent of the current directory that even holds a dashboard manifest.
  const parent = path.join(dir, "parent")
  const child = path.join(parent, "child")
  await mkdir(child, { recursive: true })
  await writeFile(path.join(parent, "dashboard-manifest.json"), previousManifest)
  // The package root, with a dashboard manifest too.
  await writeFile(path.join(pkg, "dashboard-manifest.json"), previousManifest)
  const cases = [
    [".", emptyCwd, "the current directory, empty"],
    [emptyCwd, emptyCwd, "the current directory by absolute path"],
    ["..", child, "a parent of the current directory"],
    [pkg, dir, "the package root"],
    [home, dir, "$HOME, empty"],
    ["/", dir, "/"],
  ]
  const before = { cwd: await listing(emptyCwd), parent: await listing(parent), pkg: await listing(pkg), home: await listing(home), dir: await listing(dir) }
  for (const [out, cwd, label] of cases) {
    const result = await fetchInto(out, { cwd })
    assert.notEqual(result.status, 0, `${label} must be refused`)
    assert.match(result.stderr, /refusing to replace .*not a dashboard directory/, label)
    assert.doesNotMatch(result.stderr, /\n\s+at /, `${label}: a clear error, not a stack trace`)
  }
  assert.deepEqual(
    { cwd: await listing(emptyCwd), parent: await listing(parent), pkg: await listing(pkg), home: await listing(home), dir: await listing(dir) },
    before,
    "nothing was touched",
  )
})

test("--out refuses a symbolic link and a non-dashboard directory before downloading anything", async (t) => {
  const { dir, fetchInto } = await sandbox(t)
  const requests = []
  const base = await serve(t, (req, res) => {
    requests.push(req.url)
    res.writeHead(404).end()
  })
  const target = path.join(dir, "target")
  await mkdir(target)
  await writeFile(path.join(target, "dashboard-manifest.json"), previousManifest)
  const link = path.join(dir, "link")
  await symlink(target, link)
  const linked = await fetchInto(link, { from: `${base}/gtfs-viz-dashboard.tar.gz` })
  assert.notEqual(linked.status, 0)
  assert.match(linked.stderr, /refusing to replace .*symbolic link, not a dashboard directory/)
  assert.deepEqual(await listing(target), ["dashboard-manifest.json"])
  const project = path.join(dir, "project")
  await mkdir(project)
  await writeFile(path.join(project, "notes.txt"), "keep")
  const refused = await fetchInto(project, { from: `${base}/gtfs-viz-dashboard.tar.gz` })
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /refusing to replace .*not a dashboard directory/)
  assert.deepEqual(await listing(project), ["notes.txt"])
  assert.deepEqual(requests, [], "the refusal comes before any download")
})

test("--out creates missing parent directories and replaces an older dashboard", async (t) => {
  const { dir, fetchInto } = await sandbox(t)
  const deep = path.join(dir, "a", "b", "c", "dashboard")
  const created = await fetchInto(deep)
  assert.equal(created.status, 0, created.stderr)
  assert.deepEqual(await listing(deep), ["dashboard-manifest.json", "index.html"])
  await writeFile(path.join(deep, "stale.txt"), "from the older dashboard")
  const replaced = await fetchInto(deep)
  assert.equal(replaced.status, 0, replaced.stderr)
  assert.deepEqual(await listing(deep), ["dashboard-manifest.json", "index.html"])
  assert.deepEqual((await listing(path.dirname(deep))).filter((name) => name.startsWith(".")), [], "no staging or old copy is left")
})

test("names that one file system stores as one file give a clear error, not a stack trace", async (t) => {
  // In the archive: NFC and NFD spellings of one name, as on APFS.
  const nfc = "caf\u00e9.txt"
  const nfd = "cafe\u0301.txt"
  assert.notEqual(nfc, nfd)
  assert.equal(nfc, nfd.normalize("NFC"))
  const duplicate = gzipSync(tarOf([...goodEntries(), [`dashboard/${nfc}`, file("1")], [`dashboard/${nfd}`, file("2")]]))
  const { result } = await fetchFrom(t, duplicate)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /duplicate entry .*Unicode normalization/)
  assert.doesNotMatch(result.stderr, /\n\s+at /)
  await refuses(t, duplicate, /duplicate entry/)

  // At extraction: a collision the file system reports (EEXIST) becomes the same kind of error, and the
  // existing dashboard and its parent are untouched.
  const dir = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-fetch-collide-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const out = path.join(dir, "dashboard")
  await mkdir(out)
  await writeFile(path.join(out, "dashboard-manifest.json"), previousManifest)
  await writeFile(path.join(out, "previous.txt"), "previous dashboard")
  const entries = { directories: new Set(["", "x"]), files: new Map([["x", Buffer.from("1")], ["index.html", Buffer.from("i")]]) }
  await assert.rejects(install(entries, out), (error) => {
    assert.ok(error instanceof FetchDashboardError, String(error?.stack))
    assert.match(error.message, /dashboard\/x collides with another entry on this file system .*EEXIST/)
    return true
  })
  assert.deepEqual((await readdir(out)).sort(), previousDashboard)
  assert.deepEqual(await readdir(dir), ["dashboard"], "no staging directory is left behind")
  // The real NFC/NFD pair: installs both names where the file system keeps them apart, and otherwise fails
  // with the clear error (APFS).
  const pair = { directories: new Set([""]), files: new Map([[nfc, Buffer.from("1")], [nfd, Buffer.from("2")], ["index.html", Buffer.from("i")]]) }
  try {
    await install(pair, out)
    assert.equal((await readdir(out)).length, 3)
  } catch (error) {
    assert.ok(error instanceof FetchDashboardError, String(error?.stack))
    assert.match(error.message, /collides with another entry on this file system/)
    assert.deepEqual((await readdir(out)).sort(), previousDashboard)
  }
})

// A parent directory as a crash between install()'s two renames leaves it: no dashboard/, and the previous
// dashboard renamed to .dashboard.old-<tag>.
const interrupted = async (t, copies) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-fetch-restore-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const [name, manifest] of copies) {
    await mkdir(path.join(dir, name))
    await writeFile(path.join(dir, name, "dashboard-manifest.json"), manifest)
    await writeFile(path.join(dir, name, "index.html"), `<title>${name}</title>`)
  }
  const bytes = gzipSync(tarOf(goodEntries()))
  const archive = path.join(dir, "gtfs-viz-dashboard.tar.gz")
  await writeFile(archive, bytes)
  const lockFor = async (sha) => {
    const lock = path.join(dir, `lock-${sha.slice(0, 8)}.json`)
    await writeFile(lock, JSON.stringify({ url: "https://example.invalid/unused", sha256: sha }))
    return lock
  }
  const out = path.join(dir, "dashboard")
  const fetch = async (sha) => run(["--from", archive, "--lock", await lockFor(sha), "--out", out])
  return { dir, out, bytes, fetch }
}

test("an interrupted swap is undone first: exactly one .dashboard.old-* copy with a valid manifest is restored", async (t) => {
  const old = ".dashboard.old-123-0123456789ab"
  const { dir, out, bytes, fetch } = await interrupted(t, [[old, previousManifest]])
  // Even when this run then fails (checksum mismatch), the previous dashboard is back in place.
  const failed = await fetch("e".repeat(64))
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /sha256 mismatch/)
  assert.match(failed.stderr, new RegExp(`restored .*dashboard \\(dashboard 1\\.5\\.9\\) from ${old.replaceAll(".", "\\.")}`))
  assert.equal(await readFile(path.join(out, "index.html"), "utf8"), `<title>${old}</title>`)
  assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith(".")), [])
  // The next good run replaces the restored dashboard as usual.
  const installed = await fetch(sha256(bytes))
  assert.equal(installed.status, 0, installed.stderr)
  assert.doesNotMatch(installed.stderr, /restored/)
  assert.equal(await readFile(path.join(out, "index.html"), "utf8"), "<!doctype html><title>dashboard</title>")
})

test("an interrupted swap is left alone when the old copy is ambiguous or not a valid dashboard", async (t) => {
  const two = await interrupted(t, [[".dashboard.old-1-aaaaaaaaaaaa", previousManifest], [".dashboard.old-2-bbbbbbbbbbbb", previousManifest]])
  const ambiguous = await two.fetch("e".repeat(64))
  assert.notEqual(ambiguous.status, 0)
  assert.match(ambiguous.stderr, /2 older copies \(\.dashboard\.old-\*\) sit next to it; restoring none of them/)
  assert.deepEqual((await readdir(two.dir)).filter((name) => name.startsWith(".")).length, 2)
  assert.deepEqual((await readdir(two.dir)).includes("dashboard"), false)

  const foreign = await interrupted(t, [[".dashboard.old-1-aaaaaaaaaaaa", JSON.stringify({ name: "something-else" })]])
  const notRestored = await foreign.fetch("e".repeat(64))
  assert.notEqual(notRestored.status, 0)
  assert.doesNotMatch(notRestored.stderr, /restored/)
  assert.deepEqual((await readdir(foreign.dir)).includes("dashboard"), false)
  assert.deepEqual((await readdir(foreign.dir)).filter((name) => name.startsWith(".")), [".dashboard.old-1-aaaaaaaaaaaa"])
})
