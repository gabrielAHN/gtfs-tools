// The @gabrielahn/gtfs-viz-cli compatibility package ships skills/gtfs-viz/, generated at pack time from
// skills/gtfs-tools/ (compat/gtfs-viz-cli/scripts/generate-skill.mjs, run by its prepack). gtfs-viz-cli 1.5.x's
// own `gtfs-viz update --provider <p>` copies <compat package>/skills/gtfs-viz after installing the new version,
// so without it the upgrade deletes the user's skill and fails.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { generateCompatSkill, renamedNote, toCompatSkillMd } from "../compat/gtfs-viz-cli/scripts/generate-skill.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const skillSource = path.join(root, "skills", "gtfs-tools")
const compatDir = path.join(root, "compat", "gtfs-viz-cli")

const filesUnder = async (dir, prefix = "") => {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await filesUnder(path.join(dir, entry.name), relative)))
    else found.push(relative)
  }
  return found.sort()
}
const frontmatterOf = (skillMd) => /^---\n([\s\S]*?)\n---\n/.exec(skillMd)[1]

test("the generated gtfs-viz skill is the gtfs-tools skill renamed, with one note line", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-compat-skill-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const out = path.join(dir, "skills", "gtfs-viz")
  await generateCompatSkill({ from: skillSource, to: out })

  const source = await readFile(path.join(skillSource, "SKILL.md"), "utf8")
  const generated = await readFile(path.join(out, "SKILL.md"), "utf8")
  // The name.
  assert.match(frontmatterOf(source), /^name: gtfs-tools$/m)
  assert.deepEqual(frontmatterOf(generated).match(/^name: .*$/gm), ["name: gtfs-viz"])
  // The note: one line, saying the skill is now gtfs-tools.
  assert.equal(renamedNote.includes("\n"), false)
  assert.match(renamedNote, /now called `gtfs-tools`/)
  assert.equal(generated.split(renamedNote).length, 2, "the note appears once")
  assert.ok(generated.startsWith(`---\n${frontmatterOf(generated)}\n---\n\n${renamedNote}\n`), "the note follows the frontmatter")
  // Everything else is the same content.
  assert.equal(generated.replace(`\n${renamedNote}\n`, "").replace(/^name: gtfs-viz$/m, "name: gtfs-tools"), source)
  assert.equal(toCompatSkillMd(source), generated)
  assert.deepEqual(await filesUnder(out), await filesUnder(skillSource))
  for (const file of await filesUnder(skillSource)) {
    if (file === "SKILL.md") continue
    assert.deepEqual(await readFile(path.join(out, file)), await readFile(path.join(skillSource, file)), file)
  }
  // A 1.5.x `install-skill` edits the copy after its metadata: line; it must still be there.
  assert.match(frontmatterOf(generated), /^metadata:\s*$/m)
  assert.throws(() => toCompatSkillMd("# no frontmatter\n"), /no YAML frontmatter/)
})

test("npm pack of the compatibility package generates and lists skills/gtfs-viz/SKILL.md", async (t) => {
  // A scratch copy of the layout the generator expects (compat/gtfs-viz-cli next to skills/gtfs-tools), so
  // packing never writes into this checkout while other test files read compat/gtfs-viz-cli.
  const dir = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-compat-pack-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const compatCopy = path.join(dir, "compat", "gtfs-viz-cli")
  await cp(compatDir, compatCopy, { recursive: true, filter: (from) => !from.startsWith(path.join(compatDir, "skills")) })
  await cp(skillSource, path.join(dir, "skills", "gtfs-tools"), { recursive: true })
  assert.equal((await readdir(compatCopy)).includes("skills"), false, "no pre-generated copy")

  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const result = spawnSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: compatCopy,
    encoding: "utf8",
    timeout: 120_000,
    shell: process.platform === "win32",
    env: {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
      npm_config_cache: path.join(dir, "npm-cache"),
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  })
  assert.equal(result.status, 0, result.stderr)
  const files = JSON.parse(result.stdout)[0].files.map((file) => file.path).sort()
  assert.ok(files.includes("skills/gtfs-viz/SKILL.md"), files.join(", "))
  for (const reference of await filesUnder(path.join(skillSource, "references")))
    assert.ok(files.includes(`skills/gtfs-viz/references/${reference}`), reference)
  assert.ok(files.includes("bin/gtfs-viz.js"))
  assert.equal(files.some((file) => file.startsWith("scripts/")), false, "the generator is not shipped")
  const packed = await readFile(path.join(compatCopy, "skills", "gtfs-viz", "SKILL.md"), "utf8")
  assert.match(frontmatterOf(packed), /^name: gtfs-viz$/m)
})
