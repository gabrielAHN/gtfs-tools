// Ported from gabrielAHN/gtfs-viz packages/duckdb-client/tests/client.test.mjs at 819f8df for the copied
// extension client (src/gtfs/client.ts). Assertions are unchanged; only the module path changed. Run from the
// repository root (esbuild metafile paths are relative to the working directory).
// Not ported: 'published client entry imports without embedded SQL or workspace dependencies' checks the
// duckdb-client package's exports and dist/, which do not exist here (the bundle inlines the client).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function clientModule() {
  const result = await build({ entryPoints: ['src/gtfs/client.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, metafile: true });
  assert.deepEqual(Object.keys(result.metafile.inputs), ['src/gtfs/client.ts']);
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}

test('client is independent and explicit, with one query per lifecycle operation', async () => {
  const { createExtensionClient } = await clientModule();
  const queries = [];
  const client = createExtensionClient({ query: async sql => { queries.push(sql); } }, { repository: 'https://example.test/extensions' });
  assert.deepEqual(queries, []);
  for (const operation of ['install', 'load', 'prepare', 'init', 'refresh']) await client[operation]();
  assert.deepEqual(queries, ["INSTALL gtfs FROM 'https://example.test/extensions'", 'LOAD gtfs', 'PRAGMA gtfs_prepare', 'PRAGMA gtfs_init', 'PRAGMA gtfs_refresh']);
});

test('repository must be explicit, HTTP(S), unambiguous, and credential-free', async () => {
  const { createExtensionClient } = await clientModule();
  const queries = [];
  for (const repository of ['', 'Community', 'community ', 'file:///tmp/extensions', 'ftp://host/ext', ' https://host', 'https://host\n', 'https://u:p@host', 'https://host/ext?q=x', 'https://host/ext#hash', 'https://host/\\evil', 'https://']) {
    assert.throws(() => createExtensionClient({ query: async sql => queries.push(sql) }, { repository }), /repository/i, String(repository));
  }
  assert.deepEqual(queries, []);
});

test('the community repository installs by its keyword, not as a string literal', async () => {
  const { createExtensionClient } = await clientModule();
  const queries = [];
  const client = createExtensionClient({ query: async sql => { queries.push(sql); } }, { repository: 'community' });
  await client.install();
  await client.load();
  assert.deepEqual(queries, ['INSTALL gtfs FROM community', 'LOAD gtfs']);
});

test('repository literals are escaped and captured before caller mutation', async () => {
  const { createExtensionClient } = await clientModule();
  const queries = [];
  const options = { repository: "http://127.0.0.1:9000/o'hare" };
  const client = createExtensionClient({ query: async sql => queries.push(sql) }, options);
  options.repository = 'https://other.test';
  await client.install();
  assert.deepEqual(queries, ["INSTALL gtfs FROM 'http://127.0.0.1:9000/o''hare'"]);
});

test('failures retain causes and operation context without retries or SQL fallback', async () => {
  const { createExtensionClient } = await clientModule();
  for (const operation of ['install', 'load', 'prepare', 'init', 'refresh']) {
    const cause = new Error('engine failure sentinel');
    const queries = [];
    const client = createExtensionClient({ query: async sql => { queries.push(sql); throw cause; } }, { repository: 'https://example.test/ext' });
    await assert.rejects(client[operation](), error => {
      assert.equal(error.cause, cause);
      assert.match(error.message, new RegExp(operation));
      assert.match(error.message, /engine failure sentinel/);
      if (operation === 'install' || operation === 'load') assert.match(error.message, /version|ABI|signature/i);
      return true;
    });
    assert.equal(queries.length, 1);
  }
});

test('load completion awaits the executor and does not run pragmas implicitly', async () => {
  const { createExtensionClient } = await clientModule();
  let finish;
  const queries = [];
  const client = createExtensionClient({ query: sql => {
    queries.push(sql);
    return new Promise(resolve => { finish = resolve; });
  } }, { repository: 'https://example.test/ext' });
  let completed = false;
  const loading = client.load().then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(queries, ['LOAD gtfs']);
  finish();
  await loading;
  assert.equal(completed, true);
});

test('SQL-looking repository paths remain inside one escaped literal', async () => {
  const { createExtensionClient } = await clientModule();
  const queries = [];
  const client = createExtensionClient({ query: async sql => queries.push(sql) }, { repository: "https://example.test/';SELECT(1);--" });
  await client.install();
  assert.deepEqual(queries, ["INSTALL gtfs FROM 'https://example.test/'';SELECT(1);--'"]);
});

test('unconfigured client loads only an installed artifact and refuses installation', async () => {
  const { createExtensionClient } = await clientModule();
  const queries = [];
  const client = createExtensionClient({ query: async sql => queries.push(sql) }, {});
  assert.throws(() => client.install(), /Configure GTFS_EXTENSION_REPOSITORY/);
  await client.load();
  assert.deepEqual(queries, ['LOAD gtfs']);
  const cause = new Error('not installed');
  await assert.rejects(createExtensionClient({ query: async () => { throw cause; } }, {}).load(), error => error.cause === cause && /VITE_GTFS_EXTENSION_REPOSITORY/.test(error.message));
});
