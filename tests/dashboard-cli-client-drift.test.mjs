// CLI API v1 drift check: tests/fixtures/dashboard-cli-client/ holds copies of gtfs-viz's
// packages/web/src/lib/cli files (the dashboard's side of the CLI API) that spatial-http.integration runs
// against this CLI's server. Each copy must equal its counterpart in the gtfs-viz submodule, so the fixture
// never drifts from the dashboard this package builds. Never skips: without the submodule it fails.
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const fixtures = path.join(root, "tests", "fixtures", "dashboard-cli-client")
const submodule = path.join(root, "gtfs-viz")
const upstream = path.join(submodule, "packages", "web", "src", "lib", "cli")

test("the dashboard CLI client fixture equals gtfs-viz's packages/web/src/lib/cli in the submodule", () => {
  assert.ok(
    existsSync(path.join(submodule, "package.json")),
    "the gtfs-viz submodule is not checked out: run `git submodule update --init` (or clone with --recurse-submodules)",
  )
  const copies = readdirSync(fixtures).filter((name) => name !== "README.md")
  assert.ok(copies.length > 0, "the fixture holds at least one gtfs-viz file")
  for (const name of copies) {
    const counterpart = path.join(upstream, name)
    assert.ok(existsSync(counterpart), `gtfs-viz/packages/web/src/lib/cli/${name} is gone; refresh tests/fixtures/dashboard-cli-client`)
    assert.equal(
      readFileSync(path.join(fixtures, name), "utf8"),
      readFileSync(counterpart, "utf8"),
      `tests/fixtures/dashboard-cli-client/${name} differs from gtfs-viz/packages/web/src/lib/cli/${name}: copy it over and bump cliApi on both sides if the CLI API changed`,
    )
  }
})
