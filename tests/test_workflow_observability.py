"""workflow の失敗検知の配線が壊れていないことを固定する。

2026-07-17 の監査で「flights が約95%失敗しても run は success」が3日間見逃された。
その再発防止として全ステップに mark_error を配線したが、**その配線自体は
pytest/node のどちらでも守られていなかった**（層を足して引数を書き忘れても、
綴りを誤って PUBLIC な manifest に幻の層キーを作っても、テストは緑のまま通る）。
このテストが可視化機構そのもののサイレント劣化を防ぐ。

pyyaml は使わない：orbis の root requirements.txt は Vercel の全 api/ 関数へ
install されるため、テスト専用の依存を足すと本番の関数が太る。
"""
import sys, os, re, glob
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import collectors.lib.wf_eligibility as wfe

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW_DIR = os.path.join(ROOT, ".github", "workflows")


def _collector_steps():
    """workflow 内の「collector を起動する run 行」を (wf, mod, [layers]) で全て拾う。

    module→layer パーサは wf_eligibility に一本化した（Layer2 完全性テストと同一ソース＝
    正規表現の drift を防ぐ）。ここは薄い委譲。
    """
    return wfe.collector_steps_with_layers()


def test_every_collector_step_is_guarded():
    # 層を足して `|| mark_error` を書き忘れたら、その層は壊れても緑のまま流れる。
    steps = _collector_steps()
    assert steps, "collector を起動する run 行が1つも見つからない（正規表現が壊れている）"
    unguarded = [(f, mod) for f, mod, layers in steps if not layers]
    assert unguarded == [], f"mark_error が配線されていないステップ: {unguarded}"


def test_every_marked_layer_exists_in_its_collector():
    # 綴りミス（例 air_temp）は PUBLIC な orbis-data の manifest に幻の層キーを作る。
    # 各引数が「そのステップが起動する collector 自身の中のリテラル」であることを縛る。
    for wf, mod, layers in _collector_steps():
        src = open(os.path.join(ROOT, "collectors", f"{mod}.py"), encoding="utf-8").read()
        for layer in layers:
            assert f'"{layer}"' in src, (
                f'{wf}: mark_error の引数 "{layer}" が collectors/{mod}.py に存在しない'
                f"（綴り誤り、または層名の変更に追従できていない）"
            )


def test_no_bare_echo_guard_remains():
    # `|| echo` は終了コードを潰すだけで痕跡を残さない＝今回直した盲目性そのもの。
    for path in sorted(glob.glob(os.path.join(WORKFLOW_DIR, "*.yml"))):
        for i, line in enumerate(open(path, encoding="utf-8"), 1):
            if "python -m collectors." in line and not line.lstrip().startswith("#"):
                assert "|| echo" not in line, f"{os.path.basename(path)}:{i} に `|| echo` が残っている"


def test_mark_error_module_is_reachable_as_module():
    # workflow は `python -m collectors.lib.mark_error` で呼ぶ＝モジュールとして解決できること。
    import collectors.lib.mark_error as me
    assert callable(me.main)


def test_no_collector_runs_in_multiple_workflows():
    # 各 collector はちょうど1つの workflow からのみ起動されること。
    # firms を collect-slow → collect-firms へ分離した際、移動元の削除を忘れると
    # firms が2 workflow で二重収集され、orbis-data への冗長 push と run 浪費を生む。
    # 既存の guard テストは「両方 guarded で層名も正しい」ため二重収集を見逃す＝この不変条件が要る。
    from collections import defaultdict
    by_mod = defaultdict(set)
    for wf, mod, _layers in _collector_steps():
        by_mod[mod].add(wf)
    dups = {mod: sorted(wfs) for mod, wfs in by_mod.items() if len(wfs) > 1}
    assert dups == {}, f"同一 collector が複数 workflow から起動されている（二重収集）: {dups}"


# ── key-gated exit0 規約（2026-07-21 決定・Layer1）の配線を固定する ─────────────
# 敵対検証（5レンズ）で見つかった3つの穴の再発防止：宣言の配線・完全性・停止層除外・
# partial-gate 誤ラップ・秘密漏洩を、機構のサイレント劣化としてテストで捕捉する。
import re as _re
from collectors.lib.keycheck import REQUIRED
from collectors.lib.wf_eligibility import eligible_layers


def test_required_layers_actually_call_key_or_skip():
    # 「宣言（REQUIRED 登録・secret env・key リテラル）」は残したまま key_or_skip 呼び出しだけ
    # 消す退行を捕捉する（＝Layer1 ゲートが死ぬ）。リテラル存在でなく「実際に呼んでいるか」を縛る。
    for layer, key in REQUIRED.items():
        src = open(os.path.join(ROOT, "collectors", f"{layer}.py"), encoding="utf-8").read()
        pat = _re.compile(
            r"key_or_skip\(\s*[\"']" + _re.escape(layer) + r"[\"']\s*,\s*[\"']" + _re.escape(key) + r"[\"']\s*\)"
        )
        assert pat.search(src), (
            f"collectors/{layer}.py が key_or_skip(\"{layer}\", \"{key}\") を呼んでいない"
            f"（旧 os.environ.get 分岐へ戻ると本番でキー失効を検知できない）"
        )


def test_required_is_subset_of_eligible():
    # REQUIRED に載る層は必ず schedule-active ∧ 非 if-gate（本番で定期実行される）＝
    # implement-first/停止層を premature に required 化しない。subset で fail-safe。
    eligible = set(eligible_layers())
    missing = set(REQUIRED) - eligible
    assert not missing, f"REQUIRED だが eligible でない層（停止/if-gate なのに required 化）: {missing}"


def test_required_layers_declare_secret_and_are_guarded():
    # 三者照合：REQUIRED 層は (a) その step で `<KEY>: ${{ secrets.<KEY> }}` を供給し
    # (b) `|| mark_error <layer>` で guard されていること。宣言と配線の整合を機械強制。
    guarded = {mod: layers for _wf, mod, layers in _collector_steps()}
    for layer, key in REQUIRED.items():
        assert layer in guarded and layer in guarded[layer], (
            f"REQUIRED 層 {layer} が || mark_error {layer} で guard されていない"
        )
        declared = any(
            f"{key}: ${{{{ secrets.{key} }}}}" in line
            for path in glob.glob(os.path.join(WORKFLOW_DIR, "*.yml"))
            for line in open(path, encoding="utf-8")
        )
        assert declared, f"REQUIRED 層 {layer} の secret {key} が workflow の env に宣言されていない"


def test_disabled_and_partial_layers_are_not_required():
    # 停止中 Anthropic 層・partial-gate 層を REQUIRED に入れない（不変則3・中核を殺さない）。
    for layer in ("news", "briefing", "forecast", "instability"):
        assert layer not in REQUIRED, f"{layer} は REQUIRED に入れてはならない"


def test_partial_gate_collectors_do_not_call_key_or_skip():
    # forecast/instability は partial-gate＝キーは narrative のみゲートし中核は無キーでも生成する。
    # key_or_skip でラップすると本番キー欠落時に中核ごと殺す＝誤ラップを静的禁止。
    for layer in ("forecast", "instability"):
        src = open(os.path.join(ROOT, "collectors", f"{layer}.py"), encoding="utf-8").read()
        assert "key_or_skip" not in src, (
            f"collectors/{layer}.py は partial-gate ゆえ key_or_skip を呼んではならない"
            f"（無キーでも決定論的中核を書き続ける設計を殺す）"
        )


def test_annotations_interpolate_only_layer_name():
    # ::warning/::notice/::error 注釈と keycheck の警報ログに、層名以外の f-string 補間を許さない。
    # {e}/{url}/{key}/str(exception) 経由で PUBLIC manifest/ログへ秘密が漏れる経路を静的封鎖（不変則4）。
    for rel in ("collectors/lib/mark_error.py", "collectors/lib/keycheck.py"):
        for i, line in enumerate(open(os.path.join(ROOT, rel), encoding="utf-8"), 1):
            if "::warning" in line or "::notice" in line or "::error" in line \
                    or "alerting via mark_error" in line:
                fields = _re.findall(r"\{([^}]*)\}", line)
                bad = [f for f in fields if f not in ("layer",)]
                assert not bad, f"{rel}:{i} 注釈/警報行に層名以外の補間: {bad}"
