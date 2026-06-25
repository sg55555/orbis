// 国クリックのオーケストレータ（DI seam）。MapLibre 生の map.on('click') を受け、
// deck pick 排他 → client ray-casting で FIPS 解決 → openPlace → resolvePlace → loadProfile → renderProfile → flyTo。
// map / fetch / 集計 / render は全て deps 注入し、テスト時 fake 可能にする。
// patch #4: noteDeckPick(lngLat) を公開し内部 deckPick を更新。handleMapClick が時刻＋座標の二重判定で排他。
// patch #5: setBoundsPolys(polys) を公開。main.js(C7) が loadCountryBounds→setBoundsPolys を配線する前提。
// patch #6: loadCountryGeo は fetchFn を deps 経由で DI（本番は既定 fetch）。
// patch #7（二重登録解消）: map.on('click') は main.js(C7) が明示登録する一点に一本化。
//   initCountryClick は map.on を登録しない（呼び出し側の責務）。
// patch #8: openPlace(lon,lat)/navigate(level,id) を追加。handleMapClick → openPlace に変更。
//   deps 追加: resolvePlace, loadProfile, regionShapePath, renderProfile, pip, nearest, profilesManifest。
import { locateFeature } from '../lib/drilldown/geo_poly.js';
import { bboxCenter } from '../lib/zoom_for_bbox.js';

// deck pick と map.on('click') の二重発火を抑える二重判定のしきい値。
const DECK_PICK_WINDOW_MS = 350;
const DECK_PICK_NEAR_DEG = 0.5;

// イベント種別 → 絵文字（events フッタ用）
const LAYER_EMOJI = {
  conflict: '⚔',
  protests: '📢',
  news: '📰',
  quakes: '🌐',
};

export function initCountryClick({ map, getSnapshots, deps }) {
  let boundsPolys = null;          // loadCountryBounds 済 polys（setBoundsPolys で注入される）
  let deckPick = null;             // {lng, lat, at}
  let token = 0;                   // selection レース破棄トークン

  // navigate で再利用するために openPlace の解決結果を保持する
  let _lastGeo = null;             // { admin1: FeatureCollection, cities, degraded }
  let _lastChain = [];             // resolvePlace の chain
  let _lastAdmin1Hit = null;       // resolvePlace の admin1Hit
  let _lastFips = null;            // 最後に解決した FIPS
  let _lastBoundsHit = null;       // locateFeature の hit（country rings 取得用）

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
    await openPlace(lng, lat);
  }

  async function openPlace(lon, lat) {
    // FIPS 解決（boundsPolys ray-casting）
    const boundsHit = locateFeature(lon, lat, boundsPolys || []);
    const fips = boundsHit ? boundsHit.code : null;
    if (!fips) {
      if (deps.onOceanMiss) deps.onOceanMiss();
      return;
    }

    // token はレース判定のために await より前に必ずインクリメントする
    const myToken = ++token;

    const geo = await deps.loadCountryGeo(fips, { manifest: deps.manifest, fetchFn: deps.fetchFn });
    if (myToken !== token) return;                  // レース破棄

    const admin1Polys = deps.loadPolygonsFn ? deps.loadPolygonsFn(geo.admin1) : (geo.admin1Polys || []);

    const countryName = boundsHit.name_ja || boundsHit.name || fips;
    const res = deps.resolvePlace
      ? deps.resolvePlace(lon, lat, {
          fips,
          countryName,
          admin1Polys,
          cities: geo.cities,
          manifest: deps.profilesManifest,
          pip: deps.pip,
          nearest: deps.nearest,
        })
      : { chain: [], target: null, admin1Hit: null };

    // target が無い（profile 欠落・海洋誤解決）→ パネルを開かずトーストだけ出して返る
    if (!res || !res.target) {
      if (deps.onOceanMiss) deps.onOceanMiss();
      return;
    }

    // target が確定してから初めてパネルを開く
    if (deps.rootEl && deps.rootEl.removeAttribute) deps.rootEl.removeAttribute('hidden');
    if (deps.bodyEl) deps.bodyEl.classList.add('drill-open');
    if (map && map.resize) map.resize();
    if (deps.setDrilldownState) deps.setDrilldownState(deps.rootEl, 'loading');

    if (myToken !== token) return;

    const profile = await deps.loadProfile(
      res.target.level,
      res.target.id,
      { manifest: deps.profilesManifest, fetchFn: deps.fetchFn },
    );
    if (myToken !== token) return;                  // レース破棄

    // 形状 rings の源（level ごと）
    let rings = null;
    if (res.target.level === 'country') {
      rings = boundsHit.rings || null;
    } else if (res.target.level === 'admin1' && res.admin1Hit) {
      rings = res.admin1Hit.rings || null;
    }
    // city は rings なし → null のまま
    const shapePath = (rings && deps.regionShapePath) ? deps.regionShapePath(rings) : null;

    // events（近隣の動向フッタ用）
    let events = [];
    if (deps.buildDrilldown) {
      try {
        const dd = deps.buildDrilldown({
          fips,
          snapshots: getSnapshots(),
          countryPolys: boundsPolys || [],
          admin1Polys,
          cities: geo.cities,
          instabilityCountry: deps.getInstabilityCountry ? deps.getInstabilityCountry(fips) : null,
          forecastCards: deps.getForecastCards ? deps.getForecastCards(fips) : [],
        });
        events = (dd.events || []).map((ev) => ({
          emoji: LAYER_EMOJI[ev.layerId] || '・',
          where: ev.cityName || ev.regionName || '',
          title: ev.title || '',
        }));
      } catch {
        events = [];
      }
    }

    // closure に保持（navigate 再利用用）
    _lastGeo = geo;
    _lastChain = res.chain;
    _lastAdmin1Hit = res.admin1Hit;
    _lastFips = fips;
    _lastBoundsHit = boundsHit;

    const model = {
      profile,
      target: res.target,
      breadcrumb: res.chain,
      shapePath,
      miniDot: { lon, lat },
      events,
    };

    if (deps.renderProfile) {
      deps.renderProfile(deps.rootEl, model, {
        onClose: () => closeCountry(),
        onWatchToggle: (id) => { if (deps.onWatchToggle) deps.onWatchToggle(id); },
        onNavigate: (level, id) => navigate(level, id),
      });
    }

    if (deps.setDrilldownState) deps.setDrilldownState(deps.rootEl, 'ready');

    // flyTo: target の階層に応じた bbox/center へ
    let flyCenter, flyZoom;
    if (res.target.level === 'country') {
      // 国レベル → 国 bbox
      const bbox = deps.countryBbox(fips, deps.bboxIndex);
      flyCenter = bboxCenter(bbox);
      flyZoom = deps.zoomForBbox(bbox);
    } else if (res.target.level === 'admin1' && res.admin1Hit && res.admin1Hit.bbox) {
      // admin1 → admin1 bbox（あれば）、なければ国 bbox にフォールバック
      const bbox = res.admin1Hit.bbox;
      flyCenter = bboxCenter(bbox);
      flyZoom = deps.zoomForBbox(bbox);
    } else if (res.target.level === 'city') {
      // 都市 → クリック点（lon/lat）を使用。resolvePlace は cityHit を返さず、
      // クリック点は cityRadius 以内に都市があることが保証されているため十分精確。
      flyCenter = [lon, lat];
      flyZoom = 7;
    } else {
      // フォールバック: 国 bbox
      const bbox = deps.countryBbox(fips, deps.bboxIndex);
      flyCenter = bboxCenter(bbox);
      flyZoom = deps.zoomForBbox(bbox);
    }
    if (map && map.flyTo) {
      map.flyTo({ center: flyCenter, zoom: flyZoom, duration: 1500, essential: true });
    }
  }

  async function navigate(level, id) {
    // chain を当該 level まで切り詰めたパンくずで再描画（geo/chain は closure から）
    if (!_lastFips || !_lastChain.length) return;

    const myToken = ++token;
    if (deps.setDrilldownState) deps.setDrilldownState(deps.rootEl, 'loading');

    const profile = await deps.loadProfile(
      level,
      id,
      { manifest: deps.profilesManifest, fetchFn: deps.fetchFn },
    );
    if (myToken !== token) return;

    // パンくずを対象 level まで切り詰め（chain は level 昇順で格納済）
    const idx = _lastChain.findIndex((c) => c.level === level && c.id === id);
    const breadcrumb = idx >= 0 ? _lastChain.slice(0, idx + 1) : _lastChain;
    const navTarget = breadcrumb[breadcrumb.length - 1] || null;

    // 形状 rings
    let rings = null;
    if (level === 'country' && _lastBoundsHit) {
      rings = _lastBoundsHit.rings || null;
    } else if (level === 'admin1' && _lastAdmin1Hit && _lastAdmin1Hit.code === id) {
      rings = _lastAdmin1Hit.rings || null;
    }
    const shapePath = (rings && deps.regionShapePath) ? deps.regionShapePath(rings) : null;

    const model = {
      profile,
      target: navTarget,
      breadcrumb,
      shapePath,
      miniDot: null,
      events: [],
    };

    if (deps.renderProfile) {
      deps.renderProfile(deps.rootEl, model, {
        onClose: () => closeCountry(),
        onWatchToggle: (id) => { if (deps.onWatchToggle) deps.onWatchToggle(id); },
        onNavigate: (lv, i) => navigate(lv, i),
      });
    }

    if (deps.setDrilldownState) deps.setDrilldownState(deps.rootEl, 'ready');
  }

  function closeCountry() {
    token += 1;                                     // 進行中 open を無効化
    if (deps.rootEl && deps.rootEl.setAttribute) deps.rootEl.setAttribute('hidden', ''); // Critical-2: hidden 属性を戻してパネルを隠す
    if (deps.bodyEl) deps.bodyEl.classList.remove('drill-open');
    if (map && map.resize) map.resize();
  }

  function setBoundsPolys(polys) { boundsPolys = polys; }

  // map.on('click') は main.js(C7) が cc = initCountryClick(...); map.on('click', cc.handleMapClick) で登録する。
  // ここで登録すると main.js 側と二重になる（patch #7 解消）。

  return { resolveFipsAt, handleMapClick, openPlace, navigate, closeCountry, noteDeckPick, setBoundsPolys };
}

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
