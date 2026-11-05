// The daemon serves the packaged dashboard (built from the gtfs-viz submodule by npm run dashboard) or
// GTFS_VIZ_DASHBOARD_DIST, and validateAppDist refuses a missing or incompatible one before it starts.
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"

// Bundles the server into <root>/dist/, as in the package, so <root>/dashboard is the packaged dashboard.
const serverIn = async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gtfs-tools-dashboard-dist-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const outfile = path.join(root, "dist", "server.mjs")
  await build({ entryPoints: [new URL("../src/server/http-server.ts", import.meta.url).pathname], outfile, bundle: true, format: "esm", platform: "node" })
  const server = await import(`${pathToFileURL(outfile).href}?root=${path.basename(root)}`)
  return { root, server }
}

const dashboard = async (directory, { index = true, manifest } = {}) => {
  await mkdir(directory, { recursive: true })
  if (index) await writeFile(path.join(directory, "index.html"), "<!doctype html><title>dashboard</title>")
  if (manifest !== undefined) await writeFile(path.join(directory, "dashboard-manifest.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest))
}

const withDashboardDist = (t, value) => {
  const previous = process.env.GTFS_VIZ_DASHBOARD_DIST
  if (value === undefined) delete process.env.GTFS_VIZ_DASHBOARD_DIST
  else process.env.GTFS_VIZ_DASHBOARD_DIST = value
  t.after(() => {
    if (previous === undefined) delete process.env.GTFS_VIZ_DASHBOARD_DIST
    else process.env.GTFS_VIZ_DASHBOARD_DIST = previous
  })
}

const manifest = (cliApi = 1) => ({ name: "gtfs-viz-dashboard", version: "1.6.0", commit: "0".repeat(40), cliApi })

test("the packaged dashboard needs index.html and a cliApi 1 manifest", async (t) => {
  withDashboardDist(t, undefined)
  const { root, server } = await serverIn(t)
  const packaged = path.join(root, "dashboard")
  await assert.rejects(server.validateAppDist(), /Dashboard build not found at .*dashboard\. Reinstall @gabrielahn\/gtfs-tools\. In a gtfs-tools checkout, run `git submodule update --init`, then `npm run dashboard`\./)
  await dashboard(packaged)
  await assert.rejects(server.validateAppDist(), /missing or malformed dashboard-manifest\.json/)
  await dashboard(packaged, { manifest: "{not json" })
  await assert.rejects(server.validateAppDist(), /missing or malformed dashboard-manifest\.json/)
  await dashboard(packaged, { manifest: manifest(2) })
  await assert.rejects(server.validateAppDist(), /declares cliApi 2; this CLI serves CLI API 1/)
  await dashboard(packaged, { manifest: manifest() })
  await server.validateAppDist()
})

test("GTFS_VIZ_DASHBOARD_DIST overrides the packaged dashboard and may omit the manifest", async (t) => {
  const { root, server } = await serverIn(t)
  await dashboard(path.join(root, "dashboard"), { manifest: manifest() })
  const override = path.join(root, "web-dist")
  withDashboardDist(t, override)
  await assert.rejects(server.validateAppDist(), /Dashboard build not found at .*web-dist\. Point GTFS_VIZ_DASHBOARD_DIST/)
  await dashboard(override)
  await server.validateAppDist()
  await dashboard(override, { manifest: manifest(3) })
  await assert.rejects(server.validateAppDist(), /declares cliApi 3/)
})
