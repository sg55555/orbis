"""収集失敗を manifest.json に記録する CLI（workflow の `|| ...` から呼ぶ）。

なぜ collector の中でなく外か：collect.yml の各ステップは `python -m collectors.<layer> || echo ...`
で終了コードを 0 に潰している（1ソースの障害で全層の commit を失わない＝意図的なSPOF回避）。
その副作用で **層が壊れても run は success と表示される**（2026-07-17 監査で flights が約95%
サイレント失敗し3日間検知されなかった実例）。ここを層に依らず一律に記録することで、
①firms のように try/except を持たず traceback で落ちる層も捉えられる
②各 collector の内部（ships/news のように return 1 の分岐が複数ある）を書き換えずに済む。

使い方: python -m collectors.lib.mark_error <layer> [<layer> ...]
1ステップが複数層を書く場合は全て並べる（例 gdelt_events は conflict と protests）。
失敗の中身（例外文言）はここでは記録しない＝ステップログ側で見る。理由は
record_manifest_error() の docstring を参照（PUBLIC リポへの秘密漏洩防止）。
"""
import os
import sys
from datetime import datetime, timezone

from collectors.lib.manifest import record_manifest_error

SNAPSHOT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "snapshots")
)


def main(argv):
    if not argv:
        print("[mark_error] usage: python -m collectors.lib.mark_error <layer> [<layer> ...]")
        return 2
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for layer in argv:
        # GitHub の Annotation として run 一覧・ジョブ画面に浮かせる（緑の run に埋もれさせない）。
        print(f"::warning title={layer}::collect failed（前回スナップショットを温存）")
        try:
            record_manifest_error(os.path.join(SNAPSHOT_DIR, "manifest.json"), layer, now_iso)
            print(f"[mark_error] {layer} last_error_at={now_iso}")
        except Exception as e:
            # 記録の失敗で層の commit を落とさない（この機構自体が新たなSPOFにならないように）。
            print(f"[mark_error] could not record {layer}: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
