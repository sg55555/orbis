import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectCountryEvents,
  assignAdmin1,
  aggregateByAdmin1,
  attachNearestCity,
  buildDrilldown,
} from '../js/lib/drilldown/aggregate_admin1.js';

// loadPolygons 正規化形を手書きで用意（geo_poly.js に依存せず固定フィクスチャ）。
// JP: 経度 130..142 / 緯度 30..46 の単純な四角（時計回りでも反時計回りでも even-odd は不変）。
const JP_RING = [
  [130, 30], [142, 30], [142, 46], [130, 46], [130, 30],
];
const countryPolys = [
  { code: 'JA', name: 'Japan', name_ja: '日本', bbox: [130, 30, 142, 46], rings: [JP_RING] },
  // 隣国 KS（韓国相当の別四角・経度 125..130）— news の隣国混入テスト用。
  { code: 'KS', name: 'South Korea', name_ja: '韓国', bbox: [124, 33, 129.99, 39], rings: [[[124, 33], [129.99, 33], [129.99, 39], [124, 39], [124, 33]]] },
];

const snapshots = {
  quakes: { points: [
    { id: 'q1', time: 1, mag: 5.2, place: 'near Tokyo', lon: 139.7, lat: 35.7 },
    { id: 'q2', time: 2, mag: 4.0, place: 'somewhere', lon: 0, lat: 0 }, // 国外
  ] },
  conflict: { points: [
    { id: 'c1', lon: 135.5, lat: 34.7, mentions: 12, root: '18', place: 'JA', url: 'https://x.jp/a', date: '20260620120000' },
  ] },
  protests: { points: [
    { id: 'p1', lon: 139.0, lat: 35.0, mentions: 4, root: '14', place: 'JA', url: 'https://y.jp/b', date: '20260620120000' },
  ] },
  news: { items: [
    { id: 'n1', time: 3, lon: 139.7, lat: 35.6, title_ja: '東京で会議', category: 'politics', place: 'JA', url: 'https://z.jp/c' },
    { id: 'n2', time: 4, lon: 127.0, lat: 37.5, title_ja: 'ソウルの報道', category: 'politics', place: 'JA', url: 'https://z.kr/d' }, // 座標は韓国内=JP厳密判定で除外
  ] },
};

test('collectCountryEvents: 当該FIPS(JA)内の点のみ抽出・各層 layerId/title/raw 付与', () => {
  const events = collectCountryEvents(snapshots, 'JA', countryPolys);
  const ids = events.map((e) => e.raw.id).sort();
  // q1(国内) c1 p1 n1(国内) のみ。q2(国外0,0)・n2(韓国座標) は除外。
  assert.deepEqual(ids, ['c1', 'n1', 'p1', 'q1']);
});

test('collectCountryEvents: layerId と title が層ごとに正しい', () => {
  const events = collectCountryEvents(snapshots, 'JA', countryPolys);
  const byId = Object.fromEntries(events.map((e) => [e.raw.id, e]));
  assert.equal(byId.q1.layerId, 'quakes');
  assert.equal(byId.q1.title, 'M5.2 near Tokyo');
  assert.equal(byId.c1.layerId, 'conflict');
  assert.equal(byId.c1.title, 'JA');
  assert.equal(byId.p1.layerId, 'protests');
  assert.equal(byId.p1.title, 'JA');
  assert.equal(byId.n1.layerId, 'news');
  assert.equal(byId.n1.title, '東京で会議');
});

test('collectCountryEvents: lon/lat は元の点の座標を保持', () => {
  const events = collectCountryEvents(snapshots, 'JA', countryPolys);
  const q1 = events.find((e) => e.raw.id === 'q1');
  assert.equal(q1.lon, 139.7);
  assert.equal(q1.lat, 35.7);
});

test('collectCountryEvents: 該当FIPSポリゴンが無ければ空配列', () => {
  assert.deepEqual(collectCountryEvents(snapshots, 'ZZ', countryPolys), []);
});

test('collectCountryEvents: snapshots/各層が欠落・空でも落ちず空配列', () => {
  assert.deepEqual(collectCountryEvents(null, 'JA', countryPolys), []);
  assert.deepEqual(collectCountryEvents({}, 'JA', countryPolys), []);
  assert.deepEqual(collectCountryEvents({ quakes: {}, news: {} }, 'JA', countryPolys), []);
});

test('collectCountryEvents: 緯度経度が数値でない点はスキップ', () => {
  const bad = { quakes: { points: [{ id: 'b', mag: 3, place: 'x', lon: null, lat: undefined }] } };
  assert.deepEqual(collectCountryEvents(bad, 'JA', countryPolys), []);
});

// admin1 フィクスチャ: JP-13(東京周辺・経度138..141/緯度34..37) と JP-27(関西・経度134..137/緯度33..36)。
const admin1Polys = [
  { code: 'JP-13', name: 'Tokyo', name_ja: '東京都', bbox: [138, 34, 141, 37], rings: [[[138, 34], [141, 34], [141, 37], [138, 37], [138, 34]]] },
  { code: 'JP-27', name: 'Osaka', name_ja: '大阪府', bbox: [134, 33, 137, 36], rings: [[[134, 33], [137, 33], [137, 36], [134, 36], [134, 33]]] },
];

test('assignAdmin1: admin1内の点に a1code 付与・外れは null', () => {
  const events = [
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: 'e1' } }, // JP-13内
    { layerId: 'conflict', lon: 135.5, lat: 34.7, title: 'B', raw: { id: 'e2' } }, // JP-27内
    { layerId: 'quakes', lon: 142.5, lat: 40.0, title: 'C', raw: { id: 'e3' } }, // どちらの admin1 にも入らない
  ];
  const out = assignAdmin1(events, admin1Polys);
  assert.equal(out[0].a1code, 'JP-13');
  assert.equal(out[1].a1code, 'JP-27');
  assert.equal(out[2].a1code, null);
});

test('assignAdmin1: 元イベントを破壊せずコピーを返す', () => {
  const events = [{ layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: 'e1' } }];
  const out = assignAdmin1(events, admin1Polys);
  assert.notEqual(out[0], events[0]);
  assert.equal(events[0].a1code, undefined);
  assert.equal(out[0].layerId, 'news');
});

test('assignAdmin1: admin1Polys 空なら全 null', () => {
  const events = [{ layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: 'e1' } }];
  const out = assignAdmin1(events, []);
  assert.equal(out[0].a1code, null);
});

test('assignAdmin1: 空イベントは空配列', () => {
  assert.deepEqual(assignAdmin1([], admin1Polys), []);
  assert.deepEqual(assignAdmin1(null, admin1Polys), []);
});

const a1NameMap = { 'JP-13': '東京都', 'JP-27': '大阪府' };

test('aggregateByAdmin1: a1code でグループ化・count降順', () => {
  const evs = [
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '1' }, a1code: 'JP-13' },
    { layerId: 'conflict', lon: 139.8, lat: 35.7, title: 'B', raw: { id: '2' }, a1code: 'JP-13' },
    { layerId: 'protests', lon: 139.9, lat: 35.5, title: 'C', raw: { id: '3' }, a1code: 'JP-13' },
    { layerId: 'quakes', lon: 135.5, lat: 34.7, title: 'D', raw: { id: '4' }, a1code: 'JP-27' },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].a1code, 'JP-13'); // 3件で先頭
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].name_ja, '東京都');
  assert.equal(rows[1].a1code, 'JP-27');
  assert.equal(rows[1].count, 1);
});

test('aggregateByAdmin1: byLayer 内訳を集計', () => {
  const evs = [
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '1' }, a1code: 'JP-13' },
    { layerId: 'news', lon: 139.8, lat: 35.7, title: 'B', raw: { id: '2' }, a1code: 'JP-13' },
    { layerId: 'conflict', lon: 139.9, lat: 35.5, title: 'C', raw: { id: '3' }, a1code: 'JP-13' },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.deepEqual(rows[0].byLayer, { news: 2, conflict: 1 });
});

test('aggregateByAdmin1: topEvents は各県の代表（最大3・件数順入力順）', () => {
  const evs = [
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '1' }, a1code: 'JP-13' },
    { layerId: 'conflict', lon: 139.8, lat: 35.7, title: 'B', raw: { id: '2' }, a1code: 'JP-13' },
    { layerId: 'protests', lon: 139.9, lat: 35.5, title: 'C', raw: { id: '3' }, a1code: 'JP-13' },
    { layerId: 'quakes', lon: 139.6, lat: 35.4, title: 'D', raw: { id: '4' }, a1code: 'JP-13' },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows[0].topEvents.length, 3);
  assert.equal(rows[0].topEvents[0].title, 'A');
});

test('aggregateByAdmin1: lon/lat は県内イベントの重心', () => {
  const evs = [
    { layerId: 'news', lon: 139.0, lat: 35.0, title: 'A', raw: { id: '1' }, a1code: 'JP-13' },
    { layerId: 'news', lon: 141.0, lat: 37.0, title: 'B', raw: { id: '2' }, a1code: 'JP-13' },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows[0].lon, 140.0);
  assert.equal(rows[0].lat, 36.0);
});

test('aggregateByAdmin1: a1code=null は「その他/不明」バケット', () => {
  const evs = [
    { layerId: 'news', lon: 145, lat: 40, title: 'X', raw: { id: '9' }, a1code: null },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].a1code, null);
  assert.equal(rows[0].name_ja, 'その他/不明');
  assert.equal(rows[0].count, 1);
});

test('aggregateByAdmin1: 同数 count は name_ja 昇順で安定', () => {
  const evs = [
    { layerId: 'news', lon: 135.5, lat: 34.7, title: 'B', raw: { id: '1' }, a1code: 'JP-27' }, // 大阪府
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '2' }, a1code: 'JP-13' }, // 東京都
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  // 同数1件ずつ→ name_ja 昇順（「大阪府」<「東京都」）
  assert.equal(rows[0].name_ja, '大阪府');
  assert.equal(rows[1].name_ja, '東京都');
});

test('aggregateByAdmin1: name_ja 未知 a1code はコードをフォールバック表示', () => {
  const evs = [{ layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '1' }, a1code: 'JP-99' }];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows[0].name_ja, 'JP-99');
});

test('aggregateByAdmin1: 空入力は空配列', () => {
  assert.deepEqual(aggregateByAdmin1([], a1NameMap), []);
  assert.deepEqual(aggregateByAdmin1(null), []);
});

const cities = [
  { name: 'Tokyo', name_ja: '東京', lon: 139.69, lat: 35.69, pop: 9000000 },
  { name: 'Osaka', name_ja: '大阪', lon: 135.50, lat: 34.69, pop: 2700000 },
];

test('attachNearestCity: 最寄り都市の name_ja を cityName に付与', () => {
  const evs = [
    { layerId: 'news', lon: 139.70, lat: 35.70, title: 'A', raw: { id: '1' } },
    { layerId: 'conflict', lon: 135.49, lat: 34.70, title: 'B', raw: { id: '2' } },
  ];
  const out = attachNearestCity(evs, cities);
  assert.equal(out[0].cityName, '東京');
  assert.equal(out[1].cityName, '大阪');
});

test('attachNearestCity: maxDeg 超(遠方)は cityName=null', () => {
  const evs = [{ layerId: 'news', lon: 100.0, lat: 10.0, title: 'X', raw: { id: '9' } }];
  const out = attachNearestCity(evs, cities);
  assert.equal(out[0].cityName, null);
});

test('attachNearestCity: cities 空は cityName=null', () => {
  const evs = [{ layerId: 'news', lon: 139.70, lat: 35.70, title: 'A', raw: { id: '1' } }];
  const out = attachNearestCity(evs, []);
  assert.equal(out[0].cityName, null);
});

test('attachNearestCity: name_ja 欠落の都市は name をフォールバック', () => {
  const c2 = [{ name: 'Kyoto', lon: 135.77, lat: 35.01, pop: 1400000 }];
  const evs = [{ layerId: 'news', lon: 135.77, lat: 35.01, title: 'A', raw: { id: '1' } }];
  const out = attachNearestCity(evs, c2);
  assert.equal(out[0].cityName, 'Kyoto');
});

test('attachNearestCity: 元イベントを破壊しない・空入力は空配列', () => {
  const evs = [{ layerId: 'news', lon: 139.70, lat: 35.70, title: 'A', raw: { id: '1' } }];
  const out = attachNearestCity(evs, cities);
  assert.notEqual(out[0], evs[0]);
  assert.equal(evs[0].cityName, undefined);
  assert.deepEqual(attachNearestCity([], cities), []);
  assert.deepEqual(attachNearestCity(null, cities), []);
});

const instabilityCountry = {
  code: 'JA', name_ja: '日本', score: 42,
  trend: { isNew: false, normal: { dir: 'up', deltaPct: 5 }, dod: { dir: 'up', delta: 2 } },
  counts: { conflict: 1, protests: 1, news: 1, quakes: 1 },
  narrative_ja: '緊張がやや上昇。',
};

test('buildDrilldown: header に instabilityCountry をそのまま流用', () => {
  const model = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry, forecastCards: [{ title_ja: '注視' }],
  });
  assert.equal(model.header.code, 'JA');
  assert.equal(model.header.name_ja, '日本');
  assert.equal(model.header.score, 42);
  assert.equal(model.header.narrative_ja, '緊張がやや上昇。');
  assert.deepEqual(model.header.forecastCards, [{ title_ja: '注視' }]);
  assert.equal(model.degraded, false);
});

test('buildDrilldown: regions は admin1 集計・events は最寄り都市付き', () => {
  const model = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry,
  });
  // JP-13(news n1)・JP-27(conflict c1)・p1(JP-13範囲外=その他想定)。少なくとも regions が件数を持つ。
  assert.ok(Array.isArray(model.regions));
  assert.ok(model.regions.length >= 1);
  // events は cityName を持つ（最寄り都市付与済）。
  assert.ok(model.events.every((e) => 'cityName' in e));
  assert.ok(model.events.length >= 1);
});

test('buildDrilldown: 該当国(instabilityCountry)なしでも落ちず最小ヘッダ', () => {
  const model = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry: null,
  });
  assert.equal(model.header.code, 'JA');
  assert.equal(model.header.name_ja, null);
  assert.equal(model.header.score, 0);
  assert.equal(model.header.trend, null);
  assert.equal(model.header.counts, null);
  assert.ok(Array.isArray(model.regions));
});

test('buildDrilldown: MAX_POINTS 超過は admin1 をスキップし国集計のみ degraded', () => {
  const many = [];
  for (let i = 0; i < 10; i += 1) {
    many.push({ id: `m${i}`, time: i, mag: 3, place: 'x', lon: 139.7, lat: 35.6 });
  }
  const bigSnap = { quakes: { points: many } };
  const model = buildDrilldown(
    { fips: 'JA', snapshots: bigSnap, countryPolys, admin1Polys, cities, instabilityCountry },
    { MAX_POINTS: 5 },
  );
  assert.equal(model.degraded, true);
  assert.deepEqual(model.regions, []);
  // events は国内全点を保持（国集計は生きる）。
  assert.equal(model.events.length, 10);
});

test('buildDrilldown: 国ポリゴンに該当FIPSなし→空 regions/events・落ちない', () => {
  const model = buildDrilldown({
    fips: 'ZZ', snapshots, countryPolys, admin1Polys, cities, instabilityCountry: null,
  });
  assert.deepEqual(model.regions, []);
  assert.deepEqual(model.events, []);
  assert.equal(model.degraded, false);
  assert.equal(model.header.code, 'ZZ');
});

test('buildDrilldown: 引数欠落でも throw しない', () => {
  const model = buildDrilldown({ fips: 'JA' });
  assert.equal(model.header.code, 'JA');
  assert.deepEqual(model.regions, []);
  assert.deepEqual(model.events, []);
  assert.equal(model.degraded, false);
});

// patch #1: buildDrilldown の events は a1code と regionName を持つ
test('buildDrilldown patch#1: events に a1code と regionName が付与される', () => {
  const model = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry,
  });
  // 全 events に a1code と regionName が存在すること
  assert.ok(model.events.every((e) => 'a1code' in e), 'a1code が全 events に存在しない');
  assert.ok(model.events.every((e) => 'regionName' in e), 'regionName が全 events に存在しない');
  // n1(東京周辺)は JP-13 に割当られ regionName='東京都'
  const n1 = model.events.find((e) => e.raw.id === 'n1');
  assert.equal(n1.a1code, 'JP-13');
  assert.equal(n1.regionName, '東京都');
  // null a1code の場合は 'その他/不明'
  const nullA1Events = model.events.filter((e) => e.a1code === null);
  if (nullA1Events.length > 0) {
    assert.ok(nullA1Events.every((e) => e.regionName === 'その他/不明'));
  }
});

// patch #2: buildDrilldown の header は forecast:{watch,label} を持つ
test('buildDrilldown patch#2: header に forecast:{watch,label} が設定される', () => {
  const fc = [{ watch: 'high', title_ja: '高注視カード' }, { watch: 'medium', title_ja: '中注視' }];
  const model = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry, forecastCards: fc,
  });
  assert.ok(model.header.forecast, 'header.forecast が未設定');
  assert.equal(model.header.forecast.watch, 'high');
  assert.equal(model.header.forecast.label, '高注視カード');
});

test('buildDrilldown patch#2: forecastCards 空/未設定は forecast=null', () => {
  const model1 = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry, forecastCards: [],
  });
  assert.equal(model1.header.forecast, null);

  const model2 = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry,
  });
  assert.equal(model2.header.forecast, null);
});

// Important: aggregateByAdmin1 の各 region.topEvents に regionName を付与
test('aggregateByAdmin1: 各 region.topEvents[i] に regionName=その region の name_ja が付与される', () => {
  const evs = [
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '1' }, a1code: 'JP-13' },
    { layerId: 'conflict', lon: 139.8, lat: 35.7, title: 'B', raw: { id: '2' }, a1code: 'JP-13' },
    { layerId: 'protests', lon: 139.9, lat: 35.5, title: 'C', raw: { id: '3' }, a1code: 'JP-13' },
    { layerId: 'quakes', lon: 135.5, lat: 34.7, title: 'D', raw: { id: '4' }, a1code: 'JP-27' },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  // JP-13 グループ（東京都）の topEvents は全て regionName='東京都'
  const tokyo = rows.find((r) => r.a1code === 'JP-13');
  assert.ok(tokyo, 'JP-13 グループが存在しない');
  assert.ok(tokyo.topEvents.length > 0, 'topEvents が空');
  for (const ev of tokyo.topEvents) {
    assert.equal(ev.regionName, '東京都', `topEvents[i].regionName が '東京都' でない: ${JSON.stringify(ev)}`);
  }
  // JP-27 グループ（大阪府）の topEvents は全て regionName='大阪府'
  const osaka = rows.find((r) => r.a1code === 'JP-27');
  assert.ok(osaka, 'JP-27 グループが存在しない');
  assert.ok(osaka.topEvents.length > 0, 'topEvents が空');
  for (const ev of osaka.topEvents) {
    assert.equal(ev.regionName, '大阪府', `topEvents[i].regionName が '大阪府' でない: ${JSON.stringify(ev)}`);
  }
});

test('aggregateByAdmin1: a1code=null バケットの topEvents に regionName=その他/不明 が付与される', () => {
  const evs = [
    { layerId: 'news', lon: 145, lat: 40, title: 'X', raw: { id: '9' }, a1code: null },
    { layerId: 'quakes', lon: 146, lat: 41, title: 'Y', raw: { id: '10' }, a1code: null },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  const other = rows.find((r) => r.a1code === null);
  assert.ok(other, 'その他バケットが存在しない');
  for (const ev of other.topEvents) {
    assert.equal(ev.regionName, 'その他/不明', `topEvents[i].regionName が 'その他/不明' でない: ${JSON.stringify(ev)}`);
  }
});
