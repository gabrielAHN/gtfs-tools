# GTFS Tools

[![npm @gabrielahn/gtfs-tools](https://img.shields.io/npm/v/@gabrielahn/gtfs-tools?label=%40gabrielahn%2Fgtfs-tools)](https://www.npmjs.com/package/@gabrielahn/gtfs-tools)
[![npm @gabrielahn/gtfs-viz-cli](https://img.shields.io/npm/v/@gabrielahn/gtfs-viz-cli?label=%40gabrielahn%2Fgtfs-viz-cli)](https://www.npmjs.com/package/@gabrielahn/gtfs-viz-cli)
[![Release](https://img.shields.io/github/v/release/gabrielAHN/gtfs-tools)](https://github.com/gabrielAHN/gtfs-tools/releases)

A command-line tool for GTFS transit feeds. Import a feed, browse and edit stations, stops, routes,
trips and pathways, compare schedules, and export GTFS CSV. It runs on a local DuckDB database with
the `gtfs` [DuckDB community extension](https://duckdb.org/community_extensions/extensions/gtfs), and
opens the [GTFS Viz](https://github.com/gabrielAHN/gtfs-viz) dashboard in your browser.

**[Docs](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-tools/cli/)** ·
**[Web app](https://gtfs-viz-production-f1a4.up.railway.app)** ·
**[Agent skill](https://gtfs-viz-production-f1a4.up.railway.app/docs/agents/)** ·
**[Changelog](CHANGELOG.md)**

## Install

```bash
npm install -g @gabrielahn/gtfs-tools      # command: gtfs-tools
```

You need Node.js 18+ and the [DuckDB CLI](https://duckdb.org/docs/installation) **v2.0.0**, either on
`PATH` or set as `DUCKDB_BIN`. On first use the CLI runs `INSTALL gtfs FROM community`. To install from
a different signed repository, set `GTFS_EXTENSION_REPOSITORY`.

### npm packages

Each release publishes both packages at the **same version**:

| Package | Command | Notes |
| --- | --- | --- |
| [`@gabrielahn/gtfs-tools`](https://www.npmjs.com/package/@gabrielahn/gtfs-tools) | `gtfs-tools` | The CLI. |
| [`@gabrielahn/gtfs-viz-cli`](https://www.npmjs.com/package/@gabrielahn/gtfs-viz-cli) | `gtfs-viz` | The former name. Depends on the same `gtfs-tools` version and runs it as `gtfs-viz`. |

Both commands share the same data (`~/.gtfs-viz-cli`), dashboard and settings. If you want both
commands, install each package with its own `npm install -g`.

## Quick start

```bash
gtfs-tools import ./feed.zip                       # a local zip
gtfs-tools import https://example.com/gtfs/feed.zip  # a URL
gtfs-tools import s3://my-bucket/gtfs/feed.zip     # a bucket (also s3a://, s3n://, r2://)
gtfs-tools stations --name "Park"                  # browse with filters
gtfs-tools station "Park Street"                   # open it in the dashboard
gtfs-tools station "Park Street" --data            # or print it in the terminal
gtfs-tools examples                                # every command, with examples
```

- **Output:** with no flag, a command opens the dashboard. `--data` prints a table, `--format json`
  prints JSON, and `--url-only` prints the dashboard link.
- **Help:** `gtfs-tools h <command>` shows the full help for one command. The
  [CLI docs](https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-tools/cli/) list them all.

## Remote feeds

Remote feeds are downloaded first and must be zip files. Download and validation failures (not a zip,
no `stops.txt`) leave the current dataset untouched; a failure during the DuckDB import itself still
clears it, as for local files.

- **Stored source:** the dataset keeps the source without its query string or credentials. A
  pre-signed URL works, and its signature is never stored.
- **Bucket access:** `s3://` and `r2://` use [DuckDB secrets](https://duckdb.org/docs/stable/configuration/secrets_manager).
  - **s3:** the CLI tries a matching secret first, then AWS credentials (env, profile or SSO), then
    anonymous access.
  - **r2 and MinIO:** these need a secret:
    ```bash
    duckdb -c "CREATE PERSISTENT SECRET (TYPE r2, KEY_ID '…', SECRET '…', ACCOUNT_ID '…')"
    ```

Never put credentials in a URL. URLs with a user name or password are refused, and so is an unencoded
`@` in an http(s) path: write it as `%40`.

## Dashboard

The dashboard is the CLI mode of the [GTFS Viz](https://github.com/gabrielAHN/gtfs-viz) web app, served
locally on `127.0.0.1`. Each package bundles the copy pinned in `dashboard.lock.json`: a gtfs-viz
release asset, checked by sha256. It works offline.

## Agent skill

```bash
gtfs-tools install-skill anthropic      # or openai, google, generic
npx skills add gabrielAHN/gtfs-tools    # the skill only
```

## Update

```bash
gtfs-tools update            # updates the package that provides the command; keeps your data
```

## Development

```bash
npm ci && npm run check && npm run build && npm test
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the full test setup with a real DuckDB, how to move the
dashboard pin, and how releases work.

## License

MIT
