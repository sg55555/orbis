// MapLibre GL（globe投影）を初期化し、deck.gl の MapboxOverlay を載せる。
// maplibregl と deck は index.html の CDN によりグローバル提供される。

import { buildBaseStyle } from './style.js';
import { getLook } from './lib/look.js';

// globe の外周に大気の発光ハロを付ける（MapLibre v5 native sky）。
// space は不透明色を置かない＝背面の星雲が透けるよう、sky/horizon/fog のみ設定する。
// atmosphere-blend はズームで減衰させ、近接時は素のベースマップに戻す。
export function applyAtmosphere(map, look) {
  if (!map.setSky) return false;
  const sk = (look && look.sky) || { skyColor: '#0a1f3c', horizonColor: '#2f6fb3', fogColor: '#081428', atmosphere: 0.9 };
  map.setSky({
    'sky-color': sk.skyColor,
    'sky-horizon-blend': 0.6,
    'horizon-color': sk.horizonColor,
    'horizon-fog-blend': 0.6,
    'fog-color': sk.fogColor,
    'fog-ground-blend': 0.4,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, sk.atmosphere, 5, sk.atmosphere * 0.5, 8, 0],
  });
  return true;
}

export function initMap(container, getTooltip, onClick, look = getLook()) {
  const map = new maplibregl.Map({
    container,
    style: buildBaseStyle(look),
    center: [0, 20],
    zoom: 1.2,
    minZoom: 0,
    renderWorldCopies: false,
    attributionControl: true,
    localIdeographFontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif",
  });
  map.on('style.load', () => {
    if (map.setProjection) map.setProjection({ type: 'globe' });
    applyAtmosphere(map, look);
  });

  const overlay = new deck.MapboxOverlay({
    interleaved: false, layers: [], getTooltip,
    pickingRadius: 8,                 // カーソル近傍8pxを判定（小ドット・細線でも拾う）
    onClick: onClick || undefined,
  });
  map.addControl(overlay);
  return { map, overlay };
}

// deck レイヤー配列を差し替える。
export function setDeckLayers(overlay, deckLayers) {
  overlay.setProps({ layers: deckLayers });
}
