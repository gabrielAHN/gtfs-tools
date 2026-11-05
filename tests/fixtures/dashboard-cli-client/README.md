# Dashboard CLI client fixture

`nativeDuckDb.ts` is a verbatim copy of gabrielAHN/gtfs-viz `packages/web/src/lib/cli/nativeDuckDb.ts` at 819f8df:
the dashboard's client for the CLI's `POST /__gtfs_viz/api/sql` endpoint (CLI API v1). The dashboard now lives in
gtfs-viz, so `tests/spatial-http.integration.test.mjs` runs the CLI server against this copy to keep checking the
contract across the HTTP and DuckDB process boundary. Refresh it from gtfs-viz when the CLI API version changes.
