// bbox から flyTo に渡す zoom を逆算する純粋ヘルパ（ブラウザ・Node 双方で import 可能な ESM）。
// js/lib/geo.js の degLenForZoom（mpp = 156543.03 / 2^zoom・1度 ≈ 111320m）と同じ定数で整合する。
// 参照ビューポート(REF_PX)に bbox の最大 span を pad 込みで収める zoom を解き、[minZoom,maxZoom] に clamp する。

const M_PER_DEG = 111320;      // 1 度 ≈ 111320m（geo.js degLenForZoom と同一）
const EQ_MPP_Z0 = 156543.03;   // 赤道 metersPerPixel at zoom 0（geo.js degLenForZoom と同一）
const REF_PX = 512;            // 参照ビューポート（タイル基準の標準幅）。span をこの画素数に収める。

// bbox=[w,s,e,n]。lon/lat span の大きい方（メートル換算）を参照ビューポートに pad 込みで収める zoom を返す。
// w>e はアンチメリディアン折返しとみなし lon span を (e+360)-w で算出（過剰ズームアウト回避）。
// bbox 不正は安全側で minZoom を返す。span が極小→maxZoom、巨大→minZoom にクランプ。
export function zoomForBbox(bbox, { minZoom = 2.5, maxZoom = 6, pad = 1.15 } = {}) {
  if (!Array.isArray(bbox) || bbox.length < 4) return minZoom;
  const [w, s, e, n] = bbox;
  if (![w, s, e, n].every(Number.isFinite)) return minZoom;

  // lon span（度）。e>=w は通常、w>e は日付変更線跨ぎの折返し。
  const lonSpanDeg = e >= w ? e - w : (e + 360) - w;
  const latSpanDeg = Math.abs(n - s);

  // メートル換算。lon は中央緯度の cosLat 補正（高緯度の度詰まり）。
  const midLatRad = (((s + n) / 2) * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(midLatRad), 0.01);
  const lonSpanM = Math.abs(lonSpanDeg) * M_PER_DEG * cosLat;
  const latSpanM = latSpanDeg * M_PER_DEG;
  const spanM = Math.max(lonSpanM, latSpanM);

  // span が 0（点）なら maxZoom に張り付ける（極小国扱い）。
  if (!(spanM > 0)) return maxZoom;

  // spanM * pad <= REF_PX * (EQ_MPP_Z0 / 2^zoom) を解く:
  //   2^zoom = REF_PX * EQ_MPP_Z0 / (spanM * pad)
  //   zoom   = log2( REF_PX * EQ_MPP_Z0 / (spanM * pad) )
  const z = Math.log2((REF_PX * EQ_MPP_Z0) / (spanM * pad));
  return Math.max(minZoom, Math.min(maxZoom, z));
}
