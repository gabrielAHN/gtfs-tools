# @gabrielahn/gtfs-viz-cli

Lightweight GTFS data visualizer and editor. Browse, edit, and export transit feeds from the terminal with a local DuckDB database and browser dashboard.

[![npm](https://img.shields.io/npm/v/@gabrielahn/gtfs-viz-cli)](https://www.npmjs.com/package/@gabrielahn/gtfs-viz-cli)
[![GitHub](https://img.shields.io/badge/GitHub-gabrielAHN%2Fgtfs--viz-181717?logo=github)](https://github.com/gabrielAHN/gtfs-viz)

**[GitHub](https://github.com/gabrielAHN/gtfs-viz)** | **[Web App](https://gtfs-viz-production-f1a4.up.railway.app)** | **[DuckDB Extension](https://github.com/gabrielAHN/gtfs-viz/tree/main/packages/duckdb-extension)** | **[Agent Skills](https://github.com/gabrielAHN/gtfs-viz/tree/main/packages/cli/skills/gtfs-viz)**

## Features

- Import GTFS zips — data stored locally in DuckDB
- Browse stations, stops, routes, and pathways with filters
- Edit stations, stops, routes, and pathway connections
- Compare trip schedules and route shapes
- Export edited data back to GTFS CSV
- Browser dashboard with maps, tables, and flow editor
- AI agent skills for coding assistants

## Install

```bash
npm install -g @gabrielahn/gtfs-viz-cli
```

Requires [DuckDB CLI](https://duckdb.org/docs/installation) (`duckdb` on PATH or `DUCKDB_BIN`).

## Quick Start

```bash
gtfs-viz import /path/to/feed.zip     # Import GTFS zip
gtfs-viz stations --name "Park"       # Filter stations
gtfs-viz routes --type Bus            # Filter routes
gtfs-viz station "Park Street"        # Open dashboard
gtfs-viz route "Red Line"             # Route info dashboard
gtfs-viz station "Park Street" --data # Print data in terminal
gtfs-viz examples                     # See all commands
```

## Commands

| Command | Description |
| --- | --- |
| `import <feed.zip>` | Import GTFS zip into local DuckDB |
| `stations [--name --pathways --wheelchair]` | Browse stations with filters |
| `stops [--name --location-type --wheelchair]` | Browse stops with filters |
| `routes [--route-id --route-name --type]` | Browse routes with filters |
| `station <name\|id>` | Station info (dashboard or `--data`) |
| `stop-info <name\|id>` | Stop map with popup (dashboard or `--data`) |
| `route <name\|id>` | Route info (dashboard or `--data`) |
| `station_connections <name\|id>` | Connection flow graph |
| `station_pathways <name\|id>` | Station parts and pathways |
| `station_routes <name\|id>` | Timed routes between parts |
| `station_shortest_route <name\|id>` | Fastest entrance-to-exit route |
| `add_connection / update_connection / delete_connection` | Edit pathways |
| `add_node / update_node / delete_node` | Edit stops |
| `export [--output --no-stops --no-pathways --no-routes]` | Export edited GTFS as CSV |
| `query --sql <sql>` | Run SQL |
| `edit_table [pathways\|stops\|routes]` | View pending edits |
| `stop` | Stop dashboard session and clear session state |
| `restart` | Stop session and remove local DuckDB/feed import |
| `examples` | Show usage examples |
| `clean` | Remove all local data |

Output modes: no flags opens the dashboard. `--data` for terminal table, `--format json` for JSON, `--url` to open dashboard and print URL, `--url-only` to print URL without opening, `--view <view>` to pick a specific page (e.g. `--view map`).

## Local Development

To test the CLI from the monorepo without publishing:

```bash
# From the repo root:
yarn install --ignore-engines
yarn cli:install-local          # Build all packages, install CLI globally
gtfs-viz --help

# Or symlink instead of install:
yarn cli:link
gtfs-viz --help

# Or run without installing:
yarn build
yarn cli import /path/to/feed.zip
yarn cli stations
```

## DuckDB Extension

The CLI uses the same GTFS DuckDB extension as the web app. See the [extension docs](../duckdb-extension#readme) for the full macro reference.

## Agent Skills

Install reference docs for AI coding agents (Claude Code, Cursor, etc.):

```bash
gtfs-viz install-skill
```

Installs: [SKILL.md](https://github.com/gabrielAHN/gtfs-viz/blob/main/packages/cli/skills/gtfs-viz/SKILL.md) | [commands.md](https://github.com/gabrielAHN/gtfs-viz/blob/main/packages/cli/skills/gtfs-viz/commands.md) | [tables.md](https://github.com/gabrielAHN/gtfs-viz/blob/main/packages/cli/skills/gtfs-viz/tables.md) | [procedures.md](https://github.com/gabrielAHN/gtfs-viz/blob/main/packages/cli/skills/gtfs-viz/procedures.md) | [gtfs-schedule-reference.md](https://github.com/gabrielAHN/gtfs-viz/blob/main/packages/cli/skills/gtfs-viz/gtfs-schedule-reference.md) | [examples.sql](https://github.com/gabrielAHN/gtfs-viz/blob/main/packages/cli/skills/gtfs-viz/examples.sql)
