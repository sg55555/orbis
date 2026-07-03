"""Task1: Wikidata プロパティ拡張＋固有名整形（純関数）のテスト。"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.lib.profile_prep import (
    dedup_names, named_props, wikidata_facts, extract_sections,
    LAYERS, PROFILE_SYSTEM_V2, build_profile_prompt_v2,
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
