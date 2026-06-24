import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degradedNoticeHtml, eventLineHtml, regionRowHtml } from '../js/lib/drilldown/drilldown_view.js';

test('degradedNoticeHtml: 4種すべてが固有の説明文を返す', () => {
  const extra = degradedNoticeHtml('extra');
  const ocean = degradedNoticeHtml('ocean');
  const missing = degradedNoticeHtml('missing');
  const fetcherror = degradedNoticeHtml('fetcherror');
  // 各文言は固有（取り違え防止）
  assert.match(extra, /県別集計/);
  assert.match(ocean, /国を特定/);
  assert.match(missing, /データがありません|未整備/);
  assert.match(fetcherror, /再試行|取得に失敗/);
  // 4種すべて互いに異なる
  const set = new Set([extra, ocean, missing, fetcherror]);
  assert.equal(set.size, 4);
});

test('degradedNoticeHtml: 既知の class でラップされ DOM 非依存の文字列', () => {
  const html = degradedNoticeHtml('extra');
  assert.match(html, /class="dd-degraded"/);
  assert.equal(typeof html, 'string');
});

test('degradedNoticeHtml: 未知 kind は汎用フォールバック文（落ちない）', () => {
  const html = degradedNoticeHtml('unknown-kind-xyz');
  assert.equal(typeof html, 'string');
  assert.match(html, /class="dd-degraded"/);
});

test('eventLineHtml: 都市名ありは「県名 — 都市名でイベント」形式', () => {
  const html = eventLineHtml({
    regionName: 'カリフォルニア州', cityName: 'ロサンゼルス',
    layerId: 'protests', title: '抗議',
  });
  assert.match(html, /カリフォルニア州/);
  assert.match(html, /ロサンゼルス/);
  assert.match(html, /で抗議/);
});

test('eventLineHtml: 都市名なしは都市部分を省きフォールバック', () => {
  const html = eventLineHtml({
    regionName: 'カリフォルニア州', cityName: null,
    layerId: 'protests', title: '抗議',
  });
  assert.match(html, /カリフォルニア州/);
  assert.doesNotMatch(html, /—\s*でイベント/); // 空都市の壊れた整形が出ない
  assert.match(html, /抗議/);
});

test('eventLineHtml: レイヤー絵文字が instability 並びに一致', () => {
  assert.match(eventLineHtml({ regionName: 'X', cityName: 'C', layerId: 'conflict', title: 't' }), /⚔/);
  assert.match(eventLineHtml({ regionName: 'X', cityName: 'C', layerId: 'protests', title: 't' }), /📢/);
  assert.match(eventLineHtml({ regionName: 'X', cityName: 'C', layerId: 'news', title: 't' }), /📰/);
  assert.match(eventLineHtml({ regionName: 'X', cityName: 'C', layerId: 'quakes', title: 't' }), /🌐/);
});

test('eventLineHtml: XSS エスケープ（regionName/cityName/title）', () => {
  const html = eventLineHtml({
    regionName: '<script>a</script>', cityName: '"><img src=x>',
    layerId: 'news', title: '<b>x</b>',
  });
  assert.doesNotMatch(html, /<script>a<\/script>/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;script&gt;/);
});

test('eventLineHtml: ev 欠落でも落ちない', () => {
  assert.equal(typeof eventLineHtml(null), 'string');
  assert.equal(typeof eventLineHtml({}), 'string');
});

test('regionRowHtml: 県名・件数・内訳絵文字を含む', () => {
  const html = regionRowHtml({
    a1code: 'US-CA', name_ja: 'カリフォルニア州', count: 7,
    byLayer: { conflict: 1, protests: 4, news: 2, quakes: 0 },
    topEvents: [{ title: '抗議', cityName: 'ロサンゼルス' }],
    lon: -119, lat: 37,
  });
  assert.match(html, /カリフォルニア州/);
  assert.match(html, /7/);            // 件数
  assert.match(html, /⚔1/);           // conflict 内訳
  assert.match(html, /📢4/);          // protests 内訳
  assert.match(html, /📰2/);          // news 内訳
  assert.match(html, /🌐0/);          // quakes 内訳（0 も明示）
  assert.match(html, /ロサンゼルス/);  // 代表イベント
});

test('regionRowHtml: その他/不明バケット（a1code=null）も県名で描画', () => {
  const html = regionRowHtml({
    a1code: null, name_ja: 'その他/不明', count: 3,
    byLayer: { news: 3 }, topEvents: [], lon: 0, lat: 0,
  });
  assert.match(html, /その他\/不明/);
  assert.match(html, /3/);
  assert.match(html, /📰3/);
  // byLayer に無いレイヤーは 0 表示
  assert.match(html, /⚔0/);
});

test('regionRowHtml: 代表イベント無しでも落ちない', () => {
  const html = regionRowHtml({
    a1code: 'X', name_ja: '某州', count: 0, byLayer: {}, topEvents: [], lon: 1, lat: 1,
  });
  assert.equal(typeof html, 'string');
  assert.match(html, /某州/);
  assert.match(html, /⚔0/);
});

test('regionRowHtml: XSS エスケープ（name_ja・代表イベント title）', () => {
  const html = regionRowHtml({
    a1code: 'X', name_ja: '<script>a</script>', count: 1,
    byLayer: { news: 1 }, topEvents: [{ title: '"><img src=x>', cityName: '<b>c</b>' }],
    lon: 0, lat: 0,
  });
  assert.doesNotMatch(html, /<script>a<\/script>/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /<b>c<\/b>/);
  assert.match(html, /&lt;script&gt;/);
});

test('regionRowHtml: region 欠落でも落ちない', () => {
  assert.equal(typeof regionRowHtml(null), 'string');
  assert.equal(typeof regionRowHtml({}), 'string');
});
