"""flights collector（adsb.fi タイル取得）のテスト。

2026-09-10 に OpenSky → adsb.fi へ移行。移行理由は障害ではなく**規約**
（OpenSky ToS §3(iii) 第三者への再配布禁止・§3(vi) automated system は書面ライセンス必須）。
したがってここでのテストは「単位変換の正しさ」と「先方サービスへの叩き方（1req/s・429で即中断）」、
そして「部分失敗しても前回スナップショットを壊さない」ことを固定する。
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import requests

import collectors.flights as fl
from collectors.flights import (
    transform, transform_aircraft, downsample, build_snapshot, tile_url,
    merge_payload, points_from, collect_tiles, UpstreamRefused,
)


def ac(**kw):
    """adsb.fi の1機分（実測の代表形）。上書きしたいキーだけ渡す。"""
    base = {"hex": "4d214f", "flight": "AJD214K ", "lat": 51.1878, "lon": 4.45401,
            "alt_baro": 38000, "gs": 397.5, "track": 321.03, "seen_pos": 0.4}
    base.update(kw)
    return base


def payload(*aircraft):
    return {"ac": list(aircraft), "msg": "No error", "total": len(aircraft)}


# --- フィールド対応と単位変換（移行で最も壊れやすいところ） ---

def test_transform_aircraft_maps_fields_and_units():
    p = transform_aircraft(ac())
    assert p["icao24"] == "4d214f"
    assert p["callsign"] == "AJD214K", "flight は末尾スペース込みで来るので trim する"
    assert p["lat"] == 51.188 and p["lon"] == 4.454, "座標は小数3桁"
    assert p["alt"] == 11582, "alt_baro は ft → m（38000ft×0.3048=11582.4m）"
    assert p["velocity"] == 204.5, "gs は kt → m/s（397.5kt×0.514444=204.5m/s）"
    assert p["heading"] == 321.0
    assert p["on_ground"] is False


def test_transform_aircraft_ground_string_becomes_on_ground():
    # alt_baro は数値ではなく文字列 'ground' が来る（実測 941機中 124機）。
    p = transform_aircraft(ac(alt_baro="ground", gs=0.0, track=None))
    assert p["on_ground"] is True
    assert p["alt"] is None, "地上機に気圧高度は無い（UI は on_ground を見て『地上』と出す）"
    assert p["velocity"] == 0.0


def test_transform_aircraft_drops_rows_without_position():
    assert transform_aircraft(ac(lat=None)) is None
    assert transform_aircraft(ac(lon=None)) is None
    assert transform_aircraft({}) is None


def test_transform_aircraft_missing_optional_fields_stay_none():
    p = transform_aircraft(ac(alt_baro=None, gs=None, track=None, flight=None))
    assert p["alt"] is None and p["velocity"] is None and p["heading"] is None
    assert p["callsign"] == "", "便名欠落は空文字（UI が '(便名なし)' に落とす）"
    assert p["on_ground"] is False


def test_heading_falls_back_to_calc_track_then_true_heading():
    # track 欠損は 11.3%。うち9割は地上機だが、飛行中の欠損は calc_track/true_heading で埋まる
    # （実測＝3つとも欠損かつ飛行中の機体は0）。UI は heading 欠損機をドット表示に落とすので、
    # ここを埋めないと OpenSky 比で見た目が劣化する。
    assert transform_aircraft(ac(track=None, calc_track=88.5))["heading"] == 88.5
    assert transform_aircraft(ac(track=None, true_heading=12.25))["heading"] == 12.2
    assert transform_aircraft(ac(track=None, calc_track=88.5, true_heading=1.0))["heading"] == 88.5, \
        "calc_track を true_heading より優先"


def test_transform_aircraft_rejects_non_numeric_garbage():
    # 上流が想定外の型を返しても collector 全体を落とさない（1機だけ捨てる）。
    assert transform_aircraft(ac(lat="なし")) is None
    p = transform_aircraft(ac(alt_baro="high", gs="fast", track="north"))
    assert p["alt"] is None and p["velocity"] is None and p["heading"] is None


def test_transform_reads_v3_ac_key():
    pts = transform(payload(ac(), ac(hex="abc123", lat=None)))
    assert len(pts) == 1 and pts[0]["icao24"] == "4d214f"


def test_transform_handles_empty_and_malformed_payload():
    assert transform({"ac": []}) == []
    assert transform({}) == []
    assert transform({"ac": None}) == []


# --- タイルのマージ（円が重なるので重複は必ず出る） ---

def test_merge_payload_dedupes_by_hex_keeping_freshest_position():
    acc = {}
    merge_payload(acc, payload(ac(hex="aaa", lat=1.0, seen_pos=12.0)))
    merge_payload(acc, payload(ac(hex="aaa", lat=2.0, seen_pos=0.5)))
    assert len(acc) == 1
    assert points_from(acc)[0]["lat"] == 2.0, "同じ機体は seen_pos が小さい（新しい）方を採る"


def test_merge_payload_keeps_first_when_newer_is_staler():
    acc = {}
    merge_payload(acc, payload(ac(hex="aaa", lat=1.0, seen_pos=0.5)))
    merge_payload(acc, payload(ac(hex="aaa", lat=2.0, seen_pos=30.0)))
    assert points_from(acc)[0]["lat"] == 1.0


def test_merge_payload_missing_seen_pos_does_not_win():
    acc = {}
    merge_payload(acc, payload(ac(hex="aaa", lat=1.0, seen_pos=5.0)))
    merge_payload(acc, payload(ac(hex="aaa", lat=2.0, seen_pos=None)))
    assert points_from(acc)[0]["lat"] == 1.0, "seen_pos 欠落は実測値のある既存を上書きしない"


def test_merge_payload_fills_in_when_existing_has_no_seen_pos():
    acc = {}
    merge_payload(acc, payload(ac(hex="aaa", lat=1.0, seen_pos=None)))
    merge_payload(acc, payload(ac(hex="aaa", lat=2.0, seen_pos=9.0)))
    assert points_from(acc)[0]["lat"] == 2.0, "seen_pos を持つ方が判断できるので優先する"


# --- 先方サービスへの叩き方（規約：public endpoint は 1 request per second） ---

def test_tile_url_uses_v3_and_stays_within_250nm():
    assert tile_url(50.0, 8.5) == "https://opendata.adsb.fi/api/v3/lat/50.0/lon/8.5/dist/250"
    assert fl.TILE_DIST_NM <= 250, "v3 の最大距離は 250NM"


def test_collect_tiles_paces_requests_to_one_per_second():
    tiles = [("a", 1, 1), ("b", 2, 2), ("c", 3, 3)]
    slept, t = [], [0.0]

    def clock():
        return t[0]

    def sleep(s):
        slept.append(s)
        t[0] += s

    def fetch(lat, lon):
        t[0] += 0.3          # 実測の平均取得時間 0.44s 相当
        return payload(ac(hex="h%s" % lat))

    pts, ok, total, limited = collect_tiles(tiles=tiles, fetch=fetch, sleep=sleep, clock=clock)
    assert ok == 3 and total == 3 and limited is False
    assert len(pts) == 3
    assert len(slept) == 2, "1タイル目の前には待たない"
    for s in slept:
        assert s == pytest.approx(fl.PACE_S - 0.3, abs=1e-6), "前回リクエストからの経過を差し引いて待つ"


def test_collect_tiles_does_not_sleep_when_fetch_was_already_slow():
    tiles = [("a", 1, 1), ("b", 2, 2)]
    slept, t = [], [0.0]

    def fetch(lat, lon):
        t[0] += 5.0
        return payload(ac(hex="h%s" % lat))

    collect_tiles(tiles=tiles, fetch=fetch, sleep=slept.append, clock=lambda: t[0])
    assert slept == [], "取得自体が1秒を超えたら追加で待つ必要はない"


def test_collect_tiles_stops_immediately_when_upstream_refuses():
    # 規約：400/401/403/404/429 の多発は一時 IP 制限。拒否されてなお叩き続けるのは
    # 自分で自分を締め出す行為なので、残りタイルを捨ててでも即やめる。
    tiles = [("a", 1, 1), ("b", 2, 2), ("c", 3, 3), ("d", 4, 4)]
    calls = []

    def fetch(lat, lon):
        calls.append(lat)
        if lat == 2:
            raise UpstreamRefused("HTTP 429")
        return payload(ac(hex="h%s" % lat))

    pts, ok, total, refused = collect_tiles(tiles=tiles, fetch=fetch, sleep=lambda s: None,
                                            clock=lambda: 0.0)
    assert calls == [1, 2], "拒否の後は1つも叩かない"
    assert refused is True and ok == 1 and total == 4


def test_fetch_tile_refuses_on_every_blocking_status(monkeypatch):
    # 429 だけでなく 404/403 も同じ扱い。API の形が変わって全タイルが 404 になった日に、
    # 42回の無効リクエストを15分毎に出し続けて締め出されるのを防ぐ。
    class Resp:
        def __init__(self, code):
            self.status_code = code

        def raise_for_status(self):
            raise AssertionError("BLOCKING_STATUSES はここへ来る前に落とす")

        def json(self):
            raise AssertionError("BLOCKING_STATUSES で本文を読んではいけない")

    for code in sorted(fl.BLOCKING_STATUSES):
        monkeypatch.setattr(fl.requests, "get", lambda *a, _c=code, **kw: Resp(_c))
        with pytest.raises(UpstreamRefused):
            fl.fetch_tile(1.0, 2.0)


def test_collect_tiles_stops_when_deadline_passes():
    # read timeout が連鎖すると 42タイル×30秒＝21分まで伸びうる。collect は concurrency group を
    # collect-slow と共有し cancel-in-progress: false なので、長引くと外部cron（15分毎）の run が
    # キューに積み上がる。予算を超えたらそこまでの結果で作る（半数未満なら main が書かない）。
    tiles = [("a", 1, 1), ("b", 2, 2), ("c", 3, 3), ("d", 4, 4)]
    calls, t = [], [0.0]

    def fetch(lat, lon):
        calls.append(lat)
        t[0] += 100.0
        return payload(ac(hex="h%s" % lat))

    pts, ok, total, refused = collect_tiles(tiles=tiles, fetch=fetch, sleep=lambda s: None,
                                            clock=lambda: t[0], deadline_s=250)
    assert calls == [1, 2, 3], "予算を超えたら残りは叩かない"
    assert ok == 3 and total == 4 and refused is False
    assert len(pts) == 3


def test_collect_tiles_continues_past_single_tile_failure():
    tiles = [("a", 1, 1), ("b", 2, 2), ("c", 3, 3)]

    def fetch(lat, lon):
        if lat == 2:
            raise requests.exceptions.ConnectTimeout("connect timed out")
        return payload(ac(hex="h%s" % lat))

    pts, ok, total, limited = collect_tiles(tiles=tiles, fetch=fetch, sleep=lambda s: None,
                                            clock=lambda: 0.0)
    assert ok == 2 and total == 3 and limited is False
    assert len(pts) == 2, "1タイル落ちても残りで作る（タイルは重なっているので穴は小さい）"


# --- スナップショット（cite 義務をデータ自身に持たせる） ---

def test_build_snapshot_carries_attribution():
    # adsb.fi の条件は「cite adsb.fi and include a link to our home page」。
    # orbis は snapshot を公開リポ orbis-data で配るので、UI だけでなくデータ側にも出典を焼き込む。
    snap = build_snapshot([{"icao24": "a"}], "2026-09-10T00:00:00Z", tiles_ok=42, tiles_total=42)
    assert snap["layer"] == "flights" and snap["count"] == 1
    assert snap["source"] == "adsb.fi"
    assert snap["source_url"] == "https://adsb.fi/"
    assert snap["tiles_ok"] == 42 and snap["tiles_total"] == 42


def test_downsample_caps_count():
    pts = [{"icao24": str(i), "lon": 0, "lat": 0} for i in range(100)]
    out = downsample(pts, 10)
    assert len(out) <= 10
    assert out[0]["icao24"] == "0"


# --- タイル定義そのもの ---

def test_tiles_are_unique_and_within_bounds():
    names = [t[0] for t in fl.TILES]
    assert len(names) == len(set(names)), "タイル名の重複は設定ミス"
    assert 30 <= len(fl.TILES) <= 45
    for name, lat, lon in fl.TILES:
        assert -90 <= lat <= 90 and -180 <= lon <= 180, name


def test_tiles_cover_every_populated_region():
    # 実測（2026-09-10）で feeder が居ると分かった地域を落としていないことの回帰。
    regions = {
        "北米": lambda la, lo: 15 <= la <= 72 and -170 <= lo <= -50,
        "南米": lambda la, lo: -56 <= la <= 15 and -90 <= lo <= -30,
        "欧州": lambda la, lo: 35 <= la <= 72 and -25 <= lo <= 45,
        "アフリカ": lambda la, lo: -35 <= la <= 35 and -20 <= lo <= 52,
        "中東": lambda la, lo: 12 <= la <= 48 and 45 <= lo <= 80,
        "南アジア": lambda la, lo: 5 <= la <= 37 and 68 <= lo <= 92,
        "東アジア": lambda la, lo: 18 <= la <= 54 and 100 <= lo <= 150,
        "東南アジア": lambda la, lo: -11 <= la <= 25 and 92 <= lo <= 130,
        "豪州": lambda la, lo: -48 <= la <= -10 and 110 <= lo <= 180,
    }
    for region, inside in regions.items():
        assert any(inside(la, lo) for _, la, lo in fl.TILES), "%s のタイルが無い" % region


# --- main（前回スナップショットを壊さないこと） ---

def test_main_writes_snapshot_and_manifest(monkeypatch, tmp_path):
    monkeypatch.setattr(fl, "SNAPSHOT_DIR", str(tmp_path))
    monkeypatch.setattr(fl, "collect_tiles",
                        lambda **kw: ([{"icao24": "a", "lat": 1, "lon": 2}], 42, 42, False))
    assert fl.main() == 0
    import json
    snap = json.loads((tmp_path / "flights.json").read_text())
    assert snap["count"] == 1 and snap["source"] == "adsb.fi"
    man = json.loads((tmp_path / "manifest.json").read_text())
    assert man["layers"]["flights"]["count"] == 1


def test_main_failure_keeps_previous_snapshot(monkeypatch, tmp_path):
    # 失敗時に flights.json を上書きしない＝前回スナップショット温存（SPOF回避）。
    # 失敗の記録自体は workflow 側の collectors.lib.mark_error が担う（tests/test_mark_error.py）。
    monkeypatch.setattr(fl, "SNAPSHOT_DIR", str(tmp_path))

    def boom(**kw):
        raise requests.exceptions.ConnectionError("network down")

    monkeypatch.setattr(fl, "collect_tiles", boom)
    assert fl.main() == 1
    assert not (tmp_path / "flights.json").exists()


def test_main_fails_when_too_many_tiles_failed(monkeypatch, tmp_path):
    # 半分以上のタイルが落ちた結果を「成功」として書くと、地図から大陸が丸ごと消えたまま
    # updated だけ新しくなり、Layer2 鮮度モニタ（age ベース）にも引っかからない。
    monkeypatch.setattr(fl, "SNAPSHOT_DIR", str(tmp_path))
    monkeypatch.setattr(fl, "collect_tiles",
                        lambda **kw: ([{"icao24": "a"}], 20, 42, False))
    assert fl.main() == 1
    assert not (tmp_path / "flights.json").exists()


def test_main_accepts_partial_success_above_threshold(monkeypatch, tmp_path):
    monkeypatch.setattr(fl, "SNAPSHOT_DIR", str(tmp_path))
    monkeypatch.setattr(fl, "collect_tiles",
                        lambda **kw: ([{"icao24": "a"}], 30, 42, False))
    assert fl.main() == 0
    import json
    snap = json.loads((tmp_path / "flights.json").read_text())
    assert snap["tiles_ok"] == 30 and snap["tiles_total"] == 42


def test_main_fails_when_nothing_collected(monkeypatch, tmp_path):
    # 全タイル成功でも0機なら「stamped-empty」＝Layer2 の fresh_empty が拾う形だが、
    # collector 側でも書かずに前回を残す方が安全（NEVER_EMPTY 層）。
    monkeypatch.setattr(fl, "SNAPSHOT_DIR", str(tmp_path))
    monkeypatch.setattr(fl, "collect_tiles", lambda **kw: ([], 42, 42, False))
    assert fl.main() == 1
    assert not (tmp_path / "flights.json").exists()


def test_no_opensky_reference_remains():
    # 規約上 OpenSky を叩き続けてはいけないので、URL が残っていないことをテストで固定する。
    src = open(os.path.join(os.path.dirname(__file__), "..", "collectors", "flights.py"),
               encoding="utf-8").read()
    assert "opensky-network.org/api" not in src
    assert "opendata.adsb.fi" in src
