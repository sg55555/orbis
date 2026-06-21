import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAW_BASE, REMOTE_ENABLED, hostPrefersRemote, isRemoteData, snapshotBaseUrl, snapshotUrl } from '../js/lib/data-source.js';

const loc = (hostname, search = '') => ({ hostname, search });

test('hostPrefersRemote: ローカルホストは false', () => {
  assert.equal(hostPrefersRemote(loc('localhost')), false);
  assert.equal(hostPrefersRemote(loc('127.0.0.1')), false);
  assert.equal(hostPrefersRemote(loc('[::1]')), false);
  assert.equal(hostPrefersRemote(loc('')), false);
});

test('hostPrefersRemote: 本番/preview ホストは true', () => {
  assert.equal(hostPrefersRemote(loc('orbis-beta.vercel.app')), true);
  assert.equal(hostPrefersRemote(loc('orbis-git-preview.vercel.app')), true);
});

test('hostPrefersRemote: ?data= override 優先', () => {
  assert.equal(hostPrefersRemote(loc('orbis-beta.vercel.app', '?data=local')), false);
  assert.equal(hostPrefersRemote(loc('localhost', '?data=github')), true);
  assert.equal(hostPrefersRemote(loc('localhost', '?foo=1&data=github')), true);
});

test('REMOTE_ENABLED は true（orbis-data へ分離・有効化）', () => {
  assert.equal(REMOTE_ENABLED, true);
});

test('isRemoteData: 本番 true / local false / override', () => {
  assert.equal(isRemoteData(loc('orbis-beta.vercel.app')), true);
  assert.equal(isRemoteData(loc('localhost')), false);
  assert.equal(isRemoteData(loc('localhost', '?data=github')), true);
  assert.equal(isRemoteData(loc('orbis-beta.vercel.app', '?data=local')), false);
});

test('snapshotBaseUrl: remote=RAW_BASE / local=相対', () => {
  assert.equal(snapshotBaseUrl(loc('orbis-beta.vercel.app')), RAW_BASE);
  assert.equal(snapshotBaseUrl(loc('localhost')), 'data/snapshots');
});

test('snapshotUrl: remote=orbis-data raw / local=相対（?t= なし）', () => {
  assert.equal(snapshotUrl('quakes', loc('localhost')), 'data/snapshots/quakes.json');
  assert.equal(snapshotUrl('quakes', loc('orbis-beta.vercel.app')), RAW_BASE + '/quakes.json');
});

test('RAW_BASE が orbis-data ルート', () => {
  assert.equal(RAW_BASE, 'https://raw.githubusercontent.com/sg55555/orbis-data/main');
});
