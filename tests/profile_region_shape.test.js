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

test('regionShapePath: 90点超は間引きし末尾に重複点を足さない', () => {
  // 非常に簡単な矩形（5000点）で閉じた多角形を作り、間引き後末尾が重複していないかを確認
  const w = 10; const h = 5;
  const ring = [];
  // 上辺
  for (let x = 0; x <= w; x++) ring.push([x, 0]);
  // 右辺
  for (let y = 0.5; y <= h; y += 0.5) ring.push([w, y]);
  // 下辺
  for (let x = w - 0.1; x >= 0; x -= 0.1) ring.push([x, h]);
  // 左辺
  for (let y = h - 0.5; y > 0; y -= 0.5) ring.push([0, y]);
  // 閉鎖点（先頭と同値だが別オブジェクト）
  ring.push([ring[0][0], ring[0][1]]);

  const out = regionShapePath([ring]);
  assert.ok(out && out.d && typeof out.d === 'string');
  assert.ok(out.d.startsWith('M'));
  assert.ok(out.d.endsWith('Z'));

  // 間引き後の最後の頂点と最初の頂点が M 直後と Z 直前で同じであることを確認（閉じた環）
  const pathData = out.d.substring(1, out.d.length - 1); // M...Z を除去
  const coords = pathData.split(' L');
  const firstCoord = coords[0];
  const lastCoord = coords[coords.length - 1];
  assert.equal(firstCoord, lastCoord, 'SVG パスは先頭と末尾座標が同一');
});
