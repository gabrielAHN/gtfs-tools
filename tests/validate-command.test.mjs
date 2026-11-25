// `gtfs-tools validate` with a fake DuckDB: usage, --date, sources (zip, directory, remote), the PRAGMA it
// runs, the three output formats, exit codes, cleanup of the private temporary directory and the guidance
// for an extension without gtfs_validate. The real extension is exercised by validate.integration.test.mjs.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { build } from "esbuild"

const USAGE = "gtfs-tools validate <feed.zip|directory|https://…|s3://…|r2://…>"

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

// A fake DuckDB CLI. It appends one JSON line per run to FAKE_DUCKDB_LOG with its argv, its stdin and,
// when the SQL holds a gtfs_validate PRAGMA, the files of the directory it names (read while it runs).
// Then it prints FAKE_DUCKDB_STDOUT / FAKE_DUCKDB_STDERR (file contents) and exits FAKE_DUCKDB_EXIT.
const FAKE_DUCKDB = `#!/usr/bin/env node
import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs"
const argv = process.argv.slice(2)
let stdin = ""
try { stdin = readFileSync(0, "utf8") } catch {}
const sql = argv[argv.indexOf("-c") + 1] ?? ""
const match = /gtfs_validate\\('((?:[^']|'')*)'/.exec(sql)
const directory = match ? match[1].replaceAll("''", "'") : undefined
let files
let mode
if (directory) {
  try {
    files = Object.fromEntries(readdirSync(directory).sort().map((name) => [name, readFileSync(directory + "/" + name, "utf8")]))
    mode = statSync(directory).mode & 0o777
  } catch (error) { files = String(error) }
}
appendFileSync(process.env.FAKE_DUCKDB_LOG, JSON.stringify({ argv, stdin, directory, files, mode, pid: process.pid }) + "\\n")
// FAKE_DUCKDB_HANG: run until killed, as a long validation would.
if (process.env.FAKE_DUCKDB_HANG) setInterval(() => {}, 1000)
else {
const read = (name) => (process.env[name] ? readFileSync(process.env[name], "utf8") : "")
process.stdout.write(read("FAKE_DUCKDB_STDOUT"))
process.stderr.write(read("FAKE_DUCKDB_STDERR"))
// Not process.exit(): it can cut a large write to a pipe short.
process.exitCode = Number(process.env.FAKE_DUCKDB_EXIT || 0)
}
`

let bundlePromise
// One bundle per test file run.
const bundle = () => {
  bundlePromise ??= (async () => {
    const packageRoot = path.resolve(await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-validate-bundle-")))
    await mkdir(path.join(packageRoot, "dist"), { recursive: true })
    await build({
      entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
      outfile: path.join(packageRoot, "dist", "index.js"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node18",
    })
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@gabrielahn/gtfs-tools", version: "0.0.0-test", type: "module" }))
    return packageRoot
  })()
  return bundlePromise
}
test.after(async () => {
  if (bundlePromise) await rm(await bundlePromise, { recursive: true, force: true })
})

const setup = async (t) => {
  const packageRoot = await bundle()
  const root = path.resolve(await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-validate-command-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = path.join(root, "home")
  const tmp = path.join(root, "t")
  await mkdir(home, { recursive: true })
  await mkdir(tmp)
  const fake = path.join(root, "fake-duckdb.mjs")
  await writeFile(fake, FAKE_DUCKDB)
  await chmod(fake, 0o755)
  const log = path.join(root, "duckdb-log.jsonl")
  const stdoutFile = path.join(root, "duckdb-stdout.txt")
  const stderrFile = path.join(root, "duckdb-stderr.txt")
  const env = { ...process.env, HOME: home, TMPDIR: tmp, DUCKDB_BIN: fake, FAKE_DUCKDB_LOG: log }
  delete env.AI_AGENT
  delete env.GTFS_EXTENSION_REPOSITORY
  // A trailing object argument overrides environment variables for that run.
  const cli = (...args) => {
    const overrides = typeof args.at(-1) === "object" ? args.pop() : {}
    return run(process.execPath, [path.join(packageRoot, "dist", "index.js"), ...args], { env: { ...env, ...overrides }, cwd: root })
  }
  // What the fake DuckDB prints: the summary array, then the notices array (as `-json` does).
  const respond = async ({ summary = [], notices = [], stdout, stderr = "", exit = 0 } = {}) => {
    await writeFile(stdoutFile, stdout ?? `${JSON.stringify(summary)}\n${JSON.stringify(notices)}\n`)
    await writeFile(stderrFile, stderr)
    env.FAKE_DUCKDB_STDOUT = stdoutFile
    env.FAKE_DUCKDB_STDERR = stderrFile
    env.FAKE_DUCKDB_EXIT = String(exit)
  }
  const invocations = async () =>
    (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  // The CLI as a child process the test can signal; `exited` resolves to { code, signal }.
  const start = (...args) => {
    const child = spawn(process.execPath, [path.join(packageRoot, "dist", "index.js"), ...args], { env: { ...env, FAKE_DUCKDB_HANG: "1" }, cwd: root, stdio: "ignore" })
    const exited = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })))
    return { child, exited }
  }
  return { root, home, tmp, cli, start, respond, invocations, dataRoot: path.join(home, ".gtfs-viz-cli") }
}

const SUMMARY = [
  { severity: "ERROR", code: "foreign_key_violation", total_notices: 2 },
  { severity: "ERROR", code: "missing_required_field", total_notices: 1 },
  { severity: "WARNING", code: "missing_recommended_file", total_notices: 1 },
  { severity: "INFO", code: "unknown_column", total_notices: 3 },
]
const notice = (code, severity, filename, csvRowNumber, extra = {}) => ({
  code,
  severity,
  filename,
  csv_row_number: csvRowNumber,
  notice: JSON.stringify({ ...(csvRowNumber === null ? {} : { csvRowNumber }), ...(filename === null ? {} : { filename }), ...extra }),
})
// Deliberately not in the report's order: the CLI orders each code's notices by filename, then row.
const NOTICES = [
  notice("unknown_column", "INFO", "trips.txt", 1, { fieldName: "b" }),
  notice("foreign_key_violation", "ERROR", "trips.txt", 3, { fieldName: "route_id", fieldValue: "R9", childFilename: "trips.txt" }),
  notice("unknown_column", "INFO", "stops.txt", 1, { fieldName: "z" }),
  notice("foreign_key_violation", "ERROR", "stop_times.txt", 12, { fieldName: "stop_id", fieldValue: "S9" }),
  notice("missing_required_field", "ERROR", "stops.txt", 4, { fieldName: "stop_name" }),
  notice("missing_recommended_file", "WARNING", "shapes.txt", null),
  notice("unknown_column", "INFO", "routes.txt", 1, { fieldName: "a" }),
]

const writeFeedDirectory = async (directory) => {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "stops.txt"), "stop_id,stop_name,stop_lat,stop_lon\nS1,One,40.0,-73.0\n")
  await writeFile(path.join(directory, "routes.txt"), "route_id,route_short_name,route_long_name,route_type\nR1,1,Main,3\n")
}

const pragmaSql = (invocation) => invocation.argv[invocation.argv.indexOf("-c") + 1]

test("a directory source runs gtfs_validate on it in one in-memory DuckDB with the gtfs extension", async (t) => {
  const env = await setup(t)
  // A quote in the path must reach the PRAGMA as a correctly quoted SQL string.
  const feed = path.join(env.root, "it's feed")
  await writeFeedDirectory(feed)
  await env.respond({ summary: SUMMARY, notices: NOTICES })
  const result = await env.cli("validate", feed, "--date", "2026-03-01")
  assert.equal(result.code, 1, result.stderr)
  const invocations = await env.invocations()
  assert.equal(invocations.length, 1, "one DuckDB process")
  const [{ argv, files }] = invocations
  assert.deepEqual(Object.keys(files), ["routes.txt", "stops.txt"], "the directory itself is validated")
  assert.equal(invocations[0].directory, feed)
  assert.deepEqual(argv.slice(argv.indexOf("-c") - 1, argv.indexOf("-c")), [":memory:"])
  assert.ok(argv.includes("-json"), argv.join(" "))
  assert.ok(argv.includes("-bail"), argv.join(" "))
  const cmds = argv.flatMap((value, index) => (argv[index - 1] === "-cmd" ? [value] : []))
  assert.deepEqual(cmds, ["INSTALL gtfs FROM community", "LOAD gtfs"])
  const sql = pragmaSql(invocations[0])
  assert.ok(sql.includes(`PRAGMA gtfs_validate('${feed.replaceAll("'", "''")}', '2026-03-01');`), sql)
  // The table prints only the summary, so it does not fetch the notices; json and csv do, after the PRAGMA.
  assert.doesNotMatch(sql, /gtfs_validation_notices/)
  for (const format of ["json", "csv"]) {
    await env.cli("validate", feed, "--date", "2026-03-01", "--format", format)
    const formatSql = pragmaSql((await env.invocations()).at(-1))
    assert.match(formatSql, /SELECT code, severity, filename, csv_row_number, notice(::VARCHAR AS notice)? FROM gtfs_validation_notices/)
    assert.ok(formatSql.indexOf("PRAGMA gtfs_validate") < formatSql.indexOf("FROM gtfs_validation_notices"), formatSql)
  }
})

test("GTFS_EXTENSION_REPOSITORY selects where gtfs installs from", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  await env.respond()
  const result = await env.cli("validate", feed, { GTFS_EXTENSION_REPOSITORY: "http://127.0.0.1:9/repo" })
  assert.equal(result.code, 0, result.stderr)
  const [{ argv }] = await env.invocations()
  const cmds = argv.flatMap((value, index) => (argv[index - 1] === "-cmd" ? [value] : []))
  assert.deepEqual(cmds, ["INSTALL gtfs FROM 'http://127.0.0.1:9/repo'", "LOAD gtfs"])
})

test("the table format names the source and date, lists the summary and counts notices", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  await env.respond({ summary: SUMMARY, notices: NOTICES })
  const result = await env.cli("validate", feed, "--date", "2026-03-01")
  assert.equal(result.code, 1, result.stderr)
  const lines = result.stdout.trimEnd().split("\n")
  assert.equal(lines[0], "Validated feed for 2026-03-01 with the gtfs DuckDB extension")
  assert.deepEqual(lines.slice(1, -1).filter((line) => line.trim()).map((line) => line.trim().split(/\s+/)), [
    ["severity", "code", "notices"],
    ["─".repeat("severity".length), "─".repeat("missing_recommended_file".length), "─".repeat("notices".length)],
    ["ERROR", "foreign_key_violation", "2"],
    ["ERROR", "missing_required_field", "1"],
    ["WARNING", "missing_recommended_file", "1"],
    ["INFO", "unknown_column", "3"],
  ])
  assert.equal(lines.at(-1), "3 errors, 1 warning, 3 infos")
})

test("warnings and infos alone exit 0", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  await env.respond({ summary: SUMMARY.filter((row) => row.severity !== "ERROR"), notices: NOTICES.filter((row) => row.severity !== "ERROR") })
  const result = await env.cli("validate", feed, "--date", "2026-03-01")
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout.trimEnd().split("\n").at(-1), "0 errors, 1 warning, 3 infos")
})

test("a feed with no notices exits 0 and names the files the rules cover", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  await env.respond()
  const result = await env.cli("validate", feed, "--date", "2026-03-01")
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /passed the validated rules/)
  for (const file of ["stops.txt", "pathways.txt", "routes.txt", "trips.txt", "stop_times.txt", "shapes.txt", "calendar.txt", "calendar_dates.txt"]) {
    assert.ok(result.stdout.includes(file), `${file} missing from:\n${result.stdout}`)
  }
  assert.doesNotMatch(result.stdout, /severity\s+code/)
  assert.equal(result.stdout.trimEnd().split("\n").at(-1), "0 errors, 0 warnings, 0 infos")
})

test("--date must be a real YYYY-MM-DD date and defaults to today in local time", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  await env.respond()
  for (const date of ["2026-02-30", "2026-13-01", "2026-1-5", "20260105", "yesterday", "2026-02-29", "0000-00-00"]) {
    const result = await env.cli("validate", feed, "--date", date)
    assert.equal(result.code, 2, `${date}: ${result.stderr}`)
    assert.match(result.stderr, /--date/, date)
  }
  const missing = await env.cli("validate", feed, "--date")
  assert.equal(missing.code, 2, missing.stderr)
  assert.deepEqual(await env.invocations(), [], "no DuckDB run for a bad date")
  const leap = await env.cli("validate", feed, "--date", "2028-02-29")
  assert.equal(leap.code, 0, leap.stderr)
  assert.ok(pragmaSql((await env.invocations())[0]).includes("', '2028-02-29');"))
  // The default is the local date: UTC-12 and UTC+14 are 26 hours apart, so they never share a date
  // and at least one of them differs from the UTC date.
  for (const [zone, offsetHours] of [["Etc/GMT+12", -12], ["Etc/GMT-14", 14]]) {
    const localDate = () => new Date(Date.now() + offsetHours * 3600 * 1000).toISOString().slice(0, 10)
    const before = localDate()
    const local = await env.cli("validate", feed, { TZ: zone })
    const after = localDate()
    assert.equal(local.code, 0, local.stderr)
    const sql = pragmaSql((await env.invocations()).at(-1))
    const date = /, '(\d{4}-\d{2}-\d{2})'\);/.exec(sql)?.[1]
    assert.ok(date === before || date === after, `${zone}: ${sql}`)
    assert.ok(local.stdout.startsWith(`Validated feed for ${date} `), local.stdout)
  }
})

test("--format json prints one report.json-shaped document with every notice of each code", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  // More notices than MobilityData's sample cap of 100 per code: none are dropped.
  const many = Array.from({ length: 120 }, (_, index) => notice("unknown_column", "INFO", "stops.txt", 120 - index, { fieldName: `c${index}` }))
  await env.respond({ summary: [...SUMMARY.slice(0, 3), { severity: "INFO", code: "unknown_column", total_notices: 123 }], notices: [...NOTICES, ...many] })
  const result = await env.cli("validate", feed, "--date", "2026-03-01", "--format", "json")
  assert.equal(result.code, 1, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(report), ["summary", "notices"])
  assert.deepEqual(report.summary, {
    validator: "gtfs DuckDB extension",
    dateForValidation: "2026-03-01",
    gtfsInput: "feed",
    counts: { errors: 3, warnings: 1, infos: 123 },
  })
  assert.deepEqual(report.notices.map(({ code, severity, totalNotices }) => [code, severity, totalNotices]), [
    ["foreign_key_violation", "ERROR", 2],
    ["missing_required_field", "ERROR", 1],
    ["missing_recommended_file", "WARNING", 1],
    ["unknown_column", "INFO", 123],
  ])
  assert.deepEqual(report.notices[0].sampleNotices, [
    { csvRowNumber: 12, filename: "stop_times.txt", fieldName: "stop_id", fieldValue: "S9" },
    { csvRowNumber: 3, filename: "trips.txt", fieldName: "route_id", fieldValue: "R9", childFilename: "trips.txt" },
  ])
  assert.deepEqual(report.notices[2].sampleNotices, [{ filename: "shapes.txt" }])
  const unknown = report.notices[3].sampleNotices
  assert.equal(unknown.length, 123)
  // By filename, then csv row number (numerically).
  assert.deepEqual(unknown.slice(0, 3).map((n) => [n.filename, n.csvRowNumber]), [["routes.txt", 1], ["stops.txt", 1], ["stops.txt", 1]])
  const stops = unknown.filter((n) => n.filename === "stops.txt").map((n) => n.csvRowNumber)
  assert.deepEqual(stops, [...stops].sort((a, b) => a - b))
  assert.equal(unknown.at(-1).filename, "trips.txt")
})

test("--format csv prints one RFC 4180 row per notice", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  await env.respond({
    summary: [{ severity: "ERROR", code: "foreign_key_violation", total_notices: 2 }, { severity: "WARNING", code: "missing_recommended_file", total_notices: 1 }],
    notices: [
      notice("foreign_key_violation", "ERROR", "trips.txt", 3, { fieldValue: 'say "hi", then\nleave' }),
      notice("missing_recommended_file", "WARNING", null, null),
      notice("foreign_key_violation", "ERROR", "stops.txt", 10),
    ],
  })
  const result = await env.cli("validate", feed, "--format", "csv")
  assert.equal(result.code, 1, result.stderr)
  const quoted = (text) => `"${text.replaceAll('"', '""')}"`
  assert.equal(
    result.stdout,
    [
      "code,severity,filename,csv_row_number,notice",
      `foreign_key_violation,ERROR,stops.txt,10,${quoted('{"csvRowNumber":10,"filename":"stops.txt"}')}`,
      `foreign_key_violation,ERROR,trips.txt,3,${quoted(JSON.stringify({ csvRowNumber: 3, filename: "trips.txt", fieldValue: 'say "hi", then\nleave' }))}`,
      "missing_recommended_file,WARNING,,,{}",
      "",
    ].join("\r\n"),
  )
})

test("--format csv with no notices prints only the header and exits 0", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  await env.respond()
  const result = await env.cli("validate", feed, "--format", "csv")
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout, "code,severity,filename,csv_row_number,notice\r\n")
  const json = await env.cli("validate", feed, "--format", "json", "--date", "2026-03-01")
  assert.equal(json.code, 0, json.stderr)
  assert.deepEqual(JSON.parse(json.stdout), {
    summary: { validator: "gtfs DuckDB extension", dateForValidation: "2026-03-01", gtfsInput: "feed", counts: { errors: 0, warnings: 0, infos: 0 } },
    notices: [],
  })
})

test("an extension without gtfs_validate exits 2 with update guidance and never updates it itself", async (t) => {
  const env = await setup(t)
  const zipPath = await makeZip(env.root, "feed.zip", { "stops.txt": "stop_id\nS1\n" })
  await env.respond({ stdout: "", stderr: 'Catalog Error: Pragma Function with name gtfs_validate does not exist!\nDid you mean "gtfs_import"?\n', exit: 1 })
  const community = await env.cli("validate", zipPath)
  assert.equal(community.code, 2, community.stderr)
  assert.equal(community.stdout, "")
  assert.ok(community.stderr.startsWith("Validation failed: feed.zip\n"), community.stderr)
  assert.match(community.stderr, /gtfs extension 1\.1\.0 or later/)
  assert.ok(community.stderr.includes('duckdb -c "UPDATE EXTENSIONS (gtfs)"'), community.stderr)
  assert.match(community.stderr, /never run automatically/)
  const custom = await env.cli("validate", zipPath, { GTFS_EXTENSION_REPOSITORY: "http://127.0.0.1:9/repo" })
  assert.equal(custom.code, 2, custom.stderr)
  assert.match(custom.stderr, /gtfs extension 1\.1\.0 or later/)
  assert.ok(custom.stderr.includes("http://127.0.0.1:9/repo"), custom.stderr)
  const invocations = await env.invocations()
  assert.equal(invocations.length, 2, "one DuckDB run per validation, nothing more")
  for (const { argv } of invocations) assert.doesNotMatch(argv.join("\n"), /UPDATE EXTENSIONS|FORCE INSTALL/)
  assert.deepEqual(await readdir(env.tmp), [])
})

const VALIDATED_FILES = ["stops.txt", "pathways.txt", "routes.txt", "trips.txt", "stop_times.txt", "shapes.txt", "calendar.txt", "calendar_dates.txt"]

// A zip holding `entries` ({ "<path in zip>": "<content>" }).
const makeZip = async (root, name, entries) => {
  const staging = await mkdtemp(path.join(root, "zip-staging-"))
  for (const [entry, content] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(staging, entry)), { recursive: true })
    await writeFile(path.join(staging, entry), content)
  }
  const zipPath = path.join(root, name)
  const zipped = await run("zip", ["-q", "-r", zipPath, ...Object.keys(entries)], { cwd: staging })
  assert.equal(zipped.code, 0, zipped.stderr)
  await rm(staging, { recursive: true, force: true })
  return zipPath
}

test("a zip is validated from a private temporary directory holding only the 8 files, removed afterwards", async (t) => {
  const env = await setup(t)
  const entries = Object.fromEntries(VALIDATED_FILES.map((file) => [file, `${file} content\n`]))
  Object.assign(entries, { "agency.txt": "agency\n", "feed_info.txt": "feed\n", "notes/readme.md": "x\n", "stops.txt.bak": "old\n" })
  const zipPath = await makeZip(env.root, "my feed.zip", entries)
  await env.respond({ summary: SUMMARY, notices: NOTICES })
  const result = await env.cli("validate", zipPath, "--date", "2026-03-01")
  assert.equal(result.code, 1, result.stderr)
  assert.equal(result.stderr, "")
  assert.ok(result.stdout.startsWith("Validated my feed.zip for 2026-03-01 "), result.stdout)
  const [{ directory, files, mode }] = await env.invocations()
  assert.equal(path.dirname(directory), env.tmp, "a new directory in the system temporary directory")
  assert.equal(mode, 0o700, "private")
  assert.deepEqual(Object.keys(files).sort(), [...VALIDATED_FILES].sort())
  for (const file of VALIDATED_FILES) assert.equal(files[file], `${file} content\n`, file)
  assert.deepEqual(await readdir(env.tmp), [], "the temporary directory is removed")
  assert.equal(await readdir(path.join(env.dataRoot, "current")).catch((error) => error.code), "ENOENT", "no current dataset")
})

// A zip written byte by byte (stored, not compressed), for entry names the zip tool will not write:
// duplicates, "../" and "/" paths. `entries` is a list of [name, content].
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes) => {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const writeRawZip = async (root, name, entries) => {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [entry, content] of entries) {
    const nameBytes = Buffer.from(entry)
    const data = Buffer.from(content)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x21, 12)
    header.writeUInt32LE(crc32(data), 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc32(data), 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(header, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += header.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  const zipPath = path.join(root, name)
  await writeFile(zipPath, Buffer.concat([...locals, directory, end]))
  return zipPath
}

test("a zip is read as the official validator reads it: root entries only, names compared without case", async (t) => {
  const env = await setup(t)
  const zipPath = await writeRawZip(env.root, "layout.zip", [
    ["old/stops.txt", "decoy in a folder\n"],
    ["stops.txt", "root stops\n"],
    ["Routes.txt", "routes in another case\n"],
    ["../trips.txt", "outside\n"],
    ["/abs/stop_times.txt", "absolute\n"],
    ["*/shapes.txt", "a wildcard folder\n"],
    ["[a]/calendar.txt", "a pattern folder\n"],
    ["calendar_dates.txt", "root dates\n"],
  ])
  await env.respond()
  const result = await env.cli("validate", zipPath)
  assert.equal(result.code, 1, "invalid_input_files_in_subfolder is an ERROR")
  const [{ files }] = await env.invocations()
  assert.deepEqual(files, { "calendar_dates.txt": "root dates\n", "routes.txt": "routes in another case\n", "stops.txt": "root stops\n" })
  assert.equal(
    result.stderr,
    "Not validated, in a folder of the zip (the official validator reads only its root and reports invalid_input_files_in_subfolder): old/stops.txt, ../trips.txt, /abs/stop_times.txt, */shapes.txt, [a]/calendar.txt\n",
  )
  assert.match(result.stdout, /\nERROR\s+invalid_input_files_in_subfolder\s+1\n/)
  assert.deepEqual(await readdir(env.tmp), [])
})

test("of root entries equal without case, the first in zip order is validated, as the official validator does", async (t) => {
  const env = await setup(t)
  const zipPath = await writeRawZip(env.root, "case.zip", [
    ["Stops.txt", "first\n"],
    ["routes.txt", "routes\n"],
    ["stops.txt", "second\n"],
    ["STOPS.TXT", "third\n"],
  ])
  await env.respond()
  const result = await env.cli("validate", zipPath)
  assert.equal(result.code, 0, result.stderr)
  const [{ files }] = await env.invocations()
  assert.deepEqual(files, { "routes.txt": "routes\n", "stops.txt": "first\n" })
  assert.equal(
    result.stderr,
    "Not validated, an earlier entry has the same name without case (the official validator reads the first): stops.txt, STOPS.TXT\n",
  )
})

test("a GTFS file in a folder of a zip is reported as the official validator's invalid_input_files_in_subfolder ERROR", async (t) => {
  const env = await setup(t)
  const zipPath = await writeRawZip(env.root, "folder.zip", [
    ["stops.txt", "stop_id\nS1\n"],
    ["old/", ""],
    ["old/agency.txt", "agency\n"],
    ["__MACOSX/._stops.txt", "resource fork\n"],
  ])
  await env.respond({ summary: SUMMARY, notices: NOTICES })
  const json = await env.cli("validate", zipPath, "--format", "json")
  assert.equal(json.code, 1, json.stderr)
  const report = JSON.parse(json.stdout)
  assert.deepEqual(
    report.notices.map((entry) => entry.code),
    ["foreign_key_violation", "invalid_input_files_in_subfolder", "missing_required_field", "missing_recommended_file", "unknown_column"],
  )
  assert.deepEqual(report.notices[1], { code: "invalid_input_files_in_subfolder", severity: "ERROR", totalNotices: 1, sampleNotices: [{}] })
  assert.equal(report.summary.counts.errors, 4)
  assert.equal(
    json.stderr,
    "Not validated, in a folder of the zip (the official validator reads only its root and reports invalid_input_files_in_subfolder): old/agency.txt\n",
  )
  const csv = await env.cli("validate", zipPath, "--format", "csv")
  assert.ok(csv.stdout.includes("\r\ninvalid_input_files_in_subfolder,ERROR,,,{}\r\n"), csv.stdout)
  // Only GTFS file names count, compared with case, as in GtfsInput.containsGtfsFileInSubfolder.
  const other = await writeRawZip(env.root, "other.zip", [
    ["stops.txt", "stop_id\nS1\n"],
    ["docs/Stops.txt", "x\n"],
    ["docs/readme.txt", "x\n"],
    ["stops.txt/", ""],
  ])
  await env.respond()
  const clean = await env.cli("validate", other)
  assert.equal(clean.code, 0, clean.stderr)
  assert.equal(clean.stderr, "")
})

test("a directory whose path has *, ? or [ is validated through links, so DuckDB never reads it as a pattern", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed[1]")
  await writeFeedDirectory(feed)
  // DuckDB would read feed[1]/stops.txt as a pattern matching feed1/stops.txt.
  await mkdir(path.join(env.root, "feed1"))
  await writeFile(path.join(env.root, "feed1", "stops.txt"), "stop_id\nDECOY\n")
  await env.respond()
  const result = await env.cli("validate", feed)
  assert.equal(result.code, 0, result.stderr)
  const [{ directory, files }] = await env.invocations()
  assert.equal(path.dirname(directory), env.tmp)
  assert.equal(files["stops.txt"], "stop_id,stop_name,stop_lat,stop_lon\nS1,One,40.0,-73.0\n")
  assert.deepEqual(await readdir(env.tmp), [])
  // A temporary directory with such a character is refused, not validated.
  const patternTmp = path.join(env.root, "tmp*")
  await mkdir(patternTmp)
  const refused = await env.cli("validate", feed, { TMPDIR: patternTmp })
  assert.equal(refused.code, 2)
  assert.match(refused.stderr, /has \*, \? or \[, which DuckDB reads as a file pattern: set TMPDIR to a directory without them\.\n$/)
  assert.deepEqual(await readdir(patternTmp), [])
  assert.equal((await env.invocations()).length, 1)
})

test("a zip whose path has *, ? or [ is read through a link with a plain name, so unzip never reads it as a pattern", async (t) => {
  const env = await setup(t)
  // unzip reads feed[1].zip as a pattern matching feed1.zip, and feed*.zip and feed?.zip as patterns
  // matching themselves and feed1.zip, which it would read in turn. A \\ only escapes the next character,
  // so feed\\1.zip is read as it is.
  await writeRawZip(env.root, "feed1.zip", [
    ["stops.txt", "stop_id\nDECOY\n"],
    ["routes.txt", "route_id\nDECOY\n"],
  ])
  for (const name of ["feed[1].zip", "feed*.zip", "feed?.zip", "feed\\1.zip"]) {
    const zipPath = await writeRawZip(env.root, name, [["stops.txt", "stop_id\nS1\n"]])
    await env.respond()
    const result = await env.cli("validate", zipPath)
    assert.equal(result.code, 0, `${name}: ${result.stderr}`)
    assert.equal(result.stderr, "", name)
    assert.deepEqual((await env.invocations()).at(-1).files, { "stops.txt": "stop_id\nS1\n" }, name)
    assert.deepEqual(await readdir(env.tmp), [], `${name}: the link's directory is removed`)
    await rm(zipPath)
  }
  // unzip's messages name the zip, never the link.
  const broken = path.join(env.root, "broken[1].zip")
  await writeFile(broken, "not a zip")
  const failed = await env.cli("validate", broken)
  assert.equal(failed.code, 2)
  assert.ok(failed.stderr.includes(broken), failed.stderr)
  assert.ok(!failed.stderr.includes("gtfs-tools-zip-"), failed.stderr)
  assert.deepEqual(await readdir(env.tmp), [])
})

test("an extraction stops past its byte limit, and resolves only once the file is written", async (t) => {
  const root = path.resolve(await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-zip-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  const module = path.join(root, "zip.mjs")
  await build({ entryPoints: [new URL("../src/feed/zip.ts", import.meta.url).pathname], outfile: module, bundle: true, platform: "node", format: "esm", target: "node18" })
  const { extractZipEntry } = await import(module)
  const zipPath = await writeRawZip(root, "big.zip", [["stops.txt", "x".repeat(200000)]])
  const target = path.join(root, "stops.txt")
  assert.equal(await extractZipEntry(zipPath, "stops.txt", target), 200000)
  assert.equal((await readFile(target, "utf8")).length, 200000, "written in full when the promise resolves")
  await assert.rejects(
    extractZipEntry(zipPath, "stops.txt", path.join(root, "capped.txt"), 1000),
    (error) => error.name === "EntryTooLargeError" && error.entry === "stops.txt" && error.maxBytes === 1000,
  )
})

test("an entry whose name has *, ?, [, \\ or a leading - is extracted alone: unzip never reads it as a pattern or option", async (t) => {
  const root = path.resolve(await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-unzip-names-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  const module = path.join(root, "zip.mjs")
  await build({ entryPoints: [new URL("../src/feed/zip.ts", import.meta.url).pathname], outfile: module, bundle: true, platform: "node", format: "esm", target: "node18" })
  const { extractZipEntry, listZipEntries } = await import(module)
  // import reads stops.txt from a folder of the zip too: [a]/stops.txt would be read as a/stops.txt, and
  // */routes.txt as every routes.txt in a folder, one after the other.
  const entries = [
    ["a/stops.txt", "a\n"],
    ["[a]/stops.txt", "bracket\n"],
    ["b/routes.txt", "b\n"],
    ["*/routes.txt", "star\n"],
    ["c/trips.txt", "c\n"],
    ["?/trips.txt", "question\n"],
    ["d\\calendar.txt", "backslash\n"],
    // unzip reads an argument starting with -d as its extraction folder option.
    ["-dx/stops.txt", "dash\n"],
  ]
  const zipPath = await writeRawZip(root, "folders.zip", entries)
  assert.deepEqual(await listZipEntries(zipPath), entries.map(([name]) => name))
  for (const [entry, content] of entries) {
    const target = path.join(root, "out.txt")
    assert.equal(await extractZipEntry(zipPath, entry, target), content.length, entry)
    assert.equal(await readFile(target, "utf8"), content, entry)
  }
})

test("a zip with two entries of the same name exits 2 without running DuckDB", async (t) => {
  const env = await setup(t)
  const zipPath = await writeRawZip(env.root, "dup.zip", [
    ["stops.txt", "stop_id\nS1\n"],
    ["routes.txt", "route_id\nR1\n"],
    ["stops.txt", "stop_id\nS2\n"],
  ])
  await env.respond()
  const result = await env.cli("validate", zipPath)
  assert.equal(result.code, 2)
  assert.equal(result.stderr, "Validation failed: dup.zip\nThe zip has 2 entries named stops.txt: remove the extra ones and validate again.\n")
  assert.deepEqual(await env.invocations(), [])
  assert.deepEqual(await readdir(env.tmp), [])
})

test("a directory whose file names have another case is validated through lowercase links", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await mkdir(feed)
  await writeFile(path.join(feed, "Stops.txt"), "stop_id\nS1\n")
  await writeFile(path.join(feed, "routes.txt"), "route_id\nR1\n")
  await env.respond()
  const result = await env.cli("validate", feed)
  assert.equal(result.code, 0, result.stderr)
  const [{ directory, files }] = await env.invocations()
  assert.equal(path.dirname(directory), env.tmp)
  assert.deepEqual(files, { "routes.txt": "route_id\nR1\n", "stops.txt": "stop_id\nS1\n" })
  assert.deepEqual(await readdir(env.tmp), [], "the links are removed")
  assert.deepEqual((await readdir(feed)).sort(), ["Stops.txt", "routes.txt"], "the feed is untouched")
})

test("a directory path with a control character exits 2 without running DuckDB", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "x\nCOPY (SELECT 42 AS pwned) TO 'pwned.csv';\n--")
  await writeFeedDirectory(feed)
  await env.respond()
  const result = await env.cli("validate", feed)
  assert.equal(result.code, 2)
  assert.equal(
    result.stderr,
    "Validation failed: x\ufffdCOPY (SELECT 42 AS pwned) TO 'pwned.csv';\ufffd--\nThe directory path has a control character, such as a line break: rename it and validate again.\n",
  )
  assert.deepEqual(await env.invocations(), [])
})

test("50,000 notices are read in seconds: DuckDB's output is parsed once", async (t) => {
  const env = await setup(t)
  const count = 50000
  const rows = Array.from({ length: count }, (_, index) =>
    JSON.stringify(notice("foreign_key_violation", "ERROR", "stop_times.txt", index + 2, { fieldName: "stop_id", fieldValue: `S${index}` })),
  )
  // DuckDB 2.0's -json layout: one row per line, the array's brackets on the first and last rows.
  const summary = JSON.stringify([{ severity: "ERROR", code: "foreign_key_violation", total_notices: count }])
  await env.respond({ stdout: `${summary}\n[${rows.join(",\n")}]\n` })
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  const started = Date.now()
  const result = await env.cli("validate", feed, "--format", "csv")
  const elapsed = Date.now() - started
  assert.equal(result.code, 1, result.stderr)
  assert.equal(result.stdout.split("\r\n").length - 2, count, "a header and one row per notice")
  assert.ok(elapsed < 20000, `took ${elapsed} ms`)
})

test("notices that tie on code, file and row are ordered by their JSON text", async (t) => {
  const env = await setup(t)
  const feed = path.join(env.root, "feed")
  await writeFeedDirectory(feed)
  await env.respond({
    summary: [{ severity: "WARNING", code: "stop_too_close_to_non_parent_station", total_notices: 3 }],
    notices: [
      notice("stop_too_close_to_non_parent_station", "WARNING", null, null, { csvRowNumber1: 1320, stopId1: "b" }),
      notice("stop_too_close_to_non_parent_station", "WARNING", null, null, { csvRowNumber1: 507, stopId1: "c" }),
      notice("stop_too_close_to_non_parent_station", "WARNING", null, null, { csvRowNumber1: 1321, stopId1: "a" }),
    ],
  })
  const result = await env.cli("validate", feed, "--format", "json")
  const report = JSON.parse(result.stdout)
  assert.deepEqual(report.notices[0].sampleNotices.map((n) => n.csvRowNumber1), [1320, 1321, 507])
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} during validation kills DuckDB, removes the temporary directory and ends the CLI by the signal`, async (t) => {
    const env = await setup(t)
    const zipPath = await makeZip(env.root, "feed.zip", { "stops.txt": "stop_id\nS1\n" })
    await env.respond()
    const { child, exited } = env.start("validate", zipPath)
    let invocation
    for (let attempt = 0; attempt < 200 && !invocation; attempt++) {
      ;[invocation] = await env.invocations()
      if (!invocation) await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.ok(invocation, "DuckDB never started")
    assert.equal((await readdir(env.tmp)).length, 1, "the temporary directory exists while DuckDB runs")
    child.kill(signal)
    assert.deepEqual(await exited, { code: null, signal })
    assert.deepEqual(await readdir(env.tmp), [])
    // Killed, then reaped once the CLI is gone (allow a moment for the reaping).
    const alive = () => { try { process.kill(invocation.pid, 0); return true } catch { return false } }
    for (let attempt = 0; attempt < 40 && alive(); attempt++) await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(alive(), false, "DuckDB was killed")
  })
}

test("a zip without stops.txt is still validated: the validator reports missing files", async (t) => {
  const env = await setup(t)
  const zipPath = await makeZip(env.root, "nostops.zip", { "routes.txt": "route_id\nR1\n" })
  await env.respond({ summary: [{ severity: "ERROR", code: "missing_required_file", total_notices: 1 }], notices: [notice("missing_required_file", "ERROR", "stops.txt", null)] })
  const result = await env.cli("validate", zipPath, "--date", "2026-03-01")
  assert.equal(result.code, 1, result.stderr)
  assert.match(result.stdout, /missing_required_file/)
  const [{ files }] = await env.invocations()
  assert.deepEqual(Object.keys(files), ["routes.txt"])
  assert.deepEqual(await readdir(env.tmp), [])
})

test("when DuckDB fails, validation exits 2 and still removes the temporary directory", async (t) => {
  const env = await setup(t)
  const zipPath = await makeZip(env.root, "feed.zip", { "stops.txt": "stop_id\nS1\n" })
  await env.respond({ stdout: "", stderr: "IO Error: disk on fire\n", exit: 1 })
  const result = await env.cli("validate", zipPath)
  assert.equal(result.code, 2, result.stderr)
  assert.ok(result.stderr.startsWith("Validation failed: feed.zip\n"), result.stderr)
  assert.match(result.stderr, /disk on fire/)
  assert.equal(result.stdout, "")
  assert.equal((await env.invocations()).length, 1)
  assert.deepEqual(await readdir(env.tmp), [])
})

test("an unreadable local source exits 2 with import's messages, without running DuckDB", async (t) => {
  const env = await setup(t)
  await writeFile(path.join(env.root, "notes.txt"), "not a zip")
  const missing = await env.cli("validate", "missing/feed.zip")
  assert.equal(missing.code, 2)
  assert.equal(missing.stderr, "Validation failed: feed.zip\nGTFS file not found: missing/feed.zip\n")
  const notZip = await env.cli("validate", "notes.txt")
  assert.equal(notZip.code, 2)
  assert.equal(notZip.stderr, "Validation failed: notes.txt\nRequires a .zip file\n")
  await writeFile(path.join(env.root, "broken.zip"), "PK\u0003\u0004 truncated")
  const broken = await env.cli("validate", "broken.zip")
  assert.equal(broken.code, 2)
  assert.ok(broken.stderr.startsWith("Validation failed: broken.zip\n"), broken.stderr)
  assert.deepEqual(await env.invocations(), [])
  assert.deepEqual(await readdir(env.tmp), [])
})

test("a remote http source downloads as import does, is validated, and its download is removed", async (t) => {
  const env = await setup(t)
  const zipPath = await makeZip(env.root, "remote.zip", { "stops.txt": "stop_id\nS1\n", "routes.txt": "route_id\nR1\n", "agency.txt": "a\n" })
  const zipBytes = await readFile(zipPath)
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    if (req.url.startsWith("/feeds/remote.zip")) res.writeHead(200, { "content-type": "application/zip" }).end(zipBytes)
    else res.writeHead(404).end("missing")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  // An existing dataset and daemon record are left exactly as they are.
  const statePath = path.join(env.dataRoot, "current", "state.json")
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, '{"previous":"dataset"}')
  await writeFile(path.join(env.dataRoot, "daemon.json"), '{"pid":0}')
  await env.respond({ summary: SUMMARY, notices: NOTICES })
  const result = await env.cli("validate", `${base}/feeds/remote.zip?sig=querysecret0123`, "--format", "json", "--date", "2026-03-01")
  assert.equal(result.code, 1, result.stderr)
  assert.deepEqual(requests, ["/feeds/remote.zip?sig=querysecret0123"])
  const report = JSON.parse(result.stdout)
  assert.equal(report.summary.gtfsInput, `${base}/feeds/remote.zip`)
  assert.ok(!(result.stdout + result.stderr).includes("querysecret"), "the query string leaked")
  const [{ files, argv }] = await env.invocations()
  assert.deepEqual(Object.keys(files), ["routes.txt", "stops.txt"])
  assert.ok(!argv.join(" ").includes("querysecret"), "the query string reached DuckDB")
  assert.deepEqual(await readdir(path.join(env.dataRoot, "downloads")), [], "the download is removed")
  assert.deepEqual(await readdir(env.tmp), [])
  assert.equal(await readFile(statePath, "utf8"), '{"previous":"dataset"}')
  assert.equal(await readFile(path.join(env.dataRoot, "daemon.json"), "utf8"), '{"pid":0}')
  assert.deepEqual((await readdir(path.join(env.dataRoot, "current"))).sort(), ["state.json"])

  const table = await env.cli("validate", `${base}/feeds/remote.zip?sig=querysecret0123`, "--date", "2026-03-01")
  assert.ok(table.stdout.startsWith(`Validated ${base}/feeds/remote.zip for 2026-03-01 `), table.stdout)

  const missing = await env.cli("validate", `${base}/missing.zip?sig=querysecret0123`)
  assert.equal(missing.code, 2, missing.stderr)
  assert.ok(missing.stderr.startsWith(`Validation failed: ${base}/missing.zip\n`), missing.stderr)
  assert.match(missing.stderr, /HTTP 404/)
  assert.ok(!(missing.stdout + missing.stderr).includes("querysecret"), missing.stderr)
  assert.deepEqual(await readdir(path.join(env.dataRoot, "downloads")), [])
  assert.equal((await env.invocations()).length, 2, "no DuckDB run for a failed download")
})

test("refused remote sources exit 2 with import's refusals and print nothing of the input", async (t) => {
  const env = await setup(t)
  for (const [input, label, expected] of [
    ["http://user:***@127.0.0.1:9/feeds/f.zip?sig=querysecret", "http://…", /embedded credentials/],
    ["gs://bucket/feed.zip", "gs://…", /Unsupported import source scheme/],
    ["s3://bucket/feed.zip?s3_secret_access_key=querysecret", "s3://…", /query string/],
    ["s3://bucket/\u001b[31mINJECTED\nline.zip", "s3://…", /control characters/],
  ]) {
    const result = await env.cli("validate", input)
    assert.equal(result.code, 2, input)
    assert.ok(result.stderr.startsWith(`Validation failed: ${label}\n`), result.stderr)
    assert.match(result.stderr, expected)
    for (const leaked of ["urlpassword", "querysecret", "user:", "\u001b"]) assert.ok(!(result.stdout + result.stderr).includes(leaked), `${leaked}: ${result.stderr}`)
  }
  assert.deepEqual(await env.invocations(), [])
})

test("text from the feed or DuckDB is printed without terminal escape sequences", async (t) => {
  const env = await setup(t)
  const zipPath = await makeZip(env.root, "feed\u001b]0;title\u0007.zip", { "stops.txt": "stop_id\nS1\n" })
  await env.respond({ summary: [{ severity: "WARNING", code: "evil\u001b[2Jcode\u202e", total_notices: 1 }], notices: [] })
  const result = await env.cli("validate", zipPath, "--date", "2026-03-01")
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /[\u001b\u0007\u202e]/)
  assert.match(result.stdout, /evilcode/)
  await env.respond({ stdout: "", stderr: "IO Error: bad \u001b[31mred\u001b[0m\n", exit: 1 })
  const failed = await env.cli("validate", zipPath)
  assert.equal(failed.code, 2)
  assert.doesNotMatch(failed.stderr, /[\u001b\u0007]/)
  // A directory, whose path reaches the SQL, is refused, and its name is shown without the escape.
  const feed = path.join(env.root, "feed\u001b]0;title\u0007")
  await writeFeedDirectory(feed)
  const refused = await env.cli("validate", feed)
  assert.equal(refused.code, 2)
  assert.doesNotMatch(refused.stderr, /[\u001b\u0007]/)
})

test("usage errors exit 2 without running DuckDB", async (t) => {
  const env = await setup(t)
  await writeFile(path.join(env.root, "feed.zip"), "PK")
  const cases = [
    [[], /Usage: gtfs-tools validate </],
    [["feed.zip", "other.zip"], /Usage: gtfs-tools validate </],
    [["feed.zip", "--format", "xml"], /--format/],
    [["feed.zip", "--format"], /--format/],
    [["feed.zip", "--data"], /--data/],
    [["feed.zip", "--url"], /--url/],
    [["feed.zip", "--dashboard"], /--dashboard/],
  ]
  for (const [args, expected] of cases) {
    const result = await env.cli("validate", ...args)
    assert.equal(result.code, 2, `${args.join(" ")}: ${result.stderr}`)
    assert.match(result.stderr, expected, args.join(" "))
    assert.equal(result.stdout, "", args.join(" "))
  }
  assert.deepEqual(await env.invocations(), [])
})

test("help documents validate, its sources, formats and exit codes", async (t) => {
  const env = await setup(t)
  for (const args of [["help", "validate"], ["validate", "-h"], ["h", "validate"]]) {
    const help = await env.cli(...args)
    assert.equal(help.code, 0, help.stderr)
    for (const text of [USAGE, "--date YYYY-MM-DD", "--format", "json", "csv", "report.json", "Exit codes", "UPDATE EXTENSIONS (gtfs)"]) {
      assert.ok(help.stdout.includes(text), `${text} missing from:\n${help.stdout}`)
    }
    assert.match(help.stdout, /0\s+No ERROR notice/)
    assert.match(help.stdout, /1\s+At least one ERROR notice/)
    assert.match(help.stdout, /2\s+Validation could not run/)
  }
  const general = await env.cli("help")
  assert.ok(general.stdout.includes("validate <feed.zip|directory|https://…|s3://…|r2://…>"), general.stdout)
  const examples = await env.cli("examples")
  assert.match(examples.stdout, /gtfs-tools validate \.\/feed\.zip/)
})
