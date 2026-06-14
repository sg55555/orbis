// flyTo 着地点の可視化ヘルパ（純粋関数）。
// ・selectionPopupHtml: イベント名＋色ドット＋移動ガイドの popup HTML を組む
// ・buildReticleConfigs: 着地リティクル（多重リング＋着地ピン）の ScatterplotLayer config 配列を返す
//   ※ deck グローバルに依存しないよう config を返し、呼び出し側で new deck.ScatterplotLayer する。

const LAYER_RGB = { quakes: [255, 176, 40], conflict: [255, 60, 80], protests: [94, 255, 166] };
const CYAN = [57, 208, 255];

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// item: { title, layerId } → 着地点ポップアップの HTML 文字列。
export function selectionPopupHtml(item) {
  const it = item || {};
  const rgb = LAYER_RGB[it.layerId] || CYAN;
  const dot = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">${escapeHtml(it.title)}</span></div>`
    + '<div class="sel-hint">📍 この地点へ移動しました</div>'
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
      getPosition: pos, getRadius: 26, getFillColor: [...CYAN, 40], pickable: false },
    { id: 'sel-ring', data, radiusUnits: 'pixels', stroked: true, filled: false,
      lineWidthUnits: 'pixels', getLineWidth: 3, getPosition: pos, getRadius: 18,
      getLineColor: [...CYAN, 255], pickable: false },
    { id: 'sel-dot', data, radiusUnits: 'pixels', stroked: false, filled: true,
      getPosition: pos, getRadius: 4, getFillColor: [255, 255, 255, 235], pickable: false },
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
