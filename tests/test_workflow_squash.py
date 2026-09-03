"""orbis-data 月次 squash workflow の構造テスト（設計 §3.0・監査所見 DATA-03）。

このテストが守るもの＝「--force push の安全装置が消えていないこと」。
squash workflow は orbis-data（公開データリポ・8,552 commits・968MB）の履歴を
1 コミットへ畳む。撃つのは `git push --force` なので、次の 4 つのどれか 1 つでも
欠けた状態で main に入ってはいけない:

  1. concurrency group が collect（collect.yml / collect-slow.yml と共有）
     → 収集ジョブと直列化されず force-push と通常 push が交差するとデータが飛ぶ
  2. workflow_dispatch の confirm ゲート（"squash" と入力した時だけ job が動く）
     → Actions 画面の Run workflow ボタンの誤クリックで不可逆操作が走る
  3. orphan コミットの tree が squash 前の tree と一致することの assert
     → 中身が変わったまま force-push すると公開データが壊れる（復元手段なし）
  4. fetch-depth: 1（浅い checkout）
     → 8,552 commits を毎回 fetch する意味が無い（この workflow は履歴を使わない）

pyyaml は使わない。orbis の root requirements.txt は Vercel の関数へ install される
ため、テスト専用の依存を足すと本番が太る（tests/test_workflow_observability.py と同じ理由）。
標準ライブラリの正規表現/文字列だけで検査する。
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".github" / "workflows" / "squash-data.yml"
COLLECT = ROOT / ".github" / "workflows" / "collect.yml"


def wf_text():
    """squash workflow の生テキスト。無ければその場で失敗させる（フィクスチャにしない＝
    失敗が ERROR ではなく FAILED として並び、赤の理由が 1 行で読めるようにする）。"""
    assert WF.is_file(), f"{WF.relative_to(ROOT)} が無い（Step 3 で作る）"
    return WF.read_text(encoding="utf-8")


def test_monthly_cron_is_23_03_on_the_first():
    # 毎月 1 日 03:23 UTC（12:23 JST）。外部 dispatch(:00/:15/:30/:45) と collect cron(:07/:37) を避ける。
    assert re.search(r"^\s*-\s*cron:\s*'23 3 1 \* \*'\s*$", wf_text(), re.M), \
        "schedule の cron が '23 3 1 * *' でない"


def test_concurrency_group_is_collect_and_not_cancelled():
    t = wf_text()
    assert re.search(r"^concurrency:\s*$", t, re.M), "concurrency ブロックが無い"
    assert re.search(r"^\s+group:\s*collect\s*(#.*)?$", t, re.M), \
        "concurrency.group が collect でない（収集ジョブと直列化されない＝push 競合）"
    assert re.search(r"^\s+cancel-in-progress:\s*false\s*(#.*)?$", t, re.M), \
        "cancel-in-progress: false でない（squash の途中キャンセルは半端な状態を残す）"


def test_permissions_are_read_only_on_this_repo():
    # orbis 側には何も書かない。orbis-data への push 権は PAT（ORBIS_DATA_TOKEN）だけが持つ。
    assert re.search(r"^permissions:\s*\n\s+contents:\s*read\s*$", wf_text(), re.M), \
        "permissions: contents: read になっていない"


def test_workflow_dispatch_has_required_confirm_input():
    t = wf_text()
    assert re.search(r"^\s+workflow_dispatch:\s*$", t, re.M), "workflow_dispatch が無い"
    assert re.search(r"^\s+confirm:\s*$", t, re.M), "inputs.confirm が無い"
    assert re.search(r"^\s+required:\s*true\s*$", t, re.M), "confirm が required: true でない"
    assert "squash と入力" in t, "confirm の description に「squash と入力」の指示が無い"


def test_job_runs_only_on_schedule_or_explicit_confirm():
    assert "if: github.event_name == 'schedule' || inputs.confirm == 'squash'" in wf_text(), \
        "誤爆ガード（confirm == 'squash'）の if が無い／表記が違う"


def test_checkout_is_shallow_and_targets_orbis_data():
    t = wf_text()
    for needle in (
        "uses: actions/checkout@v6",
        "repository: sg55555/orbis-data",
        "path: data-repo",
        "token: ${{ secrets.ORBIS_DATA_TOKEN }}",
        "fetch-depth: 1",
        "persist-credentials: true",
    ):
        assert needle in t, f"checkout の設定 `{needle}` が無い"


def test_shell_step_uses_strict_mode():
    assert "set -euo pipefail" in wf_text(), \
        "set -euo pipefail が無い（途中の失敗を無視して force-push まで到達しうる）"


def test_orphan_commit_recipe():
    t = wf_text()
    for needle in ("git checkout -q --orphan squash", "git add -A", "[skip ci]"):
        assert needle in t, f"orphan squash の手順 `{needle}` が無い"


def test_bot_identity_matches_collect_workflow():
    # 同じ bot が書いた履歴に見えること（collect.yml が正・ここが追従する）。
    collect = COLLECT.read_text(encoding="utf-8")
    email = re.search(r'git config user\.email "([^"]+)"', collect)
    assert email, "collect.yml から bot の email が読めない（形が変わった）"
    t = wf_text()
    assert 'git config user.name "orbis-bot"' in t, "user.name が orbis-bot でない"
    assert f'git config user.email "{email.group(1)}"' in t, \
        f"user.email が collect.yml と違う（期待: {email.group(1)}）"


def test_tree_assert_precedes_force_push():
    # 本テストの核。tree 一致 assert が --force より **前** にあること。
    t = wf_text()
    assert_idx = t.find('"$newtree" != "$tree"')
    push_idx = t.find("git push --force")
    assert assert_idx != -1, "tree 一致 assert（$newtree != $tree）が無い"
    assert push_idx != -1, "force push 行が無い"
    assert assert_idx < push_idx, \
        "tree assert が force push より後ろにある（壊れた tree を push しうる）"


def test_tree_mismatch_aborts_with_error_annotation():
    t = wf_text()
    assert "::error::" in t, "不一致時の ::error:: 注釈が無い（赤が Actions 上で見えない）"
    assert re.search(r"^\s+exit 1\s*$", t, re.M), "不一致時の exit 1 が無い"


def test_single_push_and_it_targets_orbis_data_main():
    t = wf_text()
    pushes = re.findall(r"^\s*git push.*$", t, re.M)
    assert len(pushes) == 1, f"git push が 1 行でない: {pushes}"
    assert pushes[0].strip() == "git push --force origin HEAD:main", \
        f"push 先/形が想定と違う: {pushes[0].strip()}"


def test_step_summary_records_before_and_after():
    t = wf_text()
    assert "$GITHUB_STEP_SUMMARY" in t, "実行結果のサマリ出力が無い（何を畳んだか後から追えない）"
    assert "before" in t and "after" in t, "サマリに before/after が無い"
