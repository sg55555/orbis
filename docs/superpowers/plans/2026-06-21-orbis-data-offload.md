# orbis データ配信の Vercel 切り離し 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `data/snapshots/*.json` をフロントが GitHub raw から取得するようにし、cron データ commit が Vercel ビルド枠を食う構造を断つ。

**Architecture:** 配信元判定を純ヘルパ `js/lib/data-source.js`（ホスト名＋`?data=` override）に集約し、`js/snapshot.js`（全ポーリング層＋manifest）と `js/main.js`（AI層3 fetch）がそれを経由。本番=raw GitHub（Fastly エッジキャッシュ）、ローカル/e2e=相対パス。Vercel "Ignored Build Step"（手動設定）で data-only commit のデプロイを止める。

**Tech Stack:** Vanilla JS (ESM)、node:test、Playwright、GitHub raw、Vercel。

## Global Constraints
- **対象は `data/snapshots/*.json` のみ**（manifest 含む）。`data/static/*.geojson`・`config/*.json` への fetch は**変更しない**。
- raw ベース URL（厳密）: `https://raw.githubusercontent.com/sg55555/orbis/main/data/snapshots`
- remote（本番/preview）: `?t=` を付けず既定キャッシュ（Fastly ~300s エッジ活用）。local: 従来通り `?t=${Date.now()}` ＋ `{ cache: 'no-store' }`。
- ローカル判定ホスト集合: `localhost` / `127.0.0.1` / `[::1]` / `''`（file://）。それ以外は remote。
- override 優先: `?data=local` → 強制 local、`?data=github` → 強制 remote（ホスト判定より優先）。
- SW `CACHE` を `orbis-v40` → `orbis-v41`。
- 純ヘルパは `loc` 引数注入（既定 `location`）で node からテスト可能にする。
- テスト実行: `node --test tests/*.test.js`（= `npm run test:js`）。e2e: `npx playwright test`。
- コミット footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **subagent は git fetch/merge/pull/checkout/rebase を実行しない**（現ブランチで add/commit のみ）。`data/snapshots/` 配下を commit しない。

---

### Task 1: 配信元 resolver `js/lib/data-source.js`（純ヘルパ＋単体テスト）

**Files:**
- Create: `js/lib/data-source.js`
- Test: `tests/data-source.test.js`

**Interfaces:**
- Produces:
  - `RAW_BASE: string` — `'https://raw.githubusercontent.com/sg55555/orbis/main/data/snapshots'`
  - `isRemoteData(loc?): boolean`
  - `snapshotBaseUrl(loc?): string` — remote 時 `RAW_BASE`、local 時 `'data/snapshots'`
  - `snapshotUrl(name, loc?): string` — `` `${snapshotBaseUrl(loc)}/${name}.json` ``（`?t=` は付けない）

- [ ] **Step 1: Write the failing test**

`tests/data-source.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAW_BASE, isRemoteData, snapshotBaseUrl, snapshotUrl } from '../js/lib/data-source.js';

const loc = (hostname, search = '') => ({ hostname, search });

test('isRemoteData: ローカルホストは false', () => {
  assert.equal(isRemoteData(loc('localhost')), false);
  assert.equal(isRemoteData(loc('127.0.0.1')), false);
  assert.equal(isRemoteData(loc('[::1]')), false);
  assert.equal(isRemoteData(loc('')), false); // file://
});

test('isRemoteData: 本番/preview ホストは true', () => {
  assert.equal(isRemoteData(loc('orbis-beta.vercel.app')), true);
  assert.equal(isRemoteData(loc('orbis-git-preview.vercel.app')), true);
});

test('isRemoteData: ?data= override がホスト判定に優先', () => {
  assert.equal(isRemoteData(loc('orbis-beta.vercel.app', '?data=local')), false);
  assert.equal(isRemoteData(loc('localhost', '?data=github')), true);
  assert.equal(isRemoteData(loc('localhost', '?foo=1&data=github')), true);
});

test('snapshotBaseUrl: remote=RAW_BASE / local=相対', () => {
  assert.equal(snapshotBaseUrl(loc('orbis-beta.vercel.app')), RAW_BASE);
  assert.equal(snapshotBaseUrl(loc('localhost')), 'data/snapshots');
});

test('snapshotUrl: name を .json 付き完全URLに（?t= は付けない）', () => {
  assert.equal(snapshotUrl('quakes', loc('localhost')), 'data/snapshots/quakes.json');
  assert.equal(snapshotUrl('quakes', loc('orbis-beta.vercel.app')), `${RAW_BASE}/quakes.json`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/data-source.test.js`
Expected: FAIL（`Cannot find module '../js/lib/data-source.js'`）

- [ ] **Step 3: Write minimal implementation**

`js/lib/data-source.js`:
```js
// data/snapshots の配信元を解決する純ヘルパ。本番=raw GitHub / ローカル=相対。
// 本番のデータは Vercel build から切り離し GitHub から直接配信する（cron commit が
// Vercel デプロイ枠を食わないようにするため）。data/static・config は対象外（相対のまま）。
export const RAW_BASE = 'https://raw.githubusercontent.com/sg55555/orbis/main/data/snapshots';
const LOCAL_BASE = 'data/snapshots';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

function _loc(loc) {
  return loc || (typeof location !== 'undefined' ? location : { hostname: '', search: '' });
}

export function isRemoteData(loc) {
  const l = _loc(loc);
  const search = l.search || '';
  if (/[?&]data=local(\b|$)/.test(search)) return false;
  if (/[?&]data=github(\b|$)/.test(search)) return true;
  return !LOCAL_HOSTS.has(l.hostname || '');
}

export function snapshotBaseUrl(loc) {
  return isRemoteData(loc) ? RAW_BASE : LOCAL_BASE;
}

export function snapshotUrl(name, loc) {
  return `${snapshotBaseUrl(loc)}/${name}.json`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/data-source.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add js/lib/data-source.js tests/data-source.test.js
git commit -m "feat(data-offload): 配信元resolver(ホスト名判定+?data= override)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `js/snapshot.js` を resolver 経由に（ポーリング層＋manifest）

**Files:**
- Modify: `js/snapshot.js`
- Test: `tests/snapshot.test.js`（新規）

**Interfaces:**
- Consumes: `isRemoteData`, `snapshotBaseUrl`（Task 1, `js/lib/data-source.js`）
- Produces: 既存公開 API 不変（`fetchSnapshot(layerId)`, `fetchManifest()`, `fetchSnapshots(ids)`, `startPolling(ids, ms, cb)`）。内部の URL/キャッシュ方針のみ source 別に。

**現状の `js/snapshot.js` 冒頭（置換対象）:**
```js
const BASE = 'data/snapshots';

export async function fetchSnapshot(layerId) {
  const res = await fetch(`${BASE}/${layerId}.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`snapshot ${layerId} ${res.status}`);
  return res.json();
}

export async function fetchManifest() {
  const res = await fetch(`${BASE}/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return { layers: {} };
  return res.json();
}
```

- [ ] **Step 1: Write the failing test**

`tests/snapshot.test.js`（global `location`/`fetch` を差し替えて URL/init を検証）:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSnapshot } from '../js/snapshot.js';
import { RAW_BASE } from '../js/lib/data-source.js';

function withEnv(hostname, run) {
  const origLoc = globalThis.location;
  const origFetch = globalThis.fetch;
  const calls = [];
  globalThis.location = { hostname, search: '' };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return Promise.resolve(run(calls)).finally(() => {
    globalThis.location = origLoc;
    globalThis.fetch = origFetch;
  });
}

test('remote(本番ホスト): raw URL・?t= 無し・no-store 無し', async () => {
  await withEnv('orbis-beta.vercel.app', async (calls) => {
    await fetchSnapshot('quakes');
    assert.equal(calls[0].url, `${RAW_BASE}/quakes.json`);
    assert.ok(!calls[0].init || calls[0].init.cache !== 'no-store');
  });
});

test('local: 相対 URL・?t= 付き・no-store', async () => {
  await withEnv('localhost', async (calls) => {
    await fetchSnapshot('quakes');
    assert.match(calls[0].url, /^data\/snapshots\/quakes\.json\?t=\d+$/);
    assert.equal(calls[0].init.cache, 'no-store');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/snapshot.test.js`
Expected: FAIL（remote でも `?t=` が付く＝現状実装のため、最初のアサーションで落ちる）

- [ ] **Step 3: Write minimal implementation**

`js/snapshot.js` の冒頭を次に置換（`fetchSnapshots`/`startPolling` は不変）:
```js
// data/snapshots/*.json と manifest.json を取得・ポーリングする薄いI/O層。
// 本番は raw GitHub（Fastly エッジキャッシュ）、ローカルは相対＋即時鮮度。配信元判定は data-source.js。
import { snapshotBaseUrl, isRemoteData } from './lib/data-source.js';

async function _fetchJson(name) {
  const base = snapshotBaseUrl();
  if (isRemoteData()) {
    // 本番: raw GitHub。?t= を付けず Fastly のエッジキャッシュ(≈300s)に載せる。
    return fetch(`${base}/${name}.json`);
  }
  // ローカル: 即時鮮度（テストデータ反映）。
  return fetch(`${base}/${name}.json?t=${Date.now()}`, { cache: 'no-store' });
}

export async function fetchSnapshot(layerId) {
  const res = await _fetchJson(layerId);
  if (!res.ok) throw new Error(`snapshot ${layerId} ${res.status}`);
  return res.json();
}

export async function fetchManifest() {
  const res = await _fetchJson('manifest');
  if (!res.ok) return { layers: {} };
  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/snapshot.test.js tests/data-source.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/snapshot.js tests/snapshot.test.js
git commit -m "feat(data-offload): snapshot.js を配信元resolver経由に(本番raw/ローカル相対)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `js/main.js` AI層3 fetch＋`sw.js` v41＋`vercel.json` 整理

**Files:**
- Modify: `js/main.js`（briefing/instability/forecast の3 fetch）
- Modify: `sw.js`（CACHE 版上げ）
- Modify: `vercel.json`（dead な data/snapshots ヘッダ削除）

**Interfaces:**
- Consumes: `snapshotUrl`（Task 1, `js/lib/data-source.js`）

- [ ] **Step 1: `js/main.js` に import を追加**

`js/main.js` の import 群（先頭付近）に追加:
```js
import { snapshotUrl } from './lib/data-source.js';
```

- [ ] **Step 2: AI層3 fetch を resolver 経由に置換**

`js/main.js` の3箇所を置換（前後の `.then`/`.catch`/graceful は不変）:
```js
// 置換前 → 置換後
// fetch('data/snapshots/briefing.json')  → fetch(snapshotUrl('briefing'))
// fetch('data/snapshots/instability.json') → fetch(snapshotUrl('instability'))
// fetch('data/snapshots/forecast.json')  → fetch(snapshotUrl('forecast'))
```
具体的には次の3行を置換:
```js
const brief = await fetch(snapshotUrl('briefing')).then((r) => r.json()).catch(() => null);
```
```js
const ins = await fetch(snapshotUrl('instability')).then((r) => r.json()).catch(() => null);
```
```js
const fc = await fetch(snapshotUrl('forecast')).then((r) => r.ok ? r.json() : null).catch(() => null);
```
（`config/live_channels.json` / `config/live_cameras.json` は**変更しない**。）

- [ ] **Step 3: `sw.js` の CACHE 版上げ**

`sw.js` 2行目:
```js
const CACHE = 'orbis-v41';
```
（fetch ハンドラの `/data/snapshots/` バイパスは不変＝raw URL のパスも `/data/snapshots/` を含むため合致。）

- [ ] **Step 4: `vercel.json` の dead ヘッダ削除**

`vercel.json` を次に置換（`/data/snapshots/` の Cache-Control を削除。raw 配信後は Vercel が当該を配信しないため不要）:
```json
{
  "version": 2,
  "framework": null,
  "cleanUrls": true
}
```

- [ ] **Step 5: 回帰テスト（既存 JS 単体＋AI層 e2e）**

Run: `node --test tests/*.test.js`
Expected: PASS（data-source / snapshot を含む全 JS 単体緑）

Run: `npx playwright test tests/e2e/briefing.spec.js tests/e2e/instability.spec.js tests/e2e/forecast.spec.js`
Expected: PASS（localhost 実行＝`isRemoteData()=false`＝相対 URL のため、既存 route mock `**/data/snapshots/*.json` がそのまま合致し3層描画＋flyTo を担保）

- [ ] **Step 6: 配線確認（grep）**

Run:
```bash
grep -n "snapshotUrl\|data/snapshots" js/main.js
grep -n "orbis-v" sw.js
```
Expected: main.js の AI層3 fetch が `snapshotUrl(...)` を使い、リテラル `'data/snapshots/<ai>.json'` が AI層に残っていない。sw.js が `orbis-v41`。

- [ ] **Step 7: Commit**

```bash
git add js/main.js sw.js vercel.json
git commit -m "feat(data-offload): main.js AI fetch を resolver経由・sw v41・vercel.json整理

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 手動ステップ（コード外・実装後に太田さんが実施）

実装が本番デプロイされ raw 取得を確認した**後**に、Vercel ダッシュボードで設定:

**Settings → Git → Ignored Build Step** に:
```
git diff --quiet HEAD^ HEAD -- ':(exclude)data/snapshots'
```
- exit 0（data/snapshots だけ変更）= デプロイ skip／exit 非0（他も変更・HEAD^ 不在）= ビルド。
- これで cron データ commit が Vercel デプロイを消費しなくなる。

## ロールアウト順（統合セッションが実施）
1. 本 plan を実装（Task 1-3）→ main へ統合・push（**非data commit ＝ Vercel deploy 1回**。レート制限中なら forecast 2h 抑制で窓回復後／collector 一時 Disable で即開け＝最後の窓争い）。
2. 本番検証：各ポーリング層が raw から取得・`forecast.json` 本番 200・コンソールエラー 0・実機描画。
3. 上記「手動ステップ」を実施。
4. data-only cron commit 後に Vercel が deploy を作らない（skip）こと＋本番データが raw 経由で更新されることを確認。

## Self-Review（spec 対応）
- spec §設計1（data-source.js）→ Task 1。✓
- spec §設計2（snapshot.js per-source fetch）→ Task 2。✓
- spec §設計3（main.js AI3）→ Task 3 Step1-2。✓
- spec §設計4（sw v41）→ Task 3 Step3。✓
- spec §設計5（vercel.json）→ Task 3 Step4。✓
- spec §設計6（Ignored Build Step）→ 手動ステップ（コード外）。✓
- spec §鮮度（raw は ?t= 無し/エッジ・local は ?t=/no-store）→ Task 2 実装＋Task 1/2 テスト。✓
- spec §テスト（単体 data-source・e2e 回帰）→ Task 1/2/3。✓
- spec §スコープ外（data/static・config 不変）→ Global Constraints＋Task 3 注記。✓
- 型整合：`isRemoteData`/`snapshotBaseUrl`/`snapshotUrl`/`RAW_BASE` は Task 1 定義を Task 2/3 がそのまま使用。✓
