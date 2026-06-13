// MapLibre GL（globe投影）を初期化し、deck.gl の MapboxOverlay を載せる。
// maplibregl と deck は index.html の CDN によりグローバル提供される。

import { buildBaseStyle } from './style.js';

export function initMap(container, getTooltip) {
  const map = new maplibregl.Map({
    container,
    style: buildBaseStyle(),
    center: [0, 20],
    zoom: 1.2,
    minZoom: 0,
    attributionControl: true,
    localIdeographFontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif",
  });
  // 地球儀投影（遠景）。ズームインで平面に近づく。
  map.on('style.load', () => {
    if (map.setProjection) map.setProjection({ type: 'globe' });
  });

  const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [], getTooltip });
  map.addControl(overlay);

  return { map, overlay };
}

// deck レイヤー配列を差し替える。
export function setDeckLayers(overlay, deckLayers) {
  overlay.setProps({ layers: deckLayers });
}
