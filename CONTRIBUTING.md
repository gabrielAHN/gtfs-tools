# Contributing

## Build and check

```bash
git clone --recurse-submodules https://github.com/gabrielAHN/gtfs-tools.git   # or: git submodule update --init
npm ci
npm run check            # tsc --noEmit
npm run build            # build:cli (tsc + esbuild bundle into dist/index.js) + dashboard (from gtfs-viz/)
node dist/index.js --help
```

The bundle has no runtime npm dependencies: only Node built-ins stay external. The extension client,
the import SQL and the named queries live in `src/gtfs/`. The CLI talks to the `gtfs` DuckDB extension
directly, through the DuckDB CLI.

## Tests

```bash
npm run build:cli        # the tests run dist/index.js
npm test                 # node --test tests/*.test.mjs
```

The DuckDB integration tests skip unless a real DuckDB CLI and `gtfs` extension are configured. CI runs
them and requires 0 skipped. To run them locally, fill two extension directories from the DuckDB
community repository:

```bash
duckdb -c "SET extension_directories=['$PWD/build/deps']; INSTALL spatial; INSTALL httpfs; INSTALL aws;"
duckdb -c "SET extension_directories=['$PWD/build/gtfs']; INSTALL gtfs FROM community;"

env -u AI_AGENT \
  DUCKDB_BIN="$(command -v duckdb)" \
  GTFS_EXTENSION="$(ls "$PWD"/build/gtfs/v2.0.0/*/gtfs.duckdb_extension)" \
  GTFS_DEPENDENCY_CACHE="$PWD/build/deps" \
  AWS_CONFIG_FILE=/nonexistent AWS_SHARED_CREDENTIALS_FILE=/nonexistent AWS_EC2_METADATA_DISABLED=true \
  node --test tests/*.test.mjs
```

- Use a DuckDB **v2.0.0** CLI.
- Keep `gtfs` out of the dependency directory. The tests load or serve `GTFS_EXTENSION` themselves.
- Unset `AI_AGENT`: with it set, DuckDB 2.0 switches to agent mode and its output changes.
- The dead AWS paths keep your own AWS configuration out of the S3 tests.

## The dashboard and the gtfs-viz submodule

`gtfs-viz/` is a git submodule of [gabrielAHN/gtfs-viz](https://github.com/gabrielAHN/gtfs-viz), pinned
to one commit. `npm run dashboard` (`scripts/build-dashboard.mjs`) runs
`yarn install --frozen-lockfile --ignore-engines` and `yarn build:dashboard` there, with `AI_AGENT`
unset, and installs the result (`gtfs-viz/packages/web/dist`) into `dashboard/`. It needs yarn 1.x on
`PATH` (`npm install -g yarn`, or `corepack enable`). The build's `dashboard-manifest.json` must name
`gtfs-viz-dashboard` and declare `cliApi: 1`; its `commit` is the submodule commit. Links, hard links
and devices in the build are refused; source maps and `.DS_Store` are left out.

- **Move the pin:** check out another gtfs-viz commit or tag, rebuild, test, and commit the submodule
  pointer:
  ```bash
  git -C gtfs-viz fetch
  git -C gtfs-viz checkout <commit or tag>
  npm run build && npm test
  git add gtfs-viz && git commit -m "build: pin gtfs-viz <commit or tag>"
  ```
  `tests/dashboard-cli-client-drift.test.mjs` compares `tests/fixtures/dashboard-cli-client/` with
  `gtfs-viz/packages/web/src/lib/cli/`; if it fails, copy the changed file over. A change to the CLI API
  bumps `cliApi` in both repositories together.
- **Flags:**
  - `--source <dir>`: build another gtfs-viz checkout instead of `gtfs-viz/`.
  - `--dist <dir>`: install a dashboard that is already built, without building.
  - `--out <dir>`: only replaces a missing or empty directory, or an older dashboard. Anything else is
    refused untouched.
- **Not published:** the npm package never contains `gtfs-viz/`. `files` lists only what ships, and CI
  checks `npm pack`.
- **Another build:** `GTFS_VIZ_DASHBOARD_DIST=<dir>` serves a different dashboard build at runtime.

## Packages and releases

- **Compatibility package:** `compat/gtfs-viz-cli` is `@gabrielahn/gtfs-viz-cli`. Its `prepack`
  generates `skills/gtfs-viz/` from `skills/gtfs-tools/`, the same skill under its old name. That copy
  is what lets 1.5.x's own `update --provider` upgrade it.
- **Version bump:** bump the version in all of these together, so both packages always share one
  version, and add a `CHANGELOG.md` entry:
  - `package.json`;
  - `compat/gtfs-viz-cli/package.json`, both its `version` and its `@gabrielahn/gtfs-tools` dependency;
  - `skills/gtfs-tools/SKILL.md`.
- **Release:** merging a PR that bumps the version runs `.github/workflows/release.yml`.
  1. A read-only job checks out the submodule, checks, builds (the dashboard from the pinned gtfs-viz
     commit) and packs both packages.
  2. A second job tags `v<version>`, creates the GitHub release, and publishes `@gabrielahn/gtfs-tools`,
     then `@gabrielahn/gtfs-viz-cli`, at that version with `--tag latest`.
