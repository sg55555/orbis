import { initMap, setDeckLayers } from './map.js';
import { layers, buildDeckLayers, tooltipFor, feedLayers, descFor } from './layers/registry.js';
import { startPolling, fetchManifest } from './snapshot.js';
import { formatFreshness, magnitudeToRadius, magnitudeToColor, projectedArrival, shipArrival } from './lib/geo.js';
import { loadEnabled, readStored } from './lib/state.js';
import { mountStarfield } from './lib/starfield.js';
import { getLook, applyLookCss } from './lib/look.js';
import { renderPanel, wireCollapse } from './ui/panel.js';
import { buildFeed } from './lib/feed.js';
import { renderFeed, wireCollapse as wireFeedCollapse } from './ui/feed.js';
import { diffNewIds, normalizedTimestamps } from './lib/motion.js';
import { selectionPopupHtml, buildReticleConfigs, flightPopupHtml, shipPopupHtml, buildProjectionConfigs } from './lib/selection.js';
import { tempAt } from './layers/airtemp.js';
// 水温カラーマップ。?cmap=sst|twin|aqua で実物比較（既定 sst）。
const CMAP = (typeof location !== 'undefined'
  && (/[?&]cmap=(sst|twin|aqua)/i.exec(location.search) || [])[1] || 'sst').toLowerCase();

const POLL_MS = 60000;
const POLL_LAYERS = ['quakes', 'flights', 'conflict', 'protests', 'airtemp', 'ships']; // スナップショットを持つ層
const ALL_IDS = ['quakes', 'flights', 'conflict', 'protests', 'trade', 'currents', 'airtemp', 'ships'];
let ENABLED = loadEnabled(ALL_IDS, readStored(), ['airtemp', 'ships']);

const snapshots = {}; // id -> snapshot（trade は静的、その他はポーリング更新）
let panel;

const REDUCED = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
let motionT = 0;          // 0..1 ループする位相
let prevIds = {};         // layerId -> Set（前回のid集合。新規検出用）
let pulses = [];          // { lon, lat, born } 出現パルス
let _overlay = null;      // rAF ループ用の overlay 参照
let selected = null;      // フィードで選択中のイベント { lon, lat, title, layerId, at }
let selPopup = null;      // 着地点を示す maplibre ポップアップ（boot で生成）
let selectedFlight = null; // { point, arrival[lon,lat] } 航空クリックで選択
let selectedShip = null;   // { point, arrival[lon,lat] } 船舶クリックで選択
const FLIGHT_PROJECT_MIN = 20; // 推定進路の延長時間（分）。目的地は不明なので heading の延長。
const SHIP_PROJECT_MIN = 600; // 船は低速なので約10時間の長延長（12knで約222km先）。引きで到達ポインタが船首に重ならないように。

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
    // REDUCED 時はパルスを描かないので、無駄に溜めない（poll 間の蓄積を防ぐ）。
    if (prevIds[id] && !REDUCED) {
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
    Object.entries(snapshots).map(([k, v]) => [k,
      (v && (v.points?.length ?? v.features?.length
        ?? (Array.isArray(v.temps) ? v.temps.filter((t) => t != null).length : 0))) ?? 0])
  );
  if (panel) panel.updateCounts();
  refreshFeed();
}

function refreshFeed() {
  const items = buildFeed(feedLayers(), snapshots, ENABLED);
  renderFeed(document.getElementById('feed-rows'), items, (it) => {
    const at = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    selected = { lon: it.lon, lat: it.lat, title: it.title, layerId: it.layerId, at };
    if (window.__orbis) window.__orbis.selected = selected; // e2e/デバッグ用に露出
    const map = window.__orbis.map;
    map.flyTo({ center: [it.lon, it.lat], zoom: 5, duration: 1500, essential: true });
    // 着地点に「何が・どこに」を示すポップアップを出す（地図に追従）。
    if (selPopup) selPopup.setLngLat([it.lon, it.lat]).setHTML(selectionPopupHtml(it)).addTo(map);
    drawAll(window.__orbis.overlay); // リティクルを即時表示
  });
}

// trade 航路上を流れる発光トレイル（TripsLayer）。粒子のちらつきを避け滑らかに流す。
// trips は静的データなので一度だけ構築してキャッシュ。
let tradeTrips = null;
function tradeFlowLayer() {
  const geo = snapshots.trade;
  if (!geo || !geo.features || REDUCED) return null;
  if (!tradeTrips) {
    tradeTrips = geo.features
      .filter((f) => f.geometry && f.geometry.type === 'LineString')
      .map((f) => ({ path: f.geometry.coordinates, timestamps: normalizedTimestamps(f.geometry.coordinates) }));
  }
  if (tradeTrips.length === 0) return null;
  return new deck.TripsLayer({
    id: 'trade-flow', data: tradeTrips,
    getPath: (d) => d.path, getTimestamps: (d) => d.timestamps,
    getColor: [120, 240, 255], opacity: 0.9,
    widthUnits: 'pixels', getWidth: 2, widthMinPixels: 2,
    capRounded: true, jointRounded: true, fadeTrail: true,
    trailLength: 0.4, currentTime: motionT,
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

// 規模の大きい地震に、ゆっくり拡大する淡い波紋リング（reduced-motion 時は描かない）。
function quakeRippleLayer() {
  const snap = snapshots.quakes;
  if (REDUCED || !snap || !snap.points) return null;
  const data = snap.points.filter((p) => Number(p.mag) >= 4.5);
  if (data.length === 0) return null;
  const phase = motionT; // 0..1
  return new deck.ScatterplotLayer({
    id: 'quake-ripple', data, radiusUnits: 'pixels',
    stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 1,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => magnitudeToRadius(p.mag) + 4 + 22 * phase,
    getLineColor: (p) => [...magnitudeToColor(p.mag), Math.round(170 * (1 - phase))],
    updateTriggers: { getRadius: phase, getLineColor: phase },
    pickable: false,
  });
}

// 選択中イベントの着地リティクル（外周グロー＋明るいリング＋中心ドット＋拡大ピン）。
// flyTo の着地点を大きく・動きで強調する。config 生成は js/lib/selection.js（純粋）。
function selectedMarkerLayers(now) {
  return buildReticleConfigs(selected, now, { reduced: REDUCED })
    .map((c) => new deck.ScatterplotLayer(c));
}

// 共通ビルダの {kind,config} を deck レイヤー化する。
function deckFromProjectionConfigs(cfgs) {
  return cfgs.map(({ kind, config }) => (kind === 'line'
    ? new deck.LineLayer(config)
    : new deck.ScatterplotLayer(config)));
}

// 選択中の航空機の推定進路（heading 延長）。マゼンタの線/到達リング/流れる粒子/パルス。
function flightProjectionLayers() {
  if (!selectedFlight || !selectedFlight.arrival) return [];
  const src = [selectedFlight.point.lon, selectedFlight.point.lat];
  return deckFromProjectionConfigs(
    buildProjectionConfigs({ src, arrival: selectedFlight.arrival, prefix: 'flight' }, motionT, { reduced: REDUCED }));
}

// 選択中の船舶の推定進路（COG/SOG 延長）。航空と同じビルダ・マゼンタ。
function shipProjectionLayers() {
  if (!selectedShip || !selectedShip.arrival) return [];
  const src = [selectedShip.point.lon, selectedShip.point.lat];
  return deckFromProjectionConfigs(
    buildProjectionConfigs({ src, arrival: selectedShip.arrival, prefix: 'ship' }, motionT, { reduced: REDUCED }));
}

// 現在の snapshots/ENABLED から deck レイヤー配列を組んで描く（動的レイヤーを base に重畳）。
function drawAll(overlay) {
  _overlay = overlay;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const zoom = (window.__orbis && window.__orbis.map) ? window.__orbis.map.getZoom() : 3;
  const base = buildDeckLayers(ENABLED, snapshots, undefined, { zoom, cmap: CMAP, motionT });
  const extra = [];
  if (ENABLED.has('trade')) { const fp = tradeFlowLayer(); if (fp) extra.push(fp); }
  const pl = pulseLayer(now); if (pl) extra.push(pl);
  if (ENABLED.has('quakes')) { const rp = quakeRippleLayer(); if (rp) extra.push(rp); }
  extra.push(...selectedMarkerLayers(now));
  extra.push(...flightProjectionLayers());
  extra.push(...shipProjectionLayers());
  setDeckLayers(overlay, [...base, ...extra]);
}

function motionLoop() {
  motionT = (motionT + 0.0016) % 1; // 1周 ~10秒
  if (_overlay && !REDUCED) drawAll(_overlay);
  requestAnimationFrame(motionLoop);
}

function boot() {
  const look = getLook();
  applyLookCss(look); // 星雲・グラスの CSS 変数を :root に適用
  // 星雲の配置。採用=ring(地球を囲むハロ)。?neb=corners で四隅版にも切替可能
  const nebClass = /[?&]neb=corners/i.test(location.search) ? 'neb-corners' : 'neb-ring';
  document.getElementById('starfield').classList.add(nebClass);
  const { map, overlay } = initMap(
    'map',
    (info) => {
      if (!info || !info.layer) return null;
      if (info.layer.id === 'airtemp') {
        const c = info.coordinate;
        if (!c) return null;
        const t = tempAt(snapshots.airtemp, c[1], c[0]);
        return t == null ? null : `気温 ${Math.round(t)}°C｜${c[1].toFixed(0)}, ${c[0].toFixed(0)}`;
      }
      return info.object ? tooltipFor(info.layer.id, info.object) : null;
    },
    (info) => {
      if (!info || !info.object || !info.layer) return;
      if (info.layer.id === 'flights' || info.layer.id === 'flights-dot') {
        const p = info.object;
        const arrival = projectedArrival(p, FLIGHT_PROJECT_MIN);
        selectedFlight = { point: p, arrival };
        selectedShip = null;
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(flightPopupHtml(p, arrival, FLIGHT_PROJECT_MIN)).addTo(map);
        drawAll(overlay);
      }
      if (info.layer.id === 'ships' || info.layer.id === 'ships-dot') {
        const p = info.object;
        const arrival = shipArrival(p, SHIP_PROJECT_MIN);
        selectedShip = { point: p, arrival };
        selectedFlight = null;
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(shipPopupHtml(p, arrival, SHIP_PROJECT_MIN)).addTo(map);
        drawAll(overlay);
      }
    },
    look
  );
  mountStarfield(document.getElementById('starfield'), { reduced: REDUCED });
  window.__orbis = { map, overlay, counts: {} };

  // 着地点ポップアップ（クリック地点に追従。閉じても再クリックで再表示）。
  selPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 20, className: 'orbis-popup' });
  // 注: popup.addTo() は既に開いている popup だと内部で remove()→'close' を発火するため、
  // 'close' で選択解除すると2回目以降のクリックで選択が即消え進路が描けない。よって close 解除はしない。
  // 推定進路は次の機体/船クリック（相互排他）まで残す（航空の従来挙動）。

  panel = renderPanel(
    document.getElementById('panel-rows'),
    layers,
    () => ENABLED,
    () => window.__orbis.counts,
    (next) => { ENABLED = next; rebuild(overlay); },
    descFor
  );
  wireCollapse(document.getElementById('panel'), document.getElementById('panel-toggle'));
  wireFeedCollapse(document.getElementById('feed'), document.getElementById('feed-toggle'));

  map.on('zoom', () => drawAll(overlay));

  map.on('load', async () => {
    document.getElementById('loading').classList.add('hidden');

    // 静的な貿易ルート・海流を各レイヤー自身の fetch() で一度だけ読み込む
    try {
      const trade = layers.find((l) => l.id === 'trade');
      if (trade) snapshots.trade = await trade.fetch();
    } catch { /* noop */ }
    try {
      const currents = layers.find((l) => l.id === 'currents');
      if (currents) snapshots.currents = await currents.fetch();
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
