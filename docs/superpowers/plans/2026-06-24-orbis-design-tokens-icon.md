# ORBIS デザイントークン体系化 ＋ アイコン刷新 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ORBIS のCSS色を散在リテラルからセマンティックトークン体系へ整理（基盤先行・回帰最小）し、アイコンを採用案B（軌道環）へ刷新して favicon を新設する。

**Architecture:** (A) `css/orbis.css` 冒頭 `:root` に6グループ約115トークンを増設（既存変数は不変）→ foundation surfaces のリテラルを `var()` 化（サーフェス単位・テスト＋視覚spotで回帰防止）。(B) 採用案B SVG を `icon-master.svg` 化 → playwright 同梱 Chromium で PWA PNG 再生成、globe優先 favicon を新設し index.html / manifest / sw に結線。

**Tech Stack:** Vanilla CSS / HTML、Node `node --test`（tests/*.test.js）、Python + playwright（同梱Chromium）でSVG→PNG、Vercel ゼロコンフィグ静的配信。

## Global Constraints

- 既存 `:root` 変数（`--bg #05080f`/`--panel`/`--line #1c2c48`/`--cyan #39d0ff`/`--text #cfe0f5`/`--muted #5b7fb0`/`--neb-*`/`--glass-blur`/`--glass-bg`/`--glass-rim rgba(90,200,255,0.22)`/`--font-*`/`--edge-pad`）は**名称も値も変更しない**。
- カラー移行は **CSS のみ**（JS/HTML 非編集）。`js/lib/look.js` が上書きする変数名は変えない。
- rgba 表記はファイル内で**スペース有無が混在**するため、置換は grep で実文字列を確認してから行う（盲目的 sed 禁止）。
- アイコンの最終判断は**実PNG／本番curl／実機**（headless スクショは GPU 演出が出ず最終根拠にしない）。
- favicon は **16px で球（globe）と読めること**が必須受入基準。
- コミット作者メールは GitHub noreply 形式（既設定 `210495115+sg55555@users.noreply.github.com`）。
- 完成の `:root` 全文は `design/taxonomy-rootblock.css`（160行）。採用案B SVG は `design/icon-candidates/orbit-rings.svg`／favicon簡素版 `design/icon-candidates/orbit-rings-favicon.svg`。

---

## Group A — カラートークン体系

### Task A1: セマンティック `:root` を増設（健全性テスト）

**Files:**
- Create: `tests/design-tokens.test.js`
- Modify: `css/orbis.css`（先頭 `:root { ... }` 内・既存定義の直後に増設）
- Reference: `design/taxonomy-rootblock.css`

**Interfaces:**
- Produces: `:root` に各グループ代表トークン（`--bg-1`,`--bg-panel`,`--accent-cyan`,`--accent-purple`,`--text-heading`,`--text-2`,`--text-muted`,`--rim-cyan-20`,`--glow-cyan`,`--cat-stale` 等）が定義される。後続タスクがこれらを `var()` 参照する。

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/design-tokens.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/orbis.css', import.meta.url), 'utf8');
const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
assert.ok(rootMatch, ':root ブロックが存在する');
const root = rootMatch[1];

// 定義されたカスタムプロパティ名を収集
const defs = [...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);

test('foundation 代表トークンが :root に定義されている', () => {
  const required = [
    '--bg-0', '--bg-1', '--bg-panel', '--bg-control', '--bg-card',
    '--accent-cyan', '--accent-purple',
    '--text-bright', '--text-heading', '--text-2', '--text-muted', '--text-muted-2', '--text-muted-3',
    '--rim-cyan-16', '--rim-cyan-18', '--rim-cyan-20', '--rim-cyan-22', '--rim-cyan-35', '--rim-cyan-46', '--rim-cyan-68', '--rim-white-05',
    '--glow-cyan', '--glow-cyan-strong', '--glow-cyan-active', '--glow-cyan-aurora', '--glow-shadow',
    '--cat-stale', '--cat-amber-border', '--cat-amber-glow',
  ];
  const missing = required.filter((t) => !defs.includes(t));
  assert.deepEqual(missing, [], `未定義トークン: ${missing.join(', ')}`);
});

test('既存変数の値が保持されている', () => {
  assert.match(root, /--cyan:\s*#39d0ff/);
  assert.match(root, /--bg:\s*#05080f/);
  assert.match(root, /--glass-rim:\s*rgba\(90,\s*200,\s*255,\s*0?\.22\)/);
});

test(':root にカスタムプロパティの重複定義が無い', () => {
  const seen = new Set(); const dup = [];
  for (const d of defs) { if (seen.has(d)) dup.push(d); else seen.add(d); }
  assert.deepEqual(dup, [], `重複定義: ${dup.join(', ')}`);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/design-tokens.test.js`
Expected: FAIL（未定義トークン: --bg-0, --bg-1, ... が並ぶ）

- [ ] **Step 3: `:root` にセマンティック層を増設**

`design/taxonomy-rootblock.css` の22行目以降（`/* ── 背景層 ── */` から最終 `--glow-subtitle-bg` まで）を、`css/orbis.css` の `:root` 内・既存 `--edge-pad: ...;` 行の**直後**にそのまま貼り付ける（既存12〜19行は不変・`:root {` と閉じ `}` は流用）。`design/taxonomy-rootblock.css` 冒頭の重複する既存定義（`--bg`〜`--edge-pad`）は貼らない（既存があるため）。

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test tests/design-tokens.test.js`
Expected: PASS（3テスト）

- [ ] **Step 5: 既存テスト回帰確認**

Run: `node --test tests/*.test.js`
Expected: PASS（immerse 等 既存テスト緑のまま）

- [ ] **Step 6: コミット**

```bash
git add tests/design-tokens.test.js css/orbis.css
git commit -m "feat(css): セマンティックカラートークンを :root に定義（基盤先行）"
```

---

### Task A2: foundation 移行 第1波（背景層・アクセント・テキスト）

**Files:**
- Modify: `css/orbis.css`（本文の foundation サーフェス）
- Modify: `tests/design-tokens.test.js`（var 健全性＋移行到達アサート追加）

**Interfaces:**
- Consumes: Task A1 の `:root` 定義トークン。
- Produces: `css/orbis.css` 本文に `var(--accent-purple)`/`var(--text-heading)`/`var(--bg-1)` 等の参照が出現。

**移行方針（サーフェス単位・安全順）:** 各トークンの「集約元リテラル」は `design/taxonomy-rootblock.css` の各行コメントに記載。**まず値がトークンと完全一致するリテラルから置換（ゼロ変化）**、近接集約値は視覚spotで確認しつつ置換。各リテラルは `grep -n` で実文字列（スペース有無）を確認してから置換する。

- [ ] **Step 1: var 健全性＋移行到達テストを追記**

```js
// tests/design-tokens.test.js に追記
test('全ての var(--x) 参照が :root で定義済み', () => {
  const refs = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
  const undef = [...new Set(refs)].filter((r) => !defs.includes(r));
  assert.deepEqual(undef, [], `未定義 var 参照: ${undef.join(', ')}`);
});

test('第1波 foundation トークンが本文で参照されている', () => {
  for (const t of ['--accent-purple', '--text-heading', '--text-muted', '--bg-1']) {
    assert.ok(css.includes(`var(${t})`), `${t} が未参照`);
  }
});
```

- [ ] **Step 2: テスト実行して「第1波」テストが失敗を確認**

Run: `node --test tests/design-tokens.test.js`
Expected: FAIL（`--accent-purple が未参照` 等。var健全性テストはこの時点では PASS）

- [ ] **Step 3: 背景層を移行**

`grep -n` で対象リテラルの実文字列を確認し、以下のサーフェスで色リテラルを対応 `var()` に置換（値はコメント参照）:
- `#starfield` の vignette radial 中心 `#0a1220` → `var(--bg-1)`。
- side-panel / `#freshness` / popup（maplibre 上書き）/ 各パネルのベース紺 `rgba(10,18,32,...)` 系・`var(--panel)` 相当 → 既存 `--panel` 維持または `var(--bg-panel)`（=panel）。**値が一致する箇所のみ**。
- タブ/ボタン面 `rgba(10,18,32,0.6)` → `var(--bg-control)`。チップ面 `rgba(20,40,70,0.4)` → `var(--bg-chip)`。カード面 `rgba(20,32,60,0.6)` → `var(--bg-card)`。

- [ ] **Step 4: アクセント基軸を移行**

- ワードマーク/boot/active枠/オーロラ細線の cyan アクセントで `#39d0ff` → `var(--accent-cyan)`（=既存 cyan と同値・完全一致のみ。`var(--cyan)` 既参照箇所は触らない）。
- 紫アクセント `#8a5cf6` → `var(--accent-purple)`（オーロラ a2/進捗グラデ終端）。

- [ ] **Step 5: テキスト階層を移行**

- 見出し系 `#e7f3ff`/`#e8f0ff`/`#e8f2ff`/`#e7f1ff` → `var(--text-heading)`（集約・視覚spotで確認）。
- ワードマーク強調 `#eaf4ff`/`#eaf6ff` → `var(--text-bright)`。
- 本文やや明 `#c7d6f0` 近傍 → `var(--text-2)`。ミュート主 `#8ea3c4` → `var(--text-muted)`、副 `#9fb2d4` → `var(--text-muted-2)`、三次 `#8ea6c8` 近傍 → `var(--text-muted-3)`。

- [ ] **Step 6: 視覚回帰 spot チェック**

http サーバを起動し（`python3 -m http.server 8137`）、`http://localhost:8137/index.html?data=github` を Chromium で開き、パネル/見出し/フィード/チップを撮影。移行前（git stash で退避）と並べ、**完全一致置換は差分ゼロ・集約箇所は知覚閾下**を目視確認。GPU演出箇所は実機で別途。

```bash
# 退避前後の差分確認の目安（DOMパネルは headless で決定的）
node scripts/diff_surfaces.mjs   # 任意: 後述の補助があれば
```
（補助スクリプトが無ければ手動でスクショ2枚を目視比較で可）

- [ ] **Step 7: テスト実行して成功を確認**

Run: `node --test tests/design-tokens.test.js`
Expected: PASS（var健全性＋第1波参照）

- [ ] **Step 8: コミット**

```bash
git add css/orbis.css tests/design-tokens.test.js
git commit -m "refactor(css): foundation 第1波（背景層/アクセント/テキスト）をトークン化"
```

---

### Task A3: foundation 移行 第2波（グラス縁・グロー・stale）

**Files:**
- Modify: `css/orbis.css`
- Modify: `tests/design-tokens.test.js`（第2波到達アサート）

**Interfaces:**
- Consumes: A1 の縁/グロー/カテゴリトークン。

- [ ] **Step 1: 第2波到達テストを追記**

```js
test('第2波 foundation トークンが本文で参照されている', () => {
  for (const t of ['--rim-cyan-20', '--glow-cyan', '--glow-shadow', '--cat-stale']) {
    assert.ok(css.includes(`var(${t})`), `${t} が未参照`);
  }
});
```

- [ ] **Step 2: テスト実行して失敗を確認**

Run: `node --test tests/design-tokens.test.js`
Expected: FAIL（`--rim-cyan-20 が未参照` 等）

- [ ] **Step 3: グラス・縁を移行**

`grep -n "rgba(57, *208, *255"` で cyan 縁段の実文字列を確認し、`.16/.18/.20/.22/.35/.46/.68` を対応 `--rim-cyan-16..68` に、`--glass-rim` 既使用箇所は維持、上端白 inset `rgba(255,255,255,0.05|.06|.07)` → `var(--rim-white-05)`（集約・視覚spot）。

- [ ] **Step 4: グロー・発光を移行**

cyan 発光 `rgba(57,208,255,0.34|0.5|0.65)` → `--glow-cyan`/`--glow-cyan-strong`/`--glow-cyan-active`、オーロラ外側 `rgba(70,175,255,.28..34)` → `--glow-cyan-aurora`、黒ドロップ影 `rgba(0,0,0,0.35..0.5)` → `var(--glow-shadow)`（集約・視覚spot）。

- [ ] **Step 5: 状態色 stale を移行**

`#freshness.stale`/src-stale/alert の `#ffce7a` → `var(--cat-stale)`、stale 縁 `rgba(255,176,40,0.45)` → `var(--cat-amber-border)`、stale 発光 `rgba(255,176,40,0.22)` → `var(--cat-amber-glow)`。

- [ ] **Step 6: 視覚 spot ＋ テスト**

Step A2-6 と同様に spot 確認。
Run: `node --test tests/*.test.js`
Expected: PASS（design-tokens 全て＋既存回帰なし）

- [ ] **Step 7: コミット**

```bash
git add css/orbis.css tests/design-tokens.test.js
git commit -m "refactor(css): foundation 第2波（グラス縁/グロー/stale）をトークン化"
```

---

## Group B — アイコン刷新（採用案B 軌道環）

### Task B1: icon-master.svg 配置 ＋ make_icons.py を SVG→Chromium 化

**Files:**
- Create: `icon-master.svg`（= `design/icon-candidates/orbit-rings.svg` を配置）
- Modify: `scripts/make_icons.py`（PIL → SVG→Chromium 書き換え）
- Create: `tests/icons.test.js`（生成PNGの存在＋サイズ検証）

**Interfaces:**
- Produces: `icons/icon-512.png`(512)・`icons/icon-192.png`(192)・`icons/apple-touch-icon.png`(180) が master から再生成される。

- [ ] **Step 1: master を配置**

```bash
cp design/icon-candidates/orbit-rings.svg icon-master.svg
```

- [ ] **Step 2: make_icons.py を Chromium 方式に書き換え**

```python
#!/usr/bin/env python3
"""ORBIS の PWA/favicon アイコンを icon-master.svg / favicon.svg から生成。
PIL では glow/gradient を再現できないため playwright 同梱 Chromium でラスタライズ。
リポルートから: python3 scripts/make_icons.py
"""
import asyncio, base64, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = [
    ("icon-master.svg", "icons/icon-512.png", 512),
    ("icon-master.svg", "icons/icon-192.png", 192),
    ("icon-master.svg", "icons/apple-touch-icon.png", 180),
    ("favicon.svg", "favicon-32.png", 32),
]

async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for src, out, size in JOBS:
            with open(os.path.join(ROOT, src)) as f:
                b64 = base64.b64encode(f.read().encode()).decode()
            page = await browser.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
            await page.set_content(f'<body style="margin:0"><img src="data:image/svg+xml;base64,{b64}" width="{size}" height="{size}"></body>')
            await page.locator("img").screenshot(path=os.path.join(ROOT, out))
            await page.close()
            print("wrote", out, f"({size}x{size})")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
```

（注：`favicon.svg` は Task B2 で作成。B2 完了後に再実行すれば favicon-32.png も生成される。B1 時点では favicon ジョブが無ければ FileNotFound になるため、B1 では `favicon.svg` ジョブ行を一旦コメントアウトして実行 → B2 で復活させる。）

- [ ] **Step 3: PNG を生成**

Run: `python3 scripts/make_icons.py`
Expected: `wrote icons/icon-512.png (512x512)` ... が出力され icons/ が更新。

- [ ] **Step 4: 生成検証テストを書く**

```js
// tests/icons.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
const root = new URL('../', import.meta.url);
for (const [f, min] of [['icons/icon-512.png', 8000], ['icons/icon-192.png', 1500], ['icons/apple-touch-icon.png', 1500]]) {
  test(`${f} が生成され非空`, () => {
    const s = statSync(new URL(f, root));
    assert.ok(s.size > min, `${f} サイズ ${s.size} が小さすぎ`);
  });
}
```

- [ ] **Step 5: テスト実行**

Run: `node --test tests/icons.test.js`
Expected: PASS

- [ ] **Step 6: 実PNGを目視QA**

`icons/icon-512.png` を開き、軌道環globe が本体ルックで描画され壊れていないこと、マスカブル安全域（中央80%円）に球/ハロ/ノードが収まり環の先端のみクロップ対象であることを確認（`design/compare.html` の安全域破線も参照）。

- [ ] **Step 7: コミット**

```bash
git add icon-master.svg scripts/make_icons.py tests/icons.test.js icons/icon-512.png icons/icon-192.png icons/apple-touch-icon.png
git commit -m "feat(icons): 採用案B(軌道環)を master 化し PWA アイコンを SVG→Chromium で再生成"
```

---

### Task B2: globe優先 favicon を新設（16px 受入基準）

**Files:**
- Create: `favicon.svg`（globe優先の簡素版・`design/icon-candidates/orbit-rings-favicon.svg` を起点に調整）
- Create: `favicon-32.png`（Chromium生成）
- Modify: `scripts/make_icons.py`（favicon ジョブを有効化）

- [ ] **Step 1: favicon.svg を作成**

`design/icon-candidates/orbit-rings-favicon.svg` を `favicon.svg` にコピーし起点とする。

```bash
cp design/icon-candidates/orbit-rings-favicon.svg favicon.svg
```

- [ ] **Step 2: 16/32px でレンダして球の可読性を確認**

```bash
python3 - <<'PY'
import asyncio, base64
async def main():
    from playwright.async_api import async_playwright
    b64 = base64.b64encode(open("favicon.svg").read().encode()).decode()
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for s in (16, 32):
            pg = await br.new_page(viewport={"width":s,"height":s}, device_scale_factor=4)
            await pg.set_content(f'<body style="margin:0"><img src="data:image/svg+xml;base64,{b64}" width="{s}" height="{s}"></body>')
            await pg.locator("img").screenshot(path=f"/tmp/favicon-{s}.png")
            await pg.close()
        await br.close()
asyncio.run(main())
PY
```
`/tmp/favicon-16.png` を目視。**球（円＋赤道/メリディアン）が主役として読めるか**判定。

- [ ] **Step 3: 読めなければ globe 優先に調整**

16px で原子記号化して見える場合、favicon.svg を編集：軌道環を**1本に削減**し不透明度を下げて従属させ、globe の外円＋赤道＋縦メリディアン1本をストローク 10–14px で主役化。`gradientUnits="userSpaceOnUse"`（軸平行ストロークのグラデ退化回避）。Step 2 を再実行し球と読めるまで反復。**16px で球と読める＝受入基準**。

- [ ] **Step 4: favicon ジョブを有効化して 32px PNG を生成**

`scripts/make_icons.py` の `("favicon.svg", "favicon-32.png", 32)` 行を有効化（B1でコメントアウトしていれば外す）。
Run: `python3 scripts/make_icons.py`
Expected: `wrote favicon-32.png (32x32)` を含む。

- [ ] **Step 5: コミット**

```bash
git add favicon.svg favicon-32.png scripts/make_icons.py
git commit -m "feat(icons): globe優先 favicon を新設（svg＋32px png・16px受入）"
```

---

### Task B3: 結線（index.html / manifest / sw）＋ 最終検証

**Files:**
- Modify: `index.html`（head に favicon link 追加）
- Modify: `manifest.webmanifest`（purpose 検証次第）
- Modify: `sw.js`（CACHE bump）

- [ ] **Step 1: index.html に favicon link を追加**

`<link rel="apple-touch-icon" ...>` の直後に追加：

```html
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png" />
```

- [ ] **Step 2: マスカブル可否を実画像で判定 → manifest 反映**

`icons/icon-512.png` に中央80%円（中心256,半径205相当）を重ねた画像で、球/ハロ/ノードが円内・環先端のみ越えるのが意図通りに見えるか判定。
- 意図通り → `manifest.webmanifest` の 192/512 に `"purpose": "any maskable"` を付与。
- 違和感あり → `"purpose"` 付与せず据え置き（"any" 相当）。
`background_color`/`theme_color` は `#05080f` 維持。

- [ ] **Step 3: sw.js の CACHE を bump**

`const CACHE = 'orbis-v44';` → `const CACHE = 'orbis-v45';`

- [ ] **Step 4: ローカル健全性確認**

```bash
python3 -m http.server 8137 &
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8137/favicon.svg
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8137/favicon-32.png
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8137/icons/icon-192.png
```
Expected: いずれも 200／正しい Content-Type。index.html をブラウザで開きタブに favicon が出ることを確認。

- [ ] **Step 5: 既存 e2e 回帰確認（任意）**

Run: `npx playwright test 2>/dev/null || echo "e2e skip可"`
Expected: 既存 spec が緑（環境次第でスキップ可）。head の favicon 追加は既存 spec に影響しないはず。

- [ ] **Step 6: コミット**

```bash
git add index.html manifest.webmanifest sw.js
git commit -m "feat(icons): favicon を index 結線＋manifest/sw 更新（v45）"
```

---

## 統合（計画外・実行後の手順）

1. `ExitWorktree(keep)` で main ツリーへ戻る。
2. `git fetch && git merge worktree-design-tokens-icon`。**css 先頭 `:root` で衝突した場合は両者保持**（増設トークン＋main側変更の両立）。css 末尾追記系（mp-/ui-/sec-/legend-/feed-/mui-）とは原則非衝突。
3. `git push`（Vercel 自動デプロイ）。
4. **本番 curl 検証**：`/favicon.svg`・`/favicon-32.png`・`/icons/icon-192.png`・`/icons/icon-512.png`・`/icons/apple-touch-icon.png` が 200／正しい型（同名上書きは `%{size_download}` でローカルとバイト一致も）。
5. **オーナー実機**：タブ favicon／ホーム再追加で PWA アイコン反映確認（OSキャッシュが強いので再追加要）。
6. Obsidian 所有ノート `Projects/orbis-design-supervision.md` 更新（＋自動メモリ・[[orbis-uiux-improvements]] 進捗）。
7. merge 済みなら `ExitWorktree(remove)`、`design/` スクラッチは main に載せない（`.vercelignore` 外なので merge 対象から除外 or 別途無視）。

## Self-Review（計画→spec 突合）

- spec §3（カラー）→ A1（定義）/A2・A3（foundation移行）でカバー。クラスタ集約の視覚spot を各タスクに内包。
- spec §4（アイコン）→ B1（master/gen）/B2（favicon globe優先・16px受入）/B3（結線/manifest/sw/配信検証）でカバー。
- spec §4.4 配信（ゼロコンフィグ自動・本番curl）→ 統合 step4。
- 型整合：トークン名は `design/taxonomy-rootblock.css` と一致。`make_icons.py` の JOBS 出力先と `tests/icons.test.js`・`index.html` 参照パスが一致（icons/icon-192.png 等）。
- プレースホルダ：rgba スペース混在の実文字列は grep で確認の指示＝具体的手順（盲目置換禁止）。favicon 調整は「16px で球と読める」の客観基準で反復。
