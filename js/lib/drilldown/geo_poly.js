// 国境/県境ポリゴンの点内判定（純 ray-casting）。collectors/lib/geo_country.py を JS 同一移植。
// deck/DOM/fetch/map 非依存・node:test の主対象。

// 全リング横断の even-odd（穴・MultiPolygon を正しく扱う）。
// collectors/lib/geo_country.py:30-42 の _point_in_rings と同一式。
export function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
      j = i;
    }
  }
  return inside;
}

// GeoJSON FeatureCollection を点内判定用に正規化する。
// collectors/lib/geo_country.py:4-27 の load_polygons 相当（name_ja/codeKey を追加）。
// 戻り値: [{code, name, name_ja, bbox:[w,s,e,n], rings}]
export function loadPolygons(geojson, { codeKey = 'code' } = {}) {
  const polys = [];
  const features = (geojson && geojson.features) || [];
  for (const f of features) {
    const props = (f && f.properties) || {};
    const code = props[codeKey];
    if (!code) continue;
    const geom = (f && f.geometry) || {};
    const gtype = geom.type;
    const coords = geom.coordinates || [];
    const rings = [];
    if (gtype === 'Polygon') {
      for (const ring of coords) {
        rings.push(ring.map((pt) => [pt[0], pt[1]]));
      }
    } else if (gtype === 'MultiPolygon') {
      for (const poly of coords) {
        for (const ring of poly) {
          rings.push(ring.map((pt) => [pt[0], pt[1]]));
        }
      }
    }
    if (rings.length === 0) continue;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const ring of rings) {
      for (const pt of ring) {
        if (pt[0] < w) w = pt[0];
        if (pt[0] > e) e = pt[0];
        if (pt[1] < s) s = pt[1];
        if (pt[1] > n) n = pt[1];
      }
    }
    polys.push({
      code,
      name: props.name == null ? null : props.name,
      name_ja: props.name_ja == null ? null : props.name_ja,
      bbox: [w, s, e, n],
      rings,
    });
  }
  return polys;
}

// bbox 早期棄却→pointInRings。collectors/lib/geo_country.py:52-57 の per-poly 判定相当。
// poly = {code, name, name_ja, bbox:[w,s,e,n], rings}
export function pointInFeature(lon, lat, poly) {
  const b = poly.bbox;
  if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return false;
  return pointInRings(lon, lat, poly.rings);
}

// polys を順に走査し最初にヒットした poly を返す。全ミスは null（海洋/極域）。
// collectors/lib/geo_country.py:45-58 の point_country 相当（code でなく poly を返す）。
export function locateFeature(lon, lat, polys) {
  for (const p of polys) {
    if (pointInFeature(lon, lat, p)) return p;
  }
  return null;
}
