# GTFS Tools

Command-line tools for GTFS transit feeds: import a feed, browse stations, stops, routes, trips and
pathways, edit connections, trips and schedules, compare service, and export the result as GTFS CSV,
from the terminal with a local DuckDB database and a browser dashboard.

[![npm](https://img.shields.io/npm/v/@gabrielahn/gtfs-tools)](https://www.npmjs.com/package/@gabrielahn/gtfs-tools)
[![GitHub](https://img.shields.io/badge/GitHub-gabrielAHN%2Fgtfs--tools-181717?logo=github)](https://github.com/gabrielAHN/gtfs-tools)
[![Docs](https://img.shields.io/badge/docs-gtfs--tools-blue)](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-tools/cli/)

**[CLI docs](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-tools/cli/)** | **[Web App](https://gtfs-viz-production-f1a4.up.railway.app)** | **[GTFS DuckDB](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-duckdb/)** | **[Function reference](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-duckdb/functions/)** | **[Agent skill](https://gtfs-viz-production-f1a4.up.railway.app/docs/agents/)** | **[Releases](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-tools/releases/)**

The CLI drives the [DuckDB CLI](https://duckdb.org/docs/installation) and the
[GTFS DuckDB](https://github.com/gabrielAHN/gtfs-duckdb) extension directly (`INSTALL gtfs FROM community`,
`LOAD gtfs`, `PRAGMA gtfs_import(…)` and the extension's macros). Until 1.6.0 it lived in
[gabrielAHN/gtfs-viz](https://github.com/gabrielAHN/gtfs-viz) as `packages/cli`; it moved here with its
history. The web app, its dashboard and the docs site stay in gtfs-viz.

## Features

- Import GTFS zips from a local path, an HTTP(S) URL or an S3/R2 bucket — data stored locally in DuckDB
- Browse stations, stops, routes, and pathways with filters
- Edit stations, stops, routes, and pathway connections
- Compare trip schedules and route shapes
- Export edited data back to GTFS CSV
- Browser dashboard with maps, tables, and flow editor (works offline)
- AI agent skill for coding assistants

## Install

```bash
npm install -g @gabrielahn/gtfs-tools      # command: gtfs-tools
```

Already using `gtfs-viz`? The compatibility package installs the same CLI under its former name:

```bash
npm install -g @gabrielahn/gtfs-viz-cli    # command: gtfs-viz
```

`@gabrielahn/gtfs-viz-cli` depends on exactly the same version of `@gabrielahn/gtfs-tools`; its `gtfs-viz`
command prints `gtfs-viz` in help and hints and otherwise behaves identically. Each package owns one
command, so both can be installed together. Both commands share the imported dataset
(`~/.gtfs-viz-cli`), the dashboard daemon and the environment variables (`DUCKDB_BIN`,
`GTFS_EXTENSION_REPOSITORY`, `GTFS_VIZ_*`), so a dataset imported with one works with the other.

Requires Node.js 18 or newer and the [DuckDB CLI](https://duckdb.org/docs/installation) v2.0.0
(`duckdb` on PATH or `DUCKDB_BIN`); see [Extension prerequisite](#extension-prerequisite).

Installing or updating the CLI preserves imported feeds, the current session database, and other
local data by default. To intentionally clear that data during installation, explicitly opt in:

```bash
GTFS_VIZ_RESET_DATA=1 npm install -g @gabrielahn/gtfs-tools
```

Only the exact value `1` enables this destructive reset.

DuckDB sessions use a reduced worker count, a host-aware memory limit capped at 4 GB, disabled
insertion-order preservation, and a persistent spill directory beside the imported database. The
defaults can be overridden with `GTFS_VIZ_DUCKDB_THREADS`, `GTFS_VIZ_DUCKDB_MEMORY_LIMIT`, and
`GTFS_VIZ_DUCKDB_TEMP_DIRECTORY`.

## Quick Start

```bash
gtfs-tools import /path/to/feed.zip     # Import GTFS zip
gtfs-tools import https://example.com/gtfs/feed.zip  # ...or download one
gtfs-tools import s3://my-bucket/gtfs/feed.zip       # ...or read one from a bucket
gtfs-tools stations --name "Park"       # Filter stations
gtfs-tools routes --type Bus            # Filter routes
gtfs-tools station "Park Street"        # Open dashboard
gtfs-tools route "Red Line"             # Route info dashboard
gtfs-tools station "Park Street" --data # Print data in terminal
gtfs-tools examples                     # See all commands
```

With the compatibility package, type `gtfs-viz` instead of `gtfs-tools`.

## Commands

| Command | Description |
| --- | --- |
| `import <feed.zip\|https://…\|s3://…\|r2://…>` | Import a GTFS zip (local path, URL or bucket object) into local DuckDB |
| `status` | Show the imported dataset and the dashboard session |
| `stations [--name --pathways --wheelchair]` | Browse stations with filters |
| `stops [--name --location-type --wheelchair]` | Browse stops with filters |
| `routes [--route-id --route-name --type]` | Browse routes with filters |
| `station <name\|id>` | Station info (dashboard or `--data`) |
| `stop-info <name\|id>` | Stop map with popup (dashboard or `--data`) |
| `route <name\|id>` | Route info (dashboard or `--data`) |
| `trips`, `trip <trip-id>` | Trips and stop times, trip comparison |
| `calendar`, `shapes` | Services and route shapes |
| `route-bands [--status]` | Build parallel route-line bands (Separate Route(s)) |
| `station_connections <name\|id>` | Connection flow graph |
| `station_pathways <name\|id>` | Station parts and pathways |
| `station_routes <name\|id>` | Timed routes between parts |
| `station_shortest_route <name\|id>` | Fastest entrance-to-exit route |
| `add_connection / update_connection / delete_connection` | Edit pathways |
| `add_node / update_node / delete_node` | Edit stops |
| `export [--output --no-stops --no-pathways --no-routes]` | Export edited GTFS as CSV |
| `query --sql <sql>`, `query --name <name>` | Run SQL or a named query |
| `edit_table [pathways\|stops\|routes]` | View pending edits |
| `edits [--trip --view --url-only]` | Review categories or open Edits & Export |
| `reroute --trip [--via --from --to]` | Open the reroute form or replace a trip section using donor stops |
| `view [--view <page>]` | Open a dashboard page |
| `stop` | Stop dashboard session and clear session state |
| `restart` | Stop session and remove local DuckDB/feed import |
| `examples` | Show usage examples |
| `clean` | Remove all local data |
| `install-skill [provider]`, `skill-path` | Install the bundled agent skill, or print its path |
| `version`, `-v`, `--version` | Show the installed CLI version |
| `update [--check]` | Update the CLI to the latest npm release |

Output modes: no flags opens the dashboard. `--data` for terminal table, `--format json` for JSON, `--url` to open dashboard and print URL, `--url-only` to print URL without opening, `--view <view>` to pick a specific page (e.g. `--view map`). `gtfs-tools h <command>` shows the detailed help for a command.

## Importing feeds

| Source | Example | How it is read |
| --- | --- | --- |
| Local zip | `gtfs-tools import /path/to/feed.zip` | Copied into the local dataset |
| HTTP(S) URL | `gtfs-tools import https://example.com/gtfs/feed.zip` | Downloaded with Node's `fetch`, following redirects |
| S3 object | `gtfs-tools import s3://my-bucket/gtfs/feed.zip` (also `s3a://`, `s3n://`) | Read by the DuckDB CLI (`httpfs`) |
| R2 object | `gtfs-tools import r2://my-bucket/gtfs/feed.zip` | Read by the DuckDB CLI with an R2 secret |

Remote feeds are downloaded to `~/.gtfs-viz-cli/downloads/` first, must be a zip archive, and are
deleted after the import. Download and validation failures (not a zip, no `stops.txt`) leave the
current dataset untouched; a failure during the DuckDB import itself still clears it, as for local files. The dataset records the source without its query string, fragment or credentials, so a
pre-signed URL's signature is used for the download but never stored or printed. URLs with an
embedded user name or password are refused. Other schemes (`gs://`, `az://`, `hf://`, `ftp://`, …)
are not supported.

### Authentication

`s3://` and `r2://` objects authenticate through [DuckDB secrets](https://duckdb.org/docs/stable/configuration/secrets_manager),
tried in this order:

1. Any DuckDB secret whose scope matches the URL, including persistent secrets you already have:

   ```bash
   duckdb -c "CREATE PERSISTENT SECRET (TYPE s3, KEY_ID 'AKIA…', SECRET '…', REGION 'us-east-1')"
   ```

2. For `s3://`: AWS credentials from environment variables (`AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`), an AWS profile (`AWS_PROFILE`) or
   an SSO login (`aws sso login`), through a temporary `credential_chain` secret:

   ```bash
   AWS_PROFILE=transit gtfs-tools import s3://my-bucket/gtfs/feed.zip
   ```

3. For `s3://`: an anonymous request, for public buckets.

R2 and S3-compatible stores such as MinIO need a secret:

```bash
# Cloudflare R2
duckdb -c "CREATE PERSISTENT SECRET (TYPE r2, KEY_ID '…', SECRET '…', ACCOUNT_ID 'your-account-id')"
gtfs-tools import r2://my-bucket/gtfs/feed.zip

# MinIO or another S3-compatible endpoint
duckdb -c "CREATE PERSISTENT SECRET (TYPE s3, KEY_ID '…', SECRET '…', ENDPOINT 'minio.example.com:9000', URL_STYLE 'path', USE_SSL true)"
gtfs-tools import s3://my-bucket/gtfs/feed.zip
```

Persistent secrets live in `~/.duckdb/stored_secrets`. gtfs-tools never prints or stores secret values.

Never put credentials in a URL or bucket source. URLs with a user name or password are refused, and
so are bucket names that are not plain names (letters, digits, `.`, `_`, `-`), which is how an
`s3://KEY:SECRET@bucket/…` with a `/` in the secret reads. An unencoded `@` in an http(s) URL before
its query string is refused too, because forms such as `http://user:8080/rest@host/feed.zip` parse as
a host, a port and a path, and would send part of a password to the wrong host. Percent-encode an
`@` in an http(s) path as `%40` (`https://example.com/%40team/feed.zip`); `@` in an `s3://` or
`r2://` key is fine. A refused source is shown only as its scheme, such as `https://…`. Use a
pre-signed URL for HTTP(S) and a DuckDB secret for buckets instead.

Direct review links:

```bash
gtfs-tools edits --url-only
gtfs-tools edits --trip TRIP_ID --compare-view map --url-only
gtfs-tools edits --view table --trips-page 3 --trips-page-size 20 --url-only
gtfs-tools reroute --trip TRIP_ID --url-only
```

`reroute --trip TRIP_ID` opens the selected trip's reroute form. Providing `--via`, `--from`, and
`--to` applies the splice and opens the edited trip. Add `--url-only` for the deep link without
browser navigation or `--data` for terminal-only operation.

## The dashboard

Commands without `--data` open a browser dashboard served by a local daemon on `127.0.0.1`. The
dashboard is the CLI mode of the [GTFS Viz web app](https://github.com/gabrielAHN/gtfs-viz): gtfs-viz
builds it and publishes it on each GitHub release as `gtfs-viz-dashboard.tar.gz` (with a `.sha256`
file). This package ships a pinned copy, so it works offline:

- `dashboard.lock.json` names the gtfs-viz release, the asset URL and its sha256.
- `npm run build` (and `prepublishOnly`) runs `scripts/fetch-dashboard.mjs`, which downloads that
  asset, refuses it unless its sha256 matches the lock, and extracts it safely into `dashboard/`.
- The dashboard's `dashboard-manifest.json` must declare `cliApi: 1`, the CLI API this CLI serves.

`GTFS_VIZ_DASHBOARD_DIST=<dir>` serves another build instead, such as `packages/web/dist` from a
gtfs-viz checkout.

## Extension prerequisite

By default the CLI installs the signed [GTFS DuckDB](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-duckdb/usage/#install)
extension from the DuckDB community repository (`INSTALL gtfs FROM community`). Community builds
exist only for the latest DuckDB, so use a DuckDB **v2.0.0** CLI (`duckdb --version`). The CLI
imports feeds with the extension's `gtfs_import` pragma; see the
[function reference](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-duckdb/functions/).

Set `GTFS_EXTENSION_REPOSITORY` to an `https://…` repository serving a compatible signed artifact to
use another source. Each imported dataset remembers the repository it was built with.

If gtfs is already installed from another repository, DuckDB refuses to switch origins. Either run
`duckdb -c "FORCE INSTALL gtfs FROM community"` or set `GTFS_EXTENSION_REPOSITORY` to the original
repository; the CLI never forces a reinstall itself.

## Version and Updates

```bash
gtfs-tools --version
gtfs-tools update --check
gtfs-tools update
gtfs-tools update --provider openai
```

`update` checks npm and installs the latest release of the package that provides the command:
`@gabrielahn/gtfs-tools` for `gtfs-tools`, `@gabrielahn/gtfs-viz-cli` for `gtfs-viz`. It preserves the
imported GTFS dataset and session files. Add `--provider` to refresh that provider skill after updating.

## Agent Skills

The bundled skill is `gtfs-tools`. Install it using the AI provider name:

```bash
gtfs-tools install-skill openai
gtfs-tools install-skill anthropic
gtfs-tools install-skill google
gtfs-tools install-skill generic
gtfs-tools h install-skill
```

Or install only the skill with `npx skills add gabrielAHN/gtfs-tools`. The skill tells agents to run
`gtfs-tools`, or `gtfs-viz` when only `@gabrielahn/gtfs-viz-cli` is installed.

The equivalent flag form is `gtfs-tools install-skill --provider openai`. Existing `--agent codex`, `--agent claude`, and `--agent opensource` commands remain supported. Use `--list-providers` to see resolved paths, `--target-dir` to override one, and `--force` to replace an existing installation. Non-interactive use always requires a provider, including with `--target-dir`.

The skill used to be named `gtfs-viz`. An old `gtfs-viz` skill directory is never removed (the CLI
cannot tell who installed it); `install-skill` and the npm postinstall print one line saying it is
stale, and you can delete it once the `gtfs-tools` skill is installed.

`gtfs-tools h` is the short form of `gtfs-tools help`. Both accept a command, so `gtfs-tools h install-skill`, `gtfs-tools h reroute`, and `gtfs-tools h edits` show the same detailed help as `<command> -h`.

Default locations:

| Provider | Default skill directory |
| --- | --- |
| OpenAI / Codex | `$CODEX_HOME/skills` or `~/.codex/skills` |
| Anthropic / Claude Code | `$CLAUDE_HOME/skills` or `~/.claude/skills` |
| Google / Gemini CLI | `$GEMINI_HOME/skills` or `~/.gemini/skills` |
| Generic Agent Skills | `~/.agents/skills` |

Installs `SKILL.md` with its references: `commands.md`, `tables.md`, `edits.md`, `gtfs-schedule-reference.md` and `examples.sql`. The [agent skill docs](https://gtfs-viz-production-f1a4.up.railway.app/docs/agents/) cover what it teaches.

## Development

```bash
git clone https://github.com/gabrielAHN/gtfs-tools.git
cd gtfs-tools
npm ci
npm run check            # tsc --noEmit
npm run build            # build:cli (tsc, esbuild bundle into dist/index.js) + dashboard (pinned asset)
node dist/index.js --help
npm install -g .         # or: npm link
```

The bundle has no runtime npm dependencies; only Node built-ins stay external. The code the CLI
used from gtfs-viz's `@gtfs-viz` duckdb-client package (the extension client, the import SQL and the
named queries) lives in `src/gtfs/`.

`scripts/fetch-dashboard.mjs` takes `--from <file|url>` (default: the lock's `url`), `--lock <file>`
(default `dashboard.lock.json`), `--out <dir>` (default `dashboard/`) and `--allow-unpinned`.

`--out` only ever replaces a dashboard. The directory must be missing (its parent directories are
created), empty, or an installed dashboard: one holding a `dashboard-manifest.json` whose `name` is
`gtfs-viz-dashboard`. Anything else is refused with "refusing to replace … not a dashboard directory"
and left untouched, before anything is downloaded. So are a symbolic link, the current directory, the
package root, `$HOME`, `/` and any parent of them, even when empty. If an earlier run was interrupted
between its two renames, leaving `--out` missing and exactly one `.<name>.old-*` copy holding a valid
dashboard next to it, the next run restores that copy before doing anything else and says so. An
archive with two names that the file system stores as one file (case or Unicode NFC/NFD variants, as
on APFS) is refused with a clear error.

`--allow-unpinned` skips only the checksum, with a warning, and is for development only, for example
with gtfs-viz's moving `dashboard-latest` pre-release:

```bash
node scripts/fetch-dashboard.mjs --allow-unpinned \
  --from https://github.com/gabrielAHN/gtfs-viz/releases/download/dashboard-latest/gtfs-viz-dashboard.tar.gz
```

To move the pin, set `tag`, `url` and `sha256` in `dashboard.lock.json` from the gtfs-viz release
(`gtfs-viz-dashboard.tar.gz.sha256` holds the hash). Publishing and CI never use `--allow-unpinned`.

`compat/gtfs-viz-cli` is the `@gabrielahn/gtfs-viz-cli` compatibility package. Its `prepack`
(`compat/gtfs-viz-cli/scripts/generate-skill.mjs`) generates `skills/gtfs-viz/` from `skills/gtfs-tools/`:
the same skill under its old name, with a note that it is now `gtfs-tools`. The copy is not committed;
gtfs-viz-cli 1.5.x's own `update --provider` installs it when upgrading. Releases bump the
version in `package.json`, in `compat/gtfs-viz-cli/package.json` (its `version` and its
`@gabrielahn/gtfs-tools` dependency) and in `skills/gtfs-tools/SKILL.md`, and add a `CHANGELOG.md`
entry. Merging such a PR tags the release and publishes both packages (`.github/workflows/release.yml`).

## Testing

```bash
npm run build:cli        # the acceptance tests run dist/index.js
npm test                 # node --test tests/*.test.mjs
```

The DuckDB integration tests (`remote-import.integration`, `route-bands.integration`) are skipped
unless a real DuckDB CLI and `gtfs` extension are configured. Run the full suite with them, expecting
0 skipped:

```bash
env -u AI_AGENT \
  DUCKDB_BIN=/path/to/duckdb-v2.0.0/duckdb \
  GTFS_EXTENSION=/path/to/gtfs.duckdb_extension \
  GTFS_DEPENDENCY_CACHE=/path/to/extension-cache \
  AWS_CONFIG_FILE=/nonexistent AWS_SHARED_CREDENTIALS_FILE=/nonexistent AWS_EC2_METADATA_DISABLED=true \
  node --test tests/*.test.mjs
```

- `DUCKDB_BIN`: a DuckDB v2.0.0 CLI.
- `GTFS_EXTENSION`: a `gtfs` extension build for that DuckDB version and platform (for example from
  gtfs-duckdb's staged repository, `v2.0.0/<platform>/gtfs.duckdb_extension.gz`, unzipped).
- `GTFS_DEPENDENCY_CACHE`: an extension directory holding `spatial`, `httpfs` and `aws` for that
  DuckDB version (`<cache>/v2.0.0/<platform>/`), so the tests stay offline. Fill it with
  `duckdb -c "SET extension_directories=['<cache>']; INSTALL spatial; INSTALL httpfs; INSTALL aws;"`.
- Unset `AI_AGENT`: with it set, DuckDB 2.0 switches to agent mode and its output changes. The dead AWS
  paths keep your own AWS configuration out of the S3 tests.

CI runs the same suite on Linux with DuckDB v2.0.0 and the latest `gtfs` build from gabrielAHN/gtfs-duckdb.

## License

MIT
