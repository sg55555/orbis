"""最終レビュー Fix2/Fix3、および 8c 品質ゲート修正（レート制限キャッシュ汚染バグ）の
ユニットテスト（scripts/build_profiles.py）。
実 API/実 HTTP は一切呼ばない — anthropic は sys.modules にフェイクを差し込んで検証する。
requests は build_profiles.requests.get を monkeypatch で差し替えてモックする。
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
    assert build_profiles._max_tokens_for_cid("country_US") == 8000


def test_max_tokens_for_cid_admin1_is_2500():
    assert build_profiles._max_tokens_for_cid("admin1_JP-13") == 6000


def test_max_tokens_for_cid_city_is_2500():
    assert build_profiles._max_tokens_for_cid("city_Q1490") == 6000


def test_max_tokens_for_cid_unknown_level_falls_back_to_default():
    assert build_profiles._max_tokens_for_cid("mystery_XX") == build_profiles.DEFAULT_MAX_TOKENS


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
        # 同じ (level="admin1", pid="JP-13") = 同じ custom_id "admin1_JP-13" になる衝突ケース
        ("admin1", "JP-13", "重複ダミー県", "Q9999999", {"level": "country", "id": "JP", "name_ja": "日本"}),
    ]

    immediate, prompts, pending = build_profiles._pass1_prepare(items, "2026-07-04")

    assert immediate == [], "両方とも qid あり・section_text ありで prompts 側に進むはず"
    assert len(prompts) == 1, "重複 custom_id は2件目をスキップし1件だけ prompts に入る"
    assert prompts[0][0] == "admin1_JP-13"
    assert list(pending.keys()) == ["admin1_JP-13"]
    # スキップされたのは2件目（重複ダミー県）で、pending には1件目（東京都）のデータが残る
    assert pending["admin1_JP-13"]["name_ja"] == "東京都"

    err = capsys.readouterr().out
    assert "WARN" in err
    assert "admin1_JP-13" in err
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
    assert {cid for cid, _ in prompts} == {"admin1_JP-13", "admin1_JP-14"}
    assert set(pending.keys()) == {"admin1_JP-13", "admin1_JP-14"}


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
    prompts = [("country_US", "prompt-us"), ("admin1_JP-13", "prompt-tokyo"), ("city_Q1490", "prompt-tokyo-city")]
    fake_results = [
        _fake_result("country_US", stop_reason="end_turn"),
        _fake_result("admin1_JP-13", stop_reason="end_turn"),
        _fake_result("city_Q1490", stop_reason="end_turn"),
    ]
    captured = _install_fake_anthropic(monkeypatch, results=fake_results)

    build_profiles.run_batch(prompts)

    reqs_by_cid = {r["custom_id"]: r["params"]["max_tokens"] for r in captured["reqs"]}
    assert reqs_by_cid["country_US"] == 8000, "country は truncate 回避のため引き上げ"
    assert reqs_by_cid["admin1_JP-13"] == 6000
    assert reqs_by_cid["city_Q1490"] == 6000


def test_run_batch_warns_on_max_tokens_stop_reason(monkeypatch, capsys):
    prompts = [("country_US", "prompt-us"), ("admin1_JP-13", "prompt-tokyo")]
    fake_results = [
        _fake_result("country_US", stop_reason="max_tokens", text="途中で切れた本文"),
        _fake_result("admin1_JP-13", stop_reason="end_turn"),
    ]
    _install_fake_anthropic(monkeypatch, results=fake_results)

    out = build_profiles.run_batch(prompts)

    # truncate されても本文は out に残す（呼び出し元の parse_profile_v2/degraded 判定に委ねる）
    assert out["country_US"] == "途中で切れた本文"
    assert out["admin1_JP-13"] == "本文テキスト"

    printed = capsys.readouterr().out
    warn_lines = [ln for ln in printed.splitlines() if "WARN" in ln]
    assert len(warn_lines) == 1, "truncate された1件だけ warn する（end_turn 側は警告しない）"
    assert "country_US" in warn_lines[0], "どの custom_id が truncate されたか分かること"


# ---------------------------------------------------------------------------
# 8c 品質ゲート修正: レート制限(429)で空応答が無条件キャッシュされ以後ずっと degraded のまま
# になるバグの回帰テスト。requests.get を monkeypatch でモックし実 HTTP は呼ばない。
# ---------------------------------------------------------------------------

class _FakeResponse:
    """requests.Response の最小フェイク。429 は _get_with_retry が status_code を見て検出するので
    raise_for_status() 自体は 400 以上でのみ例外を投げる（本物の requests と同じ挙動）。"""

    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json_data = json_data if json_data is not None else {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise build_profiles.requests.exceptions.HTTPError(f"status {self.status_code}")

    def json(self):
        return self._json_data


def _no_cache(monkeypatch, put_calls=None):
    """_cache_get を常に miss にし、_cache_put 呼び出しを put_calls（list）に記録する spy に差し替える。"""
    if put_calls is None:
        put_calls = []
    monkeypatch.setattr(build_profiles, "_cache_get", lambda name: None)
    monkeypatch.setattr(build_profiles, "_cache_put", lambda name, obj: put_calls.append((name, obj)))
    monkeypatch.setattr(build_profiles.time, "sleep", lambda s: None)  # バックオフの実待機を排除
    return put_calls


def test_fetch_article_plaintext_retries_after_429_then_succeeds_and_caches(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None, headers=None):
        calls["n"] += 1
        if calls["n"] < 3:
            return _FakeResponse(status_code=429)
        return _FakeResponse(status_code=200, json_data={
            "query": {"pages": {"123": {"extract": "本文サンプル"}}}
        })

    monkeypatch.setattr(build_profiles.requests, "get", fake_get)
    put_calls = _no_cache(monkeypatch)

    text = build_profiles.fetch_article_plaintext("テスト記事")

    assert text == "本文サンプル"
    assert calls["n"] == 3, "429を2回リトライし3回目で成功する"
    assert put_calls == [("v2_wp_" + build_profiles.hashlib.md5("テスト記事".encode("utf-8")).hexdigest()
                           + ".json", {"text": "本文サンプル"})], "成功時は1回だけキャッシュされる"


def test_fetch_article_plaintext_gives_up_after_max_retries_without_caching(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None, headers=None):
        calls["n"] += 1
        return _FakeResponse(status_code=429)  # 常にレート制限

    monkeypatch.setattr(build_profiles.requests, "get", fake_get)
    put_calls = _no_cache(monkeypatch)

    text = build_profiles.fetch_article_plaintext("テスト記事2")

    assert text == ""
    assert calls["n"] == build_profiles.FETCH_MAX_RETRIES, "上限回数までリトライして諦める"
    assert put_calls == [], "レート制限で失敗した空文字はキャッシュしない（次回再取得できるように）"


def test_fetch_article_plaintext_success_caches_and_second_call_hits_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(build_profiles, "CACHE", str(tmp_path))  # 実キャッシュディレクトリを汚さない
    monkeypatch.setattr(build_profiles.time, "sleep", lambda s: None)
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None, headers=None):
        calls["n"] += 1
        return _FakeResponse(status_code=200, json_data={
            "query": {"pages": {"1": {"extract": "正常本文"}}}
        })

    monkeypatch.setattr(build_profiles.requests, "get", fake_get)

    text1 = build_profiles.fetch_article_plaintext("正常記事")
    assert text1 == "正常本文"
    assert calls["n"] == 1

    text2 = build_profiles.fetch_article_plaintext("正常記事")
    assert text2 == "正常本文"
    assert calls["n"] == 1, "2回目はキャッシュ hit で requests.get は呼ばれない"


def test_fetch_wikidata_props_retries_after_429_then_succeeds_and_caches(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None, headers=None):
        calls["n"] += 1
        if calls["n"] < 2:
            return _FakeResponse(status_code=429)
        return _FakeResponse(status_code=200, json_data={
            "entities": {"Q1490": {"labels": {"ja": {"value": "東京都"}}}}
        })

    monkeypatch.setattr(build_profiles.requests, "get", fake_get)
    put_calls = _no_cache(monkeypatch)

    out = build_profiles.fetch_wikidata_props(["Q1490"])

    assert out == {"Q1490": "東京都"}
    assert calls["n"] == 2, "429を1回リトライし2回目で成功する"
    assert put_calls == [("v2_label_Q1490.json", {"label": "東京都"})]


def test_fetch_wikidata_props_gives_up_after_max_retries_without_caching(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None, headers=None):
        calls["n"] += 1
        return _FakeResponse(status_code=429)  # 常にレート制限

    monkeypatch.setattr(build_profiles.requests, "get", fake_get)
    put_calls = _no_cache(monkeypatch)

    out = build_profiles.fetch_wikidata_props(["Q1490", "Q9999"])

    assert out == {"Q1490": None, "Q9999": None}, "chunk 取得失敗時は全 QID が None"
    assert calls["n"] == build_profiles.FETCH_MAX_RETRIES, "chunk 単位で1リクエストをリトライする"
    assert put_calls == [], "レート制限で chunk 取得に失敗した場合はどの QID もキャッシュしない"
