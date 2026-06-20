import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnabled, toggleEnabled } from '../js/lib/state.js';

const ALL = ['quakes', 'flights', 'conflict', 'protests', 'trade'];

test('loadEnabled: stored が null なら全レイヤー ON', () => {
  const e = loadEnabled(ALL, null);
  assert.deepEqual([...e].sort(), [...ALL].sort());
});

test('loadEnabled: stored 配列は有効idのみに絞る（未知idは捨てる）', () => {
  const e = loadEnabled(ALL, ['quakes', 'trade', 'ghost']);
  assert.deepEqual([...e].sort(), ['quakes', 'trade']);
});

test('loadEnabled: stored が空配列なら全 OFF', () => {
  assert.equal(loadEnabled(ALL, []).size, 0);
});

test('loadEnabled: 壊れた stored（非配列）は全 ON にフォールバック', () => {
  assert.equal(loadEnabled(ALL, 'garbage').size, ALL.length);
});

test('toggleEnabled: 新しい Set を返し、元を破壊しない', () => {
  const base = new Set(['quakes']);
  const off = toggleEnabled(base, 'quakes');
  assert.equal(off.has('quakes'), false);
  assert.equal(base.has('quakes'), true); // 元は不変
  const on = toggleEnabled(base, 'flights');
  assert.equal(on.has('flights'), true);
  assert.equal(on.has('quakes'), true);
});

test('loadEnabled: stored=null かつ defaultOff 指定で、その id だけ OFF・他は ON', () => {
  const e = loadEnabled(['quakes', 'airtemp'], null, ['airtemp']);
  assert.equal(e.has('quakes'), true);
  assert.equal(e.has('airtemp'), false);
});

test('loadEnabled: stored 指定時は defaultOff を無視し stored を尊重', () => {
  const e = loadEnabled(['quakes', 'airtemp'], ['airtemp'], ['airtemp']);
  assert.deepEqual([...e], ['airtemp']);
});

test('loadEnabled: stored=null かつ defaultOn 指定で defaultOn の集合になる', () => {
  const e = loadEnabled(['quakes', 'flights', 'conflict', 'news'], null, [], ['quakes', 'news']);
  assert.deepEqual([...e].sort(), ['news', 'quakes']);
});

test('loadEnabled: defaultOn は allIds に無いidを含めない', () => {
  const e = loadEnabled(['quakes', 'news'], null, [], ['quakes', 'ghost']);
  assert.deepEqual([...e], ['quakes']);
});

test('loadEnabled: stored 指定時は defaultOn を無視', () => {
  const e = loadEnabled(['quakes', 'news'], ['news'], [], ['quakes']);
  assert.deepEqual([...e], ['news']);
});
