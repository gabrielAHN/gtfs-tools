#!/usr/bin/env node
// Prints the GitHub release notes for one version: its CHANGELOG.md section, then an install line.
//
//   node .github/scripts/release-notes.mjs <version> [CHANGELOG.md]
//
// The release workflow runs it before building, so a version without a CHANGELOG section never
// releases. It fails on a missing or empty section and on any heading other than the changelog's
// categories, so every release has the same shape.
import { readFileSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const CATEGORIES = ["Added", "Changed", "Removed", "Fixed", "Security"]

export const releaseNotes = (changelog, version) => {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a version: ${version}`)
  const lines = changelog.split("\n")
  const start = lines.findIndex((line) => line.startsWith(`## [${version}] - `))
  if (start === -1) throw new Error(`CHANGELOG.md has no "## [${version}] - <date>" section`)
  let end = lines.findIndex((line, index) => index > start && (line.startsWith("## ") || /^\[[^\]]+\]: /.test(line)))
  if (end === -1) end = lines.length
  const body = lines.slice(start + 1, end).join("\n").trim()
  if (!body) throw new Error(`CHANGELOG.md section ${version} is empty`)
  for (const heading of body.match(/^#+ .*$/gm) ?? []) {
    const category = heading.replace(/^### /, "")
    if (!heading.startsWith("### ") || !CATEGORIES.includes(category))
      throw new Error(`CHANGELOG.md section ${version} has the heading "${heading}"; use ${CATEGORIES.join(", ")}`)
  }
  if (!body.startsWith("### ")) throw new Error(`CHANGELOG.md section ${version} must start with a category heading`)
  return `${body}\n\n### Install\n\n\`\`\`sh\nnpm install -g @gabrielahn/gtfs-tools@${version}\n\`\`\`\n`
}

const isMain = () => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? "")
  } catch {
    return false
  }
}

if (isMain()) {
  const [version, file = "CHANGELOG.md"] = process.argv.slice(2)
  try {
    process.stdout.write(releaseNotes(readFileSync(file, "utf8"), version ?? ""))
  } catch (error) {
    console.error(`release-notes: ${error.message}`)
    process.exit(1)
  }
}
