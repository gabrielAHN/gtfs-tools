# Changelog

All notable changes to GTFS Tools (`@gabrielahn/gtfs-tools`, formerly `@gabrielahn/gtfs-viz-cli`) are
documented in this file. Releases up to 1.6.0 shipped from [gabrielAHN/gtfs-viz](https://github.com/gabrielAHN/gtfs-viz);
see its CHANGELOG for earlier versions.

## [1.6.0] - 2026-11-04

### Changed
- The CLI moved from gabrielAHN/gtfs-viz (`packages/cli`) to its own repository, gabrielAHN/gtfs-tools,
  with its git history. gtfs-viz keeps the web app, its dashboard and the docs.
- It is now published as `@gabrielahn/gtfs-tools` with the command `gtfs-tools`. Help, usage, hints,
  errors and `--version` print the command name.
- `@gabrielahn/gtfs-viz-cli` is now a compatibility package: it depends on exactly the same
  `@gabrielahn/gtfs-tools` version and provides the `gtfs-viz` command, which prints `gtfs-viz` in its
  help. Both packages can be installed together. Both commands share the dataset (`~/.gtfs-viz-cli`),
  the dashboard daemon and the `DUCKDB_BIN`, `GTFS_EXTENSION_REPOSITORY` and `GTFS_VIZ_*` variables.
- The CLI talks to the `gtfs` DuckDB extension directly and no longer depends on any `@gtfs-viz`
  package: it carries its own copy of the extension client, the import SQL and the named queries.
- The dashboard comes from a gtfs-viz release: the package bundles the `gtfs-viz-dashboard.tar.gz`
  asset of gtfs-viz v1.6.0, pinned by sha256 in `dashboard.lock.json` and extracted at build time by
  `scripts/fetch-dashboard.mjs`. The CLI refuses a dashboard whose manifest does not declare `cliApi: 1`.
  `GTFS_VIZ_DASHBOARD_DIST` still serves another build.
- The agent skill is now `gtfs-tools` (`npx skills add gabrielAHN/gtfs-tools`). It names both commands.
  An old `gtfs-viz` skill directory is left in place and reported as stale.
- `update` reinstalls the package that provides the running command.
- The CLI installs the `gtfs` extension from the DuckDB community repository unless
  `GTFS_EXTENSION_REPOSITORY` names another repository. Community builds need a DuckDB v2.0.0 CLI.
- DuckDB runs without `AI_AGENT`, so DuckDB 2.0's agent mode never changes its output.

### Upgrading from 1.5.x
- `gtfs-viz update --provider <p>` from 1.5.x works: it installs 1.6.0, then (still running the 1.5.x
  code) replaces your `gtfs-viz` skill with the copy that `@gabrielahn/gtfs-viz-cli` now ships in
  `skills/gtfs-viz`. That copy is the `gtfs-tools` skill under its old name, with a note that it is now
  called `gtfs-tools`. Run `gtfs-viz install-skill <p>` afterwards to install `gtfs-tools`, then delete
  the old `gtfs-viz` skill directory.
- A plain `npm install -g @gabrielahn/gtfs-viz-cli` also works; the imported dataset is kept.
- A dashboard daemon that 1.5.x left running is replaced the first time 1.6.0 opens the dashboard.
  `daemon.json` now records the daemon's `cliVersion` and `packageRoot`. A daemon is reused when it runs
  the same version from an install that still holds that version and its dashboard (so `gtfs-tools` and
  `gtfs-viz` installed separately share one daemon). Otherwise it is stopped (SIGTERM, then SIGKILL, only
  after checking its command line and port) and a new one starts, so the dashboard no longer fails with
  HTTP 500 after an upgrade.
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
- `scripts/fetch-dashboard.mjs` fails closed: a checksum mismatch, a non-ustar archive, absolute paths,
  `..`, links, devices or entries outside `dashboard/` leave the existing dashboard untouched.
- `scripts/fetch-dashboard.mjs --out` only ever replaces a dashboard: a missing or empty directory, or one
  holding a `gtfs-viz-dashboard` manifest. Any other directory, a symbolic link, and the current
  directory, the package root, `$HOME`, `/` or a parent of them are refused untouched.
- Archive names that the file system would store as one file (case or Unicode NFC/NFD variants) are
  refused with a clear error, and a dashboard left in `.dashboard.old-*` by an interrupted update is
  restored on the next run.

### Build notes
- npm with a committed `package-lock.json`: `npm ci`, `npm run check`, `npm run build`
  (`build:cli` + `dashboard`), `npm test`.
- CI runs the DuckDB integration tests on the DuckDB v2.0.0 CLI with the signed `gtfs` extension from the
  DuckDB community repository, and fails on any skipped test. A version bump merged to `main` first checks, builds and packs both
  packages in a job with read-only contents and no npm token. Only then does a second job tag
  `v<version>`, create the GitHub release and publish the packed `@gabrielahn/gtfs-tools`, then
  `@gabrielahn/gtfs-viz-cli` tarball, with `--tag latest` and without installing anything. The npm token
  is set only in the two publish steps, and checkouts that run `npm ci` keep no git credentials.
