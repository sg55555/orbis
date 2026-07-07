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
    monkeypatch.setattr(build_profiles, "_gen_cache_get", lambda cid: None)  # cache-miss を固定

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
    monkeypatch.setattr(build_profiles, "_gen_cache_get", lambda cid: None)  # cache-miss を固定

    items = [
        ("admin1", "JP-13", "東京都", "Q1490", {"level": "country", "id": "JP", "name_ja": "日本"}),
        ("admin1", "JP-14", "神奈川県", "Q1491", {"level": "country", "id": "JP", "name_ja": "日本"}),
    ]
    immediate, prompts, pending = build_profiles._pass1_prepare(items, "2026-07-04")
    assert len(prompts) == 2
    assert {cid for cid, _ in prompts} == {"admin1_JP-13", "admin1_JP-14"}
    assert set(pending.keys()) == {"admin1_JP-13", "admin1_JP-14"}


def test_pass1_prepare_gen_cache_hit_skips_fetch_and_batch(monkeypatch):
    # キャッシュヒット地域は fetch_wikidata も呼ばれず prompts にも入らない（即 immediate）。
    cached = {"id": "JP-13", "level": "admin1", "degraded": False, "layers": [{"key": "geo"}]}
    monkeypatch.setattr(build_profiles, "_gen_cache_get",
                        lambda cid: cached if cid == "admin1_JP-13" else None)

    def _boom(qid):
        raise AssertionError("cache ヒット地域で fetch_wikidata が呼ばれてはいけない")
    monkeypatch.setattr(build_profiles, "fetch_wikidata", _boom)

    items = [("admin1", "JP-13", "東京都", "Q1490",
              {"level": "country", "id": "JP", "name_ja": "日本"})]
    immediate, prompts, pending = build_profiles._pass1_prepare(items, "2026-07-05")
    assert prompts == []
    assert pending == {}
    assert immediate == [("admin1", "JP-13", cached)]


def test_pass1_prepare_mixed_cache_bills_only_uncached(monkeypatch):
    # 金額不変条件のロック: キャッシュヒット1件＋キャッシュミス1件が混在するとき、
    # 課金対象の prompts/pending に入るのはミス側のみ・ヒット側は絶対に prompts に入らない
    # （run_batch(prompts) が課金するので、ここでの選別ミスは実際の二重課金に直結する）。
    cached = {"id": "JP-13", "level": "admin1", "degraded": False, "layers": [{"key": "geo"}]}
    monkeypatch.setattr(build_profiles, "_gen_cache_get",
                        lambda cid: cached if cid == "admin1_JP-13" else None)
    fake_entity = {"sitelinks": {"jawiki": {"title": "テスト記事"}}}
    monkeypatch.setattr(build_profiles, "fetch_wikidata", lambda qid: fake_entity)
    monkeypatch.setattr(build_profiles, "fetch_article_plaintext", lambda title: "本文プレースホルダー")
    monkeypatch.setattr(build_profiles, "extract_sections", lambda text, **kw: text)

    items = [
        ("admin1", "JP-13", "東京都", "Q1490", {"level": "country", "id": "JP", "name_ja": "日本"}),   # cache HIT
        ("admin1", "JP-14", "神奈川県", "Q1491", {"level": "country", "id": "JP", "name_ja": "日本"}),  # cache MISS → billed
    ]
    immediate, prompts, pending = build_profiles._pass1_prepare(items, "2026-07-05")
    billed = {cid for cid, _ in prompts}
    assert billed == {"admin1_JP-14"}, "課金対象(prompts)は未キャッシュのみ"
    assert "admin1_JP-14" in pending
    assert ("admin1", "JP-13", cached) in immediate  # ヒットはimmediateへ(課金しない)
    assert "admin1_JP-13" not in billed


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


def test_fetch_wikidata_props_maxlag_error_key_not_cached(monkeypatch):
    # MediaWiki 高負荷: HTTP 200 だが body に top-level "error"（maxlag 等）→ "entities" 欠落
    def fake_get(url, params=None, timeout=None, headers=None):
        return _FakeResponse(status_code=200, json_data={
            "error": {"code": "maxlag", "info": "Waiting for a database server"}
        })

    monkeypatch.setattr(build_profiles.requests, "get", fake_get)
    put_calls = _no_cache(monkeypatch)

    out = build_profiles.fetch_wikidata_props(["Q1490"])

    assert out == {"Q1490": None}, "error 応答は失敗扱いで None"
    assert put_calls == [], "maxlag error 応答はキャッシュしない（次回再取得）"


# ---------------------------------------------------------------------------
# Critical: fetch_wikidata（v1関数だが v2 の本番ホットパス）も同じ契約に。
# レート制限で entity=None を永久キャッシュ→degraded 永久固定するバグの回帰テスト。
# ---------------------------------------------------------------------------

def test_fetch_wikidata_retries_after_429_then_succeeds_and_caches(monkeypatch):
    calls = {"n": 0}
    entity = {"claims": {}, "sitelinks": {"jawiki": {"title": "東京都"}}}

    def fake_get(url, params=None, timeout=None, headers=None):
        calls["n"] += 1
        if calls["n"] < 3:
            return _FakeResponse(status_code=429)
        return _FakeResponse(status_code=200, json_data={"entities": {"Q1490": entity}})

    monkeypatch.setattr(build_profiles.requests, "get", fake_get)
    put_calls = _no_cache(monkeypatch)

    got = build_profiles.fetch_wikidata("Q1490")

    assert got == entity
    assert calls["n"] == 3, "429を2回リトライし3回目で成功する"
    assert put_calls == [("wd_Q1490.json", {"entity": entity})], "成功時のみ1回キャッシュ"


# ---------------------------------------------------------------------------
# 国 QID 解決の ISO_A2_EH フォールバック（NE が ISO_A2 を汚す国 = 台湾/ノルウェー/
# コソボ/フランス/係争領土 の country レベルが qid=None → 永続 degraded になるバグの回帰）。
# NE admin0 は台湾を ISO_A2="CN-TW"（中国主張表記）とし ISO_A2_EH="TW" を持つ。
# ---------------------------------------------------------------------------

def _admin0_feat(**props):
    return {"properties": props}


def test_country_qid_uses_iso_a2_eh_fallback_for_taiwan():
    # ISO_A2 が汚れている（"CN-TW"）ため FIPS_OF_ISO で引けず、EH="TW" で Q865 を TW に紐づける。
    feats = [_admin0_feat(ISO_A2="CN-TW", ISO_A2_EH="TW", WIKIDATAID="Q865")]
    assert build_profiles._country_qid_by_fips(feats)["TW"] == "Q865"


def test_country_qid_clean_iso_a2_unchanged():
    # 正常な2文字 ISO_A2 は従来どおり解決（回帰ガード）: 日本 JP→FIPS JA。
    feats = [_admin0_feat(ISO_A2="JP", ISO_A2_EH="JP", WIKIDATAID="Q17")]
    assert build_profiles._country_qid_by_fips(feats)["JA"] == "Q17"


def test_country_qid_mainland_wins_over_eh_territory_regardless_of_order():
    # 本土(clean ISO_A2="AU") と 係争領土(dirty ISO_A2="-99", EH="AU") は同じ FIPS "AS" に落ちる。
    # 2パス（clean 先→EH 補完 setdefault）で、feature 順に関わらず本土 QID が勝つ。
    mainland = _admin0_feat(ISO_A2="AU", ISO_A2_EH="AU", WIKIDATAID="Q408")
    territory = _admin0_feat(ISO_A2="-99", ISO_A2_EH="AU", WIKIDATAID="Q4824275")
    assert build_profiles._country_qid_by_fips([territory, mainland])["AS"] == "Q408"
    assert build_profiles._country_qid_by_fips([mainland, territory])["AS"] == "Q408"


def test_country_qid_sovereign_wins_over_subregion_sharing_same_fips():
    # オーランド(AX)とフィンランド(FI)は FIPS_OF_ISO で共に FIPS "FI" に落ちる（AX は FI の下位地域）。
    # 両方とも clean な2文字 ISO_A2 のため配列順では Åland(Q5689) が先勝ちし得るが、
    # 主権国(ADMIN==SOVEREIGNT)のフィンランドを優先して FI→Q33 に解決する（Åland が先頭でも）。
    aland = _admin0_feat(ISO_A2="AX", ISO_A2_EH="AX", WIKIDATAID="Q5689", ADMIN="Aland", SOVEREIGNT="Finland")
    finland = _admin0_feat(ISO_A2="FI", ISO_A2_EH="FI", WIKIDATAID="Q33", ADMIN="Finland", SOVEREIGNT="Finland")
    assert build_profiles._country_qid_by_fips([aland, finland])["FI"] == "Q33"
    assert build_profiles._country_qid_by_fips([finland, aland])["FI"] == "Q33"


def test_fetch_wikidata_gives_up_after_max_retries_without_caching(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None, headers=None):
        calls["n"] += 1
        return _FakeResponse(status_code=429)  # 常にレート制限

    monkeypatch.setattr(build_profiles.requests, "get", fake_get)
    put_calls = _no_cache(monkeypatch)

    got = build_profiles.fetch_wikidata("Q1490")

    assert got is None
    assert calls["n"] == build_profiles.FETCH_MAX_RETRIES, "上限までリトライして諦める"
    assert put_calls == [], "レート制限で得た None は永久キャッシュしない（degraded 永久固定を防ぐ）"


def test_fetch_wikidata_maxlag_error_key_not_cached(monkeypatch):
    def fake_get(url, params=None, timeout=None, headers=None):
        return _FakeResponse(status_code=200, json_data={
            "error": {"code": "maxlag", "info": "Waiting for a database server"}
        })

    monkeypatch.setattr(build_profiles.requests, "get", fake_get)
    put_calls = _no_cache(monkeypatch)

    got = build_profiles.fetch_wikidata("Q1490")

    assert got is None, "error 応答は失敗扱いで None"
    assert put_calls == [], "maxlag error 応答はキャッシュしない（次回再取得）"


# ---------------------------------------------------------------------------
# 2.5c: v2 生成キャッシュ ヘルパ（成功のみキャッシュ・degraded 非キャッシュ）
# ---------------------------------------------------------------------------

def test_gen_cache_name_sanitizes_cid():
    assert build_profiles._gen_cache_name("city_Q1490") == "v2_prof_city_Q1490.json"
    assert build_profiles._gen_cache_name("admin1_JP-13") == "v2_prof_admin1_JP-13.json"
    # ファイル名に使えない文字は _ に潰す（防御的正規化）
    assert build_profiles._gen_cache_name("x/y z") == "v2_prof_x_y_z.json"


def test_gen_cache_put_writes_only_success(monkeypatch):
    puts = []
    monkeypatch.setattr(build_profiles, "_cache_put", lambda name, obj: puts.append((name, obj)))
    ok = {"id": "JA", "level": "country", "degraded": False, "layers": [{"key": "geo"}]}
    build_profiles._gen_cache_put("country_JA", ok)
    assert puts == [("v2_prof_country_JA.json", ok)]


def test_gen_cache_put_skips_degraded(monkeypatch):
    puts = []
    monkeypatch.setattr(build_profiles, "_cache_put", lambda name, obj: puts.append((name, obj)))
    bad = {"id": "JP-99", "level": "admin1", "degraded": True, "layers": []}
    build_profiles._gen_cache_put("admin1_JP-99", bad)
    assert puts == [], "degraded は保存せず次回再生成させる"


def test_gen_cache_get_returns_cached_success(monkeypatch):
    ok = {"id": "JA", "degraded": False, "layers": [{"key": "geo"}]}
    monkeypatch.setattr(build_profiles, "_cache_get",
                        lambda name: ok if name == "v2_prof_country_JA.json" else None)
    assert build_profiles._gen_cache_get("country_JA") is ok


def test_gen_cache_get_none_on_degraded_or_miss(monkeypatch):
    monkeypatch.setattr(build_profiles, "_cache_get", lambda name: {"degraded": True})
    assert build_profiles._gen_cache_get("country_JA") is None  # 防御的（本来 put されない）
    monkeypatch.setattr(build_profiles, "_cache_get", lambda name: None)
    assert build_profiles._gen_cache_get("country_JA") is None  # miss


def test_write_all_builds_manifest_and_caches_each(monkeypatch, tmp_path):
    monkeypatch.setattr(build_profiles, "OUT", str(tmp_path))
    put_cids = []
    monkeypatch.setattr(build_profiles, "_gen_cache_put",
                        lambda cid, prof: put_cids.append(cid))
    finished = [
        ("country", "JA", {"id": "JA", "degraded": False, "layers": [{"key": "geo"}]}),
        ("admin1", "JP-13", {"id": "JP-13", "degraded": True, "layers": []}),
        ("city", "Q1490", {"id": "Q1490", "degraded": False, "layers": [{"key": "geo"}]}),
    ]
    manifest = build_profiles._write_all(finished)

    # manifest は level 別に degraded フラグ付きで全件入る
    assert manifest["country"]["JA"]["degraded"] is False
    assert manifest["admin1"]["JP-13"]["degraded"] is True
    assert manifest["city"]["Q1490"]["degraded"] is False
    assert isinstance(manifest["country"]["JA"]["bytes"], int)
    # _gen_cache_put は全 finished で呼ばれる（degraded skip は _gen_cache_put 内部＝Task1で担保）
    assert put_cids == ["country_JA", "admin1_JP-13", "city_Q1490"]
    # country は非 gz、admin1/city は gz で書かれる
    assert (tmp_path / "country" / "JA.json").exists()
    assert (tmp_path / "admin1" / "JP-13.json.gz").exists()
    assert (tmp_path / "city" / "Q1490.json.gz").exists()


def test_merge_manifest_keeps_other_regions(monkeypatch):
    existing = {
        "country": {"US": {"bytes": 10, "degraded": False}},
        "admin1": {"US-CA": {"bytes": 5, "degraded": False}},
        "city": {},
    }
    current = {
        "country": {"JA": {"bytes": 20, "degraded": False}},
        "admin1": {},
        "city": {"Q1490": {"bytes": 7, "degraded": False}},
    }
    merged = build_profiles.merge_manifest(existing, current)
    assert set(merged["country"]) == {"US", "JA"}          # 他国(US)を温存
    assert merged["country"]["JA"]["bytes"] == 20          # 新規(JA)を追加
    assert merged["admin1"]["US-CA"]["bytes"] == 5         # 既存 admin1 温存
    assert merged["city"]["Q1490"]["bytes"] == 7


def test_merge_manifest_current_overwrites_same_id():
    existing = {"country": {"JA": {"bytes": 1, "degraded": True}}, "admin1": {}, "city": {}}
    current = {"country": {"JA": {"bytes": 99, "degraded": False}}, "admin1": {}, "city": {}}
    merged = build_profiles.merge_manifest(existing, current)
    assert merged["country"]["JA"] == {"bytes": 99, "degraded": False}  # 再生成で degraded 解消を反映


def test_write_manifest_merges_existing_file(monkeypatch, tmp_path):
    monkeypatch.setattr(build_profiles, "ROOT", str(tmp_path))
    (tmp_path / "data" / "static").mkdir(parents=True)
    (tmp_path / "data" / "static" / "profiles_manifest.json").write_text(
        '{"country":{"US":{"bytes":10,"degraded":false}},"admin1":{},"city":{}}',
        encoding="utf-8")
    build_profiles._write_manifest(
        {"country": {"JA": {"bytes": 20, "degraded": False}}, "admin1": {}, "city": {}},
        ["JA"])
    import json as _json
    data = _json.loads((tmp_path / "data" / "static" / "profiles_manifest.json").read_text())
    assert set(data["country"]) == {"US", "JA"}, "日本のみ実行でも他国(US)が残る"


# ---------------------------------------------------------------------------
# Task 5: fetch レート緩和（_fetch_sleep env + FETCH_MAX_RETRIES 4→6）
# ---------------------------------------------------------------------------

def test_fetch_sleep_default(monkeypatch):
    monkeypatch.delenv("PROFILE_FETCH_SLEEP", raising=False)
    assert build_profiles._fetch_sleep() == 0.5
    assert build_profiles._fetch_sleep(2) == 1.0  # 重い endpoint は ×2


def test_fetch_sleep_env_override(monkeypatch):
    monkeypatch.setenv("PROFILE_FETCH_SLEEP", "1.0")
    assert build_profiles._fetch_sleep() == 1.0
    assert build_profiles._fetch_sleep(2) == 2.0


def test_fetch_max_retries_raised():
    assert build_profiles.FETCH_MAX_RETRIES == 6
