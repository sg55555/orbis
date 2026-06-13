import { initMap, setDeckLayers } from './map.js';
import { layers, buildDeckLayers, tooltipFor, feedLayers } from './layers/registry.js';
import { startPolling, fetchManifest } from './snapshot.js';
import { formatFreshness } from './lib/geo.js';
import { loadEnabled, readStored } from './lib/state.js';
import { mountStarfield } from './lib/starfield.js';
import { renderPanel, wireCollapse } from './ui/panel.js';
import { buildFeed } from './lib/feed.js';
import { renderFeed, wireCollapse as wireFeedCollapse } from './ui/feed.js';
import { pointAlongPath, diffNewIds } from './lib/motion.js';

const POLL_MS = 60000;
const POLL_LAYERS = ['quakes', 'flights', 'conflict', 'protests']; // スナップショットを持つ層
const ALL_IDS = ['quakes', 'flights', 'conflict', 'protests', 'trade'];
let ENABLED = loadEnabled(ALL_IDS, readStored());

const snapshots = {}; // id -> snapshot（trade は静的、その他はポーリング更新）
let panel;

const REDUCED = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
let motionT = 0;          // 0..1 ループする位相
let prevIds = {};         // layerId -> Set（前回のid集合。新規検出用）
let pulses = [];          // { lon, lat, born } 出現パルス
let _overlay = null;      // rAF ループ用の overlay 参照

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
  // 新規イベント検出（quakes/conflict/protests）。初回(prevIds 空)はパルスしない。
  for (const id of ['quakes', 'conflict', 'protests']) {
    const snap = snapshots[id];
    if (!snap || !snap.points) continue;
    const newIds = diffNewIds(prevIds[id], snap.points);
    if (prevIds[id]) {
      const byId = new Map(snap.points.map((p) => [p.id, p]));
      for (const nid of newIds) {
        const p = byId.get(nid);
        if (p) pulses.push({ lon: p.lon, lat: p.lat, born: performance.now() });
      }
    }
    prevIds[id] = new Set(snap.points.map((p) => p.id));
  }

  drawAll(overlay);
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

// trade スナップショットの LineString 上を流れる粒子レイヤー（1航路あたり数粒子）。
function flowParticlesLayer() {
  const geo = snapshots.trade;
  if (!geo || !geo.features || REDUCED) return null;
  const lines = geo.features.filter((f) => f.geometry && f.geometry.type === 'LineString');
  const PER = 3; // 1航路あたり粒子数（軽量）
  const pts = [];
  for (const f of lines) {
    for (let k = 0; k < PER; k++) {
      const t = (motionT + k / PER) % 1;
      const p = pointAlongPath(f.geometry.coordinates, t);
      if (p) pts.push({ position: p });
    }
  }
  return new deck.ScatterplotLayer({
    id: 'trade-flow', data: pts, radiusUnits: 'pixels',
    getPosition: (d) => d.position, getRadius: 2.5,
    getFillColor: [120, 240, 255, 220], pickable: false,
  });
}

// pulses（出現後 ~1.5s）の拡大リング。期限切れは描画前に除去。
const PULSE_MS = 1500;
function pulseLayer(now) {
  pulses = pulses.filter((p) => now - p.born < PULSE_MS);
  if (REDUCED || pulses.length === 0) return null;
  return new deck.ScatterplotLayer({
    id: 'event-pulse', data: pulses, radiusUnits: 'pixels',
    stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 2,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => 6 + 30 * ((now - p.born) / PULSE_MS),
    getLineColor: (p) => [120, 240, 255, Math.round(220 * (1 - (now - p.born) / PULSE_MS))],
    updateTriggers: { getRadius: now, getLineColor: now },
    pickable: false,
  });
}

// 現在の snapshots/ENABLED から deck レイヤー配列を組んで描く（動的レイヤーを base に重畳）。
function drawAll(overlay) {
  _overlay = overlay;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const base = buildDeckLayers(ENABLED, snapshots);
  const extra = [];
  if (ENABLED.has('trade')) { const fp = flowParticlesLayer(); if (fp) extra.push(fp); }
  const pl = pulseLayer(now); if (pl) extra.push(pl);
  setDeckLayers(overlay, [...base, ...extra]);
}

function motionLoop() {
  motionT = (motionT + 0.0016) % 1; // 1周 ~10秒
  if (_overlay && !REDUCED) drawAll(_overlay);
  requestAnimationFrame(motionLoop);
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
    if (!REDUCED) requestAnimationFrame(motionLoop);

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
