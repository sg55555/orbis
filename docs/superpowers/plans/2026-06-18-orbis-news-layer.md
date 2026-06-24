# A-1 翻訳・地図連動ニュースレイヤー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 厳選RSSの重要ニュースを Claude Haiku で日本語訳・要約・タグ・ジオコードし、globe 上にカテゴリ色のピンで表示する `news` レイヤーを追加する。

**Architecture:** 既存スナップショット方式に新 `news` レイヤーを追加。キーゲートの Python collector が RSS→2段 LLM（重要度ランキング1回＋上位30件の個別 enrich・URLキャッシュ）→`data/snapshots/news.json`。JS レイヤーが globe ピン＋フィード＋クリック日本語ポップアップ。

**Tech Stack:** Python（requests, xml.etree, anthropic SDK）/ Vanilla JS ESM + deck.gl ScatterplotLayer / GitHub Actions cron / pytest + node:test + Playwright。

参照スペック: `docs/superpowers/specs/2026-06-18-orbis-news-layer-design.md`

## ファイル構成

- 作成 `config/news_feeds.json` — 厳選RSSフィード（到達性検証済み6本）
- 作成 `collectors/lib/rss.py` — RSSパース・重複排除・窓・epoch変換（純粋）
- 作成 `collectors/lib/news_enrich.py` — LLMプロンプト組立と応答パース・最終整形（純粋）
- 作成 `collectors/news.py` — キーゲート collector 本体（薄いLLMラッパ）
- 作成 `js/lib/news_categories.js` — カテゴリ定義（label/color・news.js と selection.js で共用しcycle回避）
- 作成 `js/layers/news.js` — deckピン/tooltip/toFeedItems
- 変更 `js/layers/registry.js` — news 登録・DECK_TO_LAYER・DESCRIPTIONS
- 変更 `js/lib/selection.js` — `newsPopupHtml`
- 変更 `js/main.js` — onClick に news 分岐（**SHELLゆえ sw 版上げ必須**）
- 変更 `sw.js` — CACHE v27→v28
- 変更 `collect.yml` — news 収集手順（キーゲート）
- 変更 `requirements.txt` — anthropic 追加
- 作成 `tests/test_news.py` — pytest（純粋＋mock main）
- 作成 `tests/news.test.js` — node（純粋JS）
- 変更 `tests/e2e/smoke.spec.js` — レイヤー10行＋news許容ピン検証

---

### Task 1: 厳選RSSフィード設定

**Files:**
- Create: `config/news_feeds.json`
- Test: `tests/test_news.py`

- [ ] **Step 1: フィード設定を書く（到達性検証済み6本）**

`config/news_feeds.json`:
```json
[
  { "id": "aljazeera", "name": "Al Jazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml" },
  { "id": "bbcworld", "name": "BBC World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { "id": "guardian", "name": "The Guardian World", "url": "https://www.theguardian.com/world/rss" },
  { "id": "dw", "name": "DW", "url": "https://rss.dw.com/rdf/rss-en-world" },
  { "id": "france24", "name": "France 24", "url": "https://www.france24.com/en/rss" },
  { "id": "npr", "name": "NPR World", "url": "https://feeds.npr.org/1004/rss.xml" }
]
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/test_news.py`（先頭）:
```python
import json
import os

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
```

- [ ] **Step 3: テスト実行（PASS）**

Run: `python3 -m pytest tests/test_news.py::test_news_feeds_config_valid -q`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add config/news_feeds.json tests/test_news.py
git commit -m "feat(news): 厳選RSSフィード設定"
```

---

### Task 2: RSS パース（parse_feed）

**Files:**
- Create: `collectors/lib/rss.py`
- Test: `tests/test_news.py`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_news.py` に追記:
```python
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
```

- [ ] **Step 2: テスト実行（FAIL: module not found）**

Run: `python3 -m pytest tests/test_news.py -q -k parse_feed`
Expected: FAIL

- [ ] **Step 3: 実装**

`collectors/lib/rss.py`:
```python
"""RSS/Atom/RDF フィードのパースと、記事の重複排除・時間窓・epoch変換（純粋）。"""
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET


def _local(tag):
    """名前空間を除いたローカル名（'{ns}item' -> 'item'）。"""
    return tag.rsplit("}", 1)[-1].lower()


def _parse_date(s):
    """RFC822（RSS）/ ISO8601（Atom/RDF）を ISO UTC 文字列に。失敗は None。"""
    if not s:
        return None
    s = s.strip()
    try:  # RFC822 "Wed, 18 Jun 2026 09:00:00 GMT"
        dt = parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        dt = None
    if dt is None:
        try:  # ISO8601
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_feed(xml_text, source):
    """RSS2.0 / RDF(RSS1.0) / Atom から {title,url,published_iso,source} 配列（純粋）。"""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    out = []
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        title = url = date = None
        for ch in el:
            name = _local(ch.tag)
            if name == "title" and title is None:
                title = (ch.text or "").strip()
            elif name == "link" and url is None:
                url = (ch.text or "").strip() or ch.attrib.get("href", "").strip()
            elif name in ("pubdate", "published", "date", "updated") and date is None:
                date = _parse_date(ch.text)
        if title and url:
            out.append({"title": title, "url": url, "published_iso": date, "source": source})
    return out
```

- [ ] **Step 4: テスト実行（PASS）**

Run: `python3 -m pytest tests/test_news.py -q -k parse_feed`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add collectors/lib/rss.py tests/test_news.py
git commit -m "feat(news): RSS/Atom/RDF パース parse_feed"
```

---

### Task 3: 重複排除・時間窓・epoch（dedup / recent / to_epoch_ms）

**Files:**
- Modify: `collectors/lib/rss.py`
- Test: `tests/test_news.py`

- [ ] **Step 1: 失敗するテストを書く**

```python
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
```

- [ ] **Step 2: テスト実行（FAIL）**

Run: `python3 -m pytest tests/test_news.py -q -k "dedup or recent or epoch"`
Expected: FAIL

- [ ] **Step 3: 実装（rss.py に追記）**

```python
def _norm_title(t):
    return re.sub(r"[^a-z0-9]+", "", (t or "").lower())


def dedup(articles):
    """正規化タイトル または URL の一致で重複排除（先勝ち・純粋）。"""
    seen_title, seen_url, out = set(), set(), []
    for a in articles:
        nt, u = _norm_title(a.get("title")), a.get("url")
        if nt in seen_title or u in seen_url:
            continue
        seen_title.add(nt)
        seen_url.add(u)
        out.append(a)
    return out


def to_epoch_ms(iso):
    """ISO UTC 文字列 -> epoch ms。None/不正は 0（純粋）。"""
    if not iso:
        return 0
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return 0
    return int(dt.timestamp() * 1000)


def recent(articles, now, hours=24):
    """published が直近 hours 内のものだけ（日付不明は除外・純粋）。now=aware datetime。"""
    cutoff = now.timestamp() * 1000 - hours * 3600 * 1000
    return [a for a in articles if to_epoch_ms(a.get("published_iso")) >= cutoff]
```

- [ ] **Step 4: テスト実行（PASS）**

Run: `python3 -m pytest tests/test_news.py -q -k "dedup or recent or epoch"`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add collectors/lib/rss.py tests/test_news.py
git commit -m "feat(news): dedup/recent/to_epoch_ms"
```

---

### Task 4: 重要度ランキング（rank_prompt / parse_rank）

**Files:**
- Create: `collectors/lib/news_enrich.py`
- Test: `tests/test_news.py`

- [ ] **Step 1: 失敗するテストを書く**

```python
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
```

- [ ] **Step 2: テスト実行（FAIL）**

Run: `python3 -m pytest tests/test_news.py -q -k rank`
Expected: FAIL

- [ ] **Step 3: 実装**

`collectors/lib/news_enrich.py`:
```python
"""ニュース enrich の LLM プロンプト組立・応答パース・最終整形（純粋）。"""
import json
import re

CATEGORIES = ["politics", "conflict", "disaster", "economy", "society", "science", "environment", "other"]


def rank_prompt(articles):
    """見出し一覧→世界的重要度の上位を番号で返させるプロンプト（純粋）。"""
    lines = "\n".join(f"{i + 1}. {a['title']}" for i, a in enumerate(articles))
    return (
        "あなたは国際ニュースの編集者です。以下は世界各国のニュース見出しです。\n"
        "いま世界にとって重要な順に、上位の番号だけをカンマ区切りで返してください"
        "（説明不要・番号のみ・最大40件）。\n\n" + lines
    )


def parse_rank(text, articles, top_n=30):
    """応答中の番号（1始まり）を順序付きで article に対応。重複/範囲外は無視し、
    足りなければ元順（recency）で補完。各 article に rank（0始まり）を付与（純粋）。"""
    nums = [int(n) for n in re.findall(r"\d+", text or "")]
    picked, seen = [], set()
    for n in nums:
        idx = n - 1
        if 0 <= idx < len(articles) and idx not in seen:
            seen.add(idx)
            picked.append(idx)
        if len(picked) >= top_n:
            break
    for idx in range(len(articles)):  # 補完
        if len(picked) >= top_n:
            break
        if idx not in seen:
            seen.add(idx)
            picked.append(idx)
    out = []
    for rank, idx in enumerate(picked[:top_n]):
        a = dict(articles[idx])
        a["rank"] = rank
        out.append(a)
    return out
```

- [ ] **Step 4: テスト実行（PASS）**

Run: `python3 -m pytest tests/test_news.py -q -k rank`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add collectors/lib/news_enrich.py tests/test_news.py
git commit -m "feat(news): 重要度ランキング rank_prompt/parse_rank"
```

---

### Task 5: 翻訳・要約・タグ・ジオコード（enrich_prompt / parse_enrich）

**Files:**
- Modify: `collectors/lib/news_enrich.py`
- Test: `tests/test_news.py`

- [ ] **Step 1: 失敗するテストを書く**

```python
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
```

- [ ] **Step 2: テスト実行（FAIL）**

Run: `python3 -m pytest tests/test_news.py -q -k enrich`
Expected: FAIL

- [ ] **Step 3: 実装（news_enrich.py に追記）**

```python
def enrich_prompt(article):
    """1記事→ {title_ja,summary_ja,category,lat,lon,place} を JSON のみで返させる（純粋）。"""
    cats = ", ".join(CATEGORIES)
    return (
        "次のニュース見出しについて、JSON だけを返してください（前後の説明やコードフェンスも可）。\n"
        "キー: title_ja(日本語見出し), summary_ja(1〜2文の日本語要約), "
        f"category({cats} のいずれか1つ), lat(緯度,数値), lon(経度,数値), place(日本語の地名)。\n"
        "出来事の主な発生地の座標を入れてください。場所が特定できない場合は lat/lon を null に。\n\n"
        f"見出し: {article['title']}\n出典: {article.get('source', '')}"
    )


def _extract_json(text):
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except (json.JSONDecodeError, ValueError):
        return None


def parse_enrich(text):
    """enrich 応答を検証済み dict に。必須キー欠落・座標不正は None。category は既知集合に丸め（純粋）。"""
    d = _extract_json(text)
    if not isinstance(d, dict):
        return None
    title = str(d.get("title_ja") or "").strip()
    if not title:
        return None
    try:
        lat = float(d.get("lat"))
        lon = float(d.get("lon"))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    cat = d.get("category")
    if cat not in CATEGORIES:
        cat = "other"
    return {
        "title_ja": title,
        "summary_ja": str(d.get("summary_ja") or "").strip(),
        "category": cat,
        "lat": lat,
        "lon": lon,
        "place": str(d.get("place") or "").strip(),
    }
```

- [ ] **Step 4: テスト実行（PASS）**

Run: `python3 -m pytest tests/test_news.py -q -k enrich`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add collectors/lib/news_enrich.py tests/test_news.py
git commit -m "feat(news): enrich_prompt/parse_enrich"
```

---

### Task 6: 最終整形（finalize_items）

**Files:**
- Modify: `collectors/lib/news_enrich.py`
- Test: `tests/test_news.py`

- [ ] **Step 1: 失敗するテストを書く**

```python
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
```

- [ ] **Step 2: テスト実行（FAIL）**

Run: `python3 -m pytest tests/test_news.py -q -k finalize`
Expected: FAIL

- [ ] **Step 3: 実装（news_enrich.py に追記）**

```python
def finalize_items(items, now_ms, hours=24, cap=30):
    """直近 hours 内に絞り、rank 昇順→time 降順で cap 件（純粋）。"""
    cutoff = now_ms - hours * 3600 * 1000
    kept = [it for it in items if it.get("time", 0) >= cutoff]
    kept.sort(key=lambda it: (it.get("rank", 1_000_000), -it.get("time", 0)))
    return kept[:cap]
```

- [ ] **Step 4: テスト実行（PASS）**

Run: `python3 -m pytest tests/test_news.py -q -k finalize`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add collectors/lib/news_enrich.py tests/test_news.py
git commit -m "feat(news): finalize_items（窓＋rank順＋cap）"
```

---

### Task 7: collector 本体（collectors/news.py）

**Files:**
- Create: `collectors/news.py`
- Test: `tests/test_news.py`

- [ ] **Step 1: 失敗するテストを書く（キーゲート＋mock main）**

```python
import collectors.news as news


def test_main_skips_without_key(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(news, "SNAPSHOT_DIR", str(tmp_path))
    assert news.main() == 0
    assert not os.path.exists(os.path.join(tmp_path, "news.json"))


def test_main_builds_snapshot(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setattr(news, "SNAPSHOT_DIR", str(tmp_path))
    monkeypatch.setattr(news, "load_feeds", lambda: [{"id": "a", "name": "A", "url": "x"}])
    monkeypatch.setattr(news, "fetch_text", lambda url: (
        '<rss><channel>'
        '<item><title>Quake hits Tokyo</title><link>https://e.com/1</link>'
        '<pubDate>Wed, 18 Jun 2026 09:00:00 GMT</pubDate></item>'
        '</channel></rss>'))
    monkeypatch.setattr(news, "_make_client", lambda: object())
    monkeypatch.setattr(news, "_rank", lambda client, arts: "1")
    monkeypatch.setattr(news, "_enrich", lambda client, art: (
        '{"title_ja":"東京で地震","summary_ja":"M6。","category":"disaster",'
        '"lat":35.6,"lon":139.7,"place":"東京"}'))
    monkeypatch.setattr(news, "_now", lambda: datetime(2026, 6, 18, 12, 0, 0, tzinfo=timezone.utc))
    assert news.main() == 0
    with open(os.path.join(tmp_path, "news.json"), encoding="utf-8") as f:
        snap = json.load(f)
    assert snap["items"][0]["title_ja"] == "東京で地震"
    assert snap["items"][0]["category"] == "disaster"
    assert snap["items"][0]["lon"] == 139.7
```

（ファイル先頭の import に `from datetime import datetime, timezone` を追加すること。）

- [ ] **Step 2: テスト実行（FAIL）**

Run: `python3 -m pytest tests/test_news.py -q -k main`
Expected: FAIL

- [ ] **Step 3: 実装**

`collectors/news.py`:
```python
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
```

注: キャッシュ item は `lon/lat` を持つ（前回スナップショット item 形）。`cache.get` 経由でも `enr["lon"]`/`enr["lat"]` が引ける。

- [ ] **Step 4: テスト実行（PASS）**

Run: `python3 -m pytest tests/test_news.py -q -k main`
Expected: PASS（2件: skip / build）

- [ ] **Step 5: 全 pytest 緑を確認**

Run: `python3 -m pytest -q`
Expected: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add collectors/news.py tests/test_news.py
git commit -m "feat(news): collector 本体（キーゲート・2段LLM・URLキャッシュ）"
```

---

### Task 8: カテゴリ定義（js/lib/news_categories.js）

**Files:**
- Create: `js/lib/news_categories.js`
- Test: `tests/news.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/news.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY, categoryOf } from '../js/lib/news_categories.js';

test('CATEGORY: 8カテゴリ・各label/color(RGB3要素)', () => {
  const keys = Object.keys(CATEGORY);
  assert.equal(keys.length, 8);
  for (const k of keys) {
    assert.ok(typeof CATEGORY[k].label === 'string');
    assert.equal(CATEGORY[k].color.length, 3);
  }
});

test('categoryOf: 未知キーは other にフォールバック', () => {
  assert.equal(categoryOf('disaster').label, '災害・事故');
  assert.equal(categoryOf('nope'), CATEGORY.other);
  assert.equal(categoryOf(undefined), CATEGORY.other);
});
```

- [ ] **Step 2: テスト実行（FAIL）**

Run: `node --test tests/news.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`js/lib/news_categories.js`:
```javascript
// ニュースカテゴリの定義（label/color）。news.js と selection.js で共用しimport cycleを避ける。
export const CATEGORY = {
  politics: { label: '政治・外交', color: [120, 170, 255] },
  conflict: { label: '紛争・安全保障', color: [255, 70, 90] },
  disaster: { label: '災害・事故', color: [255, 170, 60] },
  economy: { label: '経済・市場', color: [80, 220, 160] },
  society: { label: '社会', color: [200, 140, 255] },
  science: { label: '科学・技術', color: [90, 220, 255] },
  environment: { label: '環境', color: [150, 220, 90] },
  other: { label: 'その他', color: [180, 190, 205] },
};

export function categoryOf(key) {
  return CATEGORY[key] || CATEGORY.other;
}
```

- [ ] **Step 4: テスト実行（PASS）**

Run: `node --test tests/news.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/news_categories.js tests/news.test.js
git commit -m "feat(news): カテゴリ定義 news_categories.js"
```

---

### Task 9: ニュースレイヤー（js/layers/news.js）＋登録

**Files:**
- Create: `js/layers/news.js`
- Modify: `js/layers/registry.js`
- Test: `tests/news.test.js`

- [ ] **Step 1: 失敗するテストを書く（news.test.js に追記）**

```javascript
import { newsLayer } from '../js/layers/news.js';

const SNAP = { updated: 'x', items: [
  { id: 'u1', url: 'https://www.bbc.com/n/1', source: 'bbcworld', time: 1781784000000,
    title_ja: '東京で地震', summary_ja: 'M6。', category: 'disaster', lon: 139.7, lat: 35.6, place: '東京' },
] };

test('newsLayer.tooltip: カテゴリ＋日本語見出し＋host', () => {
  const s = newsLayer.tooltip(SNAP.items[0]);
  assert.ok(s.includes('災害・事故') && s.includes('東京で地震') && s.includes('bbc.com'));
});

test('newsLayer.toFeedItems: time/lon/lat/カテゴリ付き', () => {
  const f = newsLayer.toFeedItems(SNAP);
  assert.equal(f.length, 1);
  assert.equal(f[0].layerId, 'news');
  assert.equal(f[0].time, 1781784000000);
  assert.ok(f[0].title.includes('災害・事故') && f[0].title.includes('東京で地震'));
});

test('newsLayer.toFeedItems: 空スナップは空配列', () => {
  assert.deepEqual(newsLayer.toFeedItems(null), []);
});
```

- [ ] **Step 2: テスト実行（FAIL）**

Run: `node --test tests/news.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`js/layers/news.js`:
```javascript
// ニュースレイヤー：globe にカテゴリ色のピン（ScatterplotLayer）。クリックで日本語ポップアップ（main.js）。
import { hostnameOf } from '../lib/geo.js';
import { CATEGORY, categoryOf } from '../lib/news_categories.js';

export const newsLayer = {
  id: 'news',
  label: 'ニュース',
  marker: 'dot',
  legend: Object.values(CATEGORY).map((c) => ({ color: `rgb(${c.color.join(',')})`, label: c.label })),
  async fetch(getSnapshot) { return getSnapshot('news'); },
  toDeckLayer(snapshot) {
    const data = (snapshot && snapshot.items) ? snapshot.items : [];
    return new deck.ScatterplotLayer({
      id: 'news', data, pickable: true, radiusUnits: 'pixels',
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6, radiusMinPixels: 4, radiusMaxPixels: 9,
      stroked: true, lineWidthMinPixels: 1.5,
      getFillColor: (d) => [...categoryOf(d.category).color, 225],
      getLineColor: [255, 255, 255, 230],
    });
  },
  tooltip(o) {
    if (!o) return null;
    return `[${categoryOf(o.category).label}] ${o.title_ja}｜${hostnameOf(o.url)}`;
  },
  toFeedItems(snapshot) {
    const items = (snapshot && snapshot.items) ? snapshot.items : [];
    return items.map((d) => ({
      id: d.id,
      time: d.time,
      layerId: 'news',
      lon: d.lon,
      lat: d.lat,
      title: `[${categoryOf(d.category).label}] ${d.title_ja}（${hostnameOf(d.url)}）`,
    }));
  },
};
```

- [ ] **Step 4: registry.js に登録**

`js/layers/registry.js`:
- import 追加: `import { newsLayer } from './news.js';`
- `layers` 配列末尾に `newsLayer` を追加。
- `DECK_TO_LAYER` に `news: 'news',` を追加。
- `DESCRIPTIONS` に `news: '世界の重要ニュース（厳選RSS→日本語訳・色=カテゴリ）',` を追加。

- [ ] **Step 5: テスト実行（PASS）＋ registry テスト緑**

Run: `node --test tests/news.test.js tests/registry.test.js`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add js/layers/news.js js/layers/registry.js tests/news.test.js
git commit -m "feat(news): ニュースレイヤー描画＋registry登録"
```

---

### Task 10: クリック日本語ポップアップ（selection.js / main.js）＋sw

**Files:**
- Modify: `js/lib/selection.js`
- Modify: `js/main.js`
- Modify: `sw.js`
- Test: `tests/news.test.js`

- [ ] **Step 1: 失敗するテストを書く（news.test.js に追記）**

```javascript
import { newsPopupHtml } from '../js/lib/selection.js';

test('newsPopupHtml: 見出し・要約・カテゴリ・出典リンク・XSSエスケープ', () => {
  const html = newsPopupHtml({
    title_ja: '<b>東京</b>で地震', summary_ja: 'M6。', category: 'disaster',
    url: 'https://www.bbc.com/n/1', place: '東京',
  });
  assert.ok(html.includes('&lt;b&gt;東京&lt;/b&gt;')); // エスケープ
  assert.ok(html.includes('M6。') && html.includes('災害・事故'));
  assert.ok(html.includes('href="https://www.bbc.com/n/1"') && html.includes('bbc.com'));
});
```

- [ ] **Step 2: テスト実行（FAIL）**

Run: `node --test tests/news.test.js`
Expected: FAIL

- [ ] **Step 3: 実装（selection.js）**

`js/lib/selection.js`:
- import 追加（先頭付近）:
```javascript
import { hostnameOf } from './geo.js';
import { categoryOf } from './news_categories.js';
```
- 末尾に追加:
```javascript
// ニュースピンのクリック用ポップアップ（日本語見出し＋要約＋カテゴリ＋出典リンク）。
export function newsPopupHtml(p) {
  const o = p || {};
  const c = categoryOf(o.category);
  const dot = `rgb(${c.color.join(',')})`;
  const host = hostnameOf(o.url);
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">${escapeHtml(o.title_ja || '')}</span></div>`
    + `<div class="sel-meta">${escapeHtml(c.label)}${o.place ? '｜' + escapeHtml(o.place) : ''}</div>`
    + (o.summary_ja ? `<div class="sel-hint">${escapeHtml(o.summary_ja)}</div>` : '')
    + `<div class="sel-hint"><a class="sel-link" style="color:#7fd8ff" href="${escapeHtml(o.url || '')}"`
    + ` target="_blank" rel="noopener">${escapeHtml(host)} ↗</a></div>`
    + '</div>';
}
```
（`geo.js` に `hostnameOf` が存在することは conflict.js で使用済み。`escapeHtml` は selection.js 内に既存。）

- [ ] **Step 4: テスト実行（PASS）**

Run: `node --test tests/news.test.js`
Expected: PASS

- [ ] **Step 5: main.js のクリック分岐に news を追加**

`js/main.js`:
- import に `newsPopupHtml` を追加:
```javascript
import { selectionPopupHtml, buildReticleConfigs, flightPopupHtml, shipPopupHtml, newsPopupHtml, buildProjectionConfigs } from './lib/selection.js';
```
- onClick コールバック（`ships` 分岐の直後）に追加。クリックで現地へ flyTo＋ポップアップ＋着地リティクル:
```javascript
      if (info.layer.id === 'news') {
        const p = info.object;
        selectedFlight = null;
        selectedShip = null;
        selected = { lon: p.lon, lat: p.lat, title: p.title_ja, layerId: 'news', at: performance.now() };
        if (window.__orbis) window.__orbis.selected = selected;
        map.flyTo({ center: [p.lon, p.lat], zoom: 4, duration: 1500, essential: true });
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(newsPopupHtml(p)).addTo(map);
        drawAll(overlay);
      }
```
（`selected` は feed クリックで使われている既存のモジュール変数。news クリックでも同じ着地リティクル機構を使う。）

- [ ] **Step 6: counts に items を加える（パネルのニュース件数表示用）**

`js/main.js` の `window.__orbis.counts` 計算（`v.points?.length ?? v.features?.length` の連鎖）に `items` を追加する。現状:
```javascript
      (v && (v.points?.length ?? v.features?.length
        ?? (Array.isArray(v.temps) ? v.temps.filter((t) => t != null).length : 0))) ?? 0])
```
を次に変更:
```javascript
      (v && (v.points?.length ?? v.features?.length ?? v.items?.length
        ?? (Array.isArray(v.temps) ? v.temps.filter((t) => t != null).length : 0))) ?? 0])
```

- [ ] **Step 7: sw.js の CACHE を上げる（main.js は SHELL）**

`js/main.js` は SHELL キャッシュ対象のため必須。`sw.js`:
```javascript
const CACHE = 'orbis-v28';
```

- [ ] **Step 8: 全 node テスト緑**

Run: `node --test tests/*.test.js`
Expected: 全 PASS

- [ ] **Step 9: コミット**

```bash
git add js/lib/selection.js js/main.js sw.js tests/news.test.js
git commit -m "feat(news): クリックで日本語ポップアップ＋flyTo（sw v28）"
```

---

### Task 11: 配線（collect.yml / requirements.txt）＋ e2e

**Files:**
- Modify: `collect.yml`
- Modify: `requirements.txt`
- Modify: `tests/e2e/smoke.spec.js`

- [ ] **Step 1: requirements.txt に anthropic 追加**

`requirements.txt` 末尾:
```
anthropic>=0.39.0
```

- [ ] **Step 2: collect.yml に news 手順を追加（キーゲート）**

`.github/workflows/collect.yml` の「Collect ships」ステップの後に追加:
```yaml
      - name: Collect news
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: python -m collectors.news || echo "news skipped"
```

- [ ] **Step 3: smoke.spec.js のレイヤー数を 9→10 に更新し news 検証を追加**

`tests/e2e/smoke.spec.js`:
- レイヤー行数のアサーションを更新:
```javascript
  // 左パネルに10レイヤー行（地震/航空/紛争/抗議/貿易/水温/海流/気温/船舶/ニュース）
  await expect(page.locator('#panel .layer-row')).toHaveCount(10);
```
- ファイル末尾の閉じ括弧の手前に news 検証を追加（ships 検証と同型・データが無くても例外を出さない）:
```javascript
  // ニュース(news)は既定ON。データがあれば deck レイヤーが描画される（無い環境でも例外なし）。
  await expect(page.locator('.layer-row[data-id="news"] .layer-toggle')).toBeChecked();
  const newsLayerOk = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    const has = window.__orbis.counts && window.__orbis.counts.news > 0;
    const present = ((o._props && o._props.layers) || []).some((l) => l.id === 'news');
    return !has || present;
  });
  expect(newsLayerOk).toBe(true);
```

- [ ] **Step 4: 全テスト緑**

Run: `python3 -m pytest -q && node --test tests/*.test.js && npx playwright test`
Expected: 全 PASS（pytest・node・Playwright 3）

- [ ] **Step 5: コミット**

```bash
git add collect.yml requirements.txt tests/e2e/smoke.spec.js
git commit -m "feat(news): collect.yml/requirements/e2e 配線（パネル10行）"
```

---

## 完了後

- main へ統合し push → Vercel 自動デプロイ。
- 本番初期データはオーナーがローカルで `ANTHROPIC_API_KEY` を設定して `python -m collectors.news` を実行→`data/snapshots/news.json` を commit/push（vectors/サムネと同じローカル seed 手順）。または GitHub に `ANTHROPIC_API_KEY` Secret を設定し `gh workflow run collect.yml`。
- 本番 curl で `js/layers/news.js` 200・`sw.js` v28・パネル10行を確認。実機サニティ（globe にピン・クリックで日本語ポップアップ・フィードにニュース）。

## Self-Review メモ

- スペックの `merge_window(prev,new)` は、表示は毎サイクル新鮮な上位30に統一する方針のため **`finalize_items`（窓＋rank順＋cap）** に簡素化。前回スナップショットは **enrich の URL キャッシュ**として `_load_prev_cache` で再利用（再翻訳回避）。
- スペックの CATEGORY は cycle 回避のため **`js/lib/news_categories.js`** に分離（news.js / selection.js で共用）。
- main.js は SHELL ゆえ **sw v28** 必須。registry/news/news_categories/selection は SHELL 外。
- 座標を返せない記事は parse_enrich が None → ピン化せず除外（v1・スペック準拠）。
