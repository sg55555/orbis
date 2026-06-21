import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSnapshot } from '../js/snapshot.js';
import { RAW_BASE } from '../js/lib/data-source.js';

function withEnv(hostname, run) {
  const origLoc = globalThis.location;
  const origFetch = globalThis.fetch;
  const calls = [];
  globalThis.location = { hostname, search: '' };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return Promise.resolve(run(calls)).finally(() => {
    globalThis.location = origLoc;
    globalThis.fetch = origFetch;
  });
}

test('remote(本番ホスト): raw URL・?t= 無し・no-store 無し', async () => {
  await withEnv('orbis-beta.vercel.app', async (calls) => {
    await fetchSnapshot('quakes');
    assert.equal(calls[0].url, `${RAW_BASE}/quakes.json`);
    assert.ok(!calls[0].init || calls[0].init.cache !== 'no-store');
  });
});

test('local: 相対 URL・?t= 付き・no-store', async () => {
  await withEnv('localhost', async (calls) => {
    await fetchSnapshot('quakes');
    assert.match(calls[0].url, /^data\/snapshots\/quakes\.json\?t=\d+$/);
    assert.equal(calls[0].init.cache, 'no-store');
  });
});
