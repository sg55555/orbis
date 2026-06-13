import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointAlongPath, diffNewIds } from '../js/lib/motion.js';

const path = [[0, 0], [10, 0], [10, 10]]; // 総長 20（各辺10）

test('pointAlongPath: t=0 は始点、t=1 は終点', () => {
  assert.deepEqual(pointAlongPath(path, 0), [0, 0]);
  assert.deepEqual(pointAlongPath(path, 1), [10, 10]);
});

test('pointAlongPath: t=0.5 は経路の中点（最初の辺の終わり）', () => {
  const p = pointAlongPath(path, 0.5);
  assert.ok(Math.abs(p[0] - 10) < 1e-6);
  assert.ok(Math.abs(p[1] - 0) < 1e-6);
});

test('pointAlongPath: t=0.75 は2辺目の中間', () => {
  const p = pointAlongPath(path, 0.75);
  assert.ok(Math.abs(p[0] - 10) < 1e-6);
  assert.ok(Math.abs(p[1] - 5) < 1e-6);
});

test('pointAlongPath: t は [0,1] にクランプ', () => {
  assert.deepEqual(pointAlongPath(path, -1), [0, 0]);
  assert.deepEqual(pointAlongPath(path, 2), [10, 10]);
});

test('pointAlongPath: 退化パス（点1個/空）は始点 or null', () => {
  assert.deepEqual(pointAlongPath([[3, 4]], 0.5), [3, 4]);
  assert.equal(pointAlongPath([], 0.5), null);
});

test('diffNewIds: 前回に無く今回にある id を返す', () => {
  const prev = new Set(['a', 'b']);
  assert.deepEqual(diffNewIds(prev, [{ id: 'b' }, { id: 'c' }, { id: 'd' }]).sort(), ['c', 'd']);
});

test('diffNewIds: prev が空（初回）は新規なし扱い', () => {
  assert.deepEqual(diffNewIds(null, [{ id: 'a' }]), []);
});
