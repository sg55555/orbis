import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import collectors.lib.mark_error as me
from collectors.lib.manifest import update_manifest


def test_marks_layer_with_timestamp(tmp_path, monkeypatch):
    monkeypatch.setattr(me, "SNAPSHOT_DIR", str(tmp_path))
    assert me.main(["flights"]) == 0
    layer = json.loads((tmp_path / "manifest.json").read_text())["layers"]["flights"]
    assert layer["last_error_at"].endswith("Z")


def test_preserves_last_successful_freshness(tmp_path, monkeypatch):
    # 失敗を記録しても「最後に成功した鮮度」は壊さない（UIの N時間前 表示が根拠にする値）。
    monkeypatch.setattr(me, "SNAPSHOT_DIR", str(tmp_path))
    update_manifest(str(tmp_path / "manifest.json"), "flights", "2026-07-14T00:00:00Z", 5000)
    me.main(["flights"])
    layer = json.loads((tmp_path / "manifest.json").read_text())["layers"]["flights"]
    assert layer["updated"] == "2026-07-14T00:00:00Z"
    assert layer["count"] == 5000
    assert layer["last_error_at"].endswith("Z")


def test_records_timestamp_only_no_free_text(tmp_path, monkeypatch):
    # 秘密漏洩防止: FIRMS の URL には MAP_KEY が載る。manifest は PUBLIC な orbis-data へ
    # commit されログと違い secrets のマスクが効かないため、自由文言は一切載せない
    # （エントリのキーが last_error_at だけであることを不変条件として固定する）。
    monkeypatch.setattr(me, "SNAPSHOT_DIR", str(tmp_path))
    me.main(["firms"])
    entry = json.loads((tmp_path / "manifest.json").read_text())["layers"]["firms"]
    assert list(entry.keys()) == ["last_error_at"]


def test_marks_multiple_layers_from_one_step(tmp_path, monkeypatch):
    # gdelt_events は1ステップで conflict と protests の2層を書くため、両方を落とす。
    monkeypatch.setattr(me, "SNAPSHOT_DIR", str(tmp_path))
    assert me.main(["conflict", "protests"]) == 0
    layers = json.loads((tmp_path / "manifest.json").read_text())["layers"]
    assert layers["conflict"]["last_error_at"].endswith("Z")
    assert layers["protests"]["last_error_at"].endswith("Z")


def test_emits_github_warning_annotation(tmp_path, monkeypatch, capsys):
    # run 一覧が緑で流れる中でも、失敗層が GitHub の Annotation として浮くようにする。
    monkeypatch.setattr(me, "SNAPSHOT_DIR", str(tmp_path))
    me.main(["flights"])
    out = capsys.readouterr().out
    assert "::warning title=flights::" in out


def test_exits_zero_to_preserve_spof_avoidance(tmp_path, monkeypatch):
    # 既存の `|| echo` と同じく終了コード0＝1層の障害で全層の commit を失わない設計を維持。
    monkeypatch.setattr(me, "SNAPSHOT_DIR", str(tmp_path))
    assert me.main(["flights"]) == 0


def test_requires_layer_argument(tmp_path, monkeypatch):
    # 引数を落としたら黙って成功しない（可視化機構自体がサイレント失敗しては本末転倒）。
    monkeypatch.setattr(me, "SNAPSHOT_DIR", str(tmp_path))
    assert me.main([]) == 2
    assert not (tmp_path / "manifest.json").exists()


def test_never_fails_the_step(tmp_path, monkeypatch):
    # 記録先が壊れていても 0 を返す＝SPOF回避（記録の失敗で層の commit を落とさない）。
    monkeypatch.setattr(me, "SNAPSHOT_DIR", str(tmp_path / "manifest.json" / "impossible"))
    (tmp_path / "manifest.json").write_text("{}")
    assert me.main(["flights"]) == 0
