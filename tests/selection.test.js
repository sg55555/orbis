import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionPopupHtml, buildReticleConfigs, escapeHtml, flightPopupHtml } from '../js/lib/selection.js';

test('escapeHtml: HTMLメタ文字を実体参照に / null→空', () => {
  assert.equal(escapeHtml('<b>"&"</b>'), '&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
});

test('selectionPopupHtml: タイトルをエスケープし移動ガイドを含む', () => {
  const html = selectionPopupHtml({ title: '紛争 <ウクライナ>（UP）', layerId: 'conflict' });
  assert.match(html, /紛争 &lt;ウクライナ&gt;（UP）/);  // エスケープ済み
  assert.match(html, /この地点へ移動/);                  // 操作ガイド
  assert.match(html, /rgb\(255,60,80\)/);                // conflict=赤の色ドット
});

test('selectionPopupHtml: 未知レイヤーはシアンにフォールバック', () => {
  assert.match(selectionPopupHtml({ title: 'x' }), /rgb\(57,208,255\)/);
});

test('buildReticleConfigs: selected が無ければ空配列', () => {
  assert.deepEqual(buildReticleConfigs(null, 0), []);
});

test('buildReticleConfigs: reduced=true は静的3層（glow/ring/dot, ping無し）', () => {
  const cfgs = buildReticleConfigs({ lon: 10, lat: 20 }, 0, { reduced: true });
  assert.deepEqual(cfgs.map((c) => c.id), ['sel-glow', 'sel-ring', 'sel-dot']);
  const ring = cfgs.find((c) => c.id === 'sel-ring');
  assert.equal(ring.getRadius, 22);
  assert.deepEqual(ring.getPosition({ lon: 10, lat: 20 }), [10, 20]);
});

test('buildReticleConfigs: 通常は4層（ping追加）', () => {
  const cfgs = buildReticleConfigs({ lon: 0, lat: 0, at: 0 }, 100, { reduced: false });
  assert.deepEqual(cfgs.map((c) => c.id), ['sel-glow', 'sel-ring', 'sel-dot', 'sel-ping']);
});

test('buildReticleConfigs: ping半径は経過時間で拡大しループする', () => {
  const sel = { lon: 0, lat: 0, at: 0 };
  const r0 = buildReticleConfigs(sel, 0).find((c) => c.id === 'sel-ping').getRadius;
  const r1 = buildReticleConfigs(sel, 700).find((c) => c.id === 'sel-ping').getRadius;
  assert.ok(r1 > r0, 'ping は時間経過で拡大する');
  // 1周(1400ms)でほぼ最小に戻る
  const rLoop = buildReticleConfigs(sel, 1400).find((c) => c.id === 'sel-ping').getRadius;
  assert.ok(Math.abs(rLoop - r0) < 1, 'PING周期でリセット');
});

test('selectionPopupHtml: 座標行を含む（lon/lat があるとき）', () => {
  const html = selectionPopupHtml({ title: 'M5 Tokyo', layerId: 'quakes', lon: 139.7, lat: 35.6, time: Date.UTC(2026,5,14,2,0,0) });
  assert.match(html, /35\.6/);   // 緯度
  assert.match(html, /139\.7/);  // 経度
});

test('flightPopupHtml: 便名/高度/速度/推定到達を含み、エスケープ', () => {
  const html = flightPopupHtml({ callsign: 'AB<1>', alt: 1800, velocity: 200, heading: 90, on_ground: false }, [10.5, 20.25]);
  assert.match(html, /AB&lt;1&gt;/);
  assert.match(html, /1800m/);
  assert.match(html, /200m\/s/);
  assert.match(html, /推定到達/);
  assert.match(html, /20\.25/);
});

test('flightPopupHtml: arrival が null でも安全（—）', () => {
  const html = flightPopupHtml({ callsign: 'X', alt: null, velocity: 0, heading: 0, on_ground: true }, null);
  assert.match(html, /地上/);
  assert.match(html, /—/);
});
