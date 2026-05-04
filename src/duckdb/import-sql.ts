/**
 * Builds the import SQL using the GTFS extension's embedded SQL.
 *
 * Flow: enum macros → drop → CSV import/reformat → init (views/tables/indexes)
 */

import {
  GTFS_LOAD_SQL,
  GTFS_INIT_SQL,
  dropExistingSql,
  buildImportSql as buildIngestionSql,
} from "@gtfs-viz/duckdb-extension";

export async function buildImportSql(opts: {
  stopsPath: string;
  pathwaysPath?: string;
}): Promise<string> {
  return [
    GTFS_LOAD_SQL,
    dropExistingSql(),
    buildIngestionSql(opts),
    GTFS_INIT_SQL,
  ].join("\n");
}
