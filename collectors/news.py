"""厳選RSS→Claude Haiku で日本語訳/要約/タグ/ジオコード→news スナップショット（キーゲート）。"""
import json
import os
from datetime import datetime, timezone

import requests

from collectors.lib.manifest import update_manifest
from collectors.lib.rss import parse_feed, dedup, recent, to_epoch_ms
from collectors.lib.news_enrich import rank_prompt, parse_rank, enrich_prompt, parse_enrich, finalize_items

SNAPSHOT_DIR = "data/snapshots"
CONFIG_PATH = "config/news_feeds.json"
MODEL = "claude-haiku-4-5-20251001"
TOP_N = 30
WINDOW_HOURS = 24
UA = "Mozilla/5.0 orbis-bot"


def _now():
    return datetime.now(timezone.utc)


def load_feeds():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def fetch_text(url):
    r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    r.raise_for_status()
    return r.text


def _make_client():
    import anthropic
    return anthropic.Anthropic()


def _ask(client, prompt, max_tokens):
    msg = client.messages.create(
        model=MODEL, max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def _rank(client, articles):
    return _ask(client, rank_prompt(articles), 300)


def _enrich(client, article):
    return _ask(client, enrich_prompt(article), 400)


def _load_prev_cache(path):
    """前回 news.json を url->{title_ja,...} のキャッシュに（再翻訳回避）。"""
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            prev = json.load(f)
        return {it["url"]: it for it in prev.get("items", [])}
    except (json.JSONDecodeError, OSError, KeyError):
        return {}


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("[news] ANTHROPIC_API_KEY not set; skip")
        return 0
    out_dir = os.path.abspath(SNAPSHOT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    snap_path = os.path.join(out_dir, "news.json")
    manifest_path = os.path.join(out_dir, "manifest.json")
    now = _now()
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        feeds = load_feeds()
        articles = []
        for fd in feeds:
            try:
                articles += parse_feed(fetch_text(fd["url"]), fd["id"])
            except Exception as e:  # 1フィード失敗は継続
                print(f"[news] feed {fd['id']} failed: {e}")
        articles = recent(dedup(articles), now, WINDOW_HOURS)
        if not articles:
            print("[news] no candidate articles; keeping previous snapshot")
            return 1
        client = _make_client()
        ranked = parse_rank(_rank(client, articles), articles, TOP_N)
        cache = _load_prev_cache(snap_path)
        items = []
        for a in ranked:
            enr = cache.get(a["url"])
            if enr is None:
                d = parse_enrich(_enrich(client, a))
                if not d:
                    continue
                enr = {**d}
            items.append({
                "id": a["url"], "url": a["url"], "source": a["source"],
                "time": to_epoch_ms(a["published_iso"]), "rank": a["rank"],
                "title_ja": enr["title_ja"], "summary_ja": enr.get("summary_ja", ""),
                "category": enr.get("category", "other"),
                "lon": enr["lon"], "lat": enr["lat"], "place": enr.get("place", ""),
            })
        items = finalize_items(items, int(now.timestamp() * 1000), WINDOW_HOURS, TOP_N)
    except Exception as e:  # 全体失敗は前回温存
        print(f"[news] failed: {e}; keeping previous snapshot")
        return 1
    snap = {"updated": now_iso, "items": items}
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)
    update_manifest(manifest_path, "news", now_iso, len(items))
    print(f"[news] wrote {len(items)} items -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
