"""Layer2 鮮度モニタ CLI（read-only backstop）。

manifest.json の updated 経過時間だけを見て層ごとの MAX_AGE と比較し、Layer1 が盲目な
「無言の stale」（穴1＝REQUIRED 追記忘れ層のキー失効／穴2＝flights 型 exit0-no-write）を
::error::＋exit1 で可視化する。erroring_stale（last_error_at 有＝Layer1 が担当）や
missing/cold/fresh_empty は ::warning::（exit0）に降格し、既知障害での永続赤＝オオカミ少年を避ける。

read-only：orbis-data へは一切書かない（push/commit なし）。workflow 側では token 無しで
orbis-data を checkout し、本 CLI は data/snapshots/manifest.json を読むだけ＝新 SPOF を作らない。

使い方: python -m collectors.lib.freshness_monitor [<manifest.json path>]
（省略時は ORBIS_SNAPSHOT_DIR（既定 data/snapshots）/manifest.json）。stdlib のみ・pip install なし。
"""
import json
import os
import sys
from datetime import datetime, timezone

from collectors.lib import freshness_policy as fp
from collectors.lib import wf_eligibility as wfe

SNAPSHOT_DIR = os.environ.get(
    "ORBIS_SNAPSHOT_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "snapshots")),
)


def load_manifest(path):
    """manifest.json を dict で返す。全体I/Oの失敗（欠落/権限/ディレクトリ）と JSON 破損のみ例外を伝播。

    層単位の欠落・古さは evaluate() が Finding として扱う。ここで上げる例外は main が捕捉して
    monitor self-failure（::error title=freshness-monitor::）に変換する。
    """
    with open(path, encoding="utf-8") as f:
        return json.load(f)  # OSError（欠落/権限/ディレクトリ）/ json.JSONDecodeError(ValueError) を伝播


def render_table(findings):
    """全層（fresh 含む）の鮮度テーブル文字列（self-observability＝緑 run でも走った証跡）。

    注釈でなく素の stdout ＝ ::error/::warning/::notice のパースには掛からない。
    updated 生文字列や例外は載せない（数値の経過時間のみ）。
    """
    rows = ["layer      status          age        max"]
    for f in sorted(findings, key=lambda x: x.layer):
        age = "-" if f.age_seconds is None else f"{f.age_seconds / 3600:.1f}h"
        mx = f"{f.max_seconds / 3600:.0f}h"
        rows.append(f"{f.layer:<10} {f.status:<15} {age:<10} {mx}")
    return "\n".join(rows)


def integrity_gaps():
    """eligible なのに MAX_AGE に閾値が無い層（runtime の完全性盲点）。CI 完全性テストの runtime 版。"""
    return wfe.eligible_layer_names() - set(fp.MAX_AGE)


def _write_step_summary(text):
    """GitHub Step Summary にも鮮度テーブルを載せる（run 画面で見える）。失敗は握り潰す（本筋でない）。"""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    except OSError:
        pass


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    path = argv[0] if argv else os.path.join(SNAPSHOT_DIR, "manifest.json")
    now = datetime.now(timezone.utc)

    try:
        manifest = load_manifest(path)
    except (OSError, ValueError):
        # 監視自身の失敗（データリポの欠落/権限/ディレクトリ/JSON 破損）を loud に出す＝
        # monitor-of-monitor を可視化。例外文言は載せない（層名でない・秘密漏洩経路を開かない）。
        print("::error title=freshness-monitor::manifest.json unreadable (monitor self-failure)")
        return 1

    findings = fp.evaluate(manifest, now)
    table = render_table(findings)
    print(table)
    _write_step_summary(table)

    # runtime 完全性：CI をバイパスして merge された「MAX_AGE 未登録の eligible 層」を可視化。
    for layer in sorted(integrity_gaps()):
        print(f"::warning title={layer}::eligible layer absent from MAX_AGE (monitor integrity)")

    # 文言は各分岐にリテラルで置く（f-string 補間は {layer} のみ＝秘密漏洩経路を静的に持たない）。
    for f in findings:
        layer = f.layer
        if f.status == "silent_stale":
            print(f"::error title={layer}::freshness stale with no last_error_at (see age table)")
        elif f.status == "erroring_stale":
            print(f"::warning title={layer}::stale but last_error_at set; Layer1 owns (see age table)")
        elif f.status == "missing":
            print(f"::warning title={layer}::no manifest entry yet (cold-start / awaiting first write)")
        elif f.status == "cold":
            print(f"::warning title={layer}::manifest cold-start (no snapshots present)")
        elif f.status == "fresh_empty":
            print(f"::warning title={layer}::fresh timestamp but count is 0 (stamped-empty; see age table)")

    if fp.is_red(findings):
        return 1
    print("::notice title=freshness-monitor::freshness check complete (see age table above)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
