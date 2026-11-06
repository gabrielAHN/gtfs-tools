// Acceptance contract for the split from gabrielAHN/gtfs-viz (see the split CONTRACT.md, v2: gtfs-viz is a
// git submodule and the dashboard is built from it).
// Requires `npm run build` first (dist/index.js). Never skips: a missing build is a failure.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

const scratch = () => mkdtemp(path.join(os.tmpdir(), "gtfs-tools-split-"))
const run = (args, options = {}) =>
  spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 60_000,
    ...options,
    env: { ...process.env, AI_AGENT: "", ...options.env },
  })

// A built CLI-mode dashboard, as gtfs-viz's `yarn build:dashboard` leaves it in packages/web/dist.
const builtDashboard = async (dir, { manifest = {}, withManifest = true, withIndex = true } = {}) => {
  const dist = path.join(dir, "web-dist")
  await mkdir(path.join(dist, "assets"), { recursive: true })
  if (withIndex) await writeFile(path.join(dist, "index.html"), "<!doctype html><title>dashboard</title>")
  await writeFile(path.join(dist, "assets", "app.js"), "console.log('dashboard')")
  await writeFile(path.join(dist, "assets", "app.js.map"), "{}")
  await writeFile(path.join(dist, ".DS_Store"), "junk")
  if (withManifest) {
    await writeFile(
      path.join(dist, "dashboard-manifest.json"),
      JSON.stringify({ name: "gtfs-viz-dashboard", commit: "0".repeat(40), cliApi: 1, ...manifest }),
    )
  }
  return dist
}
const buildDashboard = (dist, out, cwd) =>
  run([path.join(root, "scripts", "build-dashboard.mjs"), "--dist", dist, "--out", out], cwd ? { cwd } : {})
const olderDashboard = async (out) => {
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, "dashboard-manifest.json"), JSON.stringify({ name: "gtfs-viz-dashboard", version: "1.5.9", commit: "1".repeat(40), cliApi: 1 }))
  await writeFile(path.join(out, "previous.txt"), "previous dashboard")
}

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

// The former npm name is retired (deprecated on npm): gtfs-tools is the only package and command.
test("only @gabrielahn/gtfs-tools remains: no compatibility package, no second command name", () => {
  assert.equal(existsSync(path.join(root, "compat")), false, "compat/ is removed")
  const mentions = spawnSync(
    "git",
    ["grep", "-n", "-i", "-E", "gabrielahn/gtfs-viz-cli|GTFS_TOOLS_COMMAND_NAME", "--", ":!tests/split.acceptance.test.mjs"],
    { cwd: root, encoding: "utf8" },
  ).stdout
  assert.equal(mentions, "", "no mention of the retired package or its command-name switch")
  const release = readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8")
  assert.doesNotMatch(release, /gtfs-viz-cli|compat/)
  assert.match(release, /npm publish/)
})

test("the CHANGELOG carries the CLI's whole history under gtfs-tools versions", () => {
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8")
  const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1])
  assert.equal(versions[0], pkg.version, "the newest entry is the package version")
  for (const v of ["1.3.0", "1.4.0", "1.5.0", "1.5.3", "1.5.4"]) assert.ok(versions.includes(v), `CHANGELOG has ${v}`)
  assert.equal(new Set(versions).size, versions.length, "each version once")
})

test("a dashboard manifest without a version is accepted (gtfs-viz has no versions)", async () => {
  const dir = await scratch()
  const dist = await builtDashboard(dir)
  const out = path.join(dir, "dashboard")
  const result = buildDashboard(dist, out)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(out, "dashboard-manifest.json"), "utf8"))).sort(), ["cliApi", "commit", "name"])
})

test("gtfs-viz is a git submodule; no release-asset lock or fetch script remains", () => {
  const gitmodules = readFileSync(path.join(root, ".gitmodules"), "utf8")
  assert.match(gitmodules, /\[submodule "gtfs-viz"\]/)
  assert.match(gitmodules, /^\s*path = gtfs-viz\s*$/m)
  assert.match(gitmodules, /^\s*url = https:\/\/github\.com\/gabrielAHN\/gtfs-viz(\.git)?\s*$/m)
  const entry = spawnSync("git", ["ls-tree", "HEAD", "gtfs-viz"], { cwd: root, encoding: "utf8" }).stdout
  assert.match(entry, /^160000 commit [0-9a-f]{40}\tgtfs-viz$/m, "gtfs-viz is recorded as a submodule commit")
  for (const gone of ["dashboard.lock.json", "scripts/fetch-dashboard.mjs"]) assert.equal(existsSync(path.join(root, gone)), false, gone)
  assert.match(pkg.scripts.dashboard ?? "", /scripts\/build-dashboard\.mjs/)
  assert.ok(!pkg.files.some((entry) => /gtfs-viz/.test(entry)), "the submodule is never published")
  const gtfsDuckdb = spawnSync("git", ["grep", "-n", "-i", "github.com/gabrielAHN/gtfs-duckdb", "--", ":!tests/split.acceptance.test.mjs"], { cwd: root, encoding: "utf8" }).stdout
  assert.equal(gtfsDuckdb, "", "no tie to the gtfs-duckdb repository")
})

test("build-dashboard installs a built gtfs-viz dashboard, without source maps", async () => {
  const dir = await scratch()
  const dist = await builtDashboard(dir)
  const out = path.join(dir, "dashboard")
  await olderDashboard(out)
  const result = buildDashboard(dist, out)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readdirSync(out).sort(), ["assets", "dashboard-manifest.json", "index.html"])
  assert.deepEqual(readdirSync(path.join(out, "assets")), ["app.js"])
  assert.equal(JSON.parse(readFileSync(path.join(out, "dashboard-manifest.json"), "utf8")).cliApi, 1)
})

test("build-dashboard refuses a dashboard that is incomplete or speaks another CLI API", async () => {
  for (const [options, pattern] of [
    [{ withIndex: false }, /index\.html/],
    [{ withManifest: false }, /manifest/i],
    [{ manifest: { cliApi: 2 } }, /cliApi/],
    [{ manifest: { name: "something-else" } }, /gtfs-viz-dashboard|manifest/i],
  ]) {
    const dir = await scratch()
    const dist = await builtDashboard(dir, options)
    const out = path.join(dir, "dashboard")
    await olderDashboard(out)
    const result = buildDashboard(dist, out)
    assert.notEqual(result.status, 0, JSON.stringify(options))
    assert.match(result.stderr + result.stdout, pattern)
    assert.deepEqual(readdirSync(out).sort(), ["dashboard-manifest.json", "previous.txt"], "the existing dashboard is untouched")
  }
  const dir = await scratch()
  const dist = await builtDashboard(dir)
  await symlink("/etc/passwd", path.join(dist, "assets", "link"))
  const out = path.join(dir, "dashboard")
  await olderDashboard(out)
  const result = buildDashboard(dist, out)
  assert.notEqual(result.status, 0, "a symlink in the build is refused")
  assert.match(result.stderr + result.stdout, /link/i)
  assert.deepEqual(readdirSync(out).sort(), ["dashboard-manifest.json", "previous.txt"])
})

test("build-dashboard only ever replaces an empty directory or an older dashboard", async () => {
  const dir = await scratch()
  const dist = await builtDashboard(dir)
  const project = path.join(dir, "project")
  await mkdir(path.join(project, "src"), { recursive: true })
  await mkdir(path.join(project, ".git"))
  await writeFile(path.join(project, "src", "main.ts"), "code")
  await writeFile(path.join(project, "package.json"), "{}")
  for (const [out, cwd] of [[project, dir], [".", project], [path.join(project, "src"), dir]]) {
    const result = buildDashboard(dist, out, cwd)
    assert.notEqual(result.status, 0, `--out ${out} must be refused`)
    assert.match(result.stderr + result.stdout, /refus|not a dashboard|non-dashboard/i)
    assert.deepEqual(readdirSync(project).sort(), [".git", "package.json", "src"])
    assert.equal(readFileSync(path.join(project, "src", "main.ts"), "utf8"), "code")
  }
  const other = path.join(dir, "other")
  await mkdir(other)
  await writeFile(path.join(other, "dashboard-manifest.json"), JSON.stringify({ name: "something-else" }))
  await writeFile(path.join(other, "keep.txt"), "keep")
  assert.notEqual(buildDashboard(dist, other).status, 0)
  assert.equal(readFileSync(path.join(other, "keep.txt"), "utf8"), "keep")
  const empty = path.join(dir, "empty")
  await mkdir(empty)
  assert.equal(buildDashboard(dist, empty).status, 0)
  assert.ok(existsSync(path.join(empty, "index.html")))
  const fresh = path.join(dir, "fresh", "dashboard")
  assert.equal(buildDashboard(dist, fresh).status, 0)
  assert.ok(existsSync(path.join(fresh, "index.html")))
})

test("help and version always say gtfs-tools", async () => {
  const cli = path.join(root, "dist", "index.js")
  assert.ok(existsSync(cli), "run `npm run build` first")
  const home = await scratch()
  for (const env of [{ HOME: home }, { HOME: home, GTFS_TOOLS_COMMAND_NAME: "gtfs-viz" }]) {
    const version = run([cli, "--version"], { env })
    assert.equal(version.status, 0, version.stderr)
    assert.equal(version.stdout.trim(), `gtfs-tools ${pkg.version}`)
    const help = run([cli, "--help"], { env })
    assert.equal(help.status, 0, help.stderr)
    assert.match(help.stdout, /gtfs-tools import/)
    assert.doesNotMatch(help.stdout, /gtfs-viz (import|update|install-skill)/)
  }
  assert.equal(existsSync(path.join(home, ".gtfs-viz-cli", "daemon.json")), false, "help never starts a daemon")
})
