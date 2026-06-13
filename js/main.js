import { initMap, setDeckLayers } from './map.js';
import { layers, buildDeckLayers, tooltipFor, feedLayers } from './layers/registry.js';
import { startPolling, fetchManifest } from './snapshot.js';
import { formatFreshness } from './lib/geo.js';
import { loadEnabled, readStored } from './lib/state.js';
import { mountStarfield } from './lib/starfield.js';
import { renderPanel, wireCollapse } from './ui/panel.js';
import { buildFeed } from './lib/feed.js';
import { renderFeed, wireCollapse as wireFeedCollapse } from './ui/feed.js';

const POLL_MS = 60000;
const POLL_LAYERS = ['quakes', 'flights', 'conflict', 'protests']; // スナップショットを持つ層
const ALL_IDS = ['quakes', 'flights', 'conflict', 'protests', 'trade'];
let ENABLED = loadEnabled(ALL_IDS, readStored());

const snapshots = {}; // id -> snapshot（trade は静的、その他はポーリング更新）
let panel;

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
  if (panel) panel.updateCounts();
  refreshFeed();
}

function refreshFeed() {
  const items = buildFeed(feedLayers(), snapshots, ENABLED);
  renderFeed(document.getElementById('feed-rows'), items, (it) => {
    window.__orbis.map.flyTo({ center: [it.lon, it.lat], zoom: 5, duration: 1500 });
  });
}

function boot() {
  const { map, overlay } = initMap('map', (info) =>
    (info.object && info.layer) ? tooltipFor(info.layer.id, info.object) : null
  );
  mountStarfield(document.getElementById('starfield'));
  window.__orbis = { map, overlay, counts: {} };

  panel = renderPanel(
    document.getElementById('panel-rows'),
    layers,
    () => ENABLED,
    () => window.__orbis.counts,
    (next) => { ENABLED = next; rebuild(overlay); }
  );
  wireCollapse(document.getElementById('panel'), document.getElementById('panel-toggle'));
  wireFeedCollapse(document.getElementById('feed'), document.getElementById('feed-toggle'));

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
