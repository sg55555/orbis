"""anthropic SDK のシグネチャ漂流で LLM 3層が静かに壊れるのを防ぐ回帰テスト。

背景（2026-08-23）:
  anthropic SDK v1.0.0（2026-08-20）が `Messages.create()` から
  `temperature` / `top_p` / `top_k` を削除した。requirements が非固定だったため
  briefing / instability / forecast が `TypeError` で落ちた。
  一方 sonnet-4-6 / haiku-4-5 は API 側では今もこれらを受け付けるので、
  「引数を消す」直し方は temperature=0 → 既定値に変え、生成の決定性を静かに失う。
  正しい経路は MIGRATION.md が案内する `extra_body`（旧版でも同じボディになる）。
"""
import ast
import inspect
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
LLM_COLLECTORS = ["briefing.py", "instability.py", "forecast.py"]
SAMPLING = {"temperature", "top_p", "top_k"}


def _create_calls(path):
    """collectors/*.py 内の client.messages.create(...) 呼び出しを全部返す。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    calls = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "create"
            and isinstance(node.func.value, ast.Attribute)
            and node.func.value.attr == "messages"
        ):
            calls.append(node)
    return calls


@pytest.mark.parametrize("name", LLM_COLLECTORS)
def test_sampling_params_go_through_extra_body(name):
    """サンプリング指定は直接キーワードでなく extra_body で渡す。"""
    path = ROOT / "collectors" / name
    calls = _create_calls(path)
    assert calls, f"{name}: messages.create() の呼び出しが見つからない"
    for call in calls:
        kwargs = {kw.arg: kw.value for kw in call.keywords if kw.arg}
        bad = SAMPLING & set(kwargs)
        assert not bad, (
            f"{name}: {sorted(bad)} を create() に直接渡している。"
            " SDK v1.0.0 以降は TypeError になるので extra_body={{...}} を使う"
        )
        extra = kwargs.get("extra_body")
        assert isinstance(extra, ast.Dict), (
            f"{name}: extra_body={{'temperature': 0}} が無い。"
            " 引数を消すだけだと決定性が既定値に戻る"
        )
        keys = {k.value for k in extra.keys if isinstance(k, ast.Constant)}
        assert "temperature" in keys, f"{name}: extra_body に temperature が無い"


def test_installed_sdk_accepts_what_we_pass():
    """インストール済み SDK の実シグネチャと突き合わせる（漂流の早期検知）。

    grep や構文チェックでは通ってしまう TypeError を、実 import で捕まえる。
    """
    anthropic = pytest.importorskip("anthropic")
    from anthropic.resources.messages import Messages

    params = set(inspect.signature(Messages.create).parameters)
    assert "extra_body" in params, (
        f"anthropic {anthropic.__version__}: extra_body が create() に無い。"
        " サンプリング指定の受け渡し経路を見直すこと"
    )
    for name in LLM_COLLECTORS:
        for call in _create_calls(ROOT / "collectors" / name):
            for kw in call.keywords:
                if kw.arg:
                    assert kw.arg in params, (
                        f"{name}: create() に渡している {kw.arg!r} が"
                        f" anthropic {anthropic.__version__} のシグネチャに無い"
                    )
