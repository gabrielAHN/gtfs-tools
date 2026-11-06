// install-skill installs (and with --force replaces) the gtfs-tools skill; an old gtfs-viz skill next to it is
// left in place and reported as stale. Runs the CLI bundle from a throwaway package root holding the skill.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

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

test("install-skill installs gtfs-tools and reports an old gtfs-viz skill as stale", async (t) => {
  // Real path: the CLI finds its package root from the bundle's own (resolved) location.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-install-skill-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packageRoot = path.join(root, "pkg")
  await build({ entryPoints: [path.join(repoRoot, "src", "index.ts")], outfile: path.join(packageRoot, "dist", "index.js"), bundle: true, platform: "node", format: "esm", target: "node18" })
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@gabrielahn/gtfs-tools", version: "0.0.0-test", type: "module" }))
  await cp(path.join(repoRoot, "skills"), path.join(packageRoot, "skills"), { recursive: true })
  const home = path.join(root, "home")
  const skills = path.join(root, "skills-dir")
  const oldSkill = path.join(skills, "gtfs-viz")
  await mkdir(oldSkill, { recursive: true })
  await writeFile(path.join(oldSkill, "SKILL.md"), "---\nname: gtfs-viz\n---\n# old skill\n")
  const cli = (...args) => run(process.execPath, [path.join(packageRoot, "dist", "index.js"), ...args], { env: { ...process.env, HOME: home, AI_AGENT: "" } })

  const skillPath = await cli("skill-path")
  assert.equal(skillPath.stdout.trim(), path.join(packageRoot, "skills", "gtfs-tools", "SKILL.md"))

  const first = await cli("install-skill", "anthropic", "--target-dir", skills)
  assert.equal(first.code, 0, first.stderr)
  assert.match(first.stdout, new RegExp(`Installed the gtfs-tools skill for anthropic to ${path.join(skills, "gtfs-tools").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  assert.deepEqual(first.stdout.split("\n").filter((line) => /stale/i.test(line)), [
    `Stale skill: ${oldSkill} is the old gtfs-viz skill, left in place; remove it once you use gtfs-tools.`,
  ])
  const installed = await readFile(path.join(skills, "gtfs-tools", "SKILL.md"), "utf8")
  assert.match(installed, /^name: gtfs-tools$/m)
  assert.match(installed, /^allowed-tools: Bash\(gtfs-tools:\*\) Bash\(duckdb:\*\) Read$/m)
  assert.match(installed, /^ {2}provider: anthropic$/m)
  assert.doesNotMatch(installed, /gtfs-viz install-skill|Bash\(gtfs-viz:/, "the skill names only the gtfs-tools command")
  assert.equal(await readFile(path.join(oldSkill, "SKILL.md"), "utf8"), "---\nname: gtfs-viz\n---\n# old skill\n", "the old skill is untouched")

  const again = await cli("install-skill", "anthropic", "--target-dir", skills)
  assert.notEqual(again.code, 0)
  assert.match(again.stderr, /gtfs-tools already exists\. Rerun with --force/)
  const forced = await cli("install-skill", "openai", "--target-dir", skills, "--force")
  assert.equal(forced.code, 0, forced.stderr)
  assert.match(await readFile(path.join(skills, "gtfs-tools", "SKILL.md"), "utf8"), /^ {2}provider: openai$/m)
  assert.deepEqual((await readdir(skills)).sort(), ["gtfs-tools", "gtfs-viz"])
})
