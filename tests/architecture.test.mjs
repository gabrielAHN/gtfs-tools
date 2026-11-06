// Adapted from gabrielAHN/gtfs-viz tests/architecture.test.mjs at 819f8df ("consumers and built artifacts contain
// no database toolbox implementation"): the SQL toolbox lives in the gtfs DuckDB extension, so neither the CLI
// sources, its scripts, the bundle (dist/) nor the bundled dashboard embed macro or table definitions. The paths
// are this repository's; the pattern and the forbidden leftovers are unchanged. Not ported: "docs site is
// separate from the web application" (the docs and the web app stay in gtfs-viz).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.git', '.hermes', '.local'].includes(entry.name)) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
test('consumers and built artifacts contain no database toolbox implementation', () => {
  const candidates = ['src', 'scripts', 'dist', 'dashboard'].filter(dir => existsSync(resolve(root, dir))).flatMap(dir => files(resolve(root, dir)));
  const violations = candidates.filter(path => {
    if (/\/tests?\//.test(path) || !/\.(ts|tsx|js|mjs|sql|hpp|cpp|h|c|cmake)$/.test(path)) return false;
    return /CREATE\s+(?:OR\s+REPLACE\s+)?MACRO\s+\w+|GTFS_(?:LOAD|INIT|REROUTE)_SQL|stops_with_casts|pathways_with_casts|routes_with_casts|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:RouteShape\w+|calendar(?:_dates)?|StopsView|PathwaysView|pathway_network)\s*\(/.test(readFileSync(path, 'utf8'));
  });
  assert.deepEqual(violations.map(path => relative(root, path)), []);
  for (const path of ['extensions', 'duckdb', 'extension-ci-tools', 'CMakeLists.txt', 'extension_config.cmake', 'skills/gtfs-tools/references/procedures.md']) assert.equal(existsSync(resolve(root, path)), false, path);
});
