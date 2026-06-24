// 国ドリルダウンの I/O 索引層（DI seam）。
// - country_bounds.geojson を一度だけ fetch→loadPolygons でキャッシュ（client FIPS 解決の一次ソース）。
// - countryBbox: admin1_bbox.json 由来の国 bbox。未登録 FIPS(EXTRA68) は manifest.extra の矩形 / fipsCenter±固定マージン。
// - fipsCenter: gazetteer.COUNTRIES を FIPS→[lng,lat] に索引（COUNTRY_CENTROIDS＋FIPS_JA join 済の単一ソース）。
import { loadPolygons } from './geo_poly.js';
import { COUNTRIES } from '../gazetteer.js';

const CENTER_BY_FIPS = new Map(COUNTRIES.map((c) => [c.code, [c.lng, c.lat]]));

export function fipsCenter(fips) {
  return CENTER_BY_FIPS.get(fips) || null;
}

// EXTRA68 等ポリゴン無し国の矩形フォールバックに使う既定マージン（fipsCenter 由来時）。
const CENTER_MARGIN_DEG = 2;

export function countryBbox(fips, bboxIndex) {
  const idx = bboxIndex || {};
  const country = idx.country || {};
  if (Array.isArray(country[fips])) return country[fips].slice();
  const extra = idx.extra || {};
  const e = extra[fips];
  if (e && Number.isFinite(e.lon) && Number.isFinite(e.lat)) {
    const m = Number.isFinite(e.margin) ? e.margin : CENTER_MARGIN_DEG;
    return [e.lon - m, e.lat - m, e.lon + m, e.lat + m];
  }
  const c = fipsCenter(fips);
  if (c) return [c[0] - CENTER_MARGIN_DEG, c[1] - CENTER_MARGIN_DEG, c[0] + CENTER_MARGIN_DEG, c[1] + CENTER_MARGIN_DEG];
  return [-180, -85, 180, 85];
}

// country_bounds.geojson の正規化済 polys を一度だけ作りキャッシュ（client FIPS 解決の一次ソース）。
const COUNTRY_BOUNDS_URL = 'data/static/country_bounds.geojson';
let _boundsPromise = null;

export function loadCountryBounds(fetchFn) {
  if (_boundsPromise) return _boundsPromise;
  const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  _boundsPromise = (async () => {
    const res = await f(COUNTRY_BOUNDS_URL);
    if (!res || !res.ok) throw new Error(`country_bounds ${res ? res.status : 'no-response'}`);
    const geojson = await res.json();
    return loadPolygons(geojson, { codeKey: 'code' });
  })();
  return _boundsPromise;
}

// テスト用: モジュール内キャッシュを破棄（本番コードからは呼ばない）。
export function __resetCountryIndexCache() {
  _boundsPromise = null;
}
