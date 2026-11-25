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
import { appendFileSync, readFileSync, readdirSync } from "node:fs"
const argv = process.argv.slice(2)
let stdin = ""
try { stdin = readFileSync(0, "utf8") } catch {}
const sql = argv[argv.indexOf("-c") + 1] ?? ""
const match = /gtfs_validate\\('((?:[^']|'')*)'/.exec(sql)
const directory = match ? match[1].replaceAll("''", "'") : undefined
let files
if (directory) { try { files = readdirSync(directory).sort() } catch (error) { files = String(error) } }
appendFileSync(process.env.FAKE_DUCKDB_LOG, JSON.stringify({ argv, stdin, directory, files }) + "\\n")
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
  assert.deepEqual(files, ["routes.txt", "stops.txt"], "the directory itself is validated")
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
