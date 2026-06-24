import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionShapePath } from '../js/lib/drilldown/region_shape.js';

test('regionShapePath: 最大環を viewBox 正規化（長辺100・Y反転）', () => {
  // 小三角と、横長(幅10×高さ2)の大三角。大きい方が選ばれる。
  const rings = [
    [[0, 0], [1, 0], [0.5, 0.5], [0, 0]],
    [[0, 0], [10, 0], [5, 2], [0, 0]],
  ];
  const out = regionShapePath(rings);
  assert.ok(out && typeof out.d === 'string');
  assert.equal(out.viewBox, '0 0 100 20');    // 幅10→100, 高さ2→20
  assert.ok(out.d.startsWith('M'));
  assert.ok(out.d.endsWith('Z'));
  // Y 反転: y=0(最下) → 20, y=2(最上) → 0。最上頂点(5,2)が y≈0 付近に出る。
  assert.match(out.d, /50,0/);
});

test('regionShapePath: 空/点不足は null', () => {
  assert.equal(regionShapePath([]), null);
  assert.equal(regionShapePath([[[0, 0], [1, 1]]]), null);  // 3点未満
  assert.equal(regionShapePath(null), null);
});
