"""key_or_skip の3値判定（key-gated exit0 規約の中核）。

判定は env のみ（REQUIRED 登録 AND 本番CI=GITHUB_ACTIONS AND キー空）。
manifest 成功履歴に依存しない＝初回 typo・manifest reset・初回 run でも失効を検知する。
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
import collectors.lib.keycheck as kc


def test_returns_value_when_key_present(monkeypatch):
    # キーがあれば REQUIRED/本番 に関係なく素通しで返す。
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("AISSTREAM_API_KEY", "secret-token")
    assert kc.key_or_skip("ships", "AISSTREAM_API_KEY") == "secret-token"


def test_required_absent_in_production_raises_exit1(monkeypatch):
    # 宣言済み required 鍵が本番CIで空＝供給済みが消えた退行→SystemExit(1)→|| mark_error。
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("AISSTREAM_API_KEY", raising=False)
    with pytest.raises(SystemExit) as exc:
        kc.key_or_skip("ships", "AISSTREAM_API_KEY")
    assert exc.value.code == 1


def test_required_absent_locally_returns_none(monkeypatch):
    # ローカル（GITHUB_ACTIONS 無し）は required でも無言 None＝従来どおり skip。
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    assert kc.key_or_skip("firms", "FIRMS_MAP_KEY") is None


def test_unregistered_layer_absent_in_production_returns_none(monkeypatch):
    # 停止層/implement-first の新層＝REQUIRED 未登録なら本番CIでも無言 None（不変則1・3）。
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert kc.key_or_skip("news", "ANTHROPIC_API_KEY") is None


def test_empty_string_treated_as_absent(monkeypatch):
    # GitHub Actions は未設定 secret を空文字で注入する＝失効も空文字。空文字は「無し」扱い。
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("AISSTREAM_API_KEY", "")
    with pytest.raises(SystemExit) as exc:
        kc.key_or_skip("ships", "AISSTREAM_API_KEY")
    assert exc.value.code == 1


def test_github_actions_must_be_exactly_true(monkeypatch):
    # GITHUB_ACTIONS が 'true' 以外（'false' 等）は本番CIとみなさない＝無言 None。
    monkeypatch.setenv("GITHUB_ACTIONS", "false")
    monkeypatch.delenv("AISSTREAM_API_KEY", raising=False)
    assert kc.key_or_skip("ships", "AISSTREAM_API_KEY") is None


def test_exit_code_is_bare_int_no_message(monkeypatch):
    # SystemExit は int コードのみ＝例外文言経路を開かない（秘密漏洩防止・不変則4）。
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("AISSTREAM_API_KEY", raising=False)
    with pytest.raises(SystemExit) as exc:
        kc.key_or_skip("ships", "AISSTREAM_API_KEY")
    assert isinstance(exc.value.code, int)


def test_alert_log_line_carries_only_layer(monkeypatch, capsys):
    # 警報時のログは層名のみ補間・キーVALUE/例外/URL を載せない。
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("AISSTREAM_API_KEY", "")  # 空＝失効
    with pytest.raises(SystemExit):
        kc.key_or_skip("ships", "AISSTREAM_API_KEY")
    out = capsys.readouterr().out
    assert "[ships]" in out


def test_required_registry_declares_ships_and_firms():
    # 本番で必須の鍵の宣言は yml 文字列でなくこの dict に集約（footgun 根絶）。
    assert kc.REQUIRED == {"ships": "AISSTREAM_API_KEY", "firms": "FIRMS_MAP_KEY"}
