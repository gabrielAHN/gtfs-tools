# GTFS Tools CLI — Command Reference

Install skill: `npx skills add gabrielAHN/gtfs-tools`
Install CLI: `npm install -g @gabrielahn/gtfs-tools` (command `gtfs-tools`). `npm install -g @gabrielahn/gtfs-viz-cli` installs the same CLI as `gtfs-viz`; every command below works under either name.

## Install the Skill by AI Provider

```bash
gtfs-tools install-skill openai
gtfs-tools install-skill anthropic
gtfs-tools install-skill google
gtfs-tools install-skill generic
gtfs-tools install-skill --provider openai
gtfs-tools install-skill --list-providers
gtfs-tools h install-skill
```

Use `--target-dir <dir>` to override the provider default and `--force` to replace an existing installation. Non-interactive use still requires a provider when `--target-dir` is set. The backward-compatible `--agent codex`, `--agent claude`, and `--agent opensource` forms are also accepted.

`gtfs-tools h` and `gtfs-tools help` show general help. Add a command, such as `gtfs-tools h reroute` or `gtfs-tools h edits`, for the same detailed output as `gtfs-tools reroute -h` or `gtfs-tools edits -h`.

## Version and Updates

```bash
gtfs-tools version
gtfs-tools --version
gtfs-tools -v
gtfs-tools update --check
gtfs-tools update
gtfs-tools update --provider openai
```

`update` installs the latest global npm release while preserving the imported GTFS dataset and session. `--check` only compares versions. Add `--provider` to refresh that provider skill after updating.

## Import & Status

```bash
gtfs-tools import <feed.zip|https://…|s3://…|r2://…>  # Import a GTFS zip (local, URL or bucket) into local DuckDB
gtfs-tools import /path/to/feed.zip
gtfs-tools import https://example.com/gtfs/feed.zip
gtfs-tools import s3://my-bucket/gtfs/feed.zip  # also s3a://, s3n://; r2://my-bucket/feed.zip for Cloudflare R2
gtfs-tools status                     # Show dataset info and session state
gtfs-tools tables                     # List available DuckDB tables
gtfs-tools stop                       # Stop background dashboard session
gtfs-tools restart                    # Stop session and remove local import
gtfs-tools clean                      # Stop daemon and remove all local data
```

Remote feeds download to `~/.gtfs-viz-cli/downloads/`, must be zip archives and are deleted after the import. Never put credentials in a URL: URLs with a user name or password are refused, and so is an unencoded `@` in an http(s) URL path (percent-encode it as `%40`). Download and validation failures (not a zip, no `stops.txt`) leave the current dataset untouched; a failure during the DuckDB import itself still clears it, as for local files. `s3://`/`r2://` authenticate with DuckDB secrets: a matching (persistent) secret, else for `s3://` AWS env vars/profile/SSO via `credential_chain`, else anonymous. `r2://` needs `CREATE PERSISTENT SECRET (TYPE r2, KEY_ID …, SECRET …, ACCOUNT_ID …)`; MinIO/S3-compatible stores need an s3 secret with `ENDPOINT`. See `gtfs-tools h import`.

The `gtfs` extension installs from the DuckDB community repository (needs a DuckDB v2.0.0 CLI) unless `GTFS_EXTENSION_REPOSITORY` selects another repository.

## Browse Data

Default opens dashboard. Use `--data` for terminal output.

```bash
gtfs-tools stations                             # Open stations map
gtfs-tools stations --data                      # Print all stations
gtfs-tools stations --name "Park"               # Filter by name (partial match)
gtfs-tools stations --pathways "❌"              # Filter by pathways status
gtfs-tools stations --wheelchair "🟢"            # Filter by wheelchair status
gtfs-tools stations --id place-pktrm --data     # Filter by exact ID
gtfs-tools stations --format json               # JSON output
gtfs-tools stations --view table                # Open stations table
gtfs-tools stations map                         # Positional view name
```

```bash
gtfs-tools stops                                # Open stops map
gtfs-tools stops --data                         # Print all stops
gtfs-tools stops --name "Albany"                 # Filter by name
gtfs-tools stops --location-type "Stop"          # Filter by location type
gtfs-tools stops --id 10011 --data              # Filter by exact ID
```

```bash
gtfs-tools routes                                    # Open routes map
gtfs-tools routes --data                             # Print all routes
gtfs-tools routes --name "Metro"                     # Filter by name
gtfs-tools routes --type Bus                         # Filter by type
gtfs-tools routes --id ROUTE_ID --data               # Filter by ID
gtfs-tools routes --format json                      # JSON output
```

## Station & Stop Lookup

```bash
gtfs-tools station "Park Street"                # Open station info
gtfs-tools station --id place-pktrm --data      # Print station data
gtfs-tools stop-info "Albany St"                 # Open stop map with popup
gtfs-tools stop-info --id 10011 --data          # Print stop data
```

## Route Lookup & Service

```bash
gtfs-tools route "Line 1"                            # Open route info
gtfs-tools route "Line 1" --data                     # Print route data
gtfs-tools route "Line 1" service                    # Open service view
gtfs-tools route "Line 1" service --data             # Print services table
gtfs-tools route "Line 1" --service weekday-1 --data # Print trips for service
gtfs-tools route "Line 1" --trip TRIP_ID --data      # Print stop_times for trip
gtfs-tools route "Line 1" --service svc-1 --compare "trip-1,trip-2" --data  # Compare trips
gtfs-tools route "Line 1" --view map                 # Open route on map
```

Flags: `--service`, `--service-id`, `--trip`, `--trip-id`, `--compare <t1,t2,...>`, `--view <view>`

`--compare` requires `--service` and accepts up to 5 comma-separated trip IDs.

## Trips & Stop Times

```bash
gtfs-tools trips --data                              # List all trips with stop counts
gtfs-tools trips --route R1 --data                   # Trips for a route
gtfs-tools trips --route R1 --service SAT --data     # Trips for route+service
gtfs-tools trips trip-123 --data                     # Stop times for a trip
gtfs-tools trips --compare t1,t2 --data              # Compare stop times side-by-side
gtfs-tools trips --compare t1,t2,t3                  # Compare trips in dashboard
gtfs-tools trips --compare t1,t2 --view map          # Compare on map
```

```bash
gtfs-tools trip trip-123                              # Open trip in dashboard
gtfs-tools trip trip-123 --data                      # Print stop times with stop names
gtfs-tools trip trip-123 --data --view info           # Print trip metadata
gtfs-tools trip trip-123 --compare trip-456 --data   # Compare two trips
gtfs-tools trip trip-123 --view timeline              # Open timeline view
gtfs-tools trip trip-123 --view map                  # Open map view
gtfs-tools trip trip-123 --compare trip-456 --view map # Compare on map
```

Flags: `--route`, `--route-id`, `--service`, `--service-id`, `--trip`, `--trip-id`, `--compare <t1,t2,...>`, `--view <timetable|timeline|map|info>`

Views: `timetable` (default, table of stops), `timeline` (time-based chart), `map` (stops on map), `info` (trip metadata, --data only).

**Compare pattern**: `--compare` lists all trip IDs to compare. Example: to compare trips A, B, C use `--compare A,B,C`. With `trip` command, the positional trip ID is automatically included: `gtfs-tools trip A --compare B,C` compares A, B, C.

## Calendar & Services

```bash
gtfs-tools calendar --data                           # List all services with trip counts
gtfs-tools calendar --route R1 --data                # Services for a route
gtfs-tools calendar SAT-1 --data                     # Calendar + dates for a service
gtfs-tools calendar SAT-1                            # Open service view in dashboard
```

Flags: `--service-id`, `--service`, `--route-id`, `--route`

## Shapes

```bash
gtfs-tools shapes --data                             # List all shapes with stats
gtfs-tools shapes --route R1 --data                  # Shapes for a route
gtfs-tools shapes shape-123 --data                   # Points for a shape
gtfs-tools shapes                                    # Open route map in dashboard
```

Flags: `--shape-id`, `--shape`, `--route-id`, `--route`

## Route Line Bands

```bash
gtfs-tools route-bands                                # Build parallel route-line bands
gtfs-tools route-bands --data                         # Build, print band_rows/routes/widest_bundle
gtfs-tools route-bands --status --data                # Report existing band counts, no rebuild
```

Detects routes sharing a corridor from the GTFS `shapes` alone, converges them
onto one centreline, and assigns lateral lanes into `RouteShapeBandsTable` for
the dashboard's Separate Route(s) view. Runs the DuckDB corridor macros
(`prepare_route_shape_lanes_*` then `refresh_route_shape_bands`) in a writable
spatial session, so use this command rather than `query` to populate the bands.

Flags: `--status` (report only), `--data`, `--format json`

## Pathways & Connections

```bash
gtfs-tools station_connections "Park Street"              # Open flow graph
gtfs-tools station_connections --id place-pktrm --data    # Print connections
gtfs-tools station_pathways "Park Street"                 # Open pathways view
gtfs-tools station_pathways place-pktrm --node-id NODE_ID # Focus on a node
gtfs-tools station_pathways "Park Street" --data          # Print pathways
```

## Station Routes & Pathfinding

```bash
gtfs-tools station_routes "South Station" --data                        # All routes
gtfs-tools station_routes "South Station" --data --time-interval 60     # Max 60s
gtfs-tools station_routes "South Station" --data --time-interval 30,120 # Range
gtfs-tools station_routes "South Station" --data --connection-type "Exit/Entrance"
gtfs-tools station_routes "South Station" --data --node-id door-sstat-1
gtfs-tools station_shortest_route "South Station"                       # Fastest entrance-to-exit
gtfs-tools station_shortest_route "South Station" --data                # Print it
```

## Edit Dashboard Forms

```bash
gtfs-tools edit_pathway "Park Street"                          # Open pathway editor
gtfs-tools edit_pathway place-pktrm --node-id NODE_ID          # Focus on node
gtfs-tools edit_stop "Park Street"                             # Open stop editor
gtfs-tools edit_stop --stop-id 10011                           # Edit a stop
gtfs-tools edit_table                                          # Show all edits
gtfs-tools edit_table pathways                                 # Show pathway edits
gtfs-tools edit_table routes                                   # Show route edits
gtfs-tools edit_table stops --format json                      # JSON output
gtfs-tools edit_table stop_times                               # Show stop time edits
gtfs-tools edit_table calendar                                 # Show calendar edits
gtfs-tools edit_table calendar_dates                           # Show calendar exception-date edits
gtfs-tools edit_table trips                                    # Show trip edits
gtfs-tools edits                                               # Categorized summary of all edits
gtfs-tools edits --trip TRIP_ID                                # Original vs edited stop_times for a trip
gtfs-tools edits --url-only                                    # Edits & Export, by category
gtfs-tools edits --trip TRIP_ID --compare-view map --url-only  # Expanded reroute map comparison
gtfs-tools edits --view table --trips-page 3 --trips-page-size 20 --url-only
gtfs-tools edit_table --url-only                               # Edits & Export, by table
```

## Data Editing (CLI)

### Connections

```bash
gtfs-tools add_connection --from NODE_A --to NODE_B --traversal-time 45
gtfs-tools add_connection --from NODE_A --to NODE_B --bidirectional --pathway-mode 2
gtfs-tools update_connection --pathway-id PATHWAY_ID --traversal-time 60
gtfs-tools delete_connection --pathway-id PATHWAY_ID
```

### Nodes

```bash
gtfs-tools add_node --stop-id NEW_ID --lat 42.35 --lon -71.06 --parent-station STATION_ID
gtfs-tools update_node --stop-id STOP_ID --stop-name "New Name"
gtfs-tools delete_node --stop-id STOP_ID
```

### Trips, Stop Times & Calendar

See [edits.md](edits.md) for the full changeset format and the alert → edit workflow.

```bash
gtfs-tools add_trip --trip-id T2 --route-id R1 --service-id WKD --headsign "Express" --direction-id 0
gtfs-tools update_trip --trip-id T2 --headsign "Express"       # only given fields change
gtfs-tools delete_trip --trip-id T2                            # cascades to stop_times
gtfs-tools set_stop_times --trip-id T2 --stops-json '[{"stop_sequence":1,"stop_id":"S1","arrival_time":"09:00:00","departure_time":"09:00:00"}]'
gtfs-tools set_stop_times --trip-id T2 --stops-file ./stops.json
gtfs-tools reroute --trip A_TRIP   # open the selected trip's reroute form
gtfs-tools reroute --trip A_TRIP --via F_TRIP --from "W 4 St-Wash Sq" --to "Jay St-MetroTech"   # splice a donor route's stops in (scaled timing)
gtfs-tools remove_stops --trip T2 --stops "Spring St,Canal St"          # skip/express, station bypass
gtfs-tools truncate_trip --trip T2 --to "14 St"                          # short-turn / ends early (also --from)
gtfs-tools run_local --trip T2 --via LOCAL_TRIP --from "W 4 St-Wash Sq" --to "Jay St-MetroTech"  # run local (add stops back)
gtfs-tools split_trip --trip T2 --gap-from "Crescent St" --gap-to "Broadway Junction" --new-trip-id T2_SEC2  # two-section split
gtfs-tools add_calendar --service-id WKND --days sat,sun --start-date 20260101 --end-date 20261231
gtfs-tools update_calendar --service-id WKD --days mon,tue,wed,thu,fri,sat
gtfs-tools delete_calendar --service-id WKND
gtfs-tools add_calendar_date --service-id WKD --date 20260906 --exception-type 1   # 1=add, 2=remove
gtfs-tools delete_calendar_date --service-id WKD --date 20260906
```

`reroute --trip <id>` opens `/trips/table` with the trip selected and its reroute form open. A
complete reroute opens the edited trip after applying the splice. Add `--url-only` to print that
deep link without browser navigation, or `--data` to apply the reroute in terminal-only mode.

### Batch Changeset

```bash
gtfs-tools apply changeset.json                  # Apply many typed ops at once
gtfs-tools apply --json '{"ops":[...]}'          # Inline JSON
cat changeset.json | gtfs-tools apply --stdin    # From stdin
```

Ops: `trip.add|update|delete`, `stop_times.set`, `calendar.add|update|delete`, `calendar_date.add|delete`. Schema + examples in [edits.md](edits.md).

## Export

```bash
gtfs-tools export                                # Export merged GTFS (stops, pathways, routes, trips, stop_times, calendar, calendar_dates)
gtfs-tools export --output ./exported            # Export to specific directory
gtfs-tools export --no-pathways                  # Skip pathways.txt
gtfs-tools export --no-trips                     # Skip trips.txt
gtfs-tools export --no-stop-times                # Skip stop_times.txt
gtfs-tools export --no-calendar                  # Skip calendar.txt + calendar_dates.txt
gtfs-tools export --force                        # Export even with no pending edits
```

## SQL Queries

```bash
gtfs-tools query --sql "SELECT * FROM StationsTable"
gtfs-tools query --name station-info --args-json '{"stationId":"place-pktrm"}' --data
gtfs-tools query --name routes --data
```

## Output Flags

| Flag             | Description                              |
| ---------------- | ---------------------------------------- |
| (default)        | Open dashboard                           |
| `--data`         | Print rows in terminal                   |
| `--format json`  | JSON output                              |
| `--url`          | Open dashboard and print URL             |
| `--url-only`     | Print URL without opening                |
| `--view <view>`  | Choose dashboard view                    |
| `--page <n>`     | Open an ordinary dashboard table at page n |
| `--page-size <n>` | Table page size: 10, 20, 30, or 50      |

Edits & Export accepts file-specific pagination flags:
`--stops-page`, `--pathways-page`, `--routes-page`, `--trips-page`, `--calendar-page`, and
`--calendar-dates-page`, each with a matching `-page-size` flag. Route service accepts
`--services-page`, `--services-page-size`, `--service-trips-page`, and
`--service-trips-page-size`.

Dashboard views include `trips/table` and `export`. `gtfs-tools view --view export --url-only` opens
Edits & Export by category; add `--view table` through `gtfs-tools edits --view table --url-only` for
the per-file tables.

## Context-Aware Help

```bash
gtfs-tools routes -h                     # Routes command help
gtfs-tools routes service -h             # Service-specific flags
gtfs-tools route --view service -h       # Same as above
```
