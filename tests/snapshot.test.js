import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSnapshot } from '../js/snapshot.js';

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

// REMOTE_ENABLED=false（private repo のため raw 無効）の間は、本番ホストでも相対(Vercel 配信)。
// ?t= キャッシュバスター＋no-store の即時鮮度 I/O を担保する。
test('raw 無効化中: 本番ホストでも相対 URL・?t= 付き・no-store', async () => {
  await withEnv('orbis-beta.vercel.app', async (calls) => {
    await fetchSnapshot('quakes');
    assert.match(calls[0].url, /^data\/snapshots\/quakes\.json\?t=\d+$/);
    assert.equal(calls[0].init.cache, 'no-store');
  });
});

test('local: 相対 URL・?t= 付き・no-store', async () => {
  await withEnv('localhost', async (calls) => {
    await fetchSnapshot('quakes');
    assert.match(calls[0].url, /^data\/snapshots\/quakes\.json\?t=\d+$/);
    assert.equal(calls[0].init.cache, 'no-store');
  });
});
