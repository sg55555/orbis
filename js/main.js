import { initMap, setDeckLayers } from './map.js';
import { layers, buildDeckLayers } from './layers/registry.js';
import { startPolling, fetchManifest } from './snapshot.js';
import { formatFreshness } from './lib/geo.js';

const POLL_MS = 60000;

function renderLegend() {
  const rows = document.getElementById('legend-rows');
  const quakes = layers.find((l) => l.id === 'quakes');
  if (!quakes) return;
  rows.innerHTML = quakes.legend.map(
    (e) => `<div class="row"><span class="dot" style="color:${e.color};background:${e.color}"></span>${e.label}</div>`
  ).join('');
}

async function updateFreshness() {
  try {
    const m = await fetchManifest();
    const q = m.layers && m.layers.quakes;
    document.getElementById('freshness').textContent =
      q ? `地震データ：${formatFreshness(q.updated)}（${q.count}件）` : 'データ取得中…';
  } catch { /* noop */ }
}

function boot() {
  const { map, overlay } = initMap('map');
  const enabled = new Set(['quakes']);
  renderLegend();

  // e2e/デバッグ用フック
  window.__orbis = { map, overlay, lastCount: 0 };

  // マップのロード完了後にポーリング開始（ローディング表示を消してから描画）。
  map.on('load', () => {
    document.getElementById('loading').classList.add('hidden');
    startPolling([...enabled], POLL_MS, (snapshots) => {
      const deckLayers = buildDeckLayers(enabled, snapshots);
      setDeckLayers(overlay, deckLayers);
      window.__orbis.lastCount = snapshots.quakes?.points?.length ?? 0;
      updateFreshness();
    });
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
