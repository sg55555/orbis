import json
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_news_feeds_config_valid():
    with open(os.path.join(ROOT, "config", "news_feeds.json"), encoding="utf-8") as f:
        feeds = json.load(f)
    assert isinstance(feeds, list) and len(feeds) >= 3
    for fd in feeds:
        assert set(fd) >= {"id", "name", "url"}
        assert fd["url"].startswith("http")
    ids = [fd["id"] for fd in feeds]
    assert len(ids) == len(set(ids))  # id 一意


from collectors.lib.rss import parse_feed

RSS2 = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Quake hits Tokyo</title><link>https://ex.com/a</link>
<pubDate>Wed, 18 Jun 2026 09:00:00 GMT</pubDate></item>
<item><title>Market falls</title><link>https://ex.com/b</link>
<pubDate>Wed, 18 Jun 2026 08:00:00 GMT</pubDate></item>
</channel></rss>"""

ATOM = """<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Border talks</title><link href="https://ex.com/c"/>
<published>2026-06-18T07:00:00Z</published></entry></feed>"""


def test_parse_feed_rss2():
    rows = parse_feed(RSS2, "ex")
    assert [r["title"] for r in rows] == ["Quake hits Tokyo", "Market falls"]
    assert rows[0]["url"] == "https://ex.com/a"
    assert rows[0]["source"] == "ex"
    assert rows[0]["published_iso"].startswith("2026-06-18T09:00:00")


def test_parse_feed_atom_link_href():
    rows = parse_feed(ATOM, "ex")
    assert rows[0]["title"] == "Border talks"
    assert rows[0]["url"] == "https://ex.com/c"
    assert rows[0]["published_iso"].startswith("2026-06-18T07:00:00")


def test_parse_feed_garbage_is_empty():
    assert parse_feed("not xml", "ex") == []


from collectors.lib.rss import dedup, recent, to_epoch_ms


def test_dedup_by_title_and_url():
    arts = [
        {"title": "Quake hits Tokyo!", "url": "https://a.com/1", "published_iso": "2026-06-18T09:00:00Z", "source": "a"},
        {"title": "quake hits tokyo", "url": "https://b.com/2", "published_iso": "2026-06-18T08:00:00Z", "source": "b"},
        {"title": "Other", "url": "https://a.com/1", "published_iso": "2026-06-18T07:00:00Z", "source": "a"},
    ]
    out = dedup(arts)
    assert len(out) == 1  # 同一正規化タイトル＆同一URLで1件


def test_recent_window():
    now = datetime(2026, 6, 18, 12, 0, 0, tzinfo=timezone.utc)
    arts = [
        {"title": "fresh", "url": "u1", "published_iso": "2026-06-18T06:00:00Z", "source": "a"},
        {"title": "old", "url": "u2", "published_iso": "2026-06-16T06:00:00Z", "source": "a"},
        {"title": "nodate", "url": "u3", "published_iso": None, "source": "a"},
    ]
    out = recent(arts, now, hours=24)
    assert [a["title"] for a in out] == ["fresh"]


def test_to_epoch_ms():
    assert to_epoch_ms("2026-06-18T00:00:00Z") == 1781740800000
    assert to_epoch_ms(None) == 0


from collectors.lib.news_enrich import rank_prompt, parse_rank


def _arts(n):
    return [{"title": f"t{i}", "url": f"u{i}", "published_iso": "2026-06-18T09:00:00Z", "source": "a"} for i in range(n)]


def test_rank_prompt_lists_numbered_headlines():
    p = rank_prompt(_arts(3))
    assert "1." in p and "t0" in p and "t2" in p


def test_parse_rank_picks_top_and_orders():
    arts = _arts(5)
    out = parse_rank("Top: 3, 1, 5", arts, top_n=2)
    assert [a["url"] for a in out] == ["u2", "u0"]  # 1始まり→0始まり、top_n=2
    assert out[0]["rank"] == 0 and out[1]["rank"] == 1


def test_parse_rank_fills_when_short():
    arts = _arts(4)
    out = parse_rank("2", arts, top_n=3)  # 1件しか拾えない→残りを元順で補完
    assert len(out) == 3
    assert out[0]["url"] == "u1"


from collectors.lib.news_enrich import enrich_prompt, parse_enrich


def test_enrich_prompt_mentions_json_and_categories():
    p = enrich_prompt({"title": "Quake hits Tokyo", "url": "u", "source": "a"})
    assert "JSON" in p and "politics" in p and "Quake hits Tokyo" in p


def test_parse_enrich_ok_with_fence():
    text = '```json\n{"title_ja":"東京で地震","summary_ja":"M6。","category":"disaster","lat":35.6,"lon":139.7,"place":"東京"}\n```'
    d = parse_enrich(text)
    assert d["title_ja"] == "東京で地震" and d["category"] == "disaster"
    assert d["lat"] == 35.6 and d["lon"] == 139.7 and d["place"] == "東京"


def test_parse_enrich_coerces_bad_category_and_validates_coords():
    text = '{"title_ja":"x","summary_ja":"y","category":"gossip","lat":999,"lon":10,"place":"z"}'
    assert parse_enrich(text) is None  # lat 範囲外 → None


def test_parse_enrich_unknown_category_becomes_other():
    text = '{"title_ja":"x","summary_ja":"y","category":"gossip","lat":10,"lon":10,"place":"z"}'
    assert parse_enrich(text)["category"] == "other"


def test_parse_enrich_garbage_none():
    assert parse_enrich("no json here") is None


from collectors.lib.news_enrich import finalize_items


def test_finalize_sorts_by_rank_then_time_and_caps():
    now_ms = 1781784000000  # 2026-06-18T12:00:00Z
    items = [
        {"url": "u1", "rank": 2, "time": now_ms - 1000},
        {"url": "u2", "rank": 0, "time": now_ms - 5000},
        {"url": "u3", "rank": 1, "time": now_ms - 2000},
        {"url": "u4", "rank": 3, "time": now_ms - 99 * 3600 * 1000},  # 窓外
    ]
    out = finalize_items(items, now_ms, hours=24, cap=2)
    assert [i["url"] for i in out] == ["u2", "u3"]  # rank昇順、窓外/cap除外
