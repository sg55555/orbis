"""workflow の『schedule-active ∧ 非 if-gate』集合を算出する一級パーサ。

Layer1 の完全性テスト（REQUIRED ⊆ eligible）と将来の鮮度モニタが共有する。
pyyaml は使わない（root requirements.txt が Vercel 全 api/ 関数へ install されるため）。
最難所ゆえ、実 workflow への統合テストに加えパーサ単体を固定する。
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import collectors.lib.wf_eligibility as wfe


# ── schedule_active パーサ単体
def test_schedule_active_true_for_uncommented_cron():
    assert wfe.schedule_active("on:\n  schedule:\n    - cron: '7,37 * * * *'\n") is True


def test_schedule_active_false_when_cron_commented():
    text = "on:\n  # schedule:\n  #   - cron: '17 */2 * * *'\n  workflow_dispatch: {}\n"
    assert wfe.schedule_active(text) is False


# ── collector_steps パーサ単体（if 検出）
def test_collector_step_without_if():
    text = (
        "    steps:\n"
        "      - name: Collect ships\n"
        "        env:\n"
        "          AISSTREAM_API_KEY: ${{ secrets.AISSTREAM_API_KEY }}\n"
        "        run: python -m collectors.ships || python -m collectors.lib.mark_error ships\n"
    )
    assert wfe.collector_steps(text) == [("ships", False)]


def test_collector_step_with_if_detected():
    text = (
        "    steps:\n"
        "      - name: Collect news\n"
        "        if: ${{ github.event.inputs.include_news == 'true' }}\n"
        "        env:\n"
        "          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n"
        "        run: python -m collectors.news || python -m collectors.lib.mark_error news\n"
    )
    assert wfe.collector_steps(text) == [("news", True)]


def test_collector_step_ignores_commented_if():
    text = (
        "    steps:\n"
        "      - name: Collect ships\n"
        "        # if: false   ← コメントは if 扱いしない\n"
        "        run: python -m collectors.ships || python -m collectors.lib.mark_error ships\n"
    )
    assert wfe.collector_steps(text) == [("ships", False)]


# ── 逸脱記法への堅牢性（レビュー w62i4h21y の確定3指摘）：YAML の key 順序は不定・
#    run はブロックスカラも取りうる。統一形から外れた再フォーマットでも正しく判定する。
def test_if_as_first_step_key_detected():
    # `if:` がステップ先頭 key（`- if:`）でも has_if=True（key 順は GitHub が強制しない）。
    text = (
        "    steps:\n"
        "      - if: ${{ github.event.inputs.include_news == 'true' }}\n"
        "        name: Collect news\n"
        "        run: python -m collectors.news || python -m collectors.lib.mark_error news\n"
    )
    assert wfe.collector_steps(text) == [("news", True)]


def test_compact_run_step_does_not_inherit_previous_if():
    # 単一行 `- run:` の compact ステップは、前ステップの if: を継承しない（別ステップ）。
    text = (
        "    steps:\n"
        "      - name: Gated thing\n"
        "        if: ${{ false }}\n"
        "        run: echo skip\n"
        "      - run: python -m collectors.quakes || python -m collectors.lib.mark_error quakes\n"
    )
    assert wfe.collector_steps(text) == [("quakes", False)]


def test_block_scalar_run_detected():
    # `run: |` のブロックスカラ内の継続行にある collector 起動も検出する。
    text = (
        "    steps:\n"
        "      - name: Collect firms\n"
        "        env:\n"
        "          FIRMS_MAP_KEY: ${{ secrets.FIRMS_MAP_KEY }}\n"
        "        run: |\n"
        "          python -m collectors.firms || python -m collectors.lib.mark_error firms\n"
    )
    assert wfe.collector_steps(text) == [("firms", False)]


def test_nested_block_sequence_above_run_does_not_break_if_detection():
    # if: と run: の間に in-step の block-sequence 項目（`- x`）が入っても if を取りこぼさない。
    text = (
        "    steps:\n"
        "      - name: Collect news\n"
        "        if: ${{ github.event.inputs.include_news == 'true' }}\n"
        "        env:\n"
        "          NOTE: |\n"
        "            - a\n"
        "            - b\n"
        "        run: python -m collectors.news || python -m collectors.lib.mark_error news\n"
    )
    assert wfe.collector_steps(text) == [("news", True)]


# ── 実 workflow への統合
def test_eligible_includes_ships_and_firms():
    el = wfe.eligible_layers()
    assert "ships" in el, el
    assert "firms" in el, el


def test_eligible_excludes_if_gated_news():
    assert "news" not in wfe.eligible_layers()


def test_eligible_excludes_schedule_disabled_anthropic():
    el = wfe.eligible_layers()
    for mod in ("briefing", "forecast", "instability"):
        assert mod not in el, f"{mod} は schedule コメントアウト＝非 eligible のはず（{el}）"
