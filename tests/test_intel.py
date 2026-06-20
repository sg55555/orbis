from collectors.lib.intel import build_context, parse_brief, briefing_prompt, MAX_CARDS

NEWS = {"items": [
    {"title_ja": "停戦協議が再開", "summary_ja": "…", "category": "conflict", "place": "カイロ"},
    {"title_ja": "利上げ観測", "summary_ja": "…", "category": "economy", "place": "NY"},
]}
QUAKES = {"count": 243, "points": [
    {"mag": 1.4, "place": "Alaska"}, {"mag": 5.2, "place": "Japan"}, {"mag": 3.1, "place": "Chile"},
]}
CONFLICT = {"count": 2000, "points": [
    {"place": "US", "mentions": 4}, {"place": "US", "mentions": 6}, {"place": "PK", "mentions": 5},
]}
CFG = [
    {"id": "news", "file": "news.json", "key": "items", "take": 18, "fields": ["title_ja", "category", "place"]},
    {"id": "quakes", "file": "quakes.json", "key": "points", "sort_by": "mag", "take": 2, "fields": ["mag", "place"]},
    {"id": "conflict", "file": "conflict.json", "key": "points", "group_by": "place", "weight": "mentions", "top": 8},
]


def test_build_context_list_and_group():
    ctx = build_context({"news": NEWS, "quakes": QUAKES, "conflict": CONFLICT}, CFG)
    assert "停戦協議が再開" in ctx
    assert "mag=5.2" in ctx and "mag=1.4" not in ctx  # take2 を mag 降順 → 5.2,3.1
    assert "US(10)" in ctx and "PK(5)" in ctx          # group_by place, weight mentions 合算
    assert "count=2000" in ctx


def test_build_context_missing_source_safe():
    assert build_context({}, CFG) == ""


def test_parse_brief_valid():
    raw = '```json\n{"lead":"世界は緊張","cards":[{"title_ja":"A","summary_ja":"x","category":"conflict","severity":9,"lat":50.4,"lon":30.5,"place":"キーウ","sources":[{"title":"s","url":"https://e.com/a"}]}]}\n```'
    out = parse_brief(raw)
    assert out["lead"] == "世界は緊張"
    c = out["cards"][0]
    assert c["category"] == "conflict" and c["severity"] == 5          # 9→クランプ5
    assert c["lat"] == 50.4 and c["lon"] == 30.5
    assert c["sources"][0]["url"] == "https://e.com/a"


def test_parse_brief_drops_bad_coords_and_unknown_category_and_nonhttp():
    raw = '{"lead":"x","cards":[{"title_ja":"B","category":"zzz","lat":999,"lon":1,"sources":[{"url":"javascript:alert(1)"}]}]}'
    c = parse_brief(raw)["cards"][0]
    assert c["category"] == "other"          # 未知→other
    assert "lat" not in c and "lon" not in c # 範囲外座標は捨てる
    assert c["sources"] == []                # http(s)以外は除外


def test_parse_brief_caps_cards_and_handles_garbage():
    raw = '{"lead":"x","cards":[' + ",".join(['{"title_ja":"t%d"}' % i for i in range(20)]) + ']}'
    assert len(parse_brief(raw)["cards"]) == MAX_CARDS
    assert parse_brief("not json") == {"lead": "", "cards": []}


def test_briefing_prompt_contains_context_and_rules():
    p = briefing_prompt("CTX-HERE")
    assert "CTX-HERE" in p and "JSON" in p
