"""Natural Earth → Orbis 静的データ生成の純粋関数群。

標準ライブラリ（json/math）のみに依存する。geojson は dict で受け、I/O は
呼び側（build_*.py）に置く。pytest（tests/test_ne_prep.py）の主対象。
"""
import math

from scripts.lib.fips_of_iso import FIPS_OF_ISO

# NE が国名を入れる代表プロパティ（admin / ADMIN は admin1/places で揺れる）。
_NAME_KEYS = ("admin", "ADMIN", "geonunit", "GEONUNIT", "name", "NAME")


def _ne_country_name(props):
    for k in _NAME_KEYS:
        v = props.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def resolve_fips(ne_props, bounds_name_index):
    """NE feature properties → FIPS。ISO_A2→FIPS と country_bounds name 突合の
    二重チェックで取り違え（ISO CH=スイス↔FIPS CH=中国 等）を検出する。

    規則:
      1. ISO_A2 から FIPS_OF_ISO で iso_fips を引く（-99/空/非文字列は無し）。
      2. 国名（admin/ADMIN/geonunit/name の順）を bounds_name_index で name_fips に。
      3. 両方あり一致→その値。両方あり不一致→name_fips を優先（country_bounds が権威）。
      4. 片方のみ→その値。両方 None→None。
    """
    iso = ne_props.get("ISO_A2")
    iso_fips = None
    if isinstance(iso, str):
        iso = iso.strip().upper()
        if iso and iso != "-99":
            iso_fips = FIPS_OF_ISO.get(iso)

    name = _ne_country_name(ne_props)
    name_fips = bounds_name_index.get(name) if name else None

    if iso_fips and name_fips:
        return name_fips if name_fips != iso_fips else iso_fips
    return name_fips or iso_fips


def _first_nonblank(*vals):
    for v in vals:
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def pick_name_ja(props, wikidata_idx, geonames_idx):
    """日本語名を 4 段フォールバックで決める（要件4・確定事項4）。
    (1) NE name_ja → (2) Wikidata labels(ja) → (3) GeoNames alternateNames(ja)
    → (4) 真の欠落のみ英名（name_en/name/NAME/admin）。全欠落は空文字。"""
    # (1) NE 属性
    ja = _first_nonblank(props.get("name_ja"), props.get("NAME_JA"))
    if ja:
        return ja
    # (2) Wikidata
    wid = props.get("wikidataid") or props.get("wikidataId") or props.get("WIKIDATAID")
    if isinstance(wid, str) and wid.strip():
        v = wikidata_idx.get(wid.strip())
        if isinstance(v, str) and v.strip():
            return v.strip()
    # (3) GeoNames
    for key in ("ne_id", "geonameid", "GEONAMEID", "geonameId"):
        gid = props.get(key)
        if gid is not None:
            v = geonames_idx.get(str(gid))
            if isinstance(v, str) and v.strip():
                return v.strip()
    # (4) 英名フォールバック
    return _first_nonblank(
        props.get("name_en"), props.get("NAME_EN"),
        props.get("name"), props.get("NAME"), props.get("admin"),
    ) or ""


def split_by_country(features, key_fn):
    """features を key_fn(feature)→FIPS でグループ化。None キーは捨てる。
    順序は最初に現れた key の安定順。"""
    groups = {}
    for f in features:
        code = key_fn(f)
        if not code:
            continue
        groups.setdefault(code, []).append(f)
    return groups


def _pop_of(place):
    v = place.get("pop")
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def nearest_city_cap(places, maxN):
    """pop 降順に並べ先頭 maxN 件。pop 欠落/非数は 0、同数は入力順安定。"""
    ordered = sorted(places, key=_pop_of, reverse=True)
    return ordered[:maxN] if maxN is not None and maxN >= 0 else ordered


def _ring_bbox(ring):
    xs = [c[0] for c in ring]
    ys = [c[1] for c in ring]
    return [min(xs), min(ys), max(xs), max(ys)]


def _ring_bbox_antimeridian(ring):
    """outer ring の bbox を計算する。アンチメリディアン跨ぎ（lon span > 180）を検出した場合は
    経度をラップして実 span を取り、過剰全幅 bbox を返さない。
    戻り値: [w, s, e, n]（e<w の場合はアンチメリディアン折返しを示す）。"""
    xs = [c[0] for c in ring]
    ys = [c[1] for c in ring]
    raw_w, raw_e = min(xs), max(xs)
    raw_span = raw_e - raw_w
    if raw_span > 180:
        # アンチメリディアン跨ぎの可能性: 正の経度を -360 オフセットして再計算し、
        # span が小さい方を採用する（フィジー等・単一リングが ±180 を跨ぐケース）。
        wrapped = [x - 360 if x > 0 else x for x in xs]
        wrap_w, wrap_e = min(wrapped), max(wrapped)
        wrap_span = wrap_e - wrap_w
        if wrap_span < raw_span:
            return [wrap_w, min(ys), wrap_e, max(ys)]
    return [raw_w, min(ys), raw_e, max(ys)]


def largest_polygon_bbox(geometry):
    """Polygon / MultiPolygon から最大面積ポリゴン（outer ring）の bbox [w,s,e,n]。
    面積は bbox 近似（gen_country_centroids.py 同型）。MultiPolygon で本土を選ぶ
    ことで太平洋跨ぎ（lonSpan>180 の偽 bbox）を回避する。
    単一 Polygon でも lon span>180 を検出したらラップして実 span を取る（Important-4）。
    空は None。"""
    if not geometry:
        return None
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "Polygon":
        polys = [coords]
    elif gtype == "MultiPolygon":
        polys = coords
    else:
        return None
    best, best_area = None, -1.0
    for poly in polys:
        if not poly or not poly[0]:
            continue
        bbox = _ring_bbox_antimeridian(poly[0])  # outer ring（アンチメリディアン対応）
        # bbox 面積: span が -360 オフセット後は w<e なのでそのまま差を取る。
        lon_span = bbox[2] - bbox[0]
        area = lon_span * (bbox[3] - bbox[1])
        if area > best_area:
            best_area = area
            best = bbox
    return best


def _perp_dist(p, a, b):
    """点 p から線分 a-b への垂直距離（度・平面近似）。"""
    ax, ay = a[0], a[1]
    bx, by = b[0], b[1]
    px, py = p[0], p[1]
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    if seg2 == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / seg2
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def _dp(points, eps):
    if len(points) <= 2:
        return points[:]
    a, b = points[0], points[-1]
    idx, dmax = 0, 0.0
    for i in range(1, len(points) - 1):
        d = _perp_dist(points[i], a, b)
        if d > dmax:
            idx, dmax = i, d
    if dmax > eps:
        left = _dp(points[: idx + 1], eps)
        right = _dp(points[idx:], eps)
        return left[:-1] + right
    return [a, b]


def simplify_ring(ring, eps):
    """閉リングを Douglas-Peucker 風に間引く。端点保持・3点以下/eps<=0 は無間引き。
    spec の隙間抑制方針により eps≈0.01 度を build 側で使う。"""
    if eps is None or eps <= 0 or len(ring) <= 3:
        return ring[:]
    closed = len(ring) >= 2 and ring[0] == ring[-1]
    pts = ring[:-1] if closed else ring[:]
    if len(pts) <= 2:
        return ring[:]
    out = _dp(pts, eps)
    if closed:
        out = out + [out[0]]
    return out
