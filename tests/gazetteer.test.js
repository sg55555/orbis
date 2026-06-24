import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, searchCountries } from '../js/lib/gazetteer.js';
import { FIPS_JA } from '../js/lib/places.js';

test('COUNTRIES: 全 FIPS_JA コードを網羅・座標は範囲内・ja 非空', () => {
  assert.equal(COUNTRIES.length, 246); // 239 + Phase2 50m 再生成で追加の7領土/小国（CQ/FM/NN/RN/SX/TB/UC）
  const codes = new Set(COUNTRIES.map((c) => c.code));
  for (const k of Object.keys(FIPS_JA)) assert.ok(codes.has(k), `欠落: ${k}`);
  for (const c of COUNTRIES) {
    assert.ok(Number.isFinite(c.lng) && c.lng >= -180 && c.lng <= 180, `lng 範囲外: ${c.code}`);
    assert.ok(Number.isFinite(c.lat) && c.lat >= -90 && c.lat <= 90, `lat 範囲外: ${c.code}`);
    assert.ok(typeof c.ja === 'string' && c.ja.length > 0, `ja 空: ${c.code}`);
  }
});

test('searchCountries: 日本語の部分一致', () => {
  const r = searchCountries('ウクラ');
  assert.ok(r.some((c) => c.code === 'UP' && c.ja === 'ウクライナ'));
});

test('searchCountries: 英語の部分一致・大小無視', () => {
  assert.ok(searchCountries('ukr').some((c) => c.code === 'UP'));
  assert.ok(searchCountries('UKR').some((c) => c.code === 'UP'));
});

test('searchCountries: EXTRA 由来（イスラエル）も検索可', () => {
  assert.ok(searchCountries('イスラエル').some((c) => c.code === 'IS'));
  assert.ok(searchCountries('israel').some((c) => c.code === 'IS'));
});

test('searchCountries: 前方一致が部分一致より上位', () => {
  const r = searchCountries('japan');
  assert.equal(r[0].code, 'JA'); // Japan が先頭（"japan" 前方一致）
});

test('searchCountries: limit で件数制限', () => {
  assert.ok(searchCountries('a', 2).length <= 2);
});

test('searchCountries: 空・空白・無マッチは []', () => {
  assert.deepEqual(searchCountries(''), []);
  assert.deepEqual(searchCountries('   '), []);
  assert.deepEqual(searchCountries('zzzzz'), []);
});
