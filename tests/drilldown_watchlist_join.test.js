// tests/drilldown_watchlist_join.test.js
// joinWatchCountries の純テスト。
// コード配列（string[]）→ [{code,name_ja,score,lon,lat}] への join を検証。
// - 圏内国: instabilityCountries の score/level を付与＋ fipsCenterFn の座標
// - 圏外国: score=0 / level=undefined、fipsCenterFn の座標。座標が無い（返り値 null）なら lon=0/lat=0
// - 順序: orderByInstability 準拠（score 降順・同 score は元の list 順）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinWatchCountries } from '../js/lib/drilldown/watchlist.js';

// テスト用の fipsCenterFn（code→[lng,lat] or null）
function makeCenter(map) {
  return (code) => map[code] || null;
}

const center = makeCenter({
  US: [-98, 39],
  UA: [31, 49],
  XX: [10, 10],
  ZZ: [100, 50],
});

const insCountries = [
  { code: 'UA', score: 90, level: 'critical' },
  { code: 'US', score: 60, level: 'elevated' },
];

test('joinWatchCountries: 圏内国は instability score/level が付与される', () => {
  const result = joinWatchCountries(['UA', 'US'], insCountries, center);
  const ua = result.find((r) => r.code === 'UA');
  assert.ok(ua, 'UA が含まれる');
  assert.equal(ua.score, 90, 'UA の score = 90');
  assert.equal(ua.level, 'critical', 'UA の level = critical');
});

test('joinWatchCountries: 圏外国も消えず、score=0・座標付きで含まれる', () => {
  const result = joinWatchCountries(['UA', 'XX'], insCountries, center);
  const xx = result.find((r) => r.code === 'XX');
  assert.ok(xx, '圏外 XX が含まれる（消えない）');
  assert.equal(xx.score, 0, '圏外 score = 0');
  assert.equal(xx.lon, 10, '圏外国も座標付き');
  assert.equal(xx.lat, 10);
});

test('joinWatchCountries: 座標は fipsCenterFn から取得（lng→lon, lat→lat）', () => {
  const result = joinWatchCountries(['US'], insCountries, center);
  const us = result.find((r) => r.code === 'US');
  assert.equal(us.lon, -98, 'lng が lon に変換される');
  assert.equal(us.lat, 39);
});

test('joinWatchCountries: fipsCenterFn が null を返す国は lon=0/lat=0（フォールバック）', () => {
  const noCenter = () => null;
  const result = joinWatchCountries(['US'], insCountries, noCenter);
  const us = result.find((r) => r.code === 'US');
  assert.equal(us.lon, 0, 'center null → lon=0 フォールバック');
  assert.equal(us.lat, 0, 'center null → lat=0 フォールバック');
});

test('joinWatchCountries: name_ja が各 code に付与される（COUNTRIES.ja 相当）', () => {
  // fipsCenterFn だけでなく name_ja も解決される
  // name_ja の値は任意（フォールバックでも空文字列でなく string）
  const result = joinWatchCountries(['UA', 'ZZ'], insCountries, center);
  for (const r of result) {
    assert.equal(typeof r.name_ja, 'string', `${r.code} の name_ja は string`);
  }
});

test('joinWatchCountries: 順序は orderByInstability 準拠（score 降順）', () => {
  const list = ['US', 'UA', 'XX'];
  const result = joinWatchCountries(list, insCountries, center);
  // UA(90) > US(60) > XX(0)
  assert.equal(result[0].code, 'UA', '1位 UA(90)');
  assert.equal(result[1].code, 'US', '2位 US(60)');
  assert.equal(result[2].code, 'XX', '3位 XX(0)');
});

test('joinWatchCountries: 同 score は元の list 順を保つ（安定ソート）', () => {
  const list = ['ZZ', 'XX'];
  // どちらも insCountries 圏外 → score=0 → 元順保持
  const result = joinWatchCountries(list, insCountries, center);
  assert.equal(result[0].code, 'ZZ');
  assert.equal(result[1].code, 'XX');
});

test('joinWatchCountries: 空リストは []', () => {
  assert.deepEqual(joinWatchCountries([], insCountries, center), []);
});

test('joinWatchCountries: insCountries が null/空でも落ちない（全 score=0）', () => {
  const result = joinWatchCountries(['US', 'UA'], null, center);
  assert.equal(result.length, 2);
  assert.ok(result.every((r) => r.score === 0), '全 score = 0');
});

test('joinWatchCountries: list が null なら []', () => {
  assert.deepEqual(joinWatchCountries(null, insCountries, center), []);
});
