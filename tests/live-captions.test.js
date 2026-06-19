import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lcWsUrl } from '../js/ui/live-captions.js';

test('lcWsUrl: protocol 既定（http→ws / https→wss）', () => {
  assert.equal(lcWsUrl('', 'http:'), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl('', 'https:'), 'wss://localhost:8900/ws');
  assert.equal(lcWsUrl('?foo=bar', 'https:'), 'wss://localhost:8900/ws');
});

test('lcWsUrl: ?lc=ws|wss が protocol より優先', () => {
  assert.equal(lcWsUrl('?lc=ws', 'https:'), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl('?lc=wss', 'http:'), 'wss://localhost:8900/ws');
  assert.equal(lcWsUrl('?x=1&lc=wss', 'http:'), 'wss://localhost:8900/ws');
});

test('lcWsUrl: protocol 省略時は ws 既定（node 環境）', () => {
  assert.equal(lcWsUrl(''), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl(undefined), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl('?lc=wss'), 'wss://localhost:8900/ws');
});
