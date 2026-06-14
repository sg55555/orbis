// flyTo 着地点の可視化ヘルパ（純粋関数）。
// ・selectionPopupHtml: イベント名＋色ドット＋移動ガイドの popup HTML を組む
// ・flightPopupHtml: 航空機クリック時のポップアップ（便名/高度/速度/方位/推定到達）
// ・buildReticleConfigs: 着地リティクル（多重リング＋着地ピン）の ScatterplotLayer config 配列を返す
//   ※ deck グローバルに依存しないよう config を返し、呼び出し側で new deck.ScatterplotLayer する。

const LAYER_RGB = { quakes: [255, 176, 40], conflict: [255, 60, 80], protests: [94, 255, 166] };
const CYAN = [57, 208, 255];

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
    + `<div class="sel-hint">📍 推定進路 約${minutes}分後 ${arr}<br><span class="sel-note">※目的地データ無し・heading の延長による推定</span></div>`
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
