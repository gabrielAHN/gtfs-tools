// scripts/build-dashboard.mjs beyond the split acceptance cases: building from the gtfs-viz submodule, entries
// that are not regular files, --out directories it must never replace, name collisions and an interrupted swap.
// Every failure leaves the existing dashboard untouched.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { BuildDashboardError, install } from "../scripts/build-dashboard.mjs"

const script = fileURLToPath(new URL("../scripts/build-dashboard.mjs", import.meta.url))

const manifestOf = (extra = {}) => JSON.stringify({ name: "gtfs-viz-dashboard", version: "1.6.0", commit: "a".repeat(40), cliApi: 1, ...extra })
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

const scratch = async (t, label) => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), `gtfs-tools-build-${label}-`)))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

// A built CLI-mode dashboard, as gtfs-viz's `yarn build:dashboard` leaves it in packages/web/dist.
const builtDashboard = async (dist, { manifest = manifestOf(), index = "<!doctype html><title>dashboard</title>" } = {}) => {
  await mkdir(path.join(dist, "assets"), { recursive: true })
  if (index !== undefined) await writeFile(path.join(dist, "index.html"), index)
  if (manifest !== undefined) await writeFile(path.join(dist, "dashboard-manifest.json"), manifest)
  await writeFile(path.join(dist, "assets", "app.js"), "console.log('dashboard')")
  return dist
}
const olderDashboard = async (out) => {
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, "dashboard-manifest.json"), previousManifest)
  await writeFile(path.join(out, "previous.txt"), "previous dashboard")
}
const listing = async (dir) => (await readdir(dir)).sort()

// An older dashboard at <dir>/dashboard and a run of the script with --dist <dir>/web-dist, prepared by `prepare`.
const installFrom = async (t, prepare) => {
  const dir = await scratch(t, "dist")
  const dist = path.join(dir, "web-dist")
  await builtDashboard(dist)
  await prepare(dist)
  const out = path.join(dir, "dashboard")
  await olderDashboard(out)
  const result = await run(["--dist", dist, "--out", out])
  return { dir, out, result }
}
const refusesBuild = async (t, prepare, pattern) => {
  const { dir, out, result } = await installFrom(t, prepare)
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, pattern)
  assert.doesNotMatch(result.stderr, /\n\s+at /, "a clear error, not a stack trace")
  assert.deepEqual(await listing(out), previousDashboard, "the existing dashboard is untouched")
  assert.deepEqual((await listing(dir)).filter((name) => name.startsWith(".")), [], "no staging directory is left behind")
}

test("only regular files and directories are installed: links, hard links and FIFOs are refused", async (t) => {
  await refusesBuild(t, (dist) => symlink("/etc/passwd", path.join(dist, "assets", "passwd")), /"assets\/passwd" .* is a symbolic link/)
  await refusesBuild(t, (dist) => symlink(path.join(dist, "assets"), path.join(dist, "linked-dir")), /"linked-dir" .* is a symbolic link/)
  // A hard link to a file outside the build would copy that file into the package.
  await refusesBuild(t, async (dist) => {
    const outside = path.join(path.dirname(dist), "secret.txt")
    await writeFile(outside, "secret")
    await link(outside, path.join(dist, "assets", "secret.txt"))
  }, /"assets\/secret\.txt" .* is a hard link/)
  await refusesBuild(t, async (dist) => {
    const made = spawnSync("mkfifo", [path.join(dist, "assets", "pipe")])
    assert.equal(made.status, 0, String(made.stderr))
  }, /"assets\/pipe" .* not a regular file/)
  await refusesBuild(t, (dist) => writeFile(path.join(dist, "dashboard-manifest.json"), "{not json"), /not valid JSON \(malformed manifest\)/)
  await refusesBuild(t, (dist) => writeFile(path.join(dist, "dashboard-manifest.json"), manifestOf({ extra: true })), /malformed dashboard manifest/)
  await refusesBuild(t, (dist) => writeFile(path.join(dist, "dashboard-manifest.json"), manifestOf({ commit: "HEAD" })), /not a 40-hex git commit/)
})

test("source maps and .DS_Store are skipped at every depth", async (t) => {
  const { out, result } = await installFrom(t, async (dist) => {
    await mkdir(path.join(dist, "assets", "fonts"))
    await writeFile(path.join(dist, "assets", "fonts", "font.woff2"), "font")
    await writeFile(path.join(dist, "assets", "fonts", "font.css.map"), "{}")
    await writeFile(path.join(dist, "assets", "fonts", ".DS_Store"), "junk")
    await writeFile(path.join(dist, "index.js.map"), "{}")
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Installed gtfs-viz dashboard 1\.6\.0 \(commit a{40}, cliApi 1\) .*: 4 files, skipped 3 source maps/)
  assert.deepEqual(await listing(out), ["assets", "dashboard-manifest.json", "index.html"])
  assert.deepEqual(await listing(path.join(out, "assets", "fonts")), ["font.woff2"])
})

test("arguments: unknown flags, a missing value, and --source with --dist are refused", async () => {
  for (const [args, pattern] of [
    [["--pinned"], /unknown argument "--pinned"/],
    [["--from", "x"], /unknown argument "--from"/],
    [["--dist"], /--dist needs a value/],
    [["--source", "a", "--dist", "b"], /exclude each other/],
  ]) {
    const result = await run(args)
    assert.notEqual(result.status, 0, args.join(" "))
    assert.match(result.stderr, pattern)
  }
})

// A scratch "package" holding a copy of the script (so the package root is scratch, never this checkout), a
// built dashboard and an empty $HOME.
const sandbox = async (t) => {
  const dir = await scratch(t, "out")
  const pkg = path.join(dir, "pkg")
  await mkdir(path.join(pkg, "scripts"), { recursive: true })
  const scriptCopy = path.join(pkg, "scripts", "build-dashboard.mjs")
  await copyFile(script, scriptCopy)
  const dist = await builtDashboard(path.join(dir, "web-dist"))
  const home = path.join(dir, "home")
  await mkdir(home)
  const installInto = (out, { cwd = dir, args = ["--dist", dist], env = {} } = {}) =>
    run([...args, "--out", out], { cwd, env: { HOME: home, ...env }, scriptPath: scriptCopy })
  return { dir, pkg, home, dist, scriptCopy, installInto }
}

// A gtfs-viz checkout stand-in whose `yarn` (first on PATH) records its calls and, for build:dashboard, writes
// packages/web/dist the way gtfs-viz's real script does.
const fakeGtfsViz = async (dir, { failOn } = {}) => {
  const source = path.join(dir, "gtfs-viz")
  await mkdir(source, { recursive: true })
  await writeFile(path.join(source, "package.json"), JSON.stringify({ name: "gtfs-viz", version: "1.6.0" }))
  const bin = path.join(dir, "bin")
  await mkdir(bin, { recursive: true })
  const calls = path.join(dir, "yarn-calls.log")
  const dist = path.join(source, "packages", "web", "dist")
  await writeFile(
    path.join(bin, "yarn"),
    [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then echo 1.22.22; exit 0; fi`,
      `echo "$* | cwd=$(pwd) | AI_AGENT=\${AI_AGENT-unset}" >> '${calls}'`,
      `echo "yarn output for $1"`,
      failOn ? `if [ "$1" = "${failOn}" ]; then echo "error: ${failOn} failed" >&2; exit 3; fi` : "",
      `if [ "$1" = "build:dashboard" ]; then`,
      `  mkdir -p '${dist}/assets'`,
      `  printf '<!doctype html>' > '${dist}/index.html'`,
      `  printf 'console.log(1)' > '${dist}/assets/app.js'`,
      `  printf '{}' > '${dist}/assets/app.js.map'`,
      `  printf '%s' '${manifestOf({ commit: "b".repeat(40) })}' > '${dist}/dashboard-manifest.json'`,
      "fi",
      "",
    ].join("\n"),
  )
  await chmod(path.join(bin, "yarn"), 0o755)
  return { source, bin, calls }
}

test("without --dist it builds the gtfs-viz submodule with yarn, AI_AGENT unset, and installs packages/web/dist", async (t) => {
  const { dir, pkg, installInto } = await sandbox(t)
  // The default --source is gtfs-viz/ in the package root: the submodule.
  const { source, bin, calls } = await fakeGtfsViz(pkg)
  const out = path.join(dir, "dashboard")
  await olderDashboard(out)
  const result = await installInto(out, { args: [], env: { PATH: `${bin}:/usr/bin:/bin`, AI_AGENT: "1" } })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readFile(calls, "utf8")).trim().split("\n"), [
    `install --frozen-lockfile --ignore-engines | cwd=${source} | AI_AGENT=unset`,
    `build:dashboard | cwd=${source} | AI_AGENT=unset`,
  ])
  // yarn's output goes to stderr; stdout is only the summary line.
  assert.match(result.stderr, /yarn output for build:dashboard/)
  assert.equal(result.stdout.trim().split("\n").length, 1, result.stdout)
  assert.match(result.stdout, new RegExp(`commit ${"b".repeat(40)}, cliApi 1\\) to ${out} from ${path.join(source, "packages", "web", "dist")}`))
  assert.deepEqual(await listing(out), ["assets", "dashboard-manifest.json", "index.html"])
  assert.deepEqual(await listing(path.join(out, "assets")), ["app.js"])

  // --source names another checkout.
  const other = await fakeGtfsViz(path.join(dir, "elsewhere"))
  const fromSource = await installInto(out, { args: ["--source", other.source], env: { PATH: `${other.bin}:/usr/bin:/bin` } })
  assert.equal(fromSource.status, 0, fromSource.stderr)
  assert.match(await readFile(other.calls, "utf8"), /^build:dashboard \| cwd=.*elsewhere\/gtfs-viz/m)
})

test("without the submodule it fails with git submodule update --init; without yarn it says so; a failed build changes nothing", async (t) => {
  const { dir, pkg, installInto } = await sandbox(t)
  const out = path.join(dir, "dashboard")
  await olderDashboard(out)
  const missing = await installInto(out, { args: [] })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /gtfs-viz submodule is missing.*git submodule update --init/)
  assert.deepEqual(await listing(out), previousDashboard)

  const { bin, calls } = await fakeGtfsViz(pkg, { failOn: "build:dashboard" })
  const noYarn = await installInto(out, { args: [], env: { PATH: path.join(dir, "home") } })
  assert.notEqual(noYarn.status, 0)
  assert.match(noYarn.stderr, /yarn is not on PATH .*install yarn 1\.x/)
  assert.doesNotMatch(noYarn.stderr, /\n\s+at /)

  const failed = await installInto(out, { args: [], env: { PATH: `${bin}:/usr/bin:/bin` } })
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /error: build:dashboard failed/)
  assert.match(failed.stderr, /yarn build:dashboard failed in .* \(exit 3\); the existing dashboard was left untouched/)
  assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 2)
  assert.deepEqual(await listing(out), previousDashboard)
  assert.deepEqual((await listing(dir)).filter((name) => name.startsWith(".")), [])
})

test("--out never names the current directory, the package root, $HOME, / or a parent of one, even when empty", async (t) => {
  const { dir, pkg, home, installInto } = await sandbox(t)
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
  const snapshot = async () => ({ cwd: await listing(emptyCwd), parent: await listing(parent), pkg: await listing(pkg), home: await listing(home), dir: await listing(dir) })
  const before = await snapshot()
  for (const [out, cwd, label] of cases) {
    const result = await installInto(out, { cwd })
    assert.notEqual(result.status, 0, `${label} must be refused`)
    assert.match(result.stderr, /refusing to replace .*not a dashboard directory/, label)
    assert.doesNotMatch(result.stderr, /\n\s+at /, `${label}: a clear error, not a stack trace`)
  }
  assert.deepEqual(await snapshot(), before, "nothing was touched")
})

test("--out refuses a symbolic link and a non-dashboard directory before building anything", async (t) => {
  const { dir, pkg, installInto } = await sandbox(t)
  const { bin, calls } = await fakeGtfsViz(pkg)
  const env = { PATH: `${bin}:/usr/bin:/bin` }
  const target = path.join(dir, "target")
  await mkdir(target)
  await writeFile(path.join(target, "dashboard-manifest.json"), previousManifest)
  const linkPath = path.join(dir, "link")
  await symlink(target, linkPath)
  const linked = await installInto(linkPath, { args: [], env })
  assert.notEqual(linked.status, 0)
  assert.match(linked.stderr, /refusing to replace .*symbolic link, not a dashboard directory/)
  assert.deepEqual(await listing(target), ["dashboard-manifest.json"])
  const project = path.join(dir, "project")
  await mkdir(project)
  await writeFile(path.join(project, "notes.txt"), "keep")
  const refused = await installInto(project, { args: [], env })
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /refusing to replace .*not a dashboard directory/)
  assert.deepEqual(await listing(project), ["notes.txt"])
  assert.equal(await readFile(calls, "utf8").catch(() => ""), "", "the refusal comes before any yarn run")
})

test("--out creates missing parent directories and replaces an older dashboard", async (t) => {
  const { dir, installInto } = await sandbox(t)
  const deep = path.join(dir, "a", "b", "c", "dashboard")
  const created = await installInto(deep)
  assert.equal(created.status, 0, created.stderr)
  assert.deepEqual(await listing(deep), ["assets", "dashboard-manifest.json", "index.html"])
  await writeFile(path.join(deep, "stale.txt"), "from the older dashboard")
  const replaced = await installInto(deep)
  assert.equal(replaced.status, 0, replaced.stderr)
  assert.deepEqual(await listing(deep), ["assets", "dashboard-manifest.json", "index.html"])
  assert.deepEqual((await listing(path.dirname(deep))).filter((name) => name.startsWith(".")), [], "no staging or old copy is left")
})

test("names that one file system stores as one file give a clear error, not a stack trace", async (t) => {
  // In the build: NFC and NFD spellings of one name. APFS stores them as one file; where the file system keeps
  // them apart (ext4), the build holds both and is refused.
  const nfc = "caf\u00e9.txt"
  const nfd = "cafe\u0301.txt"
  assert.notEqual(nfc, nfd)
  assert.equal(nfc, nfd.normalize("NFC"))
  let distinct = false
  const { result, out } = await installFrom(t, async (dist) => {
    await writeFile(path.join(dist, nfc), "1")
    await writeFile(path.join(dist, nfd), "2")
    distinct = (await readdir(dist)).filter((name) => name.normalize("NFC") === nfc).length === 2
  })
  if (distinct) {
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /duplicate entry .*Unicode normalization/)
    assert.doesNotMatch(result.stderr, /\n\s+at /)
    assert.deepEqual(await listing(out), previousDashboard)
  } else {
    assert.equal(result.status, 0, result.stderr)
  }

  // At installation: a collision the file system reports (EEXIST) becomes the same kind of error, and the
  // existing dashboard and its parent are untouched.
  const dir = await scratch(t, "collide")
  const target = path.join(dir, "dashboard")
  await olderDashboard(target)
  const entries = { directories: new Set(["", "x"]), files: new Map([["x", Buffer.from("1")], ["index.html", Buffer.from("i")]]) }
  await assert.rejects(install(entries, target), (error) => {
    assert.ok(error instanceof BuildDashboardError, String(error?.stack))
    assert.match(error.message, /dashboard\/x collides with another entry on this file system .*EEXIST/)
    return true
  })
  assert.deepEqual(await listing(target), previousDashboard)
  assert.deepEqual(await readdir(dir), ["dashboard"], "no staging directory is left behind")
  // The real NFC/NFD pair: installs both names where the file system keeps them apart, and otherwise fails
  // with the clear error (APFS).
  const pair = { directories: new Set([""]), files: new Map([[nfc, Buffer.from("1")], [nfd, Buffer.from("2")], ["index.html", Buffer.from("i")]]) }
  try {
    await install(pair, target)
    assert.equal((await readdir(target)).length, 3)
  } catch (error) {
    assert.ok(error instanceof BuildDashboardError, String(error?.stack))
    assert.match(error.message, /collides with another entry on this file system/)
    assert.deepEqual(await listing(target), previousDashboard)
  }
})

// A parent directory as a crash between install()'s two renames leaves it: no dashboard/, and the previous
// dashboard renamed to .dashboard.old-<tag>.
const interrupted = async (t, copies) => {
  const dir = await scratch(t, "restore")
  for (const [name, manifest] of copies) {
    await mkdir(path.join(dir, name))
    await writeFile(path.join(dir, name, "dashboard-manifest.json"), manifest)
    await writeFile(path.join(dir, name, "index.html"), `<title>${name}</title>`)
  }
  const good = await builtDashboard(path.join(dir, "web-dist"))
  const bad = await builtDashboard(path.join(dir, "bad-dist"), { manifest: manifestOf({ cliApi: 2 }) })
  const out = path.join(dir, "dashboard")
  const installDist = (dist) => run(["--dist", dist, "--out", out])
  return { dir, out, good, bad, installDist }
}
const hidden = async (dir) => (await listing(dir)).filter((name) => name.startsWith("."))

test("an interrupted swap is undone first: exactly one .dashboard.old-* copy with a valid manifest is restored", async (t) => {
  const old = ".dashboard.old-123-0123456789ab"
  const { dir, out, good, bad, installDist } = await interrupted(t, [[old, previousManifest]])
  // Even when this run then fails (a dashboard for another CLI API), the previous dashboard is back in place.
  const failed = await installDist(bad)
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /cliApi 2/)
  assert.match(failed.stderr, new RegExp(`restored .*dashboard \\(dashboard 1\\.5\\.9\\) from ${old.replaceAll(".", "\\.")}`))
  assert.equal(await readFile(path.join(out, "index.html"), "utf8"), `<title>${old}</title>`)
  assert.deepEqual(await hidden(dir), [])
  // The next good run replaces the restored dashboard as usual.
  const installed = await installDist(good)
  assert.equal(installed.status, 0, installed.stderr)
  assert.doesNotMatch(installed.stderr, /restored/)
  assert.equal(await readFile(path.join(out, "index.html"), "utf8"), "<!doctype html><title>dashboard</title>")
})

test("an interrupted swap is left alone when the old copy is ambiguous or not a valid dashboard", async (t) => {
  const two = await interrupted(t, [[".dashboard.old-1-aaaaaaaaaaaa", previousManifest], [".dashboard.old-2-bbbbbbbbbbbb", previousManifest]])
  const ambiguous = await two.installDist(two.bad)
  assert.notEqual(ambiguous.status, 0)
  assert.match(ambiguous.stderr, /2 older copies \(\.dashboard\.old-\*\) sit next to it; restoring none of them/)
  assert.equal((await hidden(two.dir)).length, 2)
  assert.equal((await readdir(two.dir)).includes("dashboard"), false)

  const foreign = await interrupted(t, [[".dashboard.old-1-aaaaaaaaaaaa", JSON.stringify({ name: "something-else" })]])
  const notRestored = await foreign.installDist(foreign.bad)
  assert.notEqual(notRestored.status, 0)
  assert.doesNotMatch(notRestored.stderr, /restored/)
  assert.equal((await readdir(foreign.dir)).includes("dashboard"), false)
  assert.deepEqual(await hidden(foreign.dir), [".dashboard.old-1-aaaaaaaaaaaa"])
})
