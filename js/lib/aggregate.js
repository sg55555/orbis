// 紛争/抗議の点群を国(FIPS)別に集約して GroupRow を返す（純粋・deck/DOM 非依存）。
import { FIPS_JA, rootToJa, severityRank } from './places.js';
import { hostnameOf } from './geo.js';
import { parseGdeltDate } from './feed.js';

export function aggregateByCountry(points, layerId) {
  const pts = Array.isArray(points) ? points : [];
  const byPlace = new Map();
  for (const p of pts) {
    const key = (p.place == null || p.place === '') ? '' : String(p.place);
    if (!byPlace.has(key)) byPlace.set(key, []);
    byPlace.get(key).push(p);
  }
  const rows = [];
  for (const [place, group] of byPlace) {
    // dominantRoot: 最頻 root（同数は重大度で決定）
    const rootCount = new Map();
    for (const p of group) { const r = String(p.root); rootCount.set(r, (rootCount.get(r) || 0) + 1); }
    let dominantRoot = null, best = -1;
    for (const [r, n] of rootCount) {
      if (n > best || (n === best && severityRank(r) > severityRank(dominantRoot))) { best = n; dominantRoot = r; }
    }
    // topSources: hostname 出現頻度 上位3
    const hostCount = new Map();
    for (const p of group) { const h = hostnameOf(p.url); if (h) hostCount.set(h, (hostCount.get(h) || 0) + 1); }
    const topSources = [...hostCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    // 代表点: 最多 mentions（同数は最新 date）
    let rep = group[0];
    for (const p of group) {
      const pm = Number(p.mentions) || 0, rm = Number(rep.mentions) || 0;
      if (pm > rm || (pm === rm && String(p.date) > String(rep.date))) rep = p;
    }
    rows.push({
      id: `${layerId}-${place}`, kind: 'group', layerId, place,
      country_ja: FIPS_JA[place] || place, count: group.length,
      mentionsTotal: group.reduce((s, p) => s + (Number(p.mentions) || 0), 0),
      dominantRoot, dominantRootJa: rootToJa(dominantRoot), topSources,
      time: group.reduce((mx, p) => Math.max(mx, parseGdeltDate(p.date)), 0),
      lon: rep.lon, lat: rep.lat,
    });
  }
  return rows;
}

// 上位 topN 国の代表点に脈打つリング config（純粋）。reduced/空で []。
export function buildHotspotConfigs(groups, motionT = 0, opts = {}) {
  const { reduced = false, topN = 6, rgb = [255, 60, 80] } = opts;
  if (reduced || !Array.isArray(groups) || groups.length === 0) return [];
  const top = [...groups].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, topN);
  const phase = (((motionT % 1) + 1) % 1);
  return [{
    id: `hot-${rgb.join('-')}`, data: top, radiusUnits: 'pixels',
    stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 2,
    getPosition: (d) => [d.lon, d.lat],
    getRadius: (d) => 10 + Math.min(28, (d.count || 0) * 0.6) + 18 * phase,
    getLineColor: () => [rgb[0], rgb[1], rgb[2], Math.round(200 * (1 - phase))],
    updateTriggers: { getRadius: motionT, getLineColor: motionT },
    pickable: false,
  }];
}
