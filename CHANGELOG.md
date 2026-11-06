# Changelog

All notable changes to GTFS Tools (`@gabrielahn/gtfs-tools`, command `gtfs-tools`) are documented in this
file. The CLI started in [gabrielAHN/gtfs-viz](https://github.com/gabrielAHN/gtfs-viz) (`packages/cli`).
Versions 1.3.0 to 1.5.3 were published from there under its former npm name, with the command `gtfs-viz`;
their links point to gtfs-viz pull requests. The web app, the dashboard source and the docs stay in
gtfs-viz, which keeps its own dated CHANGELOG.

## [1.5.5] - 2026-11-05

### Removed
- The compatibility package and the `gtfs-viz` command name. `@gabrielahn/gtfs-tools` is the only npm
  package; its former npm name is deprecated on npm and points here. Help, usage, hints, errors and
  `--version` always say `gtfs-tools`, and `update` installs `@gabrielahn/gtfs-tools`. The data directory
  `~/.gtfs-viz-cli`, the `GTFS_VIZ_*` variables and the dashboard's CLI API v1 (`/__gtfs_viz/api/*`) keep
  their names, so an existing dataset keeps working.
- The agent skill names only `gtfs-tools`; its Claude Code `allowed-tools` drops `Bash(gtfs-viz:*)`.

### Changed
- The dashboard manifest no longer needs a `version`: gtfs-viz has no versions, so its manifest is exactly
  `{name, commit, cliApi}`. `scripts/build-dashboard.mjs` and its restore of an interrupted update accept
  that shape and the older one with a semver `version`, so an installed older dashboard can still be
  restored or replaced. Messages name a dashboard by its short commit.

### Build notes
- A release packs and publishes only `@gabrielahn/gtfs-tools`; the version-bump check watches only
  `package.json`.

## [1.5.4] - 2026-11-04

### Changed
- The CLI moved from gabrielAHN/gtfs-viz (`packages/cli`) to its own repository, gabrielAHN/gtfs-tools,
  with its git history. gtfs-viz keeps the web app, its dashboard and the docs
  ([gtfs-viz#25](https://github.com/gabrielAHN/gtfs-viz/pull/25), [#1](https://github.com/gabrielAHN/gtfs-tools/pull/1)).
- It is now published as `@gabrielahn/gtfs-tools` with the command `gtfs-tools`. 1.5.4 was also published
  under the former npm name as a compatibility package providing the `gtfs-viz` command; 1.5.5 removes it.
  The dataset (`~/.gtfs-viz-cli`), the dashboard daemon and the `DUCKDB_BIN`, `GTFS_EXTENSION_REPOSITORY`
  and `GTFS_VIZ_*` variables are unchanged.
- The CLI loads the separate GTFS DuckDB `gtfs` extension instead of bundling its own SQL toolbox, and
  imports feeds with the extension's `gtfs_import` pragma ([gtfs-viz#20](https://github.com/gabrielAHN/gtfs-viz/pull/20)).
- The CLI talks to the `gtfs` DuckDB extension directly and no longer depends on any `@gtfs-viz`
  package: it carries its own copy of the extension client, the import SQL and the named queries.
- The CLI installs the `gtfs` extension from the DuckDB community repository unless
  `GTFS_EXTENSION_REPOSITORY` names another repository. Community builds need a DuckDB v2.0.0 CLI.
- DuckDB runs without `AI_AGENT`, so DuckDB 2.0's agent mode never changes its output.
- The package bundles the GTFS Viz dashboard, built from the gtfs-viz submodule: gabrielAHN/gtfs-viz
  is a git submodule at `gtfs-viz/`, and `scripts/build-dashboard.mjs` (`npm run dashboard`) runs its
  `yarn build:dashboard` and installs the result into `dashboard/`. The CLI refuses a dashboard whose
  manifest does not declare `cliApi: 1`. `GTFS_VIZ_DASHBOARD_DIST` still serves another build.
- The agent skill is now `gtfs-tools` (`npx skills add gabrielAHN/gtfs-tools`). An old `gtfs-viz` skill
  directory is left in place and reported as stale.
- The npm README links to the docs site.

### Upgrading from 1.5.x
- A dashboard daemon that 1.5.x left running is replaced the first time 1.5.4 opens the dashboard.
  `daemon.json` now records the daemon's `cliVersion` and `packageRoot`. A daemon is reused when it runs
  the same version from an install that still holds that version and its dashboard. Otherwise it is
  stopped (SIGTERM, then SIGKILL, only after checking its command line and port) and a new one starts, so
  the dashboard no longer fails with HTTP 500 after an upgrade.
- `gtfs-tools stop` and a re-import only signal the recorded daemon pid after the same check, so a reused
  pid is never killed.

### Added
- `gtfs-tools import` also takes an `http(s)://` URL or an `s3://`, `s3a://`, `s3n://` or `r2://` object.
  The feed is downloaded and checked before the current dataset changes, and the download is deleted
  afterwards, also on Ctrl-C or SIGTERM.
- Bucket access goes through DuckDB secrets: a matching secret (including persistent ones), then AWS
  environment variables, profile or SSO through `credential_chain`, then an anonymous request.
  S3-compatible stores such as MinIO use a secret's `ENDPOINT`; `r2://` needs an R2 secret.

### Security
- URLs with a user name or password are refused. An `@` in an http(s) path must be written as `%40`,
  so a URL can't hide credentials in its path.
- Saved datasets, status output and errors show a source only as parsed, without its query string or
  credentials. A refused source is shown as `<scheme>://…`.
- `import` and `status` print text from outside the CLI, such as a server's reason phrase or a stored
  source, without escape sequences, control or bidi characters.
- `scripts/build-dashboard.mjs` fails closed: a build with links, hard links or devices, without
  `index.html`, or whose manifest is not a `cliApi: 1` `gtfs-viz-dashboard` one leaves the existing
  dashboard untouched.
- `scripts/build-dashboard.mjs --out` only ever replaces a dashboard: a missing or empty directory, or one
  holding a `gtfs-viz-dashboard` manifest. Any other directory, a symbolic link, and the current
  directory, the package root, `$HOME`, `/` or a parent of them are refused untouched.
- Names that the file system would store as one file (case or Unicode NFC/NFD variants) are refused with
  a clear error, and a dashboard left in `.dashboard.old-*` by an interrupted update is restored on the
  next run.

### Build notes
- Clone with `git clone --recurse-submodules` (or run `git submodule update --init`). npm with a
  committed `package-lock.json`: `npm ci`, `npm run check`, `npm run build` (`build:cli` + `dashboard`,
  which needs yarn 1.x for the gtfs-viz submodule), `npm test`. The npm package never contains
  `gtfs-viz/`.
- CI runs the DuckDB integration tests on the DuckDB v2.0.0 CLI with the signed `gtfs` extension from the
  DuckDB community repository, and fails on any skipped test. A version bump merged to `main` first
  checks, builds and packs in a job with read-only contents and no npm token. Only then does a second
  job tag `v<version>`, create the GitHub release and publish the packed tarball with `--tag latest`,
  without installing anything. The npm token is set only in the publish step, and checkouts that run
  `npm ci` keep no git credentials.

## [1.5.3] - 2026-09-16

Parallel route bands ([gtfs-viz#19](https://github.com/gabrielAHN/gtfs-viz/pull/19)).

### Added
- `route-bands` builds route bands on demand with the DuckDB corridor macros, so routes that share a
  corridor render as stable parallel bands in the dashboard.
- The bundled skill documents the route-bands workflow.

### Changed
- Routine installs and updates keep imported feeds and sessions. A destructive reset needs
  `GTFS_VIZ_RESET_DATA=1`.
- Route cleanup is deferred from import, and large feeds load with persistent storage and a controlled
  in-memory fallback.

### Fixed
- Spatial SQL runs in one DuckDB process, and extension installation is retried only for a confirmed
  missing `spatial` extension.
- The dashboard's HTTP bridge reports real DuckDB errors instead of a missing executable.
- Route-band rows and their macro-version metadata rebuild in one transaction; a failed or out-of-memory
  rebuild keeps the last valid result.

### Build notes
- Requires Node 22 and the DuckDB CLI with the `spatial` extension.

## [1.5.2] - 2026-08-24

Reroute deep links ([gtfs-viz#18](https://github.com/gabrielAHN/gtfs-viz/pull/18)).

### Added
- `reroute --trip <id>` opens a trip directly in its reroute form.

### Fixed
- Applying a reroute returns to the edited trip, so the replacement stops show immediately.
- Reroute commands and skill links open the right form, edited trip or Edits & Export comparison view.
- The release is published explicitly under npm's `latest` tag.

## [1.5.1] - 2026-08-24

Alert editing and trip rerouting ([gtfs-viz#17](https://github.com/gabrielAHN/gtfs-viz/pull/17)).

### Added
- Trip, stop-time, calendar and calendar-date editing, with batch `apply` of a changeset.
- `reroute`, `remove_stops`, `truncate_trip`, `split_trip` and `run_local` operations.
- Edit-aware `edits`, `calendar`, trip review and GTFS export, and direct Edits & Export verification
  links with table/map comparison and pagination flags.
- Provider-aware `install-skill` for OpenAI/Codex, Anthropic/Claude Code, Google/Gemini CLI and generic
  Agent Skills.
- `version`, `--version` and `-v`; `update` with `--check`, `--force` and an optional skill refresh; `h`
  as an alias of `help` and `-h`.
- Skill: an alert-to-GTFS editing workflow with changeset schemas and CLI verification steps, real
  service-date and time-range checks (including GTFS times past 24:00), and reroute guidance.

### Changed
- DuckDB sessions use fewer threads, a memory budget of 50% of RAM capped at 4 GB, no insertion-order
  preservation and a persistent spill directory; each default has an environment override.
- Updates keep imported GTFS data and session state, report the current and latest versions, and never
  downgrade a newer local build.
- Stop lookup falls back to the complete stop set for stations, platforms and raw stop IDs.

## [1.5.0] - 2026-07-22

Trip compare and trip editing ([gtfs-viz#16](https://github.com/gabrielAHN/gtfs-viz/pull/16)).

### Added
- `trips` and `trip` commands with `--route`, `--service`, `--compare` and `--view`.
- `calendar` with a `--route` filter and service detail lookup.
- `shapes` with a `--route` filter and shape point listing.
- Skill: commands, trip editing and compare examples.

### Changed
- `import` starts a dashboard session.
- `stations --pathways "yes"` and `--wheelchair "accessible"` accept text labels.
- `routes --type Subway` matches by substring (for example "Subway, Metro").

### Fixed
- `stop-info` falls back to the stations table and raw stops for station names and platform IDs, and
  `stops --id` and `stop-info --id` fall back to raw stops for platform IDs.
- `station_shortest_route` falls back to any timed route when no entrance-to-entrance route exists.

## [1.4.0] - 2026-06-15

Routes and CLI overhaul ([gtfs-viz#15](https://github.com/gabrielAHN/gtfs-viz/pull/15)).

### Added
- `routes` and `route` commands with `--service`, `--trip` and `--compare`, and positional views such as
  `route "Red Line" service --data`.
- Context-aware help, for example `routes service -h`.
- Skill: route, service and compare commands.

### Changed
- A command opens the dashboard by default; `--data` prints to the terminal. Data is checked before the
  dashboard opens.

## [1.3.2] - 2026-05-04

Published from the merged monorepo on gtfs-viz `main` ([gtfs-viz#12](https://github.com/gabrielAHN/gtfs-viz/pull/12)).

### Fixed
- DuckDB errors printed on stderr are reported as errors instead of being ignored.

### Changed
- The README and the skill say the extension SQL is embedded in the CLI; no separate install is needed.

## [1.3.1] - 2026-05-01

### Changed
- The CLI builds its import SQL from the GTFS DuckDB extension package it shares with the web app (load
  macros, then views, tables and indexes after the CSV import) instead of the whole procedures SQL file.
- `install-skill` tailors the installed skill to the agent (Claude Code gets `allowed-tools`).

### Security
- The dashboard's HTTP server no longer sends `access-control-allow-origin: *`.
- Its `sql` and `navigate` endpoints require the session ID.
- Request bodies are capped at 1 MB.
- `add_node` checks that `--lat` and `--lon` are numbers before they reach SQL.

## [1.3.0] - 2026-05-01

First npm release, from the gtfs-viz monorepo ([gtfs-viz#12](https://github.com/gabrielAHN/gtfs-viz/pull/12)).

### Added
- A self-contained CLI (esbuild bundle, no runtime npm dependencies) that imports a GTFS zip into a local
  DuckDB database and opens a browser dashboard.
- Station and stop browsing with filters, for example `stations --name "Park" --pathways "yes"
  --wheelchair "accessible"`.
- Pathway and stop editing: `add_connection`, `update_connection`, `delete_connection`, `add_node`,
  `update_node` and `delete_node`.
- `export` merges edits with the original data and writes GTFS CSV files.
- `examples` shows usage examples; `clean` stops the daemon and removes all local data; `--help` shows
  grouped commands with their flags.
- Any dashboard command starts the session automatically.
- Agent skills in the agentskills.io format, installed with `install-skill`.

### Changed
- Imported datasets expire after 7 days; the dashboard server exits after 30 minutes without activity.
- Importing a new feed stops a running dashboard session.
