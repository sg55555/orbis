# Phase A Implementation Plan — part3（Task 7〜9）

骨格 `2026-09-03-orbis-enterprise-phase-a.md` の契約に従う（Global Constraints・File Structure・Interfaces・文言 verbatim・コミット規約はすべて骨格が正）。

## 分冊間の前提（part1／part2 との接続・この 4 点を契約として扱う）

1. **Task 6 適用後のコードを前提にする**：`js/ui/instability.js` 61/64・`js/ui/forecast.js` 51/59/63・`js/ui/feed.js` 15/20/21/47・`js/lib/selection.js` 43/61/154/170/174/194/197/212 のテンプレート内 `style="…"` は **`data-style="…"` に置換済み**（値は不変）。本分冊の「置換前」はすべて `data-style=` 表記で書く。
2. **`window.__orbis` は従来どおり無条件に生える**（part2 が骨格から読み替えた点）。Task 4 の `?e2e=1` フックは加算式＝`window.__orbis.e2e = { map, overlay }` を足すだけで、`window.__orbis = { map, overlay, counts: {} }` は消えない。よって Task 7 の `_aiSnaps` 導入は「壊れるから」ではなく **`updateFreshness()` が boot 前のスコープに居て AI スナップショットを持てないから**（既存の `_insCountries` と同じ理由）。ついでにデータ経路を 1 本にする。
3. **Task 2 が `tests/test_pages.py` に置く xfail 2 件**（Task 8 で解除する・逐語）：
   - `@pytest.mark.xfail(strict=True, reason="Task 8（part3）が youtube-nocookie 化したら緑（Task 8 でこの行を削除する）")` ＋ `def test_no_youtube_com_embed_in_served_code():`
   - `@pytest.mark.xfail(strict=True, reason="Task 8（part3）が rel を noopener noreferrer にしたら緑（Task 8 でこの行を削除する）")` ＋ `def test_external_links_are_noopener_noreferrer():`
   - `import pytest` は `@pytest.mark.parametrize` が多数あるので**残す**。
4. **Task 6 が `tests/test_static_guards.py` に置く xfail 1 件**（Task 9 で解除する・逐語）：
   ```python
   @pytest.mark.xfail(
       strict=True,
       reason="Task 9 の `git rm --cached` まで .superpowers/sdd/cluster-C{4,7}-report.md が追跡されている。"
              "解消したらこの xfail マーカーを外す（strict=True なので XPASS は失敗になる）",
   )
   def test_no_tracked_agent_workdirs():
   ```
   - `import pytest` は `@pytest.mark.parametrize` があるので**残す**。

関数名や reason 文字列が実際に違っていた場合の手当ては 1 つだけ：`grep -n "xfail" tests/test_pages.py`（または `tests/test_static_guards.py`）で該当行を特定し、**`@pytest.mark.xfail(...)` のデコレータだけを削除する**（関数本体は触らない）。

## 実データで確認したキー名（2026-09-03・`raw.githubusercontent.com/sg55555/orbis-data/main/`）

| ファイル | 時刻キー | model | 備考 |
|---|---|---|---|
| `briefing.json` | `updated`（`2026-08-23T08:14:18Z`） | `claude-sonnet-4-6` | `lead` / `cards` |
| `instability.json` | `updated`（`2026-08-23T08:16:24Z`） | `claude-haiku-4-5` | `countries` 25 件・定型 narrative 5 件・`narrative_ja` キー欠落 17 件 |
| `forecast.json` | **`generated_at`**（`2026-08-23T08:16:56Z`・`updated` は持たない） | `claude-haiku-4-5` | `cards` 32 件 |
| `manifest.json` | `layers.<id>.updated` | — | `news` も `2026-08-23T08:08:43Z` で停止＝AI 3 層と同じ hourly-ai schedule |

---

### Task 7: A3 `js/ui/ai-meta.js`＋テスト＋差し込み（briefing/instability/forecast/alerts/#freshness/news ラベル/定型置換）＋index.html 文言＋CSS

**Files:**
- Create: `js/ui/ai-meta.js`、`tests/ai-meta.test.js`
- Modify: `index.html`（142・150・161 行）／`js/ui/briefing.js`（1-2・14-18・36-39 行）／`js/ui/instability.js`（1・14-16・55-60・74-81・94 行）／`js/ui/forecast.js`（1・24-45 行）／`js/ui/alerts.js`（4・17-21・28-31・41-50・65-71・75-85 行）／`js/ui/feed.js`（8-25 行）／`js/lib/selection.js`（169-176 行）／`js/main.js`（22・90・94-107・646・670・691・700-711・733 行）／`css/orbis.css`（末尾に追記）
- Test: `tests/ai-meta.test.js`（新規）／`tests/freshness.test.js`／`tests/alerts.test.js`／`tests/instability.test.js`／`tests/briefing.test.js`

**Interfaces:**
- Consumes: `relTime(updated: string, now: number) -> string`（`js/ui/sources.js`）／`escapeHtml(s: any) -> string`（`js/lib/selection.js`）／`freshnessSummary(items: {label,updated}[], now?: number, staleSec?: number) -> {text: string, stale: boolean}`（`js/lib/geo.js`）
- Produces（骨格 Interfaces のとおり・名前と型を変えない）:
  - `export const FRESH_AI_MS = 24 * 3600 * 1000`
  - `export function freshnessChip({ updated, now = Date.now(), staleMs = FRESH_AI_MS }) -> { text: string, stale: boolean, rel: string }`
  - `export function freshnessChipHtml(opts) -> string`
  - `export function aiDisclaimerHtml({ model, generatedAt }) -> string`
  - `export function isPlaceholderNarrative(s) -> boolean`
- Produces（既存関数の後方互換な引数追加）:
  - `alertChipHtml(a, opts = {})`（`opts.now?: number`）／`selectAlerts(...)` の返り値に `when: string` を追加
  - `renderBriefing(rootEl, brief, { onSelect, now })`／`renderInstability(rootEl, data, { onSelect, now })`／`renderForecasts(rootEl, data, { onSelect, now })`／`renderAlerts(rootEl, alerts, { onSelect, now })`

---

#### サイクル A — `js/ui/ai-meta.js`（純関数）

- [ ] **Step 1: 失敗するテストを書く** — `tests/ai-meta.test.js` を新規作成（この時点では純関数の節だけ）。

```js
// tests/ai-meta.test.js
// A3「表示の正直さ」の純関数（鮮度チップ・AI 免責・定型 narrative 判定）と、
// 差し込み先（index.html / 各 ui モジュール / CSS）の配線をソース突合で固定する。
// DOM は使わない：ブラウザ実挙動は Task 10 の e2e（.fresh-chip.is-stale ≥ 3）が担保する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FRESH_AI_MS, freshnessChip, freshnessChipHtml, aiDisclaimerHtml, isPlaceholderNarrative,
} from '../js/ui/ai-meta.js';

const NOW = Date.parse('2026-09-03T00:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('FRESH_AI_MS は 24 時間（AI 3 層＋news は hourly-ai schedule で動く）', () => {
  assert.equal(FRESH_AI_MS, 24 * 3600 * 1000);
});

test('freshnessChip: 閾値の手前（23h59m）は stale でない', () => {
  const r = freshnessChip({ updated: ago(23 * 3600e3 + 59 * 60e3), now: NOW });
  assert.equal(r.stale, false);
  assert.equal(r.rel, '23時間前');
  assert.equal(r.text, '最終更新 23時間前');
});

test('freshnessChip: 閾値ちょうど（24h00m）は stale でない（超えた時だけ stale）', () => {
  assert.equal(freshnessChip({ updated: ago(24 * 3600e3), now: NOW }).stale, false);
});

test('freshnessChip: 閾値の先（24h01m）は stale で「更新停止中」', () => {
  const r = freshnessChip({ updated: ago(24 * 3600e3 + 60e3), now: NOW });
  assert.equal(r.stale, true);
  assert.equal(r.rel, '1日前');
  assert.equal(r.text, '更新停止中 · 最終 1日前');
});

test('freshnessChip: updated が不正/欠落なら「更新時刻 不明」＋ stale（黙って新鮮に見せない）', () => {
  for (const bad of [undefined, null, '', 'not-a-date']) {
    const r = freshnessChip({ updated: bad, now: NOW });
    assert.equal(r.text, '更新時刻 不明', String(bad));
    assert.equal(r.stale, true, String(bad));
    assert.equal(r.rel, '—', String(bad));
  }
  assert.equal(freshnessChip().text, '更新時刻 不明');
});

test('freshnessChip: staleMs は呼び出し側で上書きできる', () => {
  const u = ago(7 * 3600e3);
  assert.equal(freshnessChip({ updated: u, now: NOW, staleMs: 6 * 3600e3 }).stale, true);
  assert.equal(freshnessChip({ updated: u, now: NOW }).stale, false);
});

test('freshnessChipHtml: is-stale は stale の時だけ・title は正規化 ISO', () => {
  const fresh = freshnessChipHtml({ updated: ago(60e3), now: NOW });
  assert.equal(fresh,
    '<span class="fresh-chip" title="2026-09-02T23:59:00.000Z">最終更新 1分前</span>');
  const stale = freshnessChipHtml({ updated: ago(11 * 86400e3), now: NOW });
  assert.match(stale, /^<span class="fresh-chip is-stale" title="2026-08-23T00:00:00\.000Z">/);
  assert.match(stale, /更新停止中 · 最終 11日前<\/span>$/);
});

test('freshnessChipHtml: 不正な updated を HTML に流さない', () => {
  const h = freshnessChipHtml({ updated: '<img src=x onerror=alert(1)>', now: NOW });
  assert.ok(!h.includes('<img'), h);
  assert.match(h, /title=""/);
  assert.match(h, /class="fresh-chip is-stale"/);
  assert.match(h, /更新時刻 不明/);
});

test('aiDisclaimerHtml: model 有りは「AI 生成（model・YYYY-MM-DD HH:mm UTC）」', () => {
  assert.equal(
    aiDisclaimerHtml({ model: 'claude-haiku-4-5', generatedAt: '2026-08-23T08:16:56Z' }),
    '<p class="ai-disclaimer">AI 生成（claude-haiku-4-5・2026-08-23 08:16 UTC）'
    + '・要約/推定であり誤りを含むことがあります</p>');
});

test('aiDisclaimerHtml: model 無しは時刻だけ・時刻不明でも落ちない', () => {
  assert.equal(
    aiDisclaimerHtml({ generatedAt: '2026-08-23T08:14:18Z' }),
    '<p class="ai-disclaimer">AI 生成（2026-08-23 08:14 UTC）'
    + '・要約/推定であり誤りを含むことがあります</p>');
  assert.match(aiDisclaimerHtml({}), /AI 生成（時刻不明）/);
  assert.match(aiDisclaimerHtml(), /AI 生成（時刻不明）/);
});

test('aiDisclaimerHtml: model を HTML エスケープする', () => {
  const h = aiDisclaimerHtml({ model: '<b>x</b>', generatedAt: '2026-08-23T08:00:00Z' });
  assert.ok(!h.includes('<b>'), h);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('isPlaceholderNarrative: 本番 instability.json の定型 3 例で true', () => {
  assert.equal(isPlaceholderNarrative('与えたデータには不安定性を示す具体的な事象が記載されていない'), true);
  assert.equal(isPlaceholderNarrative('データが不足しているため評価できない'), true);
  assert.equal(isPlaceholderNarrative('具体的な事象は確認されていない'), true);
});

test('isPlaceholderNarrative: 空/欠落/空白も「分析文なし」扱い（無言の空欄にしない）', () => {
  for (const v of [undefined, null, '', '   ']) {
    assert.equal(isPlaceholderNarrative(v), true, String(v));
  }
});

test('isPlaceholderNarrative: 実際の分析文 2 例では false', () => {
  assert.equal(isPlaceholderNarrative('ウクライナとの軍事紛争が継続している'), false);
  assert.equal(isPlaceholderNarrative('司法と行政の対立および自然災害の脅威が存在する'), false);
});
```

- [ ] **Step 2: 失敗を確認**
  - Run: `node --test tests/ai-meta.test.js`
  - Expected: 失敗。`Cannot find module '/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/js/ui/ai-meta.js'`（`ERR_MODULE_NOT_FOUND`）で全テストが実行前に落ちる。

- [ ] **Step 3: 最小実装** — `js/ui/ai-meta.js` を新規作成。

```js
// AI 生成物（ブリーフィング／不安定性／予測）と news の「正直な鮮度表示」を担う純関数群。
// DOM 非依存＝文字列を返すだけで、差し込みは各 ui モジュール側が行う（テストしやすさ優先）。
// 文言は骨格 Global Constraints の verbatim（最終更新／更新停止中／更新時刻 不明／免責）。
import { relTime } from './sources.js';
import { escapeHtml } from '../lib/selection.js';

// AI 3 層と news は同じ hourly-ai schedule で動くので stale 判定は 24 時間。
// 通常レイヤーの 6 時間（js/lib/geo.js freshnessSummary の既定 staleSec=21600）とは別基準。
export const FRESH_AI_MS = 24 * 3600 * 1000;

// ISO 文字列 → 'YYYY-MM-DD HH:mm UTC'。不正/欠落は '時刻不明'（toLocaleString は環境差が出るので使わない）。
function fmtUtc(v) {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return '時刻不明';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

// updated(ISO) → 鮮度チップの素。staleMs を「超えた」ら更新停止中（境界ちょうどは fresh）。
// updated が欠落/不正なら stale 扱い＝データが無いことを新鮮さとして表示しない。
export function freshnessChip({ updated, now = Date.now(), staleMs = FRESH_AI_MS } = {}) {
  const t = Date.parse(updated);
  if (!Number.isFinite(t)) return { text: '更新時刻 不明', stale: true, rel: '—' };
  const rel = relTime(updated, now);
  const stale = (now - t) > staleMs;
  return { text: stale ? `更新停止中 · 最終 ${rel}` : `最終更新 ${rel}`, stale, rel };
}

// 鮮度チップの HTML。title は正規化した ISO（不正なら空文字＝生値を DOM に入れない）。
export function freshnessChipHtml(opts) {
  const o = opts || {};
  const { text, stale } = freshnessChip(o);
  const t = Date.parse(o.updated);
  const iso = Number.isFinite(t) ? new Date(t).toISOString() : '';
  return `<span class="fresh-chip${stale ? ' is-stale' : ''}" title="${escapeHtml(iso)}">`
    + `${escapeHtml(text)}</span>`;
}

// AI 生成物の免責（各リストの末尾に 1 つだけ）。model 不明なら括弧内は時刻だけ。
export function aiDisclaimerHtml({ model, generatedAt } = {}) {
  const when = fmtUtc(generatedAt);
  const inner = model ? `${escapeHtml(model)}・${escapeHtml(when)}` : escapeHtml(when);
  return `<p class="ai-disclaimer">AI 生成（${inner}）・要約/推定であり誤りを含むことがあります</p>`;
}

// 「分析できるデータが無い」ことしか述べていない定型 narrative か（空/欠落も含む）。
// 本番 instability.json（2026-09-03）は 25 件中、定型 5・narrative_ja 欠落 17。
const PLACEHOLDER_RE = /記載されていない|データ(が|は|には)?不足|具体的な事象/;
export function isPlaceholderNarrative(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v) return true;
  return PLACEHOLDER_RE.test(v);
}
```

- [ ] **Step 4: 通ることを確認**
  - Run: `node --test tests/ai-meta.test.js`
  - Expected: PASS（`# fail 0`・15 テスト）。

- [ ] **Step 5: コミット**
  - `git add js/ui/ai-meta.js tests/ai-meta.test.js`
  - ```
    git commit -m "feat(ui): AI 生成物の鮮度チップ・免責・定型 narrative 判定を純関数化

    停止中の AI 3 層を「毎時更新」と偽らないための表示部品。閾値は 24h
    （AI 3 層と news は同じ hourly-ai schedule）。updated 不正は stale 扱い。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル B — instability の定型 narrative 置換

- [ ] **Step 6: 失敗するテストを書く** — `tests/instability.test.js` の末尾（54 行目 `});` の直後）に次の 3 テストを追記する。

```js

test('rowHtml: 定型 narrative は「AI 分析文なし（入力データ不足）」に置き換える', () => {
  const html = rowHtml({ code: 'XX', name_ja: 'テスト国', score: 10,
    counts: { conflict: 0, protests: 0, news: 0, quakes: 0 }, trend: { isNew: true },
    narrative_ja: '与えたデータには不安定性を示す具体的な事象が記載されていない' });
  assert.match(html, /<p class="ins-narr ins-narr--none">AI 分析文なし（入力データ不足）<\/p>/);
  assert.ok(!html.includes('与えたデータには'), html);
});

test('rowHtml: narrative 欠落も「AI 分析文なし」を出す（無言の空欄にしない）', () => {
  const html = rowHtml({ code: 'YY', name_ja: '別国', score: 5,
    counts: { conflict: 0, protests: 0, news: 0, quakes: 0 }, trend: { isNew: true } });
  assert.match(html, /ins-narr--none/);
});

test('rowHtml: 実際の分析文はそのまま（escape 済み）出す', () => {
  const html = rowHtml({ code: 'UP', name_ja: 'ウクライナ', score: 90,
    counts: { conflict: 1, protests: 0, news: 0, quakes: 0 }, trend: { isNew: true },
    narrative_ja: 'ロシアとの軍事紛争が継続している' });
  assert.match(html, /<p class="ins-narr">ロシアとの軍事紛争が継続している<\/p>/);
  assert.ok(!html.includes('ins-narr--none'), html);
});
```

- [ ] **Step 7: 失敗を確認**
  - Run: `node --test tests/instability.test.js`
  - Expected: 3 件失敗。1 件目は `AssertionError [ERR_ASSERTION]: The input did not match the regular expression /<p class="ins-narr ins-narr--none">.../`（実出力は `<p class="ins-narr">与えたデータには…</p>`）、2 件目は `ins-narr--none` が出力に無い、3 件目のみ PASS。

- [ ] **Step 8: 最小実装** — `js/ui/instability.js`。

  8-1. 1 行目（コメント）の直後に import を 1 行足す。
  - 置換前（1 行目）:
    ```js
    // 国家不安定性インデックス UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM セクション＋flyTo。
    ```
  - 置換後（2 行）:
    ```js
    // 国家不安定性インデックス UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM セクション＋flyTo。
    import { freshnessChipHtml, aiDisclaimerHtml, isPlaceholderNarrative } from './ai-meta.js';
    ```

  8-2. `rowHtml` の narrative 行を差し替える。
  - 置換前（59 行目）:
    ```js
      const narr = c.narrative_ja ? `<p class="ins-narr">${esc(c.narrative_ja)}</p>` : '';
    ```
  - 置換後（4 行）:
    ```js
      // 「分析できるデータが無かった」だけの定型文をそのまま出すと AI が何か言ったように見える。
      const narr = isPlaceholderNarrative(c.narrative_ja)
        ? '<p class="ins-narr ins-narr--none">AI 分析文なし（入力データ不足）</p>'
        : `<p class="ins-narr">${esc(c.narrative_ja)}</p>`;
    ```

- [ ] **Step 9: 通ることを確認**
  - Run: `node --test tests/instability.test.js`
  - Expected: PASS（`# fail 0`）。既存 6 テストも緑のまま（`narrative_ja: '紛争が集中'` と `'"><img src=x onerror=alert(1)>'` はどちらも非定型なので escape 経路を通る）。

- [ ] **Step 10: コミット**
  - `git add js/ui/instability.js tests/instability.test.js`
  - ```
    git commit -m "fix(instability): 定型 narrative を「AI 分析文なし（入力データ不足）」に置換

    本番 25 件中 22 件（定型 5・欠落 17）が実質「分析していない」。
    そのまま出すと AI が判断したように読めるので明示に替える。score/level は不変。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル C — ALERTS に元 snapshot の相対時刻

- [ ] **Step 11: 失敗するテストを書く** — `tests/alerts.test.js` の末尾（104 行目 `});` の直後）に次の 4 テストを追記する。

```js

test('selectAlerts: instability は updated・forecast は generated_at を when に載せる', () => {
  const ins = { updated: '2026-08-23T08:16:24Z', countries: [
    insCountry({ code: 'A', name_ja: 'A国', trend: { isNew: false, normal: { dir: 'up', deltaPct: 60 } } }),
  ] };
  const fc = { generated_at: '2026-08-23T08:16:56Z', cards: [
    fcCard({ place_ja: 'P1', attention_score: 80, trend: 'up' }),
  ] };
  const out = selectAlerts(ins, fc, { insMinDeltaPct: 15, fcMinScore: 60 });
  assert.equal(out.find((a) => a.kind === 'instability').when, '2026-08-23T08:16:24Z');
  assert.equal(out.find((a) => a.kind === 'forecast').when, '2026-08-23T08:16:56Z');
});

test('selectAlerts: 時刻キーが無ければ when は空文字', () => {
  const out = selectAlerts({ countries: [insCountry()] }, null, { insMinDeltaPct: 15, fcMinScore: 999 });
  assert.equal(out[0].when, '');
});

test('alertChipHtml: 元 snapshot の相対時刻を alert-when に出す', () => {
  const now = Date.parse('2026-09-03T00:00:00Z');
  const html = alertChipHtml(
    { kind: 'instability', label: 'A国', detail: '平常比 +60%', when: '2026-09-02T21:00:00Z' },
    { now },
  );
  assert.match(html, /<span class="alert-when">3時間前<\/span>/);
});

test('alertChipHtml: when が無ければ alert-when を出さない（1 引数呼び出しも壊さない）', () => {
  const html = alertChipHtml({ kind: 'forecast', label: 'P1', detail: '注視度 80' });
  assert.ok(!html.includes('alert-when'), html);
  assert.match(html, /alert-forecast/);
});
```

- [ ] **Step 12: 失敗を確認**
  - Run: `node --test tests/alerts.test.js`
  - Expected: 3 件失敗。`when` が `undefined` で `assert.equal(undefined, '2026-08-23T08:16:24Z')` が落ち、`alert-when` を含む正規表現も不一致（`The input did not match the regular expression /<span class="alert-when">3時間前<\/span>/`）。4 件目（when 無し）だけ PASS。

- [ ] **Step 13: 最小実装** — `js/ui/alerts.js`。

  13-1. import を 1 行足す。
  - 置換前（4 行目）:
    ```js
    import { DOMAIN_LABEL } from './forecast.js';
    ```
  - 置換後（2 行）:
    ```js
    import { DOMAIN_LABEL } from './forecast.js';
    import { relTime } from './sources.js';
    ```

  13-2. `selectAlerts` の冒頭で 2 つの時刻を取り出す。
  - 置換前（18-19 行目）:
    ```js
      const { limit = 6, insMinDeltaPct = 15, insMinScore = 12, fcMinScore = 60 } = opts;
      const out = [];
    ```
  - 置換後（5 行）:
    ```js
      const { limit = 6, insMinDeltaPct = 15, insMinScore = 12, fcMinScore = 60 } = opts;
      // アラートは「いつのスナップショットの話か」を持って回る（AI 3 層は停止中で最大 11 日古い）。
      const insUpdated = (instability && instability.updated) || '';
      const fcUpdated = (forecast && forecast.generated_at) || '';
      const out = [];
    ```

  13-3. instability 側の push に `when` を足す。
  - 置換前（28-31 行目）:
    ```js
        insAlerts.push({
          kind: 'instability', label: c.name_ja || c.code || '', detail: `平常比 +${d}%`,
          severity: Math.min(100, d / 3), lon: c.lon, lat: c.lat, code: c.code,
        });
    ```
  - 置換後（4 行）:
    ```js
        insAlerts.push({
          kind: 'instability', label: c.name_ja || c.code || '', detail: `平常比 +${d}%`,
          severity: Math.min(100, d / 3), lon: c.lon, lat: c.lat, code: c.code, when: insUpdated,
        });
    ```

  13-4. forecast 側の push に `when` を足す。
  - 置換前（46-50 行目）:
    ```js
        fcAlerts.push({
          kind: 'forecast',
          label: `${DOMAIN_LABEL[c.domain] || c.domain || ''} ${c.place_ja || ''}`.trim(),
          detail: `注視度 ${s}`, severity: s, lon: c.lon, lat: c.lat, domain: c.domain,
        });
    ```
  - 置換後（5 行）:
    ```js
        fcAlerts.push({
          kind: 'forecast',
          label: `${DOMAIN_LABEL[c.domain] || c.domain || ''} ${c.place_ja || ''}`.trim(),
          detail: `注視度 ${s}`, severity: s, lon: c.lon, lat: c.lat, domain: c.domain, when: fcUpdated,
        });
    ```

  13-5. `alertChipHtml` に `opts.now` と `alert-when` を足す。
  - 置換前（64-71 行目）:
    ```js
    // アラートチップ1個の内側 HTML（escape 済み）。
    export function alertChipHtml(a) {
      const o = a || {};
      return `<span class="alert-chip alert-${esc(o.kind)}">`
        + '<span class="alert-ic">⚠</span>'
        + `<span class="alert-label">${esc(o.label)}</span>`
        + `<em class="alert-detail">${esc(o.detail)}</em></span>`;
    }
    ```
  - 置換後（11 行）:
    ```js
    // アラートチップ1個の内側 HTML（escape 済み）。opts.now は when の相対時刻の基準。
    // when が無い（＝時刻キーの無い snapshot）ときは何も出さない＝「今の話」に見せない。
    export function alertChipHtml(a, opts = {}) {
      const o = a || {};
      const { now = Date.now() } = opts;
      const when = o.when ? `<span class="alert-when">${esc(relTime(o.when, now))}</span>` : '';
      return `<span class="alert-chip alert-${esc(o.kind)}">`
        + '<span class="alert-ic">⚠</span>'
        + `<span class="alert-label">${esc(o.label)}</span>`
        + `<em class="alert-detail">${esc(o.detail)}</em>${when}</span>`;
    }
    ```

  13-6. `renderAlerts` から `now` を渡す。
  - 置換前（73-75 行目）:
    ```js
    // rootEl=#alerts。alerts=selectAlerts の戻り。onSelect(alert) は座標ありでクリック時。
    // 0件ならバンドごと非表示。
    export function renderAlerts(rootEl, alerts, { onSelect } = {}) {
    ```
  - 置換後（3 行）:
    ```js
    // rootEl=#alerts。alerts=selectAlerts の戻り。onSelect(alert) は座標ありでクリック時。
    // 0件ならバンドごと非表示。now は各チップの相対時刻の基準（既定は現在時刻）。
    export function renderAlerts(rootEl, alerts, { onSelect, now = Date.now() } = {}) {
    ```

  13-7. チップ生成に `now` を渡す。
  - 置換前（85 行目）:
    ```js
        el.innerHTML = alertChipHtml(a);
    ```
  - 置換後:
    ```js
        el.innerHTML = alertChipHtml(a, { now });
    ```

- [ ] **Step 14: 通ることを確認**
  - Run: `node --test tests/alerts.test.js`
  - Expected: PASS（`# fail 0`・13 テスト）。既存 9 テストも緑（`when` を持たない fixture は `alert-when` を出さない）。

- [ ] **Step 15: コミット**
  - `git add js/ui/alerts.js tests/alerts.test.js`
  - ```
    git commit -m "feat(alerts): アラートチップに元スナップショットの相対時刻を表示

    instability.updated / forecast.generated_at を selectAlerts が when として
    載せ、alertChipHtml が relTime で描く。停止中（11日前）の急変を「今」と
    読ませないため。when 無しの呼び出しは従来どおり。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル D — ニュースの「見出しからのAI要約」タグ

- [ ] **Step 16: 失敗するテストを書く** — `tests/ai-meta.test.js` の末尾に次を追記する（import 行も冒頭に足す）。

  16-1. `tests/ai-meta.test.js` の import 節を差し替える。
  - 置換前（8-10 行目）:
    ```js
    import {
      FRESH_AI_MS, freshnessChip, freshnessChipHtml, aiDisclaimerHtml, isPlaceholderNarrative,
    } from '../js/ui/ai-meta.js';
    ```
  - 置換後（5 行）:
    ```js
    import {
      FRESH_AI_MS, freshnessChip, freshnessChipHtml, aiDisclaimerHtml, isPlaceholderNarrative,
    } from '../js/ui/ai-meta.js';
    import { newsPopupHtml } from '../js/lib/selection.js';
    import { renderFeed } from '../js/ui/feed.js';
    ```

  16-2. ファイル末尾に追記。

```js

// --- ニュースが AI 翻訳/要約であることの明示（LEGAL-07） ---
// renderFeed が触る DOM サーフェスは innerHTML / __wired / querySelectorAll（Task 6 が足した
// applyDataStyles(root) 用）だけなので最小スタブで足りる
// （repo 既存の DOM スタブ idiom＝tests/drilldown_render.test.js・tests/data-style.test.js と同方針）。
function fakeFeedRoot() {
  return { __wired: true, innerHTML: '', addEventListener() {}, querySelectorAll: () => [] };
}

test('renderFeed: news 行にだけ「見出しからのAI要約」タグを出す', () => {
  const root = fakeFeedRoot();
  renderFeed(root, [
    { layerId: 'news', kind: 'item', title: '見出し', time: Date.parse('2026-09-02T00:00:00Z') },
    { layerId: 'quakes', kind: 'item', title: 'M5.0', time: Date.parse('2026-09-02T00:00:00Z') },
  ], () => {});
  const rows = root.innerHTML.split('<div class="feed-row"');
  assert.equal(rows.length, 3, `feed-row が 2 行出る: ${root.innerHTML}`);
  assert.match(rows[1], /<span class="ai-tag">見出しからのAI要約<\/span>/);
  assert.ok(!rows[2].includes('ai-tag'), '地震行には AI タグを出さない');
});

test('newsPopupHtml: AI 要約であることを明示するタグを含む', () => {
  const h = newsPopupHtml({
    title_ja: 'タイトル', summary_ja: '要約', place: '東京',
    category: 'conflict', url: 'https://example.com/a',
  });
  assert.match(h, /<span class="ai-tag">見出しからのAI要約<\/span>/);
});
```

- [ ] **Step 17: 失敗を確認**
  - Run: `node --test tests/ai-meta.test.js`
  - Expected: 2 件失敗。`The input did not match the regular expression /<span class="ai-tag">見出しからのAI要約<\/span>/`（`renderFeed` と `newsPopupHtml` の両方）。

- [ ] **Step 18: 最小実装**

  18-1. `js/ui/feed.js` の `renderFeed` に news タグを足す。
  - 置換前（8-25 行目）:
    ```js
    export function renderFeed(root, items, onPick, maxCount = 0) {
      root.innerHTML = items.map((it, i) => {
        const c = COLOR[it.layerId] || 'var(--cyan)';
        const title = it.kind === 'group'
          ? `${LABEL[it.layerId] || ''} ${escapeHtml(it.country_ja || '')}`
          : escapeHtml(it.title);
        const badge = it.kind === 'group'
          ? `<span class="feed-count" data-style="--barw:${countBarPct(it.count, maxCount)}%">${Number(it.count) || 0}件</span>`
          : '';
        // 山火事は単一のネオン炎マーカー（他層は色ドット）。
        const marker = it.layerId === 'firms'
          ? '<span class="feed-flame">🔥</span>'
          : `<span class="feed-dot" data-style="color:${c};background:${c}"></span>`;
        return `<div class="feed-row" data-i="${i}" data-style="--rowcat:${c}">
          ${marker}
          <span class="feed-title">${title}</span>${badge}
          <span class="feed-time">${it.time ? formatFreshness(new Date(it.time).toISOString()) : ''}</span>
        </div>`;
      }).join('') || '<div class="feed-empty">イベントなし</div>';
    ```
  - 置換後（21 行）:
    ```js
    export function renderFeed(root, items, onPick, maxCount = 0) {
      root.innerHTML = items.map((it, i) => {
        const c = COLOR[it.layerId] || 'var(--cyan)';
        const title = it.kind === 'group'
          ? `${LABEL[it.layerId] || ''} ${escapeHtml(it.country_ja || '')}`
          : escapeHtml(it.title);
        // news の見出し/要約は英語原文の AI 日本語訳＝原文そのものではないことを明示する。
        const aiTag = it.layerId === 'news'
          ? '<span class="ai-tag">見出しからのAI要約</span>'
          : '';
        const badge = it.kind === 'group'
          ? `<span class="feed-count" data-style="--barw:${countBarPct(it.count, maxCount)}%">${Number(it.count) || 0}件</span>`
          : '';
        // 山火事は単一のネオン炎マーカー（他層は色ドット）。
        const marker = it.layerId === 'firms'
          ? '<span class="feed-flame">🔥</span>'
          : `<span class="feed-dot" data-style="color:${c};background:${c}"></span>`;
        return `<div class="feed-row" data-i="${i}" data-style="--rowcat:${c}">
          ${marker}
          <span class="feed-title">${title}</span>${aiTag}${badge}
          <span class="feed-time">${it.time ? formatFreshness(new Date(it.time).toISOString()) : ''}</span>
        </div>`;
      }).join('') || '<div class="feed-empty">イベントなし</div>';
    ```

  18-2. `js/lib/selection.js` の `newsPopupHtml` のメタ行にタグを足す。
  - 置換前（172 行目）:
    ```js
        + `<div class="sel-meta">${escapeHtml(c.label)}${o.place ? '｜' + escapeHtml(o.place) : ''}</div>`
    ```
  - 置換後（3 行）:
    ```js
        + `<div class="sel-meta">${escapeHtml(c.label)}${o.place ? '｜' + escapeHtml(o.place) : ''}`
        // 見出し・要約はどちらも AI の日本語化＝原文ではない（summary_ja が無い記事でも出す）。
        + '<span class="ai-tag">見出しからのAI要約</span></div>'
    ```

- [ ] **Step 19: 通ることを確認**
  - Run: `node --test tests/ai-meta.test.js tests/selection.test.js tests/feed.test.js`
  - Expected: PASS（`# fail 0`）。

- [ ] **Step 20: コミット**
  - `git add js/ui/feed.js js/lib/selection.js tests/ai-meta.test.js`
  - ```
    git commit -m "feat(news): 見出し/要約が AI 日本語化である旨をフィードとポップアップに表示

    news の title_ja/summary_ja は英語見出しからの AI 生成。原文の引用に見える
    表示をやめ .ai-tag で明示する（LEGAL-07）。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル E — index.html の文言撤去＋チップ/免責の差し込み＋`#freshness` の AI 集計

- [ ] **Step 21: 失敗するテストを書く**

  21-1. `tests/ai-meta.test.js` の末尾に配線の突合を追記。

```js

// --- 差し込みの配線（ソース突合）。ブラウザ実挙動は Task 10 の e2e が担保する ---
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('index.html: 『毎時更新』の虚偽文言が無く、鮮度チップの置き場が 3 つある', () => {
  const html = read('../index.html');
  assert.ok(!html.includes('毎時更新'), 'AI 3 層は 2026-08-23 で停止中＝毎時更新ではない');
  for (const id of ['brief-fresh', 'ins-fresh', 'fc-fresh']) {
    assert.ok(html.includes(`<span class="fresh-chip-slot" id="${id}"></span>`), id);
  }
});

test('briefing.js / instability.js / forecast.js が ai-meta を使って差し込む', () => {
  const b = read('../js/ui/briefing.js');
  assert.match(b, /from '\.\/ai-meta\.js'/);
  assert.ok(b.includes('#brief-fresh') && b.includes('freshnessChipHtml(') && b.includes('aiDisclaimerHtml('));

  const i = read('../js/ui/instability.js');
  assert.match(i, /from '\.\/ai-meta\.js'/);
  assert.ok(i.includes('#ins-fresh') && i.includes('freshnessChipHtml(') && i.includes('aiDisclaimerHtml('));

  const f = read('../js/ui/forecast.js');
  assert.match(f, /from '\.\/ai-meta\.js'/);
  assert.ok(f.includes('#fc-fresh') && f.includes('freshnessChipHtml(') && f.includes('aiDisclaimerHtml('));
  // forecast だけ時刻キーが generated_at（本番実データで確認・updated は持たない）。
  assert.ok(f.includes('d.generated_at || d.updated'), 'forecast は generated_at 優先');
});
```

  21-2. `tests/freshness.test.js` の 1-3 行目に `readFileSync` の import を足し、末尾に 2 テストを追記。
  - 置換前（1-3 行目）:
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { formatAgeSec, freshnessSummary } from '../js/lib/geo.js';
    ```
  - 置換後（4 行）:
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { formatAgeSec, freshnessSummary } from '../js/lib/geo.js';
    ```
  - 末尾（39 行目 `});` の直後）に追記:

```js

test('freshnessSummary: staleSec=24h で AI 3 層＋news の停止を名指しする', () => {
  const now = Date.parse('2026-09-03T00:00:00Z');
  const items = [
    { label: 'ニュース', updated: '2026-08-23T08:08:43Z' },
    { label: 'ブリーフィング', updated: '2026-08-23T08:14:18Z' },
  ];
  const r = freshnessSummary(items, now, 24 * 3600);
  assert.equal(r.stale, true);
  assert.match(r.text, /^2層 · 最新 10日前 · ⚠ /);
  assert.match(r.text, /ニュース 10日前/);
  assert.match(r.text, /ブリーフィング 10日前/);
});

test('main.js: #freshness は AI 3 層＋news を FRESH_AI_MS（24h）で別集計する', () => {
  const src = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ FRESH_AI_MS \} from '\.\/ui\/ai-meta\.js';/);
  assert.ok(src.includes("l.id === 'news' ? aiItems : items"), 'news は 24h 側で集計する');
  assert.ok(src.includes('freshnessSummary(aiItems, Date.now(), FRESH_AI_MS / 1000)'),
    'AI 群は FRESH_AI_MS 基準');
  assert.ok(src.includes('const _aiSnaps ='), 'AI スナップショットは module-local に持つ');
  assert.ok(!src.includes('window.__orbis.instability, window.__orbis.forecasts'),
    'AI 3 層のデータ経路は _aiSnaps 一本（window.__orbis はデバッグ用ミラー）');
});
```

  21-3. `tests/briefing.test.js` の import に `readFileSync` を足し、末尾に 1 テストを追記。
  - 置換前（1-3 行目）:
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { briefCards, cardColorCss } from '../js/ui/briefing.js';
    ```
  - 置換後（4 行）:
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { briefCards, cardColorCss } from '../js/ui/briefing.js';
    ```
  - 末尾（14 行目 `});` の直後）に追記:

```js

test('renderBriefing: updated からチップを描き、カード末尾に免責を足す', () => {
  const src = readFileSync(new URL('../js/ui/briefing.js', import.meta.url), 'utf8');
  assert.ok(src.includes("rootEl.querySelector('#brief-fresh')"));
  assert.ok(src.includes('freshnessChipHtml({ updated: b.updated, now })'));
  assert.ok(src.includes("cardsEl.insertAdjacentHTML('beforeend', aiDisclaimerHtml("));
  assert.ok(src.includes('generatedAt: b.updated'), 'briefing の時刻キーは updated');
});
```

- [ ] **Step 22: 失敗を確認**
  - Run: `node --test tests/ai-meta.test.js tests/freshness.test.js tests/briefing.test.js`
  - Expected: 5 件失敗。`index.html` は `毎時更新` を含むため 1 件目が `AssertionError: AI 3 層は 2026-08-23 で停止中＝毎時更新ではない`、残りは `ai-meta.js` の import 文が無い／`_aiSnaps` が無い、で落ちる。`freshnessSummary` の 24h テストのみ PASS。

- [ ] **Step 23: 最小実装（1）— index.html の 3 箇所**

  23-1. ブリーフィングの注記（142 行目）。
  - 置換前:
    ```html
              <span class="brief-note"><span class="sec-jp-n">ワールド・ブリーフィング · </span>AI 合成・出典付き／毎時更新</span>
    ```
  - 置換後（2 行）:
    ```html
              <span class="brief-note"><span class="sec-jp-n">ワールド・ブリーフィング · </span>AI 合成・出典付き</span>
              <span class="fresh-chip-slot" id="brief-fresh"></span>
    ```

  23-2. 不安定性の注記（150 行目）。
  - 置換前:
    ```html
              <span class="ins-note"><span class="sec-jp-n">国家不安定性インデックス · </span>AI合成・出典付き／毎時更新（決定論スコア＋トレンド）</span>
    ```
  - 置換後（2 行）:
    ```html
              <span class="ins-note"><span class="sec-jp-n">国家不安定性インデックス · </span>AI合成・出典付き（決定論スコア＋トレンド）</span>
              <span class="fresh-chip-slot" id="ins-fresh"></span>
    ```

  23-3. FORECASTS 見出し（161 行目・`</h2>` の直前にスロットを挿す）。
  - 置換前:
    ```html
            <h2 class="fc-title"><svg class="sec-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7a5 5 0 1 0 5 5"/><line x1="12" y1="12" x2="20.5" y2="3.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg><span class="sec-emoji">🔮</span>AI FORECASTS <span class="fc-sub"><span class="sec-jp-n">AI予測 · </span>ドメイン別リスク見通し（AI生成・推測）</span></h2>
    ```
  - 置換後:
    ```html
            <h2 class="fc-title"><svg class="sec-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7a5 5 0 1 0 5 5"/><line x1="12" y1="12" x2="20.5" y2="3.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg><span class="sec-emoji">🔮</span>AI FORECASTS <span class="fc-sub"><span class="sec-jp-n">AI予測 · </span>ドメイン別リスク見通し（AI生成・推測）</span><span class="fresh-chip-slot" id="fc-fresh"></span></h2>
    ```

- [ ] **Step 24: 最小実装（2）— briefing / instability / forecast の描画差し込み**

  24-1. `js/ui/briefing.js` の import（1-2 行目）。
  - 置換前:
    ```js
    // AI ワールド・ブリーフィング描画。lead＋カード（カテゴリ色/severity）。座標ありカードは onSelect。
    import { categoryOf } from '../lib/news_categories.js';
    ```
  - 置換後（3 行）:
    ```js
    // AI ワールド・ブリーフィング描画。lead＋カード（カテゴリ色/severity）。座標ありカードは onSelect。
    import { categoryOf } from '../lib/news_categories.js';
    import { freshnessChipHtml, aiDisclaimerHtml } from './ai-meta.js';
    ```

  24-2. `js/ui/briefing.js` の `renderBriefing`（13-18 行目）。
  - 置換前:
    ```js
    // rootEl=#ai-brief（.brief-lead と .brief-cards を内包）。onSelect(card) は座標ありカードのクリック。
    export function renderBriefing(rootEl, brief, { onSelect } = {}) {
      const leadEl = rootEl.querySelector('.brief-lead');
      const cardsEl = rootEl.querySelector('.brief-cards');
      if (leadEl) leadEl.textContent = (brief && brief.lead) || '';
      cardsEl.innerHTML = '';
    ```
  - 置換後（10 行）:
    ```js
    // rootEl=#ai-brief（.brief-lead と .brief-cards を内包）。onSelect(card) は座標ありカードのクリック。
    // now は鮮度チップの基準時刻（既定は現在時刻）。
    export function renderBriefing(rootEl, brief, { onSelect, now = Date.now() } = {}) {
      const b = brief || {};
      const leadEl = rootEl.querySelector('.brief-lead');
      const cardsEl = rootEl.querySelector('.brief-cards');
      const freshEl = rootEl.querySelector('#brief-fresh');
      // 見出し脇に「いつのデータか」。停止中なら .is-stale が付く（css で減光）。
      if (freshEl) freshEl.innerHTML = freshnessChipHtml({ updated: b.updated, now });
      if (leadEl) leadEl.textContent = b.lead || '';
      cardsEl.innerHTML = '';
    ```

  24-3. `js/ui/briefing.js` の末尾（36-38 行目）に免責を足す。
  - 置換前:
    ```js
        cardsEl.appendChild(el);
      }
      return { count: briefCards(brief).length };
    ```
  - 置換後（5 行）:
    ```js
        cardsEl.appendChild(el);
      }
      // AI 生成物であることの免責はリスト末尾に 1 つだけ（カードごとには出さない）。
      cardsEl.insertAdjacentHTML('beforeend', aiDisclaimerHtml({ model: b.model, generatedAt: b.updated }));
      return { count: briefCards(brief).length };
    ```

  24-4. `js/ui/instability.js` の `renderInstability`（73-81 行目）。
  - 置換前:
    ```js
    // rootEl=#instability。data={updated, countries:[...]}。onSelect(country) は座標ありでクリック時。
    export function renderInstability(rootEl, data, { onSelect } = {}) {
      if (!rootEl) return;
      const countries = (data && data.countries) || [];
      const rankWrap = rootEl.querySelector('.ins-rank-list');
      const moveWrap = rootEl.querySelector('.ins-mover-list');
      if (!rankWrap || !moveWrap) return;
      rankWrap.innerHTML = '';
      moveWrap.innerHTML = '';
    ```
  - 置換後（13 行）:
    ```js
    // rootEl=#instability。data={updated, model, countries:[...]}。onSelect(country) は座標ありでクリック時。
    // now は鮮度チップの基準時刻（既定は現在時刻）。
    export function renderInstability(rootEl, data, { onSelect, now = Date.now() } = {}) {
      if (!rootEl) return;
      const d = data || {};
      const countries = d.countries || [];
      const rankWrap = rootEl.querySelector('.ins-rank-list');
      const moveWrap = rootEl.querySelector('.ins-mover-list');
      const freshEl = rootEl.querySelector('#ins-fresh');
      if (freshEl) freshEl.innerHTML = freshnessChipHtml({ updated: d.updated, now });
      if (!rankWrap || !moveWrap) return;
      rankWrap.innerHTML = '';
      moveWrap.innerHTML = '';
    ```

  24-5. `js/ui/instability.js` のランキング描画の直後（94 行目）に免責を足す。
  - 置換前:
    ```js
      rankTop(countries, 15).forEach((c) => rankWrap.appendChild(mkRow(c)));
    ```
  - 置換後（3 行）:
    ```js
      rankTop(countries, 15).forEach((c) => rankWrap.appendChild(mkRow(c)));
      // 決定論スコアは自前だが narrative は AI 生成なのでリスト末尾に免責を 1 つ置く。
      rankWrap.insertAdjacentHTML('beforeend', aiDisclaimerHtml({ model: d.model, generatedAt: d.updated }));
    ```

  24-6. `js/ui/forecast.js` の 1 行目の直後に import を足す。
  - 置換前（1 行目）:
    ```js
    // AI FORECASTS UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM＋flyTo。
    ```
  - 置換後（2 行）:
    ```js
    // AI FORECASTS UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM＋flyTo。
    import { freshnessChipHtml, aiDisclaimerHtml } from './ai-meta.js';
    ```

  24-7. `js/ui/forecast.js` の `renderForecasts`（24-45 行目）。
  - 置換前:
    ```js
    export function renderForecasts(rootEl, data, { onSelect } = {}){
      if(!rootEl) return;
      const cards=(data&&data.cards)||[];
      const tabs=rootEl.querySelector('.fc-tabs');
      const list=rootEl.querySelector('.fc-list');
      if(!tabs||!list) return;
      let active='all';
      const draw=()=>{
        tabs.innerHTML=tabsHtml(active);
        list.innerHTML='';
        filterByDomain(cards, active).forEach((c)=>{
          const el=document.createElement('button'); el.type='button'; el.className='fc-cardbtn';
          el.innerHTML=cardHtml(c);
          if(typeof c.lat==='number'&&typeof c.lon==='number'&&(c.lat||c.lon)&&onSelect){
            el.addEventListener('click',()=>onSelect(c));
          } else { el.disabled=true; }
          list.appendChild(el);
        });
        tabs.querySelectorAll('.fc-tab').forEach((b)=>b.addEventListener('click',()=>{active=b.dataset.dom;draw();}));
      };
      draw();
    }
    ```
  - 置換後（27 行）:
    ```js
    export function renderForecasts(rootEl, data, { onSelect, now = Date.now() } = {}){
      if(!rootEl) return;
      const d=data||{};
      const cards=d.cards||[];
      const tabs=rootEl.querySelector('.fc-tabs');
      const list=rootEl.querySelector('.fc-list');
      const freshEl=rootEl.querySelector('#fc-fresh');
      if(!tabs||!list) return;
      // forecast.json の時刻キーは generated_at（本番実データで確認・updated は持たない）。
      const updated=d.generated_at || d.updated;
      if(freshEl) freshEl.innerHTML=freshnessChipHtml({ updated, now });
      let active='all';
      const draw=()=>{
        tabs.innerHTML=tabsHtml(active);
        list.innerHTML='';
        filterByDomain(cards, active).forEach((c)=>{
          const el=document.createElement('button'); el.type='button'; el.className='fc-cardbtn';
          el.innerHTML=cardHtml(c);
          if(typeof c.lat==='number'&&typeof c.lon==='number'&&(c.lat||c.lon)&&onSelect){
            el.addEventListener('click',()=>onSelect(c));
          } else { el.disabled=true; }
          list.appendChild(el);
        });
        // タブを切り替えても免責は残す（毎回リスト末尾に 1 つ）。
        list.insertAdjacentHTML('beforeend', aiDisclaimerHtml({ model: d.model, generatedAt: updated }));
        tabs.querySelectorAll('.fc-tab').forEach((b)=>b.addEventListener('click',()=>{active=b.dataset.dom;draw();}));
      };
      draw();
    }
    ```

- [ ] **Step 25: 最小実装（3）— `js/main.js` の `_aiSnaps` と `updateFreshness`**

  25-1. import を 1 行足す（22 行目の直後）。
  - 置換前（22 行目）:
    ```js
    import { buildSourceRows, renderSources, SOURCE_MAP } from './ui/sources.js';
    ```
  - 置換後（2 行）:
    ```js
    import { buildSourceRows, renderSources, SOURCE_MAP } from './ui/sources.js';
    import { FRESH_AI_MS } from './ui/ai-meta.js';
    ```

  25-2. AI スナップショットの置き場を作る（90 行目の直後）。
  - 置換前（90 行目）:
    ```js
    let _insCountries = null;           // instability.countries（joinWatchCountries で参照）
    ```
  - 置換後（4 行）:
    ```js
    let _insCountries = null;           // instability.countries（joinWatchCountries で参照）
    // AI 3 層の生スナップショット。updateFreshness() は boot より前のスコープに居て
    // window.__orbis（boot 内で代入）をまだ持てないので、_insCountries と同じく module-local に
    // 置く。鮮度ピル・アラート・ソースパネルのデータ経路はこれを正とし、window.__orbis 側は
    // デバッグ/e2e 用のミラーに徹する（読み口を 2 つに割らない）。
    const _aiSnaps = { briefing: null, instability: null, forecast: null };
    ```

  25-3. `updateFreshness` を書き換える（94-107 行目）。
  - 置換前:
    ```js
    // 全有効レイヤーの鮮度を各 snapshot の updated から直読して可視化する。
    // manifest 非依存なので、収集失敗でレイヤーが manifest から消えても古さが見える（沈黙の陳腐化を防ぐ）。
    function updateFreshness() {
      const items = [];
      for (const l of layers) {
        if (!ENABLED.has(l.id)) continue;
        const snap = snapshots[l.id];
        if (snap && snap.updated) items.push({ label: l.label, updated: snap.updated });
      }
      const { text, stale } = freshnessSummary(items);
      const el = document.getElementById('freshness');
      el.textContent = text;
      el.classList.toggle('stale', stale);
    }
    ```
  - 置換後（30 行）:
    ```js
    // 全有効レイヤーの鮮度を各 snapshot の updated から直読して可視化する。
    // manifest 非依存なので、収集失敗でレイヤーが manifest から消えても古さが見える（沈黙の陳腐化を防ぐ）。
    // AI 3 層（briefing/instability/forecast）と news は同じ hourly-ai schedule で動くため、
    // 通常レイヤーの 6h ではなく FRESH_AI_MS（24h）で別集計する。freshnessSummary は
    // staleSec を 1 つしか取らないので 2 群に分けて呼び、テキストを連結し stale は OR で合成する。
    const AI_FRESH_LABEL = {
      briefing: 'ブリーフィング', instability: '不安定性', forecast: '予測',
    };
    function updateFreshness() {
      const items = [];
      const aiItems = [];
      for (const l of layers) {
        if (!ENABLED.has(l.id)) continue;
        const snap = snapshots[l.id];
        if (!snap || !snap.updated) continue;
        (l.id === 'news' ? aiItems : items).push({ label: l.label, updated: snap.updated });
      }
      for (const id of Object.keys(AI_FRESH_LABEL)) {
        const s = _aiSnaps[id];
        const updated = s && (s.updated || s.generated_at);
        if (updated) aiItems.push({ label: AI_FRESH_LABEL[id], updated });
      }
      const { text, stale } = freshnessSummary(items);
      const ai = aiItems.length
        ? freshnessSummary(aiItems, Date.now(), FRESH_AI_MS / 1000)
        : null;
      const el = document.getElementById('freshness');
      el.textContent = ai ? `${text} ／ AI ${ai.text}` : text;
      el.classList.toggle('stale', stale || !!(ai && ai.stale));
    }
    ```

  25-4. ブリーフィング取得後に `_aiSnaps` へ入れる（646 行目）。
  - 置換前:
    ```js
            if (window.__orbis) window.__orbis.brief = brief;
    ```
  - 置換後（2 行）:
    ```js
            _aiSnaps.briefing = brief;
            if (window.__orbis) window.__orbis.brief = brief; // ?e2e=1 のデバッグ用ミラー
    ```

  25-5. 不安定性取得後（670 行目）。
  - 置換前:
    ```js
            if (window.__orbis) window.__orbis.instability = ins;
    ```
  - 置換後（2 行）:
    ```js
            _aiSnaps.instability = ins;
            if (window.__orbis) window.__orbis.instability = ins; // ?e2e=1 のデバッグ用ミラー
    ```

  25-6. 予測取得後（691 行目）。
  - 置換前:
    ```js
            if (window.__orbis) window.__orbis.forecasts = fc;
    ```
  - 置換後（2 行）:
    ```js
            _aiSnaps.forecast = fc;
            if (window.__orbis) window.__orbis.forecasts = fc; // ?e2e=1 のデバッグ用ミラー
    ```

  25-7. アラート帯の入力を `_aiSnaps` に切り替え、`now` を渡す（700-711 行目）。
  - 置換前:
    ```js
          const alertsRoot = document.getElementById('alerts');
          if (alertsRoot) {
            const alertItems = selectAlerts(window.__orbis.instability, window.__orbis.forecasts);
            renderAlerts(alertsRoot, alertItems, {
              onSelect: (a) => {
                map.flyTo({ center: [a.lon, a.lat], zoom: 4, duration: 1500, essential: true });
                selected = { lon: a.lon, lat: a.lat, title: a.label, layerId: a.kind === 'forecast' ? 'forecast' : 'instability', at: performance.now() };
                if (window.__orbis) window.__orbis.selected = selected;
                drawAll(overlay);
              },
            });
          }
    ```
  - 置換後（13 行）:
    ```js
          const alertsRoot = document.getElementById('alerts');
          if (alertsRoot) {
            const alertItems = selectAlerts(_aiSnaps.instability, _aiSnaps.forecast);
            renderAlerts(alertsRoot, alertItems, {
              now: Date.now(),
              onSelect: (a) => {
                map.flyTo({ center: [a.lon, a.lat], zoom: 4, duration: 1500, essential: true });
                selected = { lon: a.lon, lat: a.lat, title: a.label, layerId: a.kind === 'forecast' ? 'forecast' : 'instability', at: performance.now() };
                if (window.__orbis) window.__orbis.selected = selected;
                drawAll(overlay);
              },
            });
          }
    ```

  25-8. ソースパネルの入力も `_aiSnaps` に切り替える（724-729 行目）。
  - 置換前:
    ```js
          const srcSnapshots = { ...snapshots,
            briefing: window.__orbis.brief, instability: window.__orbis.instability, forecast: window.__orbis.forecasts };
          const srcCounts = { ...(window.__orbis.counts || {}),
            briefing: window.__orbis.brief?.cards?.length || 0,
            instability: window.__orbis.instability?.countries?.length || 0,
            forecast: window.__orbis.forecasts?.cards?.length || 0 };
    ```
  - 置換後（7 行）:
    ```js
          const srcSnapshots = { ...snapshots,
            briefing: _aiSnaps.briefing, instability: _aiSnaps.instability, forecast: _aiSnaps.forecast };
          const srcCounts = { ...(window.__orbis.counts || {}),
            briefing: _aiSnaps.briefing?.cards?.length || 0,
            instability: _aiSnaps.instability?.countries?.length || 0,
            forecast: _aiSnaps.forecast?.cards?.length || 0 };
    ```

  25-9. AI 取得後にピルを更新する（733 行目）。
  - 置換前:
    ```js
        refreshSources();
    ```
  - 置換後（3 行）:
    ```js
        // AI 3 層が出そろってから鮮度ピルを引き直す（rebuild は AI 取得より前に走る）。
        updateFreshness();
        refreshSources();
    ```
  - 注: 置換対象は 733 行目の **インデント 4 スペースの単独呼び出し**（`refreshSources` 定義の直後・`startPolling` の直前）。738 行目の `startPolling` コールバック内（インデント 6）の `refreshSources();` は変更しない。

- [ ] **Step 26: 通ることを確認**
  - Run: `node --test tests/*.test.js`
  - Expected: PASS（`# fail 0`）。特に `tests/ai-meta.test.js`・`tests/freshness.test.js`・`tests/briefing.test.js` の新規テストが緑。

- [ ] **Step 27: コミット**
  - `git add index.html js/main.js js/ui/briefing.js js/ui/instability.js js/ui/forecast.js tests/ai-meta.test.js tests/freshness.test.js tests/briefing.test.js`
  - ```
    git commit -m "fix(ui): 『毎時更新』を撤去し AI 3 層に鮮度チップと免責を差し込む

    briefing/instability/forecast の見出しへ最終更新（停止中は更新停止中）を出し、
    各リスト末尾に AI 生成の免責。#freshness ピルは AI 3 層＋news を 24h 基準で
    別集計。updateFreshness は boot 前のスコープに居るので AI スナップショットを
    module-local _aiSnaps に持ち、読み口を 1 本に揃える。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル F — CSS

- [ ] **Step 28: 失敗するテストを書く** — `tests/ai-meta.test.js` の末尾に追記。

```js

test('css/orbis.css: A3 で追加したクラスが定義されている', () => {
  const css = read('../css/orbis.css');
  for (const sel of ['.fresh-chip-slot', '.fresh-chip {', '.fresh-chip.is-stale',
    '.ai-disclaimer', '.ai-tag', '.alert-chip .alert-when', '.ins-narr--none']) {
    assert.ok(css.includes(sel), `${sel} が css/orbis.css に無い`);
  }
});

test('css/orbis.css: 新規クラスは既存トークンだけを使う（生の 16 進色を足さない）', () => {
  const css = read('../css/orbis.css');
  const block = css.slice(css.indexOf('/* ===== A3 表示の正直さ'));
  assert.ok(block.length > 0, 'A3 のブロックが見つからない');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), `生の 16 進色が混ざっている:\n${block}`);
});
```

- [ ] **Step 29: 失敗を確認**
  - Run: `node --test tests/ai-meta.test.js`
  - Expected: 2 件失敗。`AssertionError: .fresh-chip-slot が css/orbis.css に無い` と `AssertionError: A3 のブロックが見つからない`。

- [ ] **Step 30: 最小実装** — `css/orbis.css` の**末尾に**次を追記する。

```css

/* ===== A3 表示の正直さ — 鮮度チップ / AI 免責 / AI タグ / アラート時刻 ===== */
/* 方針：停止中を赤で警告しない。アンバー＋減光で「古い情報」として静かに沈める
   （デザイン監修＝宇宙的・サイバーパンク HUD を足さない）。色は既存トークンのみ。 */
.fresh-chip-slot { display: inline-flex; margin-left: 8px; vertical-align: middle; }
.fresh-chip {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: .68rem; line-height: 1.5; white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted-3); background: var(--bg-chip);
  border: 1px solid var(--rim-cyan-16);
}
.fresh-chip.is-stale {
  color: var(--cat-stale-2); border-color: var(--cat-amber-border);
  background: transparent; opacity: .72;
}
.ai-disclaimer {
  margin: 10px 0 0; padding-top: 8px;
  border-top: 1px solid var(--rim-cyan-16);
  font-size: .68rem; line-height: 1.6; color: var(--text-muted-3);
}
/* 免責は grid/flex のリストで 1 行を占める（.brief-cards は auto-fill grid）。 */
.brief-cards .ai-disclaimer { grid-column: 1 / -1; }
.ins-rank-list .ai-disclaimer, .fc-list .ai-disclaimer { width: 100%; }
.ai-tag {
  display: inline-block; margin-left: 6px; padding: 0 5px;
  border-radius: 4px; font-size: .64rem; line-height: 1.6;
  color: var(--text-muted-2); background: var(--bg-chip-white);
  border: 1px solid var(--rim-cyan-16); white-space: nowrap;
}
.alert-chip .alert-when {
  margin-left: 6px; font-size: .68rem; color: var(--text-muted-3);
  font-variant-numeric: tabular-nums;
}
.ins-narr.ins-narr--none { color: var(--text-muted-3); font-style: italic; opacity: .85; }
```

- [ ] **Step 31: 通ることを確認**
  - Run: `node --test tests/*.test.js`
  - Expected: PASS（`# fail 0`）。`tests/design-tokens.test.js`（`:root` トークンの回帰）も緑のまま＝新規トークンは足していない。

- [ ] **Step 32: コミット**
  - `git add css/orbis.css tests/ai-meta.test.js`
  - ```
    git commit -m "style(css): 鮮度チップ・AI 免責・AI タグ・アラート時刻のスタイルを追加

    停止中はアンバー＋減光（.is-stale）で静かに沈める。色はすべて既存トークン
    （--cat-stale-2 / --cat-amber-border / --text-muted-3 等）から取る。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

### Task 8: A4 動的分＝youtube-nocookie＋`referrerpolicy`＋AI 字幕注記＋プロフィール CC BY-SA フッタ＋`rel="noopener noreferrer"`＋既存テスト更新（＋orbis-data の LICENSE/DATA-SOURCES.md は親セッションが push）

**Files:**
- Modify: `js/ui/media.js`（13-23 行）／`index.html`（109・117 行）／`js/ui/cams-pane.js`（76-79 行）／`js/lib/drilldown/profile_view.js`（1-6・312-318 行）／`js/lib/selection.js`（174-175・197-198 行）／`js/ui/sources.js`（70-76 行）／`css/orbis.css`（末尾に追記）
- Test: `tests/media.test.js`／`tests/e2e/media.spec.js`（33・77 行）／`tests/profile_view.test.js`／`tests/sources.test.js`／`tests/test_pages.py`（xfail 2 件の解除）
- Create（**リポには置かない**・scratchpad `/tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-legal/` に作り、親セッションが orbis-data へ push）: `LICENSE`・`DATA-SOURCES.md`

**Interfaces:**
- Consumes: `buildEmbedUrl(item, { captions }) -> string`（`js/ui/media.js`・news-pane/cams-pane が呼ぶ）／`escapeHtml`（`js/lib/selection.js`）
- Produces: `buildEmbedUrl` の返り値の base が `https://www.youtube-nocookie.com/embed/…` に変わる（クエリ文字列は不変）。`js/lib/drilldown/profile_view.js` にモジュール内ローカル関数 `wikiArticleTitle(url, fallback) -> string` を追加（export しない＝タスク間契約を増やさない）。

---

#### サイクル A — YouTube を nocookie 化＋ID をエスケープ

- [ ] **Step 1: 失敗するテストを書く** — `tests/media.test.js` の 18-28 行目を差し替え、末尾に 1 テストを追記する。
  - 置換前（18-28 行目）:
    ```js
    test('buildEmbedUrl: channel_id 形式', () => {
      const u = buildEmbedUrl(NEWS[0]);
      assert.ok(u.startsWith('https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg'));
      assert.ok(u.includes('autoplay=1') && u.includes('mute=1'));
    });

    test('buildEmbedUrl: video_id 形式', () => {
      const u = buildEmbedUrl(CAMS[0]);
      assert.ok(u.startsWith('https://www.youtube.com/embed/8H3nRCFVR6Y?'));
      assert.ok(u.includes('playsinline=1') && !u.includes('live_stream'));
    });
    ```
  - 置換後（13 行）:
    ```js
    test('buildEmbedUrl: channel_id 形式（youtube-nocookie）', () => {
      const u = buildEmbedUrl(NEWS[0]);
      assert.ok(u.startsWith('https://www.youtube-nocookie.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg'), u);
      assert.ok(u.includes('autoplay=1') && u.includes('mute=1'));
      assert.ok(!u.includes('www.youtube.com/'), '通常ドメインを使わない');
    });

    test('buildEmbedUrl: video_id 形式（youtube-nocookie）', () => {
      const u = buildEmbedUrl(CAMS[0]);
      assert.ok(u.startsWith('https://www.youtube-nocookie.com/embed/8H3nRCFVR6Y?'), u);
      assert.ok(u.includes('playsinline=1') && !u.includes('live_stream'));
      assert.ok(!u.includes('www.youtube.com/'), '通常ドメインを使わない');
    });
    ```
  - `tests/media.test.js` の末尾に追記:

```js

test('buildEmbedUrl: video_id / channel_id を URL エンコードする（設定値の混入を止める）', () => {
  const v = buildEmbedUrl({ id: 'x', video_id: 'a b&autoplay=0' });
  assert.ok(v.startsWith('https://www.youtube-nocookie.com/embed/a%20b%26autoplay%3D0?'), v);
  const c = buildEmbedUrl({ id: 'y', channel_id: 'C?x=1' });
  assert.ok(c.includes('channel=C%3Fx%3D1'), c);
});

test('index.html / cams-pane.js: 埋め込み iframe に referrerpolicy が付く', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<iframe id="news-frame"[^>]*referrerpolicy="strict-origin-when-cross-origin"/);
  const cams = readFileSync(new URL('../js/ui/cams-pane.js', import.meta.url), 'utf8');
  assert.ok(cams.includes("f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');"), cams);
});

test('index.html: AI 字幕トグルの脇に送信先の注記がある', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(
    '<small class="lc-note">タブの音声をこの端末の変換サーバー（localhost:8900）へ送ります。外部には送信しません。</small>'
  ), html);
});
```
  - あわせて `tests/media.test.js` の 1-2 行目の直後に `readFileSync` の import を足す。
    - 置換前（1-2 行目）:
      ```js
      import { test } from 'node:test';
      import assert from 'node:assert/strict';
      ```
    - 置換後（3 行）:
      ```js
      import { test } from 'node:test';
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      ```

- [ ] **Step 2: 失敗を確認**
  - Run: `node --test tests/media.test.js`
  - Expected: 5 件失敗。`AssertionError: https://www.youtube.com/embed/live_stream?channel=…`（`startsWith` が false）、`referrerpolicy` が index.html/cams-pane.js に無い、`lc-note` が index.html に無い。

- [ ] **Step 3: 最小実装** — `js/ui/media.js` の 13-23 行目。
  - 置換前:
    ```js
    // キー不要のライブ埋め込みURL。video_id 優先（固定ライブ動画）、無ければ channel_id（チャンネルlive）。
    // captions=true（既定）で日本語字幕＋日本語UIを要求（cc_load_policy/cc_lang_pref/hl）。
    // 注: cc_lang_pref=ja は「日本語字幕トラックがあれば表示」までで、外国語音声の自動翻訳は強制できない（ベストエフォート）。
    export function buildEmbedUrl(item, { captions = true } = {}) {
      const base = item.video_id
        ? `https://www.youtube.com/embed/${item.video_id}`
        : `https://www.youtube.com/embed/live_stream?channel=${item.channel_id}`;
      const sep = base.includes('?') ? '&' : '?';
      const cc = captions ? '&cc_load_policy=1&cc_lang_pref=ja&hl=ja' : '';
      return `${base}${sep}autoplay=1&mute=1&playsinline=1${cc}`;
    }
    ```
  - 置換後（14 行）:
    ```js
    // キー不要のライブ埋め込みURL。video_id 優先（固定ライブ動画）、無ければ channel_id（チャンネルlive）。
    // captions=true（既定）で日本語字幕＋日本語UIを要求（cc_load_policy/cc_lang_pref/hl）。
    // 注: cc_lang_pref=ja は「日本語字幕トラックがあれば表示」までで、外国語音声の自動翻訳は強制できない（ベストエフォート）。
    // ドメインは youtube-nocookie（再生するまで Cookie を置かない・CSP frame-src もこの 1 つだけ）。
    // ID は config/*.json 由来なので encodeURIComponent でパス/クエリへの混入を閉じる。
    export function buildEmbedUrl(item, { captions = true } = {}) {
      const base = item.video_id
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.video_id)}`
        : `https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(item.channel_id)}`;
      const sep = base.includes('?') ? '&' : '?';
      const cc = captions ? '&cc_load_policy=1&cc_lang_pref=ja&hl=ja' : '';
      return `${base}${sep}autoplay=1&mute=1&playsinline=1${cc}`;
    }
    ```

- [ ] **Step 4: 通ることを確認（この時点では nocookie の 3 件だけ緑）**
  - Run: `node --test tests/media.test.js`
  - Expected: nocookie 系 3 件が PASS。`referrerpolicy` と `lc-note` の 2 件は依然 FAIL（Step 5-6 で実装）。

- [ ] **Step 5: 最小実装（referrerpolicy と AI 字幕注記）**

  5-1. `index.html` 117 行目（`#news-frame`）。
  - 置換前:
    ```html
                <iframe id="news-frame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
    ```
  - 置換後:
    ```html
                <iframe id="news-frame" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
    ```

  5-2. `index.html` 109 行目（AI 字幕トグルの直後に注記）。
  - 置換前:
    ```html
              <label class="cc-toggle"><input type="checkbox" id="lc-toggle"> AI字幕(日本語)</label>
    ```
  - 置換後（2 行）:
    ```html
              <label class="cc-toggle"><input type="checkbox" id="lc-toggle"> AI字幕(日本語)</label>
              <small class="lc-note">タブの音声をこの端末の変換サーバー（localhost:8900）へ送ります。外部には送信しません。</small>
    ```

  5-3. `js/ui/cams-pane.js` 76-79 行目（動的 iframe）。
  - 置換前:
    ```js
        const f = document.createElement('iframe');
        f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
        f.setAttribute('allowfullscreen', '');
        cell.appendChild(f);
    ```
  - 置換後（5 行）:
    ```js
        const f = document.createElement('iframe');
        f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
        f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        f.setAttribute('allowfullscreen', '');
        cell.appendChild(f);
    ```

  5-4. `css/orbis.css` の末尾に `.lc-note` を追記。
    ```css

    /* ===== A4 公開の体裁 — AI 字幕の送信先注記 ===== */
    /* 画面キャプチャの音声をどこへ送るのかを、トグルの隣で必ず読める位置に置く。 */
    .lc-note { flex: 1 1 100%; font-size: 11px; line-height: 1.6; color: var(--muted); }
    @media (min-width: 900px) { .lc-note { flex: 0 1 auto; } }
    ```

- [ ] **Step 6: 通ることを確認**
  - Run: `node --test tests/media.test.js`
  - Expected: PASS（`# fail 0`）。

- [ ] **Step 7: コミット**
  - `git add js/ui/media.js js/ui/cams-pane.js index.html css/orbis.css tests/media.test.js`
  - ```
    git commit -m "fix(media): 埋め込みを youtube-nocookie 化し referrerpolicy と字幕注記を追加

    ID は encodeURIComponent で閉じる。#news-frame とカメラの動的 iframe に
    strict-origin-when-cross-origin。AI 字幕は音声の送信先（localhost:8900）を
    トグル脇に明示（LEGAL-08 ①）。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル B — プロフィール出典フッタ（CC BY-SA 4.0）＋href スキーム検証

- [ ] **Step 8: 失敗するテストを書く** — `tests/profile_view.test.js` の末尾に追記。

```js

test('profileHtml: 出典フッタが記事名・CC BY-SA 4.0・AI 要約を明示する', () => {
  const h = profileHtml(BASE);
  assert.match(h, /出典: /);
  assert.match(h, /Wikipedia \(ja\) 東京都 ↗/);
  assert.match(h, /href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/deed\.ja"/);
  assert.match(h, /CC BY-SA 4\.0<\/a>・AI により要約\/再構成/);
  assert.match(h, /rel="noopener noreferrer"/);
  assert.ok(!h.includes('rel="noopener"'), '古い rel="noopener" が残っている');
});

test('profileHtml: 記事名は URL 末尾から取り、アンダースコアは空白に戻す', () => {
  const p = { ...BASE.profile,
    source: { qid: 'Q1', wikipedia_url: 'https://ja.wikipedia.org/wiki/%E5%A4%A7%E9%98%AA_(%E5%B8%82)' } };
  const h = profileHtml({ ...BASE, profile: p });
  assert.match(h, /Wikipedia \(ja\) 大阪 \(市\) ↗/);
});

test('profileHtml: 出典 URL が http(s) でなければリンクにしない', () => {
  const p = { ...BASE.profile, source: { qid: 'Q1', wikipedia_url: 'javascript:alert(1)' } };
  const h = profileHtml({ ...BASE, profile: p });
  assert.ok(!h.includes('javascript:alert(1)'), h);
  assert.doesNotMatch(h, /<a href="javascript/);
  // リンクにできなくても帰属表示（記事名は名称にフォールバック）と CC BY-SA は残す。
  assert.match(h, /Wikipedia \(ja\) 東京都/);
  assert.match(h, /CC BY-SA 4\.0/);
});
```

- [ ] **Step 9: 失敗を確認**
  - Run: `node --test tests/profile_view.test.js`
  - Expected: 3 件失敗。現行出力は `<a href="https://ja.wikipedia.org/wiki/東京都" target="_blank" rel="noopener">Wikipedia (ja) ↗</a>` なので `出典: ` も `CC BY-SA 4.0` も `noopener noreferrer` も無い。`javascript:alert(1)` はそのまま href に入るため 3 件目も失敗。

- [ ] **Step 10: 最小実装** — `js/lib/drilldown/profile_view.js`。

  10-1. 記事名ヘルパを足す（6 行目の import の直後）。
  - 置換前（6-7 行目）:
    ```js
    import { escapeHtml } from '../selection.js';

    ```
  - 置換後（10 行）:
    ```js
    import { escapeHtml } from '../selection.js';

    // Wikipedia URL 末尾のセグメント → 記事名（%xx をデコードし _ を空白へ）。
    // 記事名は帰属（CC BY-SA 4.0）の必須要素。取り出せなければ表示名にフォールバックする。
    function wikiArticleTitle(url, fallback) {
      const m = /\/wiki\/([^/?#]+)/.exec(String(url || ''));
      if (!m) return String(fallback || '');
      try { return decodeURIComponent(m[1]).replace(/_/g, ' '); }
      catch { return m[1].replace(/_/g, ' '); }
    }

    ```

  10-2. 出典フッタ（312-318 行目）。
  - 置換前:
    ```js
      // ── 出典フッタ ──
      const sourceHtml = source
        ? '<footer class="pf-source">'
          + '<a href="' + escapeHtml(source.wikipedia_url || '#') + '" target="_blank" rel="noopener">Wikipedia (ja) ↗</a>'
          + (source.qid ? '<span class="pf-qid">QID ' + escapeHtml(source.qid) + '</span>' : '')
          + '</footer>'
        : '';
    ```
  - 置換後（19 行）:
    ```js
      // ── 出典フッタ（Wikipedia 由来を明示して CC BY-SA 4.0 の帰属を果たす） ──
      // href は http/https のみ許可（不正データの javascript: 等を無効化＝selection.js と同方針）。
      // リンクにできない場合も記事名とライセンス表示は残す（帰属は URL の有無に依らない）。
      const wikiRaw = (source && source.wikipedia_url) || '';
      const wikiUrl = /^https?:\/\//i.test(wikiRaw) ? wikiRaw : '';
      const wikiTitle = wikiArticleTitle(wikiRaw, name_ja);
      const wikiLink = wikiUrl
        ? '<a href="' + escapeHtml(wikiUrl) + '" target="_blank" rel="noopener noreferrer">'
          + 'Wikipedia (ja) ' + escapeHtml(wikiTitle) + ' ↗</a>'
        : '<span>Wikipedia (ja) ' + escapeHtml(wikiTitle) + '</span>';
      const sourceHtml = source
        ? '<footer class="pf-source">'
          + '<span class="pf-src-label">出典: </span>' + wikiLink
          + '<span class="pf-license">（<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja"'
          + ' target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>・AI により要約/再構成）</span>'
          + (source.qid ? '<span class="pf-qid">QID ' + escapeHtml(source.qid) + '</span>' : '')
          + '</footer>'
        : '';
    ```

  10-3. `css/orbis.css` の 1701 行目（`.pf-source .pf-qid` の定義）の直後に 2 行を追記。
  - 置換前:
    ```css
    .pf-source .pf-qid { font-family: var(--font-word); letter-spacing: .04em; opacity: .8; }
    ```
  - 置換後（3 行）:
    ```css
    .pf-source .pf-qid { font-family: var(--font-word); letter-spacing: .04em; opacity: .8; }
    .pf-source .pf-src-label { color: var(--text-muted-3); }
    .pf-source .pf-license { color: var(--text-muted-3); }
    ```

- [ ] **Step 11: 通ることを確認**
  - Run: `node --test tests/profile_view.test.js tests/profile_render.test.js tests/drilldown_view.test.js`
  - Expected: PASS（`# fail 0`）。既存の `assert.match(h, /ja\.wikipedia\.org/)`（49 行目）も緑。

- [ ] **Step 12: コミット**
  - `git add js/lib/drilldown/profile_view.js css/orbis.css tests/profile_view.test.js`
  - ```
    git commit -m "fix(profile): 出典フッタに記事名と CC BY-SA 4.0・AI 再構成の明示を追加

    Wikipedia(ja) 由来の要約を再配布する以上、記事名＋ライセンスリンク＋
    AI 再構成の明示が要る（LEGAL-06）。href は http/https のみ許可。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル C — 外部リンク 4 箇所を `rel="noopener noreferrer"` に

- [ ] **Step 13: 失敗するテストを書く**

  13-1. `tests/sources.test.js` の末尾に追記（`sourceRowHtml` は 3 行目で import 済み＝import の変更は不要）。

```js

test('sourceRowHtml: 外部リンクは rel="noopener noreferrer"', () => {
  const h = sourceRowHtml({ label: 'USGS', rel: '1分前', count: 3, source: 'USGS', url: 'https://earthquake.usgs.gov' });
  assert.match(h, /rel="noopener noreferrer"/);
  assert.ok(!h.includes('rel="noopener"'), h);
});
```

  13-2. `tests/selection.test.js` の 3 行目に `newsPopupHtml` を足す（`gdeltEventPopupHtml` は既にある）。
  - 置換前（3 行目）:
    ```js
    import { selectionPopupHtml, buildReticleConfigs, escapeHtml, flightPopupHtml, buildProjectionConfigs, shipPopupHtml, projLabel, gdeltEventPopupHtml, gdeltCountryPopupHtml } from '../js/lib/selection.js';
    ```
  - 置換後:
    ```js
    import { selectionPopupHtml, buildReticleConfigs, escapeHtml, flightPopupHtml, buildProjectionConfigs, shipPopupHtml, projLabel, newsPopupHtml, gdeltEventPopupHtml, gdeltCountryPopupHtml } from '../js/lib/selection.js';
    ```

  13-3. `tests/selection.test.js` の末尾に追記。

```js

test('外部リンクは rel="noopener noreferrer"（Referer とタブ乗っ取りの両方を閉じる）', () => {
  const news = newsPopupHtml({ title_ja: 'T', category: 'conflict', url: 'https://example.com/a' });
  const ev = gdeltEventPopupHtml({ url: 'https://example.com/b', mentions: 3, place: 'JA' }, 'conflict');
  for (const h of [news, ev]) {
    assert.match(h, /rel="noopener noreferrer"/);
    assert.ok(!h.includes('rel="noopener"'), h);
  }
});
```

- [ ] **Step 14: 失敗を確認**
  - Run: `node --test tests/sources.test.js tests/selection.test.js`
  - Expected: 2 件失敗。`The input did not match the regular expression /rel="noopener noreferrer"/`（現行は `rel="noopener"`）。

- [ ] **Step 15: 最小実装**

  15-1. `js/ui/sources.js` 70-76 行目。
  - 置換前:
    ```js
    // 1行の HTML（escape 済み・URL は http/https のみリンク化）。
    export function sourceRowHtml(row) {
      const r = row || {};
      const safe = /^https?:\/\//i.test(r.url || '');
      const srcHtml = safe
        ? `<a class="src-link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.source)} ↗</a>`
        : `<span class="src-src">${esc(r.source)}</span>`;
    ```
  - 置換後（8 行）:
    ```js
    // 1行の HTML（escape 済み・URL は http/https のみリンク化）。
    // rel は noopener noreferrer（新規タブからの window.opener 乗っ取りと Referer 送出の両方を閉じる）。
    export function sourceRowHtml(row) {
      const r = row || {};
      const safe = /^https?:\/\//i.test(r.url || '');
      const srcHtml = safe
        ? `<a class="src-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source)} ↗</a>`
        : `<span class="src-src">${esc(r.source)}</span>`;
    ```

  15-2. `js/lib/selection.js` 175 行目（`newsPopupHtml`）。
  - 置換前:
    ```js
        + ` target="_blank" rel="noopener">${escapeHtml(host)} ↗</a></div>`
        + '</div>';
    }

    const GDELT_LABEL = { conflict: '紛争', protests: '抗議' };
    ```
  - 置換後（5 行）:
    ```js
        + ` target="_blank" rel="noopener noreferrer">${escapeHtml(host)} ↗</a></div>`
        + '</div>';
    }

    const GDELT_LABEL = { conflict: '紛争', protests: '抗議' };
    ```

  15-3. `js/lib/selection.js` 198 行目（`gdeltEventPopupHtml`）。
  - 置換前:
    ```js
        + ` target="_blank" rel="noopener">${escapeHtml(host)} ↗</a></div>`
        + '<div class="sel-hint">📍 この地点へ移動しました</div>'
    ```
  - 置換後:
    ```js
        + ` target="_blank" rel="noopener noreferrer">${escapeHtml(host)} ↗</a></div>`
        + '<div class="sel-hint">📍 この地点へ移動しました</div>'
    ```
  - 注: `profile_view.js` の 1 箇所は Step 10 で対応済み。これで骨格の「外部リンク 4 箇所」が揃う。

- [ ] **Step 16: 通ることを確認**
  - Run: `node --test tests/*.test.js`
  - Expected: PASS（`# fail 0`）。`grep -rn 'rel="noopener"' js/` の出力が **0 行**。

- [ ] **Step 17: コミット**
  - `git add js/ui/sources.js js/lib/selection.js tests/sources.test.js tests/selection.test.js`
  - ```
    git commit -m "fix(links): 外部リンクを rel=noopener noreferrer に統一（4 箇所）

    sources.js:75 / selection.js:175,198 / profile_view.js。Referer 送出も
    window.opener 経由の乗っ取りも閉じる（SECURITY-15）。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル D — e2e 期待値の更新と `test_pages.py` の xfail 解除

- [ ] **Step 18: 失敗するテストにする（e2e の期待 URL を nocookie へ）** — `tests/e2e/media.spec.js` の 2 箇所。
  - 置換前（33 行目）:
    ```js
        return srcs.length > 0 && srcs.every((s) => s.includes('youtube.com/embed/'));
    ```
  - 置換後:
    ```js
        return srcs.length > 0 && srcs.every((s) => s.includes('youtube-nocookie.com/embed/'));
    ```
  - 置換前（77 行目）:
    ```js
        return srcs.length > 1 && srcs.every((s) => s && s.includes('youtube.com/embed/'));
    ```
  - 置換後:
    ```js
        return srcs.length > 1 && srcs.every((s) => s && s.includes('youtube-nocookie.com/embed/'));
    ```
  - 注: `npm run test:e2e`（20 spec）は `data/snapshots` が worktree に無いので**回さない**（骨格 Global Constraints）。この 2 行は Phase B で fixture 化するまで静的更新のみ。整合は次の Step の `grep` で確認する。

- [ ] **Step 19: 失敗を確認（静的）**
  - Run: `grep -rn "youtube.com/embed" tests/ js/ index.html`
  - Expected: **1 行も出ない**（出たら未修正の期待値が残っている）。この時点で `python3 -m pytest -q tests/test_pages.py` を回すと、Task 2 が置いた 2 件が `xfail`（`2 xfailed`）ではなく **`XPASS(strict)` で失敗**する＝実装が先に入ったので xfail を外す必要がある、というのが「赤」。

- [ ] **Step 20: 最小実装（xfail 解除）** — `tests/test_pages.py`（Task 2 が置いた 2 件）の decorator 行を削除する。`import pytest` は `@pytest.mark.parametrize` が多数あるので**残す**。
  - 置換前（1 箇所目）:
    ```python
    @pytest.mark.xfail(strict=True, reason="Task 8（part3）が youtube-nocookie 化したら緑（Task 8 でこの行を削除する）")
    def test_no_youtube_com_embed_in_served_code():
    ```
  - 置換後:
    ```python
    def test_no_youtube_com_embed_in_served_code():
    ```
  - 置換前（2 箇所目）:
    ```python
    @pytest.mark.xfail(strict=True, reason="Task 8（part3）が rel を noopener noreferrer にしたら緑（Task 8 でこの行を削除する）")
    def test_external_links_are_noopener_noreferrer():
    ```
  - 置換後:
    ```python
    def test_external_links_are_noopener_noreferrer():
    ```
  - 実際の関数名／reason が上と違う場合は `grep -n "xfail" tests/test_pages.py` の該当 2 件について、**`@pytest.mark.xfail(...)` のデコレータだけを削除**する（本文は触らない）。Task 3 が外した `test_pages_are_declared_in_vercel_builds` の分はここには残っていない。

- [ ] **Step 21: 通ることを確認**
  - Run: `node --test tests/*.test.js` → `python3 -m pytest -q`
  - Expected: どちらも PASS（`# fail 0` ／ `N passed`・`xfailed` は Task 6 由来の 1 件のみ）。

- [ ] **Step 22: コミット**
  - `git add tests/e2e/media.spec.js tests/test_pages.py`
  - ```
    git commit -m "test: e2e の埋め込み URL 期待を nocookie に更新し test_pages の xfail を解除

    Task 2 で先置きした 2 件（nocookie・rel）が実装されたので strict xfail を外す。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル E — orbis-data 用の `LICENSE` と `DATA-SOURCES.md`（作成のみ・push は親セッション）

- [ ] **Step 23: 置き場を作る**
  - Run: `mkdir -p /tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-legal`
  - Expected: エラー無し。**この 2 ファイルは orbis リポには追加しない**（`git status` に出ない場所に作る）。

- [ ] **Step 24: `LICENSE` を書く** — `…/orbis-data-legal/LICENSE`

```
MIT License

Copyright (c) 2026 sg55555

このライセンスは、本リポジトリが配布する JSON の「構造」（スキーマ、
manifest.json、集計・整形を行うコード由来の表現）に適用されます。
各データそのものの権利は上流の提供者に帰属し、利用条件は同梱の
DATA-SOURCES.md に従います。

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 25: `DATA-SOURCES.md` を書く** — `…/orbis-data-legal/DATA-SOURCES.md`（内容は `attribution.html`（Task 2）と同一の表）

```markdown
# データソースと利用条件

本リポジトリは [Orbis](https://orbis-beta.vercel.app)（`sg55555/orbis`・個人運営・非商用）が
GitHub Actions で収集・整形した公開データのスナップショットを配布します。
JSON の構造は MIT（同梱 `LICENSE`）。**各データの権利は下表の上流に帰属し、
再利用はそれぞれの条件に従ってください。**

| 層 / ファイル | 上流 | 条件・帰属 |
|---|---|---|
| `quakes.json`（地震） | USGS Earthquake Hazards Program | 米国政府の著作物＝パブリックドメイン |
| `flights.json`（航空） | OpenSky Network | OpenSky の利用規約（非商用の研究利用） |
| `conflict.json` / `protests.json`（紛争・抗議） | The GDELT Project | GDELT の利用規約（出典表示・再配布可） |
| `ships.json`（船舶） | AISstream.io | AISstream の利用規約 |
| `news.json`（ニュース） | 各媒体の公開 RSS（見出し・要約・リンク） | 見出しと要約は **AI による日本語化**。本文は配布せず、原記事へリンクする。著作権は各媒体 |
| `sst.json`（海水温） | Open-Meteo Marine API | CC BY 4.0 — © Open-Meteo |
| `airtemp.json`（気温） | Open-Meteo API | CC BY 4.0 — © Open-Meteo |
| `firms.json`（山火事） | NASA FIRMS (MODIS / VIIRS) | NASA の公開データ。FIRMS の利用条件に従う |
| `briefing.json` / `instability.json` / `forecast.json`（AI 3 層） | 上記各層から Claude が合成 | **AI 生成物**（要約・推定）。誤りを含みうる。元データの条件が継承される |
| `profiles/*.json.gz`（地域プロフィール） | Wikipedia (ja) を AI が要約・再構成／Wikidata | 本文＝**CC BY-SA 4.0**（記事名を明示・再配布は同一ライセンス）。Wikidata プロパティ＝CC0 |
| `admin1/*.geojson.gz`・`admin1_bbox.json`（行政界） | Natural Earth | パブリックドメイン |
| 地図タイル（本リポには含まない） | OpenFreeMap / OpenMapTiles / OpenStreetMap contributors | ODbL — © OpenStreetMap contributors |

## 免責

- 収集は無保証・ベストエフォートです。欠測・遅延・誤りがありえます。
- 安全・投資・避難などの判断に用いないでください。
- 問い合わせ・削除依頼は GitHub Issues（<https://github.com/sg55555/orbis/issues>）へ。
```

- [ ] **Step 26: 親セッションへの引き渡し（サブエージェントは push しない）**
  - この 2 ファイルの本文をそのまま親セッションに渡し、**親セッションが本人確認のうえ**手元の shallow clone から orbis-data へ通常 push する。手順は次の 4 実行（**それぞれ 1 コマンド起動**・B0 の初回 squash の後に行う）。

  実行1（1 回だけ・作業ディレクトリを掃除して shallow clone）
  ```
  rm -rf /tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-push && git clone --depth 1 https://github.com/sg55555/orbis-data.git /tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-push
  ```

  実行2（この 1 行で 1 コマンド・2 ファイルをコピー）
  ```
  cp /tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-legal/LICENSE /tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-legal/DATA-SOURCES.md /tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-push/
  ```

  実行3（この 1 行で 1 コマンド・コミット）
  ```
  git -C /tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-push add LICENSE DATA-SOURCES.md && git -C /tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-push commit -m "docs: LICENSE（MIT・構造に適用）と DATA-SOURCES.md を追加"
  ```

  実行4（この 1 行で 1 コマンド・通常 push。collect と衝突したら `git -C … pull --rebase` 後に再実行）
  ```
  git -C /tmp/claude-1000/-home-shugo/025c3611-418a-45a3-99b0-a1a7040c6a8d/scratchpad/orbis-data-push push origin HEAD:main
  ```

  - 実行4 の確認メッセージ（日本語・骨格の破壊系フォーマット）: 「`git push` を実行します。理由：orbis-data に LICENSE と DATA-SOURCES.md を追加するため。push 先は保護ブランチではなく、**追加のみ（既存ファイルを変更しない）通常 push** で force ではありません。」
  - Expected: `gh api repos/sg55555/orbis-data/contents/LICENSE --jq .name` が `LICENSE` を返す。

- [ ] **Step 27: コミット（orbis リポ側は変更なしの確認だけ）**
  - Run: `git status --porcelain`
  - Expected: **出力なし**（scratchpad に作ったので orbis リポは汚れていない）。追加のコミットはしない。

---

### Task 9: A5 sw.js v52＋`test_sw.py`＋`drilldown_sw.test.js`＋GDELT https/MD5＋instability Number＋profile href 検証＋`.superpowers` 追跡解除＋`test_tracked_files.py`

**Files:**
- Create: `tests/test_sw.py`、`tests/test_tracked_files.py`
- Modify: `sw.js`（全文）／`tests/drilldown_sw.test.js`（12-20 行）／`collectors/gdelt_events.py`（1-11・104-120 行）／`tests/test_gdelt.py`（1-10 行＋末尾）／`js/ui/instability.js`（14-16・43-54 行）／`tests/instability.test.js`（末尾）／`tests/test_static_guards.py`（xfail 1 件の解除）
- 削除（追跡のみ）: `.superpowers/sdd/cluster-C4-report.md`、`.superpowers/sdd/cluster-C7-report.md`（`git rm --cached`・作業ツリーのファイルは残す）

**Interfaces:**
- Consumes: `load_config(root: Path) -> dict`／`expand_builds(cfg: dict, root: Path) -> set[str]`（Task 3 の `tests/vercel_routes.py`）
- Produces（骨格 Interfaces のとおり）:
  - `sw.js` のソースに文字列 `url.origin !== self.location.origin` と `res.ok && res.type === 'basic'` を**その表記で**含める
  - `collectors/gdelt_events.py`：`LASTUPDATE_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt"`／`parse_lastupdate_line(line: str) -> tuple[int, str, str]`／`verify_md5(data: bytes, expected: str) -> None`
  - `js/ui/instability.js`：`fmtSignedPct(n)` は `Number(n) || 0` で数値化してから整形（外形は不変）
- 注: `profile_view.js` の href スキーム検証は Task 8 Step 10 で入れ済み（重複させない）。

---

#### サイクル A — sw.js v52 と静的テスト

- [ ] **Step 1: 失敗するテストを書く（1）** — `tests/test_sw.py` を新規作成。

```python
"""Service Worker の版・SHELL・取得方針（設計 §3.5・骨格 Interfaces）。

型＝~/apps/task-dashboard/tests/test_sw.py。Orbis 固有の差分は
  ・SHELL から '/index.html' を外す（vercel.json routes が 308 → '/'。addAll は redirect で失敗する）
  ・配信 allowlist は builds なので tests/vercel_routes.py の expand_builds と突合する
  ・死んだ cartocdn バイパスを消す
"""
import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vercel_routes import expand_builds, load_config  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
SW = (ROOT / "sw.js").read_text(encoding="utf-8")


def _shell():
    m = re.search(r"const SHELL = \[(.*?)\];", SW, re.S)
    assert m, "sw.js: const SHELL = [...] が見つからない"
    return re.findall(r"'([^']+)'", m.group(1))


def _fetch_handler():
    m = re.search(r"self\.addEventListener\('fetch'.*?\n\}\);", SW, re.S)
    assert m, "sw.js: fetch ハンドラが見つからない"
    return m.group(0)


def test_cache_version_is_v52():
    assert re.search(r"const CACHE = 'orbis-v52';", SW), "sw.js を触ったら CACHE を +1 する"


def test_shell_is_the_four_expected_paths():
    assert _shell() == ["/", "/css/orbis.css", "/js/main.js", "/js/lib/presets.js"]


def test_shell_does_not_contain_index_html():
    # '/index.html' は routes で 308 → '/'。addAll は redirect 応答で失敗し install ごと落ちる。
    assert "/index.html" not in _shell()


def test_shell_paths_are_all_served():
    """存在しない資産を addAll すると SW ごと install に失敗する（builds allowlist と突合）。"""
    served = expand_builds(load_config(ROOT), ROOT)
    for p in _shell():
        target = "/index.html" if p == "/" else p
        assert target in served, f"{p} が builds の配信 allowlist に無い"


def test_cross_origin_requests_bypass_the_service_worker():
    """別オリジンを中継すると SW 応答に載る CSP（connect-src 'self' …）で判定されてしまう。

    素通しならブラウザがページ側の img-src/connect-src で判定する。
    """
    body = _fetch_handler()
    assert "url.origin !== self.location.origin" in body, \
        "sw.js: 別オリジンを素通しにする early return が無い"
    assert body.index("url.origin !== self.location.origin") < body.index("e.respondWith("), \
        "sw.js: 素通しの判定は最初の e.respondWith( より前に置く"


def test_only_successful_basic_responses_are_cached():
    """404/500 や opaque 応答を put すると壊れた応答がキャッシュに固定化する。"""
    assert "res.ok && res.type === 'basic'" in _fetch_handler()


def test_dead_cartocdn_bypass_is_gone():
    assert "cartocdn" not in SW, "cartocdn は既に参照していない（死んだ条件）"


def test_snapshots_are_always_network():
    assert "/data/snapshots/" in _fetch_handler()
```

- [ ] **Step 2: 失敗を確認**
  - Run: `python3 -m pytest -q tests/test_sw.py`
  - Expected: 失敗。`test_cache_version_is_v52` が `AssertionError: sw.js を触ったら CACHE を +1 する`（現行は `orbis-v51`）、`test_shell_is_the_four_expected_paths` が `['/', '/index.html', '/css/orbis.css', …] != ['/', '/css/orbis.css', …]`、`test_only_successful_basic_responses_are_cached` と `test_dead_cartocdn_bypass_is_gone` も失敗。

- [ ] **Step 3: 最小実装** — `sw.js` の**全文**を次で置き換える。

```js
// ORBIS Service Worker — シェルはネットワーク優先（更新を常に即反映）。データJSONも常にネット。
const CACHE = 'orbis-v52';
// '/index.html' は vercel.json routes が 308 → '/' に飛ばすので入れない
// （addAll は redirect 応答で失敗し、install ごと落ちる）。
const SHELL = ['/', '/css/orbis.css', '/js/main.js', '/js/lib/presets.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 別オリジン（タイル・raw データ・YouTube・サムネ）は SW が中継しない。
  // 中継すると SW 自身の応答に載る CSP（connect-src 'self' …）で判定されてしまい、
  // ページ側の緩い img-src が届かない。素通しならブラウザが HTTP キャッシュで扱う。
  // e.respondWith() を呼ばず return すると、ブラウザが既定のネットワーク取得を行う。
  if (url.origin !== self.location.origin) return;
  // ローカル開発の生スナップショットは常にネットワーク（鮮度優先）。
  if (url.pathname.startsWith('/data/snapshots/')) return;
  // シェル/コードはネットワーク優先：常に最新を取得し成功時にキャッシュ更新、
  // ネット失敗（オフライン）時のみキャッシュへフォールバック（PWA のオフライン起動を維持）。
  // 失敗応答（404/500）や opaque 応答まで put すると壊れた応答が固定化するので、
  // res.ok && res.type === 'basic' の時だけ保存する。
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
```

- [ ] **Step 4: 既存の JS 側テストも更新** — `tests/drilldown_sw.test.js` の 1-20 行目（全文）を差し替える。
  - 置換前:
    ```js
    // tests/drilldown_sw.test.js
    // SW の CACHE 版番号が Phase2 で v45 に上がっていることを検証（新コード/CSS を確実に配信させる）。
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { fileURLToPath } from 'node:url';
    import { dirname, join } from 'node:path';

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const sw = readFileSync(join(__dirname, '..', 'sw.js'), 'utf8');

    test('sw.js: CACHE は orbis-v51', () => {
      assert.match(sw, /const\s+CACHE\s*=\s*['"]orbis-v51['"]/);
    });

    test('sw.js: bypass 条件（snapshots/raw/cartocdn）は維持', () => {
      assert.match(sw, /raw\.githubusercontent\.com/);
      assert.match(sw, /\/data\/snapshots\//);
      assert.match(sw, /cartocdn/);
    });
    ```
  - 置換後（23 行）:
    ```js
    // tests/drilldown_sw.test.js
    // SW の CACHE 版番号と bypass 方針。Phase A（Task 9）で v52・同一オリジン判定に変更。
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { fileURLToPath } from 'node:url';
    import { dirname, join } from 'node:path';

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const sw = readFileSync(join(__dirname, '..', 'sw.js'), 'utf8');

    test('sw.js: CACHE は orbis-v52', () => {
      assert.match(sw, /const\s+CACHE\s*=\s*['"]orbis-v52['"]/);
    });

    test('sw.js: bypass は「別オリジン全部」＋ローカルの生スナップショット', () => {
      // raw.githubusercontent.com / タイル / YouTube はホスト名の列挙ではなく origin 判定で素通し。
      assert.match(sw, /url\.origin !== self\.location\.origin/);
      assert.match(sw, /\/data\/snapshots\//);
      assert.doesNotMatch(sw, /cartocdn/);            // 死んだ参照は消した
      assert.doesNotMatch(sw, /raw\.githubusercontent\.com/); // ホスト名の個別列挙は不要
    });
    ```

- [ ] **Step 5: 通ることを確認**
  - Run: `python3 -m pytest -q tests/test_sw.py` → `node --test tests/drilldown_sw.test.js`
  - Expected: どちらも PASS（`9 passed` ／ `# fail 0`）。

- [ ] **Step 6: コミット**
  - `git add sw.js tests/test_sw.py tests/drilldown_sw.test.js`
  - ```
    git commit -m "fix(sw): v52＝同一オリジンのみ・成功応答のみキャッシュ・SHELL から index.html を除去

    別オリジンを中継すると SW 応答の CSP で外部画像/タイルが消える。404/500 と
    opaque 応答の put をやめ壊れた応答の固定化を防ぐ。'/index.html' は routes で
    308 になるため addAll から外す。死んだ cartocdn 条件を削除。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル B — GDELT の HTTPS 昇格と MD5 照合

- [ ] **Step 7: 失敗するテストを書く** — `tests/test_gdelt.py` の 1-10 行目を差し替え、末尾に 6 テストを追記する。
  - 置換前（1-4 行目）:
    ```python
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from collectors.gdelt_events import parse_rows, split_events, merge_rolling
    from datetime import datetime
    ```
  - 置換後（9 行）:
    ```python
    import hashlib
    import io
    import sys, os
    import zipfile
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import pytest
    from collectors import gdelt_events
    from collectors.gdelt_events import parse_rows, split_events, merge_rolling, parse_lastupdate_line, verify_md5
    from datetime import datetime
    ```
  - 末尾に追記:

```python


# --- lastupdate.txt の 3 列（size / md5 / url）を使った改竄・途中切れ検知 ---

LU_URL = "http://data.gdeltproject.org/gdeltv2/20260903000000.export.CSV.zip"


def test_parse_lastupdate_line_returns_size_md5_and_https_url():
    size, md5, url = parse_lastupdate_line(f"246254 4d0c1f2f7e2b1d3a9c8e0f1a2b3c4d5e {LU_URL}")
    assert size == 246254
    assert md5 == "4d0c1f2f7e2b1d3a9c8e0f1a2b3c4d5e"
    assert url == "https://data.gdeltproject.org/gdeltv2/20260903000000.export.CSV.zip"


def test_parse_lastupdate_line_keeps_https_url_as_is():
    _size, _md5, url = parse_lastupdate_line(f"1 abc {LU_URL.replace('http://', 'https://')}")
    assert url.startswith("https://")


def test_parse_lastupdate_line_rejects_missing_columns():
    with pytest.raises(ValueError):
        parse_lastupdate_line("246254 4d0c1f2f7e2b1d3a9c8e0f1a2b3c4d5e")
    with pytest.raises(ValueError):
        parse_lastupdate_line("")


def test_verify_md5_accepts_matching_digest_and_rejects_mismatch():
    verify_md5(b"hello", hashlib.md5(b"hello").hexdigest())
    verify_md5(b"hello", hashlib.md5(b"hello").hexdigest().upper())  # 大小文字は問わない
    with pytest.raises(ValueError, match="gdelt md5 mismatch"):
        verify_md5(b"hello", hashlib.md5(b"world").hexdigest())


class _Resp:
    def __init__(self, text=None, content=None):
        self.text = text
        self.content = content

    def raise_for_status(self):
        return None


def _fake_requests(seen, lastupdate, payload):
    class _Fake:
        @staticmethod
        def get(url, **_kw):
            seen.append(url)
            if url.endswith("lastupdate.txt"):
                return _Resp(text=lastupdate)
            return _Resp(content=payload)
    return _Fake


def _zip_payload():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("20260903000000.export.CSV", "a\tb\tc\n")
    return buf.getvalue()


def test_fetch_latest_rows_uses_https_and_verifies_md5(monkeypatch):
    payload = _zip_payload()
    lastupdate = f"{len(payload)} {hashlib.md5(payload).hexdigest()} {LU_URL}\n"
    seen = []
    monkeypatch.setattr(gdelt_events, "requests", _fake_requests(seen, lastupdate, payload))
    rows = gdelt_events.fetch_latest_rows()
    assert rows == [["a", "b", "c"]]
    assert seen[0] == "https://data.gdeltproject.org/gdeltv2/lastupdate.txt"
    assert seen[1].startswith("https://"), "export URL も https に昇格する"


def test_fetch_latest_rows_raises_on_md5_mismatch(monkeypatch):
    payload = _zip_payload()
    lastupdate = f"{len(payload)} {hashlib.md5(b'tampered').hexdigest()} {LU_URL}\n"
    monkeypatch.setattr(gdelt_events, "requests", _fake_requests([], lastupdate, payload))
    with pytest.raises(ValueError, match="gdelt md5 mismatch"):
        gdelt_events.fetch_latest_rows()
```

- [ ] **Step 8: 失敗を確認**
  - Run: `python3 -m pytest -q tests/test_gdelt.py`
  - Expected: collection エラー。`ImportError: cannot import name 'parse_lastupdate_line' from 'collectors.gdelt_events'`（ファイル全体が実行前に落ちる）。

- [ ] **Step 9: 最小実装** — `collectors/gdelt_events.py`。

  9-1. import と URL（1-11 行目）。
  - 置換前:
    ```python
    """GDELT 2.0 Events CSV を取得し、抗議/紛争イベントを地理点として書き出す。"""
    import csv
    import io
    import json
    import os
    import zipfile
    from datetime import datetime, timezone
    import requests
    from collectors.lib.manifest import update_manifest

    LASTUPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt"
    ```
  - 置換後（11 行）:
    ```python
    """GDELT 2.0 Events CSV を取得し、抗議/紛争イベントを地理点として書き出す。"""
    import csv
    import hashlib
    import io
    import json
    import os
    import zipfile
    from datetime import datetime, timezone
    import requests
    from collectors.lib.manifest import update_manifest

    LASTUPDATE_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt"
    ```

  9-2. 新関数 2 つを `fetch_latest_rows` の直前（`SNAPSHOT_DIR = ...` の次の空行の後）に足す。
  - 置換前（101-105 行目）:
    ```python
    SNAPSHOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "snapshots"))


    def fetch_latest_rows(timeout=40):
        """lastupdate.txt → 最新 export.CSV.zip を取得し TSV 行配列を返す。"""
    ```
  - 置換後（32 行）:
    ```python
    SNAPSHOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "snapshots"))


    def parse_lastupdate_line(line):
        """lastupdate.txt の 1 行 `<size> <md5> <url>` → (size, md5, https URL)（純粋）。

        列が 3 つ未満なら ValueError。GDELT は URL を http:// で配るが同一ホストで
        https が有効なので昇格する（平文だと中間者が zip と MD5 を同時に差し替えられる）。
        """
        parts = line.split()
        if len(parts) < 3:
            raise ValueError(f"gdelt lastupdate line has {len(parts)} columns: {line!r}")
        size_s, md5, url = parts[0], parts[1], parts[2]
        try:
            size = int(size_s)
        except ValueError as e:
            raise ValueError(f"gdelt lastupdate size is not an int: {size_s!r}") from e
        if url.startswith("http://"):
            url = "https://" + url[len("http://"):]
        return size, md5, url


    def verify_md5(data, expected):
        """ダウンロードした zip を lastupdate.txt 申告の MD5 と照合（不一致は ValueError）。

        途中切れ・改竄の検知が目的（暗号学的強度は求めていない＝上流が MD5 しか配らない）。
        """
        actual = hashlib.md5(data).hexdigest()
        if actual.lower() != str(expected).lower():
            raise ValueError("gdelt md5 mismatch")


    def fetch_latest_rows(timeout=40):
        """lastupdate.txt → 最新 export.CSV.zip を取得し TSV 行配列を返す。

        2 列目の MD5 を照合してから展開する（失敗は既存の mark_error 経路で可視化される）。
        """
    ```

  9-3. `fetch_latest_rows` の本体（106-120 行目）。
  - 置換前:
    ```python
        lu = requests.get(LASTUPDATE_URL, timeout=timeout, headers={"User-Agent": "orbis-collector"})
        lu.raise_for_status()
        export_url = None
        for line in lu.text.splitlines():
            parts = line.split()
            if parts and parts[-1].endswith("export.CSV.zip"):
                export_url = parts[-1]
                break
        if not export_url:
            raise RuntimeError("no export.CSV.zip in lastupdate")
        z = requests.get(export_url, timeout=timeout, headers={"User-Agent": "orbis-collector"})
        z.raise_for_status()
        zf = zipfile.ZipFile(io.BytesIO(z.content))
        raw = zf.read(zf.namelist()[0]).decode("latin-1")
        return list(csv.reader(io.StringIO(raw), delimiter="\t"))
    ```
  - 置換後（17 行）:
    ```python
        lu = requests.get(LASTUPDATE_URL, timeout=timeout, headers={"User-Agent": "orbis-collector"})
        lu.raise_for_status()
        export_url = None
        expected_md5 = None
        for line in lu.text.splitlines():
            if not line.strip().endswith("export.CSV.zip"):
                continue
            _size, expected_md5, export_url = parse_lastupdate_line(line)
            break
        if not export_url:
            raise RuntimeError("no export.CSV.zip in lastupdate")
        z = requests.get(export_url, timeout=timeout, headers={"User-Agent": "orbis-collector"})
        z.raise_for_status()
        verify_md5(z.content, expected_md5)
        zf = zipfile.ZipFile(io.BytesIO(z.content))
        raw = zf.read(zf.namelist()[0]).decode("latin-1")
        return list(csv.reader(io.StringIO(raw), delimiter="\t"))
    ```

- [ ] **Step 10: 通ることを確認**
  - Run: `python3 -m pytest -q tests/test_gdelt.py`
  - Expected: PASS（既存 5＋新規 6 の `11 passed`）。ネットワークアクセスは行われない（`requests` を差し替えている）。

- [ ] **Step 11: コミット**
  - `git add collectors/gdelt_events.py tests/test_gdelt.py`
  - ```
    git commit -m "fix(collectors): GDELT を HTTPS 化し lastupdate の MD5 を照合する

    lastupdate.txt と export URL の両方を https に昇格（平文だと zip と MD5 を
    同時に差し替えられる）。2 列目の MD5 と実バイトを突合し不一致は ValueError
    （既存の mark_error 経路で可視化）。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル C — instability の数値強制

- [ ] **Step 12: 失敗するテストを書く** — `tests/instability.test.js` の末尾に追記。

```js

test('fmtSignedPct: 数値化できない値は 0%（HTML を素通ししない）', () => {
  assert.equal(fmtSignedPct('12'), '+12%');
  assert.equal(fmtSignedPct(-3), '-3%');
  assert.equal(fmtSignedPct('<img src=x onerror=alert(1)>'), '0%');
  assert.equal(fmtSignedPct(undefined), '0%');
  assert.equal(fmtSignedPct(null), '0%');
});

test('rowHtml: trend の delta/deltaPct に HTML を入れても出力に生タグが出ない', () => {
  const html = rowHtml({ code: 'XX', name_ja: 'X国', score: 30,
    counts: { conflict: 0, protests: 0, news: 0, quakes: 0 },
    trend: { isNew: false,
      dod: { dir: 'up', delta: '<img src=x onerror=alert(1)>' },
      normal: { dir: 'up', deltaPct: '<img src=y>' } } });
  assert.ok(!html.includes('<img'), html);
  assert.match(html, /昨日比0/);
  assert.match(html, /平常比0%/);
});
```

- [ ] **Step 13: 失敗を確認**
  - Run: `node --test tests/instability.test.js`
  - Expected: 2 件失敗。`fmtSignedPct('<img src=x onerror=alert(1)>')` は `'<img src=x onerror=alert(1)>%'` を返し、`rowHtml` の出力に生の `<img` が現れる（`AssertionError` に該当 HTML が出る）。

- [ ] **Step 14: 最小実装** — `js/ui/instability.js`。

  14-1. `fmtSignedPct`（14-16 行目）。
  - 置換前:
    ```js
    export function fmtSignedPct(n) {
      return (n > 0 ? '+' : '') + n + '%';
    }
    ```
  - 置換後（6 行）:
    ```js
    // 上流 JSON 由来の値をそのまま文字列連結すると HTML が素通りする（この位置は esc を通さない）。
    // 数値でなければ 0 に潰す＝型で閉じる。
    export function fmtSignedPct(n) {
      const v = Number(n) || 0;
      return (v > 0 ? '+' : '') + v + '%';
    }
    ```

  14-2. `_trendBadges`（43-54 行目）。
  - 置換前:
    ```js
    function _trendBadges(tr) {
      if (!tr || tr.isNew) return '<span class="ins-new">新規</span>';
      // 昨日比(dod)・平常比(normal) を常に同順の2スロットで出力。欠落側は空プレースホルダ＝
      // デザイン監修の固定2カラム整列（body.secfit-on .ins-trend）で縦ラインが片方欠落行でも崩れないため。
      const dod = tr.dod
        ? `<span class="ins-tr ins-dod ins-${esc(tr.dod.dir)}">${trendArrow(tr.dod.dir)}昨日比${tr.dod.delta > 0 ? '+' : ''}${tr.dod.delta}</span>`
        : '<span class="ins-tr ins-dod ins-none" aria-hidden="true"></span>';
      const normal = tr.normal
        ? `<span class="ins-tr ins-normal ins-${esc(tr.normal.dir)}">${trendArrow(tr.normal.dir)}平常比${fmtSignedPct(tr.normal.deltaPct)}</span>`
        : '<span class="ins-tr ins-normal ins-none" aria-hidden="true"></span>';
      return dod + normal;
    }
    ```
  - 置換後（15 行）:
    ```js
    function _trendBadges(tr) {
      if (!tr || tr.isNew) return '<span class="ins-new">新規</span>';
      // 昨日比(dod)・平常比(normal) を常に同順の2スロットで出力。欠落側は空プレースホルダ＝
      // デザイン監修の固定2カラム整列（body.secfit-on .ins-trend）で縦ラインが片方欠落行でも崩れないため。
      // delta/deltaPct は上流 JSON 由来なので Number で数値に固定する（数値化できない値は 0）。
      const dodDelta = tr.dod ? (Number(tr.dod.delta) || 0) : 0;
      const dod = tr.dod
        ? `<span class="ins-tr ins-dod ins-${esc(tr.dod.dir)}">${trendArrow(tr.dod.dir)}昨日比${dodDelta > 0 ? '+' : ''}${dodDelta}</span>`
        : '<span class="ins-tr ins-dod ins-none" aria-hidden="true"></span>';
      const normal = tr.normal
        ? `<span class="ins-tr ins-normal ins-${esc(tr.normal.dir)}">${trendArrow(tr.normal.dir)}平常比${fmtSignedPct(tr.normal.deltaPct)}</span>`
        : '<span class="ins-tr ins-normal ins-none" aria-hidden="true"></span>';
      return dod + normal;
    }
    ```

- [ ] **Step 15: 通ることを確認**
  - Run: `node --test tests/instability.test.js tests/alerts.test.js`
  - Expected: PASS（`# fail 0`）。`alerts.js` は `Number(t.normal.deltaPct)` を既に通しているので影響なし。

- [ ] **Step 16: コミット**
  - `git add js/ui/instability.js tests/instability.test.js`
  - ```
    git commit -m "fix(instability): trend の delta/deltaPct を Number で数値に固定する

    この 2 スロットは esc を通さない数値表示なので、上流 JSON に文字列や HTML が
    混ざると素通りする。Number(...) || 0 で型を閉じる（SECURITY-10）。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

#### サイクル D — `.superpowers` の追跡解除と追跡ガード

- [ ] **Step 17: 失敗するテストを書く** — `tests/test_tracked_files.py` を新規作成。

```python
"""AI セッションの作業ディレクトリが git 追跡に混入していないか（設計 §3.5）。

.gitignore に書いてあっても、過去に `git add` されたファイルは無視されない。
Orbis は公開リポなので、会話ログ・作業メモ・鍵が push される事故を静的に止める。
"""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIRS = [".superpowers", ".claude", ".claire"]


def test_agent_workdirs_are_not_tracked():
    out = subprocess.run(
        ["git", "ls-files", "--"] + DIRS,
        cwd=str(ROOT), capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert out == "", f"追跡されている作業ファイル:\n{out}\n→ git rm --cached <path> で外す"


def test_gitignore_still_lists_the_agent_workdirs():
    """追跡解除だけでは再追加を防げない（.gitignore とセットで初めて効く）。"""
    ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for d in DIRS:
        assert f"{d}/" in ignore, f"{d}/ が .gitignore に無い"
```

- [ ] **Step 18: 失敗を確認**
  - Run: `python3 -m pytest -q tests/test_tracked_files.py`
  - Expected: 1 件失敗。`AssertionError: 追跡されている作業ファイル:\n.superpowers/sdd/cluster-C4-report.md\n.superpowers/sdd/cluster-C7-report.md\n→ git rm --cached <path> で外す`。

- [ ] **Step 19: 最小実装（追跡解除）**
  - Run: `git rm --cached .superpowers/sdd/cluster-C4-report.md .superpowers/sdd/cluster-C7-report.md`
  - 確認メッセージ（日本語）: 「`git rm --cached` を実行します。理由：公開リポに AI セッションの作業メモが追跡されているため索引から外すため。`--cached` なので作業ツリーのファイルは残り、履歴にも残ります（内容は無害な設計メモ）。ディスク上のデータは削除されません。」
  - Expected: `rm '.superpowers/sdd/cluster-C4-report.md'` と `rm '.superpowers/sdd/cluster-C7-report.md'` が出力され、`ls .superpowers/sdd/` にファイルが残っている。

- [ ] **Step 20: Task 6 の xfail を解除** — `tests/test_static_guards.py` の decorator（5 行）を削除する。`import pytest` は `@pytest.mark.parametrize` があるので**残す**。
  - 置換前:
    ```python
    @pytest.mark.xfail(
        strict=True,
        reason="Task 9 の `git rm --cached` まで .superpowers/sdd/cluster-C{4,7}-report.md が追跡されている。"
               "解消したらこの xfail マーカーを外す（strict=True なので XPASS は失敗になる）",
    )
    def test_no_tracked_agent_workdirs():
    ```
  - 置換後:
    ```python
    def test_no_tracked_agent_workdirs():
    ```
  - 実際の関数名／reason が違う場合は `grep -n "xfail" tests/test_static_guards.py` の該当 1 件について `@pytest.mark.xfail(...)` のデコレータだけを削除する。
  - 注: `tests/test_tracked_files.py` と `test_no_tracked_agent_workdirs` は意図的に重複させる。前者が**恒久ガード**（追跡ゼロ＋`.gitignore` の両輪・骨格 File Structure が要求）、後者は part2 の**時系列マーカー**（Task 9 まで赤を許す）で役割が違う。

- [ ] **Step 21: 通ることを確認**
  - Run: `python3 -m pytest -q` → `node --test tests/*.test.js`
  - Expected: どちらも PASS。pytest の要約に `xfailed` が 0（part1/part2 の xfail はすべて解除済み）。

- [ ] **Step 22: コミット**
  - `git add tests/test_tracked_files.py tests/test_static_guards.py`（`.superpowers` の削除は Step 19 の `git rm --cached` で既にステージ済み。`.gitignore` に載っているので `git add .superpowers` は打たない＝打つと ignored path のエラーになる）
  - ```
    git commit -m "chore(git): .superpowers の追跡 2 件を解除し追跡ガードのテストを追加

    .gitignore に載っていても既追跡ファイルは無視されない。公開リポに作業メモが
    残る事故を git ls-files のテストで恒久的に止める（Task 6 の xfail を解除）。

    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR"
    ```

---

## Self-Review（part3・2026-09-03）

- **骨格の Interfaces との突合**：`js/ui/ai-meta.js` の 5 つ（`FRESH_AI_MS`・`freshnessChip`・`freshnessChipHtml`・`aiDisclaimerHtml`・`isPlaceholderNarrative`）は名前・引数・返り値を骨格どおり。`sw.js` の 2 つの grep 文字列、`collectors/gdelt_events.py` の `LASTUPDATE_URL`・`parse_lastupdate_line`・`verify_md5` も骨格どおり。**逸脱なし**。
- **骨格に無いが追加した contract**（タスク間ではなくモジュール内に閉じる）：`alertChipHtml(a, opts)` の第 2 引数と alert の `when`／`render*(…, { now })`／`js/main.js` の module-local `_aiSnaps`・`AI_FRESH_LABEL`／`profile_view.js` の非 export ローカル `wikiArticleTitle`。いずれも既存呼び出しを壊さない後方互換な追加。
- **設計 §3.3〜§3.5 の被覆**：§3.3→Task 7（チップ・免責・定型置換・news ラベル・`#freshness`・index.html 文言）／§3.4 の動的分→Task 8（nocookie・referrerpolicy・字幕注記・CC BY-SA フッタ・rel・orbis-data の LICENSE/DATA-SOURCES.md）／§3.5 の sw・GDELT・escape/scheme・`.superpowers`→Task 9。§3.5 の `data-style` と `test_static_guards.py` 本体は Task 6（part2）、`closure.sh`・e2e は Task 10（part4）。
- **重複の回避**：`profile_view.js` の href スキーム検証は Task 8 に一本化（Task 9 では触らない）。`.superpowers` の追跡チェックは `test_tracked_files.py` を恒久ガードとし、`test_static_guards.py` 側（part2 の `test_no_tracked_agent_workdirs`）は Task 9 が xfail を外すだけ。
- **part1／part2 との突合（2026-09-03・両分冊の確定版で確認）**：
  - `tests/test_pages.py` の xfail は part1 逐語の 2 件（`test_no_youtube_com_embed_in_served_code`・`test_external_links_are_noopener_noreferrer`）＝Task 8 Step 20 に反映済み。`test_pages_are_declared_in_vercel_builds` は Task 3 が外すので part3 は触らない。
  - `tests/test_static_guards.py` の xfail は part2 逐語の `test_no_tracked_agent_workdirs`（5 行デコレータ）＝Task 9 Step 20 に反映済み。
  - part2 は骨格の「`window.__orbis` を `?e2e=1` 限定」を**加算式に読み替えた**（状態バスなので消せない）。part3 はこれに合わせ、`_aiSnaps` の理由を「boot 前スコープで AI スナップショットを持てないから」に置き直した（`window.__orbis` はデバッグ用ミラーとして残す）。
  - part2 適用後の `js/ui/feed.js` `renderFeed` は `.join('')` 行の**次に** `applyDataStyles(root);` が入る。Task 7 Step 18-1 の置換範囲はその手前で閉じているので競合しない。`renderFeed` のスタブは `querySelectorAll: () => []` を持たせて `applyDataStyles` を素通しさせる。
  - part2 適用後の `js/lib/selection.js` は 174/197 行（`data-style="color:#7fd8ff"`）を書き換えるが、Task 8 が触る 175/198 行（`rel=`）とは別行＝競合しない。
- **ネットワーク**：Task 8 Step 26 の orbis-data への通常 push だけが書き込みで、**親セッションが本人確認のうえ実行**する（サブエージェントは実行しない）。それ以外は読み取りのみ。
