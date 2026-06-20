# tests/test_instability_collector.py
import json
import os
import importlib


def _seed(tmp):
    os.makedirs(tmp / "config", exist_ok=True)
    os.makedirs(tmp / "data" / "static", exist_ok=True)
    os.makedirs(tmp / "data" / "snapshots", exist_ok=True)
    # 設定（リポジトリの実ファイルをコピー）
    root = os.path.dirname(os.path.dirname(__file__))
    for rel in ["config/instability.json", "config/fips_countries.json",
                "data/static/country_bounds.geojson"]:
        with open(os.path.join(root, rel), encoding="utf-8") as f:
            (tmp / rel).write_text(f.read(), encoding="utf-8")
    snaps = tmp / "data" / "snapshots"
    (snaps / "conflict.json").write_text(json.dumps({"points": [
        {"place": "IZ", "root": "19", "mentions": 9, "tone": "-6", "lon": 44.0, "lat": 33.0}]}), encoding="utf-8")
    (snaps / "protests.json").write_text(json.dumps({"points": []}), encoding="utf-8")
    (snaps / "news.json").write_text(json.dumps({"items": []}), encoding="utf-8")
    (snaps / "quakes.json").write_text(json.dumps({"points": []}), encoding="utf-8")


def test_main_writes_snapshot_without_key(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    mod = importlib.import_module("collectors.instability")
    importlib.reload(mod)
    assert mod.main() == 0
    out = json.load(open(tmp_path / "data" / "snapshots" / "instability.json", encoding="utf-8"))
    assert out["countries"][0]["code"] == "IZ"
    assert out["model"] is None                 # キー無し→ナラティブ無し
    assert (tmp_path / "data" / "snapshots" / "instability_history.json").exists()


def test_main_adds_narrative_with_key(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    mod = importlib.import_module("collectors.instability")
    importlib.reload(mod)
    monkeypatch.setattr(mod, "_ask", lambda prompt: '{"IZ": "紛争が集中している"}')
    assert mod.main() == 0
    out = json.load(open(tmp_path / "data" / "snapshots" / "instability.json", encoding="utf-8"))
    iz = next(c for c in out["countries"] if c["code"] == "IZ")
    assert iz["narrative_ja"] == "紛争が集中している"
    assert out["model"] == mod.MODEL
