import { initMap, setDeckLayers } from './map.js';
import { layers, buildDeckLayers } from './layers/registry.js';
import { startPolling, fetchManifest } from './snapshot.js';
import { formatFreshness } from './lib/geo.js';
import { mountStarfield } from './lib/starfield.js';

const POLL_MS = 60000;
const POLL_LAYERS = ['quakes', 'flights', 'conflict', 'protests']; // スナップショットを持つ層
const ENABLED = new Set(['quakes', 'flights', 'conflict', 'protests', 'trade']);

const snapshots = {}; // id -> snapshot（trade は静的、その他はポーリング更新）

function renderLegend() {
  const rows = document.getElementById('legend-rows');
  rows.innerHTML = layers.map((l) => {
    const items = (l.legend || []).map(
      (e) => `<div class="row"><span class="dot" style="color:${e.color};background:${e.color}"></span>${e.label}</div>`
    ).join('');
    return `<div class="legend-group"><div class="legend-title">${l.label}</div>${items}</div>`;
  }).join('');
}

async function updateFreshness() {
  try {
    const m = await fetchManifest();
    const q = m.layers && m.layers.quakes;
    const f = m.layers && m.layers.flights;
    const parts = [];
    if (q) parts.push(`地震 ${q.count}（${formatFreshness(q.updated)}）`);
    if (f) parts.push(`航空 ${f.count}`);
    document.getElementById('freshness').textContent = parts.length ? parts.join(' / ') : 'データ取得中…';
  } catch { /* noop */ }
}

function rebuild(overlay) {
  setDeckLayers(overlay, buildDeckLayers(ENABLED, snapshots));
  window.__orbis.counts = Object.fromEntries(
    Object.entries(snapshots).map(([k, v]) => [k, (v && (v.points?.length ?? v.features?.length)) ?? 0])
  );
}

function boot() {
  const { map, overlay } = initMap('map');
  mountStarfield(document.getElementById('starfield'));
  renderLegend();
  window.__orbis = { map, overlay, counts: {} };

  map.on('load', async () => {
    document.getElementById('loading').classList.add('hidden');

    // 静的な貿易ルートを trade レイヤー自身の fetch() で一度だけ読み込む
    try {
      const trade = layers.find((l) => l.id === 'trade');
      if (trade) snapshots.trade = await trade.fetch();
    } catch { /* noop */ }
    rebuild(overlay);

    startPolling(POLL_LAYERS, POLL_MS, (polled) => {
      Object.assign(snapshots, polled);
      rebuild(overlay);
      updateFreshness();
    });
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
