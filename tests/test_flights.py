import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.flights import transform, downsample, build_snapshot

SAMPLE = {"time": 1781368722, "states": [
    ["abc123", "ANA221  ", "Japan", 1, 1, 139.7, 35.6, 10000.0, False, 250.0, 90.0, 0,0,0,0,0,0],
    ["def456", "JAL10   ", "Japan", 1, 1, None, 35.0, 9000.0, False, 200.0, 45.0, 0,0,0,0,0,0],
]}

def test_transform_maps_and_filters():
    pts = transform(SAMPLE)
    assert len(pts) == 1
    p = pts[0]
    assert p["icao24"] == "abc123"
    assert p["callsign"] == "ANA221"
    assert p["lon"] == 139.7 and p["lat"] == 35.6
    assert p["alt"] == 10000.0 and p["on_ground"] is False
    assert p["velocity"] == 250.0 and p["heading"] == 90.0

def test_downsample_caps_count():
    pts = [{"icao24": str(i), "lon": 0, "lat": 0} for i in range(100)]
    out = downsample(pts, 10)
    assert len(out) <= 10
    assert out[0]["icao24"] == "0"

def test_build_snapshot_shape():
    snap = build_snapshot([{"icao24": "a"}], "2026-06-14T00:00:00Z")
    assert snap["layer"] == "flights" and snap["count"] == 1 and snap["updated"].endswith("Z")

def test_main_failure_keeps_previous_snapshot(monkeypatch, tmp_path):
    # 失敗時に flights.json を上書きしない＝前回スナップショット温存（SPOF回避）。
    # 失敗の記録自体は workflow 側の collectors.lib.mark_error が担う（tests/test_mark_error.py）。
    import requests
    import collectors.flights as fl
    monkeypatch.setattr(fl, "SNAPSHOT_DIR", str(tmp_path))
    def boom(*a, **kw):
        raise requests.exceptions.ConnectTimeout("connect timed out")
    monkeypatch.setattr(fl, "fetch_with_retry", boom)
    assert fl.main() == 1
    assert not (tmp_path / "flights.json").exists()


def test_retry_attempts_defaults_to_three(monkeypatch):
    # 既定は従来どおり3。attempt2以降の成功率は未測定（失敗runだけの標本からは分からない）で、
    # ReadTimeout/429/5xx の回復性まで一律に捨てる根拠が無いため、既定は安全側に据え置く。
    import collectors.flights as fl
    monkeypatch.delenv("FLIGHTS_RETRY_ATTEMPTS", raising=False)
    assert fl.retry_attempts() == 3


def test_retry_attempts_overridable_via_env(monkeypatch):
    # 遮断ウィンドウ中に空振りを減らしたい時だけ env で明示的に絞る（Python変更不要）。
    import collectors.flights as fl
    monkeypatch.setenv("FLIGHTS_RETRY_ATTEMPTS", "1")
    assert fl.retry_attempts() == 1


def test_retry_attempts_falls_back_on_garbage_env(monkeypatch):
    import collectors.flights as fl
    monkeypatch.setenv("FLIGHTS_RETRY_ATTEMPTS", "たくさん")
    assert fl.retry_attempts() == 3


def test_fetch_with_retry_honors_env_attempts(monkeypatch):
    # env=1 のとき、恒久的な ConnectTimeout でも fetch は1回しか呼ばれない。
    import requests
    import collectors.flights as fl
    monkeypatch.setenv("FLIGHTS_RETRY_ATTEMPTS", "1")
    n = {"i": 0}
    def always_timeout(url=fl.STATES_URL, timeout=30):
        n["i"] += 1
        raise requests.exceptions.ConnectTimeout("connect timed out")
    monkeypatch.setattr(fl, "fetch", always_timeout)
    try:
        fl.fetch_with_retry(wait=0, sleep=lambda s: None)
    except requests.exceptions.ConnectTimeout:
        pass
    assert n["i"] == 1


def test_env_is_read_at_call_time_not_import_time(monkeypatch):
    # env の後付けが効くこと（import 時に既定を固めない）＝workflow の env 追加だけで変えられる。
    import collectors.flights as fl
    monkeypatch.setenv("FLIGHTS_RETRY_ATTEMPTS", "2")
    assert fl.retry_attempts() == 2
    monkeypatch.setenv("FLIGHTS_RETRY_ATTEMPTS", "1")
    assert fl.retry_attempts() == 1


def test_fetch_with_retry_retries_on_connect_timeout(monkeypatch):
    # 本番障害の再現: OpenSky への接続が 1回目 ConnectTimeout → リトライして2回目成功。
    import requests
    import collectors.flights as fl
    n = {"i": 0}
    def fake_fetch(url=fl.STATES_URL, timeout=30):
        n["i"] += 1
        if n["i"] == 1:
            raise requests.exceptions.ConnectTimeout("connect timed out")
        return {"states": []}
    monkeypatch.setattr(fl, "fetch", fake_fetch)
    out = fl.fetch_with_retry(attempts=3, wait=0, sleep=lambda s: None)
    assert out == {"states": []}
    assert n["i"] == 2
