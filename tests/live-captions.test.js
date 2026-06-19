import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lcWsUrl } from '../js/ui/live-captions.js';

test('lcWsUrl: 既定は ws://localhost:8900/ws', () => {
  assert.equal(lcWsUrl(''), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl('?foo=bar'), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl(undefined), 'ws://localhost:8900/ws');
});

test('lcWsUrl: ?lc=wss で wss://localhost:8900/ws', () => {
  assert.equal(lcWsUrl('?lc=wss'), 'wss://localhost:8900/ws');
  assert.equal(lcWsUrl('?x=1&lc=wss'), 'wss://localhost:8900/ws');
});

test('lcWsUrl: lc=ws など wss 以外は ws', () => {
  assert.equal(lcWsUrl('?lc=ws'), 'ws://localhost:8900/ws');
});
