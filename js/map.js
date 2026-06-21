// MapLibre GL（globe投影）を初期化し、deck.gl の MapboxOverlay を載せる。
// maplibregl と deck は index.html の CDN によりグローバル提供される。

import { buildBaseStyle } from './style.js';
import { getLook } from './lib/look.js';

// globe の外周に大気の発光ハロを付ける（MapLibre v5 native sky）。
// space は不透明色を置かない＝背面の星雲が透けるよう、sky/horizon/fog のみ設定する。
// blendStops は atmosphere-blend の補間ストップ [zoom,value,...]。没入ダイヤル glow が決める
// （強さ＋減衰範囲）。gz で globe を大きく(zoom高)しても大気が消えないよう減衰を遅らせる。
export function applyAtmosphere(map, look, blendStops = [0, 0.85, 6, 0.45, 9, 0]) {
  if (!map.setSky) return false;
  const sk = (look && look.sky) || { skyColor: '#0a1f3c', horizonColor: '#2f6fb3', fogColor: '#081428' };
  map.setSky({
    'sky-color': sk.skyColor,
    'sky-horizon-blend': 0.6,
    'horizon-color': sk.horizonColor,
    'horizon-fog-blend': 0.6,
    'fog-color': sk.fogColor,
    'fog-ground-blend': 0.4,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], ...blendStops],
  });
  return true;
}

// zoom は初期ズーム（没入ダイヤル gz で globe の見かけの大きさを変える）。
// blendStops は大気の atmosphere-blend ストップ（没入ダイヤル glow）。
export function initMap(container, getTooltip, onClick, look = getLook(), zoom = 2.7, blendStops, center = [0, 20]) {
  const map = new maplibregl.Map({
    container,
    style: buildBaseStyle(look),
    center,
    zoom,
    minZoom: 0,
    renderWorldCopies: false,
    attributionControl: true,
    localIdeographFontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif",
  });
  map.on('style.load', () => {
    if (map.setProjection) map.setProjection({ type: 'globe' });
    applyAtmosphere(map, look, blendStops);
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
