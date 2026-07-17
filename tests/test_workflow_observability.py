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

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW_DIR = os.path.join(ROOT, ".github", "workflows")

# 例: "python -m collectors.gdelt_events || python -m collectors.lib.mark_error conflict protests"
STEP_RE = re.compile(
    r"python -m collectors\.(?P<mod>[a-z_]+)\s*(?:\|\|\s*python -m collectors\.lib\.mark_error(?P<layers>[^\n#]*))?"
)


def _collector_steps():
    """workflow 内の「collector を起動する run 行」を全て拾う。"""
    steps = []
    for path in sorted(glob.glob(os.path.join(WORKFLOW_DIR, "*.yml"))):
        for line in open(path, encoding="utf-8"):
            if "python -m collectors." not in line or line.lstrip().startswith("#"):
                continue
            m = STEP_RE.search(line)
            if not m or m.group("mod") == "lib":
                continue
            layers = (m.group("layers") or "").split()
            steps.append((os.path.basename(path), m.group("mod"), layers))
    return steps


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
