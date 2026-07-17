import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.lib.manifest import update_manifest, record_manifest_error

def test_update_manifest_creates_and_merges(tmp_path):
    path = tmp_path / "manifest.json"
    update_manifest(str(path), "quakes", "2026-06-13T12:00:00Z", 5)
    update_manifest(str(path), "ships", "2026-06-13T12:01:00Z", 99)
    data = json.loads(path.read_text())
    assert data["layers"]["quakes"] == {"updated": "2026-06-13T12:00:00Z", "count": 5}
    assert data["layers"]["ships"]["count"] == 99

def test_update_manifest_overwrites_same_layer(tmp_path):
    path = tmp_path / "manifest.json"
    update_manifest(str(path), "quakes", "t1", 1)
    update_manifest(str(path), "quakes", "t2", 7)
    data = json.loads(path.read_text())
    assert data["layers"]["quakes"] == {"updated": "t2", "count": 7}


def test_record_error_preserves_last_success(tmp_path):
    # 収集失敗時も「最後に成功した鮮度」を壊さない（前回スナップショット温存と整合）。
    path = tmp_path / "manifest.json"
    update_manifest(str(path), "flights", "2026-07-14T00:00:00Z", 5000)
    record_manifest_error(str(path), "flights", "2026-07-17T02:00:00Z")
    layer = json.loads(path.read_text())["layers"]["flights"]
    assert layer["updated"] == "2026-07-14T00:00:00Z"
    assert layer["count"] == 5000
    assert layer["last_error_at"] == "2026-07-17T02:00:00Z"


def test_record_error_on_unknown_layer_does_not_fabricate_freshness(tmp_path):
    # 一度も成功していない層に updated を捏造しない（UIが古さを誤表示するため）。
    path = tmp_path / "manifest.json"
    record_manifest_error(str(path), "firms", "2026-07-17T02:00:00Z")
    layer = json.loads(path.read_text())["layers"]["firms"]
    assert layer == {"last_error_at": "2026-07-17T02:00:00Z"}


def test_success_clears_previous_error(tmp_path):
    # 復旧したら last_error_at は消える＝「今この層が壊れているか」を表す現在状態にする。
    path = tmp_path / "manifest.json"
    record_manifest_error(str(path), "flights", "2026-07-17T02:00:00Z")
    update_manifest(str(path), "flights", "2026-07-17T02:15:00Z", 4200)
    layer = json.loads(path.read_text())["layers"]["flights"]
    assert layer == {"updated": "2026-07-17T02:15:00Z", "count": 4200}


def test_record_error_keeps_other_layers_untouched(tmp_path):
    path = tmp_path / "manifest.json"
    update_manifest(str(path), "quakes", "2026-07-17T02:15:00Z", 295)
    record_manifest_error(str(path), "flights", "2026-07-17T02:16:00Z")
    data = json.loads(path.read_text())
    assert data["layers"]["quakes"] == {"updated": "2026-07-17T02:15:00Z", "count": 295}
