"""国境ポリゴンの点内判定（純Python ray-casting）。lat/lon→FIPS 国コード。"""


def load_polygons(geojson):
    polys = []
    for f in (geojson.get("features") or []):
        props = f.get("properties") or {}
        code = props.get("code")
        if not code:
            continue
        geom = f.get("geometry") or {}
        gtype = geom.get("type")
        coords = geom.get("coordinates") or []
        rings = []
        if gtype == "Polygon":
            rings = [[(pt[0], pt[1]) for pt in ring] for ring in coords]
        elif gtype == "MultiPolygon":
            for poly in coords:
                for ring in poly:
                    rings.append([(pt[0], pt[1]) for pt in ring])
        if not rings:
            continue
        xs = [pt[0] for r in rings for pt in r]
        ys = [pt[1] for r in rings for pt in r]
        polys.append({"code": code, "name": props.get("name"),
                      "bbox": (min(xs), min(ys), max(xs), max(ys)), "rings": rings})
    return polys


def _point_in_rings(x, y, rings):
    """全リング横断の even-odd（穴・マルチポリゴンを正しく扱う）。"""
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
    return inside


def point_country(lon, lat, polys):
    if lon is None or lat is None:
        return None
    try:
        x, y = float(lon), float(lat)
    except (TypeError, ValueError):
        return None
    for p in polys:
        b = p["bbox"]
        if x < b[0] or x > b[2] or y < b[1] or y > b[3]:
            continue
        if _point_in_rings(x, y, p["rings"]):
            return p["code"]
    return None
