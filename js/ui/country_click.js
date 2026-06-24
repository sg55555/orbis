// 国クリックのオーケストレータ（DI seam）。MapLibre 生の map.on('click') を受け、
// deck pick 排他 → client ray-casting で FIPS 解決 → country_data 遅延取得 → buildDrilldown → renderDrilldown → flyTo。
// map / fetch / 集計 / render は全て deps 注入し、テスト時 fake 可能にする。
// patch #4: noteDeckPick(lngLat) を公開し内部 deckPick を更新。handleMapClick が時刻＋座標の二重判定で排他。
// patch #5: setBoundsPolys(polys) を公開。main.js(C7) が loadCountryBounds→setBoundsPolys を配線する前提。
// patch #6: loadCountryGeo は fetchFn を deps 経由で DI（本番は既定 fetch）。
import { locateFeature } from '../lib/drilldown/geo_poly.js';

// deck pick と map.on('click') の二重発火を抑える二重判定のしきい値。
const DECK_PICK_WINDOW_MS = 350;
const DECK_PICK_NEAR_DEG = 0.5;

export function initCountryClick({ map, getSnapshots, deps }) {
  let boundsPolys = null;          // loadCountryBounds 済 polys（openCountry 前に注入される）
  let deckPick = null;             // {lng, lat, at}
  let token = 0;                   // selection レース破棄トークン

  function noteDeckPick(lngLat) {
    deckPick = { lng: lngLat.lng != null ? lngLat.lng : lngLat[0], lat: lngLat.lat != null ? lngLat.lat : lngLat[1], at: nowMs() };
  }

  function resolveFipsAt(lon, lat, polys) {
    const hit = locateFeature(lon, lat, polys || boundsPolys || []);
    return hit ? hit.code : null;
  }

  function _deckJustPicked(lng, lat) {
    if (!deckPick) return false;
    if (nowMs() - deckPick.at > DECK_PICK_WINDOW_MS) return false;
    return Math.abs(deckPick.lng - lng) <= DECK_PICK_NEAR_DEG && Math.abs(deckPick.lat - lat) <= DECK_PICK_NEAR_DEG;
  }

  async function handleMapClick(e) {
    const lng = e && e.lngLat ? e.lngLat.lng : null;
    const lat = e && e.lngLat ? e.lngLat.lat : null;
    if (lng == null || lat == null) return;
    if (_deckJustPicked(lng, lat)) return;         // deck が同フレームで pick 済 → 抑制
    const fips = resolveFipsAt(lng, lat, boundsPolys || []);
    if (!fips) {                                    // 海洋/極域 → パネル開かずトースト
      if (deps.onOceanMiss) deps.onOceanMiss();
      return;
    }
    await openCountry(fips, [lng, lat]);
  }

  async function openCountry(fips, anchorLngLat) {
    const myToken = ++token;
    if (deps.bodyEl) deps.bodyEl.classList.add('drill-open');
    if (map && map.resize) map.resize();
    if (deps.setDrilldownState) deps.setDrilldownState(deps.rootEl, 'loading');
    const geo = await deps.loadCountryGeo(fips, { manifest: deps.manifest, fetchFn: deps.fetchFn });
    if (myToken !== token) return;                  // レース破棄（別国クリックが後勝ち）
    const model = deps.buildDrilldown({
      fips,
      snapshots: getSnapshots(),
      countryPolys: boundsPolys || [],
      admin1Polys: deps.loadPolygonsFn ? deps.loadPolygonsFn(geo.admin1) : (geo.admin1Polys || []),
      cities: geo.cities,
      instabilityCountry: deps.getInstabilityCountry ? deps.getInstabilityCountry(fips) : null,
      forecastCards: deps.getForecastCards ? deps.getForecastCards(fips) : [],
    });
    if (myToken !== token) return;
    if (deps.renderDrilldown) {
      deps.renderDrilldown(deps.rootEl, model, {
        onSelect: (ev) => { if (deps.onSelectEvent) deps.onSelectEvent(ev); },
        onClose: () => closeCountry(),
        onWatchToggle: (code) => { if (deps.onWatchToggle) deps.onWatchToggle(code); },
      });
    }
    if (deps.setDrilldownState) deps.setDrilldownState(deps.rootEl, geo.degraded ? 'error' : 'ready');
    const bbox = deps.countryBbox(fips, deps.bboxIndex);
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    if (map && map.flyTo) {
      map.flyTo({ center, zoom: deps.zoomForBbox(bbox), duration: 1500, essential: true });
    }
  }

  function closeCountry() {
    token += 1;                                     // 進行中 open を無効化
    if (deps.bodyEl) deps.bodyEl.classList.remove('drill-open');
    if (map && map.resize) map.resize();
  }

  function setBoundsPolys(polys) { boundsPolys = polys; }

  if (map && map.on) map.on('click', handleMapClick);

  return { resolveFipsAt, handleMapClick, openCountry, closeCountry, noteDeckPick, setBoundsPolys };
}

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
