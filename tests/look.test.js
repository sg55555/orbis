import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentLookId, getLook, LOOKS, DEFAULT_LOOK } from '../js/lib/look.js';

test('currentLookId: ?look=B を読む（大小無視）', () => {
  assert.equal(currentLookId('?look=B'), 'B');
  assert.equal(currentLookId('?foo=1&look=c'), 'C');
});

test('currentLookId: 未指定/無効は DEFAULT_LOOK', () => {
  assert.equal(currentLookId(''), DEFAULT_LOOK);
  assert.equal(currentLookId('?look=Z'), DEFAULT_LOOK);
  assert.equal(currentLookId('?look=99'), DEFAULT_LOOK);
});

test('getLook: 各プリセットが sky/water/land/nebula/glass を備える', () => {
  for (const id of Object.keys(LOOKS)) {
    const l = getLook(`?look=${id}`);
    assert.ok(l.sky && typeof l.sky.atmosphere === 'number', `${id} sky.atmosphere`);
    assert.match(l.water, /^#[0-9a-f]{6}$/i, `${id} water`);
    assert.match(l.land, /^#[0-9a-f]{6}$/i, `${id} land`);
    assert.ok(l.nebula.base, `${id} nebula.base`);
    assert.ok(typeof l.glass.blur === 'number' && l.glass.bg && l.glass.rim, `${id} glass`);
  }
});
