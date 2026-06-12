import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.lib.manifest import update_manifest

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
