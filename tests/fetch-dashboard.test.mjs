// scripts/fetch-dashboard.mjs beyond the split acceptance cases: release downloads that redirect, failed
// downloads, and archives that are not plain ustar. Every failure leaves the existing dashboard untouched.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

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

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] })
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
  assert.deepEqual(await readdir(out), ["previous.txt"])
  assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith(".")), [], "no staging directory is left behind")
})

const refuses = async (t, bytes, pattern) => {
  const { dir, out, result } = await fetchFrom(t, bytes)
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, pattern)
  assert.deepEqual(await readdir(out), ["previous.txt"])
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
