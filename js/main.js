import { initMap, setDeckLayers } from './map.js';
import { layers, tooltipFor, feedLayers, descFor, allLayerIds, pollLayerIds, staticLayers } from './layers/registry.js';
import { startPolling } from './snapshot.js';
import { freshnessSummary, magnitudeToRadius, magnitudeToColor, projectedArrival, shipArrival, formatLatLon } from './lib/geo.js';
import { loadEnabled, readStored, writeStored } from './lib/state.js';
import { mountStarfield } from './lib/starfield.js';
import { getLook, applyLookCss } from './lib/look.js';
import { immerseZoom, immerseClasses, immerseGlow, immerseNeb, atmosphereStops, isCompareMode } from './lib/immerse.js';
import { renderPanel, renderPresets, wireCollapse } from './ui/panel.js';
import { presetById, DEFAULT_PRESET } from './lib/presets.js';
import { buildFeed, buildFeedBalanced, feedChipIds, loadFeedHidden, toggleHidden, readFeedFilter, writeFeedFilter } from './lib/feed.js';
import { renderFeed, renderChips, wireCollapse as wireFeedCollapse } from './ui/feed.js';
import { parsePermalink } from './lib/permalink.js';
import { initShare } from './ui/share.js';
import { initSearch } from './ui/search.js';
import { renderMedia } from './ui/media.js';
import { renderBriefing } from './ui/briefing.js';
import { renderInstability } from './ui/instability.js';
import { renderForecasts } from './ui/forecast.js';
import { selectAlerts, renderAlerts } from './ui/alerts.js';
import { buildSourceRows, renderSources, SOURCE_MAP } from './ui/sources.js';
import { initBoot } from './ui/boot.js';
import { snapshotUrl } from './lib/data-source.js';
import { initLiveCaptions } from './ui/live-captions.js';
import { diffNewIds, normalizedTimestamps } from './lib/motion.js';
import { selectionPopupHtml, buildReticleConfigs, flightPopupHtml, shipPopupHtml, newsPopupHtml, buildProjectionConfigs, gdeltEventPopupHtml, gdeltCountryPopupHtml } from './lib/selection.js';
import { tempAt } from './layers/airtemp.js';
import { sstAt } from './layers/sst.js';
import { aggregateByCountry, buildHotspotConfigs } from './lib/aggregate.js';
import { initCountryClick } from './ui/country_click.js';
import { loadCountryBounds, countryBbox, fipsCenter } from './lib/drilldown/country_index.js';
import { renderDrilldown, setDrilldownState, renderWatchlist } from './ui/drilldown.js';
import { loadCountryGeo } from './lib/drilldown/country_data.js';
import { buildDrilldown } from './lib/drilldown/aggregate_admin1.js';
import { loadPolygons } from './lib/drilldown/geo_poly.js';
import { zoomForBbox } from './lib/zoom_for_bbox.js';
import { makeWatchlistStore, addCode, removeCode, joinWatchCountries } from './lib/drilldown/watchlist.js';
// 水温カラーマップ。?cmap=sst|twin|aqua で実物比較（既定 sst）。
const CMAP = (typeof location !== 'undefined'
  && (/[?&]cmap=(sst|twin|aqua)/i.exec(location.search) || [])[1] || 'sst').toLowerCase();

// 紛争 FX プリセット（?cfx=a|b|c で実物比較。既定 b）。emberScale=白熱度、topN=脈動する上位国数。
const CFX_PRESET = { a: { emberScale: 0.8, topN: 4 }, b: { emberScale: 1.0, topN: 6 }, c: { emberScale: 1.3, topN: 8 } };
const CFX = CFX_PRESET[((/[?&]cfx=([abc])/i.exec(typeof location !== 'undefined' ? location.search : '') || [])[1] || 'b').toLowerCase()];

// ズーム連動密度ダイヤル（?dens=z0,z1,min で実物比較。未指定=既定 z0=2.5,z1=5,min=0.22）。
function parseDens(search) {
  const m = /[?&]dens=([\d.]+),([\d.]+),([\d.]+)/i.exec(search || '');
  if (!m) return undefined;
  const z0 = parseFloat(m[1]), z1 = parseFloat(m[2]), min = parseFloat(m[3]);
  if (![z0, z1, min].every(Number.isFinite) || z1 <= z0) return undefined;
  return { z0, z1, min };
}
const DENS = parseDens(typeof location !== 'undefined' ? location.search : '');

const POLL_MS = 60000;
const POLL_LAYERS = pollLayerIds(); // スナップショットを持つ層（registry から自動導出）
const ALL_IDS = allLayerIds();      // 全トグル対象レイヤー（registry から自動導出）
// 共有パーマリンク（?ll/z/layers）。layers があれば保存より優先（共有された視点を再現）。
// 一過性＝localStorage は上書きしない（受け手の保存設定を壊さない・以後のトグルは従来どおり保存）。
const PERMALINK = parsePermalink(typeof location !== 'undefined' ? location.search : '');
let ENABLED = PERMALINK.layers
  ? new Set(ALL_IDS.filter((id) => PERMALINK.layers.includes(id)))
  : loadEnabled(ALL_IDS, readStored(), [], presetById(DEFAULT_PRESET).layers);

const snapshots = {}; // id -> snapshot（trade は静的、その他はポーリング更新）
let panel;

const REDUCED = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
let motionT = 0;          // 0..1 ループする位相
let prevIds = {};         // layerId -> Set（前回のid集合。新規検出用）
let pulses = [];          // { lon, lat, born } 出現パルス
let _overlay = null;      // rAF ループ用の overlay 参照
let aggCache = { conflict: [], protests: [] };
let selected = null;      // フィードで選択中のイベント { lon, lat, title, layerId, at }
let feedHidden = loadFeedHidden(readFeedFilter()); // フィードフィルタ（非表示layerId の Set）
let selPopup = null;      // 着地点を示す maplibre ポップアップ（boot で生成）
let selectedFlight = null; // { point, arrival[lon,lat] } 航空クリックで選択
let selectedShip = null;   // { point, arrival[lon,lat] } 船舶クリックで選択
let cc = null;             // 国ドリルダウン: initCountryClick の戻り値（boot 後に初期化）
// ウォッチリスト（localStorage 永続）。boot 後に makeWatchlistStore で初期化。
const _wlStore = makeWatchlistStore({ storage: typeof localStorage !== 'undefined' ? localStorage : null });
let _watchCodes = _wlStore.load();  // string[]（FIPS コード配列）
let _insCountries = null;           // instability.countries（joinWatchCountries で参照）
const FLIGHT_PROJECT_MIN = 20; // 推定進路の延長時間（分）。目的地は不明なので heading の延長。
const SHIP_PROJECT_MIN = 600; // 船は低速なので約10時間の長延長（12knで約222km先）。引きで到達ポインタが船首に重ならないように。

// 全有効レイヤーの鮮度を各 snapshot の updated から直読して可視化する。
// manifest 非依存なので、収集失敗でレイヤーが manifest から消えても古さが見える（沈黙の陳腐化を防ぐ）。
function updateFreshness() {
  const items = [];
  for (const l of layers) {
    if (!ENABLED.has(l.id)) continue;
    const snap = snapshots[l.id];
    if (snap && snap.updated) items.push({ label: l.label, updated: snap.updated });
  }
  const { text, stale } = freshnessSummary(items);
  const el = document.getElementById('freshness');
  el.textContent = text;
  el.classList.toggle('stale', stale);
}

function rebuild(overlay) {
  markBaseDirty(); // snapshots/ENABLED が変わった → base 層キャッシュを無効化
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

  for (const id of ['conflict', 'protests']) {
    aggCache[id] = (ENABLED.has(id) && snapshots[id] && snapshots[id].points)
      ? aggregateByCountry(snapshots[id].points, id) : [];
  }
  drawAll(overlay);
  window.__orbis.counts = Object.fromEntries(
    Object.entries(snapshots).map(([k, v]) => [k,
      (v && (v.points?.length ?? v.features?.length ?? v.items?.length
        ?? (Array.isArray(v.temps) ? v.temps.filter((t) => t != null).length : 0))) ?? 0])
  );
  if (panel) panel.updateCounts();
  refreshFeed();
  updateFreshness();
}

function refreshFeed() {
  const map = window.__orbis.map;
  const allItems = buildFeed(feedLayers(), snapshots, ENABLED);
  // チップは実際にフィード項目を持つレイヤーだけ（空の currents/airtemp/sst は出さない）。
  const chipIds = feedChipIds(feedLayers(), ENABLED, allItems);
  renderChips(document.getElementById('feed-chips'), chipIds, feedHidden,
    (id) => { feedHidden = toggleHidden(feedHidden, id); writeFeedFilter(feedHidden); refreshFeed(); },
    () => { feedHidden = new Set(); writeFeedFilter(feedHidden); refreshFeed(); });
  const visible = new Set(chipIds.filter((id) => !feedHidden.has(id)));
  const items = buildFeedBalanced(feedLayers(), snapshots, visible);
  const maxCount = items.reduce((m, it) => Math.max(m, Number(it.count) || 0), 0);
  renderFeed(document.getElementById('feed-rows'), items, (it) => {
    const at = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    selected = { lon: it.lon, lat: it.lat, title: it.title || it.country_ja || '', layerId: it.layerId, at };
    if (window.__orbis) window.__orbis.selected = selected;
    map.flyTo({ center: [it.lon, it.lat], zoom: 5, duration: 1500, essential: true });
    const html = (it.kind === 'group') ? gdeltCountryPopupHtml(it) : selectionPopupHtml(it);
    if (selPopup) selPopup.setLngLat([it.lon, it.lat]).setHTML(html).addTo(map);
    drawAll(window.__orbis.overlay);
  }, maxCount);
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

// 非アニメ層は deck インスタンスをキャッシュして再利用し、アニメ層(animated:true=currents)と
// dirty 層だけ毎フレーム再構築する。flights/ships の toDeckLayer は毎回 filter で data 配列を
// 作り直すため、そのまま 60fps で呼ぶと deck がシルエットを全点再計算してしまう（重い）。
// レジストリ順のまま組むので z 順は不変。
let baseDirty = true;
const _layerCache = new Map(); // layerId -> deck layer 配列
function markBaseDirty() { baseDirty = true; }
function buildBaseLayers(zoom) {
  const ctx = { zoom, cmap: CMAP, motionT, cfx: CFX, dens: DENS };
  const toArr = (r) => (Array.isArray(r) ? r : [r]);
  const out = [];
  for (const l of layers) {
    if (!ENABLED.has(l.id) || !snapshots[l.id]) { _layerCache.delete(l.id); continue; }
    let built;
    if (l.animated) {
      built = toArr(l.toDeckLayer(snapshots[l.id], ctx));   // 毎フレーム（motionT で動く）
    } else if (!baseDirty && _layerCache.has(l.id)) {
      built = _layerCache.get(l.id);                        // 変化なし→キャッシュ再利用（再計算なし）
    } else {
      built = toArr(l.toDeckLayer(snapshots[l.id], ctx));
      _layerCache.set(l.id, built);
    }
    out.push(...built);
  }
  baseDirty = false;
  return out;
}

// 現在の snapshots/ENABLED から deck レイヤー配列を組んで描く（動的レイヤーを base に重畳）。
function drawAll(overlay) {
  _overlay = overlay;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const zoom = (window.__orbis && window.__orbis.map) ? window.__orbis.map.getZoom() : 3;
  const base = buildBaseLayers(zoom);
  const extra = [];
  if (ENABLED.has('trade')) { const fp = tradeFlowLayer(); if (fp) extra.push(fp); }
  const pl = pulseLayer(now); if (pl) extra.push(pl);
  if (ENABLED.has('quakes')) { const rp = quakeRippleLayer(); if (rp) extra.push(rp); }
  for (const id of ['conflict', 'protests']) {
    if (!ENABLED.has(id)) continue;
    const rgb = id === 'conflict' ? [255, 60, 80] : [94, 255, 166];
    for (const c of buildHotspotConfigs(aggCache[id], motionT, { reduced: REDUCED, topN: CFX.topN, rgb })) {
      extra.push(new deck.ScatterplotLayer(c));
    }
  }
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
  const bootCtl = initBoot({ reduced: REDUCED });
  const look = getLook();
  applyLookCss(look); // 星雲・グラスの CSS 変数を :root に適用
  // 没入ダイヤル: 大気ハロ(glow)を initMap に渡し、body に seam/mbg/glass クラスを付与。
  // 星雲(面)は globe 拡大時に panel と干渉し四角く見えるため廃止＝アクセントは大気ハロに一本化。
  // #starfield は深宇宙の暗がり(vignette)＋点の星(canvas)のみ。
  const glow = immerseGlow();
  for (const c of immerseClasses()) document.body.classList.add(c);
  // メディア星雲ティント濃さ(?nv=1|2|3・既定2＝鮮やか)を :root に適用（applyLookCss の後に上書き）。
  const neb = immerseNeb();
  document.documentElement.style.setProperty('--neb-a', neb.a);
  document.documentElement.style.setProperty('--neb-b', neb.b);
  const { map, overlay } = initMap(
    'map',
    (info) => {
      if (!info || !info.layer) return null;
      if (info.layer.id === 'airtemp') {
        const c = info.coordinate;
        if (!c) return null;
        const t = tempAt(snapshots.airtemp, c[1], c[0]);
        return t == null ? null : `気温 ${Math.round(t)}°C｜${formatLatLon(c[1], c[0])}`;
      }
      if (info.layer.id === 'sst') {
        const c = info.coordinate;
        if (!c) return null;
        const t = sstAt(snapshots.sst, c[1], c[0]);
        return t == null ? null : `水温 ${Math.round(t)}°C｜${formatLatLon(c[1], c[0])}`;
      }
      return info.object ? tooltipFor(info.layer.id, info.object) : null;
    },
    (info) => {
      if (!info || !info.object || !info.layer) return;
      // patch #4: deck が object を pick した直後は国クリック排他フラグを noteDeckPick で更新する。
      if (cc) cc.noteDeckPick(info.coordinate || [0, 0]);
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
      if (info.layer.id === 'news') {
        const p = info.object;
        selectedFlight = null;
        selectedShip = null;
        selected = { lon: p.lon, lat: p.lat, title: p.title_ja, layerId: 'news', at: performance.now() };
        if (window.__orbis) window.__orbis.selected = selected;
        map.flyTo({ center: [p.lon, p.lat], zoom: 4, duration: 1500, essential: true });
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(newsPopupHtml(p)).addTo(map);
        drawAll(overlay);
      }
      if (info.layer.id === 'conflict' || info.layer.id === 'protests') {
        const p = info.object;
        selectedFlight = null;
        selectedShip = null;
        selected = { lon: p.lon, lat: p.lat, title: '', layerId: info.layer.id, at: performance.now() };
        if (window.__orbis) window.__orbis.selected = selected;
        map.flyTo({ center: [p.lon, p.lat], zoom: 5, duration: 1500, essential: true });
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(gdeltEventPopupHtml(p, info.layer.id)).addTo(map);
        drawAll(overlay);
      }
    },
    look,
    PERMALINK.zoom != null ? PERMALINK.zoom : immerseZoom(),
    atmosphereStops(glow),
    PERMALINK.center || undefined,
  );
  mountStarfield(document.getElementById('starfield'), { reduced: REDUCED });
  window.__orbis = { map, overlay, counts: {} };

  // 国ドリルダウン（別系統 map.on('click')）: deck onClick の early return より前で拾えないため独立配線。
  // snapshots は module-local（window.__orbis に載らない）ゆえ getSnapshots DI クロージャで渡す。
  // deck pick 排他は cc.noteDeckPick(info.coordinate) で正準配線（patch #4）。
  // patch #7（二重登録解消）: country_click.js は map.on を登録しない。ここが唯一の登録点。
  // patch #7: ウォッチリスト描画（join 済み国オブジェクト配列を renderWatchlist に渡す）。
  const wlRoot = document.getElementById('drilldown');
  function refreshWatchlist() {
    const countries = joinWatchCountries(_watchCodes, _insCountries, fipsCenter);
    renderWatchlist(wlRoot, countries, {
      onSelect: (c) => {
        map.flyTo({ center: [c.lon, c.lat], zoom: 4, duration: 1500, essential: true });
        selected = { lon: c.lon, lat: c.lat, title: c.name_ja, layerId: 'watchlist', at: performance.now() };
        if (window.__orbis) window.__orbis.selected = selected;
        drawAll(overlay);
      },
      onRemove: (code) => {
        _watchCodes = removeCode(_watchCodes, code);
        _wlStore.save(_watchCodes);
        refreshWatchlist();
      },
    });
  }

  // Critical-1: bboxIndex / manifest を boot 時に fetch して deps に注入する。
  let _bboxIndex = { country: {}, extra: {} };
  let _manifest = {};
  // 非同期取得（失敗しても空 index/manifest でフォールバック動作）
  fetch('data/static/admin1_bbox.json').then((r) => r.ok ? r.json() : null).then((d) => {
    if (d && typeof d === 'object') _bboxIndex = d;
  }).catch(() => {});
  fetch('data/static/drilldown_manifest.json').then((r) => r.ok ? r.json() : null).then((d) => {
    if (d && typeof d === 'object') _manifest = d;
  }).catch(() => {});

  const drilldownRootEl = document.getElementById('drilldown');

  cc = initCountryClick({
    map,
    getSnapshots: () => snapshots,
    deps: {
      // Critical-1: fetch↔fetchFn 名不一致を解消
      fetchFn: fetch,
      // 国 geo 遅延取得（manifest / fetchFn DI）
      loadCountryGeo: (fips, opts) => loadCountryGeo(fips, {
        manifest: opts && opts.manifest != null ? opts.manifest : _manifest,
        fetchFn: fetch,
      }),
      // ドリルダウン集計（純粋関数）
      buildDrilldown,
      // ドリルダウン描画
      renderDrilldown,
      setDrilldownState,
      // bbox / zoom
      countryBbox,
      zoomForBbox,
      // admin1 polys 構築（geo.admin1 GeoJSON → loadPolygons でリング化）
      loadPolygonsFn: (admin1GeoJson) => loadPolygons(admin1GeoJson, { codeKey: 'a1code' }),
      // Critical-3: bboxIndex / manifest は boot で fetch した参照を渡す（クロージャ経由）
      get bboxIndex() { return _bboxIndex; },
      get manifest() { return _manifest; },
      // パネル DOM 要素
      rootEl: drilldownRootEl,
      bodyEl: document.body,
      // instability / forecast の該当国データ取得クロージャ
      getInstabilityCountry: (fips) => {
        const ins = window.__orbis && window.__orbis.instability;
        if (!ins || !Array.isArray(ins.countries)) return null;
        return ins.countries.find((c) => c.code === fips) || null;
      },
      getForecastCards: (fips) => {
        const fc = window.__orbis && window.__orbis.forecasts;
        if (!fc || !Array.isArray(fc.cards)) return [];
        return fc.cards.filter((c) => c.fips === fips || c.place_fips === fips);
      },
      // onSelectEvent: 既存 selected/flyTo/drawAll/selPopup 契約に合流
      onSelectEvent: (ev) => {
        if (ev && typeof ev.lon === 'number' && typeof ev.lat === 'number') {
          selected = { lon: ev.lon, lat: ev.lat, title: ev.title || '', layerId: ev.layerId || 'country', at: performance.now() };
          if (window.__orbis) window.__orbis.selected = selected;
          map.flyTo({ center: [ev.lon, ev.lat], zoom: 5, duration: 1500, essential: true });
          const html = selectionPopupHtml({ lon: ev.lon, lat: ev.lat, title: ev.title || '', layerId: ev.layerId || 'country' });
          if (selPopup) selPopup.setLngLat([ev.lon, ev.lat]).setHTML(html).addTo(map);
          drawAll(overlay);
        }
      },
      // onOceanMiss: 既存 share-toast で通知（「この地点は国を特定できません」）
      onOceanMiss: () => {
        const toast = document.getElementById('share-toast');
        if (!toast) return;
        toast.textContent = 'この地点は国を特定できません';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2400);
      },
      // ウォッチリストトグル
      onWatchToggle: (code) => {
        // ★ クリックでウォッチリストのトグル（追加/削除）
        if (Array.isArray(_watchCodes) && _watchCodes.includes(code)) {
          _watchCodes = removeCode(_watchCodes, code);
        } else {
          _watchCodes = addCode(_watchCodes, code);
        }
        _wlStore.save(_watchCodes);
        refreshWatchlist();
      },
    },
  });
  map.on('click', cc.handleMapClick);
  // patch #5: country_bounds polys を注入し、resolveFipsAt が陸地で FIPS を解決できるようにする。
  loadCountryBounds(fetch).then((polys) => cc.setBoundsPolys(polys)).catch(() => {});

  // 着地点ポップアップ（クリック地点に追従。閉じても再クリックで再表示）。
  selPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 20, className: 'orbis-popup' });
  // 注: popup.addTo() は既に開いている popup だと内部で remove()→'close' を発火するため、
  // 'close' で選択解除すると2回目以降のクリックで選択が即消え進路が描けない。よって close 解除はしない。
  // 推定進路は次の機体/船クリック（相互排他）まで残す（航空の従来挙動）。

  let presetsApi;
  panel = renderPanel(
    document.getElementById('panel-rows'),
    layers,
    () => ENABLED,
    () => window.__orbis.counts,
    (next) => { ENABLED = next; rebuild(overlay); if (presetsApi) presetsApi.refresh(); },
    descFor
  );
  presetsApi = renderPresets(
    document.getElementById('panel-presets'),
    () => ENABLED,
    (next) => { ENABLED = next; writeStored(next); rebuild(overlay); panel.syncChecks(); presetsApi.refresh(); }
  );
  wireCollapse(document.getElementById('panel'), document.getElementById('panel-toggle'));
  wireFeedCollapse(document.getElementById('feed'), document.getElementById('feed-toggle'));

  map.on('zoom', () => { markBaseDirty(); drawAll(overlay); });

  // 共有パーマリンク：現在のビュー（中心/ズーム）＋ON レイヤーを URL 化してコピー。
  initShare(() => ({
    center: [map.getCenter().lng, map.getCenter().lat],
    zoom: map.getZoom(),
    layers: [...ENABLED],
  }));

  // 国検索：候補選択で国の中心へ flyTo＋既存の着地リティクル（CYAN）を再利用。
  initSearch((country) => {
    selectedFlight = null;
    selectedShip = null;
    selected = { lon: country.lng, lat: country.lat, title: country.ja, layerId: 'search', at: performance.now() };
    if (window.__orbis) window.__orbis.selected = selected;
    map.flyTo({ center: [country.lng, country.lat], zoom: 4, duration: 1500, essential: true });
    if (selPopup) selPopup.setLngLat([country.lng, country.lat]).setHTML(`<div class="sel-title">${country.ja}</div>`).addTo(map);
    drawAll(overlay);
  });

  map.on('load', async () => {
    bootCtl.requestHandoff();

    // 静的レイヤー（static:true の trade/currents 等）を各自の fetch() で一度だけ読み込む。
    // registry から自動導出するので、静的レイヤー追加時に main.js を編集する必要がない。
    await Promise.all(staticLayers().map(async (l) => {
      try { snapshots[l.id] = await l.fetch(); } catch { /* noop */ }
    }));
    rebuild(overlay);
    if (!REDUCED) requestAnimationFrame(motionLoop);

    // 下部メディア領域（ニュース/カメラ）。2 config を読み、選択で本拠地へ flyTo＋マーカー。
    const mediaRoot = document.getElementById('media');
    try {
      const [news, cameras] = await Promise.all([
        fetch('config/live_channels.json').then((r) => r.json()).catch(() => []),
        fetch('config/live_cameras.json').then((r) => r.json()).catch(() => []),
      ]);
      if ((Array.isArray(news) && news.length) || (Array.isArray(cameras) && cameras.length)) {
        const mediaApi = renderMedia(mediaRoot, { news, cameras }, {
          onSelect: (item) => {
            if (item.area === 'space') return; // 宇宙カメラは地上座標が無いので flyTo/マーカーしない
            map.flyTo({ center: [item.lon, item.lat], zoom: 4, duration: 1500, essential: true });
            selected = { lon: item.lon, lat: item.lat, title: item.name, layerId: 'media', at: performance.now() };
            if (window.__orbis) window.__orbis.selected = selected;
            drawAll(overlay); // 着地リティクル（マーカー）を表示
          },
        });
        // #media が画面に入ったら再生・離れたら停止（可視時のみ再生）。
        const io = new IntersectionObserver((entries) => {
          mediaApi.setPlaying(entries[0].isIntersecting);
        }, { threshold: 0.4 });
        io.observe(mediaRoot);
        if (window.__orbis) window.__orbis.media = mediaApi; // e2e/デバッグ用
        // AI字幕（ローカル live-translate 経由・既定OFF）。ニュースプレーヤー下端にオーバーレイ。
        const lcPlayer = mediaRoot.querySelector('#media-news .media-player');
        const lcToggle = document.getElementById('lc-toggle');
        if (lcPlayer && lcToggle) {
          const lc = initLiveCaptions(lcPlayer, lcToggle, {
            onActivate() {
              // AI字幕ON時は YouTube cc を OFF にして二重字幕を避ける
              // （プログラム変更は change を発火しないので setCaptions も明示呼び）。
              const cc = document.getElementById('media-cc-toggle');
              if (cc && cc.checked) { cc.checked = false; mediaApi.setCaptions(false); }
            },
          });
          if (window.__orbis) window.__orbis.liveCaptions = lc;
        }
      } else {
        mediaRoot.style.display = 'none';
      }
    } catch {
      mediaRoot.style.display = 'none';
    }

    // AI ワールド・ブリーフィング（毎時 Sonnet 合成・メディアの下）。
    const briefRoot = document.getElementById('ai-brief');
    try {
      const brief = await fetch(snapshotUrl('briefing')).then((r) => r.ok ? r.json() : null).catch(() => null);
      if (brief && (brief.lead || (brief.cards && brief.cards.length)) && briefRoot) {
        renderBriefing(briefRoot, brief, {
          onSelect: (c) => {
            map.flyTo({ center: [c.lon, c.lat], zoom: 4, duration: 1500, essential: true });
            selected = { lon: c.lon, lat: c.lat, title: c.title_ja, layerId: 'brief', at: performance.now() };
            if (window.__orbis) window.__orbis.selected = selected;
            drawAll(overlay);
          },
        });
        if (window.__orbis) window.__orbis.brief = brief;
      } else if (briefRoot) {
        briefRoot.style.display = 'none';
      }
    } catch {
      if (briefRoot) briefRoot.style.display = 'none';
    }

    // 国家不安定性インデックス（毎時・メディア/briefing の下）。
    const insRoot = document.getElementById('instability');
    try {
      const ins = await fetch(snapshotUrl('instability')).then((r) => r.ok ? r.json() : null).catch(() => null);
      if (ins && ins.countries && ins.countries.length && insRoot) {
        renderInstability(insRoot, ins, {
          onSelect: (c) => {
            map.flyTo({ center: [c.lon, c.lat], zoom: 4, duration: 1500, essential: true });
            selected = { lon: c.lon, lat: c.lat, title: c.name_ja, layerId: 'instability', at: performance.now() };
            if (window.__orbis) window.__orbis.selected = selected;
            drawAll(overlay);
          },
        });
        // patch #7: instability.countries をキャッシュし、ウォッチリストの join に使う。
        _insCountries = ins.countries;
        refreshWatchlist();
        if (window.__orbis) window.__orbis.instability = ins;
      } else if (insRoot) {
        insRoot.style.display = 'none';
      }
    } catch {
      if (insRoot) insRoot.style.display = 'none';
    }

    // AI FORECASTS（ドメイン別リスク見通し・毎時・instability の下）。
    const fcRoot = document.getElementById('forecasts');
    try {
      const fc = await fetch(snapshotUrl('forecast')).then((r) => r.ok ? r.json() : null).catch(() => null);
      if (fc && fc.cards && fc.cards.length && fcRoot) {
        renderForecasts(fcRoot, fc, {
          onSelect: (card) => {
            map.flyTo({ center: [card.lon, card.lat], zoom: 4, duration: 1500, essential: true });
            selected = { lon: card.lon, lat: card.lat, title: card.place_ja || card.place || '', layerId: 'forecast', at: performance.now() };
            if (window.__orbis) window.__orbis.selected = selected;
            drawAll(overlay);
          },
        });
        if (window.__orbis) window.__orbis.forecasts = fc;
      } else if (fcRoot) {
        fcRoot.style.display = 'none';
      }
    } catch {
      if (fcRoot) fcRoot.style.display = 'none';
    }

    // 異常スパイク・アラート帯（globe 直下の全幅バンド）。instability/forecast の急変を集約。
    const alertsRoot = document.getElementById('alerts');
    if (alertsRoot) {
      const alertItems = selectAlerts(window.__orbis.instability, window.__orbis.forecasts);
      renderAlerts(alertsRoot, alertItems, {
        onSelect: (a) => {
          map.flyTo({ center: [a.lon, a.lat], zoom: 4, duration: 1500, essential: true });
          selected = { lon: a.lon, lat: a.lat, title: a.label, layerId: a.kind === 'forecast' ? 'forecast' : 'instability', at: performance.now() };
          if (window.__orbis) window.__orbis.selected = selected;
          drawAll(overlay);
        },
      });
    }

    // データソース & 鮮度パネル（ページ最下部）。registry レイヤー＋AIセクションを一覧化。
    // 注意: ポーリング層(quakes 等)の初期データは startPolling 後に届くため、初回描画に加え
    // poll コールバックでも再描画して鮮度/件数を最新化する。
    const sourcesRoot = document.getElementById('sources');
    const refreshSources = () => {
      if (!sourcesRoot) return;
      const aiEntries = [
        { id: 'briefing', label: 'ワールド・ブリーフィング' },
        { id: 'instability', label: '国家不安定性インデックス' },
        { id: 'forecast', label: 'AI FORECASTS' },
      ];
      const srcSnapshots = { ...snapshots,
        briefing: window.__orbis.brief, instability: window.__orbis.instability, forecast: window.__orbis.forecasts };
      const srcCounts = { ...(window.__orbis.counts || {}),
        briefing: window.__orbis.brief?.cards?.length || 0,
        instability: window.__orbis.instability?.countries?.length || 0,
        forecast: window.__orbis.forecasts?.cards?.length || 0 };
      const rows = buildSourceRows([...layers, ...aiEntries], srcSnapshots, srcCounts, SOURCE_MAP, Date.now());
      renderSources(sourcesRoot, rows);
    };
    refreshSources();

    startPolling(POLL_LAYERS, POLL_MS, (polled) => {
      Object.assign(snapshots, polled);
      rebuild(overlay);
      refreshSources();
    });
  });
}

if ('serviceWorker' in navigator) {
  // ローカル(開発/比較)では SW を無効化：cache-first が古い main.js/css を配信し、変更が
  // 反映されない問題を避ける。既存 SW があれば解除＋キャッシュ削除し、最新を読むため1回だけ
  // リロードする（非同期 unregister は当該ページの取得に間に合わないため）。本番(vercel)のみ SW 有効。
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isCompareMode(location.search) || local) {
    navigator.serviceWorker.getRegistrations().then((rs) => {
      const had = rs.length > 0;
      rs.forEach((r) => r.unregister());
      if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
      if (had) location.reload();
    });
  } else {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}

boot();
