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
