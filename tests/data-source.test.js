import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAW_BASE, REMOTE_ENABLED, hostPrefersRemote, isRemoteData, snapshotBaseUrl, snapshotUrl } from '../js/lib/data-source.js';

const loc = (hostname, search = '') => ({ hostname, search });

// hostPrefersRemote はフラグ非依存の純判定（将来 REMOTE_ENABLED=true で有効化する時の挙動を担保）。
test('hostPrefersRemote: ローカルホストは false', () => {
  assert.equal(hostPrefersRemote(loc('localhost')), false);
  assert.equal(hostPrefersRemote(loc('127.0.0.1')), false);
  assert.equal(hostPrefersRemote(loc('[::1]')), false);
  assert.equal(hostPrefersRemote(loc('')), false); // file://
});

test('hostPrefersRemote: 本番/preview ホストは true', () => {
  assert.equal(hostPrefersRemote(loc('orbis-beta.vercel.app')), true);
  assert.equal(hostPrefersRemote(loc('orbis-git-preview.vercel.app')), true);
});

test('hostPrefersRemote: ?data= override がホスト判定に優先', () => {
  assert.equal(hostPrefersRemote(loc('orbis-beta.vercel.app', '?data=local')), false);
  assert.equal(hostPrefersRemote(loc('localhost', '?data=github')), true);
  assert.equal(hostPrefersRemote(loc('localhost', '?foo=1&data=github')), true);
});

// orbis は PRIVATE のため raw を無効化中（REMOTE_ENABLED=false）。
// その間は環境/override に関わらず常に相対(=Vercel 配信)になることを担保する。
test('REMOTE_ENABLED は false（private repo のため raw 無効）', () => {
  assert.equal(REMOTE_ENABLED, false);
});

test('isRemoteData: raw 無効化中は常に false（本番ホスト/override でも）', () => {
  assert.equal(isRemoteData(loc('localhost')), false);
  assert.equal(isRemoteData(loc('orbis-beta.vercel.app')), false);
  assert.equal(isRemoteData(loc('localhost', '?data=github')), false);
});

test('snapshotBaseUrl: raw 無効化中は常に相対', () => {
  assert.equal(snapshotBaseUrl(loc('orbis-beta.vercel.app')), 'data/snapshots');
  assert.equal(snapshotBaseUrl(loc('localhost')), 'data/snapshots');
});

test('snapshotUrl: raw 無効化中は常に相対の .json（?t= は付けない）', () => {
  assert.equal(snapshotUrl('quakes', loc('localhost')), 'data/snapshots/quakes.json');
  assert.equal(snapshotUrl('quakes', loc('orbis-beta.vercel.app')), 'data/snapshots/quakes.json');
});

// RAW_BASE 定数は将来の再有効化に備えて保持されていることを確認。
test('RAW_BASE 定数は保持（将来 re-enable 用）', () => {
  assert.equal(RAW_BASE, 'https://raw.githubusercontent.com/sg55555/orbis/main/data/snapshots');
});
