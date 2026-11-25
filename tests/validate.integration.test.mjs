// `gtfs-tools validate` with a real DuckDB CLI and gtfs extension (1.1.0 or later, which has
// PRAGMA gtfs_validate). Skipped unless DUCKDB_BIN and GTFS_EXTENSION are set; the extension is
// served from a loopback repository through GTFS_EXTENSION_REPOSITORY, as in
// remote-import.integration.test.mjs.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createReadStream } from "node:fs"
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { gzipSync } from "node:zlib"
import { build } from "esbuild"

const realDuckDb = process.env.DUCKDB_BIN
const extensionFile = process.env.GTFS_EXTENSION
const dependencyCache = process.env.GTFS_DEPENDENCY_CACHE
const skip =
  realDuckDb && extensionFile
    ? false
    : "Set DUCKDB_BIN and GTFS_EXTENSION (gtfs 1.1.0 or later; GTFS_DEPENDENCY_CACHE holding spatial) to run"

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`

// A tiny feed without shapes.txt, so the validator must report missing_recommended_file for it.
const fixtureFiles = {
  "stops.txt": [
    "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
    "STA,Central Station,40.0,-73.0,1,",
    "P1,Central Platform 1,40.0001,-73.0001,0,STA",
    "S3,Elm Street,40.01,-73.01,0,",
  ],
  "routes.txt": ["route_id,route_short_name,route_long_name,route_type", "R1,1,Main Line,3"],
  "trips.txt": ["route_id,service_id,trip_id", "R1,WK,T1"],
  "stop_times.txt": [
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
    "T1,08:00:00,08:00:00,P1,1",
    "T1,08:10:00,08:10:00,S3,2",
  ],
  "calendar.txt": [
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
    "WK,1,1,1,1,1,0,0,20260101,20261231",
  ],
}

const startRepository = async (repositoryRoot) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    if (!url.pathname.startsWith("/repo/")) {
      res.writeHead(404)
      res.end()
      return
    }
    const file = path.join(repositoryRoot, decodeURIComponent(url.pathname.slice("/repo/".length)))
    stat(file).then(
      (info) => {
        res.writeHead(200, { "content-length": info.size })
        if (req.method === "HEAD") res.end()
        else createReadStream(file).pipe(res)
      },
      () => {
        res.writeHead(404)
        res.end()
      },
    )
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return server
}

test("gtfs-tools validate reports missing_recommended_file for a feed without shapes.txt", { skip, timeout: 600_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-validate-integration-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = path.join(root, "home")
  const tmp = path.join(root, "t")
  const extensions = path.join(root, "extensions")
  const packageRoot = path.join(root, "pkg")
  const feed = path.join(root, "feed")
  for (const directory of [home, tmp, extensions, feed, path.join(packageRoot, "dist")]) await mkdir(directory, { recursive: true })

  for (const [name, lines] of Object.entries(fixtureFiles)) await writeFile(path.join(feed, name), lines.join("\n") + "\n")
  const zipPath = path.join(root, "sample.zip")
  const zipped = await run("zip", ["-j", "-q", zipPath, ...Object.keys(fixtureFiles).map((name) => path.join(feed, name))])
  assert.equal(zipped.code, 0, zipped.stderr)

  await build({
    entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
    outfile: path.join(packageRoot, "dist", "index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
  })
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@gabrielahn/gtfs-tools", version: "0.0.0-test", type: "module" }))
  const cli = path.join(packageRoot, "dist", "index.js")

  // DuckDB wrapper: unsigned test artifact, isolated extension directories.
  const directories = [extensions, ...(dependencyCache ? [dependencyCache] : [])].map(sqlString).join(", ")
  const wrapper = path.join(root, "duckdb")
  await writeFile(wrapper, `#!/bin/sh\nexec ${JSON.stringify(realDuckDb)} -unsigned -cmd ${JSON.stringify(`SET extension_directories=[${directories}];`)} "$@"\n`)
  await chmod(wrapper, 0o755)

  const baseEnv = { ...process.env, HOME: home, TMPDIR: tmp, DUCKDB_BIN: wrapper, GTFS_VIZ_DUCKDB_THREADS: "1" }
  delete baseEnv.AI_AGENT
  delete baseEnv.GTFS_EXTENSION_REPOSITORY

  const engine = await run(wrapper, ["-json", ":memory:", "-c", "SELECT version() AS version, (SELECT platform FROM pragma_platform()) AS platform"], { env: baseEnv })
  assert.equal(engine.code, 0, engine.stderr)
  const [{ version, platform }] = JSON.parse(engine.stdout)
  // INSTALL only looks in the first extension directory, so link cached dependencies there.
  if (dependencyCache) {
    const cached = path.join(dependencyCache, version, platform)
    const target = path.join(extensions, version, platform)
    await mkdir(target, { recursive: true })
    for (const name of await readdir(cached).catch(() => [])) {
      if (!/^(spatial|httpfs|aws)\.duckdb_extension(\.info)?$/.test(name)) continue
      await link(path.join(cached, name), path.join(target, name)).catch(() => copyFile(path.join(cached, name), path.join(target, name)))
    }
  }
  const repositoryRoot = path.join(root, "repository")
  await mkdir(path.join(repositoryRoot, version, platform), { recursive: true })
  await writeFile(path.join(repositoryRoot, version, platform, "gtfs.duckdb_extension.gz"), gzipSync(await readFile(extensionFile)))
  const server = await startRepository(repositoryRoot)
  t.after(() => new Promise((resolve) => server.close(() => resolve())))
  const env = { ...baseEnv, GTFS_EXTENSION_REPOSITORY: `http://127.0.0.1:${server.address().port}/repo` }

  for (const source of [zipPath, feed]) {
    const result = await run(process.execPath, [cli, "validate", source, "--date", "2026-03-02", "--format", "json"], { env, cwd: root })
    assert.notEqual(result.code, 2, `${source}: validation could not run\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.validator, "gtfs DuckDB extension")
    assert.equal(report.summary.dateForValidation, "2026-03-02")
    assert.equal(report.summary.gtfsInput, path.basename(source))
    const missing = report.notices.find((notice) => notice.code === "missing_recommended_file")
    assert.ok(missing, `no missing_recommended_file in ${result.stdout}`)
    assert.equal(missing.severity, "WARNING")
    assert.ok(missing.sampleNotices.some((notice) => notice.filename === "shapes.txt"), JSON.stringify(missing))
    assert.equal(result.code, report.summary.counts.errors > 0 ? 1 : 0)
    assert.equal(
      report.summary.counts.errors,
      report.notices.filter((notice) => notice.severity === "ERROR").reduce((sum, notice) => sum + notice.totalNotices, 0),
    )
  }

  // The table and csv formats run the same validation.
  const table = await run(process.execPath, [cli, "validate", zipPath, "--date", "2026-03-02"], { env, cwd: root })
  assert.notEqual(table.code, 2, table.stderr)
  assert.match(table.stdout, /missing_recommended_file/)
  const csv = await run(process.execPath, [cli, "validate", zipPath, "--date", "2026-03-02", "--format", "csv"], { env, cwd: root })
  assert.notEqual(csv.code, 2, csv.stderr)
  assert.ok(csv.stdout.startsWith("code,severity,filename,csv_row_number,notice\r\n"), csv.stdout)
  assert.match(csv.stdout, /\r\nmissing_recommended_file,WARNING,[^\r\n]*shapes\.txt/)

  // Nothing is left behind: no temporary directory, no dataset.
  assert.deepEqual(await readdir(tmp), [])
  assert.equal(await readdir(path.join(home, ".gtfs-viz-cli", "current")).catch((error) => error.code), "ENOENT")
})
