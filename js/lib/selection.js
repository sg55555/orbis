import { pointAlongPath } from './motion.js';
import { hostnameOf } from './geo.js';
import { categoryOf } from './news_categories.js';
import { fipsToJa, rootToJa } from './places.js';

// flyTo 着地点の可視化ヘルパ（純粋関数）。
// ・selectionPopupHtml: イベント名＋色ドット＋移動ガイドの popup HTML を組む
// ・flightPopupHtml: 航空機クリック時のポップアップ（便名/高度/速度/方位/推定到達）
// ・buildReticleConfigs: 着地リティクル（多重リング＋着地ピン）の ScatterplotLayer config 配列を返す
//   ※ deck グローバルに依存しないよう config を返し、呼び出し側で new deck.ScatterplotLayer する。

const LAYER_RGB = { quakes: [255, 176, 40], conflict: [255, 60, 80], protests: [94, 255, 166] };
const CYAN = [57, 208, 255];
// 推定進路の色＝機体シアンの補色マゼンタ（航空・船で共通）。
export const PROJ_RGB = [255, 90, 220];
export const PROJ_FLOW_RGB = [255, 150, 235];

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 推定進路の延長（分）を読みやすい和文に整形（純粋関数）。
// 60分未満→「約N分後」、60分以上→「約N時間後」、端数あり→「約N時間M分後」。
// 例: 600→「約10時間後」、90→「約1時間30分後」、20→「約20分後」。
export function projLabel(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `約${m}分後`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `約${h}時間後` : `約${h}時間${rem}分後`;
}

// item: { title, layerId, lon, lat, time } → 着地点ポップアップの HTML。
export function selectionPopupHtml(item) {
  const it = item || {};
  const rgb = LAYER_RGB[it.layerId] || CYAN;
  const dot = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const coord = (it.lon != null && it.lat != null)
    ? `<div class="sel-meta">座標 ${Number(it.lat).toFixed(2)}, ${Number(it.lon).toFixed(2)}</div>` : '';
  const when = it.time ? `<div class="sel-meta">${new Date(it.time).toLocaleString('ja-JP')}</div>` : '';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">${escapeHtml(it.title)}</span></div>`
    + coord + when
    + '<div class="sel-hint">📍 この地点へ移動しました</div>'
    + '</div>';
}

// 航空機クリック時のポップアップ（便名/高度/速度/方位/推定進路）。
// minutes: 推定進路の延長時間（分）。目的地は OpenSky に無いため heading の延長＝推定。
export function flightPopupHtml(p, arrival, minutes = 20) {
  const o = p || {};
  const cs = String(o.callsign || '').trim() || '(便名なし)';
  const alt = (o.on_ground || o.alt == null) ? '地上' : `${Math.round(o.alt)}m`;
  const spd = Math.round(o.velocity || 0);
  const hd = Math.round(o.heading || 0);
  const dot = 'rgb(80,220,255)';
  const arr = arrival ? `${Number(arrival[1]).toFixed(2)}, ${Number(arrival[0]).toFixed(2)}` : '—';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">✈ ${escapeHtml(cs)}</span></div>`
    + `<div class="sel-meta">高度 ${alt}｜速度 ${spd}m/s｜方位 ${hd}°</div>`
    + `<div class="sel-hint">📍 推定進路 ${projLabel(minutes)} ${arr}<br><span class="sel-note">※目的地データ無し・heading の延長による推定</span></div>`
    + '</div>';
}

const PING_MS = 1400;

// selected: { lon, lat, at } / now: performance.now() / opts.reduced で ping を省く。
// 戻り値は ScatterplotLayer の config 配列（呼び出し側で new する）。
export function buildReticleConfigs(selected, now = 0, opts = {}) {
  if (!selected) return [];
  const data = [selected];
  const pos = (d) => [d.lon, d.lat];
  const cfgs = [
    { id: 'sel-glow', data, radiusUnits: 'pixels', stroked: false, filled: true,
      getPosition: pos, getRadius: 30, getFillColor: [...CYAN, 40], pickable: false },
    { id: 'sel-ring', data, radiusUnits: 'pixels', stroked: true, filled: false,
      lineWidthUnits: 'pixels', getLineWidth: 3, getPosition: pos, getRadius: 22,
      getLineColor: [...CYAN, 255], pickable: false },
    { id: 'sel-dot', data, radiusUnits: 'pixels', stroked: false, filled: true,
      getPosition: pos, getRadius: 5, getFillColor: [255, 255, 255, 235], pickable: false },
  ];
  if (!opts.reduced) {
    const age = now - (selected.at || 0);
    const phase = (((age % PING_MS) + PING_MS) % PING_MS) / PING_MS; // 0..1 ループ
    cfgs.push({ id: 'sel-ping', data, radiusUnits: 'pixels', stroked: true, filled: false,
      lineWidthUnits: 'pixels', getLineWidth: 2, getPosition: pos,
      getRadius: 16 + 36 * phase,
      getLineColor: [...CYAN, Math.round(200 * (1 - phase))],
      updateTriggers: { getRadius: now, getLineColor: now }, pickable: false });
  }
  return cfgs;
}

// 推定進路の deck config 群を返す（純粋・deck 非依存。航空/船で共用）。
// sel: { src:[lon,lat], arrival:[lon,lat]|null, prefix }。motionT: 0..1。opts.reduced で flow/pulse 省略。
// 返り値: [{ kind:'line'|'scatter', config }]（呼び出し側で new deck.LineLayer/ScatterplotLayer する）。
export function buildProjectionConfigs(sel, motionT = 0, opts = {}) {
  if (!sel || !sel.src || !sel.arrival) return [];
  const { src, arrival, prefix } = sel;
  const out = [
    { kind: 'line', config: {
      id: `${prefix}-route`, data: [{}], widthUnits: 'pixels', getWidth: 2,
      getSourcePosition: () => src, getTargetPosition: () => arrival,
      getColor: [...PROJ_RGB, 200], pickable: false,
    } },
    { kind: 'scatter', config: {
      id: `${prefix}-arrival`, data: [{}], radiusUnits: 'pixels',
      stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 2.5,
      getPosition: () => arrival, getRadius: 9, getLineColor: [...PROJ_RGB, 240], pickable: false,
    } },
  ];
  if (!opts.reduced) {
    const PER = 6;
    const pts = [];
    for (let k = 0; k < PER; k++) {
      const t = (motionT + k / PER) % 1;
      const pp = pointAlongPath([src, arrival], t);
      if (pp) pts.push({ position: pp, t });
    }
    out.push({ kind: 'scatter', config: {
      id: `${prefix}-flow`, data: pts, radiusUnits: 'pixels',
      getPosition: (d) => d.position, getRadius: 3,
      getFillColor: (d) => [...PROJ_FLOW_RGB, Math.round(110 + 140 * Math.sin(Math.PI * d.t))],
      updateTriggers: { getPosition: motionT, getFillColor: motionT }, pickable: false,
    } });
    const ph = motionT;
    out.push({ kind: 'scatter', config: {
      id: `${prefix}-arrival-pulse`, data: [{}], radiusUnits: 'pixels',
      stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 1.5,
      getPosition: () => arrival, getRadius: 9 + 16 * ph,
      getLineColor: [...PROJ_RGB, Math.round(220 * (1 - ph))],
      updateTriggers: { getRadius: ph, getLineColor: ph }, pickable: false,
    } });
  }
  return out;
}

// 船舶クリック時のポップアップ（船名/船種/速度/航路/推定進路）。flightPopupHtml と対。
// arrival が null（停泊/速度0/針路不明）は推定不可を明示。
export function shipPopupHtml(p, arrival, minutes = 60) {
  const o = p || {};
  const head = o.name ? escapeHtml(o.name) : `MMSI ${o.mmsi}`;
  const spd = o.sog == null ? '—' : `${Math.round(o.sog)}kn`;
  const cog = o.cog == null ? '—' : `${String(Math.round(o.cog) % 360).padStart(3, '0')}°`;
  const dot = `rgb(${PROJ_RGB.join(',')})`;
  const arr = arrival ? `${Number(arrival[1]).toFixed(2)}, ${Number(arrival[0]).toFixed(2)}` : '—';
  const hint = arrival
    ? `📍 推定進路 ${projLabel(minutes)} ${arr}<br><span class="sel-note">※AIS の COG/SOG 延長による推定（針路・速度一定と仮定）</span>`
    : '<span class="sel-note">速度0/針路不明で進路推定不可</span>';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">🚢 ${head}</span></div>`
    + `<div class="sel-meta">船種 ${escapeHtml(o.type || '不明')}｜速度 ${spd}｜航路 ${cog}</div>`
    + `<div class="sel-hint">${hint}</div>`
    + '</div>';
}

// ニュースピンのクリック用ポップアップ（日本語見出し＋要約＋カテゴリ＋出典リンク）。
export function newsPopupHtml(p) {
  const o = p || {};
  const c = categoryOf(o.category);
  const dot = `rgb(${c.color.join(',')})`;
  const host = hostnameOf(o.url);
  // href は http/https のみ許可（不正フィードの javascript: 等を無効化）。
  const safeUrl = /^https?:\/\//i.test(o.url || '') ? o.url : '#';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">${escapeHtml(o.title_ja || '')}</span></div>`
    + `<div class="sel-meta">${escapeHtml(c.label)}${o.place ? '｜' + escapeHtml(o.place) : ''}</div>`
    + (o.summary_ja ? `<div class="sel-hint">${escapeHtml(o.summary_ja)}</div>` : '')
    + `<div class="sel-hint"><a class="sel-link" style="color:#7fd8ff" href="${escapeHtml(safeUrl)}"`
    + ` target="_blank" rel="noopener">${escapeHtml(host)} ↗</a></div>`
    + '</div>';
}

const GDELT_LABEL = { conflict: '紛争', protests: '抗議' };

// globe 個別点のクリック詳細（記事リンク付き）。紛争/抗議で共用。
export function gdeltEventPopupHtml(event, layerId) {
  const o = event || {};
  const rgb = LAYER_RGB[layerId] || CYAN;
  const dot = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const label = GDELT_LABEL[layerId] || '報道';
  const sub = layerId === 'conflict' ? `（${rootToJa(o.root)}）` : '';
  const m = Number(o.mentions) || 0;
  const host = hostnameOf(o.url);
  const safeUrl = /^https?:\/\//i.test(o.url || '') ? o.url : '#';
  // 紛争は fipsToJa（コード付き）、抗議は日本語名のみ（括弧なし）
  const placeName = o.place ? fipsToJa(o.place).split('（')[0] : '';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">${escapeHtml(label + sub)}</span></div>`
    + `<div class="sel-meta">${escapeHtml(placeName)}｜報道 ${m}件</div>`
    + `<div class="sel-hint"><a class="sel-link" style="color:#7fd8ff" href="${escapeHtml(safeUrl)}"`
    + ` target="_blank" rel="noopener">${escapeHtml(host)} ↗</a></div>`
    + '<div class="sel-hint">📍 この地点へ移動しました</div>'
    + '</div>';
}

// フィード国別行のクリック詳細（国サマリ・記事リンク無し）。
export function gdeltCountryPopupHtml(group) {
  const g = group || {};
  const rgb = LAYER_RGB[g.layerId] || CYAN;
  const dot = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const label = GDELT_LABEL[g.layerId] || '報道';
  const dom = (g.layerId === 'conflict' && g.dominantRootJa) ? `・最多は${g.dominantRootJa}` : '';
  const srcs = (Array.isArray(g.topSources) && g.topSources.length) ? g.topSources.join('、') : '—';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">${escapeHtml(label + ' ' + (g.country_ja || ''))}</span></div>`
    + `<div class="sel-meta">24h ${Number(g.count) || 0}件${escapeHtml(dom)}</div>`
    + `<div class="sel-meta">主な出典 ${escapeHtml(srcs)}</div>`
    + '<div class="sel-hint">📍 この地点へ移動しました</div>'
    + '</div>';
}
