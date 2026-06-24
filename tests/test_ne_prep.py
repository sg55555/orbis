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
