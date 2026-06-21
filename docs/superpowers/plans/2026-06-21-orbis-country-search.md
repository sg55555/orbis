# 国検索（場所/国へ飛ぶ）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ORBIS の globe 上部中央に国検索ボックスを追加し、日本語/英語名で全 FIPS_JA 国（~239）を検索→国の中心へ flyTo できるようにする。

**Architecture:** 3層分離（permalink/legend と同型）＝オフライン生成データ `js/lib/country_centroids.js`（country_bounds.geojson の最大ポリゴン bbox 中心＋手キュレート EXTRA 68国）→ 純粋部 `js/lib/gazetteer.js`（FIPS_JA と join・`searchCountries`）→ UI `js/ui/search.js`（main.js が `initSearch(onSelect)` で配線）。flyTo は既存の `selected` 状態＋`drawAll`→`buildReticleConfigs`（CYAN リティクル）を再利用。globe 描画は非編集。

**Tech Stack:** Vanilla ESM JS / deck.gl + MapLibre（既存）/ Python3（データ生成）/ node:test（単体）/ Playwright（e2e）。

## Global Constraints

- **globe 描画（`js/map.js` のレイヤー/projection）は非編集**（並行 globe 系セッションと非干渉）。
- **`js/main.js` は import 1行＋`initSearch` 配線1ブロックのみ追加**。
- **`css/orbis.css` は末尾追記のみ**（共有 mid-file CSS 不変＝非隣接マージ）。
- **SW 版番号は不変**（ネットワーク優先・SHELL 変更も network-first 反映）。
- **単体テスト**＝`import { test } from 'node:test'` ＋ `import assert from 'node:assert/strict'`、ESM、`../js/lib/...` 相対 import。実行 `npm run test:js`（`node --test tests/*.test.js`）。
- **e2e** spec は相対パス `/`（ポート非依存）。隔離実行＝専用ポート＋`reuseExistingServer:false` の一時 config（`:8000` 越境汚染回避）。
- **COUNTRIES は全 FIPS_JA コード（FS 補完後 239）を網羅**。`COUNTRIES.length === 239`。
- **flyTo は `zoom: 4, duration: 1500, essential: true`**。着地は既存リティクル（CYAN・`buildReticleConfigs`）再利用。
- **`?search=on|off`（既定 on）** で before/after 比較可（`body.search-on|off`）。
- **統合**＝本 worktree（`worktree-search-countries`・origin/main 基準）→ `origin/main` マージ → `HEAD:main` ff push（ローカル main 不変）。
- **コミット trailer**＝`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`、subject は `type(scope): 日本語要約`。

---

## Task 1: 座標データ生成（FS 補完＋生成スクリプト＋country_centroids.js）

**Files:**
- Modify: `js/lib/places.js`（`FIPS_JA` に `FS` を1件追加）
- Modify: `tests/places.test.js`（FS の assert 追加）
- Create: `scripts/gen_country_centroids.py`（生成スクリプト・EXTRA 68国内包）
- Create: `js/lib/country_centroids.js`（生成物・239件）

**Interfaces:**
- Produces: `js/lib/country_centroids.js` → `export const COUNTRY_CENTROIDS = [{ code: string, en: string, lng: number, lat: number }, ...]`（239件・code 昇順）。

- [ ] **Step 1: FS の失敗テストを書く**

`tests/places.test.js` の `fipsToJa` 既知コードのテストブロックに1行追加（既存 `assert.equal(fipsToJa('US'), 'アメリカ（US）');` の後など）：

```js
  assert.equal(fipsToJa('FS'), '仏領南方・南極地域（FS）'); // 仏領南方・南極地域（country_bounds にあり FIPS_JA 未収載だった）
```

- [ ] **Step 2: テスト失敗を確認**

Run: `npm run test:js 2>&1 | grep -A3 places`
Expected: FAIL（`fipsToJa('FS')` が `'FS'` を返し不一致）

- [ ] **Step 3: places.js に FS を追加**

`js/lib/places.js` の `FIPS_JA` 内、`FR: 'フランス',` の直後に `FS` を挿入（アルファベット順）：

```js
  FR: 'フランス', FS: '仏領南方・南極地域', GA: 'ガンビア',
```

（元の行 `  FO: 'フェロー諸島', FP: '仏領ポリネシア', FR: 'フランス', GA: 'ガンビア',` の `FR: 'フランス', GA:` を `FR: 'フランス', FS: '仏領南方・南極地域', GA:` に置換）

- [ ] **Step 4: テスト通過を確認**

Run: `npm run test:js 2>&1 | tail -5`
Expected: PASS（全単体緑）

- [ ] **Step 5: 生成スクリプトを書く**

Create `scripts/gen_country_centroids.py`：

```python
#!/usr/bin/env python3
"""country_bounds.geojson の geometry centroid（最大ポリゴン bbox 中心）と
手キュレート EXTRA を合流し js/lib/country_centroids.js を生成する。
出力コードは FIPS_JA 全キー（FS 補完後）と過不足なく一致することを assert する。"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_fips_ja():
    src = open(os.path.join(ROOT, 'js/lib/places.js'), encoding='utf-8').read()
    body = re.search(r'export const FIPS_JA = \{(.*?)\};', src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def largest_ring_bbox_center(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    best, best_area = None, -1.0
    for poly in polys:
        ring = poly[0]
        xs = [c[0] for c in ring]
        ys = [c[1] for c in ring]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if area > best_area:
            best_area = area
            best = [(min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0]
    return best


# FIPS_JA にあって country_bounds に無い 68 国の [英語通称, lng, lat]（首都/島中心）。
# 110m 低解像度ジオメトリが落とす小国・領土。小国ゆえ単一代表点で zoom 4 用途に十分。
EXTRA = {
    'AA': ['Aruba', -69.97, 12.52], 'AC': ['Antigua and Barbuda', -61.80, 17.27],
    'AN': ['Andorra', 1.52, 42.51], 'AQ': ['American Samoa', -170.70, -14.30],
    'AV': ['Anguilla', -63.06, 18.22], 'BA': ['Bahrain', 50.55, 26.07],
    'BB': ['Barbados', -59.54, 13.19], 'BD': ['Bermuda', -64.75, 32.31],
    'BV': ['Bouvet Island', 3.36, -54.42], 'CJ': ['Cayman Islands', -81.25, 19.31],
    'CK': ['Cocos (Keeling) Islands', 96.87, -12.17], 'CN': ['Comoros', 43.34, -11.65],
    'CV': ['Cape Verde', -23.92, 15.93], 'CW': ['Cook Islands', -159.78, -21.24],
    'DO': ['Dominica', -61.37, 15.41], 'FG': ['French Guiana', -53.13, 3.93],
    'FO': ['Faroe Islands', -6.91, 62.00], 'FP': ['French Polynesia', -149.41, -17.65],
    'GI': ['Gibraltar', -5.35, 36.14], 'GJ': ['Grenada', -61.68, 12.12],
    'GK': ['Guernsey', -2.58, 49.45], 'GP': ['Guadeloupe', -61.55, 16.24],
    'GQ': ['Guam', 144.79, 13.44], 'GZ': ['Gaza Strip', 34.39, 31.42],
    'HK': ['Hong Kong', 114.17, 22.32], 'IM': ['Isle of Man', -4.55, 54.24],
    'IO': ['British Indian Ocean Territory', 72.00, -6.34], 'IS': ['Israel', 34.95, 31.45],
    'JE': ['Jersey', -2.13, 49.21], 'KR': ['Kiribati', 172.98, 1.45],
    'KT': ['Christmas Island', 105.68, -10.49], 'LS': ['Liechtenstein', 9.55, 47.16],
    'MB': ['Martinique', -61.02, 14.64], 'MC': ['Macau', 113.55, 22.16],
    'MH': ['Montserrat', -62.19, 16.74], 'MN': ['Monaco', 7.42, 43.74],
    'MP': ['Mauritius', 57.55, -20.28], 'MT': ['Malta', 14.38, 35.94],
    'MV': ['Maldives', 73.22, 3.25], 'NE': ['Niue', -169.87, -19.05],
    'NF': ['Norfolk Island', 167.95, -29.04], 'NO': ['Norway', 9.00, 61.50],
    'NR': ['Nauru', 166.93, -0.52], 'OD': ['South Sudan', 30.00, 7.50],
    'PC': ['Pitcairn Islands', -128.32, -24.37], 'PS': ['Palau', 134.58, 7.51],
    'RE': ['Reunion', 55.54, -21.13], 'RM': ['Marshall Islands', 171.18, 7.13],
    'SB': ['Saint Pierre and Miquelon', -56.27, 46.96], 'SC': ['Saint Kitts and Nevis', -62.73, 17.30],
    'SE': ['Seychelles', 55.49, -4.68], 'SH': ['Saint Helena', -5.72, -15.96],
    'SM': ['San Marino', 12.46, 43.94], 'SN': ['Singapore', 103.82, 1.35],
    'ST': ['Saint Lucia', -60.98, 13.91], 'SV': ['Svalbard', 16.00, 78.20],
    'TK': ['Turks and Caicos Islands', -71.80, 21.75], 'TL': ['Tokelau', -171.86, -9.20],
    'TN': ['Tonga', -175.20, -21.18], 'TP': ['Sao Tome and Principe', 6.61, 0.23],
    'TV': ['Tuvalu', 179.20, -8.52], 'VC': ['Saint Vincent and the Grenadines', -61.20, 13.25],
    'VI': ['British Virgin Islands', -64.62, 18.42], 'VQ': ['U.S. Virgin Islands', -64.90, 17.74],
    'VT': ['Vatican City', 12.45, 41.90], 'WE': ['West Bank', 35.27, 31.95],
    'WF': ['Wallis and Futuna', -176.20, -13.30], 'WS': ['Samoa', -172.10, -13.76],
}


def main():
    fips = load_fips_ja()
    gj = json.load(open(os.path.join(ROOT, 'data/static/country_bounds.geojson'), encoding='utf-8'))
    rows = {}
    for f in gj['features']:
        code = f['properties']['code']
        c = largest_ring_bbox_center(f['geometry'])
        rows[code] = [f['properties']['name'], round(c[0], 4), round(c[1], 4)]
    for code, (en, lng, lat) in EXTRA.items():
        rows.setdefault(code, [en, round(float(lng), 4), round(float(lat), 4)])

    out_codes, fips_codes = set(rows), set(fips)
    missing = sorted(fips_codes - out_codes)
    surplus = sorted(out_codes - fips_codes)
    assert not missing, f'FIPS_JA にあるが centroid 無し（EXTRA に追加せよ）: {missing}'
    assert not surplus, f'centroid にあるが FIPS_JA 無し: {surplus}'
    for code, (en, lng, lat) in rows.items():
        assert -180 <= lng <= 180 and -90 <= lat <= 90, f'範囲外: {code} {lng},{lat}'

    items = ',\n'.join(
        f'  {{ code: "{code}", en: {json.dumps(en, ensure_ascii=False)}, lng: {lng}, lat: {lat} }}'
        for code, (en, lng, lat) in sorted(rows.items()))
    js = ('// 自動生成（scripts/gen_country_centroids.py）。手編集しない。\n'
          '// country_bounds.geojson の最大ポリゴン bbox 中心 + 手キュレート EXTRA（68国）。\n'
          'export const COUNTRY_CENTROIDS = [\n' + items + ',\n];\n')
    open(os.path.join(ROOT, 'js/lib/country_centroids.js'), 'w', encoding='utf-8').write(js)
    print(f'wrote {len(rows)} centroids')


if __name__ == '__main__':
    main()
```

- [ ] **Step 6: 生成スクリプトを実行**

Run: `python3 scripts/gen_country_centroids.py`
Expected: `wrote 239 centroids`（assert が落ちなければ coverage/range 健全）

- [ ] **Step 7: 生成物を smoke 検証**

Run:
```bash
node --input-type=module -e "import('./js/lib/country_centroids.js').then(m=>{const a=m.COUNTRY_CENTROIDS;console.log('len',a.length);const bad=a.filter(c=>!(c.lng>=-180&&c.lng<=180&&c.lat>=-90&&c.lat<=90));console.log('bad',bad.length);const want=['IS','NO','SN','OD','JA','US'];console.log('have', want.filter(w=>a.some(c=>c.code===w)).join(','));})"
```
Expected: `len 239` / `bad 0` / `have IS,NO,SN,OD,JA,US`

- [ ] **Step 8: コミット**

```bash
git add js/lib/places.js tests/places.test.js scripts/gen_country_centroids.py js/lib/country_centroids.js
git commit -m "$(printf 'feat(search): 国 centroid データ生成（geometry 171＋EXTRA 68＝239）\n\n- places.js: FIPS_JA に FS（仏領南方・南極地域）補完\n- scripts/gen_country_centroids.py: country_bounds 最大ポリゴン bbox 中心＋EXTRA 手キュレート、FIPS_JA 全キー一致を assert\n- js/lib/country_centroids.js: 生成物 239 件\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: 純粋部 gazetteer.js（COUNTRIES＋searchCountries）

**Files:**
- Create: `js/lib/gazetteer.js`
- Create: `tests/gazetteer.test.js`

**Interfaces:**
- Consumes: `COUNTRY_CENTROIDS`（Task 1）、`FIPS_JA`（places.js）。
- Produces: `export const COUNTRIES = [{ code, ja, en, lng, lat }, ...]`（239）、`export function searchCountries(query, limit = 8): Array<{code,ja,en,lng,lat}>`。

- [ ] **Step 1: 失敗テストを書く**

Create `tests/gazetteer.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, searchCountries } from '../js/lib/gazetteer.js';
import { FIPS_JA } from '../js/lib/places.js';

test('COUNTRIES: 全 FIPS_JA コードを網羅・座標は範囲内・ja 非空', () => {
  assert.equal(COUNTRIES.length, 239);
  const codes = new Set(COUNTRIES.map((c) => c.code));
  for (const k of Object.keys(FIPS_JA)) assert.ok(codes.has(k), `欠落: ${k}`);
  for (const c of COUNTRIES) {
    assert.ok(Number.isFinite(c.lng) && c.lng >= -180 && c.lng <= 180, `lng 範囲外: ${c.code}`);
    assert.ok(Number.isFinite(c.lat) && c.lat >= -90 && c.lat <= 90, `lat 範囲外: ${c.code}`);
    assert.ok(typeof c.ja === 'string' && c.ja.length > 0, `ja 空: ${c.code}`);
  }
});

test('searchCountries: 日本語の部分一致', () => {
  const r = searchCountries('ウクラ');
  assert.ok(r.some((c) => c.code === 'UP' && c.ja === 'ウクライナ'));
});

test('searchCountries: 英語の部分一致・大小無視', () => {
  assert.ok(searchCountries('ukr').some((c) => c.code === 'UP'));
  assert.ok(searchCountries('UKR').some((c) => c.code === 'UP'));
});

test('searchCountries: EXTRA 由来（イスラエル）も検索可', () => {
  assert.ok(searchCountries('イスラエル').some((c) => c.code === 'IS'));
  assert.ok(searchCountries('israel').some((c) => c.code === 'IS'));
});

test('searchCountries: 前方一致が部分一致より上位', () => {
  const r = searchCountries('japan');
  assert.equal(r[0].code, 'JA'); // Japan が先頭（"japan" 前方一致）
});

test('searchCountries: limit で件数制限', () => {
  assert.ok(searchCountries('a', 2).length <= 2);
});

test('searchCountries: 空・空白・無マッチは []', () => {
  assert.deepEqual(searchCountries(''), []);
  assert.deepEqual(searchCountries('   '), []);
  assert.deepEqual(searchCountries('zzzzz'), []);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/gazetteer.test.js 2>&1 | tail -5`
Expected: FAIL（`gazetteer.js` 不在で import エラー）

- [ ] **Step 3: gazetteer.js を実装**

Create `js/lib/gazetteer.js`：

```js
// 国検索の純粋部。country_centroids.js（生成）を FIPS_JA(places.js) と join し、
// 日本語名/英語名で部分一致検索する。deck/DOM 非依存。
import { COUNTRY_CENTROIDS } from './country_centroids.js';
import { FIPS_JA } from './places.js';

// {code, ja, en, lng, lat}。ja は FIPS_JA 単一ソース（無ければ en フォールバック）。
// COUNTRY_CENTROIDS は code 昇順 → COUNTRIES も code 昇順（ランキングの安定基盤）。
export const COUNTRIES = COUNTRY_CENTROIDS.map((c) => ({
  code: c.code,
  ja: FIPS_JA[c.code] || c.en,
  en: c.en,
  lng: c.lng,
  lat: c.lat,
}));

// query を日本語名・英語名に部分一致。前方一致を上位、次に部分一致。最大 limit 件。
// 空/空白/無マッチ → []。英語は大小無視、日本語は trim のみ（小文字化は ASCII のみ影響）。
export function searchCountries(query, limit = 8) {
  const raw = (query == null ? '' : String(query)).trim();
  if (raw === '') return [];
  const q = raw.toLowerCase();
  const prefix = [];
  const substr = [];
  for (const c of COUNTRIES) {
    const en = c.en.toLowerCase();
    if (c.ja.startsWith(raw) || en.startsWith(q)) prefix.push(c);
    else if (c.ja.includes(raw) || en.includes(q)) substr.push(c);
  }
  return prefix.concat(substr).slice(0, limit);
}
```

- [ ] **Step 4: テスト通過を確認**

Run: `node --test tests/gazetteer.test.js 2>&1 | tail -5`
Expected: PASS（7 テスト緑）

- [ ] **Step 5: 全単体スイートで回帰確認**

Run: `npm run test:js 2>&1 | tail -5`
Expected: PASS（既存＋gazetteer 全緑）

- [ ] **Step 6: コミット**

```bash
git add js/lib/gazetteer.js tests/gazetteer.test.js
git commit -m "$(printf 'feat(search): gazetteer.js（COUNTRIES 239＋searchCountries 純関数）\n\n日本語/英語名の部分一致（前方一致優先）・空/無マッチ→[]・limit。COUNTRY_CENTROIDS×FIPS_JA join。\n単体7（網羅/JP/EN/EXTRA/前方一致/limit/空）緑。\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: ?search=on|off トグル（immerse.js）

**Files:**
- Modify: `js/lib/immerse.js`（`immerseSearch` 追加＋`immerseClasses` に push）
- Modify: `tests/immerse.test.js`（import 追加＋assert 追加）

**Interfaces:**
- Produces: `export function immerseSearch(search): 'on'|'off'`、`immerseClasses` 出力に `'search-on'|'search-off'` を含む。

- [ ] **Step 1: 失敗テストを書く**

`tests/immerse.test.js` の import 行に `immerseSearch` を追加し（既存 import の `immerseSpace` の隣など）、末尾に追加：

```js
test('immerseSearch: 既定 on・?search=off で上書き（大小無視）', () => {
  assert.equal(immerseSearch(''), 'on');
  assert.equal(immerseSearch('?search=off'), 'off');
  assert.equal(immerseSearch('?search=OFF'), 'off');
  assert.equal(immerseSearch('?search=on'), 'on');
  assert.equal(immerseSearch('?search=x'), 'on'); // 不正は既定
});

test('immerseClasses: search- を常時付与（既定 search-on、?search=off で上書き）', () => {
  assert.ok(immerseClasses('').includes('search-on'));
  assert.ok(immerseClasses('?search=off').includes('search-off'));
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/immerse.test.js 2>&1 | tail -5`
Expected: FAIL（`immerseSearch` が export されていない）

- [ ] **Step 3: immerse.js に実装**

`js/lib/immerse.js` の `immerseLegend` 関数定義の直後に追加：

```js
// ?search=on|off（大小無視）。globe 上部中央の国検索ボックスの表示。既定 on。
// off は before 比較用（body.search-off で #search を隠す）。
export function immerseSearch(search) {
  const m = /[?&]search=(on|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'on';
}
```

`immerseClasses` 内、`out.push('legend-' + immerseLegend(search));` の直後に追加：

```js
  out.push('search-' + immerseSearch(search));
```

- [ ] **Step 4: テスト通過＋全単体確認**

Run: `npm run test:js 2>&1 | tail -5`
Expected: PASS（immerse 含め全緑）

- [ ] **Step 5: コミット**

```bash
git add js/lib/immerse.js tests/immerse.test.js
git commit -m "$(printf 'feat(search): ?search=on|off トグル（immerse.js・body.search-*）\n\nimmerseSearch 追加＋immerseClasses に search- 付与。既定 on。単体（既定/off/大小無視）緑。\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: 検索 UI（search.js＋index.html＋CSS）＋ render/dropdown e2e

**Files:**
- Create: `js/ui/search.js`
- Modify: `index.html`（globe オーバーレイに `#search` markup を追加。**script タグは不要**＝main.js が import）
- Modify: `css/orbis.css`（**末尾に** `#search` ブロックを追記）
- Create: `tests/e2e/search.spec.js`（render/dropdown/?search=off。**この時点では onSelect 未配線でも UI 単体が成立**）

**Interfaces:**
- Consumes: `searchCountries`（Task 2）。
- Produces: `export function initSearch(onSelect, opts?): void`（`onSelect(country)` を選択時に呼ぶ。`opts` で要素 ID 差替可）。DOM 要素 `#search-input` / `#search-results`。

> **設計補足（spec の自己初期化記述を上書き）**：search.js は share.js と同型で **main.js が `initSearch(onSelect)` を呼ぶ**（onSelect が map/flyTo を要するため自己初期化しない）。index.html に search.js の script タグは追加しない。

- [ ] **Step 1: 失敗 e2e を書く**

Create `tests/e2e/search.spec.js`：

```js
import { test, expect } from '@playwright/test';

test('検索ボックス：入力で候補が出る', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await page.locator('#search-input').fill('日本');
  const opt = page.locator('#search-results .search-opt').first();
  await expect(opt).toBeVisible({ timeout: 3000 });
  await expect(opt).toContainText('日本');
});

test('?search=off で検索ボックス非表示', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?search=off');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(page.locator('#search')).toBeHidden();
});
```

- [ ] **Step 2: e2e 失敗を確認（隔離ポート）**

Run:
```bash
cat > /tmp/pw-search.config.mjs <<'CFG'
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', workers: 1,
  use: { baseURL: 'http://localhost:8131', headless: true },
  webServer: { command: 'python3 -m http.server 8131', url: 'http://localhost:8131', reuseExistingServer: false, timeout: 30000 },
});
CFG
npx playwright test tests/e2e/search.spec.js --config=/tmp/pw-search.config.mjs 2>&1 | tail -15
```
Expected: FAIL（`#search-input` 不在）

- [ ] **Step 3: search.js を実装**

Create `js/ui/search.js`：

```js
// 国検索 UI。globe 上部中央のグラス検索ボックス＋オートコンプリート候補。
// 検索ロジックは純粋部 lib/gazetteer.js（searchCountries）。選択で onSelect(country) を呼ぶ。
// main.js が initSearch(onSelect) を配線する（share.js と同型）。
import { searchCountries } from '../lib/gazetteer.js';

export function initSearch(onSelect, {
  input = (typeof document !== 'undefined' ? document.getElementById('search-input') : null),
  results = (typeof document !== 'undefined' ? document.getElementById('search-results') : null),
} = {}) {
  if (!input || !results) return;
  let matches = [];
  let active = -1;

  const close = () => {
    results.innerHTML = '';
    results.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const render = () => {
    if (matches.length === 0) {
      results.innerHTML = '<li class="search-empty" role="option" aria-disabled="true">該当なし</li>';
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return;
    }
    results.innerHTML = matches.map((c, i) =>
      `<li class="search-opt${i === active ? ' active' : ''}" role="option" id="search-opt-${i}"`
      + ` data-i="${i}" aria-selected="${i === active}">`
      + `<span class="search-ja">${c.ja}</span><span class="search-en">${c.en}</span></li>`).join('');
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `search-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const choose = (i) => {
    const c = matches[i];
    if (!c) return;
    input.value = c.ja;
    close();
    if (typeof onSelect === 'function') onSelect(c);
  };

  input.addEventListener('input', () => {
    if (input.value.trim() === '') { matches = []; close(); return; }
    matches = searchCountries(input.value);
    active = -1;
    render();
  });

  input.addEventListener('keydown', (e) => {
    if (results.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, matches.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active >= 0 ? active : 0); }
    else if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
  });

  // mousedown（blur より先）で確定。タッチ/クリック両対応。
  results.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.search-opt');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });

  input.addEventListener('blur', () => { setTimeout(close, 120); });

  // '/' で検索にフォーカス（他の入力にフォーカスが無い時）。
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(tag)) { e.preventDefault(); input.focus(); }
  });
}
```

- [ ] **Step 4: index.html に #search markup を追加**

`<div id="map"></div>`（globe コンテナ内）の直後に追加：

```html
      <div id="search">
        <input id="search-input" type="text" placeholder="国を検索" autocomplete="off"
          role="combobox" aria-expanded="false" aria-controls="search-results"
          aria-autocomplete="list" aria-label="国を検索して移動">
        <ul id="search-results" class="search-results" role="listbox" aria-label="国の候補" hidden></ul>
      </div>
```

- [ ] **Step 5: css/orbis.css 末尾に #search ブロックを追記**

`css/orbis.css` の**末尾**に追加：

```css
/* ===== 国検索ボックス（globe 上部中央・グラス＋ネオン・ui-a 言語）===== */
#search { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 6;
  width: min(320px, 60vw); }
body.search-off #search { display: none; }
#search-input { width: 100%; box-sizing: border-box; padding: 8px 14px; border-radius: 999px;
  background: rgba(10, 18, 32, 0.62); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  border: 1px solid rgba(120, 200, 255, 0.30); color: #dbeafe; font-size: 13px; outline: none;
  box-shadow: 0 2px 18px rgba(0, 0, 0, 0.35); transition: border-color .2s, box-shadow .2s; }
#search-input::placeholder { color: rgba(180, 210, 240, 0.55); }
#search-input:focus { border-color: rgba(120, 220, 255, 0.7);
  box-shadow: 0 0 0 1px rgba(120, 220, 255, 0.4), 0 4px 22px rgba(0, 40, 80, 0.5); }
.search-results { list-style: none; margin: 6px 0 0; padding: 4px; border-radius: 12px;
  background: rgba(10, 18, 32, 0.80); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  border: 1px solid rgba(120, 200, 255, 0.22); max-height: 320px; overflow-y: auto;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); }
.search-results[hidden] { display: none; }
.search-opt { display: flex; justify-content: space-between; gap: 10px; padding: 7px 10px;
  border-radius: 8px; cursor: pointer; }
.search-opt .search-ja { color: #e8f2ff; font-size: 13px; }
.search-opt .search-en { color: rgba(150, 185, 225, 0.7); font-size: 11px; align-self: center; }
.search-opt.active { background: rgba(80, 160, 240, 0.20); }
.search-empty { padding: 7px 10px; color: rgba(170, 195, 225, 0.6); font-size: 12px; }
@media (hover: hover) { .search-opt:hover { background: rgba(80, 160, 240, 0.20); } }
@media (max-width: 760px) { #search { width: min(70vw, 360px); } }
@media (prefers-reduced-motion: reduce) { #search-input { transition: none; } }
```

- [ ] **Step 6: main.js に「UI のみ配線（onSelect なし）」を仮置き**

`js/main.js` の import 群（`import { initShare } ...` の直後）に追加：

```js
import { initSearch } from './ui/search.js';
```

`initShare(...)` 呼び出しの直後に、まず UI 描画だけ通すため onSelect なしで初期化（Task 5 で onSelect を差し込む）：

```js
  initSearch(null);
```

- [ ] **Step 7: e2e（render/dropdown/?search=off）通過を確認**

Run: `npx playwright test tests/e2e/search.spec.js --config=/tmp/pw-search.config.mjs 2>&1 | tail -15`
Expected: PASS（2 テスト緑）

- [ ] **Step 8: コミット**

```bash
git add js/ui/search.js index.html css/orbis.css tests/e2e/search.spec.js js/main.js
git commit -m "$(printf 'feat(search): 検索 UI（globe 上部中央ボックス＋候補＋キーボード）\n\nsearch.js（initSearch・/フォーカス・↑↓/Enter/Esc・mousedown 確定）＋index.html #search＋css 末尾 #search（グラス・search-off 非表示）。main.js は UI のみ仮配線（onSelect は次タスク）。e2e（候補表示/?search=off 非表示）隔離ポート緑。\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: main.js 配線（onSelect→flyTo＋着地リティクル）＋ select e2e

**Files:**
- Modify: `js/main.js`（`initSearch(null)` を onSelect 付きに差し替え）
- Modify: `tests/e2e/search.spec.js`（select→flyTo の検証を追加）

**Interfaces:**
- Consumes: `initSearch`（Task 4）、既存 `map`/`overlay`/`selPopup`/`drawAll`/`selected`/`selectedFlight`/`selectedShip`（main.js スコープ内・module レベル）。

- [ ] **Step 1: select→flyTo の失敗テストを追加**

`tests/e2e/search.spec.js` の末尾に追加：

```js
test('候補選択で国の中心へ flyTo', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await page.locator('#search-input').fill('日本');
  await page.locator('#search-results .search-opt').first().click();
  await page.waitForTimeout(2000); // flyTo（duration 1500）着地待ち
  const c = await page.evaluate(() => {
    const m = window.__orbis.map; const ctr = m.getCenter();
    return { lng: +ctr.lng.toFixed(1), lat: +ctr.lat.toFixed(1) };
  });
  expect(Math.abs(c.lng - 135.7)).toBeLessThan(2.5);
  expect(Math.abs(c.lat - 36.2)).toBeLessThan(2.5);
});
```

- [ ] **Step 2: e2e 失敗を確認**

Run: `npx playwright test tests/e2e/search.spec.js --config=/tmp/pw-search.config.mjs -g "flyTo" 2>&1 | tail -15`
Expected: FAIL（`initSearch(null)` で選択しても地図が動かない）

- [ ] **Step 3: main.js の配線を onSelect 付きに差し替え**

`js/main.js` の `initSearch(null);` を以下に置換：

```js
  // 国検索：候補選択で国の中心へ flyTo＋既存の着地リティクル（CYAN）を再利用。
  initSearch((country) => {
    selectedFlight = null;
    selectedShip = null;
    selected = { lon: country.lng, lat: country.lat, title: country.ja, layerId: 'search', at: performance.now() };
    if (window.__orbis) window.__orbis.selected = selected;
    map.flyTo({ center: [country.lng, country.lat], zoom: 4, duration: 1500, essential: true });
    if (selPopup) selPopup.setLngLat([country.lng, country.lat]).setHTML(`<div class="sel-title">${country.ja}</div>`).addTo(map);
    drawAll(overlay);
  });
```

- [ ] **Step 4: e2e（全 search.spec）通過を確認**

Run: `npx playwright test tests/e2e/search.spec.js --config=/tmp/pw-search.config.mjs 2>&1 | tail -15`
Expected: PASS（3 テスト緑）

- [ ] **Step 5: 全単体スイートで最終回帰**

Run: `npm run test:js 2>&1 | tail -5`
Expected: PASS（全緑）

- [ ] **Step 6: コミット**

```bash
git add js/main.js tests/e2e/search.spec.js
git commit -m "$(printf 'feat(search): 候補選択で国中心へ flyTo（着地リティクル再利用）\n\nmain.js initSearch 配線＝onSelect で selected セット→flyTo(zoom4)→selPopup→drawAll（CYAN リティクル）。globe 非編集。e2e（select→日本中心へ移動）緑。\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 統合（全タスク完了後）

- [ ] `origin/main` を fetch し本 worktree にマージ（`git fetch origin && git merge origin/main`）。css 末尾追記・main.js 配線は非隣接でコンフリクト想定薄。出たら両ブロック保持で解決。
- [ ] マージ結果で `npm run test:js`（全緑）＋ `tests/e2e/search.spec.js`（隔離ポート 3緑）を再実行。
- [ ] `git push origin HEAD:main`（ローカル main 不変・ff push）。**push は ask 対象**＝実行時に日本語で安全根拠を併記（push 先は作業反映・保護ブランチでない）。
- [ ] cron 周期デプロイで本番反映を curl（`country_centroids.js` 200・`gazetteer.js`/`search.js` 配信）＋本番 Playwright（検索→flyTo・`?search=off`）で検証。
- [ ] 太田さん実機確認（上部中央バーの見え・候補可読性・モバイル・`?search` before/after）。所有ノート orbis-uiux-improvements.md の進捗ログに追記。

## Self-Review（spec 対応確認）

- **全 FIPS_JA 国検索**（spec スコープ）→ Task 1（FS 補完＋生成＋EXTRA 68）＋Task 2（COUNTRIES 239 網羅テスト）。
- **geometry centroid（最大ポリゴン bbox 中心）**→ Task 1 `largest_ring_bbox_center`。
- **searchCountries マッチ仕様**（日英部分一致・前方一致優先・空/無マッチ []・limit）→ Task 2 実装＋7テスト。
- **上部中央 UI・キーボード・候補**→ Task 4 search.js＋index.html＋CSS。
- **?search=on|off**→ Task 3。
- **flyTo zoom4＋着地リティクル再利用・globe 非編集**→ Task 5（`buildReticleConfigs` は CYAN 固定で layerId 'search' 可）。
- **e2e 隔離ポート**→ Task 4/5（`/tmp/pw-search.config.mjs`・reuseExistingServer:false）。
- **型整合**：`searchCountries`/`COUNTRIES`/`initSearch(onSelect, opts)`/`COUNTRY_CENTROIDS({code,en,lng,lat})` は全タスクで一貫。`country.lng/lat/ja` を Task 5 で使用＝Task 2 の COUNTRIES 形と一致。
- プレースホルダ無し（EXTRA 68・全コード inline 済）。
