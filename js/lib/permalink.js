// 共有パーマリンクの純粋部。現在のビュー（中心/ズーム）＋ON レイヤー集合を
// URL クエリと相互変換する。DOM/地図には依存しない（テスト可能）。
// immerse.js が ?param を「読む」のと同じ流儀＋「書く」(buildPermalink) を足したもの。
//
// URL 形式：?ll=<lat>,<lng>&z=<zoom>&layers=<id,id,...>
//   ll は人が読みやすい lat,lng 順。center は MapLibre 順の [lng,lat] で返す。

// クエリ文字列から key の生値を取り出す（?/& で区切られた key= のみ＝gz の z 等を誤認しない）。
function getParam(search, key) {
  const m = new RegExp('[?&]' + key + '=([^&]*)').exec(search);
  return m ? decodeURIComponent(m[1]) : null;
}

// ?ll=<lat>,<lng> → center [lng,lat]。範囲外/非数値/カンマ無しは null。
function parseCenter(search) {
  const v = getParam(search, 'll');
  if (v == null) return null;
  const parts = v.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
}

// ?z=<zoom> → number。0..22 外/非数値は null。
function parseZoom(search) {
  const v = getParam(search, 'z');
  if (v == null) return null;
  const z = Number(v);
  if (!Number.isFinite(z) || z < 0 || z > 22) return null;
  return z;
}

// ?layers=<id,...> → 配列（空要素除去）。キー無し→null・空値→[]（全OFF）。
function parseLayers(search) {
  const v = getParam(search, 'layers');
  if (v == null) return null;
  return v.split(',').map((x) => x.trim()).filter(Boolean);
}

// クエリ文字列 → { center:[lng,lat]|null, zoom:number|null, layers:string[]|null }。
export function parsePermalink(search) {
  const s = typeof search === 'string' ? search : '';
  return { center: parseCenter(s), zoom: parseZoom(s), layers: parseLayers(s) };
}

// 現在状態 → 共有 URL。center=[lng,lat]・zoom=number・layers=string[]。
// 未指定のキーは省略（堅牢）。座標 4 桁・ズーム 2 桁に丸めて短く。
export function buildPermalink(baseUrl, { center, zoom, layers } = {}) {
  const params = [];
  if (Array.isArray(center) && center.length === 2
      && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
    params.push('ll=' + center[1].toFixed(4) + ',' + center[0].toFixed(4));
  }
  if (Number.isFinite(zoom)) params.push('z=' + Number(zoom).toFixed(2));
  if (Array.isArray(layers)) params.push('layers=' + layers.join(','));
  return params.length ? baseUrl + '?' + params.join('&') : baseUrl;
}
