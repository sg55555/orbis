import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionPopupHtml, buildReticleConfigs, escapeHtml, flightPopupHtml, buildProjectionConfigs, shipPopupHtml, projLabel, gdeltEventPopupHtml, gdeltCountryPopupHtml } from '../js/lib/selection.js';

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

test('flightPopupHtml: 便名/高度/速度/推定進路を含み、エスケープ', () => {
  const html = flightPopupHtml({ callsign: 'AB<1>', alt: 1800, velocity: 200, heading: 90, on_ground: false }, [10.5, 20.25], 20);
  assert.match(html, /AB&lt;1&gt;/);
  assert.match(html, /1800m/);
  assert.match(html, /200m\/s/);
  assert.match(html, /推定進路/);
  assert.match(html, /約20分後/);
  assert.match(html, /20\.25/);
  assert.match(html, /目的地データ無し/);
});

test('flightPopupHtml: arrival が null でも安全（—）', () => {
  const html = flightPopupHtml({ callsign: 'X', alt: null, velocity: 0, heading: 0, on_ground: true }, null);
  assert.match(html, /地上/);
  assert.match(html, /—/);
});

test('buildProjectionConfigs: arrival 無し / sel 無しは空配列', () => {
  assert.deepEqual(buildProjectionConfigs({ src: [0, 0], arrival: null, prefix: 'ship' }, 0), []);
  assert.deepEqual(buildProjectionConfigs(null, 0), []);
});

test('buildProjectionConfigs: prefix 反映・line+arrival+flow+pulse の4種', () => {
  const cfgs = buildProjectionConfigs({ src: [0, 0], arrival: [1, 1], prefix: 'ship' }, 0.3, { reduced: false });
  assert.deepEqual(cfgs.map((c) => c.config.id), ['ship-route', 'ship-arrival', 'ship-flow', 'ship-arrival-pulse']);
  assert.equal(cfgs[0].kind, 'line');
  assert.equal(cfgs[1].kind, 'scatter');
});

test('buildProjectionConfigs: reduced は flow/pulse を省く', () => {
  const cfgs = buildProjectionConfigs({ src: [0, 0], arrival: [1, 1], prefix: 'flight' }, 0, { reduced: true });
  assert.deepEqual(cfgs.map((c) => c.config.id), ['flight-route', 'flight-arrival']);
});

test('shipPopupHtml: 船名・船種・速度・航路・推定到達', () => {
  const html = shipPopupHtml({ mmsi: 7, name: 'EVER GIVEN', type: '貨物船', sog: 12.3, cog: 45 }, [2.5, 1.5], 600);
  assert.match(html, /🚢 EVER GIVEN/);
  assert.match(html, /船種 貨物船｜速度 12kn｜航路 045°/);
  assert.match(html, /約10時間後 1\.50, 2\.50/);
});

test('projLabel: 分/時間/時分の整形', () => {
  assert.equal(projLabel(20), '約20分後');
  assert.equal(projLabel(59), '約59分後');
  assert.equal(projLabel(60), '約1時間後');
  assert.equal(projLabel(90), '約1時間30分後');
  assert.equal(projLabel(600), '約10時間後');
  assert.equal(projLabel(0), '約0分後');
});

test('shipPopupHtml: 船名無しは MMSI、進路無しは推定不可', () => {
  const html = shipPopupHtml({ mmsi: 7, name: null, type: null, sog: null, cog: null }, null, 60);
  assert.match(html, /🚢 MMSI 7/);
  assert.match(html, /船種 不明｜速度 —｜航路 —/);
  assert.match(html, /進路推定不可/);
});

test('gdeltEventPopupHtml: 紛争はサブタイプ括弧・記事リンク http のみ', () => {
  const html = gdeltEventPopupHtml({ place: 'UP', root: '19', mentions: 92, url: 'https://reuters.com/x' }, 'conflict');
  assert.match(html, /紛争（戦闘）/);
  assert.match(html, /ウクライナ/);
  assert.match(html, /報道 92件/);
  assert.match(html, /href="https:\/\/reuters\.com\/x"/);
});

test('gdeltEventPopupHtml: 抗議はサブタイプ無し・不正 url は # に', () => {
  const html = gdeltEventPopupHtml({ place: 'FR', root: '14', mentions: 5, url: 'javascript:alert(1)' }, 'protests');
  assert.match(html, /抗議/);
  assert.doesNotMatch(html, /（/); // サブタイプ括弧なし
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /javascript:/);
});

test('gdeltCountryPopupHtml: 国サマリ（件数・最多種類・出典）・紛争のみ最多表示', () => {
  const c = gdeltCountryPopupHtml({ layerId: 'conflict', country_ja: 'ウクライナ', count: 148, dominantRootJa: '戦闘', topSources: ['reuters.com', 'bbc.com'] });
  assert.match(c, /紛争 ウクライナ/);
  assert.match(c, /24h 148件/);
  assert.match(c, /最多は戦闘/);
  assert.match(c, /reuters\.com、bbc\.com/);
  const p = gdeltCountryPopupHtml({ layerId: 'protests', country_ja: 'フランス', count: 31, topSources: [] });
  assert.match(p, /抗議 フランス/);
  assert.doesNotMatch(p, /最多は/); // 抗議は最多種類を出さない
});

test('gdelt popups: null 安全', () => {
  assert.equal(typeof gdeltEventPopupHtml(null, 'conflict'), 'string');
  assert.equal(typeof gdeltCountryPopupHtml(null), 'string');
});
