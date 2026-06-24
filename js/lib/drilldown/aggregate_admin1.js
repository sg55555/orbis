// 国ドリルダウンの admin1 集計コア（純粋・deck/DOM/fetch/map 非依存）。
// 全層の点群を当該FIPS国ポリゴンで PIP 抽出→admin1 割当→件数集計し、
// drilldown_view が描画する model を返す。aggregate.js の Map グループ化と
// 代表点選定イディオムを流用する（直接再利用ではなく admin1 粒度で再実装）。
import { pointInFeature, locateFeature } from './geo_poly.js';
import { nearestCity } from './nearest.js';

// 有限数値か。
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// 各層を {snapshotKey, listKey, layerId, titleOf} で記述。
// quakes/conflict/protests は snapshot.points、news は snapshot.items。
const LAYERS = [
  { snapshotKey: 'quakes', listKey: 'points', layerId: 'quakes', titleOf: (p) => `M${p.mag} ${p.place == null ? '' : p.place}` },
  { snapshotKey: 'conflict', listKey: 'points', layerId: 'conflict', titleOf: (p) => (p.place == null ? '' : String(p.place)) },
  { snapshotKey: 'protests', listKey: 'points', layerId: 'protests', titleOf: (p) => (p.place == null ? '' : String(p.place)) },
  { snapshotKey: 'news', listKey: 'items', layerId: 'news', titleOf: (p) => (p.title_ja == null ? '' : String(p.title_ja)) },
];

export function collectCountryEvents(snapshots, fips, countryPolys, { marginDeg = 0.5 } = {}) {
  const out = [];
  if (!snapshots || typeof snapshots !== 'object') return out;
  const polys = Array.isArray(countryPolys) ? countryPolys : [];
  const country = polys.find((p) => p && p.code === fips);
  if (!country) return out;
  for (const spec of LAYERS) {
    const snap = snapshots[spec.snapshotKey];
    const list = (snap && Array.isArray(snap[spec.listKey])) ? snap[spec.listKey] : [];
    for (const p of list) {
      const lon = Number(p.lon);
      const lat = Number(p.lat);
      if (!isNum(lon) || !isNum(lat)) continue;
      if (!pointInFeature(lon, lat, country)) continue;
      out.push({ layerId: spec.layerId, lon, lat, title: spec.titleOf(p), raw: p });
    }
  }
  return out;
}

export function assignAdmin1(events, admin1Polys) {
  const evs = Array.isArray(events) ? events : [];
  const polys = Array.isArray(admin1Polys) ? admin1Polys : [];
  return evs.map((e) => {
    const hit = locateFeature(e.lon, e.lat, polys);
    return { ...e, a1code: hit ? hit.code : null };
  });
}

const OTHER_KEY = '__OTHER__';
const OTHER_NAME = 'その他/不明';

export function aggregateByAdmin1(eventsWithA1, a1NameMap = {}) {
  const evs = Array.isArray(eventsWithA1) ? eventsWithA1 : [];
  const nameMap = (a1NameMap && typeof a1NameMap === 'object') ? a1NameMap : {};
  // a1code（null は OTHER_KEY）でグループ化（aggregate.js の Map グループ化イディオム流用）。
  const byA1 = new Map();
  for (const e of evs) {
    const key = (e.a1code == null) ? OTHER_KEY : String(e.a1code);
    if (!byA1.has(key)) byA1.set(key, []);
    byA1.get(key).push(e);
  }
  const rows = [];
  for (const [key, group] of byA1) {
    const a1code = (key === OTHER_KEY) ? null : key;
    // name_ja: その他バケット→固定、既知→マップ、未知→コードフォールバック。
    let name_ja;
    if (a1code == null) name_ja = OTHER_NAME;
    else name_ja = nameMap[a1code] || a1code;
    // byLayer 内訳。
    const byLayer = {};
    for (const e of group) byLayer[e.layerId] = (byLayer[e.layerId] || 0) + 1;
    // 重心（県内イベントの単純平均）。
    let sx = 0;
    let sy = 0;
    for (const e of group) { sx += e.lon; sy += e.lat; }
    const lon = sx / group.length;
    const lat = sy / group.length;
    // topEvents: 入力順の先頭3を代表として保持（aggregate.js の代表点選定を簡素化流用）。
    const topEvents = group.slice(0, 3);
    rows.push({ a1code, name_ja, count: group.length, byLayer, topEvents, lon, lat });
  }
  // count 降順・同数は name_ja 昇順で安定ソート。その他バケットも name_ja で同列に扱う。
  rows.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return String(a.name_ja).localeCompare(String(b.name_ja), 'ja');
  });
  return rows;
}

export function attachNearestCity(events, cities) {
  const evs = Array.isArray(events) ? events : [];
  const list = Array.isArray(cities) ? cities : [];
  return evs.map((e) => {
    const city = nearestCity(e.lon, e.lat, list);
    const cityName = city ? (city.name_ja || city.name || null) : null;
    return { ...e, cityName };
  });
}

// instabilityCountry が無い時の最小ヘッダ（drilldown_view が安全に描ける形）。
function emptyHeader(fips) {
  return { code: fips, name_ja: null, score: 0, trend: null, counts: null, narrative_ja: null };
}

// forecastCards 配列から先頭カードの watch/title_ja を要約した {watch, label} を返す。
// カードが空/未設定なら null（C5 _forecastHtml が header.forecast を読む）。
function summarizeForecast(forecastCards) {
  if (!Array.isArray(forecastCards) || forecastCards.length === 0) return null;
  const first = forecastCards[0];
  if (!first) return null;
  return {
    watch: first.watch != null ? first.watch : null,
    label: first.title_ja != null ? first.title_ja : (first.title != null ? first.title : null),
  };
}

export function buildDrilldown(
  { fips, snapshots, countryPolys, admin1Polys, cities, instabilityCountry, forecastCards } = {},
  { MAX_POINTS = 4000 } = {},
) {
  // header は instabilityCountry をそのまま流用（新規 LLM 生成なし）。無ければ最小ヘッダ。
  const base = (instabilityCountry && typeof instabilityCountry === 'object')
    ? { ...instabilityCountry }
    : emptyHeader(fips);
  if (base.code == null) base.code = fips;
  // patch #2: forecastCards から forecast:{watch,label} を要約して header に併設。
  const forecast = summarizeForecast(forecastCards);
  const header = {
    ...base,
    forecastCards: Array.isArray(forecastCards) ? forecastCards : [],
    forecast,
  };

  // 国内イベント抽出＋最寄り都市付与（events は常に返す＝国集計は生きる）。
  const collected = collectCountryEvents(snapshots, fips, countryPolys);
  const withCity = attachNearestCity(collected, cities);

  // MAX_POINTS 超過→ admin1 割当をスキップし国集計のみのデグレード。
  if (withCity.length > MAX_POINTS) {
    // patch #1: degraded 時も a1code/regionName を付与（全 null・regionName='その他/不明'）。
    const events = withCity.map((e) => ({ ...e, a1code: null, regionName: OTHER_NAME }));
    return { header, regions: [], events, degraded: true };
  }

  // admin1 割当→ 県別集計。a1NameMap は admin1Polys から {code: name_ja||name}。
  const polys = Array.isArray(admin1Polys) ? admin1Polys : [];
  const a1NameMap = {};
  for (const p of polys) {
    if (p && p.code != null) a1NameMap[p.code] = p.name_ja || p.name || p.code;
  }
  const withA1 = assignAdmin1(withCity, polys);

  // patch #1: 各 event に regionName を付与（a1code→name_ja via a1NameMap、null は 'その他/不明'）。
  const events = withA1.map((e) => {
    const regionName = e.a1code != null
      ? (a1NameMap[e.a1code] || e.a1code)
      : OTHER_NAME;
    return { ...e, regionName };
  });

  const regions = aggregateByAdmin1(withA1, a1NameMap);

  return { header, regions, events, degraded: false };
}
