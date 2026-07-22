"""Layer2 鮮度モニタ CLI（freshness_monitor）の I/O とシグナル分岐を固定する。

- silent_stale が1つでもあれば exit1（赤×）／erroring_stale・missing・cold・fresh_empty は exit0（warning）
- manifest ファイル自体が読めない（欠落/破損）は monitor self-failure＝exit1（監視の監視を可視化）
- 注釈（::error/::warning/::notice）は層名以外を補間しない（PUBLIC ログ/manifest への秘密漏洩を静的封鎖）

pyyaml は使わない（root requirements.txt は Vercel 全 api/ 関数へ install されるため）。
"""
import io
import json
import os
import re
import sys
import tempfile
from contextlib import redirect_stdout
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import collectors.lib.freshness_monitor as mon
import collectors.lib.freshness_policy as fp

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fresh_manifest():
    iso = _now_iso()
    return {"layers": {layer: {"updated": iso, "count": 10} for layer in fp.MAX_AGE}}


def _run_dict(manifest):
    d = tempfile.mkdtemp()
    p = os.path.join(d, "manifest.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(manifest, f)
    return _run_path(p)


def _run_path(path):
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = mon.main([path])
    return rc, buf.getvalue()


def test_exit1_on_silent_stale():
    m = _fresh_manifest()
    m["layers"]["flights"] = {"updated": "2020-01-01T00:00:00Z", "count": 5}  # 古い・last_error_at 無
    rc, out = _run_dict(m)
    assert rc == 1
    assert "::error title=flights::" in out


def test_exit0_and_notice_on_all_fresh():
    rc, out = _run_dict(_fresh_manifest())
    assert rc == 0
    assert "::notice" in out
    assert "::error" not in out
    assert "::warning" not in out


def test_erroring_stale_does_not_exit1():
    m = _fresh_manifest()
    m["layers"]["ships"] = {"updated": "2020-01-01T00:00:00Z", "count": 1960,
                            "last_error_at": _now_iso()}
    rc, out = _run_dict(m)
    assert rc == 0
    assert "::warning title=ships::" in out
    assert "::error" not in out


def test_fresh_empty_is_warning_not_exit1():
    m = _fresh_manifest()
    m["layers"]["flights"] = {"updated": _now_iso(), "count": 0}  # stamped-empty
    rc, out = _run_dict(m)
    assert rc == 0
    assert "::warning title=flights::" in out
    assert "::error" not in out


def test_missing_manifest_file_is_self_failure():
    d = tempfile.mkdtemp()
    rc, out = _run_path(os.path.join(d, "nope.json"))
    assert rc == 1
    assert "::error title=freshness-monitor::" in out       # 監視自身の失敗
    assert "::error title=flights" not in out               # 層エラーとは別経路


def test_corrupt_manifest_json_is_self_failure():
    d = tempfile.mkdtemp()
    p = os.path.join(d, "manifest.json")
    with open(p, "w", encoding="utf-8") as f:
        f.write("{ this is not json")
    rc, out = _run_path(p)
    assert rc == 1
    assert "::error title=freshness-monitor::" in out


def test_directory_as_manifest_is_self_failure():
    # manifest パスがディレクトリ（IsADirectoryError＝OSError）でも生 traceback で落ちず
    # self-failure 注釈＋exit1 にする（レビュー確定 finding：catch を OSError へ拡張）。
    d = tempfile.mkdtemp()
    rc, out = _run_path(d)
    assert rc == 1
    assert "::error title=freshness-monitor::" in out


def test_age_table_lists_all_layers():
    rc, out = _run_dict(_fresh_manifest())
    for layer in fp.MAX_AGE:
        assert layer in out, f"age テーブルに {layer} が出ていない（self-observability）"


def test_integrity_gaps_empty_when_covered():
    # 現状 MAX_AGE は eligible を完全被覆＝runtime integrity gap なし。
    assert mon.integrity_gaps() == set()


def test_annotations_interpolate_only_layer_name():
    # ::error/::warning/::notice 行に層名以外の f-string 補間を許さない
    #（{e}/例外/manifest 文字列経由の秘密漏洩を静的封鎖・Layer1 と同方針）。
    src = os.path.join(ROOT, "collectors", "lib", "freshness_monitor.py")
    for i, line in enumerate(open(src, encoding="utf-8"), 1):
        if "::warning" in line or "::notice" in line or "::error" in line:
            fields = re.findall(r"\{([^}]*)\}", line)
            bad = [f for f in fields if f not in ("layer",)]
            assert not bad, f"freshness_monitor.py:{i} 注釈に層名以外の補間: {bad}"
            # f-string の {} 検査だけでは連結（+ secret）や %-format 経由の秘密混入を素通しする
            #（レビュー確定 finding）。注釈行は単一リテラル固定＝これらの整形演算を静的に禁止する。
            for op in ("+", "%", ".format("):
                assert op not in line, f"freshness_monitor.py:{i} 注釈行に連結/整形 `{op}`（秘密混入経路）"
