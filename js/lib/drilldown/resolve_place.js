// クリック点 → 最具体かつ manifest にプロフィールが在る階層を解決（純関数・I/O は注入）。
// city(近接・qid・manifest.city) → admin1(PIP・manifest.admin1) → country(manifest.country)。
function _dist2(ax, ay, bx, by) { const dx = ax - bx; const dy = ay - by; return dx * dx + dy * dy; }

export function resolvePlace(lon, lat, ctx) {
  const { fips, countryName, admin1Polys = [], cities = [], manifest = {},
          pip, nearest, cityRadiusDeg = 0.5 } = ctx || {};
  const man = { country: {}, admin1: {}, city: {}, ...manifest };
  const chain = [];
  let target = null;
  let admin1Hit = null;

  if (fips && man.country[fips]) {
    const c = { level: 'country', id: fips, name_ja: countryName || fips };
    chain.push(c); target = c;
  }
  // admin1（PIP で当該 poly を特定）
  for (const p of admin1Polys) {
    if (pip && pip(lon, lat, p)) { admin1Hit = p; break; }
  }
  if (admin1Hit && man.admin1[admin1Hit.code]) {
    const c = { level: 'admin1', id: admin1Hit.code, name_ja: admin1Hit.name_ja || admin1Hit.code };
    chain.push(c); target = c;
  }
  // city（近接・qid・manifest 在り）
  const city = nearest ? nearest(lon, lat, cities) : null;
  if (city && city.qid && man.city[city.qid]) {
    const near = _dist2(lon, lat, city.lon, city.lat) <= cityRadiusDeg * cityRadiusDeg;
    if (near) {
      const c = { level: 'city', id: city.qid, name_ja: city.name_ja || city.qid };
      chain.push(c); target = c;
    }
  }
  return { chain, target, admin1Hit };
}
