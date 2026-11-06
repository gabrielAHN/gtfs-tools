import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { CATEGORIES, releaseNotes } from "../.github/scripts/release-notes.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const script = path.join(root, ".github", "scripts", "release-notes.mjs")

const sections = () => {
  const out = []
  for (const line of changelog.split("\n")) {
    const match = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/.exec(line)
    if (match) out.push({ version: match[1], date: match[2], lines: [] })
    else if (line.startsWith("## ")) assert.fail(`CHANGELOG heading "${line}" is not "## [x.y.z] - YYYY-MM-DD"`)
    else if (out.length && !/^\[[^\]]+\]: /.test(line)) out.at(-1).lines.push(line)
  }
  return out
}

const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number))
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

test("every CHANGELOG version uses the same categories, in order, with only bullet items", () => {
  const list = sections()
  assert.ok(list.length >= 10)
  for (let i = 1; i < list.length; i++) {
    assert.ok(compare(list[i - 1].version, list[i].version) > 0, `${list[i - 1].version} before ${list[i].version}`)
    assert.ok(list[i - 1].date >= list[i].date, `${list[i - 1].version} is dated after ${list[i].version}`)
  }
  for (const { version, lines } of list) {
    const headings = lines.filter((line) => line.startsWith("#"))
    assert.ok(headings.length > 0, `${version} has categories`)
    const names = headings.map((heading) => heading.replace(/^### /, ""))
    for (const heading of headings) assert.ok(CATEGORIES.includes(heading.replace(/^### /, "")) && heading.startsWith("### "), `${version}: ${heading}`)
    assert.deepEqual(names, CATEGORIES.filter((name) => names.includes(name)), `${version} lists its categories in order`)
    let current
    for (const line of lines) {
      if (line.startsWith("### ")) {
        current = { heading: line, items: 0 }
        continue
      }
      if (!line.trim()) continue
      assert.ok(current, `${version}: text before its first category: "${line}"`)
      assert.match(line, /^(- |  \S)/, `${version} ${current.heading}: "${line}" is not a bullet item`)
      if (line.startsWith("- ")) current.items++
    }
  }
})

test("each version links its own GitHub release and nothing links another repository's pull requests", () => {
  const refs = [...changelog.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((m) => [m[1], m[2]])
  assert.deepEqual(
    refs,
    sections().map(({ version }) => [version, `https://github.com/gabrielAHN/gtfs-tools/releases/tag/v${version}`]),
  )
  assert.doesNotMatch(changelog, /github\.com\/gabrielAHN\/(?!gtfs-tools\/)[^/\s)]+\/(pull|releases|issues)\//)
})

test("the package version has a CHANGELOG section, so it can be released", () => {
  assert.ok(sections().some(({ version }) => version === pkg.version), `CHANGELOG has ${pkg.version}`)
})

test("release notes are the version's CHANGELOG section plus an install line", () => {
  const notes = releaseNotes(changelog, "1.4.0")
  assert.ok(notes.startsWith("### Added\n- `routes` and `route` commands"), notes)
  assert.ok(notes.includes("### Changed\n- A command opens the dashboard by default"))
  assert.ok(!notes.includes("## [1.3.2]") && !notes.includes("]: https://"), "stops at the next version")
  assert.ok(notes.endsWith("### Install\n\n```sh\nnpm install -g @gabrielahn/gtfs-tools@1.4.0\n```\n"))
  const last = releaseNotes(changelog, "1.3.0")
  assert.ok(!last.includes("]: https://"), "the link references are not part of the oldest section")

  const cli = execFileSync(process.execPath, [script, pkg.version], { cwd: root, encoding: "utf8" })
  assert.equal(cli, releaseNotes(changelog, pkg.version))
})

test("release notes refuse a missing version, an empty section and an unknown heading", () => {
  const missing = spawnSync(process.execPath, [script, "9.9.9"], { cwd: root, encoding: "utf8" })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /no "## \[9\.9\.9\] - <date>" section/)
  assert.throws(() => releaseNotes("## [1.0.0] - 2026-01-01\n\n## [0.9.0] - 2025-01-01\n", "1.0.0"), /is empty/)
  assert.throws(() => releaseNotes("## [1.0.0] - 2026-01-01\n### Build notes\n- x\n", "1.0.0"), /Build notes/)
  assert.throws(() => releaseNotes("## [1.0.0] - 2026-01-01\nSummary line.\n### Added\n- x\n", "1.0.0"), /must start/)
  assert.throws(() => releaseNotes(changelog, "1.4"), /not a version/)
})
