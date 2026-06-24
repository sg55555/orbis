// 最寄り都市探索の純粋ヘルパ（ブラウザ・Node 双方で import 可能な ESM）。
// 距離は equirectangular（cosLat 補正）の二乗距離で比較する（sqrt 不要・順位は二乗でも保存される）。

// 2 点間の equirectangular 二乗距離（度^2）。経度差は両点の平均緯度の cos で補正し、
// 高緯度での経度方向の度詰まりを反映する。順位比較専用（sqrt しない）。
export function sqDistDeg(aLon, aLat, bLon, bLat) {
  const meanLatRad = (((aLat + bLat) / 2) * Math.PI) / 180;
  const dLon = (aLon - bLon) * Math.cos(meanLatRad);
  const dLat = aLat - bLat;
  return dLon * dLon + dLat * dLat;
}

// (lon,lat) に最も近い city を線形探索で返す。city={name,name_ja,lon,lat,pop}。
// cities が空/未指定なら null。最近傍が maxDeg（度）を超える場合も null（「都市名なし」）。
// 同距離は配列の先頭を優先（安定タイブレーク）。
export function nearestCity(lon, lat, cities, { maxDeg = 1.5 } = {}) {
  if (!Array.isArray(cities) || cities.length === 0) return null;
  const maxSq = maxDeg * maxDeg;
  let best = null;
  let bestSq = Infinity;
  for (const c of cities) {
    const d = sqDistDeg(lon, lat, c.lon, c.lat);
    if (d < bestSq) {
      bestSq = d;
      best = c;
    }
  }
  if (best === null || bestSq > maxSq) return null;
  return best;
}
