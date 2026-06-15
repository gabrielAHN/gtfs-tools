---
name: gtfs-viz
description: Import GTFS transit feeds, query station/stop/pathway/route data, edit connections, nodes, and routes, compare trip service patterns, export changes to GTFS CSV, and open a local browser dashboard. Use when working with GTFS data, transit stations, pathways, routes, or accessibility audits.
license: MIT
compatibility: Requires Node.js 18+ and DuckDB CLI on PATH or DUCKDB_BIN
metadata:
  author: gabrielahn
  version: "1.4.0"
---

# GTFS Viz CLI

Import GTFS feeds, query transit data, browse routes and service patterns, edit stations/pathways/routes, export changes, or open the local dashboard.

## Reference Files

Read these when you need exact column names, SQL syntax, or flag details:

- [references/commands.md](references/commands.md) — All CLI commands with flags and examples
- [references/tables.md](references/tables.md) — Table and view schemas with column types
- [references/procedures.md](references/procedures.md) — SQL macros, named queries, and pathfinding functions
- [references/gtfs-schedule-reference.md](references/gtfs-schedule-reference.md) — GTFS Schedule field reference focused on station parts, pathways, and missing-connection audits
- [references/examples.sql](references/examples.sql) — Practical SQL query examples

## Install

```bash
npm install -g @gabrielahn/gtfs-viz-cli
gtfs-viz install-skill
```

Or from the repo:

```bash
yarn build
npm install -g ./packages/cli
```

## Quick Start

```bash
gtfs-viz import /path/to/feed.zip
gtfs-viz status
gtfs-viz stations
gtfs-viz station "Park Street"
gtfs-viz station_pathways "Park Street" --data
```

## Import

```bash
gtfs-viz import /absolute/path/to/feed.zip
```

Use plain or quoted paths. Do not use backticks. Import is one-shot; a new import replaces the current dataset. Data is stored at `~/.gtfs-viz-cli/current`. Datasets auto-expire after 7 days.

## Browse & Filter

Filter stations or stops directly in the CLI:

```bash
gtfs-viz stations                                # All stations
gtfs-viz stations --name "Park"                  # Name contains "Park"
gtfs-viz stations --pathways "no"                # No pathways
gtfs-viz stations --wheelchair "accessible"      # Accessible
gtfs-viz stations --station-id place-pktrm       # Exact ID
gtfs-viz stations --name "Park" --pathways "yes" # Combined

gtfs-viz stops                                   # All standalone stops
gtfs-viz stops --name "Albany"                    # Name contains "Albany"
gtfs-viz stops --location-type "Stop"             # By type
gtfs-viz stops --wheelchair "unknown"             # By wheelchair status
```

Add `--format json` for JSON output.

## Dashboard

Commands open the dashboard by default. Add `--data` to print rows instead.

```bash
gtfs-viz station "Park Street"                    # Opens station info
gtfs-viz station "Park Street" --data             # Prints rows
gtfs-viz stop-info "Trade Center"                 # Opens stop map with popup + zoom
gtfs-viz station_connections "Park Street"         # Opens flow graph
gtfs-viz station_pathways place-pktrm --node-id node-pktrm-stair7-gl
gtfs-viz view --view stations/map --map-focus 42.355,-71.06,12
```

Return the printed dashboard URL to the user.

## Station Lookup

```bash
gtfs-viz station "Park Street"
gtfs-viz station --id place-pktrm --data
gtfs-viz station --id place-pktrm --format json
```

Use `--station-id` or `--station-name` when the value type is known. Use `--selected-station` or the positional argument when it could be either.

## Pathways & Connections

```bash
gtfs-viz station_connections "Park Street" --data
gtfs-viz station_pathways "Park Street" --data
gtfs-viz station_pathways place-pktrm --node-id node-pktrm-stair7-gl --data
```

`--node-id` targets platforms, exits/entrances, or pathway nodes within a station.

When checking for missing station pieces or broken internal connectivity, use station-part and network functions only. Start with `get_station_stops(station_id)`, then inspect `get_station_pathways(station_id)`, `get_station_routes(station_id)`, `find_shortest_path`, or `find_reachable_stops`. Do not audit station-internal connectivity from `StopsTable`, because that table is for standalone stops. See [references/gtfs-schedule-reference.md](references/gtfs-schedule-reference.md).

## Service Routes

```bash
gtfs-viz routes                                   # List all routes
gtfs-viz routes --type Bus                        # Filter by type
gtfs-viz routes --route-name "Metro"              # Filter by name
gtfs-viz routes --route-id ROUTE_ID               # Filter by ID
gtfs-viz routes --dashboard --route map           # Open routes map
gtfs-viz route "Line 1"                           # Open route info
gtfs-viz route --route-id ROUTE_ID --data         # Print route data
gtfs-viz route "Line 1" --route service           # Open service view
```

## Station Routes & Pathfinding

```bash
gtfs-viz station_routes "South Station" --data
gtfs-viz station_routes "South Station" --data --time-interval 60
gtfs-viz station_routes "South Station" --data --connection-type "Exit/Entrance"
gtfs-viz station_routes "South Station" --data --node-id door-sstat-dewey
gtfs-viz station_shortest_route "South Station" --data
```

`station_shortest_route` finds the fastest entrance-to-exit route by time.

## Data Editing (Connections)

```bash
gtfs-viz add_connection --from NODE_A --to NODE_B --traversal-time 45
gtfs-viz add_connection --from NODE_A --to NODE_B --bidirectional --pathway-mode 2 --stair-count 12
gtfs-viz update_connection --pathway-id PATHWAY_ID --traversal-time 60
gtfs-viz delete_connection --pathway-id PATHWAY_ID
```

Pathway modes: 1=walkway, 2=stairs, 3=moving sidewalk, 4=escalator, 5=elevator, 6=fare gate, 7=exit gate.

Find pathway IDs first:

```bash
gtfs-viz station_pathways "Park Street" --data
gtfs-viz query --sql "SELECT pathway_id, from_stop_id, to_stop_id, traversal_time FROM PathwaysView WHERE from_stop_id LIKE '%pktrm%'"
```

## Data Editing (Nodes)

```bash
gtfs-viz add_node --stop-id NEW_ID --lat 42.35 --lon -71.06 --parent-station place-pktrm
gtfs-viz add_node --stop-id door-new --stop-name "New Entrance" --lat 42.35 --lon -71.06 --location-type "Exit/Entrance" --parent-station place-pktrm
gtfs-viz update_node --stop-id NODE_ID --stop-name "Main Lobby"
gtfs-viz delete_node --stop-id NODE_ID
```

Location types: Station, Stop, Exit/Entrance, Generic Node, Boarding Area.

Find stop IDs first:

```bash
gtfs-viz query --name station-stops --args-json '{"stationId":"place-pktrm"}' --data
```

Review pending edits:

```bash
gtfs-viz edit_table
```

## Export

Export edited GTFS data as CSV files. Merges edits with original data (same as the dashboard export).

```bash
gtfs-viz export                           # Export stops.txt + pathways.txt + routes.txt
gtfs-viz export --output ./exported       # Export to specific directory
gtfs-viz export --no-pathways             # Skip pathways.txt
gtfs-viz export --no-stops                # Skip stops.txt
gtfs-viz export --no-routes               # Skip routes.txt
gtfs-viz export --force                   # Export even with no pending edits
```

## Cleanup

```bash
gtfs-viz stop                             # Stop the dashboard session
gtfs-viz restart                          # Stop session and remove local import
gtfs-viz clean                            # Stop daemon + delete all local data
```

`clean` removes `~/.gtfs-viz-cli/` (DuckDB database, feed zip, session state). The dashboard daemon also auto-exits after 30 minutes of inactivity.

## SQL Queries

```bash
gtfs-viz query --sql "SELECT * FROM StationsTable"
gtfs-viz query --sql "SELECT stop_id, stop_name FROM get_station_stops('place-pktrm')"
gtfs-viz query --name station-info --args-json '{"stationId":"place-pktrm"}' --data
gtfs-viz query --name stations --data
```

See [references/procedures.md](references/procedures.md) for all available macros and [references/examples.sql](references/examples.sql) for practical queries.

## DuckDB Extension

The CLI uses the GTFS DuckDB extension (embedded SQL) for all station analysis, pathway queries, and pathfinding. The extension is bundled — no separate install needed.

## Agent Rules

- Use absolute paths for files outside the repo. Quote paths with spaces.
- Return the printed dashboard URL unless the user asked for `--data`.
- Use `gtfs-viz status` to verify which dataset is loaded.
- Datasets auto-expire after 7 days; reimport if expired.
- Read [references/commands.md](references/commands.md) for exact flag names when constructing commands.
- Read [references/tables.md](references/tables.md) for column names when writing SQL.
