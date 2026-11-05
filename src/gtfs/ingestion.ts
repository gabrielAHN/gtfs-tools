// Copied from gabrielAHN/gtfs-viz packages/duckdb-client/lib/ingestion.ts at 819f8df (the CLI no longer depends on
// @gtfs-viz packages). Keep it behaviourally identical; tests/gtfs-import-plan.test.mjs covers it.
export const importSql = (directory = ""): string => `PRAGMA gtfs_import('${directory.replaceAll("'", "''")}');`;
export const addGeomColumnsSql = (): string => "PRAGMA gtfs_add_geometry;";
