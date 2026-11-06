# Changelog

All notable changes to GTFS Tools (`@gabrielahn/gtfs-tools`) are documented in this file, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each version lists its changes under Added,
Changed, Removed, Fixed and Security, and its GitHub release notes are that section.

## [1.5.5] - 2026-11-05

### Changed
- The bundled dashboard's manifest no longer needs a `version`; it is exactly `{name, commit, cliApi}`.
  `scripts/build-dashboard.mjs` and its restore of an interrupted update accept that shape and the older
  one with a semver `version`, so an installed older dashboard can still be restored or replaced.
  Messages name a dashboard by its short commit.
- A release packs and publishes one package, and the version-bump check watches only `package.json`.

### Removed
- The switch that made messages name a `gtfs-viz` command. Help, usage, hints,
  errors and `--version` always say `gtfs-tools`, and `update` always installs `@gabrielahn/gtfs-tools`.
  The data directory `~/.gtfs-viz-cli`, the `GTFS_VIZ_*` variables and the dashboard's CLI API v1
  (`/__gtfs_viz/api/*`) keep their names, so an existing dataset keeps working.
- `Bash(gtfs-viz:*)` from the agent skill's Claude Code `allowed-tools`; the skill names only `gtfs-tools`.

## [1.5.4] - 2026-11-05

### Added
- `import` also takes an `http(s)://` URL or an `s3://`, `s3a://`, `s3n://` or `r2://` object. The feed is
  downloaded and checked before the current dataset changes, and the download is deleted afterwards, also
  on Ctrl-C or SIGTERM.
- Bucket access goes through DuckDB secrets: a matching secret (including persistent ones), then AWS
  environment variables, profile or SSO through `credential_chain`, then an anonymous request.
  S3-compatible stores such as MinIO use a secret's `ENDPOINT`; `r2://` needs an R2 secret.

### Changed
- The command is `gtfs-tools` (it was `gtfs-viz`), and the agent skill is `gtfs-tools`
  (`npx skills add gabrielAHN/gtfs-tools`); an old `gtfs-viz` skill directory is left in place and
  reported as stale. The dataset (`~/.gtfs-viz-cli`), the dashboard daemon and the `DUCKDB_BIN`,
  `GTFS_EXTENSION_REPOSITORY` and `GTFS_VIZ_*` variables are unchanged.
- The CLI loads the GTFS DuckDB `gtfs` extension instead of bundling its own SQL toolbox, and imports
  feeds with the extension's `gtfs_import` pragma. It carries its own copy of the extension client, the
  import SQL and the named queries, and has no runtime package dependency.
- The `gtfs` extension installs from the DuckDB community repository unless `GTFS_EXTENSION_REPOSITORY`
  names another repository. Community builds need a DuckDB v2.0.0 CLI.
- DuckDB runs without `AI_AGENT`, so DuckDB 2.0's agent mode never changes its output.
- The bundled dashboard is built from GTFS Viz, a git submodule at `gtfs-viz/`:
  `scripts/build-dashboard.mjs` (`npm run dashboard`) runs its `yarn build:dashboard` and installs the
  result into `dashboard/`. The CLI refuses a dashboard whose manifest does not declare `cliApi: 1`.
  `GTFS_VIZ_DASHBOARD_DIST` still serves another build.
- The README links to the docs site.
- A release first checks, builds and packs in a job with read-only contents and no npm token; a second job
  tags `v<version>`, creates the GitHub release and publishes the packed tarball without installing
  anything. CI runs the DuckDB integration tests on the DuckDB v2.0.0 CLI with the community `gtfs`
  extension and fails on any skipped test.

### Fixed
- A dashboard daemon that an older version left running is replaced the first time the dashboard opens,
  so the dashboard no longer fails with HTTP 500 after an upgrade. `daemon.json` records the daemon's
  `cliVersion` and `packageRoot`, and a daemon is reused only when it runs the same version from an
  install that still holds that version and its dashboard.
- `stop`, a re-import and a daemon replacement signal the recorded daemon pid (SIGTERM, then SIGKILL)
  only after checking its command line and port, so a reused pid is never killed.

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

## [1.5.3] - 2026-09-16

### Added
- `route-bands` builds route bands on demand with the DuckDB corridor macros, so routes that share a
  corridor render as stable parallel bands in the dashboard.
- The bundled skill documents the route-bands workflow.

### Changed
- Routine installs and updates keep imported feeds and sessions. A destructive reset needs
  `GTFS_VIZ_RESET_DATA=1`.

### Fixed
- Spatial SQL runs in one DuckDB process, and extension installation is retried only for a confirmed
  missing `spatial` extension.
- The dashboard's HTTP bridge reports real DuckDB errors instead of a missing executable.
- Route-band rows and their macro-version metadata rebuild in one transaction; a failed or out-of-memory
  rebuild keeps the last valid result.

## [1.5.2] - 2026-08-24

### Added
- `reroute --trip <id>` opens a trip directly in its reroute form.

### Fixed
- Applying a reroute returns to the edited trip, so the replacement stops show immediately.
- Reroute commands and skill links open the right form, edited trip or Edits & Export comparison view.
- The release is published explicitly under npm's `latest` tag.

## [1.5.1] - 2026-08-24

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

### Added
- `routes` and `route` commands with `--service`, `--trip` and `--compare`, and positional views such as
  `route "Red Line" service --data`.
- Context-aware help, for example `routes service -h`.
- `--url-only` prints the dashboard link without opening a browser.
- Skill: route, service and compare commands.

### Changed
- A command opens the dashboard by default; `--data` prints to the terminal. Data is checked before the
  dashboard opens.

## [1.3.2] - 2026-05-04

### Changed
- The README and the skill say the extension SQL is embedded in the CLI; no separate install is needed.

### Fixed
- DuckDB errors printed on stderr are reported as errors instead of being ignored.

## [1.3.1] - 2026-05-01

### Changed
- The CLI builds its import SQL from the GTFS DuckDB extension package it shares with the web app (load
  macros, then views, tables and indexes after the CSV import) instead of the whole procedures SQL file.
- `install-skill` tailors the installed skill to the agent (Claude Code gets `allowed-tools`).
- The skill's supporting files move to `references/`.

### Security
- The dashboard's HTTP server stops sending `access-control-allow-origin: *` on its data and SQL
  endpoints (two `navigate` replies still sent it until a later release).
- Its `sql` and `navigate` endpoints require the session ID.
- Request bodies are capped at 1 MB.
- `add_node` checks that `--lat` and `--lon` are numbers before they reach SQL.

## [1.3.0] - 2026-05-01

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
- Installing the package clears `~/.gtfs-viz-cli` (later releases keep it unless `GTFS_VIZ_RESET_DATA=1`).

[1.5.5]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.5.5
[1.5.4]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.5.4
[1.5.3]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.5.3
[1.5.2]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.5.2
[1.5.1]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.5.1
[1.5.0]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.5.0
[1.4.0]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.4.0
[1.3.2]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.3.2
[1.3.1]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.3.1
[1.3.0]: https://github.com/gabrielAHN/gtfs-tools/releases/tag/v1.3.0
