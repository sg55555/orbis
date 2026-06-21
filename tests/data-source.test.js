import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAW_BASE, isRemoteData, snapshotBaseUrl, snapshotUrl } from '../js/lib/data-source.js';

const loc = (hostname, search = '') => ({ hostname, search });

test('isRemoteData: ローカルホストは false', () => {
  assert.equal(isRemoteData(loc('localhost')), false);
  assert.equal(isRemoteData(loc('127.0.0.1')), false);
  assert.equal(isRemoteData(loc('[::1]')), false);
  assert.equal(isRemoteData(loc('')), false); // file://
});

test('isRemoteData: 本番/preview ホストは true', () => {
  assert.equal(isRemoteData(loc('orbis-beta.vercel.app')), true);
  assert.equal(isRemoteData(loc('orbis-git-preview.vercel.app')), true);
});

test('isRemoteData: ?data= override がホスト判定に優先', () => {
  assert.equal(isRemoteData(loc('orbis-beta.vercel.app', '?data=local')), false);
  assert.equal(isRemoteData(loc('localhost', '?data=github')), true);
  assert.equal(isRemoteData(loc('localhost', '?foo=1&data=github')), true);
});

test('snapshotBaseUrl: remote=RAW_BASE / local=相対', () => {
  assert.equal(snapshotBaseUrl(loc('orbis-beta.vercel.app')), RAW_BASE);
  assert.equal(snapshotBaseUrl(loc('localhost')), 'data/snapshots');
});

test('snapshotUrl: name を .json 付き完全URLに（?t= は付けない）', () => {
  assert.equal(snapshotUrl('quakes', loc('localhost')), 'data/snapshots/quakes.json');
  assert.equal(snapshotUrl('quakes', loc('orbis-beta.vercel.app')), `${RAW_BASE}/quakes.json`);
});
