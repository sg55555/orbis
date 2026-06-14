import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointAlongPath, diffNewIds, normalizedTimestamps } from '../js/lib/motion.js';

const path = [[0, 0], [10, 0], [10, 10]]; // 総長 20（各辺10）

test('normalizedTimestamps: 累積距離を [0,1] に正規化', () => {
  assert.deepEqual(normalizedTimestamps([[0, 0], [10, 0]]), [0, 1]);
  assert.deepEqual(normalizedTimestamps([[0, 0], [5, 0], [10, 0]]), [0, 0.5, 1]);
  assert.deepEqual(normalizedTimestamps([]), []);
  assert.deepEqual(normalizedTimestamps([[1, 1]]), [0]);
});

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

test('pointAlongPath: 辺長が不均一でも累積長で正しく補間', () => {
  // 辺長 1 / 3 / 1（総長5）。t=0.5 → 距離2.5 = 2辺目の中間 [1,1.5]
  const uneven = [[0, 0], [1, 0], [1, 3], [2, 3]];
  const p = pointAlongPath(uneven, 0.5);
  assert.ok(Math.abs(p[0] - 1) < 1e-9);
  assert.ok(Math.abs(p[1] - 1.5) < 1e-9);
  // t=0.8 → 距離4 = 3辺目の始点 [1,3]
  const q = pointAlongPath(uneven, 0.8);
  assert.ok(Math.abs(q[0] - 1) < 1e-9);
  assert.ok(Math.abs(q[1] - 3) < 1e-9);
});

test('diffNewIds: 前回に無く今回にある id を返す', () => {
  const prev = new Set(['a', 'b']);
  assert.deepEqual(diffNewIds(prev, [{ id: 'b' }, { id: 'c' }, { id: 'd' }]).sort(), ['c', 'd']);
});

test('diffNewIds: prev が空（初回）は新規なし扱い', () => {
  assert.deepEqual(diffNewIds(null, [{ id: 'a' }]), []);
});
