# tests/test_ne_prep.py — scripts/lib/ne_prep.py（純粋関数）の網羅テスト。
# 実行: PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q
import json
import math

from scripts.lib.ne_prep import (
    resolve_fips,
    pick_name_ja,
    split_by_country,
    largest_polygon_bbox,
    simplify_ring,
    nearest_city_cap,
    union_country_bbox,
)

# country_bounds の実態に合わせた最小 name→FIPS インデックス。
BOUNDS_NAME_INDEX = {
    "China": "CH",
    "South Africa": "SF",
    "Australia": "AS",
    "Austria": "AU",
    "Switzerland": "SZ",
    "Japan": "JA",
    "United States of America": "US",
}


def test_resolve_fips_iso_and_name_agree():
    # ISO_A2=CN→FIPS CH、name=China→FIPS CH。一致。
    props = {"ISO_A2": "CN", "admin": "China"}
    assert resolve_fips(props, BOUNDS_NAME_INDEX) == "CH"


def test_resolve_fips_name_wins_over_iso_trap():
    # スイスの NE feature が ISO_A2='CH' を持つ。FIPS_OF_ISO['CH']=SZ なので
    # ISO 候補は SZ、name=Switzerland も SZ。取り違えなし。
    props = {"ISO_A2": "CH", "admin": "Switzerland"}
    assert resolve_fips(props, BOUNDS_NAME_INDEX) == "SZ"


def test_resolve_fips_iso_missing_uses_name():
    # ISO 欠落（-99）でも name 突合で解決する（係争地・小国で頻出）。
    props = {"ISO_A2": "-99", "admin": "South Africa"}
    assert resolve_fips(props, BOUNDS_NAME_INDEX) == "SF"


def test_resolve_fips_iso_a2_eh_fallback():
    # NE は Norway を ISO_A2='-99' / ISO_A2_EH='NO' で入れる（既知 quirk）。
    # name が bounds_name_index に無くても ISO_A2_EH フォールバックで FIPS=NO に解決する。
    props = {"ISO_A2": "-99", "ISO_A2_EH": "NO", "ADMIN": "Norway"}
    assert resolve_fips(props, {}) == "NO"


def test_resolve_fips_iso_a2_preferred_over_eh():
    # ISO_A2 が有効なら ISO_A2_EH は見ない（ISO_A2 優先・EH は -99 時のみ）。
    props = {"ISO_A2": "CN", "ISO_A2_EH": "ZZ", "admin": "China"}
    assert resolve_fips(props, BOUNDS_NAME_INDEX) == "CH"


def test_resolve_fips_lowercase_iso_a2_admin1():
    # NE admin1 は小文字 iso_a2 を使う（admin0/places は大文字 ISO_A2）。
    # admin(国名) が country_bounds 名と form 違い（United Republic of Tanzania）でも
    # 小文字 iso_a2 で FIPS=TZ に解決する（name_index は空でよい）。
    props = {"iso_a2": "TZ", "admin": "United Republic of Tanzania", "name": "Mbeya"}
    assert resolve_fips(props, {}) == "TZ"


def test_resolve_fips_conflict_prefers_name():
    # 万一 ISO と name が食い違ったら name（country_bounds 権威）を採る。
    props = {"ISO_A2": "AU", "admin": "Australia"}  # ISO AU→FIPS AS、name Australia→AS
    assert resolve_fips(props, BOUNDS_NAME_INDEX) == "AS"
    # 食い違いケース: ISO が AT（→AU=オーストリア）だが name が Australia。
    props2 = {"ISO_A2": "AT", "admin": "Australia"}
    assert resolve_fips(props2, BOUNDS_NAME_INDEX) == "AS"


def test_resolve_fips_unknown_returns_none():
    assert resolve_fips({"ISO_A2": "ZZ", "admin": "Nowhere"}, BOUNDS_NAME_INDEX) is None
    assert resolve_fips({}, BOUNDS_NAME_INDEX) is None
    assert resolve_fips({"ISO_A2": None, "admin": None}, BOUNDS_NAME_INDEX) is None


def test_pick_name_ja_prefers_ne_name_ja():
    props = {"name_ja": "東京都", "wikidataid": "Q1490", "name_en": "Tokyo"}
    assert pick_name_ja(props, {"Q1490": "ウィキ東京"}, {}) == "東京都"


def test_pick_name_ja_falls_to_wikidata():
    props = {"wikidataid": "Q1490", "name_en": "Tokyo"}
    assert pick_name_ja(props, {"Q1490": "東京都"}, {}) == "東京都"


def test_pick_name_ja_falls_to_geonames():
    props = {"ne_id": "1001", "name_en": "Osaka"}
    assert pick_name_ja(props, {}, {"1001": "大阪府"}) == "大阪府"


def test_pick_name_ja_falls_to_english():
    props = {"name_en": "Atlantis"}
    assert pick_name_ja(props, {}, {}) == "Atlantis"
    # name_en も無ければ name / NAME / admin の順。
    assert pick_name_ja({"NAME": "Foo"}, {}, {}) == "Foo"
    # 全欠落は空文字。
    assert pick_name_ja({}, {}, {}) == ""


def test_pick_name_ja_blank_values_skip_to_next():
    # 空白だけの name_ja はスキップして次段へ。
    props = {"name_ja": "  ", "wikidataid": "Q1", "name_en": "X"}
    assert pick_name_ja(props, {"Q1": "ジャパン"}, {}) == "ジャパン"


def test_split_by_country_groups_and_drops_none():
    feats = [
        {"id": 1, "fips": "JA"},
        {"id": 2, "fips": "US"},
        {"id": 3, "fips": "JA"},
        {"id": 4, "fips": None},  # 未解決は捨てる
    ]
    out = split_by_country(feats, lambda f: f["fips"])
    assert set(out.keys()) == {"JA", "US"}
    assert [f["id"] for f in out["JA"]] == [1, 3]
    assert [f["id"] for f in out["US"]] == [2]


def test_nearest_city_cap_sorts_by_pop_desc_and_caps():
    places = [
        {"name": "A", "pop": 100},
        {"name": "B", "pop": 5000},
        {"name": "C", "pop": 300},
        {"name": "D"},            # pop 欠落→0
        {"name": "E", "pop": 5000},  # B と同数→入力順で B,E
    ]
    out = nearest_city_cap(places, 3)
    assert [p["name"] for p in out] == ["B", "E", "C"]


def test_nearest_city_cap_handles_empty_and_small():
    assert nearest_city_cap([], 400) == []
    one = [{"name": "X", "pop": 1}]
    assert nearest_city_cap(one, 400) == one


def test_largest_polygon_bbox_polygon():
    geom = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]],
    }
    assert largest_polygon_bbox(geom) == [0, 0, 10, 20]


def test_largest_polygon_bbox_picks_largest_part():
    # 小さな飛び地（経度 170..179）＋大きな本土（経度 0..30）。
    # 最大面積は本土→bbox は本土側のみ＝lonSpan 30（太平洋跨ぎ回避）。
    geom = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[170, -5], [179, -5], [179, 5], [170, 5], [170, -5]]],   # 小・幅9
            [[[0, 0], [30, 0], [30, 40], [0, 40], [0, 0]]],            # 大・幅30高40
        ],
    }
    assert largest_polygon_bbox(geom) == [0, 0, 30, 40]


def test_largest_polygon_bbox_empty_geometry_none():
    assert largest_polygon_bbox({}) is None
    assert largest_polygon_bbox({"type": "Polygon", "coordinates": []}) is None
    assert largest_polygon_bbox(None) is None


def test_simplify_ring_removes_collinear_midpoints():
    # 直線上の中間点は eps で消える（端点 A,E は残る）。閉リング。
    ring = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 0]]
    out = simplify_ring(ring, 0.01)
    # 直線 (0,0)->(3,0) 上の (1,0),(2,0) は除去され (3,3) は角として残る。
    assert out[0] == [0, 0]
    assert out[-1] == [0, 0]
    assert [3, 3] in out
    assert [1, 0] not in out and [2, 0] not in out


def test_simplify_ring_keeps_significant_vertex():
    # 偏差が eps より大きい点は残す。
    ring = [[0, 0], [1, 1], [2, 0], [0, 0]]
    out = simplify_ring(ring, 0.01)
    assert [1, 1] in out


def test_simplify_ring_short_ring_unchanged():
    ring = [[0, 0], [1, 1], [0, 0]]
    assert simplify_ring(ring, 0.5) == ring
    # eps<=0 は無間引き（コピー）。
    full = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 0]]
    out = simplify_ring(full, 0)
    assert out == full and out is not full


# Important-4: largest_polygon_bbox のアンチメリディアンガード
def test_largest_polygon_bbox_antimeridian_single_polygon():
    """フィジー型: 単一 Polygon のリングが ±180 を跨ぐ（lon_span > 180）。
    経度ラップで実 span を取り、過剰全幅 bbox（lonSpan ≈ 360）を返さない。"""
    # フィジー近似: 経度が 177 〜 -178 を跨ぐ単一リング
    ring = [[177, -18], [180, -18], [-178, -18], [-178, -15], [177, -15], [177, -18]]
    geom = {"type": "Polygon", "coordinates": [ring]}
    bbox = largest_polygon_bbox(geom)
    assert bbox is not None
    # raw_span = (-178) - 177 が負 → abs = 355 > 180 なので wrap が選ばれる。
    # wrapped: 正の経度を -360: [177-360=-183, 180-360=-180, -178, -178, 177-360=-183]
    # wrap_w=-183, wrap_e=-178 → span=5（小さい）, raw_span=355（大きい）→ wrap 採用
    lon_span = bbox[2] - bbox[0]
    assert lon_span < 180, f"アンチメリディアン跨ぎ単一 Polygon の lon_span は 180 未満であるべき: {lon_span}"
    assert lon_span > 0, f"lon_span は正であるべき: {lon_span}"


def test_largest_polygon_bbox_normal_polygon_unchanged():
    """通常（アンチメリディアン非跨ぎ）Polygon は従来と同じ結果。"""
    ring = [[130, 30], [145, 30], [145, 45], [130, 45], [130, 30]]
    geom = {"type": "Polygon", "coordinates": [ring]}
    bbox = largest_polygon_bbox(geom)
    assert bbox == [130, 30, 145, 45]


def test_largest_polygon_bbox_antimeridian_multipolygon_still_picks_largest():
    """MultiPolygon で本土が大きい場合は本土を選ぶ（従来と同じ）。"""
    geom = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[170, -5], [179, -5], [179, 5], [170, 5], [170, -5]]],   # 小・幅9
            [[[0, 0], [30, 0], [30, 40], [0, 40], [0, 0]]],            # 大・幅30高40
        ],
    }
    bbox = largest_polygon_bbox(geom)
    assert bbox == [0, 0, 30, 40]


def test_largest_polygon_bbox_polar_cap_not_wrapped():
    """南極型: 全経度(-180..180)を占める極冠リングは跨ぎでない。wrap して
    値域外(-359 等)にせず、全幅 [-180,..,180] を維持する（wrap_span<180 ガード）。"""
    ring = [[-180, -90], [-90, -85], [0, -80], [90, -85], [180, -90], [-180, -90]]
    geom = {"type": "Polygon", "coordinates": [ring]}
    bbox = largest_polygon_bbox(geom)
    assert bbox[0] >= -180 and bbox[2] <= 180, f"値域外: {bbox}"
    assert bbox[0] == -180 and bbox[2] == 180, f"極冠は全幅を維持すべき: {bbox}"


def test_union_country_bbox_normal():
    """非跨ぎ国は素朴な min/max 結合（従来挙動）。"""
    bboxes = [[130, 30, 140, 40], [135, 25, 145, 35]]
    assert union_country_bbox(bboxes) == [130, 25, 145, 40]


def test_union_country_bbox_antimeridian_nz():
    """NZ 型: 本土(東半球)＋島嶼(西半球)で naive span>180。w>e の折返し形で返し、
    偽の全幅(span≈356)を出さない。client は e<w を跨ぎとして解釈する。"""
    bboxes = [
        [166.0, -47.0, 178.84, -34.0],     # 本土（東半球）
        [-176.85, -44.5, -176.17, -43.7],  # Chatham（西半球）
        [-177.96, -31.0, -177.85, -29.0],  # Kermadec（西半球）
    ]
    w, s, e, n = union_country_bbox(bboxes)
    assert w > e, f"跨ぎは w>e の折返し形であるべき: {[w, s, e, n]}"
    assert -180 <= w <= 180 and -180 <= e <= 180, "経度は値域内"
    wrap_span = (e + 360) - w
    assert wrap_span < 180, f"折返し span は実幅(<180)であるべき: {wrap_span}"
    assert w == 166.0 and e == -176.17


def test_union_country_bbox_polar_cap_full_width():
    """南極型: 全経度を占める国 bbox は折返さず全幅 [-180,..,180] を維持する。"""
    bboxes = [[-180.0, -90.0, 180.0, -63.0], [10.0, -85.0, 20.0, -80.0]]
    assert union_country_bbox(bboxes) == [-180.0, -90.0, 180.0, -63.0]


def test_union_country_bbox_empty():
    assert union_country_bbox([]) is None


# Minor: Kosovo XK→KV
from scripts.lib.fips_of_iso import FIPS_OF_ISO


def test_fips_of_iso_kosovo_xk_to_kv():
    """Kosovo: ISO XK → FIPS KV が明示登録されていること（name 突合頼みを解消）。"""
    assert FIPS_OF_ISO.get("XK") == "KV", "Kosovo: XK→KV が FIPS_OF_ISO に登録されていない"


def test_resolve_fips_kosovo_via_iso():
    """Kosovo の NE feature が ISO_A2='XK' を持つ場合、resolve_fips が KV を返す。"""
    # Kosovo は BOUNDS_NAME_INDEX に無い（小国/係争地で country_bounds に無い場合）→ ISO で解決。
    props = {"ISO_A2": "XK", "admin": "Kosovo"}
    result = resolve_fips(props, BOUNDS_NAME_INDEX)  # name 突合: "Kosovo" は BOUNDS_NAME_INDEX に無い→ISO 採用
    assert result == "KV", f"XK は KV に解決されるべき、実際: {result}"
