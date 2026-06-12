// MapLibre GL（globe投影）を初期化し、deck.gl の MapboxOverlay を載せる。
// maplibregl と deck は index.html の CDN によりグローバル提供される。

const DARK_STYLE = {
  version: 8,
  // 無料・キー不要の OSS ダークラスタタイル（CARTO dark_all）
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap, © CARTO',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#05080f' } },
    { id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.85 } },
  ],
};

export function initMap(container) {
  const map = new maplibregl.Map({
    container,
    style: DARK_STYLE,
    center: [0, 20],
    zoom: 1.4,
    attributionControl: true,
  });
  // 地球儀投影（遠景）。ズームインで平面に近づく。
  map.on('style.load', () => {
    if (map.setProjection) map.setProjection({ type: 'globe' });
  });

  const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);

  return { map, overlay };
}

// deck レイヤー配列を差し替える。
export function setDeckLayers(overlay, deckLayers) {
  overlay.setProps({ layers: deckLayers });
}
