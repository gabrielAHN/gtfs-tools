// The named queries and dashboard views copied from gabrielAHN/gtfs-viz packages/duckdb-client at 819f8df
// (src/gtfs/named-queries.ts), which `query --name` and the daemon's /query endpoint use.
import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"

const namedQueries = async () => {
  const result = await build({ entryPoints: [new URL("../src/gtfs/named-queries.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`)
}

test("named queries select the extension tables and macros with escaped ids", async () => {
  const { sqlForNamedQuery } = await namedQueries()
  assert.equal(sqlForNamedQuery("stations"), "SELECT * FROM StationsTable")
  assert.equal(sqlForNamedQuery("stops"), "SELECT * FROM StopsTable")
  assert.equal(sqlForNamedQuery("routes"), "SELECT * FROM RoutesTable")
  assert.equal(sqlForNamedQuery("edit_pathways"), "SELECT * FROM EditPathwayTable")
  assert.equal(sqlForNamedQuery("station-info", { stationId: "place-o'hare" }), "SELECT * FROM get_station_info('place-o''hare')")
  assert.equal(sqlForNamedQuery("station-stops", { stopId: "S1" }), "SELECT * FROM get_station_stops('S1')")
  assert.equal(sqlForNamedQuery("route_shapes", { routeId: "R'1" }), "SELECT * FROM get_route_shapes('R''1')")
  assert.throws(() => sqlForNamedQuery("route-info", {}), /requires args with routeId/)
  assert.throws(() => sqlForNamedQuery("station-info"), /requires args with stationId/)
  assert.throws(() => sqlForNamedQuery("nope", { stationId: "S1" }), /Unknown named query: nope/)
})

test("named queries open the matching dashboard view", async () => {
  const { dashboardViewForNamedQuery } = await namedQueries()
  assert.deepEqual(dashboardViewForNamedQuery("stations"), { view: "stations/map" })
  assert.deepEqual(dashboardViewForNamedQuery("route-stops", { routeId: "R1" }), { view: "routes/map", routeId: "R1" })
  assert.deepEqual(dashboardViewForNamedQuery("station-info", { stationId: "S1" }), { view: "stations/info", stationId: "S1" })
  assert.deepEqual(dashboardViewForNamedQuery("station_pathways", { stopId: "S1" }), { view: "stations/pathways/flow/radial", stationId: "S1" })
  assert.equal(dashboardViewForNamedQuery("station-info"), undefined)
  assert.equal(dashboardViewForNamedQuery("edit-stops"), undefined)
})
