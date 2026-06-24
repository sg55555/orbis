import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, __resetProfileCache } from '../js/lib/drilldown/profile_data.js';

const MAN = { country: { JA: {} }, admin1: { 'JP-13': {} }, city: {} };
const PROF = { id: 'JA', level: 'country', name_ja: '日本', sections: [], degraded: false };

test('country: 素 JSON を取得', async () => {
  __resetProfileCache();
  const fetchFn = async (url) => ({ ok: true, url, json: async () => PROF });
  const p = await loadProfile('country', 'JA', { manifest: MAN, fetchFn });
  assert.equal(p.name_ja, '日本');
});

test('manifest に無い id は fetch せず null', async () => {
  __resetProfileCache();
  let called = 0;
  const fetchFn = async () => { called++; return { ok: true, json: async () => PROF }; };
  const p = await loadProfile('admin1', 'JP-99', { manifest: MAN, fetchFn });
  assert.equal(p, null);
  assert.equal(called, 0);
});

test('admin1 gz: body 無し fake は res.json() フォールバックで展開', async () => {
  __resetProfileCache();
  const a1 = { id: 'JP-13', level: 'admin1', name_ja: '東京都', sections: [], degraded: false };
  const fetchFn = async (url) => ({ ok: true, url, body: null, json: async () => a1 });
  const p = await loadProfile('admin1', 'JP-13', { manifest: MAN, fetchFn });
  assert.equal(p.name_ja, '東京都');
});

test('fetch 失敗は null', async () => {
  __resetProfileCache();
  const fetchFn = async () => ({ ok: false });
  const p = await loadProfile('country', 'JA', { manifest: MAN, fetchFn });
  assert.equal(p, null);
});

test('in-flight: 同一keyの並行呼び出しは fetch を1回だけ共有', async () => {
  __resetProfileCache();
  let called = 0;
  const fetchFn = async () => { called++; await new Promise((r) => setTimeout(r, 5)); return { ok: true, json: async () => PROF }; };
  const [a, b] = await Promise.all([
    loadProfile('country', 'JA', { manifest: MAN, fetchFn }),
    loadProfile('country', 'JA', { manifest: MAN, fetchFn }),
  ]);
  assert.equal(called, 1);
  assert.equal(a.name_ja, '日本');
  assert.equal(b.name_ja, '日本');
});
