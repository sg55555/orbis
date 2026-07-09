import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlace } from '../js/lib/drilldown/resolve_place.js';

const A1 = [{ code: 'JP-13', name_ja: '東京都', rings: [[[139, 35], [140, 35], [140, 36], [139, 35]]] }];
const CITIES = [{ qid: 'Q1490', name_ja: '新宿区', lon: 139.7, lat: 35.69 }];
const MAN = { country: { JA: {} }, admin1: { 'JP-13': {} }, city: { Q1490: {} } };
const ctx = (over = {}) => ({
  fips: 'JA', countryName: '日本', admin1Polys: A1, cities: CITIES, manifest: MAN,
  pip: (lon, lat, p) => p.code === 'JP-13',   // 常に東京都に当たる
  nearest: (lon, lat, cs) => cs[0],
  cityRadiusDeg: 0.5, ...over,
});

test('最具体=都市（近接・manifest 在り）に着地、chain は国›県›市', () => {
  const r = resolvePlace(139.7, 35.69, ctx());
  assert.equal(r.target.level, 'city');
  assert.equal(r.target.id, 'Q1490');
  assert.deepEqual(r.chain.map((c) => c.level), ['country', 'admin1', 'city']);
});

test('都市が遠い→県に着地', () => {
  const r = resolvePlace(139.7, 35.69, ctx({ cities: [{ qid: 'Q1490', name_ja: '新宿区', lon: 200, lat: 80 }] }));
  assert.equal(r.target.level, 'admin1');
  assert.equal(r.target.id, 'JP-13');
});

test('県 profile 無し→国に着地（フォールバック）', () => {
  const r = resolvePlace(139.7, 35.69, ctx({ manifest: { country: { JA: {} }, admin1: {}, city: {} } }));
  assert.equal(r.target.level, 'country');
  assert.equal(r.target.id, 'JA');
  assert.equal(r.admin1Hit && r.admin1Hit.code, 'JP-13');
});

test('最寄り都市が別の県にある時は市クラムを積まない（千葉クリックで東京都をネストしない）', () => {
  // JP-12 千葉=lon>=140 / JP-13 東京=lon<140 の二分ポリゴン。
  const a1 = [
    { code: 'JP-12', name_ja: '千葉県', rings: [] },
    { code: 'JP-13', name_ja: '東京都', rings: [] },
  ];
  const pip = (lon, lat, p) => (p.code === 'JP-12' ? lon >= 140 : lon < 140);
  const cities = [{ qid: 'Q1490', name_ja: '東京都', lon: 139.7, lat: 35.5 }]; // 東京は JP-13 内
  const man = { country: { JA: {} }, admin1: { 'JP-12': {}, 'JP-13': {} }, city: { Q1490: {} } };
  // クリックは千葉(lon 140.1)だが最寄り都市は東京(139.7・0.5°以内)。他県都市を子にしない。
  const r = resolvePlace(140.1, 35.5, {
    fips: 'JA', countryName: '日本', admin1Polys: a1, cities, manifest: man,
    pip, nearest: (lon, lat, cs) => cs[0], cityRadiusDeg: 0.5,
  });
  assert.equal(r.admin1Hit.code, 'JP-12');
  assert.equal(r.target.level, 'admin1', '他県の都市を子にせず県止まり');
  assert.equal(r.target.id, 'JP-12');
  assert.deepEqual(r.chain.map((c) => c.level), ['country', 'admin1']);
});

test('最寄り都市が同じ県の内側なら市クラムを積む（回帰）', () => {
  const a1 = [{ code: 'JP-13', name_ja: '東京都', rings: [] }];
  const pip = (lon, lat, p) => p.code === 'JP-13'; // 常に東京
  const cities = [{ qid: 'Q1490', name_ja: '新宿区', lon: 139.7, lat: 35.69 }];
  const man = { country: { JA: {} }, admin1: { 'JP-13': {} }, city: { Q1490: {} } };
  const r = resolvePlace(139.7, 35.69, {
    fips: 'JA', countryName: '日本', admin1Polys: a1, cities, manifest: man,
    pip, nearest: (lon, lat, cs) => cs[0], cityRadiusDeg: 0.5,
  });
  assert.equal(r.target.level, 'city');
  assert.deepEqual(r.chain.map((c) => c.level), ['country', 'admin1', 'city']);
});
