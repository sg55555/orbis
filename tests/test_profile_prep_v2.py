"""Task1: Wikidata プロパティ拡張＋固有名整形（純関数）のテスト。"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.lib.profile_prep import (
    dedup_names, named_props, wikidata_facts, extract_sections,
    LAYERS, PROFILE_SYSTEM_V2, build_profile_prompt_v2,
    parse_profile_v2, assemble_profile_v2, is_degraded_v2,
    generate_profile_v2,
)


def test_dedup_names_preserves_order_and_dedups():
    assert dedup_names(["英語", "マレー語", "英語"]) == ["英語", "マレー語"]


def test_dedup_names_drops_empty_and_none():
    assert dedup_names(["英語", None, "", "英語", "中国語"]) == ["英語", "中国語"]


def test_dedup_names_empty_input():
    assert dedup_names([]) == []


def test_named_props_resolves_ja_labels():
    entity = {"claims": {"P37": [{"mainsnak": {"datavalue": {"value": {"id": "Q1860"}}}}],
                         "P47": [{"mainsnak": {"datavalue": {"value": {"id": "Q833"}}}},
                                 {"mainsnak": {"datavalue": {"value": {"id": "Q833"}}}}]}}  # 重複
    res = named_props(entity, label_resolver=lambda qs: {"Q1860": "英語", "Q833": "マレーシア"})
    assert res["languages"] == ["英語"]
    assert res["borders"] == ["マレーシア"]  # dedup
    assert res["memberships"] == []


def test_named_props_no_claims_skips_resolver_call():
    called = {"n": 0}
    def resolver(qs):
        called["n"] += 1
        return {}
    res = named_props({}, label_resolver=resolver)
    assert res == {"languages": [], "borders": [], "memberships": []}
    assert called["n"] == 0  # claims 皆無なら resolver を呼ばない


def test_named_props_missing_label_omitted():
    # label_resolver が一部 QID を解決できない（lut に無い）→ None → dedup_names で除外
    entity = {"claims": {"P463": [{"mainsnak": {"datavalue": {"value": {"id": "Q1065"}}}},
                                   {"mainsnak": {"datavalue": {"value": {"id": "Q7825"}}}}]}}
    res = named_props(entity, label_resolver=lambda qs: {"Q1065": "国際連合"})
    assert res["memberships"] == ["国際連合"]


def test_named_props_malformed_claim_ignored():
    # mainsnak/datavalue/value 欠落・novalue 等の壊れた claim は無視される
    entity = {"claims": {"P37": [{"mainsnak": {"snaktype": "novalue"}},
                                  {"mainsnak": {"datavalue": {"value": {"id": "Q1860"}}}}]}}
    res = named_props(entity, label_resolver=lambda qs: {"Q1860": "英語"})
    assert res["languages"] == ["英語"]


def test_wikidata_facts_includes_gdp_per_capita():
    claims = {"P2132": [{"mainsnak": {"datavalue": {"value": {"amount": "+52000"}}}}]}
    f = wikidata_facts({"claims": claims})
    assert f["gdp_per_capita"] == 52000.0


def test_wikidata_facts_gdp_per_capita_none_when_missing():
    f = wikidata_facts({})
    assert f["gdp_per_capita"] is None
    # 既存キーは維持
    assert set(f.keys()) == {"population", "area_km2", "lat", "lon", "elevation_m", "gdp_per_capita"}


def test_extract_sections_keeps_allow_drops_deny():
    raw = "冒頭概要。\n\n== 歴史 ==\n歴史本文。\n\n== 著名な出身者 ==\n人名。\n\n== 経済 ==\n経済本文。"
    out = extract_sections(raw, max_chars=9999)
    assert "歴史本文" in out and "経済本文" in out
    assert "人名" not in out  # denylist(未定義キー)は除外


def test_extract_sections_trims():
    assert len(extract_sections("x" * 10000, max_chars=100)) == 100


def test_extract_sections_normalizes_synonyms():
    # 「産業」「対外関係」は同義語マップで economy/foreign に正規化され allowlist 通過
    raw = "冒頭。\n\n== 産業 ==\n産業本文。\n\n== 対外関係 ==\n対外本文。"
    out = extract_sections(raw, max_chars=9999)
    assert "産業本文" in out
    assert "対外本文" in out


def test_extract_sections_unmapped_heading_dropped():
    # 同義語マップに無い見出し(脚注/外部リンク等)は落ちる
    raw = "冒頭。\n\n== 脚注 ==\n脚注本文。\n\n== 外部リンク ==\nリンク本文。"
    out = extract_sections(raw, max_chars=9999)
    assert "脚注本文" not in out
    assert "リンク本文" not in out


def test_extract_sections_no_headings_returns_lead_as_overview():
    out = extract_sections("見出しの無い本文だけ。", max_chars=9999)
    assert out == "見出しの無い本文だけ。"


def test_extract_sections_empty_input_returns_empty():
    assert extract_sections("", max_chars=9999) == ""
    assert extract_sections(None, max_chars=9999) == ""


def test_extract_sections_heading_label_preserved_in_output():
    raw = "冒頭。\n\n== 歴史 ==\n歴史本文。"
    out = extract_sections(raw, max_chars=9999)
    assert "【歴史】" in out


def test_extract_sections_trailing_heading_no_newline_drops_and_no_markup_leak():
    # 見出しが原文末尾で改行なし → 本文空なので該当節は落ち、生マークアップ == も漏れない
    out = extract_sections("冒頭。\n\n== 交通 ==", max_chars=9999)
    assert out == "冒頭。"  # overview のみ・交通節は本文空で除外
    assert "==" not in out  # 生の見出しマークアップが漏出しない
    assert out.count("冒頭。") == 1  # overview が二重化しない


def test_extract_sections_deep_heading_level_split():
    # === (レベル3) の見出しも正しく節分割される
    raw = "冒頭。\n\n=== 歴史 ===\n歴史本文。\n\n=== 脚注 ===\n脚注本文。"
    out = extract_sections(raw, max_chars=9999)
    assert "【歴史】" in out and "歴史本文" in out
    assert "脚注本文" not in out  # allowlist 外は落ちる


def test_extract_sections_inline_equals_not_treated_as_heading():
    # 行途中の == は見出しと誤認せず本文として扱う
    raw = "冒頭。\n\n== 歴史 ==\n本文 == 注記 == の続き。"
    out = extract_sections(raw, max_chars=9999)
    assert "本文 == 注記 == の続き。" in out  # 行途中の == は本文のまま残る
    assert out.count("【") == 1  # 見出しブロックは 歴史 の1つだけ


"""Task3: プロンプト構築 v2（因果レイヤー/確度/年表/観光・レベル別縮退）のテスト。"""


def test_layers_has_five_entries_with_diplomacy_country_only():
    assert [layer["key"] for layer in LAYERS] == [
        "geography", "economy", "society", "geopolitics", "diplomacy",
    ]
    by_key = {layer["key"]: layer for layer in LAYERS}
    assert by_key["diplomacy"]["levels"] == {"country"}
    for k in ("geography", "economy", "society", "geopolitics"):
        assert by_key[k]["levels"] == {"country", "admin1", "city"}


def test_profile_system_v2_instructs_named_enumeration_including_religion():
    # カテゴリ要約でなく固有名列挙（宗教も本文由来で列挙させる指示を含む）
    assert "固有名" in PROFILE_SYSTEM_V2
    assert "宗教" in PROFILE_SYSTEM_V2
    assert "confidence" in PROFILE_SYSTEM_V2 or "inferred" in PROFILE_SYSTEM_V2


def test_prompt_omits_diplomacy_for_city():
    p = build_profile_prompt_v2("大阪市", "city", {}, {}, "", belongs_to_name="日本")
    assert "diplomacy" not in p and "所属国「日本」" in p


def test_prompt_tourism_excludes_disputed_military_inaccessible():
    # tourism は実際に一般訪問できる観光地に限り、係争地・軍事管理下・一般アクセス不可の地形を
    # 観光として挙げない指示を含む（台湾の東沙諸島/太平島のような非訪問地形の誤列挙を防ぐ）。
    p = build_profile_prompt_v2("台湾", "country", {}, {}, "")
    assert "訪問" in p
    assert "係争" in p and "軍事" in p


def test_prompt_timeline_year_must_be_event_year_no_double_count():
    # timeline の year は事象自体の発生年に限り、「〜の後」の緩い言及で別事象を誤った年に
    # 折り込まない・同一事象を複数年に二重計上しない指示を含む
    # （タイの「国名変更」を1932と1939に二重計上した誤りの再発防止）。
    p = build_profile_prompt_v2("タイ", "country", {}, {}, "")
    assert "発生した年" in p
    assert "二重計上" in p and "折り込" in p


def test_prompt_includes_named_props():
    p = build_profile_prompt_v2("X", "country", {}, {"languages": ["英語", "タミル語"]}, "")
    assert "英語, タミル語" in p and "geography" in p and "diplomacy" in p


def test_prompt_country_has_no_belongs_to_note():
    p = build_profile_prompt_v2("日本", "country", {}, {}, "")
    assert "所属国" not in p


def test_prompt_admin1_also_omits_diplomacy():
    p = build_profile_prompt_v2("大阪府", "admin1", {}, {}, "", belongs_to_name="日本")
    assert "diplomacy" not in p and "所属国「日本」" in p


def test_prompt_embeds_facts_and_section_text():
    facts = {"population": 1000, "area_km2": None}
    p = build_profile_prompt_v2("Y", "country", facts, {}, "本文の抜粋テキスト")
    assert "population: 1000" in p
    assert "area_km2" not in p  # None は除外
    assert "本文の抜粋テキスト" in p


def test_prompt_empty_facts_named_section_render_placeholder():
    p = build_profile_prompt_v2("Z", "country", {}, {}, "")
    assert "(なし)" in p


def test_prompt_output_schema_mentions_confidence_labels_and_timeline_tourism():
    p = build_profile_prompt_v2("Z", "country", {}, {}, "")
    assert "certain" in p and "inferred" in p and "time_sensitive" in p
    assert "timeline" in p and "tourism" in p


def test_prompt_includes_anti_hallucination_guardrails():
    # 観測した失敗モードを狙う「引用できねば certain にしない・具体属性は誤りなら省略」型ガードレール
    p = build_profile_prompt_v2("水原市", "city", {"population": 1000}, {}, "本文", belongs_to_name="韓国")
    assert "出力前の必須チェック" in p
    assert "確実な根拠" in p                 # 正のアンカー（Wikidata 値は certain 可）
    assert "そのまま引用" in p               # certain は本文語句を verbatim 引用（要約禁止）
    assert "省略する" in p                   # 具体属性は明示無ければ inferred でも書かず省略
    assert "唯一" in p                       # 全称主張の注意
    assert "政治的立場" in p                  # 人物の政治的性格付けの注意
    assert "自身に限定" in p and "水原市" in p  # 対象地域への接地強制


def test_prompt_timeline_year_certain_rule_consistent_with_guardrail():
    # 315行「年号は certain」とガードレールの矛盾を解消（年号も明示があれば certain）
    p = build_profile_prompt_v2("Z", "country", {}, {}, "")
    # 無条件の「年号は certain」が残っていないこと（明示条件付きへ）
    assert "年号は certain。" not in p
    assert "明示があれば certain" in p or "明示がある場合のみ certain" in p


"""Task4: 応答パース＋組立 v2（純関数）のテスト。"""


def test_parse_v2_filters_bad_confidence_and_keys():
    txt = '{"layers":[{"key":"geography","title":"地勢","body":"本文",'\
          '"confidence":[{"label":"bogus","note":"x"},{"label":"certain","kind":"地理","note":"y"}],'\
          '"dig_deeper":["a"]},{"key":"nope","body":"z"}],"timeline":[{"year":1819,"event":"開港"}],"tourism":["名所"]}'
    r = parse_profile_v2(txt)
    assert [l["key"] for l in r["layers"]] == ["geography"]
    assert [c["label"] for c in r["layers"][0]["confidence"]] == ["certain"]
    assert r["timeline"][0]["year"] == "1819" and r["tourism"] == ["名所"]


def test_degraded_v2_when_no_layers():
    assert is_degraded_v2("Q1", {"layers": []}) is True


def test_parse_v2_non_string_input_returns_empty_structure():
    assert parse_profile_v2(None) == {"layers": [], "timeline": [], "tourism": []}
    assert parse_profile_v2(123) == {"layers": [], "timeline": [], "tourism": []}


def test_parse_v2_no_json_object_returns_empty_structure():
    assert parse_profile_v2("前置きだけで JSON が無い応答") == {"layers": [], "timeline": [], "tourism": []}


def test_parse_v2_invalid_json_returns_empty_structure():
    assert parse_profile_v2("{not valid json}") == {"layers": [], "timeline": [], "tourism": []}


def test_parse_v2_dedups_same_key_keeps_first_occurrence():
    txt = ('{"layers":[{"key":"geography","body":"最初"},'
           '{"key":"geography","body":"二回目"}]}')
    r = parse_profile_v2(txt)
    assert [layer["key"] for layer in r["layers"]] == ["geography"]
    assert r["layers"][0]["body"] == "最初"


def test_parse_v2_empty_or_whitespace_body_filtered():
    txt = '{"layers":[{"key":"geography","body":"   "},{"key":"economy","body":""}]}'
    r = parse_profile_v2(txt)
    assert r["layers"] == []


def test_parse_v2_confidence_missing_note_filtered():
    txt = '{"layers":[{"key":"geography","body":"本文",' \
          '"confidence":[{"label":"certain"},{"label":"inferred","note":"根拠あり"}]}]}'
    r = parse_profile_v2(txt)
    assert [c["label"] for c in r["layers"][0]["confidence"]] == ["inferred"]


def test_parse_v2_title_defaults_to_key_when_missing():
    txt = '{"layers":[{"key":"society","body":"本文"}]}'
    r = parse_profile_v2(txt)
    assert r["layers"][0]["title"] == "society"


def test_parse_v2_evidence_and_dig_deeper_default_and_filter():
    txt = '{"layers":[{"key":"society","body":"本文","evidence":"  出典  ",' \
          '"dig_deeper":["指標A", "", 123, "  "]}]}'
    r = parse_profile_v2(txt)
    assert r["layers"][0]["evidence"] == "出典"
    assert r["layers"][0]["dig_deeper"] == ["指標A"]


def test_parse_v2_timeline_skips_entries_without_event():
    txt = '{"timeline":[{"year":2000},{"year":2001,"event":"何か"}]}'
    r = parse_profile_v2(txt)
    assert [t["year"] for t in r["timeline"]] == ["2001"]


def test_parse_v2_timeline_invalid_confidence_falls_back_to_certain():
    txt = '{"timeline":[{"year":1945,"event":"終戦","confidence":"bogus"}]}'
    r = parse_profile_v2(txt)
    assert r["timeline"][0]["confidence"] == "certain"


def test_parse_v2_timeline_valid_confidence_and_cause_note_preserved():
    txt = '{"timeline":[{"year":1945,"event":"終戦","confidence":"inferred","cause_note":"  推定  "}]}'
    r = parse_profile_v2(txt)
    assert r["timeline"][0]["confidence"] == "inferred"
    assert r["timeline"][0]["cause_note"] == "推定"


def test_parse_v2_tourism_filters_non_string_and_blank():
    txt = '{"tourism":["名所A", "", "  ", 123, "名所B"]}'
    r = parse_profile_v2(txt)
    assert r["tourism"] == ["名所A", "名所B"]


def test_parse_v2_missing_keys_return_empty_lists():
    assert parse_profile_v2("{}") == {"layers": [], "timeline": [], "tourism": []}


def test_is_degraded_v2_false_when_qid_and_layers_present():
    assert is_degraded_v2("Q1", {"layers": [{"key": "geography"}]}) is False


def test_is_degraded_v2_true_when_qid_missing():
    assert is_degraded_v2(None, {"layers": [{"key": "geography"}]}) is True
    assert is_degraded_v2("", {"layers": [{"key": "geography"}]}) is True


def test_is_degraded_v2_true_when_layers_key_absent():
    assert is_degraded_v2("Q1", {}) is True


def test_assemble_profile_v2_builds_expected_schema():
    parsed = {"layers": [{"key": "geography", "body": "本文"}],
              "timeline": [{"year": "1819", "event": "開港"}],
              "tourism": ["名所"]}
    facts = {"population": 100}
    source = {"qid": "Q1", "wikipedia_url": "https://ja.wikipedia.org/wiki/X"}
    out = assemble_profile_v2("Q1", "city", "横浜市", facts, parsed, source, False,
                               {"country": "日本", "admin1": "神奈川県"}, "2026-07-04T00:00:00Z")
    assert out == {
        "id": "Q1", "level": "city", "name_ja": "横浜市",
        "belongs_to": {"country": "日本", "admin1": "神奈川県"},
        "facts": facts, "layers": parsed["layers"], "timeline": parsed["timeline"],
        "tourism": parsed["tourism"], "source": source, "degraded": False,
        "generated_at": "2026-07-04T00:00:00Z",
    }


def test_assemble_profile_v2_degraded_true_coerced_from_truthy():
    out = assemble_profile_v2("Q1", "country", "日本", {}, {"layers": [], "timeline": [], "tourism": []},
                               {"qid": "Q1", "wikipedia_url": None}, "truthy-string", None, "2026-01-01")
    assert out["degraded"] is True


# --- 堅牢性: untrusted な LLM 出力の非リスト/非dict/非文字列でクラッシュしない ---


def test_parse_v2_layers_not_a_list_returns_empty():
    # layers が dict（list でない）→ layers 空・クラッシュしない
    r = parse_profile_v2('{"layers":{"key":"geography","body":"本文"}}')
    assert r["layers"] == []


def test_parse_v2_layer_elements_non_dict_skipped():
    # layers 要素が文字列/数値/None → スキップ・正常な dict 要素は残る
    txt = '{"layers":["文字列", 123, null, {"key":"geography","body":"本文"}]}'
    r = parse_profile_v2(txt)
    assert [layer["key"] for layer in r["layers"]] == ["geography"]


def test_parse_v2_non_string_key_skipped_no_typeerror():
    # key が list/dict（非文字列）→ `k in _LAYER_KEYS` の TypeError を避けてスキップ
    txt = '{"layers":[{"key":["geography"],"body":"本文A"},{"key":{"x":1},"body":"本文B"},' \
          '{"key":"economy","body":"本文C"}]}'
    r = parse_profile_v2(txt)
    assert [layer["key"] for layer in r["layers"]] == ["economy"]


def test_parse_v2_non_string_evidence_becomes_empty():
    # evidence が数値/list → .strip() クラッシュせず "" に
    txt = '{"layers":[{"key":"geography","body":"本文","evidence":123},' \
          '{"key":"economy","body":"本文2","evidence":["a"]}]}'
    r = parse_profile_v2(txt)
    assert r["layers"][0]["evidence"] == ""
    assert r["layers"][1]["evidence"] == ""


def test_parse_v2_confidence_and_dig_deeper_not_list_safe():
    # confidence/dig_deeper が非リスト → 空リスト・クラッシュしない
    txt = '{"layers":[{"key":"geography","body":"本文","confidence":"certain","dig_deeper":"x"}]}'
    r = parse_profile_v2(txt)
    assert r["layers"][0]["confidence"] == []
    assert r["layers"][0]["dig_deeper"] == []


def test_parse_v2_title_non_string_falls_back_to_key():
    # title が数値 → key にフォールバック
    txt = '{"layers":[{"key":"society","body":"本文","title":123}]}'
    r = parse_profile_v2(txt)
    assert r["layers"][0]["title"] == "society"


def test_parse_v2_timeline_not_a_list_returns_empty():
    r = parse_profile_v2('{"timeline":{"year":2000,"event":"何か"}}')
    assert r["timeline"] == []


def test_parse_v2_timeline_non_dict_and_non_string_event_skipped():
    # timeline 要素が非dict、または event が非文字列/空 → スキップ・正常要素は残る
    txt = '{"timeline":["x", 123, {"year":2001,"event":999}, {"year":2002,"event":"  "},' \
          '{"year":2003,"event":"確定"}]}'
    r = parse_profile_v2(txt)
    assert [t["year"] for t in r["timeline"]] == ["2003"]


def test_parse_v2_timeline_non_string_cause_note_becomes_empty():
    txt = '{"timeline":[{"year":2000,"event":"何か","cause_note":123}]}'
    r = parse_profile_v2(txt)
    assert r["timeline"][0]["cause_note"] == ""


def test_parse_v2_tourism_not_a_list_returns_empty():
    r = parse_profile_v2('{"tourism":"名所"}')
    assert r["tourism"] == []


def test_parse_v2_non_dict_json_returns_empty_structure():
    # トップレベルが list の JSON → 空構造・クラッシュしない
    assert parse_profile_v2('[1, 2, 3]') == {"layers": [], "timeline": [], "tourism": []}


def test_parse_v2_layer_confidence_label_unhashable_skipped():
    # confidence label が list/dict（unhashable）→ `label in _CONF` の TypeError を避けてスキップ
    txt = '{"layers":[{"key":"geography","body":"本文","confidence":[' \
          '{"label":["certain"],"note":"x"},{"label":{"a":1},"note":"y"},' \
          '{"label":"inferred","note":"z"}]}]}'
    r = parse_profile_v2(txt)
    assert [c["label"] for c in r["layers"][0]["confidence"]] == ["inferred"]


def test_parse_v2_timeline_confidence_unhashable_falls_back_to_certain():
    # timeline confidence が list/dict（unhashable）→ TypeError なしで "certain" フォールバック
    txt = '{"timeline":[{"year":2000,"event":"何か","confidence":["certain"]},' \
          '{"year":2001,"event":"別件","confidence":{"a":1}}]}'
    r = parse_profile_v2(txt)
    assert [t["confidence"] for t in r["timeline"]] == ["certain", "certain"]


"""Task5: 取得配線（generate_profile_v2・I/O注入・逐次モード用）のテスト。"""


def test_generate_v2_degraded_without_qid():
    p = generate_profile_v2("city", "Qx", "街", None, {"level": "country", "id": "JP", "name_ja": "日本"}, "2026-07-04",
        fetch_wikidata=lambda q: {}, fetch_article=lambda t: "", label_resolver=lambda qs: {}, ask_llm=lambda p: "")
    assert p["degraded"] is True and p["belongs_to"]["name_ja"] == "日本"


def test_generate_v2_builds_layers():
    ent = {"claims": {"P1082": [{"mainsnak": {"datavalue": {"value": {"amount": "+100"}}}}]}, "sitelinks": {"jawiki": {"title": "X"}}}
    llm = '{"layers":[{"key":"geography","title":"地勢","body":"本文","confidence":[{"label":"certain","kind":"地理","note":"n"}]}],"timeline":[],"tourism":[]}'
    p = generate_profile_v2("country", "XX", "エックス", "Q1", None, "2026-07-04",
        fetch_wikidata=lambda q: ent, fetch_article=lambda t: "== 歴史 ==\n史。", label_resolver=lambda qs: {}, ask_llm=lambda pr: llm)
    assert p["degraded"] is False and p["layers"][0]["key"] == "geography"


def test_generate_v2_qid_without_entity_is_degraded_but_qid_preserved_in_source():
    # fetch_wikidata が None/{} を返す(取得失敗/未整備) → facts空・named空・title無 → degraded True だが source.qid は残す
    p = generate_profile_v2("country", "ZZ", "ゼット", "Q999", None, "2026-07-04",
        fetch_wikidata=lambda q: None, fetch_article=lambda t: "本文", label_resolver=lambda qs: {}, ask_llm=lambda pr: "")
    assert p["degraded"] is True
    assert p["source"] == {"qid": "Q999", "wikipedia_url": None, "wikidata_props": []}


def test_generate_v2_no_jawiki_title_skips_fetch_article_and_llm():
    # jaWikipedia サイトリンク無し → fetch_article/ask_llm を呼ばずに degraded（余計な I/O をしない）
    ent = {"claims": {}, "sitelinks": {}}
    def boom(*a, **kw):
        raise AssertionError("呼ばれるべきでない")
    p = generate_profile_v2("country", "YY", "ワイ", "Q2", None, "2026-07-04",
        fetch_wikidata=lambda q: ent, fetch_article=boom, label_resolver=lambda qs: {}, ask_llm=boom)
    assert p["degraded"] is True
    assert p["source"]["wikipedia_url"] is None


def test_generate_v2_empty_section_text_skips_llm_call():
    # 本文はあるが節抽出結果が空（節見出しが allowlist に無い等）→ ask_llm を呼ばず degraded
    ent = {"claims": {}, "sitelinks": {"jawiki": {"title": "X"}}}
    def boom(*a, **kw):
        raise AssertionError("呼ばれるべきでない")
    p = generate_profile_v2("country", "WW", "ダブリュー", "Q3", None, "2026-07-04",
        fetch_wikidata=lambda q: ent, fetch_article=lambda t: "== 脚注 ==\n無関係本文。", label_resolver=lambda qs: {}, ask_llm=boom)
    assert p["degraded"] is True
    assert p["source"]["wikipedia_url"] == "https://ja.wikipedia.org/wiki/X"


def test_generate_v2_belongs_to_propagates_into_prompt_and_output():
    # belongs_to.name_ja が build_profile_prompt_v2 の所属国注記へ伝播し、出力にもそのまま残る
    ent = {"claims": {}, "sitelinks": {"jawiki": {"title": "大阪市"}}}
    captured = {}
    def ask_llm(prompt):
        captured["prompt"] = prompt
        return '{"layers":[{"key":"geography","body":"本文"}]}'
    belongs_to = {"level": "country", "id": "JP", "name_ja": "日本"}
    p = generate_profile_v2("city", "Q123", "大阪市", "Q456", belongs_to, "2026-07-04",
        fetch_wikidata=lambda q: ent, fetch_article=lambda t: "== 歴史 ==\n史。",
        label_resolver=lambda qs: {}, ask_llm=ask_llm)
    assert "所属国「日本」" in captured["prompt"]
    assert p["belongs_to"] == belongs_to


def test_generate_v2_wikidata_props_lists_only_present_props():
    # named_props の languages/borders/memberships のうち非空のものだけ source.wikidata_props に載る
    ent = {"claims": {"P37": [{"mainsnak": {"datavalue": {"value": {"id": "Q1860"}}}}]},
           "sitelinks": {"jawiki": {"title": "X"}}}
    p = generate_profile_v2("country", "V1", "ブイワン", "Q7", None, "2026-07-04",
        fetch_wikidata=lambda q: ent, fetch_article=lambda t: "== 歴史 ==\n史。",
        label_resolver=lambda qs: {"Q1860": "英語"}, ask_llm=lambda pr: "")
    assert p["source"]["wikidata_props"] == ["P37"]


def test_generate_v2_llm_call_receives_facts_and_named_props_grounded_prompt():
    # ask_llm へ渡るプロンプトに facts と named_props の固有名が実際に埋め込まれる（grounding の配線確認）
    ent = {"claims": {"P1082": [{"mainsnak": {"datavalue": {"value": {"amount": "+5000"}}}}],
                      "P37": [{"mainsnak": {"datavalue": {"value": {"id": "Q1860"}}}}]},
           "sitelinks": {"jawiki": {"title": "X"}}}
    captured = {}
    def ask_llm(prompt):
        captured["prompt"] = prompt
        return ""
    generate_profile_v2("country", "G1", "ジーワン", "Q8", None, "2026-07-04",
        fetch_wikidata=lambda q: ent, fetch_article=lambda t: "== 歴史 ==\n史。",
        label_resolver=lambda qs: {"Q1860": "英語"}, ask_llm=ask_llm)
    assert "population: 5000" in captured["prompt"]
    assert "英語" in captured["prompt"]
