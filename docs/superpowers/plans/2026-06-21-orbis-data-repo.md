# orbis 公開データ専用 repo（orbis-data）実装計画

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (- [ ]) syntax.

**Goal:** cron 更新の snapshot を public な orbis-data repo に移し、main をコードのみにして Vercel デプロイ頻度を激減（rate-limit 構造解決）。フロントは orbis-data を raw 直読み。

**Architecture:** 既存 resolver(js/lib/data-source.js) を再利用。REMOTE_ENABLED=true・RAW_BASE を orbis-data ルートに。collector ワークフローは orbis-data を ./data/snapshots に checkout（Python 無改変）して orbis-data へ push。main から data/snapshots を撤去。

**Tech Stack:** Vanilla JS(ESM)・node:test・Playwright・GitHub Actions・GitHub raw・Vercel。

## Global Constraints
- RAW_BASE(厳密): https://raw.githubusercontent.com/sg55555/orbis-data/main （ルート直下・name.json）
- REMOTE_ENABLED=true（js/lib/data-source.js）。hostPrefersRemote/isRemoteData/snapshotBaseUrl/snapshotUrl のロジックは不変。
- SW: CACHE を orbis-v41 → orbis-v42。fetch バイパスに url.hostname === 'raw.githubusercontent.com' を追加。
- collector(collect/collect-slow/collect-briefing/collect-instability/collect-forecast): orbis-data を path: data/snapshots に checkout(token=secrets.ORBIS_DATA_TOKEN, repository=sg55555/orbis-data, persist-credentials:true)。commit/push は data/snapshots 内で実行(commit msg "data: refresh [skip ci]")。concurrency group collect 維持。
- main: data/snapshots を git rm --cached + 実ファイル削除 + .gitignore へ data/snapshots/ 追加。data/static・config は不変。
- ローカル/e2e: localhost は相対(変更なし)。ローカルでデータが要る時は ?data=github。
- subagent は git fetch/merge/pull/checkout/rebase を実行しない(add/commit のみ)。data/snapshots を commit しない。
- commit footer: Co-Authored-By: Claude Opus 4.8 (noreply)

---

### Task 1: フロント re-enable（data-source.js + tests + sw.js）

**Files:**
- Modify: js/lib/data-source.js
- Modify: tests/data-source.test.js
- Modify: tests/snapshot.test.js
- Modify: sw.js

**Interfaces:**
- Produces: REMOTE_ENABLED=true・RAW_BASE=orbis-data。snapshotUrl(name) は本番で RAW_BASE/name.json、local で data/snapshots/name.json。

- [ ] Step 1: data-source.js を更新

js/lib/data-source.js の先頭定数2つを変更（hostPrefersRemote/isRemoteData/snapshotBaseUrl/snapshotUrl の関数本体は不変）:

    export const RAW_BASE = 'https://raw.githubusercontent.com/sg55555/orbis-data/main';
    // public な orbis-data repo へ分離したので raw を有効化。
    export const REMOTE_ENABLED = true;

コメントは「orbis-data(public)へ分離・有効化」に更新してよい。LOCAL_BASE='data/snapshots' は不変。

- [ ] Step 2: data-source.test.js を REMOTE_ENABLED=true に追従

tests/data-source.test.js を次の内容に置換（loc ヘルパは ({hostname, search}) を返す）。要点:
- hostPrefersRemote の host/override テストは不変（localhost等 false / vercel true / override）。
- REMOTE_ENABLED が true であること。
- isRemoteData: localhost→false / orbis-beta.vercel.app→true / localhost+?data=github→true / vercel+?data=local→false。
- snapshotBaseUrl: vercel→RAW_BASE / localhost→'data/snapshots'。
- snapshotUrl: ('quakes', vercel)→RAW_BASE + '/quakes.json' / ('quakes', localhost)→'data/snapshots/quakes.json'。
- RAW_BASE === 'https://raw.githubusercontent.com/sg55555/orbis-data/main'。

実コード:

    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { RAW_BASE, REMOTE_ENABLED, hostPrefersRemote, isRemoteData, snapshotBaseUrl, snapshotUrl } from '../js/lib/data-source.js';
    const loc = (hostname, search = '') => ({ hostname, search });
    test('hostPrefersRemote: ローカルホストは false', () => {
      assert.equal(hostPrefersRemote(loc('localhost')), false);
      assert.equal(hostPrefersRemote(loc('127.0.0.1')), false);
      assert.equal(hostPrefersRemote(loc('[::1]')), false);
      assert.equal(hostPrefersRemote(loc('')), false);
    });
    test('hostPrefersRemote: 本番/preview ホストは true', () => {
      assert.equal(hostPrefersRemote(loc('orbis-beta.vercel.app')), true);
      assert.equal(hostPrefersRemote(loc('orbis-git-preview.vercel.app')), true);
    });
    test('hostPrefersRemote: ?data= override 優先', () => {
      assert.equal(hostPrefersRemote(loc('orbis-beta.vercel.app', '?data=local')), false);
      assert.equal(hostPrefersRemote(loc('localhost', '?data=github')), true);
      assert.equal(hostPrefersRemote(loc('localhost', '?foo=1&data=github')), true);
    });
    test('REMOTE_ENABLED は true（orbis-data へ分離・有効化）', () => {
      assert.equal(REMOTE_ENABLED, true);
    });
    test('isRemoteData: 本番 true / local false / override', () => {
      assert.equal(isRemoteData(loc('orbis-beta.vercel.app')), true);
      assert.equal(isRemoteData(loc('localhost')), false);
      assert.equal(isRemoteData(loc('localhost', '?data=github')), true);
      assert.equal(isRemoteData(loc('orbis-beta.vercel.app', '?data=local')), false);
    });
    test('snapshotBaseUrl: remote=RAW_BASE / local=相対', () => {
      assert.equal(snapshotBaseUrl(loc('orbis-beta.vercel.app')), RAW_BASE);
      assert.equal(snapshotBaseUrl(loc('localhost')), 'data/snapshots');
    });
    test('snapshotUrl: remote=orbis-data raw / local=相対（?t= なし）', () => {
      assert.equal(snapshotUrl('quakes', loc('localhost')), 'data/snapshots/quakes.json');
      assert.equal(snapshotUrl('quakes', loc('orbis-beta.vercel.app')), RAW_BASE + '/quakes.json');
    });
    test('RAW_BASE が orbis-data ルート', () => {
      assert.equal(RAW_BASE, 'https://raw.githubusercontent.com/sg55555/orbis-data/main');
    });

- [ ] Step 3: snapshot.test.js を remote=raw / local=相対 に

tests/snapshot.test.js を次に置換（withEnv は globalThis.location/fetch を差し替え finally で復元）:

    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { fetchSnapshot } from '../js/snapshot.js';
    import { RAW_BASE } from '../js/lib/data-source.js';
    function withEnv(hostname, run) {
      const origLoc = globalThis.location; const origFetch = globalThis.fetch; const calls = [];
      globalThis.location = { hostname, search: '' };
      globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
      return Promise.resolve(run(calls)).finally(() => { globalThis.location = origLoc; globalThis.fetch = origFetch; });
    }
    test('remote(本番): orbis-data raw URL・?t= 無し・no-store 無し', async () => {
      await withEnv('orbis-beta.vercel.app', async (calls) => {
        await fetchSnapshot('quakes');
        assert.equal(calls[0].url, RAW_BASE + '/quakes.json');
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

- [ ] Step 4: sw.js を更新

sw.js: CACHE を orbis-v42 に。fetch ハンドラのデータ・バイパス条件に raw ホストを追加。現状:

    if (url.pathname.includes('/data/snapshots/') || url.hostname.includes('cartocdn')) return;

を次に:

    if (url.hostname === 'raw.githubusercontent.com' || url.pathname.includes('/data/snapshots/') || url.hostname.includes('cartocdn')) return;

2行目の const CACHE を 'orbis-v42' に。

- [ ] Step 5: テスト

Run: node --test tests/data-source.test.js tests/snapshot.test.js
Expected: PASS（data-source 8 + snapshot 2）

Run: node --test tests/*.test.js
Expected: PASS（全 JS 単体）

- [ ] Step 6: AI層 e2e 回帰（localhost→相対で不変を確認）

Run: npx playwright test tests/e2e/briefing.spec.js tests/e2e/instability.spec.js tests/e2e/forecast.spec.js
Expected: PASS（localhost ＝ isRemoteData false ＝ 相対 ＝ 既存 route mock 一致）

- [ ] Step 7: Commit

    git add js/lib/data-source.js tests/data-source.test.js tests/snapshot.test.js sw.js
    git commit -m "feat(data-repo): フロントをorbis-data raw有効化(REMOTE_ENABLED=true)+sw v42" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"

---

### Task 2: collector ワークフロー5本を orbis-data 連携に

**Files:**
- Modify: .github/workflows/collect.yml
- Modify: .github/workflows/collect-slow.yml
- Modify: .github/workflows/collect-briefing.yml
- Modify: .github/workflows/collect-instability.yml
- Modify: .github/workflows/collect-forecast.yml

**Interfaces:**
- Consumes: secret ORBIS_DATA_TOKEN（手動登録）。orbis-data repo(手動作成・seed 済)。

各 yml の steps を次の形に（collect.yml を例に・他4本も同パターンを各々の収集ステップで）:
- 既存の最初の checkout(main) の直後に orbis-data checkout を追加:

      - uses: actions/checkout@v6
      - uses: actions/checkout@v6
        with:
          repository: sg55555/orbis-data
          path: data/snapshots
          token: ${{ secrets.ORBIS_DATA_TOKEN }}
          persist-credentials: true

- setup-python / pip / 既存の各収集ステップ（python -m collectors.xxx）は不変。
- 末尾の Commit ステップを次に置換（data/snapshots=orbis-data 内で commit/push）:

      - name: Commit snapshots to orbis-data
        run: |
          cd data/snapshots
          git config user.name "orbis-bot"
          git config user.email "210495115+sg55555@users.noreply.github.com"
          git add -A
          if git diff --cached --quiet; then
            echo "no changes"
          else
            git commit -m "data: refresh [skip ci]"
            git pull --rebase origin main
            git push
          fi

- 各 yml で変えるのは「2nd checkout 追加」と「Commit ステップ置換」のみ。cron・concurrency(group collect)・env・収集ステップは不変。

- [ ] Step 1: collect.yml に orbis-data checkout 追加＋Commit ステップ置換（上記）
- [ ] Step 2: collect-slow.yml に同様の変更
- [ ] Step 3: collect-briefing.yml に同様の変更
- [ ] Step 4: collect-instability.yml に同様の変更
- [ ] Step 5: collect-forecast.yml に同様の変更
- [ ] Step 6: YAML 構文確認

Run: python -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/collect*.yml')]; print('yaml ok')"
Expected: yaml ok（5本パース成功）

- [ ] Step 7: Commit

    git add .github/workflows/collect.yml .github/workflows/collect-slow.yml .github/workflows/collect-briefing.yml .github/workflows/collect-instability.yml .github/workflows/collect-forecast.yml
    git commit -m "ci(data-repo): collector5本をorbis-data連携(data/snapshotsにcheckout→push)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"

注: ワークフローの実走検証は orbis-data + ORBIS_DATA_TOKEN(手動セットアップ)後にロールアウトで行う。本タスクは構造実装＋YAML 妥当性まで。

---

### Task 3: main から data/snapshots を撤去（gitignore）

**Files:**
- Delete(tracked): data/snapshots/ 配下の全ファイル
- Modify: .gitignore

**Interfaces:** なし（main はデータを持たずコードのみ。フロントは orbis-data raw を読む）。

- [ ] Step 1: .gitignore に追記

.gitignore の末尾に1行追加:

    data/snapshots/

- [ ] Step 2: 追跡解除＋削除

Run: git rm -r data/snapshots
（注: data/static は対象外＝残す。config も残す。）

- [ ] Step 3: 撤去確認

Run: git status --short
Expected: data/snapshots/ 配下が deleted としてステージ。data/static/ は変化なし。

Run: ls data/static >/dev/null && echo "static ok"
Expected: static ok（data/static は残存）

- [ ] Step 4: Commit

    git add -A
    git commit -m "chore(data-repo): mainからdata/snapshots撤去(orbis-dataへ移管)+gitignore" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"

---

## 手動セットアップ（コード外・ロールアウト前に太田さんが実施）
1. public repo 作成: gh repo create sg55555/orbis-data --public --description "orbis 自動生成データ(編集禁止)"
2. 現データ seed: 現 main の data/snapshots/*.json と *_history.json を orbis-data のルート直下へコピーして初回 commit/push（手順は実装後に私が補助スクリプトを提示可）。
3. fine-grained PAT 発行（Repository=orbis-data のみ・Contents: Read and write）。
4. main repo の Settings→Secrets and variables→Actions に ORBIS_DATA_TOKEN を登録。

## ロールアウト順（統合セッション）
1. 上記「手動セットアップ」完了を確認（orbis-data 存在＋seed 済＋ORBIS_DATA_TOKEN 登録）。
2. 本 plan の Task1-3 を main に統合・push → Vercel デプロイ1回。
   - 重要: orbis-data が seed 済でないと REMOTE_ENABLED=true のフロントが raw 404 になる。必ず seed 後に統合する。
3. 本番検証: フロントが orbis-data raw を取得（DevTools/curl で raw.githubusercontent.com/sg55555/orbis-data/main/*.json が 200・各層描画・エラー0）。
4. collector 手動 dispatch: gh workflow run collect.yml 等 → orbis-data へ push 成功 → フロント更新を確認。
5. 以後 main はコード commit のみ＝Vercel デプロイ稀＝rate-limit 解決。

## Self-Review（spec 対応）
- spec 設計1(orbis-data repo) → 手動セットアップ。
- spec 設計2(collector workflows) → Task 2。
- spec 設計3(PAT) → 手動セットアップ＋Task2 が secret 参照。
- spec 設計4(main data 撤去) → Task 3。
- spec 設計5(フロント resolver/sw) → Task 1。
- spec 設計6(データ契約 raw) → Task1 RAW_BASE。
- spec 設計7(local/e2e) → Task1 テスト＋e2e 回帰。
- 型整合: REMOTE_ENABLED/RAW_BASE/snapshotUrl は data-offload の resolver と同シグネチャ。collector の checkout path=data/snapshots は Task3 の gitignore と整合（main 追跡外なので衝突なし）。
