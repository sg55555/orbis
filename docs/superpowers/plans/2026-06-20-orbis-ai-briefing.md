# AIインテリジェンス基盤＋ワールド・ブリーフィング Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** メディアの下に `#ai-brief` セクションを追加し、既存スナップショット（news＋conflict/protests/quakes）を毎時 Sonnet で合成した「ワールド・ブリーフィング」（俯瞰リード＋トップ展開カード）を表示する。

**Architecture:** 既存スナップショット方式（cron Python → `data/snapshots/*.json` → 静的クライアント）。再利用バックボーン `collectors/lib/intel.py`（純粋）＋ `config/briefing_sources.json` で入力層を集約 → 1 回の Sonnet 合成 → `data/snapshots/briefing.json` → `js/ui/briefing.js` が描画、カードクリックで globe flyTo。

**Tech Stack:** Python（collectors・anthropic・既存）/ Vanilla JS ESM / node --test / Playwright / GitHub Actions cron。

参照 spec: `docs/superpowers/specs/2026-06-20-orbis-ai-briefing-design.md`

## Global Constraints

- AI は GitHub Actions cron で実行。`ANTHROPIC_API_KEY` 未設定は **skip exit0**（news/ships 同型）。
- 合成モデル＝**`claude-sonnet-4-6`・`temperature=0`**。
- **グラウンディング**：渡したスナップショット内の事実のみ使用・**捏造禁止・予測/助言なし**・出典 url は **http(s) のみ**・座標は入力データ由来のみ。
- カテゴリは既存 `js/lib/news_categories.js` の 8 種（`politics/conflict/disaster/economy/society/science/environment/other`）。severity は 1–5。**cards 上限 `MAX_CARDS=10`**。
- 出力 `data/snapshots/briefing.json` の時刻キーは他層と揃え **`updated`**（spec の generated_at をこの名に統一）。
- クライアント：`#ai-brief` は `#media` の後ろ（ページスクロール内）。カード click → `selection.js` で flyTo＋リティクル（`layerId:'brief'`・座標ありのみ）。
- SW はネットワーク優先（新規ファイルは初回ネット取得・SHELL 変更も配信される。CACHE 版上げは不要）。
- **worktree `worktree-ai-briefing` で実装**。統合は main ツリーで cherry-pick/merge→push。
- DRY / YAGNI / TDD / こまめな commit。コミット末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

## File Structure
- Create: `collectors/lib/intel.py` — build_context / parse_brief / briefing_prompt / BRIEFING_SYSTEM（純粋＋プロンプト）
- Create: `config/briefing_sources.json` — 合成対象スナップショットと圧縮設定
- Create: `collectors/briefing.py` — 収集オーケストレーション（キーゲート・Sonnet・書き出し）
- Create: `.github/workflows/collect-briefing.yml` — 毎時 cron
- Create: `js/ui/briefing.js` — 描画＋純粋ヘルパ（briefCards / cardColorCss）
- Create(test): `tests/test_intel.py`, `tests/briefing.test.js`, `tests/e2e/briefing.spec.js`
- Modify: `index.html`（#ai-brief）, `js/main.js`（import＋fetch＋render＋flyTo 配線）, `css/orbis.css`（#ai-brief スタイル）
- データ: `data/snapshots/briefing.json`（cron 生成。ローカル/e2e は seed/mock）

---

### Task 1: バックボーン `collectors/lib/intel.py`（build_context / parse_brief / prompt）

**Files:**
- Create: `collectors/lib/intel.py`
- Test: `tests/test_intel.py`

**Interfaces:**
- Produces:
  - `build_context(snapshots: dict, sources_cfg: list) -> str`（各層を config どおり圧縮した合成用テキスト）
  - `parse_brief(text: str) -> dict`（LLM 出力→`{"lead": str, "cards": list}`・検証/クランプ）
  - `BRIEFING_SYSTEM: str`、`briefing_prompt(context: str, max_cards: int = 10) -> str`
  - `CATEGORIES: set`、`MAX_CARDS: int = 10`

- [ ] **Step 1: 失敗テストを書く**

`tests/test_intel.py`:

```python
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
```

- [ ] **Step 2: 失敗を確認**

Run: `uv run pytest tests/test_intel.py -q`
Expected: FAIL（`collectors.lib.intel` 無し → ImportError）

- [ ] **Step 3: intel.py を実装**

`collectors/lib/intel.py`:

```python
"""AIインテリジェンス基盤（純粋）。スナップショット集約とLLM出力検証。後続サブPJも再利用。"""
import json
import re

CATEGORIES = {"politics", "conflict", "disaster", "economy", "society",
              "science", "environment", "other"}
MAX_CARDS = 10

BRIEFING_SYSTEM = (
    "あなたは地政学アナリストです。与えられたデータ（ニュース見出し・要約と、"
    "紛争/抗議/地震の集計）のみを根拠に、現在の世界情勢を日本語で合成します。"
    "データに無い出来事を作らない（捏造禁止）。予測・助言はしない（現状の俯瞰のみ）。"
    "出力は厳格な JSON のみ。"
)


def build_context(snapshots: dict, sources_cfg: list) -> str:
    """各スナップショットを config どおり圧縮し、合成用の簡潔テキストに。"""
    blocks = []
    for src in sources_cfg:
        snap = snapshots.get(src["id"])
        if not snap:
            continue
        rows = snap.get(src.get("key", "items"), []) or []
        count = snap.get("count", len(rows))
        if src.get("group_by"):
            gb, w = src["group_by"], src.get("weight")
            agg: dict = {}
            for r in rows:
                k = r.get(gb)
                if not k:
                    continue
                agg[k] = agg.get(k, 0) + (float(r.get(w, 1) or 0) if w else 1)
            top = sorted(agg.items(), key=lambda kv: kv[1], reverse=True)[: src.get("top", 8)]
            tops = ", ".join(f"{k}({int(v)})" for k, v in top)
            blocks.append(f"[{src['id']}] count={count}; top by {gb}: {tops}")
        else:
            if src.get("sort_by"):
                rows = sorted(rows, key=lambda r: r.get(src["sort_by"], 0) or 0, reverse=True)
            rows = rows[: src.get("take", 10)]
            fields = src.get("fields", [])
            lines = ["  - " + "; ".join(f"{f}={r.get(f)}" for f in fields) for r in rows]
            blocks.append(f"[{src['id']}] count={count}\n" + "\n".join(lines))
    return "\n\n".join(blocks)


def _strip_fence(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n", "", t)
        t = re.sub(r"\n```$", "", t).strip()
    return t


def parse_brief(text: str) -> dict:
    """LLM 出力を検証し {lead, cards} に整形（捏造・XSS・範囲外を弾く）。"""
    try:
        data = json.loads(_strip_fence(text))
    except (json.JSONDecodeError, TypeError):
        return {"lead": "", "cards": []}
    if not isinstance(data, dict):
        return {"lead": "", "cards": []}
    lead = data.get("lead", "")
    if not isinstance(lead, str):
        lead = ""
    out = []
    for c in (data.get("cards") or [])[:MAX_CARDS]:
        if not isinstance(c, dict) or not c.get("title_ja"):
            continue
        cat = c.get("category")
        if cat not in CATEGORIES:
            cat = "other"
        try:
            sev = max(1, min(5, int(c.get("severity", 3))))
        except (TypeError, ValueError):
            sev = 3
        card = {"title_ja": str(c["title_ja"]), "summary_ja": str(c.get("summary_ja", "")),
                "category": cat, "severity": sev}
        lat, lon = c.get("lat"), c.get("lon")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) \
                and -90 <= lat <= 90 and -180 <= lon <= 180:
            card["lat"], card["lon"] = float(lat), float(lon)
            if c.get("place"):
                card["place"] = str(c["place"])
        srcs = []
        for s in (c.get("sources") or []):
            url = s.get("url") if isinstance(s, dict) else None
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                srcs.append({"title": str(s.get("title", "")), "url": url})
        card["sources"] = srcs
        out.append(card)
    return {"lead": lead, "cards": out}


def briefing_prompt(context: str, max_cards: int = MAX_CARDS) -> str:
    return (
        "次のデータから、(1) 現在の世界の俯瞰を2〜4文の日本語で 'lead' に、"
        f"(2) 重要な展開を最大{max_cards}件 'cards' に（全ソース横断で重複排除し重要度順）。"
        "各cardは {title_ja, summary_ja(1〜2文), category("
        "politics|conflict|disaster|economy|society|science|environment|other), "
        "severity(1-5), lat, lon, place, sources:[{title,url}]}。"
        "座標と出典は入力データに在るものだけを使う（無ければ省略）。JSON のみ返す。\n\n"
        f"=== データ ===\n{context}"
    )
```

- [ ] **Step 4: テストが通ることを確認**

Run: `uv run pytest tests/test_intel.py -q`
Expected: PASS（6 件）

- [ ] **Step 5: Commit**

```bash
git add collectors/lib/intel.py tests/test_intel.py
git commit -m "feat(intel): ブリーフィング基盤 build_context/parse_brief/prompt（純粋・捏造/XSS/範囲ガード）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 収集 `collectors/briefing.py` ＋ config ＋ cron workflow

**Files:**
- Create: `config/briefing_sources.json`
- Create: `collectors/briefing.py`
- Create: `.github/workflows/collect-briefing.yml`

**Interfaces:**
- Consumes: `collectors.lib.intel`（Task 1）、`collectors.lib.manifest.update_manifest`（既存）。
- Produces: `data/snapshots/briefing.json` = `{updated, model, lead, cards[]}`。

- [ ] **Step 1: config を作成**

`config/briefing_sources.json`:

```json
[
  {"id": "news", "file": "news.json", "key": "items", "take": 18, "fields": ["title_ja", "summary_ja", "category", "place"]},
  {"id": "quakes", "file": "quakes.json", "key": "points", "sort_by": "mag", "take": 5, "fields": ["mag", "place"]},
  {"id": "conflict", "file": "conflict.json", "key": "points", "group_by": "place", "weight": "mentions", "top": 8},
  {"id": "protests", "file": "protests.json", "key": "points", "group_by": "place", "weight": "mentions", "top": 8}
]
```

- [ ] **Step 2: briefing.py を作成**

`collectors/briefing.py`:

```python
"""既存スナップショットを毎時 Sonnet で合成 → ワールド・ブリーフィング（キーゲート）。"""
import json
import os
from datetime import datetime, timezone

from collectors.lib.manifest import update_manifest
from collectors.lib.intel import build_context, parse_brief, briefing_prompt, BRIEFING_SYSTEM

SNAPSHOT_DIR = "data/snapshots"
CONFIG_PATH = "config/briefing_sources.json"
MODEL = "claude-sonnet-4-6"


def _load_snapshots(cfg, snap_dir):
    snaps = {}
    for src in cfg:
        p = os.path.join(snap_dir, src["file"])
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    snaps[src["id"]] = json.load(f)
            except (json.JSONDecodeError, OSError):
                pass
    return snaps


def _ask(prompt):
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=MODEL, max_tokens=1500, temperature=0,
        system=BRIEFING_SYSTEM, messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("[briefing] ANTHROPIC_API_KEY not set; skip")
        return 0
    out_dir = os.path.abspath(SNAPSHOT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    snap_path = os.path.join(out_dir, "briefing.json")
    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
        snaps = _load_snapshots(cfg, out_dir)
        if "news" not in snaps:
            print("[briefing] no news snapshot; skip")
            return 1
        brief = parse_brief(_ask(briefing_prompt(build_context(snaps, cfg))))
        if not brief["lead"] and not brief["cards"]:
            print("[briefing] empty result; keeping previous")
            return 1
    except Exception as e:  # 全体失敗は前回温存
        print(f"[briefing] failed: {e}; keeping previous")
        return 1
    snap = {"updated": now_iso, "model": MODEL, "lead": brief["lead"], "cards": brief["cards"]}
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)
    update_manifest(os.path.join(out_dir, "manifest.json"), "briefing", now_iso, len(brief["cards"]))
    print(f"[briefing] wrote lead + {len(brief['cards'])} cards -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: キー未設定で skip（exit0）を確認**

Run: `cd <repo> && env -u ANTHROPIC_API_KEY uv run python -m collectors.briefing; echo "exit=$?"`
Expected: `[briefing] ANTHROPIC_API_KEY not set; skip` ＋ `exit=0`

- [ ] **Step 4: cron workflow を作成**

`.github/workflows/collect-briefing.yml`:

```yaml
name: collect-briefing
on:
  schedule:
    - cron: '17 * * * *'      # 毎時:17（collect/collect-slow と別オフセット）
  workflow_dispatch: {}
permissions:
  contents: write
concurrency:
  group: collect              # collect/collect-slow と共有して直列化（push 競合回避）
  cancel-in-progress: false
jobs:
  briefing:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-python@v6
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt
      - name: Collect briefing
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: python -m collectors.briefing || echo "briefing skipped"
      - name: Commit snapshot
        run: |
          git config user.name "orbis-bot"
          git config user.email "210495115+sg55555@users.noreply.github.com"
          git add data/snapshots/*.json
          if git diff --cached --quiet; then
            echo "no changes"
          else
            git commit -m "data: refresh briefing [skip ci]"
            git pull --rebase origin main
            git push
          fi
```

- [ ] **Step 5: Commit**

```bash
git add config/briefing_sources.json collectors/briefing.py .github/workflows/collect-briefing.yml
git commit -m "feat(briefing): 毎時Sonnet合成コレクタ＋config＋cron（キーゲート）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: クライアント `js/ui/briefing.js`（描画＋純粋ヘルパ）

**Files:**
- Create: `js/ui/briefing.js`
- Test: `tests/briefing.test.js`

**Interfaces:**
- Consumes: `categoryOf`（`js/lib/news_categories.js` 既存）。
- Produces: `briefCards(brief) -> array`、`cardColorCss(category) -> "rgb(r,g,b)"`、`renderBriefing(rootEl, brief, {onSelect}) -> {count}`。

- [ ] **Step 1: 失敗テストを書く**

`tests/briefing.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefCards, cardColorCss } from '../js/ui/briefing.js';

test('briefCards: cards 配列を返す・空安全', () => {
  assert.deepEqual(briefCards({ cards: [{ title_ja: 'a' }] }).map((c) => c.title_ja), ['a']);
  assert.deepEqual(briefCards(null), []);
  assert.deepEqual(briefCards({}), []);
});

test('cardColorCss: カテゴリ色を rgb 文字列に（news_categories 再利用）', () => {
  assert.equal(cardColorCss('conflict'), 'rgb(255,70,90)');
  assert.equal(cardColorCss('zzz'), 'rgb(180,190,205)'); // 未知→other
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/briefing.test.js`
Expected: FAIL（`js/ui/briefing.js` 無し）

- [ ] **Step 3: briefing.js を実装**

`js/ui/briefing.js`:

```js
// AI ワールド・ブリーフィング描画。lead＋カード（カテゴリ色/severity）。座標ありカードは onSelect。
import { categoryOf } from '../lib/news_categories.js';

export function briefCards(brief) {
  return (brief && Array.isArray(brief.cards)) ? brief.cards : [];
}

export function cardColorCss(category) {
  const [r, g, b] = categoryOf(category).color;
  return `rgb(${r},${g},${b})`;
}

// rootEl=#ai-brief（.brief-lead と .brief-cards を内包）。onSelect(card) は座標ありカードのクリック。
export function renderBriefing(rootEl, brief, { onSelect } = {}) {
  const leadEl = rootEl.querySelector('.brief-lead');
  const cardsEl = rootEl.querySelector('.brief-cards');
  if (leadEl) leadEl.textContent = (brief && brief.lead) || '';
  cardsEl.innerHTML = '';
  for (const c of briefCards(brief)) {
    const el = document.createElement('button');
    el.className = 'brief-card';
    el.dataset.severity = c.severity || 3;
    el.style.setProperty('--cat', cardColorCss(c.category));
    const cat = categoryOf(c.category);
    el.innerHTML = '<span class="brief-dot"></span><div class="brief-body">'
      + '<div class="brief-title"></div><div class="brief-sum"></div>'
      + '<div class="brief-meta"></div></div>';
    el.querySelector('.brief-title').textContent = c.title_ja || '';
    el.querySelector('.brief-sum').textContent = c.summary_ja || '';
    el.querySelector('.brief-meta').textContent = cat.label + (c.place ? `｜${c.place}` : '');
    if (typeof c.lat === 'number' && typeof c.lon === 'number' && onSelect) {
      el.addEventListener('click', () => onSelect(c));
    } else {
      el.classList.add('no-loc');
    }
    cardsEl.appendChild(el);
  }
  return { count: briefCards(brief).length };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/briefing.test.js` → PASS（2 件）。続けて `npm run test:js` で全 js unit 緑（回帰なし）。

- [ ] **Step 5: Commit**

```bash
git add js/ui/briefing.js tests/briefing.test.js
git commit -m "feat(briefing): クライアント描画＋純粋ヘルパ（カテゴリ色再利用）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 統合（index.html ＋ main.js ＋ css）

**Files:**
- Modify: `index.html`（`#media` セクションの直後に `#ai-brief`）
- Modify: `js/main.js`（import＋fetch＋render＋flyTo 配線）
- Modify: `css/orbis.css`（`#ai-brief` スタイル）

**Interfaces:**
- Consumes: `renderBriefing`（Task 3）、`data/snapshots/briefing.json`（Task 2）、既存 `map`/`selected`/`drawAll`/`overlay`（main.js スコープ）。
- Produces: グローバル `window.__orbis.brief`（e2e/デバッグ）。

- [ ] **Step 1: index.html に #ai-brief を追加**

`index.html` の `</section>`（`#media` の閉じ）直後に追加:

```html
      <section id="ai-brief" class="brief-section">
        <div class="brief-head">
          <h3 class="brief-h">🧭 ワールド・ブリーフィング</h3>
          <span class="brief-note">AI 合成・出典付き／毎時更新</span>
        </div>
        <p class="brief-lead">—</p>
        <div class="brief-cards"></div>
      </section>
```

- [ ] **Step 2: main.js に import を追加**

`js/main.js` の `import { renderMedia } ...` 付近に追加:

```js
import { renderBriefing } from './ui/briefing.js';
```

- [ ] **Step 3: main.js にブリーフィング配線を追加**

`js/main.js` のメディア配線ブロックの後（`mediaRoot` の try/catch の後あたり）に追加:

```js
    // AI ワールド・ブリーフィング（毎時 Sonnet 合成・メディアの下）。
    const briefRoot = document.getElementById('ai-brief');
    try {
      const brief = await fetch('data/snapshots/briefing.json').then((r) => r.json()).catch(() => null);
      if (brief && (brief.lead || (brief.cards && brief.cards.length)) && briefRoot) {
        renderBriefing(briefRoot, brief, {
          onSelect: (c) => {
            map.flyTo({ center: [c.lon, c.lat], zoom: 4, duration: 1500, essential: true });
            selected = { lon: c.lon, lat: c.lat, title: c.title_ja, layerId: 'brief', at: performance.now() };
            if (window.__orbis) window.__orbis.selected = selected;
            drawAll(overlay);
          },
        });
        if (window.__orbis) window.__orbis.brief = brief;
      } else if (briefRoot) {
        briefRoot.style.display = 'none';
      }
    } catch {
      if (briefRoot) briefRoot.style.display = 'none';
    }
```

- [ ] **Step 4: css/orbis.css にスタイルを追加**

`css/orbis.css` の末尾付近（メディア関連の後）に追加:

```css
#ai-brief.brief-section { width: 100%; max-width: 1100px; margin: 0 auto; padding: 28px 18px 60px; }
.brief-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.brief-h { margin: 0; font-size: 18px; color: var(--text); }
.brief-note { font-size: 11px; color: rgba(190, 208, 228, .7); }
.brief-lead { color: var(--text); line-height: 1.7; font-size: 15px; margin: 0 0 16px;
  background: rgba(10, 16, 28, .5); border: 1px solid var(--glass-rim); border-radius: 10px; padding: 12px 14px; }
.brief-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.brief-card { text-align: left; display: flex; gap: 10px; padding: 10px 12px; cursor: pointer;
  background: rgba(10, 16, 28, .55); border: 1px solid var(--glass-rim);
  border-left: 3px solid var(--cat, #7aa); border-radius: 10px; color: var(--text); font: inherit; }
.brief-card.no-loc { cursor: default; }
.brief-card[data-severity="5"] { box-shadow: 0 0 12px color-mix(in srgb, var(--cat) 45%, transparent); }
.brief-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--cat); flex: 0 0 auto; margin-top: 5px;
  box-shadow: 0 0 6px var(--cat); }
.brief-title { font-size: 14px; font-weight: 600; line-height: 1.45; }
.brief-sum { font-size: 12.5px; color: rgba(220, 230, 244, .85); line-height: 1.5; margin-top: 3px; }
.brief-meta { font-size: 11px; color: rgba(190, 208, 228, .7); margin-top: 5px; }
@media (max-width: 768px) { #ai-brief.brief-section { padding: 20px 12px 48px; } }
```

- [ ] **Step 5: 構文・回帰確認**

Run: `node --check js/main.js && npm run test:js`
Expected: 構文 OK・js unit 全緑。

- [ ] **Step 6: Commit**

```bash
git add index.html js/main.js css/orbis.css
git commit -m "feat(briefing): #ai-brief セクション＋main.js配線（カードflyTo）＋css

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: e2e（構造＋カード flyTo）＋ ローカル視覚サニティ

**Files:**
- Create: `tests/e2e/briefing.spec.js`

**Interfaces:**
- Consumes: `#ai-brief` / `.brief-lead` / `.brief-card` / `window.__orbis.map`（既存）。

- [ ] **Step 1: e2e spec を書く（briefing.json は route で mock）**

`tests/e2e/briefing.spec.js`:

```js
import { test, expect } from '@playwright/test';

const FIXTURE = {
  updated: '2026-06-20T07:00:00Z', model: 'claude-sonnet-4-6',
  lead: '世界は複数地域で緊張が続いている。',
  cards: [
    { title_ja: 'キーウ近郊で衝突', summary_ja: '…', category: 'conflict', severity: 5, lat: 50.45, lon: 30.52, place: 'キーウ', sources: [{ title: 's', url: 'https://e.com/a' }] },
    { title_ja: '世界経済の見通し', summary_ja: '…', category: 'economy', severity: 2, sources: [] },
  ],
};

test('briefing: #ai-brief が lead＋カードを描画・座標カードで flyTo', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/data/snapshots/briefing.json**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXTURE) }));
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  await expect(page.locator('#ai-brief .brief-lead')).toContainText('緊張が続いている');
  await expect(page.locator('#ai-brief .brief-card')).toHaveCount(2);

  // 座標ありカードクリック → globe 中心が変化（flyTo）
  await page.locator('#ai-brief').scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.__orbis.map.getCenter());
  await page.locator('#ai-brief .brief-card:not(.no-loc)').first().click();
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => window.__orbis.map.getCenter());
  expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);

  // 座標なしカードは .no-loc（クリック非活性）
  await expect(page.locator('#ai-brief .brief-card.no-loc')).toHaveCount(1);
});
```

- [ ] **Step 2: e2e を実行**

Run: `npx playwright test briefing`
Expected: PASS（1 spec）。

- [ ] **Step 3: e2e 全体で回帰確認**

Run: `npm run test:e2e`
Expected: 全 PASS（既存＋briefing）。

- [ ] **Step 4: ローカル視覚サニティ（seed→目視→削除）**

```bash
# サンプル briefing.json を一時生成して見た目を確認（コミットしない）
cat > data/snapshots/briefing.json <<'JSON'
{"updated":"2026-06-20T07:00:00Z","model":"claude-sonnet-4-6","lead":"中東で停戦の綻び、東欧で戦線膠着、アジアで地震が相次ぐ。","cards":[
 {"title_ja":"ガザで停戦違反の報告","summary_ja":"国連が市民被害を指摘。","category":"conflict","severity":5,"lat":31.5,"lon":34.47,"place":"ガザ","sources":[{"title":"Al Jazeera","url":"https://www.aljazeera.com/"}]},
 {"title_ja":"日本でM5.2の地震","summary_ja":"被害情報は確認中。","category":"disaster","severity":3,"lat":38.0,"lon":140.9,"place":"東北","sources":[]},
 {"title_ja":"主要中銀の利上げ観測","summary_ja":"市場は神経質な値動き。","category":"economy","severity":2,"sources":[]}
]}
JSON
python3 -m http.server 8000   # http://localhost:8000 で #ai-brief を目視（lead＋3カード・色/severity・カードクリックflyTo）
# 確認後、seed を破棄（cron 実データに任せる）
git checkout -- data/snapshots/briefing.json 2>/dev/null || rm -f data/snapshots/briefing.json
```
Expected: メディアの下に `#ai-brief`・lead＋3 カード（conflict 赤/disaster 橙/economy 緑）・severity5 にグロー・座標カードクリックで flyTo・エラー 0。

- [ ] **Step 5: Commit（e2e のみ）**

```bash
git add tests/e2e/briefing.spec.js
git commit -m "test(e2e): briefing 構造＋カードflyTo（briefing.json は route mock）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage（spec → タスク）:**
- §3 アーキ（cron→intel→snapshot→client）→ T1/T2/T3/T4。✓
- §3 再利用バックボーン（build_context/parse_brief・config）→ T1/T2。✓
- §4 出力スキーマ（updated/model/lead/cards）→ T2（`updated` に統一・本 plan Global Constraints に明記）。✓
- §5 グラウンディング（捏造禁止/予測なし/出典http(s)/座標実データ）→ T1（BRIEFING_SYSTEM/briefing_prompt/parse_brief のガード）。✓
- §6 UI（#ai-brief/lead/cards/flyTo）→ T3/T4。✓
- §7 コスト/頻度（毎時 Sonnet・cron）→ T2。✓
- §8 テスト（pytest/node/Playwright）→ T1/T3/T5。✓
- §9 DoD → T5（e2e＋視覚サニティ）＋実行後の本番（key 設定はオーナー）。✓

**2. Placeholder scan:** TBD/TODO 無し。各ステップに実コード・実コマンド・期待値。✓

**3. Type consistency:** `build_context(snapshots, sources_cfg)`／`parse_brief(text)->{lead,cards}`／`briefing_prompt(context,max_cards)`／`BRIEFING_SYSTEM`／`MAX_CARDS` は T1 定義と T2 利用が一致。`briefCards`/`cardColorCss`/`renderBriefing` は T3 定義と T4/T5 利用が一致。snapshot キー（news=`items`、quakes/conflict/protests=`points`）は config と実スナップショットに一致。出力 `cards[]` フィールド（title_ja/summary_ja/category/severity/lat/lon/place/sources）は parse_brief 出力と briefing.js 描画が一致。✓

**逸脱メモ:** spec の `generated_at` を、他スナップショット・manifest・鮮度 UI と揃えるため出力では `updated` に統一（client は時刻を表示に使わないため影響なし）。
