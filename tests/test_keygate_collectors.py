"""key-gated collector の規約準拠の振る舞い（2026-07-21 規約決定・Layer1）。

full-gate REQUIRED 層（ships/firms）＝本番CIでキー欠落→SystemExit(1)（||mark_error で可視化）・
かつスナップショット非書き込み（keep-previous）。ローカルは従来どおり無言 skip。
full-gate 非 REQUIRED 層（停止中 news/briefing）＝本番CIでも無誤報（不変則3）。
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
import collectors.ships as ships
import collectors.firms as firms
import collectors.news as news
import collectors.briefing as briefing


# ── full-gate REQUIRED 層：本番CIでキー欠落→退行として SystemExit(1)、書き込み無し
def test_ships_alerts_in_production_when_key_absent(monkeypatch, tmp_path):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("AISSTREAM_API_KEY", raising=False)
    monkeypatch.setattr(ships, "SNAPSHOT_DIR", str(tmp_path))
    with pytest.raises(SystemExit) as exc:
        ships.main()
    assert exc.value.code == 1
    assert not (tmp_path / "ships.json").exists()  # keep-previous＝書き込まない


def test_ships_silent_locally_when_key_absent(monkeypatch, tmp_path):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.delenv("AISSTREAM_API_KEY", raising=False)
    monkeypatch.setattr(ships, "SNAPSHOT_DIR", str(tmp_path))
    assert ships.main() == 0
    assert not (tmp_path / "ships.json").exists()


def test_firms_alerts_in_production_when_key_absent(monkeypatch, tmp_path):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    monkeypatch.setattr(firms, "SNAPSHOT_DIR", str(tmp_path))
    with pytest.raises(SystemExit) as exc:
        firms.main()
    assert exc.value.code == 1
    assert not (tmp_path / "firms.json").exists()


def test_firms_silent_locally_when_key_absent(monkeypatch, tmp_path):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    monkeypatch.setattr(firms, "SNAPSHOT_DIR", str(tmp_path))
    assert firms.main() is None  # 従来どおり bare return（None）
    assert not (tmp_path / "firms.json").exists()


# ── full-gate 非 REQUIRED 層（停止中）：本番CIでも無誤報＝不変則3
def test_news_silent_in_production_when_key_absent(monkeypatch, tmp_path):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(news, "SNAPSHOT_DIR", str(tmp_path))
    assert news.main() == 0
    assert not (tmp_path / "news.json").exists()


def test_briefing_silent_in_production_when_key_absent(monkeypatch, tmp_path):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(briefing, "SNAPSHOT_DIR", str(tmp_path))
    assert briefing.main() == 0
    assert not (tmp_path / "briefing.json").exists()
