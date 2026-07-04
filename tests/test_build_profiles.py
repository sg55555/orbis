"""最終レビュー Fix2/Fix3 のユニットテスト（scripts/build_profiles.py）。
実 API/実 HTTP は一切呼ばない — anthropic は sys.modules にフェイクを差し込んで検証する。
Fix1（js/ui/drilldown.js の belongs_to リンク配線）は JS 側 tests/profile_render.test.js を参照。
"""
import sys
import types
from types import SimpleNamespace

from scripts import build_profiles


# ---------------------------------------------------------------------------
# Fix3: level 別 max_tokens
# ---------------------------------------------------------------------------

def test_max_tokens_for_cid_country_is_raised_to_4000():
    assert build_profiles._max_tokens_for_cid("country:US") == 4000


def test_max_tokens_for_cid_admin1_is_2500():
    assert build_profiles._max_tokens_for_cid("admin1:JP-13") == 2500


def test_max_tokens_for_cid_city_is_2500():
    assert build_profiles._max_tokens_for_cid("city:Q1490") == 2500


def test_max_tokens_for_cid_unknown_level_falls_back_to_default():
    assert build_profiles._max_tokens_for_cid("mystery:XX") == build_profiles.DEFAULT_MAX_TOKENS


# ---------------------------------------------------------------------------
# Fix2: PASS1 の custom_id 重複ガード（dedupe + warn、run は止めない）
# ---------------------------------------------------------------------------

def test_pass1_prepare_skips_duplicate_custom_id_and_warns(monkeypatch, capsys):
    # admin1 の pid フォールバック衝突を模す: 2つの異なる地域が同じ (level,pid) → 同じ custom_id になるケース。
    fake_entity = {"sitelinks": {"jawiki": {"title": "テスト記事"}}}  # claims 無し = named_props は
    # label_resolver を呼ばない（実 HTTP 不要）。

    monkeypatch.setattr(build_profiles, "fetch_wikidata", lambda qid: fake_entity)
    monkeypatch.setattr(build_profiles, "fetch_article_plaintext", lambda title: "本文プレースホルダー")
    # extract_sections の節抽出ヒューリスティックはここでは対象外（他テストが担保）＝恒等関数に差し替え
    monkeypatch.setattr(build_profiles, "extract_sections", lambda text, **kw: text)

    items = [
        ("admin1", "JP-13", "東京都", "Q1490", {"level": "country", "id": "JP", "name_ja": "日本"}),
        # 同じ (level="admin1", pid="JP-13") = 同じ custom_id "admin1:JP-13" になる衝突ケース
        ("admin1", "JP-13", "重複ダミー県", "Q9999999", {"level": "country", "id": "JP", "name_ja": "日本"}),
    ]

    immediate, prompts, pending = build_profiles._pass1_prepare(items, "2026-07-04")

    assert immediate == [], "両方とも qid あり・section_text ありで prompts 側に進むはず"
    assert len(prompts) == 1, "重複 custom_id は2件目をスキップし1件だけ prompts に入る"
    assert prompts[0][0] == "admin1:JP-13"
    assert list(pending.keys()) == ["admin1:JP-13"]
    # スキップされたのは2件目（重複ダミー県）で、pending には1件目（東京都）のデータが残る
    assert pending["admin1:JP-13"]["name_ja"] == "東京都"

    err = capsys.readouterr().out
    assert "WARN" in err
    assert "admin1:JP-13" in err
    assert "重複ダミー県" in err, "どの地域が衝突でスキップされたかログで分かること"


def test_pass1_prepare_distinct_custom_ids_both_kept(monkeypatch):
    # 対照実験: pid が異なれば両方とも prompts に残る（dedupe が過剰に効かないこと）
    fake_entity = {"sitelinks": {"jawiki": {"title": "テスト記事"}}}
    monkeypatch.setattr(build_profiles, "fetch_wikidata", lambda qid: fake_entity)
    monkeypatch.setattr(build_profiles, "fetch_article_plaintext", lambda title: "本文プレースホルダー")
    monkeypatch.setattr(build_profiles, "extract_sections", lambda text, **kw: text)

    items = [
        ("admin1", "JP-13", "東京都", "Q1490", {"level": "country", "id": "JP", "name_ja": "日本"}),
        ("admin1", "JP-14", "神奈川県", "Q1491", {"level": "country", "id": "JP", "name_ja": "日本"}),
    ]
    immediate, prompts, pending = build_profiles._pass1_prepare(items, "2026-07-04")
    assert len(prompts) == 2
    assert {cid for cid, _ in prompts} == {"admin1:JP-13", "admin1:JP-14"}
    assert set(pending.keys()) == {"admin1:JP-13", "admin1:JP-14"}


# ---------------------------------------------------------------------------
# Fix3: run_batch — Request に level 別 max_tokens が反映される／stop_reason=="max_tokens" を warn する
# ---------------------------------------------------------------------------

def _install_fake_anthropic(monkeypatch, *, results):
    """anthropic / anthropic.types.message_create_params / anthropic.types.messages.batch_create_params
    を sys.modules に差し込む。実 API は一切呼ばない（batches.create/retrieve/results は全部フェイク）。
    Request/MessageCreateParamsNonStreaming は本物同様「呼ぶと dict を返す」形（TypedDict 相当）にする。
    captured['reqs'] に client.messages.batches.create に渡された requests を捕捉する。
    """
    captured = {"reqs": None}

    class _FakeBatches:
        def create(self, requests):
            captured["reqs"] = requests
            return SimpleNamespace(id="batch-fake-1")

        def retrieve(self, batch_id):
            return SimpleNamespace(processing_status="ended")  # 即終了扱い＝ポーリング sleep を回避

        def results(self, batch_id):
            return results

    class _FakeAnthropicClient:
        def __init__(self, *a, **kw):
            self.messages = SimpleNamespace(batches=_FakeBatches())

    anthropic_mod = types.ModuleType("anthropic")
    anthropic_mod.Anthropic = _FakeAnthropicClient

    types_mod = types.ModuleType("anthropic.types")
    mccp_mod = types.ModuleType("anthropic.types.message_create_params")
    mccp_mod.MessageCreateParamsNonStreaming = lambda **kw: dict(kw)

    messages_mod = types.ModuleType("anthropic.types.messages")
    bcp_mod = types.ModuleType("anthropic.types.messages.batch_create_params")
    bcp_mod.Request = lambda **kw: dict(kw)

    for name, mod in [
        ("anthropic", anthropic_mod),
        ("anthropic.types", types_mod),
        ("anthropic.types.message_create_params", mccp_mod),
        ("anthropic.types.messages", messages_mod),
        ("anthropic.types.messages.batch_create_params", bcp_mod),
    ]:
        monkeypatch.setitem(sys.modules, name, mod)

    return captured


def _fake_result(custom_id, *, stop_reason, text="本文テキスト"):
    return SimpleNamespace(
        custom_id=custom_id,
        result=SimpleNamespace(
            type="succeeded",
            message=SimpleNamespace(
                stop_reason=stop_reason,
                content=[SimpleNamespace(type="text", text=text)],
            ),
        ),
    )


def test_run_batch_sends_level_specific_max_tokens_in_requests(monkeypatch):
    prompts = [("country:US", "prompt-us"), ("admin1:JP-13", "prompt-tokyo"), ("city:Q1490", "prompt-tokyo-city")]
    fake_results = [
        _fake_result("country:US", stop_reason="end_turn"),
        _fake_result("admin1:JP-13", stop_reason="end_turn"),
        _fake_result("city:Q1490", stop_reason="end_turn"),
    ]
    captured = _install_fake_anthropic(monkeypatch, results=fake_results)

    build_profiles.run_batch(prompts)

    reqs_by_cid = {r["custom_id"]: r["params"]["max_tokens"] for r in captured["reqs"]}
    assert reqs_by_cid["country:US"] == 4000, "country は truncate 回避のため引き上げ"
    assert reqs_by_cid["admin1:JP-13"] == 2500
    assert reqs_by_cid["city:Q1490"] == 2500


def test_run_batch_warns_on_max_tokens_stop_reason(monkeypatch, capsys):
    prompts = [("country:US", "prompt-us"), ("admin1:JP-13", "prompt-tokyo")]
    fake_results = [
        _fake_result("country:US", stop_reason="max_tokens", text="途中で切れた本文"),
        _fake_result("admin1:JP-13", stop_reason="end_turn"),
    ]
    _install_fake_anthropic(monkeypatch, results=fake_results)

    out = build_profiles.run_batch(prompts)

    # truncate されても本文は out に残す（呼び出し元の parse_profile_v2/degraded 判定に委ねる）
    assert out["country:US"] == "途中で切れた本文"
    assert out["admin1:JP-13"] == "本文テキスト"

    printed = capsys.readouterr().out
    warn_lines = [ln for ln in printed.splitlines() if "WARN" in ln]
    assert len(warn_lines) == 1, "truncate された1件だけ warn する（end_turn 側は警告しない）"
    assert "country:US" in warn_lines[0], "どの custom_id が truncate されたか分かること"
