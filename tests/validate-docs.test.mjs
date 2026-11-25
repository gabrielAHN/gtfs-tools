// The README, the bundled skill and its command reference document `validate`: the command and its
// sources, the formats, the exit codes, the 8 files the rules cover and what they do not cover.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = async (doc) => (await readFile(new URL(doc, import.meta.url), "utf8")).replace(/\s+/g, " ")

test("README, SKILL.md and commands.md document gtfs-tools validate", async () => {
  for (const doc of ["../README.md", "../skills/gtfs-tools/SKILL.md", "../skills/gtfs-tools/references/commands.md"]) {
    const text = await read(doc)
    assert.ok(text.includes("gtfs-tools validate <feed.zip|directory|https://…|s3://…|r2://…>"), `${doc}: usage`)
    for (const flag of ["--format json", "--format csv", "--date"]) assert.ok(text.includes(flag), `${doc}: ${flag}`)
    assert.match(text, /exits? 0[^.]*1[^.]*2/i, `${doc}: exit codes`)
    assert.match(text, /1\.1\.0 or later/, `${doc}: extension version`)
  }
})

test("README has a Validate a feed section naming the covered files and what is not covered", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8")
  const section = /^## Validate a feed\n([\s\S]*?)(?=^## )/m.exec(readme)?.[1]
  assert.ok(section, "## Validate a feed")
  const text = section.replace(/\s+/g, " ")
  assert.match(text, /MobilityData/)
  for (const file of ["stops", "pathways", "routes", "trips", "stop_times", "shapes", "calendar", "calendar_dates"]) {
    assert.match(text, new RegExp(`\\b${file}\\b`), file)
  }
  for (const file of ["agency", "feed_info", "frequencies", "transfers", "fares", "flex"]) assert.match(text, new RegExp(`\\b${file}\\b`), file)
  assert.match(section, /```bash\n[\s\S]*gtfs-tools validate [\s\S]*```/, "examples")
})
