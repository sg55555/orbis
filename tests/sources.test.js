import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceRows, sourceRowHtml, SOURCE_MAP } from '../js/ui/sources.js';

const NOW = Date.parse('2026-06-23T12:00:00Z');

test('buildSourceRows: label/件数/出典/URL を写し、相対時刻を now から計算', () => {
  const layers = [{ id: 'quakes', label: '地震' }];
  const snapshots = { quakes: { updated: '2026-06-23T11:30:00Z' } }; // 30分前
  const counts = { quakes: 312 };
  const srcMap = { quakes: { source: 'USGS', url: 'https://earthquake.usgs.gov' } };
  const [row] = buildSourceRows(layers, snapshots, counts, srcMap, NOW);
  assert.equal(row.label, '地震');
  assert.equal(row.count, 312);
  assert.equal(row.source, 'USGS');
  assert.equal(row.url, 'https://earthquake.usgs.gov');
  assert.match(row.rel, /30分前/);
  assert.equal(row.stale, false);
});

test('buildSourceRows: updated 欠落は rel="—"・非stale', () => {
  const layers = [{ id: 'trade', label: '貿易路' }];
  const [row] = buildSourceRows(layers, { trade: {} }, {}, { trade: { source: '静的' } }, NOW);
  assert.equal(row.rel, '—');
  assert.equal(row.stale, false);
  assert.equal(row.count, 0, '件数不明は0');
});

test('buildSourceRows: updated 欠落時は generated_at をフォールバック（forecast 等）', () => {
  const layers = [{ id: 'forecast', label: 'AI FORECASTS' }];
  const snapshots = { forecast: { generated_at: '2026-06-23T11:30:00Z' } }; // 30分前
  const [row] = buildSourceRows(layers, snapshots, { forecast: 40 }, {}, NOW);
  assert.match(row.rel, /30分前/);
  assert.equal(row.stale, false);
});

test('buildSourceRows: 閾値より古いと stale=true', () => {
  const layers = [{ id: 'flights', label: '航空機' }];
  const old = '2026-06-23T00:00:00Z'; // 12時間前
  const [row] = buildSourceRows(layers, { flights: { updated: old } }, { flights: 5 },
    { flights: { source: 'adsb.fi' } }, NOW, { staleMs: 6 * 3600 * 1000 });
  assert.equal(row.stale, true);
  assert.match(row.rel, /時間前/);
});

test('sourceRowHtml: 名称/出典を escape し、http/https URL のみリンク化', () => {
  const html = sourceRowHtml({ label: '<a>', rel: '1分前', count: 3, source: 'X&Y', url: 'https://ex.com' });
  assert.ok(!html.includes('<a>'), '生の<a>を含まない');
  assert.match(html, /&lt;a&gt;/);
  assert.match(html, /X&amp;Y/);
  assert.match(html, /href="https:\/\/ex\.com"/);
});

test('sourceRowHtml: javascript: 等の不正 URL はリンクにしない', () => {
  const html = sourceRowHtml({ label: 'L', rel: '—', count: 0, source: 'src', url: 'javascript:alert(1)' });
  assert.ok(!/href="javascript:/.test(html), 'javascript: をhrefにしない');
});

test('sourceRowHtml: URL 無しの出典はプレーンテキスト表示', () => {
  const html = sourceRowHtml({ label: 'L', rel: '—', count: 0, source: '静的データ', url: '' });
  assert.ok(!html.includes('<a '), 'リンク要素を含まない');
  assert.match(html, /静的データ/);
});

test('SOURCE_MAP: 主要レイヤーの出典定義を持つ', () => {
  for (const id of ['quakes', 'flights', 'conflict', 'news', 'sst']) {
    assert.ok(SOURCE_MAP[id] && SOURCE_MAP[id].source, `${id} の出典定義`);
  }
});

// 「定義がある」だけを見ていると、上流を差し替えたのにパネルの表示が前のソースのまま緑になる
// （2026-09-10 の adsb.fi 移行で実際に踏みかけた穴）。表示名と URL を値で固定する。
test('SOURCE_MAP: 主要レイヤーの出典名と URL を値で固定する', () => {
  const expected = {
    quakes: ['USGS', 'https://earthquake.usgs.gov'],
    flights: ['adsb.fi', 'https://adsb.fi/'],
    conflict: ['GDELT Project', 'https://www.gdeltproject.org'],
    protests: ['GDELT Project', 'https://www.gdeltproject.org'],
    ships: ['AISStream', 'https://aisstream.io'],
    firms: ['NASA FIRMS', 'https://firms.modaps.eosdis.nasa.gov'],
  };
  for (const [id, [source, url]] of Object.entries(expected)) {
    assert.equal(SOURCE_MAP[id].source, source, `${id} の出典名`);
    assert.equal(SOURCE_MAP[id].url, url, `${id} の出典URL`);
  }
});

test('SOURCE_MAP: 航空は adsb.fi を cite しホームページへリンクする（利用条件）', () => {
  // adsb.fi の条件は逐語で "You must cite adsb.fi and include a link to our home page."
  // ＝この2つの値がそのまま義務の履行なので、消えたらテストで落とす。
  assert.equal(SOURCE_MAP.flights.source, 'adsb.fi');
  assert.match(SOURCE_MAP.flights.url, /^https:\/\/adsb\.fi\/?$/);
});

test('SOURCE_MAP: 離脱した OpenSky がどこにも残っていない', () => {
  // OpenSky の Terms は automated system への組み込みと第三者への再配布を禁じており、
  // orbis の運用形態では使えない。出典表示に名前が残るのは「使っている」と誤って示すことになる。
  for (const [id, v] of Object.entries(SOURCE_MAP)) {
    assert.ok(!/opensky/i.test(`${v.source} ${v.url || ''}`), `${id} に OpenSky が残っている`);
  }
});

test('sourceRowHtml: 外部リンクは rel="noopener noreferrer"', () => {
  const h = sourceRowHtml({ label: 'USGS', rel: '1分前', count: 3, source: 'USGS', url: 'https://earthquake.usgs.gov' });
  assert.match(h, /rel="noopener noreferrer"/);
  assert.ok(!h.includes('rel="noopener"'), h);
});
