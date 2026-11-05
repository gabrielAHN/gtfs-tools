// A dashboard daemon left running by another CLI version must not be reused (review finding M3). After an
// upgrade from 1.5.x the old daemon keeps running and serves its package's dashboard/ directory, which the
// upgrade removed, so every page was HTTP 500. daemon.json now records cliVersion and packageRoot; a CLI
// reuses the daemon only when both match, and otherwise stops it (SIGTERM, then SIGKILL) after checking that
// the pid really is a daemon on the recorded port, then starts its own.
// Requires `npm run build:cli` (dist/index.js). Needs no DuckDB: the dataset state is a stub.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cli = path.join(root, "dist", "index.js")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// A HOME with an imported (stub) dataset and a stub dashboard build.
const setup = async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-daemon-"))
  const home = path.join(dir, "home")
  const current = path.join(home, ".gtfs-viz-cli", "current")
  await mkdir(current, { recursive: true })
  await writeFile(path.join(current, "state.json"), JSON.stringify({
    status: "ready", sourcePath: "/feeds/sample.zip", feedPath: path.join(current, "feed.zip"), dbPath: path.join(current, "gtfs.duckdb"),
    importedAt: new Date().toISOString(), fileName: "sample.zip", fileSize: 1, counts: { stops: 0, stations: 0, pathways: 0, routes: 0 },
  }))
  const dist = path.join(dir, "web-dist")
  await mkdir(dist)
  await writeFile(path.join(dist, "index.html"), "<!doctype html><title>stub dashboard</title>")
  const env = { ...process.env, HOME: home, GTFS_VIZ_DASHBOARD_DIST: dist, AI_AGENT: "" }
  delete env.GTFS_TOOLS_COMMAND_NAME
  const daemonFile = path.join(home, ".gtfs-viz-cli", "daemon.json")
  const readDaemon = async () => JSON.parse(await readFile(daemonFile, "utf8"))
  // Asynchronous, so this process keeps reaping the stand-in daemons it started while the CLI waits for them
  // to exit (a synchronous spawn would leave them as zombies that still look alive).
  const cliRun = (...args) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], { env, stdio: ["ignore", "pipe", "pipe"] })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk) => (stdout += chunk))
      child.stderr.on("data", (chunk) => (stderr += chunk))
      child.on("error", reject)
      child.on("close", (status) => resolve({ status, stdout, stderr }))
    })
  const children = []
  t.after(async () => {
    await cliRun("stop")
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await rm(dir, { recursive: true, force: true })
  })
  // A process standing in for an old daemon: `node <dir>/old/dist/index.js __daemon__`, serving the dashboard
  // API on a port like a 1.5.x daemon. With ignoreTerm it survives SIGTERM.
  const startOld = async ({ ignoreTerm = false, daemonArg = "__daemon__" } = {}) => {
    const script = path.join(dir, "old", "dist", "index.js")
    await mkdir(path.dirname(script), { recursive: true })
    await writeFile(script, `
      import http from "node:http"
      ${ignoreTerm ? 'process.on("SIGTERM", () => {})' : ""}
      const server = http.createServer((req, res) => {
        if (req.url.startsWith("/__gtfs_viz/api/dataset")) res.writeHead(200, { "content-type": "application/json" }).end("{}")
        else res.writeHead(500, { "content-type": "application/json" }).end('{"error":"ENOENT: dashboard removed"}')
      })
      server.listen(0, "127.0.0.1", () => console.log(server.address().port))
    `)
    const child = spawn(process.execPath, [script, daemonArg], { stdio: ["ignore", "pipe", "inherit"] })
    children.push(child)
    const port = await new Promise((resolve, reject) => {
      child.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim())))
      child.once("exit", () => reject(new Error("the old daemon stand-in exited")))
    })
    // How it exited, or "still running" after 10 s (so a regression fails instead of hanging).
    const ended = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })))
    const exited = Promise.race([ended, new Promise((resolve) => setTimeout(() => resolve("still running"), 10_000).unref())])
    return { child, port, exited }
  }
  // daemon.json as 1.5.x wrote it: no cliVersion, no packageRoot.
  const writeOldDaemonJson = async (pid, port, extra = {}) =>
    writeFile(daemonFile, JSON.stringify({
      pid, port, sessionId: "old-session", dashboardUrl: `http://127.0.0.1:${port}`, apiUrl: `http://127.0.0.1:${port}/__gtfs_viz/api`,
      startedAt: new Date().toISOString(), datasetFile: "sample.zip", ...extra,
    }))
  const urlOnly = async () => {
    const result = await cliRun("stations", "--url-only")
    assert.equal(result.status, 0, result.stderr)
    const url = new URL(result.stdout.trim().split("\n").at(-1))
    return { result, url, port: Number(url.port) }
  }
  return { cliRun, readDaemon, startOld, writeOldDaemonJson, urlOnly }
}

test("a 1.5.x daemon (daemon.json without cliVersion and packageRoot) is stopped and replaced", async (t) => {
  const { readDaemon, startOld, writeOldDaemonJson, urlOnly } = await setup(t)
  const old = await startOld()
  await writeOldDaemonJson(old.child.pid, old.port)
  const { result, url, port } = await urlOnly()
  assert.deepEqual(await old.exited, { code: null, signal: "SIGTERM" }, "stopped gracefully")
  assert.match(result.stderr, new RegExp(`Stopped the dashboard daemon from an older version \\(pid ${old.child.pid}\\)`))
  assert.notEqual(port, old.port)
  const daemon = await readDaemon()
  assert.equal(daemon.cliVersion, pkg.version)
  assert.equal(daemon.packageRoot, root)
  assert.equal(daemon.port, port)
  assert.notEqual(daemon.pid, old.child.pid)
  assert.ok(alive(daemon.pid))
  const page = await fetch(url)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /stub dashboard/)
})

test("a daemon that ignores SIGTERM is killed; a current daemon is reused; another version's is replaced", async (t) => {
  const { readDaemon, startOld, writeOldDaemonJson, urlOnly } = await setup(t)
  const old = await startOld({ ignoreTerm: true })
  await writeOldDaemonJson(old.child.pid, old.port, { cliVersion: "1.5.3", packageRoot: "/old/prefix/lib/node_modules/@gabrielahn/gtfs-viz-cli" })
  const first = await urlOnly()
  assert.deepEqual(await old.exited, { code: null, signal: "SIGKILL" })
  assert.match(first.result.stderr, /Stopped the dashboard daemon from version 1\.5\.3/)
  const started = await readDaemon()

  // Same version and package: reused as before.
  const again = await urlOnly()
  assert.equal(again.port, first.port)
  assert.equal(again.result.stderr, "")
  assert.equal((await readDaemon()).pid, started.pid)

  // The real daemon, recorded as another version (an in-place upgrade): replaced.
  const record = await readDaemon()
  await writeOldDaemonJson(record.pid, record.port, { sessionId: record.sessionId, cliVersion: "1.6.0-old", packageRoot: record.packageRoot })
  const replaced = await urlOnly()
  assert.notEqual(replaced.port, first.port)
  assert.match(replaced.result.stderr, new RegExp(`Stopped the dashboard daemon from version 1\\.6\\.0-old \\(pid ${record.pid}\\)`))
  assert.equal(alive(record.pid), false)
  assert.equal((await readDaemon()).cliVersion, pkg.version)
})

test("a live pid in daemon.json that is not a daemon on the recorded port is never signalled", async (t) => {
  const { cliRun, readDaemon, startOld, writeOldDaemonJson, urlOnly } = await setup(t)
  // A process that is not a daemon (its command line has no `__daemon__`), recorded with its own port.
  const other = await startOld({ daemonArg: "--not-a-daemon" })
  await writeOldDaemonJson(other.child.pid, other.port)
  const first = await urlOnly()
  assert.doesNotMatch(first.result.stderr, /Stopped/)
  assert.notEqual(first.port, other.port)
  assert.ok(alive(other.child.pid), "left running")
  assert.equal((await readDaemon()).cliVersion, pkg.version)
  assert.equal((await cliRun("stop")).status, 0)

  // A daemon-looking process recorded with a port it does not listen on: also left alone.
  const daemonLike = await startOld()
  await writeOldDaemonJson(daemonLike.child.pid, other.port)
  const second = await urlOnly()
  assert.doesNotMatch(second.result.stderr, /Stopped/)
  assert.ok(alive(daemonLike.child.pid), "left running")
  assert.ok(alive(other.child.pid), "left running")
  assert.equal((await readDaemon()).cliVersion, pkg.version)
})

test("the same version from another install is reused while that install still holds it", async (t) => {
  // Both packages installed separately (the documented layout) give two gtfs-tools copies of one version.
  // Switching between `gtfs-tools` and `gtfs-viz` must not restart the daemon each time.
  const { readDaemon, urlOnly, writeOldDaemonJson } = await setup(t)
  const first = await urlOnly()
  const record = await readDaemon()
  const otherInstall = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-other-install-"))
  t.after(() => rm(otherInstall, { recursive: true, force: true }))
  await writeFile(path.join(otherInstall, "package.json"), JSON.stringify({ name: "@gabrielahn/gtfs-tools", version: pkg.version }))
  await mkdir(path.join(otherInstall, "dashboard"))
  await writeFile(path.join(otherInstall, "dashboard", "index.html"), "<!doctype html>")
  await writeFile(path.join(otherInstall, "dashboard", "dashboard-manifest.json"), "{}")
  await writeOldDaemonJson(record.pid, record.port, { sessionId: record.sessionId, cliVersion: pkg.version, packageRoot: otherInstall })
  const again = await urlOnly()
  assert.equal(again.port, first.port, "reused")
  assert.equal(again.result.stderr, "")
  assert.equal((await readDaemon()).pid, record.pid)

  // Same version, but that install's dashboard/ is gone (review 2, L8): replaced.
  await rm(path.join(otherInstall, "dashboard"), { recursive: true })
  await writeOldDaemonJson(record.pid, record.port, { sessionId: record.sessionId, cliVersion: pkg.version, packageRoot: otherInstall })
  const noDashboard = await urlOnly()
  assert.notEqual(noDashboard.port, first.port)
  assert.equal(alive(record.pid), false)
  const second = await readDaemon()
  await mkdir(path.join(otherInstall, "dashboard"))
  await writeFile(path.join(otherInstall, "dashboard", "index.html"), "<!doctype html>")
  await writeFile(path.join(otherInstall, "dashboard", "dashboard-manifest.json"), "{}")

  // That install was upgraded or removed: its daemon serves files that may be gone, so it is replaced.
  await writeFile(path.join(otherInstall, "package.json"), JSON.stringify({ name: "@gabrielahn/gtfs-tools", version: "9.9.9" }))
  await writeOldDaemonJson(second.pid, second.port, { sessionId: second.sessionId, cliVersion: pkg.version, packageRoot: otherInstall })
  const replaced = await urlOnly()
  assert.notEqual(replaced.port, second.port)
  assert.match(replaced.result.stderr, /Stopped the dashboard daemon/)
  assert.equal(alive(second.pid), false)
  assert.equal((await readDaemon()).packageRoot, root)
})

test("stop never signals a recorded pid that is not the daemon (review 2, L10)", async (t) => {
  const { cliRun, startOld, writeOldDaemonJson } = await setup(t)
  const other = await startOld({ daemonArg: "--not-a-daemon" })
  await writeOldDaemonJson(other.child.pid, other.port, { cliVersion: pkg.version, packageRoot: root })
  const result = await cliRun("stop")
  assert.equal(result.status, 0, result.stderr)
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.ok(alive(other.child.pid), "a non-daemon process is left running")

  // The real daemon is still stopped.
  const real = await setup(t)
  await real.urlOnly()
  const daemon = await real.readDaemon()
  assert.ok(alive(daemon.pid))
  assert.equal((await real.cliRun("stop")).status, 0)
  for (let i = 0; i < 50 && alive(daemon.pid); i += 1) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(alive(daemon.pid), false, "the verified daemon is stopped")
})
