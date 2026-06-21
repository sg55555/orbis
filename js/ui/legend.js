// 常設「凡例＋使い方」オーバーレイ。各層の legend[]/marker を地表に出す（読む専用）。
// 純粋な HTML ビルダ（node:test 対象）と DOM 配線 renderLegend（e2e 対象）を同居。

const HELP_ITEMS = [
  ['🖱', 'フィード／地図上のイベントをクリック → その地点へ移動'],
  ['🛩', '航空機・船をクリック → 推定進路を表示'],
  ['⏬', '下にスクロール → ライブメディア（ニュース／カメラ）'],
  ['🎛', '左パネル → レイヤーの ON/OFF・プリセット切替'],
  ['🌐', 'ドラッグ／ホイール → 地球を回転・ズーム'],
];

// 1レイヤーのブロック。line/gradient は currentColor を無視する形なので、
// tier は色が出る chip で描く（冷/中/暖の色を見せる）。それ以外は層 marker の形。
export function layerBlockHtml(lm) {
  const tierMarker = (lm.marker === 'line' || lm.marker === 'gradient') ? 'chip' : lm.marker;
  const rows = (lm.tiers || []).map((t) =>
    `<div class="legend-tier"><span class="swatch swatch-${tierMarker}" style="color:${t.color}"></span>`
    + `<span class="legend-tier-label">${t.label}</span></div>`
  ).join('');
  return `<div class="legend-layer">`
    + `<div class="legend-layer-head">`
    + `<span class="swatch swatch-${lm.marker}" style="color:${lm.swatchColor}"></span>`
    + `<span class="legend-layer-name">${lm.label}</span></div>`
    + rows
    + (lm.desc ? `<div class="legend-desc">${lm.desc}</div>` : '')
    + `</div>`;
}

export function legendHtml(model) {
  return model.map((g) =>
    `<div class="legend-cat"><div class="layer-cat-head">${g.label}</div>`
    + g.layers.map(layerBlockHtml).join('')
    + `</div>`
  ).join('');
}

export function helpHtml() {
  return `<ul class="legend-help-list">`
    + HELP_ITEMS.map(([icon, txt]) =>
        `<li><span class="legend-help-icon">${icon}</span><span>${txt}</span></li>`).join('')
    + `</ul>`;
}
