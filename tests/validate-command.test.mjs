// `gtfs-tools validate` with a fake DuckDB: usage, --date, sources (zip, directory, remote), the PRAGMA it
// runs, the three output formats, exit codes, cleanup of the private temporary directory and the guidance
// for an extension without gtfs_validate. The real extension is exercised by validate.integration.test.mjs.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
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
appendFileSync(process.env.FAKE_DUCKDB_LOG, JSON.stringify({ argv, stdin, directory, files, mode }) + "\\n")
const read = (name) => (process.env[name] ? readFileSync(process.env[name], "utf8") : "")
process.stdout.write(read("FAKE_DUCKDB_STDOUT"))
process.stderr.write(read("FAKE_DUCKDB_STDERR"))
process.exit(Number(process.env.FAKE_DUCKDB_EXIT || 0))
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
  return { root, home, tmp, cli, respond, invocations, dataRoot: path.join(home, ".gtfs-viz-cli") }
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
  assert.match(sql, /SELECT code, severity, filename, csv_row_number, notice(::VARCHAR AS notice)? FROM gtfs_validation_notices/)
  assert.ok(sql.indexOf("PRAGMA gtfs_validate") < sql.indexOf("FROM gtfs_validation_notices"), sql)
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
  const entries = Object.fromEntries(VALIDATED_FILES.map((file) => [file === "trips.txt" || file === "shapes.txt" ? `gtfs/${file}` : file, `${file} content\n`]))
  Object.assign(entries, { "agency.txt": "agency\n", "feed_info.txt": "feed\n", "gtfs/frequencies.txt": "f\n", "notes/readme.md": "x\n", "stops.txt.bak": "old\n" })
  const zipPath = await makeZip(env.root, "my feed.zip", entries)
  await env.respond({ summary: SUMMARY, notices: NOTICES })
  const result = await env.cli("validate", zipPath, "--date", "2026-03-01")
  assert.equal(result.code, 1, result.stderr)
  assert.ok(result.stdout.startsWith("Validated my feed.zip for 2026-03-01 "), result.stdout)
  const [{ directory, files, mode }] = await env.invocations()
  assert.equal(path.dirname(directory), env.tmp, "a new directory in the system temporary directory")
  assert.equal(mode, 0o700, "private")
  assert.deepEqual(Object.keys(files).sort(), [...VALIDATED_FILES].sort())
  for (const file of VALIDATED_FILES) assert.equal(files[file], `${file} content\n`, file)
  assert.deepEqual(await readdir(env.tmp), [], "the temporary directory is removed")
  assert.equal(await readdir(path.join(env.dataRoot, "current")).catch((error) => error.code), "ENOENT", "no current dataset")
})

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
