---
name: gtfs-tools
description: Import GTFS transit feeds, query station/stop/pathway/route/trip/calendar/shape data, edit connections, nodes, routes, trips, and stop times, compare trip service patterns and schedules, export changes to GTFS CSV, and open a local browser dashboard with the gtfs-tools CLI (also installed as gtfs-viz). Use when working with GTFS data, transit stations, pathways, routes, trips, schedules, or accessibility audits.
license: MIT
metadata:
  author: gabrielahn
  version: "1.5.4"
  repository: gabrielAHN/gtfs-tools
---

# GTFS Tools CLI

Import GTFS feeds, query transit data, browse routes/trips/calendars/shapes, compare trip schedules, edit stations/pathways/routes/trips/stop times, export changes, or open the local dashboard.

Run `gtfs-tools` (or `gtfs-viz` if you installed `@gabrielahn/gtfs-viz-cli`; same CLI, same data and dashboard). The examples below use `gtfs-tools`; with only the compatibility package installed, type `gtfs-viz` instead.

## Reference Files

Read these when you need exact column names, SQL syntax, or flag details:

- [references/commands.md](references/commands.md) — All CLI commands with flags and examples
- [references/edits.md](references/edits.md) — Apply trip / schedule / service edits and the changeset format for feeding service changes to the CLI
- [references/tables.md](references/tables.md) — Table and view schemas with column types
- [`gtfs` extension function reference](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-duckdb/functions.md) — every SQL function with a runnable example (markdown)
- [GTFS Tools CLI docs](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-tools/cli/) and the [docs index](https://gtfs-viz-production-f1a4.up.railway.app/docs/llms.txt) — every docs page as markdown
- [references/gtfs-schedule-reference.md](references/gtfs-schedule-reference.md) — GTFS Schedule field reference focused on station parts, pathways, and missing-connection audits
- [references/examples.sql](references/examples.sql) — Practical SQL query examples

## Install

Install the CLI globally and register the skill:

```bash
npm install -g @gabrielahn/gtfs-tools
gtfs-tools install-skill openai
```

Or install only the skill via npx:

```bash
npx skills add gabrielAHN/gtfs-tools
```

`npm install -g @gabrielahn/gtfs-viz-cli` still installs the same CLI under the `gtfs-viz` command (`gtfs-viz install-skill openai` installs this skill). Both packages can be installed together and share the imported dataset.

Use `anthropic`, `openai`, `google`, or `generic` for the AI provider. Run `gtfs-tools install-skill --list-providers` to see resolved installation paths. `--provider <name>` is equivalent to the positional provider name, and `--target-dir <dir>` overrides the default. Non-interactive use still requires a provider when `--target-dir` is set. An older `gtfs-viz` skill directory next to it is left in place and reported as stale; remove it yourself once this skill is installed.

Use `gtfs-tools h` for general help or `gtfs-tools h <command>` for the same command-specific help as `gtfs-tools help <command>` and `gtfs-tools <command> -h`.

Show or update the installed CLI:

```bash
gtfs-tools --version
gtfs-tools update --check
gtfs-tools update
gtfs-tools update --provider openai
```

`update` preserves the imported dataset and session. Add `--provider` to refresh the installed skill for that provider after the CLI update.

From a checkout of gabrielAHN/gtfs-tools:

```bash
npm ci
npm run build
npm install -g .
```

## Quick Start

```bash
gtfs-tools import /path/to/feed.zip
gtfs-tools status
gtfs-tools stations
gtfs-tools station "Park Street"
gtfs-tools station_pathways "Park Street" --data
```

## Import

```bash
gtfs-tools import /absolute/path/to/feed.zip
gtfs-tools import https://example.com/gtfs/feed.zip
gtfs-tools import s3://my-bucket/gtfs/feed.zip      # also s3a://, s3n://
gtfs-tools import r2://my-bucket/gtfs/feed.zip
```

Use plain or quoted paths or URLs. Do not use backticks. Import is one-shot; a new import replaces the current dataset. Data is stored at `~/.gtfs-viz-cli/current`. Datasets auto-expire after 7 days.

Remote feeds download to `~/.gtfs-viz-cli/downloads/` first, must be a zip archive and are deleted after the import. Download and validation failures (not a zip, no `stops.txt`) leave the current dataset untouched; a failure during the DuckDB import itself still clears it, as for local files. Query strings (pre-signed URLs) are used for the download but never stored or printed. URLs with an embedded user name or password are refused, and other schemes (`gs://`, `az://`, `hf://`, …) are not supported. An unencoded `@` in an http(s) URL path is refused too: percent-encode it as `%40`, and never put credentials in a URL.

`s3://` and `r2://` objects authenticate through DuckDB secrets: first any matching secret (including persistent ones, e.g. `duckdb -c "CREATE PERSISTENT SECRET (TYPE s3, KEY_ID '…', SECRET '…', REGION 'us-east-1')"`); then, for `s3://`, AWS environment variables, an AWS profile or SSO through a temporary `credential_chain` secret; then an anonymous request. `r2://` needs `CREATE PERSISTENT SECRET (TYPE r2, KEY_ID '…', SECRET '…', ACCOUNT_ID '…')`. MinIO and other S3-compatible stores use an s3 secret with `ENDPOINT`, `URL_STYLE 'path'` and `USE_SSL`. Never ask the user to paste secret values into a command you run; ask them to create the secret themselves.

## Browse & Filter

Filter stations or stops directly in the CLI:

```bash
gtfs-tools stations                                # All stations
gtfs-tools stations --name "Park"                  # Name contains "Park"
gtfs-tools stations --pathways "no"                # No pathways
gtfs-tools stations --wheelchair "accessible"      # Accessible
gtfs-tools stations --station-id place-pktrm       # Exact ID
gtfs-tools stations --name "Park" --pathways "yes" # Combined

gtfs-tools stops                                   # All standalone stops
gtfs-tools stops --name "Albany"                    # Name contains "Albany"
gtfs-tools stops --location-type "Stop"             # By type
gtfs-tools stops --wheelchair "unknown"             # By wheelchair status
```

```bash
gtfs-tools trips                                   # Open trips view
gtfs-tools trips --route R1 --data                 # Trips for a route
gtfs-tools trip trip-123 --data                    # Stop times for a trip
gtfs-tools trip trip-123 --view timeline           # Open timeline view
gtfs-tools trip trip-123 --compare trip-456        # Compare two trips

gtfs-tools calendar --data                         # List all services
gtfs-tools calendar SAT-1 --data                   # Calendar for a service

gtfs-tools shapes --data                           # List all shapes
gtfs-tools shapes shape-123 --data                 # Points for a shape
```

Add `--format json` for JSON output.

## Dashboard

Commands open the dashboard by default. Add `--data` to print rows instead.

```bash
gtfs-tools station "Park Street"                    # Opens station info
gtfs-tools station "Park Street" --data             # Prints rows
gtfs-tools stop-info "Trade Center"                 # Opens stop map with popup + zoom
gtfs-tools station_connections "Park Street"         # Opens flow graph
gtfs-tools station_pathways place-pktrm --node-id node-pktrm-stair7-gl
gtfs-tools view --view stations/map --map-focus 42.355,-71.06,12
gtfs-tools view --view export --url-only
```

Return the printed dashboard URL to the user.

## Station Lookup

```bash
gtfs-tools station "Park Street"
gtfs-tools station --id place-pktrm --data
gtfs-tools station --id place-pktrm --format json
```

Use `--station-id` or `--station-name` when the value type is known. Use `--selected-station` or the positional argument when it could be either.

## Pathways & Connections

```bash
gtfs-tools station_connections "Park Street" --data
gtfs-tools station_pathways "Park Street" --data
gtfs-tools station_pathways place-pktrm --node-id node-pktrm-stair7-gl --data
```

`--node-id` targets platforms, exits/entrances, or pathway nodes within a station.

When checking for missing station pieces or broken internal connectivity, use station-part and network functions only. Start with `get_station_stops(station_id)`, then inspect `get_station_pathways(station_id)`, `get_station_routes(station_id)`, `find_shortest_path`, or `find_reachable_stops`. Do not audit station-internal connectivity from `StopsTable`, because that table is for standalone stops. See [references/gtfs-schedule-reference.md](references/gtfs-schedule-reference.md).

## Routes & Service

```bash
gtfs-tools routes                                   # List all routes
gtfs-tools routes --type Bus                        # Filter by type
gtfs-tools routes --route-name "Metro"              # Filter by name
gtfs-tools routes --route-id ROUTE_ID               # Filter by ID
gtfs-tools route "Line 1"                           # Open route info
gtfs-tools route --route-id ROUTE_ID --data         # Print route data
gtfs-tools route "Line 1" --view service            # Open service view
```

## Trips & Stop Times

```bash
gtfs-tools trips --data                             # List all trips
gtfs-tools trips --route R1 --data                  # Trips for a route
gtfs-tools trip trip-123 --data                     # Stop times with stop names
gtfs-tools trip trip-123 --data --view info          # Trip metadata
gtfs-tools trip trip-123 --view timeline             # Open timeline view
gtfs-tools trip trip-123 --view map                  # Open map view
gtfs-tools trip trip-123 --compare trip-456 --data   # Compare stop times
gtfs-tools trip trip-123 --compare trip-456,trip-789 --view map # Compare 3 trips on map
gtfs-tools trips --compare trip-1,trip-2,trip-3      # Compare trips in dashboard
```

Views: `timetable` (default), `timeline` (time chart), `map` (location), `info` (metadata with --data).

## Calendar & Shapes

```bash
gtfs-tools calendar --data                          # List services with trip counts
gtfs-tools calendar --route R1 --data               # Services for a route
gtfs-tools calendar SAT-1 --data                    # Calendar + dates for a service
gtfs-tools shapes --data                            # List shapes with point counts
gtfs-tools shapes --route R1 --data                 # Shapes for a route
gtfs-tools shapes shape-123 --data                  # Points for a shape
```

## Route Line Bands

```bash
gtfs-tools route-bands                              # Build parallel route-line bands (Separate Route(s))
gtfs-tools route-bands --data                       # Print band_rows, routes, widest_bundle
gtfs-tools route-bands --status --data              # Report existing band counts without rebuilding
```

Builds `RouteShapeBandsTable` from the GTFS `shapes` alone: routes sharing a
corridor are converged onto one centreline and given lateral lanes so the
dashboard's Separate Route(s) view draws them as parallel bands. Use this rather
than `query` to run the corridor macros — they need a writable spatial session.

## Station Routes & Pathfinding

```bash
gtfs-tools station_routes "South Station" --data
gtfs-tools station_routes "South Station" --data --time-interval 60
gtfs-tools station_routes "South Station" --data --connection-type "Exit/Entrance"
gtfs-tools station_routes "South Station" --data --node-id door-sstat-dewey
gtfs-tools station_shortest_route "South Station" --data
```

`station_shortest_route` finds the fastest entrance-to-exit route by time.

## Data Editing (Connections)

```bash
gtfs-tools add_connection --from NODE_A --to NODE_B --traversal-time 45
gtfs-tools add_connection --from NODE_A --to NODE_B --bidirectional --pathway-mode 2 --stair-count 12
gtfs-tools update_connection --pathway-id PATHWAY_ID --traversal-time 60
gtfs-tools delete_connection --pathway-id PATHWAY_ID
```

Pathway modes: 1=walkway, 2=stairs, 3=moving sidewalk, 4=escalator, 5=elevator, 6=fare gate, 7=exit gate.

Find pathway IDs first:

```bash
gtfs-tools station_pathways "Park Street" --data
gtfs-tools query --sql "SELECT pathway_id, from_stop_id, to_stop_id, traversal_time FROM PathwaysView WHERE from_stop_id LIKE '%pktrm%'"
```

## Data Editing (Nodes)

```bash
gtfs-tools add_node --stop-id NEW_ID --lat 42.35 --lon -71.06 --parent-station place-pktrm
gtfs-tools add_node --stop-id door-new --stop-name "New Entrance" --lat 42.35 --lon -71.06 --location-type "Exit/Entrance" --parent-station place-pktrm
gtfs-tools update_node --stop-id NODE_ID --stop-name "Main Lobby"
gtfs-tools delete_node --stop-id NODE_ID
```

Location types: Station, Stop, Exit/Entrance, Generic Node, Boarding Area.

Find stop IDs first:

```bash
gtfs-tools query --name station-stops --args-json '{"stationId":"place-pktrm"}' --data
```

## Editing Trips, Schedules & Service

Apply service changes (e.g. from an alerts page) to the imported feed. The CLI does not read alerts
— you translate the change into edits. See [references/edits.md](references/edits.md) for the full
changeset format, the read → check → confirm → implement → review workflow, and the **alert-validation
report format** (in-data status + alert description + source link + a clickable, CLI-validated
dashboard link). It also covers **rerouting a trip onto another line** (e.g. "A/C run via the F") with
`gtfs-tools reroute` — which splices the donor route's stops in with scaled timing rather than just
skipping stops — and viewing it with `gtfs-tools trip <id> --compare <donor_trip> --view map`.

```bash
gtfs-tools add_trip --trip-id T2 --route-id R1 --service-id WKD --headsign "Uptown Express" --direction-id 0
gtfs-tools update_trip --trip-id T2 --headsign "Express"        # only given fields change
gtfs-tools delete_trip --trip-id T2                             # cascades to stop_times

gtfs-tools set_stop_times --trip-id T2 --stops-json '[{"stop_sequence":1,"stop_id":"S1","arrival_time":"09:00:00","departure_time":"09:00:00"}]'
gtfs-tools reroute --trip A_TRIP   # open the affected trip directly in the reroute form
gtfs-tools reroute --trip A_TRIP --via F_TRIP --from "W 4 St-Wash Sq" --to "Jay St-MetroTech"   # run A via the F between those stops
gtfs-tools remove_stops --trip T2 --stops "Spring St,Canal St"                # skip/express, station bypass
gtfs-tools truncate_trip --trip T2 --to "14 St"                                # short-turn / ends early
gtfs-tools split_trip --trip T2 --gap-from "Crescent St" --gap-to "Broadway Junction" --new-trip-id T2_SEC2  # two-section split

gtfs-tools add_calendar --service-id WKND --days sat,sun --start-date 20260101 --end-date 20261231
gtfs-tools update_calendar --service-id WKD --days mon,tue,wed,thu,fri,sat
gtfs-tools delete_calendar --service-id WKND

gtfs-tools add_calendar_date --service-id WKD --date 20260906 --exception-type 1   # 1=add, 2=remove service on date
gtfs-tools delete_calendar_date --service-id WKD --date 20260906
```

## Apply a Changeset (batch / mass edits)

Feed many edits at once from JSON — the primary way to apply a set of service changes:

```bash
gtfs-tools apply changeset.json
gtfs-tools apply --json '{"ops":[{"op":"trip.add","trip_id":"T2","route_id":"R1","service_id":"WKD"}]}'
cat changeset.json | gtfs-tools apply --stdin
```

Op types: `trip.add|update|delete`, `stop_times.set`, `calendar.add|update|delete`,
`calendar_date.add|delete`. Full schema and examples in [references/edits.md](references/edits.md).

Review pending edits:

```bash
gtfs-tools edits                                    # Categorized summary of all pending edits
gtfs-tools edits --trip trip-123                    # Original vs edited stop_times for one trip
gtfs-tools edits --url-only                         # Open Edits & Export by category
gtfs-tools edits --trip trip-123 --compare-view map --url-only # Expand a reroute map comparison
gtfs-tools edits --view table --trips-page 3 --trips-page-size 20 --url-only
gtfs-tools edit_table                               # Show all edit tables (raw rows)
gtfs-tools edit_table stop_times                    # Show stop time edits
gtfs-tools edit_table calendar                      # Show calendar edits
gtfs-tools edit_table calendar_dates                # Show calendar exception-date edits
gtfs-tools edit_table trips                         # Show trip edits
```

Dashboard table positions are URL-backed. Use `--page` and `--page-size` for ordinary tables,
`--services-page` and `--service-trips-page` for route service, and file-specific flags such as
`--trips-page` or `--calendar-dates-page` for Edits & Export. Generated links preserve those values
when opening a row and returning to its table.

## Export

Export edited GTFS data as text files. Merges edits with original data (same as the dashboard export).

```bash
gtfs-tools export                           # stops, pathways, routes, trips, stop_times, calendar, calendar_dates
gtfs-tools export --output ./exported       # Export to specific directory
gtfs-tools export --no-pathways             # Skip pathways.txt
gtfs-tools export --no-trips                # Skip trips.txt
gtfs-tools export --no-stop-times           # Skip stop_times.txt
gtfs-tools export --no-calendar             # Skip calendar.txt + calendar_dates.txt
gtfs-tools export --force                   # Export even with no pending edits
```

## Cleanup

```bash
gtfs-tools stop                             # Stop the dashboard session
gtfs-tools restart                          # Stop session and remove local import
gtfs-tools clean                            # Stop daemon + delete all local data
```

`clean` removes `~/.gtfs-viz-cli/` (DuckDB database, feed zip, session state). The dashboard daemon also auto-exits after 30 minutes of inactivity.

## SQL Queries

```bash
gtfs-tools query --sql "SELECT * FROM StationsTable"
gtfs-tools query --sql "SELECT stop_id, stop_name FROM get_station_stops('place-pktrm')"
gtfs-tools query --name station-info --args-json '{"stationId":"place-pktrm"}' --data
gtfs-tools query --name stations --data
```

See the [function reference](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-duckdb/functions.md) for all available functions and [references/examples.sql](references/examples.sql) for practical queries.

## DuckDB Extension

The CLI loads the `gtfs` [DuckDB community extension](https://duckdb.org/community_extensions/extensions/gtfs) for station analysis, pathway queries, and pathfinding.

Every CLI DuckDB session reduces its worker count, uses a host-aware memory limit capped at 4 GB,
disables insertion-order preservation, and can spill beside the persistent database. Override these
defaults with `GTFS_VIZ_DUCKDB_THREADS`, `GTFS_VIZ_DUCKDB_MEMORY_LIMIT`, or
`GTFS_VIZ_DUCKDB_TEMP_DIRECTORY` when a workload needs a different limit.

## Agent Rules

- Use absolute paths for files outside the repo. Quote paths with spaces.
- Return the printed dashboard URL unless the user asked for `--data`.
- Use `gtfs-tools status` to verify which dataset is loaded.
- Datasets auto-expire after 7 days; reimport if expired.
- Read [references/commands.md](references/commands.md) for exact flag names when constructing commands.
- Read [references/tables.md](references/tables.md) for column names when writing SQL.
- Use `gtfs-tools edits --trip <id> --compare-view map --url-only` for a direct reroute verification
  link in Edits & Export; use `gtfs-tools trip <id> --compare <donor> --view map --url-only` to compare
  affected and donor trips.
- Use `gtfs-tools reroute --trip <id>` to open the selected trip's reroute form. A complete
  `gtfs-tools reroute --trip <id> --via <donor> --from <station> --to <station>` opens the edited trip
  after applying the splice; add `--url-only` for a link without browser navigation or `--data` for
  terminal-only operation.

## Extension prerequisite

The CLI installs the signed `gtfs` extension from the DuckDB community repository by default (`INSTALL gtfs FROM community`), which needs a DuckDB v2.0.0 CLI (`duckdb --version`). Set `GTFS_EXTENSION_REPOSITORY` to an `https://…` repository to use another source. If gtfs is already installed from a different repository, run `duckdb -c "FORCE INSTALL gtfs FROM community"` or set `GTFS_EXTENSION_REPOSITORY` to the original repository; the CLI never forces a reinstall.
