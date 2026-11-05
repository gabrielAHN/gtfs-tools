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

### Build notes
- npm with a committed `package-lock.json`: `npm ci`, `npm run check`, `npm run build`
  (`build:cli` + `dashboard`), `npm test`.
- CI runs the DuckDB integration tests on the DuckDB v2.0.0 CLI with the latest gtfs-duckdb build and
  fails on any skipped test. A version bump merged to `main` tags `v<version>`, creates the GitHub
  release and publishes `@gabrielahn/gtfs-tools`, then `@gabrielahn/gtfs-viz-cli`, with `--tag latest`.
