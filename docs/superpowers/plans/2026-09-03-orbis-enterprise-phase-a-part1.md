# Phase A Implementation Plan — part1（Task 1〜3）

骨格 `2026-09-03-orbis-enterprise-phase-a.md` の契約に従う（Global Constraints・File Structure・Interfaces・Task 番号は骨格が正）。

> **実装者への前提**：読むのは **骨格＋この分冊だけ**。ここに書かれたコード・設定・HTML・文言はすべて全文で、そのまま貼れば動く。参照先を読みに行く必要はない。
>
> **作業場所**：worktree `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a`（ブランチ `worktree-enterprise-a`）。main チェックアウト `/home/shugo/apps/orbis` には触らない。
>
> **コミットの打ち方**：本分冊のコミット手順は `git commit -F - <<'MSG' … MSG`（stdin からメッセージ全文を読む）で書く。`-m` を複数回並べると段落が分割され `Co-Authored-By:` と `Claude-Session:` が別ブロックになって trailer として認識されないため。内容は `git commit -m "<下に示すメッセージ全文>"` と同一。
>
> **この分冊が意図的に残す赤（時系列の整合）**：Task 2 が置く `tests/test_pages.py` には `@pytest.mark.xfail(strict=True)` が **3 件**ある。1 件は Task 3 Step 10 で外す。残り 2 件（`youtube.com/embed` と `rel="noopener"`）は **Task 8（part3）が外す**＝part3 の実装者はこの 2 行を削除する責任を負う。`strict=True` なので「まだ直っていないのに緑」も「直したのに xfail のまま」も検出される。

---

### Task 1: B0 squash workflow＋構造テスト（＋初回 squash は親セッションが本人確認後に実行）

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/.github/workflows/squash-data.yml`
- Create（Test）: `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/tests/test_workflow_squash.py`
- Read only（変更しない）: `.github/workflows/collect.yml`（bot identity と `concurrency.group` の出所・全 66 行）

**Interfaces:**
- **Consumes:** 先行タスクなし。既存 `.github/workflows/collect.yml` から読み取る 3 つの実値 — bot の `user.name` = `orbis-bot`／`user.email` = `210495115+sg55555@users.noreply.github.com`／`concurrency.group` = `collect`（`cancel-in-progress: false`）。
- **Produces:**
  - `.github/workflows/squash-data.yml` — workflow 名 `squash-data`・job id `squash`・`workflow_dispatch` 入力 `confirm`（型 string・required）。**骨格 Task 11 Step 5 の `gh workflow run squash-data.yml -f confirm=squash` がこの名前と入力名に依存する。**
  - `tests/test_workflow_squash.py` — 他タスクは import しない（独立）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_workflow_squash.py` を新規作成（全文）:

```python
"""orbis-data 月次 squash workflow の構造テスト（設計 §3.0・監査所見 DATA-03）。

このテストが守るもの＝「--force push の安全装置が消えていないこと」。
squash workflow は orbis-data（公開データリポ・8,552 commits・968MB）の履歴を
1 コミットへ畳む。撃つのは `git push --force` なので、次の 4 つのどれか 1 つでも
欠けた状態で main に入ってはいけない:

  1. concurrency group が collect（collect.yml / collect-slow.yml と共有）
     → 収集ジョブと直列化されず force-push と通常 push が交差するとデータが飛ぶ
  2. workflow_dispatch の confirm ゲート（"squash" と入力した時だけ job が動く）
     → Actions 画面の Run workflow ボタンの誤クリックで不可逆操作が走る
  3. orphan コミットの tree が squash 前の tree と一致することの assert
     → 中身が変わったまま force-push すると公開データが壊れる（復元手段なし）
  4. fetch-depth: 1（浅い checkout）
     → 8,552 commits を毎回 fetch する意味が無い（この workflow は履歴を使わない）

pyyaml は使わない。orbis の root requirements.txt は Vercel の関数へ install される
ため、テスト専用の依存を足すと本番が太る（tests/test_workflow_observability.py と同じ理由）。
標準ライブラリの正規表現/文字列だけで検査する。
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".github" / "workflows" / "squash-data.yml"
COLLECT = ROOT / ".github" / "workflows" / "collect.yml"


def wf_text():
    """squash workflow の生テキスト。無ければその場で失敗させる（フィクスチャにしない＝
    失敗が ERROR ではなく FAILED として並び、赤の理由が 1 行で読めるようにする）。"""
    assert WF.is_file(), f"{WF.relative_to(ROOT)} が無い（Step 3 で作る）"
    return WF.read_text(encoding="utf-8")


def test_monthly_cron_is_23_03_on_the_first():
    # 毎月 1 日 03:23 UTC（12:23 JST）。外部 dispatch(:00/:15/:30/:45) と collect cron(:07/:37) を避ける。
    assert re.search(r"^\s*-\s*cron:\s*'23 3 1 \* \*'\s*$", wf_text(), re.M), \
        "schedule の cron が '23 3 1 * *' でない"


def test_concurrency_group_is_collect_and_not_cancelled():
    t = wf_text()
    assert re.search(r"^concurrency:\s*$", t, re.M), "concurrency ブロックが無い"
    assert re.search(r"^\s+group:\s*collect\s*(#.*)?$", t, re.M), \
        "concurrency.group が collect でない（収集ジョブと直列化されない＝push 競合）"
    assert re.search(r"^\s+cancel-in-progress:\s*false\s*(#.*)?$", t, re.M), \
        "cancel-in-progress: false でない（squash の途中キャンセルは半端な状態を残す）"


def test_permissions_are_read_only_on_this_repo():
    # orbis 側には何も書かない。orbis-data への push 権は PAT（ORBIS_DATA_TOKEN）だけが持つ。
    assert re.search(r"^permissions:\s*\n\s+contents:\s*read\s*$", wf_text(), re.M), \
        "permissions: contents: read になっていない"


def test_workflow_dispatch_has_required_confirm_input():
    t = wf_text()
    assert re.search(r"^\s+workflow_dispatch:\s*$", t, re.M), "workflow_dispatch が無い"
    assert re.search(r"^\s+confirm:\s*$", t, re.M), "inputs.confirm が無い"
    assert re.search(r"^\s+required:\s*true\s*$", t, re.M), "confirm が required: true でない"
    assert "squash と入力" in t, "confirm の description に「squash と入力」の指示が無い"


def test_job_runs_only_on_schedule_or_explicit_confirm():
    assert "if: github.event_name == 'schedule' || inputs.confirm == 'squash'" in wf_text(), \
        "誤爆ガード（confirm == 'squash'）の if が無い／表記が違う"


def test_checkout_is_shallow_and_targets_orbis_data():
    t = wf_text()
    for needle in (
        "uses: actions/checkout@v6",
        "repository: sg55555/orbis-data",
        "path: data-repo",
        "token: ${{ secrets.ORBIS_DATA_TOKEN }}",
        "fetch-depth: 1",
        "persist-credentials: true",
    ):
        assert needle in t, f"checkout の設定 `{needle}` が無い"


def test_shell_step_uses_strict_mode():
    assert "set -euo pipefail" in wf_text(), \
        "set -euo pipefail が無い（途中の失敗を無視して force-push まで到達しうる）"


def test_orphan_commit_recipe():
    t = wf_text()
    for needle in ("git checkout -q --orphan squash", "git add -A", "[skip ci]"):
        assert needle in t, f"orphan squash の手順 `{needle}` が無い"


def test_bot_identity_matches_collect_workflow():
    # 同じ bot が書いた履歴に見えること（collect.yml が正・ここが追従する）。
    collect = COLLECT.read_text(encoding="utf-8")
    email = re.search(r'git config user\.email "([^"]+)"', collect)
    assert email, "collect.yml から bot の email が読めない（形が変わった）"
    t = wf_text()
    assert 'git config user.name "orbis-bot"' in t, "user.name が orbis-bot でない"
    assert f'git config user.email "{email.group(1)}"' in t, \
        f"user.email が collect.yml と違う（期待: {email.group(1)}）"


def test_tree_assert_precedes_force_push():
    # 本テストの核。tree 一致 assert が --force より **前** にあること。
    t = wf_text()
    assert_idx = t.find('"$newtree" != "$tree"')
    push_idx = t.find("git push --force")
    assert assert_idx != -1, "tree 一致 assert（$newtree != $tree）が無い"
    assert push_idx != -1, "force push 行が無い"
    assert assert_idx < push_idx, \
        "tree assert が force push より後ろにある（壊れた tree を push しうる）"


def test_tree_mismatch_aborts_with_error_annotation():
    t = wf_text()
    assert "::error::" in t, "不一致時の ::error:: 注釈が無い（赤が Actions 上で見えない）"
    assert re.search(r"^\s+exit 1\s*$", t, re.M), "不一致時の exit 1 が無い"


def test_single_push_and_it_targets_orbis_data_main():
    t = wf_text()
    pushes = re.findall(r"^\s*git push.*$", t, re.M)
    assert len(pushes) == 1, f"git push が 1 行でない: {pushes}"
    assert pushes[0].strip() == "git push --force origin HEAD:main", \
        f"push 先/形が想定と違う: {pushes[0].strip()}"


def test_step_summary_records_before_and_after():
    t = wf_text()
    assert "$GITHUB_STEP_SUMMARY" in t, "実行結果のサマリ出力が無い（何を畳んだか後から追えない）"
    assert "before" in t and "after" in t, "サマリに before/after が無い"
```

- [ ] **Step 2: 失敗を確認**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q tests/test_workflow_squash.py
```
Expected（失敗）: 13 件すべて FAILED。要約は `13 failed in 0.0Xs`。各失敗の理由行が
`AssertionError: .github/workflows/squash-data.yml が無い（Step 3 で作る）`。

- [ ] **Step 3: 最小実装**

`.github/workflows/squash-data.yml` を新規作成（全文）:

```yaml
# orbis-data（公開データリポ）の履歴を月次で 1 コミットへ畳む（設計 §3.0・監査所見 DATA-03）。
#
# なぜ必要か: collect 系 workflow は毎 run 新規 checkout で orbis-data に push するため、
# 履歴は単調増加する（2026-09-03 時点 8,552 commits / 968MB）。ダッシュボードが読むのは
# 常に最新の JSON だけで、履歴は誰も使わない。中身（tree）は保ったまま履歴だけ捨てる＝
# 親を持たない orphan コミット 1 本に置き換える。
#
# 安全装置（この 4 つが揃って初めて --force を撃つ）:
#   1. concurrency group を collect と共有 → 収集ジョブと直列化（force-push と通常 push が交差しない）
#   2. workflow_dispatch は confirm に "squash" と入力した時だけ job を実行（Run workflow の誤爆ガード）
#   3. orphan コミットの tree が squash 前の tree と一致することを assert
#      （不一致なら ::error:: を出して exit 1・push しない＝公開データが壊れる経路を塞ぐ）
#   4. permissions: contents: read（この workflow は orbis 側に何も書かない。
#      orbis-data への push 権は PAT secrets.ORBIS_DATA_TOKEN だけが持つ）
#
# 既知の性質: GitHub の表示サイズは到達不能オブジェクトの GC まで減らない（raw 配信は影響なし）。
# collect 系は毎 run 新規 checkout なので新しい root に自然追従する。
name: squash-data

on:
  schedule:
    # 毎月 1 日 03:23 UTC（＝12:23 JST）。外部 dispatch（cron-job.org の :00/:15/:30/:45）と
    # collect cron（:07/:37）を避けた分に置く＝収集と鉢合わせしにくい時刻。
    - cron: '23 3 1 * *'
  workflow_dispatch:
    inputs:
      confirm:
        description: '不可逆です（orbis-data の全履歴が消えます）。実行するなら squash と入力してください。'
        required: true
        type: string

permissions:
  contents: read

concurrency:
  group: collect            # collect.yml / collect-slow.yml と共有＝リポジトリ全体で直列化
  cancel-in-progress: false

jobs:
  squash:
    # schedule は無条件。手動実行は confirm == 'squash' の時だけ（打ち間違いでは動かない）。
    # schedule イベントでは inputs コンテキストが null になり、null.confirm は null を返すので
    # 右辺は false に落ちる（式エラーにはならない）。
    if: github.event_name == 'schedule' || inputs.confirm == 'squash'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout orbis-data (shallow)
        uses: actions/checkout@v6
        with:
          repository: sg55555/orbis-data
          path: data-repo
          token: ${{ secrets.ORBIS_DATA_TOKEN }}
          fetch-depth: 1
          persist-credentials: true

      - name: Squash history into a single orphan commit
        working-directory: data-repo
        run: |
          set -euo pipefail
          git config user.name "orbis-bot"
          git config user.email "210495115+sg55555@users.noreply.github.com"

          before="$(git rev-parse HEAD)"
          tree="$(git rev-parse 'HEAD^{tree}')"
          echo "before=$before"
          echo "tree=$tree"

          # --orphan は index と作業ツリーをそのまま残して親だけ切る。
          # よって add -A → commit で「中身は同じ・履歴だけ無い」1 コミットができる。
          git checkout -q --orphan squash
          git add -A
          git commit -q -m "data: monthly squash $(date -u +%Y-%m-%d) (was $before) [skip ci]"

          after="$(git rev-parse HEAD)"
          newtree="$(git rev-parse 'HEAD^{tree}')"
          if [ "$newtree" != "$tree" ]; then
            echo "::error::tree mismatch: $newtree != $tree — push を中止しました（データが変わっています）"
            exit 1
          fi

          git push --force origin HEAD:main

          {
            echo "### orbis-data monthly squash"
            echo ""
            echo "- before: \`$before\`"
            echo "- after:  \`$after\`"
            echo "- tree:   \`$tree\`（squash 前後で一致）"
          } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 4: 通ることを確認**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q tests/test_workflow_squash.py
```
Expected（PASS）: `13 passed in 0.0Xs`。

続けて既存 workflow テストの巻き込み退行が無いことも見る（`.github/workflows/*.yml` を走査する既存テストがある）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q tests/test_workflow_observability.py tests/test_wf_eligibility.py
```
Expected（PASS）: 両ファイルとも既存件数のまま `N passed`（0 failed）。squash-data.yml は collector を起動する `run` 行を持たないため、`collector_steps_with_layers()` の抽出対象に入らない。

- [ ] **Step 5: コミット**

Run（この 1 ブロックで 1 コミット）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git add .github/workflows/squash-data.yml tests/test_workflow_squash.py && git commit -F - <<'MSG'
feat(ci): orbis-data の月次 squash workflow を追加（B0・DATA-03）

orbis-data の履歴（8,552 commits / 968MB）を月次で orphan コミット 1 本に畳む。
tree 一致 assert が通った時だけ --force push する（不一致なら ::error:: で中止）。

- schedule: 毎月 1 日 03:23 UTC（外部 dispatch と collect cron の隙間）
- workflow_dispatch: confirm に "squash" と入力した時だけ job を実行（誤爆ガード）
- concurrency group を collect と共有し収集ジョブと直列化（push 競合をゼロにする）
- permissions は contents: read（orbis-data への push は PAT のみ）
- tests/test_workflow_squash.py が安全装置 4 点の存在を構造で固定（pyyaml 不使用）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR
MSG
```
Expected: `2 files changed, ...` と表示され、`git log --oneline -1` の 1 行目が `feat(ci): orbis-data の月次 squash workflow を追加（B0・DATA-03）`。

> **Step 6〜8 は親セッションが実行する。サブエージェント／実装者は実行しない。**
> 初回 squash は **手元の clone から force-push しない**（本人決定 2026-09-03）。作った workflow 自身を GitHub 上で 1 回走らせて初回 squash を兼ねる＝安全装置（concurrency・confirm ゲート・tree 一致 assert）を通った経路でしかデータを触らない、という利点もある。
> 実行前に **AskUserQuestion で日本語の再確認**を取る。文面:
> > orbis-data の 8,552 commits を 1 コミットに畳みます。**元に戻す手段はありません**（履歴を復元する方法はない）。ファイルの中身（tree）は変わらず、raw 配信の URL も内容も変わりません。実行しますか。

- [ ] **Step 6: 作業ブランチを origin へ push（親セッションが実行）**

`workflow_dispatch` は「ファイルが存在する ref」を指定して起動する。squash-data.yml はまだ作業ブランチにしか無いので、まずブランチを origin へ通常 push する。

Run（この 1 行で 1 コマンド）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git push -u origin worktree-enterprise-a
```
安全根拠（実行時に日本語で併記する）: 「`git push -u origin worktree-enterprise-a` を実行します。理由：作成した squash-data.yml を GitHub 上で起動できる ref に載せるため。push 先は作業ブランチで、保護ブランチでも main 直 push でもありません。」

Expected: `* [new branch] worktree-enterprise-a -> worktree-enterprise-a`。

- [ ] **Step 7: workflow を dispatch して初回 squash を走らせる（親セッションが実行）**

実行1（この 1 行で 1 コマンド・**不可逆**。AskUserQuestion の承認後だけ）:
```bash
gh workflow run squash-data.yml -R sg55555/orbis --ref worktree-enterprise-a -f confirm=squash
```
Expected: 出力なし（成功時は無言）。

実行2（この 1 行で 1 コマンド・起動した run の id を取る）:
```bash
gh run list -R sg55555/orbis --workflow squash-data.yml --limit 1 --json databaseId --jq '.[0].databaseId'
```
Expected: 数字の run id が 1 行。

実行3（この 1 行で 1 コマンド・`<id>` は実行2の出力に置き換える）:
```bash
gh run watch <id> -R sg55555/orbis --exit-status
```
Expected: 最後に `✓ squash-data ... completed with 'success'` と出て終了コード 0。

失敗した場合の読み分け:
- `could not find any workflows named squash-data.yml` / `Workflow does not have 'workflow_dispatch' trigger` — GitHub は `workflow_dispatch` の登録を**デフォルトブランチ上のファイル**で判定する。作業ブランチにしか無い段階では起動できないことがある。その場合は**ここで無理をせず**、初回 squash を骨格 **Task 11 Step 5**（main へ merge・push した後の dispatch）へ送る。Task 11 Step 5 のコマンドがそのまま初回 squash になる（1 commit を再 squash しても tree は一致するので、後から改めて打っても無害）。
- job が skip された（`This run was skipped` / 実行時間 0 秒） — `if:` の confirm ゲートが効いている。`-f confirm=squash` の綴りを確認する。
- `::error::tree mismatch` で失敗 — **push はされていない**（assert が止めた）。データは無傷。原因を調べるまで再実行しない。

- [ ] **Step 8: 初回 squash の結果を検証（親セッションが実行）**

実行1（この 1 行で 1 コマンド・commits が畳まれたか）:
```bash
gh api -i "repos/sg55555/orbis-data/commits?per_page=1" 2>&1 | grep -i "^link:"
```
Expected: `Link:` ヘッダーが出ない（＝1 ページで終わり＝commits 1 件）か、出ても `rel="last"` の `page=1`〜`page=3`（squash 直後に collect が 1〜2 件足した分）。**4 桁の page が残っていたら squash が効いていない。**

実行2（この 1 行で 1 コマンド・中身が変わっていないか）:
```bash
curl -s https://raw.githubusercontent.com/sg55555/orbis-data/main/manifest.json | head -c 300
```
Expected: dispatch 前に同じコマンドで控えた内容と**同じ層・同じ更新時刻**が並ぶ（squash 前後で内容不変）。dispatch 前にこの 1 行を先に打って出力を控えておくこと。

実行3（この 1 行で 1 コマンド・`<id>` は Step 7 実行2 の run id。workflow が記録した before/after を読む）:
```bash
gh run view <id> -R sg55555/orbis --log | grep -E "before=|tree=|newtree="
```
Expected: `before=<40 桁>` `tree=<40 桁>` が出て、`newtree` は出ないか `tree` と同値（workflow は不一致時のみ `::error::` を出して止まる）。同じ before/after は run のページの Summary 欄（`$GITHUB_STEP_SUMMARY`）にも表形式で残る。

---

### Task 2: A4 静的ページ 5 枚＋`css/pages.css`＋LICENSE＋robots＋README ライセンス節＋index.html フッター＋`test_pages.py`

**Files:**
- Create: `css/pages.css`
- Create: `404.html` `about.html` `terms.html` `privacy.html` `attribution.html`
- Create: `LICENSE` `robots.txt`
- Create（Test）: `tests/test_pages.py`
- Modify: `index.html`（178 行 `</section>`（`#sources` の閉じ）と 179 行 `  </div>`（`#app` の閉じ）の **間** にフッターを挿入。他の行は触らない）
- Modify: `css/orbis.css`（1731 行＝ファイル末尾に `.site-foot` ブロックを追記。既存の `@media` ブロックの外＝トップレベルに置く。**1204〜1352 行の secfit ブロックには触らない**＝`tests/secfit.test.js` が「そのブロック内に radial-gradient を新設していないこと」を走査しており、末尾追記はその範囲外）
- Modify: `README.md`（26 行＝ファイル末尾にライセンス節を追記）

すべて絶対パスの起点は `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/`。

**Interfaces:**
- **Consumes:**
  - `js/ui/sources.js` の `export const SOURCE_MAP`（出典表示名 11 種。`attribution.html` がこの集合を包含する）
  - localStorage の実キー 3 件 — `js/lib/state.js` の `const KEY = 'orbis.enabled.v1'`／`js/lib/feed.js` の `const FEED_FILTER_KEY = 'orbis.feedFilter.v1'`／`js/lib/drilldown/watchlist.js` の `makeWatchlistStore({ storage, key = 'orbis.watchlist' })`。**この 3 つで全部**（`js/**` に他の `localStorage.setItem` は無い。プリセット『概観/紛争/気象/交通』の選択結果は `js/lib/presets.js` が Set を返し `state.js` が `orbis.enabled.v1` に書くので専用キーは無い）
  - `css/orbis.css` の `:root` トークン（`--bg` `--text` `--muted` `--line` `--edge-pad` `--font-word` `--font-display` `--text-bright` `--text-heading` `--text-2` `--text-muted-2` `--text-muted-3` `--cat-link` `--rim-cyan-18` `--aurora-line-cyan` `--glow-cyan-text`）— **pages.css では再定義しない**（`:root` は 1 箇所だけ）
- **Produces:**
  - `404.html` `about.html` `terms.html` `privacy.html` `attribution.html` `robots.txt` — **Task 3 の `builds` に載り `routes` が解決する実ファイル**
  - `css/pages.css` — 上記 5 枚が `<link>` する
  - `.site-foot` / `.foot-links` / `.foot-copy`（`css/orbis.css`）— index.html と 5 ページで共有するクラス名
  - `LICENSE`（MIT・`Copyright (c) 2026 sg55555`）
  - `tests/test_pages.py` — **xfail 3 件**を含む。`test_pages_are_declared_in_vercel_builds` は Task 3 Step 10 が、`test_no_youtube_com_embed_in_served_code` と `test_external_links_are_noopener_noreferrer` は **Task 8（part3）が** マーカーを外す。

設計言語（監修ノート厳守）: ORBIS は**宇宙的/天体的**、主アクセントは**地球の縁の大気ハロ（線と光）**。**サイバーパンク HUD を反射的に足さない**。装飾は **線・グロー・縁**だけで作り、**面（不透明ベタ・radial-gradient）を新設しない**。ページは既存トークンと余白で構成する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_pages.py` を新規作成（全文）:

```python
"""公開の体裁（A4・静的分）＝静的ページ 5 枚・LICENSE・robots.txt・共通フッターの構造テスト（設計 §3.4）。

方針:
- テスト専用の依存を足さない（標準ライブラリ＋pytest だけ）。HTML パーサも使わず
  **配信されるバイト列そのもの**を正規表現で見る。DOM に直すと「`<script>` があるか」
  「`style=` が混じっていないか」という CSP 上の関心がパーサに吸われて消えるため。
- 「ページに何が書いてあるか」は実装（sources.js の SOURCE_MAP・state.js の保存キー）を
  正としてページ側を追従させる。文章を後から足したり層を増やしたりした時、ページが
  黙って嘘になるのを防ぐ。

この時点で **意図的に赤いテスト（xfail strict）が 3 件**ある（時系列の整合）:
- test_pages_are_declared_in_vercel_builds … Task 3 が vercel.json を書いたら緑。Task 3 Step 10 が xfail を外す。
- test_no_youtube_com_embed_in_served_code … Task 8（part3）が youtube-nocookie 化したら緑。Task 8 が xfail を外す。
- test_external_links_are_noopener_noreferrer … Task 8（part3）が rel を直したら緑。Task 8 が xfail を外す。
strict=True なので「まだ直っていないのに緑」も「直したのに xfail のまま」も検出される。
"""
import json
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

PAGES = ["404.html", "about.html", "terms.html", "privacy.html", "attribution.html"]
FOOTED = PAGES + ["index.html"]          # 共通フッターを持つ全 HTML
FOOT_LINKS = ["/about", "/terms", "/privacy", "/attribution"]
COPYRIGHT = "© 2026 sg55555 · 非商用・個人運営"
AI_CRAWLERS = ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot",
               "Google-Extended", "Applebot-Extended", "Bytespider", "PerplexityBot"]

STYLE_ATTR = re.compile(r"(?<![\w-])style\s*=")
ON_ATTR = re.compile(r"(?<![\w-])on[a-z]+\s*=")


def read(rel):
    p = ROOT / rel
    assert p.is_file(), f"{rel} が無い"
    return p.read_text(encoding="utf-8")


def source_map_names():
    """js/ui/sources.js の SOURCE_MAP から出典表示名の集合を取り出す（実装が正）。"""
    js = read("js/ui/sources.js")
    m = re.search(r"export const SOURCE_MAP\s*=\s*\{(.*?)\n\};", js, re.S)
    assert m, "SOURCE_MAP ブロックが見つからない（sources.js の形が変わった）"
    names = {n for n in re.findall(r"source:\s*'([^']*)'", m.group(1)) if n}
    assert names, "SOURCE_MAP から出典名が 1 つも取れない"
    return names


def storage_keys():
    """js/** で実際に localStorage に書かれているキー名の集合（実装が正）。"""
    keys = set()
    for p in sorted((ROOT / "js").rglob("*.js")):
        keys |= set(re.findall(r"""['"](orbis\.[A-Za-z0-9_.]+)['"]""", p.read_text(encoding="utf-8")))
    assert keys, "js/** から orbis.* の保存キーが 1 つも取れない"
    return keys


# ── ページの存在と純静的性 ─────────────────────────────────────
@pytest.mark.parametrize("page", PAGES)
def test_page_exists(page):
    assert (ROOT / page).is_file(), f"{page} が無い"


@pytest.mark.parametrize("page", PAGES)
def test_page_has_no_script(page):
    # 純静的＝JS を 1 行も持たない。CSP の script-src 'self' 以前に、そもそも実行するものが無い。
    assert "<script" not in read(page), f"{page} に <script> がある（純静的でない）"


@pytest.mark.parametrize("page", PAGES)
def test_page_has_no_inline_style_or_handler(page):
    html = read(page)
    assert not STYLE_ATTR.search(html), f"{page} に style= がある（style-src 'self' で落ちる）"
    assert not ON_ATTR.search(html), f"{page} に on*= のイベント属性がある"
    assert "<style" not in html, f"{page} に <style> がある"
    assert "javascript:" not in html, f"{page} に javascript: がある"


@pytest.mark.parametrize("page", PAGES)
def test_page_links_shared_and_page_stylesheets(page):
    html = read(page)
    assert '<link rel="stylesheet" href="/css/orbis.css" />' in html, \
        f"{page} が css/orbis.css を読んでいない（トークンが効かない）"
    assert '<link rel="stylesheet" href="/css/pages.css" />' in html, \
        f"{page} が css/pages.css を読んでいない"


@pytest.mark.parametrize("page", PAGES)
def test_page_has_lang_and_title(page):
    html = read(page)
    assert '<html lang="ja">' in html, f"{page} に lang=ja が無い"
    m = re.search(r"<title>(.*?)</title>", html)
    assert m and m.group(1).strip(), f"{page} に <title> が無い"
    assert "ORBIS" in m.group(1), f"{page} の <title> に ORBIS が無い: {m.group(1)}"


# ── 共通フッター ───────────────────────────────────────────
@pytest.mark.parametrize("page", FOOTED)
def test_page_has_footer_with_four_links(page):
    html = read(page)
    assert '<footer class="site-foot">' in html, f"{page} に共通フッターが無い"
    for href in FOOT_LINKS:
        assert f'href="{href}"' in html, f"{page} のフッターに {href} へのリンクが無い"


@pytest.mark.parametrize("page", FOOTED)
def test_page_has_copyright_line(page):
    assert COPYRIGHT in read(page), f"{page} に著作権表示「{COPYRIGHT}」が無い"


def test_404_page_offers_a_way_back():
    html = read("404.html")
    assert "ORBIS へ戻る" in html, "404.html に「ORBIS へ戻る」導線が無い"
    assert 'href="/"' in html, "404.html にトップへのリンクが無い"
    assert "404" in html and "見つかりません" in html, "404.html に 404 の見出しが無い"


# ── attribution が実装（SOURCE_MAP）を漏れなく覆う ─────────────────
def test_attribution_covers_every_source_map_name():
    html = read("attribution.html")
    missing = sorted(n for n in source_map_names() if n not in html)
    assert missing == [], f"attribution.html に出典名が無い: {missing}"


def test_attribution_lists_third_party_licenses():
    html = read("attribution.html")
    for needle in (
        "CC BY-SA 4.0",            # Wikipedia（ja）＋本サイトのプロフィール本文
        "AI により要約/再構成",     # 再構成の明示（CC BY-SA の改変告知）
        "CC0",                     # Wikidata
        "ODbL",                    # OpenStreetMap / OpenMapTiles / OpenFreeMap
        "OpenFreeMap",
        "OpenMapTiles",
        "OpenStreetMap contributors",
        "CC BY 4.0",               # Open-Meteo
        "SIL Open Font License",   # Orbitron / Saira
        "Orbitron",
        "Saira",
        "MapLibre",
        "BSD 3-Clause",            # MapLibre GL JS
        "deck.gl",
        "MIT",                     # deck.gl と ORBIS 自身のコード
    ):
        assert needle in html, f"attribution.html に「{needle}」が無い"


# ── about / terms / privacy の必須項目 ───────────────────────────
def test_about_states_operator_and_contact():
    html = read("about.html")
    assert "sg55555" in html, "about に運営者名が無い"
    assert "個人" in html and "非商用" in html, "about に個人・非商用の明示が無い"
    assert "https://github.com/sg55555/orbis/issues" in html, "about に連絡先（GitHub Issues）が無い"
    assert "GitHub Actions" in html, "about に更新の仕組みの説明が無い"


def test_terms_has_disclaimer_and_governing_law():
    html = read("terms.html")
    for needle in ("免責", "保証", "AI", "推定", "投資", "避難", "禁止", "日本法"):
        assert needle in html, f"terms に「{needle}」の記載が無い"


def test_privacy_lists_every_actual_storage_key():
    html = read("privacy.html")
    missing = sorted(k for k in storage_keys() if k not in html)
    assert missing == [], f"privacy.html に localStorage の実キーが無い: {missing}"


def test_privacy_lists_external_destinations():
    html = read("privacy.html")
    for needle in (
        "raw.githubusercontent.com",   # データ取得
        "tiles.openfreemap.org",       # 地図タイル
        "youtube-nocookie.com",        # 埋め込み再生（Task 8 でコード側も一致する）
        "i.ytimg.com",                 # カメラのサムネイル
        "localhost:8900",              # AI 字幕（端末内のみ）
        "Vercel",                      # サーバー側アクセスログ
        "Cookie",                      # 使っていないことの明示
    ):
        assert needle in html, f"privacy.html に外部送信先「{needle}」の記載が無い"
    assert "外部には送信しません" in html, "privacy.html に AI 字幕がローカル完結である明示が無い"


# ── LICENSE / robots / README ────────────────────────────────
def test_license_is_mit_for_sg55555():
    text = read("LICENSE")
    assert "MIT License" in text, "LICENSE が MIT でない"
    assert "Copyright (c) 2026 sg55555" in text, "LICENSE の著作権表示が違う"
    assert "WITHOUT WARRANTY OF ANY KIND" in text, "LICENSE 本文が欠けている"


def test_readme_has_license_section():
    text = read("README.md")
    assert re.search(r"^## ライセンス\s*$", text, re.M), "README にライセンス節が無い"
    assert "MIT" in text and "attribution" in text, "README のライセンス節が不完全"


def test_robots_allows_search_engines():
    text = read("robots.txt")
    assert re.search(r"^User-agent: \*\s*$", text, re.M), "robots.txt に User-agent: * が無い"
    assert re.search(r"^Allow: /\s*$", text, re.M), "robots.txt に Allow: / が無い（公開サイトなので検索は許可）"


@pytest.mark.parametrize("bot", AI_CRAWLERS)
def test_robots_blocks_ai_training_crawler(bot):
    text = read("robots.txt")
    m = re.search(rf"^User-agent: {re.escape(bot)}\s*\nDisallow: /\s*$", text, re.M)
    assert m, f"robots.txt が {bot} を Disallow していない"


def test_robots_has_no_sitemap_line():
    # sitemap は作らない（生成する仕組みが無いのに宣言すると 404 を配ることになる）。
    assert "Sitemap" not in read("robots.txt"), "robots.txt に Sitemap 行がある"


# ── CSS（共有トークンの再定義禁止・面禁則） ─────────────────────────
def test_pages_css_reuses_tokens_without_redefining_them():
    css = read("css/pages.css")
    for sel in ("body.page", ".page-wrap", ".page-top", ".page-h"):
        assert sel in css, f"css/pages.css に {sel} が無い"
    assert ":root" not in css, "css/pages.css が :root を再定義している（トークンは orbis.css の 1 箇所だけ）"
    assert "@import" not in css, "css/pages.css が @import している（<link> で共有する方針）"
    assert "radial-gradient" not in css, "css/pages.css が面（radial-gradient）を新設している（面禁則）"


def test_site_foot_style_lives_in_orbis_css():
    # index.html は orbis.css しか読まないので .site-foot は orbis.css 側に無いと素の <footer> になる。
    css = read("css/orbis.css")
    assert re.search(r"^\.site-foot\s*\{", css, re.M), "css/orbis.css に .site-foot 規則が無い"
    assert ".foot-links" in css and ".foot-copy" in css, "css/orbis.css にフッター子要素の規則が無い"


# ── 時系列の整合（後続タスクで緑になる） ───────────────────────────
@pytest.mark.xfail(strict=True, reason="Task 3 が vercel.json に builds を書いたら緑（Task 3 Step 10 でこの行を削除する）")
def test_pages_are_declared_in_vercel_builds():
    cfg = json.loads(read("vercel.json"))
    built = {b["src"] for b in cfg.get("builds", [])}
    missing = sorted(p for p in PAGES + ["robots.txt"] if p not in built)
    assert missing == [], f"vercel.json の builds に無い＝配信されない: {missing}"


@pytest.mark.xfail(strict=True, reason="Task 8（part3）が youtube-nocookie 化したら緑（Task 8 でこの行を削除する）")
def test_no_youtube_com_embed_in_served_code():
    hits = []
    for p in [ROOT / "index.html"] + sorted((ROOT / "js").rglob("*.js")):
        if "youtube.com/embed" in p.read_text(encoding="utf-8"):
            hits.append(p.relative_to(ROOT).as_posix())
    assert hits == [], f"youtube.com/embed が残っている（youtube-nocookie.com にする）: {hits}"


@pytest.mark.xfail(strict=True, reason="Task 8（part3）が rel を noopener noreferrer にしたら緑（Task 8 でこの行を削除する）")
def test_external_links_are_noopener_noreferrer():
    hits = []
    for p in [ROOT / "index.html"] + sorted((ROOT / "js").rglob("*.js")):
        src = p.read_text(encoding="utf-8")
        for m in re.finditer(r'rel="([^"]*)"', src):
            rel = m.group(1).split()
            if "noopener" in rel and "noreferrer" not in rel:
                hits.append(f"{p.relative_to(ROOT).as_posix()}: rel=\"{m.group(1)}\"")
    assert hits == [], f"rel に noreferrer が無い外部リンク: {hits}"
```

- [ ] **Step 2: 失敗を確認**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q tests/test_pages.py
```
Expected（失敗）: `404.html が無い` / `about.html が無い` / `LICENSE が無い` / `robots.txt が無い` / `css/pages.css が無い` などで **多数 FAILED**（要約はおおむね `36 failed, 3 xfailed`）。`index.html` を読む 2 件（フッター・著作権）は「共通フッターが無い」で FAILED。xfail 3 件は **xfailed**（＝まだ直っていない、が期待どおり）。

- [ ] **Step 3: 最小実装 A — `css/pages.css`**

`css/pages.css` を新規作成（全文）:

```css
/* 静的ページ（404 / about / terms / privacy / attribution）の共通スタイル。
 *
 * トークン（--bg / --text / --rim-cyan-18 …）は css/orbis.css の :root を共有する。
 * 各ページが orbis.css と pages.css の **両方**を <link> する前提で、ここでは
 * :root を再定義しない（@import もしない＝1 ファイル 1 責務・二重定義の drift を作らない）。
 *
 * 設計言語（監修ノート）: 宇宙的/天体的・主アクセントは地球の縁の大気ハロ＝線と光。
 * サイバーパンク HUD を足さない。面（不透明ベタ・radial-gradient）を新設しない。
 * ここで使う装飾は「1px の線」「淡い text-shadow」「余白」だけ。
 */

body.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, "Segoe UI", sans-serif;
  line-height: 1.9;
}

.page-wrap {
  flex: 1;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 44px var(--edge-pad) 72px;
}

/* ワードマーク行＝地平線の 1 本線で本文と分ける */
.page-top {
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--rim-cyan-18);
}
.page-word {
  font-family: var(--font-word);
  font-size: 17px;
  font-weight: 500;
  letter-spacing: .34em;
  color: var(--text-bright);
  text-decoration: none;
  text-shadow: 0 0 18px var(--glow-cyan-text);
}
.page-back {
  margin-left: auto;
  font-size: 12px;
  color: var(--cat-link);
  text-decoration: none;
}
.page-back:hover { text-decoration: underline; }

.page-h {
  margin: 40px 0 6px;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 600;
  letter-spacing: .03em;
  color: var(--text-heading);
}
.page-sub {
  margin: 0 0 36px;
  font-size: 12px;
  color: var(--text-muted-3);
}

/* 見出しの前に短い光の線を引く（HUD の枠や記号は使わない） */
.page-wrap h2 {
  margin: 38px 0 10px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: .05em;
  color: var(--text-heading);
}
.page-wrap h2::before {
  content: "";
  display: block;
  width: 34px;
  height: 1px;
  margin-bottom: 12px;
  background: linear-gradient(90deg, var(--aurora-line-cyan), transparent);
}

.page-wrap p { margin: 10px 0; font-size: 13.5px; color: var(--text-2); }
.page-wrap ul { margin: 10px 0; padding-left: 1.2em; }
.page-wrap li { margin: 5px 0; font-size: 13.5px; color: var(--text-2); }
.page-wrap a { color: var(--cat-link); }
.page-wrap code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  color: var(--text-chip);
}

/* 出典の定義リスト（attribution） */
.attrib { margin: 12px 0 0; }
.attrib dt {
  margin-top: 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}
.attrib dd {
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--text-muted-2);
}

.page-note { margin-top: 10px; font-size: 12px; color: var(--muted); }
.page-updated { margin-top: 44px; font-size: 11.5px; color: var(--muted); }

/* 404 は本文が短いので視線の高さに置く（装飾は足さない） */
.page-wrap.is-404 { display: flex; flex-direction: column; justify-content: center; min-height: 66vh; }
.page-404-code {
  margin: 24px 0 2px;
  font-family: var(--font-word);
  font-size: 46px;
  letter-spacing: .18em;
  color: var(--text-bright);
  text-shadow: 0 0 26px var(--glow-cyan-text);
}

@media (max-width: 768px) {
  .page-wrap { padding: 32px 16px 56px; }
  .page-h { font-size: 22px; }
  .page-404-code { font-size: 36px; }
}
```

- [ ] **Step 4: 最小実装 B — `404.html`**

`404.html` を新規作成（全文）:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>404 — ORBIS</title>
  <meta name="theme-color" content="#05080f" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="stylesheet" href="/css/orbis.css" />
  <link rel="stylesheet" href="/css/pages.css" />
</head>
<body class="page">
  <main class="page-wrap is-404">
    <div class="page-top">
      <a class="page-word" href="/">ORBIS</a>
      <a class="page-back" href="/">← ダッシュボードへ戻る</a>
    </div>
    <p class="page-404-code">404</p>
    <h1 class="page-h">ページが見つかりません</h1>
    <p>お探しの URL は存在しないか、移動または削除されました。アドレスの綴りをご確認ください。</p>
    <ul>
      <li><a href="/">ORBIS へ戻る</a>（世界リアルタイム監視ダッシュボード）</li>
      <li><a href="/about">このサイトについて</a></li>
    </ul>
  </main>
  <footer class="site-foot">
    <nav class="foot-links" aria-label="サイト情報">
      <a href="/about">このサイトについて</a>
      <a href="/terms">利用条件・免責</a>
      <a href="/privacy">プライバシー</a>
      <a href="/attribution">出典・ライセンス</a>
    </nav>
    <p class="foot-copy">© 2026 sg55555 · 非商用・個人運営</p>
  </footer>
</body>
</html>
```

- [ ] **Step 5: 最小実装 C — `about.html`**

`about.html` を新規作成（全文）:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>このサイトについて — ORBIS</title>
  <meta name="theme-color" content="#05080f" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="stylesheet" href="/css/orbis.css" />
  <link rel="stylesheet" href="/css/pages.css" />
</head>
<body class="page">
  <main class="page-wrap">
    <div class="page-top">
      <a class="page-word" href="/">ORBIS</a>
      <a class="page-back" href="/">← ダッシュボードへ戻る</a>
    </div>
    <h1 class="page-h">このサイトについて</h1>
    <p class="page-sub">ORBIS — 世界リアルタイム監視ダッシュボード</p>

    <h2>ORBIS とは</h2>
    <p>ORBIS は、無料で公開されている OSINT（公開情報）を 1 枚の地球儀にまとめて眺めるための個人プロジェクトです。地震・航空機・船舶・紛争と抗議・火災・海面水温・気温・ニュースなどを、それぞれの公開データ源から定期的に取得し、日本語のインターフェースで表示します。</p>
    <p>誰でもアクセスでき、ログインもアカウント登録も必要ありません。閲覧専用で、書き込みや投稿の機能はありません。</p>

    <h2>何を表示しているか</h2>
    <ul>
      <li>地図上のレイヤー（地震・航空・船舶・紛争・抗議・火災・海流・貿易ルート・海面水温・気温・ニュース）</li>
      <li>下部のライブメディア（ニュース配信とライブカメラの埋め込み）</li>
      <li>AI が合成する 3 つのセクション（ワールド・ブリーフィング／国家不安定性インデックス／AI 予測）</li>
      <li>国を選んだときのドリルダウン（国別の集計と、Wikipedia 由来のプロフィール）</li>
    </ul>
    <p>各レイヤーの出典とライセンスは <a href="/attribution">出典・ライセンス</a> に一覧があります。</p>

    <h2>更新の仕組み</h2>
    <p>データの取得は GitHub Actions のスケジュール実行で行い、取得した JSON は公開リポジトリ <code>sg55555/orbis-data</code> に保存されます。ブラウザはそのリポジトリの生ファイルを直接読みます。層ごとの最終更新時刻は、画面右上の鮮度表示と最下部の「データソース &amp; 鮮度」で確認できます。</p>
    <p>取得の間隔は層ごとに異なり、上流の障害や制限で更新が止まることもあります。<strong>表示されている時刻が、最後に更新できた時刻</strong>です。古いままの層は「更新停止中」と表示します。</p>

    <h2>AI 分析について（現在は停止中）</h2>
    <p>ワールド・ブリーフィング／国家不安定性インデックス／AI 予測の 3 つは、収集済みのデータを入力に生成 AI（Anthropic Claude）が文章を書いています。<strong>現在この 3 層の自動更新は費用の都合で停止しており、表示されているのは停止時点の内容です。</strong>そのため各セクションには最終更新時刻と、AI 生成である旨の注記を表示しています。</p>
    <p>AI が書いた文章は要約・推定であり、誤りを含むことがあります。詳しくは <a href="/terms">利用条件・免責</a> をご覧ください。</p>

    <h2>運営者と連絡先</h2>
    <p>運営者は <strong>sg55555</strong>（個人）です。個人が趣味で運営している非商用のサイトで、広告も課金もありません。法人・団体とは関係ありません。</p>
    <p>不具合の報告・データの誤りの指摘・削除の依頼などは GitHub Issues でお願いします。<br />
      <a href="https://github.com/sg55555/orbis/issues" target="_blank" rel="noopener noreferrer">https://github.com/sg55555/orbis/issues ↗</a></p>

    <h2>ソースコード</h2>
    <p>ソースコードは MIT ライセンスで公開しています（<a href="https://github.com/sg55555/orbis" target="_blank" rel="noopener noreferrer">github.com/sg55555/orbis ↗</a>）。データそのものの権利は各上流に帰属します。</p>
  </main>
  <footer class="site-foot">
    <nav class="foot-links" aria-label="サイト情報">
      <a href="/about">このサイトについて</a>
      <a href="/terms">利用条件・免責</a>
      <a href="/privacy">プライバシー</a>
      <a href="/attribution">出典・ライセンス</a>
    </nav>
    <p class="foot-copy">© 2026 sg55555 · 非商用・個人運営</p>
  </footer>
</body>
</html>
```

- [ ] **Step 6: 最小実装 D — `terms.html`**

`terms.html` を新規作成（全文）:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>利用条件・免責 — ORBIS</title>
  <meta name="theme-color" content="#05080f" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="stylesheet" href="/css/orbis.css" />
  <link rel="stylesheet" href="/css/pages.css" />
</head>
<body class="page">
  <main class="page-wrap">
    <div class="page-top">
      <a class="page-word" href="/">ORBIS</a>
      <a class="page-back" href="/">← ダッシュボードへ戻る</a>
    </div>
    <h1 class="page-h">利用条件・免責</h1>
    <p class="page-sub">本ページは ORBIS（以下「本サイト」）の利用条件です。本サイトを利用した時点で、以下に同意したものとみなします。</p>

    <h2>1. 位置づけ</h2>
    <p>本サイトは個人が非商用で運営する、無料の情報表示サイトです。公開されているデータを集約して表示するだけの閲覧専用サービスであり、利用者に対する契約上の役務提供やサポートを約束するものではありません。予告なく内容の変更・中断・終了を行うことがあります。</p>

    <h2>2. 免責（正確性・完全性）</h2>
    <p>本サイトの表示内容は、外部の公開データ源から取得した情報を機械的に加工したものです。運営者は、その正確性・完全性・最新性・特定目的への適合性について、明示・黙示を問わず<strong>いかなる保証も行いません</strong>。上流の障害・仕様変更・取得の失敗により、データが古いまま表示されたり、欠落したり、誤った値が表示されることがあります。</p>
    <p>本サイトの利用または利用不能から生じたいかなる損害についても、運営者は責任を負いません。</p>

    <h2>3. AI が生成した文章について</h2>
    <p>ワールド・ブリーフィング／国家不安定性インデックス／AI 予測、および国プロフィールの説明文は、生成 AI が要約・再構成した文章です。これらは<strong>要約であり推定</strong>であって、事実と異なる記述を含むことがあります。各表示には AI 生成である旨と生成時刻を併記しています。重要な判断に用いる前に、必ず一次情報をご確認ください。</p>

    <h2>4. 用途の制限</h2>
    <p>本サイトの情報を、次のような<strong>結果が重大な意思決定の唯一の根拠として使わないでください</strong>。</p>
    <ul>
      <li>人命・安全に関わる判断（避難、渡航、救助、航行・運航の判断など）</li>
      <li>投資・取引その他の経済的な判断</li>
      <li>報道・公表・法的手続における事実認定</li>
    </ul>
    <p>船舶・航空機の位置、海流や貿易ルートの線は概略であり、航行・運航の用途には使えません。</p>

    <h2>5. 禁止事項</h2>
    <ul>
      <li>本サイトおよび上流データ源に過度の負荷をかける行為（短時間の大量リクエスト、自動巡回による大量取得など）</li>
      <li>本サイトを経由して上流データ源の利用規約に違反する取得を行うこと</li>
      <li>法令に違反する行為、第三者の権利を侵害する行為</li>
      <li>表示内容を、出典と AI 生成の別を隠したまま再配布すること</li>
    </ul>

    <h2>6. 知的財産と再配布</h2>
    <p>本サイトのソースコードは MIT ライセンスで公開しています。<strong>表示されるデータの権利は各上流に帰属し、再配布は各上流のライセンス・利用規約に従ってください。</strong>層ごとの出典と条件は <a href="/attribution">出典・ライセンス</a> に一覧があります。国プロフィールの本文は Wikipedia（日本語版）を要約・再構成したもので、CC BY-SA 4.0 で提供します。</p>

    <h2>7. 準拠法</h2>
    <p>本利用条件は<strong>日本法</strong>に準拠し、日本法に従って解釈されます。本サイトの利用に関して疑義や紛争が生じた場合は、まず下記の連絡先へご連絡ください。誠実に協議のうえ解決を図ります。</p>

    <h2>8. 変更の告知</h2>
    <p>本利用条件は必要に応じて変更します。変更後の内容は<strong>本ページの掲載をもって告知</strong>とし、掲載時点から適用します。重要な変更については、あわせて GitHub リポジトリのコミット履歴に記録します。</p>

    <h2>9. 連絡先</h2>
    <p>運営者: sg55555（個人・非商用）<br />
      連絡先: <a href="https://github.com/sg55555/orbis/issues" target="_blank" rel="noopener noreferrer">https://github.com/sg55555/orbis/issues ↗</a></p>
  </main>
  <footer class="site-foot">
    <nav class="foot-links" aria-label="サイト情報">
      <a href="/about">このサイトについて</a>
      <a href="/terms">利用条件・免責</a>
      <a href="/privacy">プライバシー</a>
      <a href="/attribution">出典・ライセンス</a>
    </nav>
    <p class="foot-copy">© 2026 sg55555 · 非商用・個人運営</p>
  </footer>
</body>
</html>
```

- [ ] **Step 7: 最小実装 E — `privacy.html`**

`privacy.html` を新規作成（全文）。**localStorage の 3 キーは `js/lib/state.js`・`js/lib/feed.js`・`js/lib/drilldown/watchlist.js` の実キー名**（テストが実装から grep して突合する）:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>プライバシー — ORBIS</title>
  <meta name="theme-color" content="#05080f" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="stylesheet" href="/css/orbis.css" />
  <link rel="stylesheet" href="/css/pages.css" />
</head>
<body class="page">
  <main class="page-wrap">
    <div class="page-top">
      <a class="page-word" href="/">ORBIS</a>
      <a class="page-back" href="/">← ダッシュボードへ戻る</a>
    </div>
    <h1 class="page-h">プライバシー</h1>
    <p class="page-sub">ORBIS が何を保存し、どこへ通信するかの説明です。</p>

    <h2>収集しない情報</h2>
    <p>本サイトは、アカウント登録・ログインを行いません。<strong>Cookie を発行せず、アクセス解析ツール・広告タグ・トラッキングピクセルの類も一切設置していません。</strong>氏名・メールアドレス・電話番号などの個人情報を、フォーム等で収集する機能はありません。</p>

    <h2>ブラウザに保存される情報</h2>
    <p>表示設定を次の画面でも保つため、<strong>お使いのブラウザの localStorage</strong> に以下の 3 項目を保存します。いずれも運営者のサーバーへは送信されず、この端末のブラウザの中だけに残ります。</p>
    <ul>
      <li><code>orbis.enabled.v1</code> — 表示中のレイヤーの ON/OFF（プリセット「概観・紛争・気象・交通」を選んだ結果もこの項目に入ります）</li>
      <li><code>orbis.feedFilter.v1</code> — 右側のイベントフィードで非表示にしているカテゴリ</li>
      <li><code>orbis.watchlist</code> — 国ドリルダウンのウォッチリスト（国コードの配列）</li>
    </ul>
    <p>また、オフラインでも画面が開けるように Service Worker が<strong>同一オリジンの静的ファイル（HTML・CSS・JavaScript）を Cache Storage に保存</strong>します。閲覧内容や操作の記録は含みません。</p>
    <p>これらを消すには、ブラウザの設定で本サイトのサイトデータ（localStorage・キャッシュ）を削除してください。ホーム画面に追加したアプリ（PWA）として使っている場合は、そのアプリを削除しても消えます。</p>

    <h2>外部への通信</h2>
    <p>本サイトを開くと、ブラウザは次の外部サービスへ直接リクエストを送ります。いずれの送信先にも、本サイトから利用者を識別する情報を渡していません（各サービス側でアクセス元の IP アドレスや User-Agent が記録される可能性はあります）。</p>
    <ul>
      <li><code>raw.githubusercontent.com</code>（GitHub） — 監視データ（JSON / GeoJSON）の取得。ページを開いている間、定期的に取得します。</li>
      <li><code>tiles.openfreemap.org</code>（OpenFreeMap） — 地図のタイル・フォントグリフ・スプライトの取得。地図を表示・操作したときに送られます。</li>
      <li><code>www.youtube-nocookie.com</code>（YouTube / Google） — ニュース配信とライブカメラの埋め込み再生。該当パネルを開いたときにだけ読み込まれます。Cookie を使わない埋め込みドメインを使用していますが、再生後の扱いは <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google のプライバシーポリシー ↗</a> に従います。</li>
      <li><code>i.ytimg.com</code>（YouTube） — ライブカメラ一覧のサムネイル画像。</li>
      <li><code>localhost:8900</code>（この端末の中） — 「AI 字幕（日本語）」を ON にしたときだけ、タブの音声をこの端末で動く変換サーバーへ送ります。<strong>外部には送信しません。</strong>変換サーバーを起動していない場合、この機能は動作しません。</li>
    </ul>

    <h2>サーバー側のログ</h2>
    <p>本サイトは <strong>Vercel</strong> のホスティングで配信しています。Vercel には、配信基盤の標準的なアクセスログ（アクセス日時・IP アドレス・User-Agent・リクエスト URL など）が記録されます。運営者はこれを障害調査の目的でのみ参照し、他の情報と突き合わせて個人を特定することはしません。</p>

    <h2>子どもの利用</h2>
    <p>本サイトは個人情報を収集しないため、年齢による制限は設けていません。表示内容には紛争・災害に関する情報が含まれます。</p>

    <h2>変更と連絡先</h2>
    <p>本ページの内容は必要に応じて変更し、変更後の内容は本ページの掲載をもって告知とします。お問い合わせは <a href="https://github.com/sg55555/orbis/issues" target="_blank" rel="noopener noreferrer">https://github.com/sg55555/orbis/issues ↗</a> へお願いします。</p>
  </main>
  <footer class="site-foot">
    <nav class="foot-links" aria-label="サイト情報">
      <a href="/about">このサイトについて</a>
      <a href="/terms">利用条件・免責</a>
      <a href="/privacy">プライバシー</a>
      <a href="/attribution">出典・ライセンス</a>
    </nav>
    <p class="foot-copy">© 2026 sg55555 · 非商用・個人運営</p>
  </footer>
</body>
</html>
```

> 注（実装者向け）: 上の `www.youtube-nocookie.com` は **Task 8（part3）でコード側（`js/ui/media.js`）が実際に nocookie ドメインへ切り替わる**ことを前提にした記述。Task 2 と Task 8 は同じ merge で出荷されるので本番で不整合にはならないが、**Task 8 を落として merge してはならない**。

- [ ] **Step 8: 最小実装 F — `attribution.html`**

`attribution.html` を新規作成（全文）。**`<dt>` の出典名は `js/ui/sources.js` の `SOURCE_MAP` と 1 文字も違えてはならない**（テストが集合の包含を見る。全角の `＋` と `（）`、`厳選RSS → AI日本語訳` の半角スペースに注意）:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>出典・ライセンス — ORBIS</title>
  <meta name="theme-color" content="#05080f" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="stylesheet" href="/css/orbis.css" />
  <link rel="stylesheet" href="/css/pages.css" />
</head>
<body class="page">
  <main class="page-wrap">
    <div class="page-top">
      <a class="page-word" href="/">ORBIS</a>
      <a class="page-back" href="/">← ダッシュボードへ戻る</a>
    </div>
    <h1 class="page-h">出典・ライセンス</h1>
    <p class="page-sub">ORBIS が表示するデータの出典と、その利用条件の一覧です。</p>

    <h2>監視データ（地図レイヤー）</h2>
    <dl class="attrib">
      <dt>地震 — USGS</dt>
      <dd>U.S. Geological Survey / Earthquake Hazards Program。米国政府の著作物としてパブリックドメインで提供されています。
        <a href="https://earthquake.usgs.gov" target="_blank" rel="noopener noreferrer">earthquake.usgs.gov ↗</a></dd>

      <dt>航空 — OpenSky Network</dt>
      <dd>OpenSky Network の公開 API。同ネットワークの利用条件に従い、非商用の研究・教育目的で利用しています。
        <a href="https://opensky-network.org" target="_blank" rel="noopener noreferrer">opensky-network.org ↗</a></dd>

      <dt>紛争・抗議 — GDELT Project</dt>
      <dd>The GDELT Project（GDELT 2.0 Event Database）。同プロジェクトの利用条件に従います。表示しているのはイベントの位置・件数・トーンの集計であり、報道本文は含みません。
        <a href="https://www.gdeltproject.org" target="_blank" rel="noopener noreferrer">gdeltproject.org ↗</a></dd>

      <dt>船舶 — AISStream</dt>
      <dd>AISStream.io が中継する AIS 電文。同サービスの利用条件に従います。表示位置は概略で、航行の用途には使えません。
        <a href="https://aisstream.io" target="_blank" rel="noopener noreferrer">aisstream.io ↗</a></dd>

      <dt>火災 — NASA FIRMS</dt>
      <dd>NASA FIRMS（Fire Information for Resource Management System）／MODIS・VIIRS 熱異常検知。NASA のデータ利用方針に従います。
        <a href="https://firms.modaps.eosdis.nasa.gov" target="_blank" rel="noopener noreferrer">firms.modaps.eosdis.nasa.gov ↗</a></dd>

      <dt>海面水温 — Open-Meteo Marine</dt>
      <dd>Open-Meteo Marine Weather API。<strong>CC BY 4.0</strong> で提供されています。
        <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer">open-meteo.com ↗</a></dd>

      <dt>気温 — Open-Meteo</dt>
      <dd>Open-Meteo Weather API。<strong>CC BY 4.0</strong> で提供されています。
        <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer">open-meteo.com ↗</a></dd>

      <dt>ニュース — 厳選RSS → AI日本語訳</dt>
      <dd>各報道機関が公開する RSS フィードから見出しと要旨のみを取得し、生成 AI で日本語に要約しています。<strong>本文は転載していません。</strong>見出し・記事の著作権は各媒体に帰属します。表示から必ず出典媒体へリンクします。</dd>

      <dt>海流・貿易ルート — 静的データ（編集）</dt>
      <dd>公開情報をもとに本サイトで作成した静的な GeoJSON です。主要な流れ・航路の<strong>概略</strong>を示すもので、実測値ではなく、航行・運航の判断には使えません。</dd>
    </dl>

    <h2>AI が合成するセクション</h2>
    <dl class="attrib">
      <dt>ワールド・ブリーフィング — AI合成（Claude）</dt>
      <dd>上記の各データを入力に、Anthropic Claude が生成した日本語の要約です。要約・推定であり誤りを含むことがあります。生成時刻は各セクションに表示します。</dd>

      <dt>国家不安定性インデックス／AI 予測 — AI合成（Claude）＋決定論スコア</dt>
      <dd>スコアと順位は収集済みデータから決定論的に計算した数値で、AI は説明文だけを書いています。説明文は要約・推定であり、スコアの妥当性を保証するものではありません。</dd>
    </dl>

    <h2>地図</h2>
    <ul>
      <li>タイル配信: <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap ↗</a></li>
      <li>タイルスキーマ: <a href="https://openmaptiles.org" target="_blank" rel="noopener noreferrer">OpenMapTiles ↗</a></li>
      <li>地図データ: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors ↗</a> — <strong>ODbL</strong>（Open Database License）</li>
    </ul>

    <h2>国プロフィール（ドリルダウン）</h2>
    <ul>
      <li>説明文: <a href="https://ja.wikipedia.org" target="_blank" rel="noopener noreferrer">Wikipedia 日本語版 ↗</a> — <strong>CC BY-SA 4.0</strong>。本サイトの説明文は、Wikipedia の記事を<strong>AI により要約/再構成</strong>したもの（＝改変あり）です。したがって本サイトのプロフィール本文も同じ <strong>CC BY-SA 4.0</strong> で提供します。
        <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" target="_blank" rel="noopener noreferrer">ライセンス全文 ↗</a></li>
      <li>構造化データ（人口・面積・元首など）: <a href="https://www.wikidata.org" target="_blank" rel="noopener noreferrer">Wikidata ↗</a> — <strong>CC0 1.0</strong>（パブリックドメイン）</li>
    </ul>

    <h2>埋め込み</h2>
    <ul>
      <li>ニュース配信・ライブカメラ: YouTube（<code>www.youtube-nocookie.com</code> の埋め込みプレーヤー）。各配信の権利は配信者に帰属します。</li>
    </ul>

    <h2>フォント・ライブラリ</h2>
    <ul>
      <li><strong>Orbitron</strong> — <strong>SIL Open Font License</strong> 1.1（OFL）</li>
      <li><strong>Saira</strong> — <strong>SIL Open Font License</strong> 1.1（OFL）</li>
      <li><strong>MapLibre</strong> GL JS 5.24.0 — <strong>BSD 3-Clause</strong> License</li>
      <li><strong>deck.gl</strong> 9.3.4 — <strong>MIT</strong> License</li>
    </ul>
    <p class="page-note">各ライセンスの全文は、配信しているライブラリ／フォントと同じ場所（<code>/vendor/</code>）に同梱しています。</p>

    <h2>ORBIS 自身</h2>
    <p>ソースコードは <strong>MIT</strong> ライセンスで公開しています（<a href="https://github.com/sg55555/orbis" target="_blank" rel="noopener noreferrer">github.com/sg55555/orbis ↗</a>）。表示されるデータそのものの権利は上記の各上流に帰属します。</p>
    <p class="page-note">出典の記載に誤り・漏れを見つけた場合は <a href="https://github.com/sg55555/orbis/issues" target="_blank" rel="noopener noreferrer">GitHub Issues ↗</a> でお知らせください。</p>
  </main>
  <footer class="site-foot">
    <nav class="foot-links" aria-label="サイト情報">
      <a href="/about">このサイトについて</a>
      <a href="/terms">利用条件・免責</a>
      <a href="/privacy">プライバシー</a>
      <a href="/attribution">出典・ライセンス</a>
    </nav>
    <p class="foot-copy">© 2026 sg55555 · 非商用・個人運営</p>
  </footer>
</body>
</html>
```

- [ ] **Step 9: 中間確認（ページ系が緑・残りの赤を見る）**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q tests/test_pages.py
```
Expected: ページの存在・純静的・スタイルシート・title・attribution・about・terms・privacy・pages.css の各テストが PASS。残る FAILED は
`LICENSE が無い` / `robots.txt が無い` / `README にライセンス節が無い` / `index.html に共通フッターが無い`（`test_page_has_footer_with_four_links[index.html]`・`test_page_has_copyright_line[index.html]`）/ `css/orbis.css に .site-foot 規則が無い` の系統だけ。xfail は 3 件のまま。

- [ ] **Step 10: 最小実装 G — `LICENSE` と `robots.txt`**

`LICENSE` を新規作成（全文）:

```
MIT License

Copyright (c) 2026 sg55555

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

Note: This license covers the source code of ORBIS only. The data displayed by
ORBIS is retrieved from third-party sources and remains subject to the terms of
each upstream provider. See /attribution for the per-layer source and license.
```

`robots.txt` を新規作成（全文）:

```
# ORBIS — https://orbis-beta.vercel.app
# 検索エンジンのクロールは許可する（公開サイトなので noindex は付けない）。
User-agent: *
Allow: /

# 生成 AI の学習用クローラは拒否する。
# 表示しているのは上流の公開データと、その AI 要約であり、
# 学習コーパスとして再収集される前提で集めたものではないため。
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: PerplexityBot
Disallow: /
```

- [ ] **Step 11: 最小実装 H — `index.html` にフッター＋`css/orbis.css` に `.site-foot`**

`index.html` の 178 行 `      </section>`（`#sources` の閉じ）の **直後・179 行 `  </div>` の直前** に、次の 10 行を挿入する（他の行は変更しない）:

```html
      <footer class="site-foot">
        <nav class="foot-links" aria-label="サイト情報">
          <a href="/about">このサイトについて</a>
          <a href="/terms">利用条件・免責</a>
          <a href="/privacy">プライバシー</a>
          <a href="/attribution">出典・ライセンス</a>
        </nav>
        <p class="foot-copy">© 2026 sg55555 · 非商用・個人運営</p>
      </footer>
```

`css/orbis.css` の **末尾（1731 行の後）** に次を追記する（既存 `@media` ブロックの外＝トップレベル。1204〜1352 行の secfit ブロックには触らない）:

```css

/* ===== 共通フッター（.site-foot）＝index.html と静的ページ 5 枚で共有 =====
   規範言語どおり「線と余白」だけで区切る。面（不透明ベタ・radial-gradient）は足さない。
   #app は flex column なので、フッターは最後の行として全幅に伸びる。 */
.site-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px 20px;
  padding: 26px var(--edge-pad) 34px;
  border-top: 1px solid var(--rim-cyan-18);
  font-size: 12px;
  color: var(--text-muted-3);
}
.site-foot .foot-links { display: flex; flex-wrap: wrap; gap: 10px 18px; }
.site-foot .foot-links a { color: var(--cat-link); text-decoration: none; }
.site-foot .foot-links a:hover { text-decoration: underline; text-shadow: 0 0 12px var(--glow-cyan-text); }
.site-foot .foot-copy { margin: 0 0 0 auto; color: var(--muted); }
@media (max-width: 768px) {
  .site-foot { padding: 20px 14px 28px; }
  .site-foot .foot-copy { margin-left: 0; }
}
```

- [ ] **Step 12: 最小実装 I — `README.md` にライセンス節**

`README.md` の **末尾（26 行の後）** に次を追記する:

```markdown

## ライセンス
- **コード**: MIT License（[LICENSE](LICENSE) ・ Copyright (c) 2026 sg55555）
- **データ**: 各上流の条件に従います（USGS / OpenSky Network / GDELT Project / AISStream / NASA FIRMS / Open-Meteo=CC BY 4.0 / OpenStreetMap・OpenMapTiles・OpenFreeMap=ODbL / Wikipedia 日本語版=CC BY-SA 4.0 / Wikidata=CC0）。層ごとの出典と条件は [attribution.html](attribution.html)（本番: https://orbis-beta.vercel.app/attribution ）に一覧があります。
- **フォント/ライブラリ**: Orbitron・Saira=OFL 1.1 / MapLibre GL JS=BSD 3-Clause / deck.gl=MIT。
- 運営: sg55555（個人・非商用）／連絡先: https://github.com/sg55555/orbis/issues
- 公開ページ: [about](about.html) ・ [terms](terms.html) ・ [privacy](privacy.html) ・ [attribution](attribution.html)
```

- [ ] **Step 13: 通ることを確認**

Run（1 実行目・pytest 全体）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q
```
Expected: `tests/test_pages.py` は **xfailed 3・failed 0**（要約行が `NN passed, 3 xfailed`）。既存の pytest も含めて failed 0。

Run（2 実行目・node 単体テストの巻き込み退行を見る）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && node --test tests/*.test.js 2>&1 | tail -20
```
Expected: `# fail 0`。`tests/design-tokens.test.js`（`css/orbis.css` の `:root` を読む）・`tests/secfit.test.js`（1204〜1352 行の secfit ブロックだけを走査し radial-gradient の新設を禁じる）・`tests/drilldown_html.test.js`（index.html の `#drilldown` 構造）はいずれも今回の追記の影響を受けない。

- [ ] **Step 14: コミット**

Run（この 1 ブロックで 1 コミット）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git add 404.html about.html terms.html privacy.html attribution.html css/pages.css css/orbis.css index.html LICENSE robots.txt README.md tests/test_pages.py && git commit -F - <<'MSG'
feat(pages): 公開ページ 5 枚・LICENSE・robots・共通フッターを追加（A4 静的分）

公開サービスとしての体裁を揃える（監査所見 LEGAL-01/02/06/08①/18・SECURITY-15・COST-19）。

- about / terms / privacy / attribution / 404 の 5 枚（純静的＝<script> なし・style= なし）
- css/pages.css は orbis.css の :root トークンを共有（再定義も @import もしない・面を新設しない）
- LICENSE（MIT・Copyright (c) 2026 sg55555）と README のライセンス節
- robots.txt＝検索は Allow、AI 学習クローラ 8 種を Disallow
- index.html と 5 枚に共通フッター（4 リンク＋著作権）・.site-foot は orbis.css 末尾
- privacy は localStorage の実キー 3 件を実装から突き合わせて列挙
- attribution は sources.js の SOURCE_MAP を全件包含（テストで固定）

tests/test_pages.py の xfail 3 件は時系列の整合（builds=Task 3・youtube/rel=Task 8）。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR
MSG
```
Expected: `12 files changed, ...`。`git log --oneline -1` の 1 行目が `feat(pages): 公開ページ 5 枚・LICENSE・robots・共通フッターを追加（A4 静的分）`。

---

### Task 3: A1 `tests/vercel_routes.py`＋routing sim＋security headers テスト＋`vercel.json`＋`.vercelignore`

**Files:**
- Create: `tests/vercel_routes.py`（**共有モジュール**。`test_*` 始まりでないので pytest は収集しない）
- Create（Test）: `tests/test_vercel_routing_sim.py`
- Create（Test）: `tests/test_security_headers.py`
- Modify: `vercel.json`（1〜5 行＝現在の `{version, framework, cleanUrls}` を全文置換）
- Modify: `.vercelignore`（10 行の末尾に 8 行追記）
- Modify: `tests/test_pages.py`（Task 2 Step 1 で置いた `test_pages_are_declared_in_vercel_builds` の `@pytest.mark.xfail(...)` **1 行を削除**）

依存: **Task 2**（`404.html` `about.html` `terms.html` `privacy.html` `attribution.html` `robots.txt` が実在しないと `expand_builds` に載らず routes が 404 に落ちる）。

**Interfaces:**
- **Consumes:** Task 2 が作った 5 ページと `robots.txt`（builds の実体）。
- **Produces**（骨格 Interfaces の名前と型をそのまま）:
  - `tests/vercel_routes.py`
    - `load_config(root: Path) -> dict`
    - `expand_builds(cfg: dict, root: Path) -> set[str]`
    - `evaluate(cfg: dict, path: str, served: set[str]) -> RouteResult`
    - `@dataclass RouteResult: status: int; dest: str | None; headers: dict[str, str]; matched: list[int]`（**デフォルト値は付けない**＝常に 4 引数で構築する）
    - → **Task 10 の `tests/harness/serve.py` がこの 3 関数をそのまま import して e2e を配信する**（テストとハーネスで評価器を二重実装しないための一本化）。
  - `vercel.json`（builds 18 件・routes 12 件）— Task 4（vendor）・Task 9（sw の SHELL ⊆ 配信物）・Task 10（e2e ハーネス）が参照する。
  - `.vercelignore`

- [ ] **Step 1: 失敗するテストを書く（routing sim）**

`tests/test_vercel_routing_sim.py` を新規作成（全文）:

```python
"""vercel.json の builds+routes を実際に評価して配信の形を固定する（設計 §3.1）。

前半＝評価器（tests/vercel_routes.py）そのものの単体テスト（合成 config）。
後半＝実 vercel.json に対する検証（本番で返るはずの status / dest / ヘッダー）。

評価器を tests/vercel_routes.py に切り出してあるのは、Task 10 の e2e ハーネス
（tests/harness/serve.py）が **同じ 1 つの評価器**で配信するため。テストは自前実装で
緑・ハーネスは別実装で配信、という嘘を作らない。

仕様の根拠＝Vercel Build Output API の routes（vercel.json の routes と同一仕様）:
  https://vercel.com/docs/build-output-api/configuration#routes
  > continue: "A boolean to change matching behavior. If true, routing will continue
  >            even when the src is matched."
この一文により、先頭のヘッダー route（src="/(.*)", continue:true）は **最終的な dest の
種類に関係なく全リクエストにマッチし、headers を積んだまま後続の評価へ進む**。
つまり 404 応答にもセキュリティヘッダーが乗る（下の test_unknown_path... がそれを固定する）。
"""
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from vercel_routes import RouteResult, evaluate, expand_builds, load_config  # noqa: E402

SECURITY_HEADERS = [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
]
IMMUTABLE = "public, max-age=31536000, immutable"
ICON_CACHE = "public, max-age=86400"
DATA_CACHE = "public, max-age=3600, stale-while-revalidate=86400"
DOC_CACHE = "public, max-age=0, must-revalidate"

# ── 合成 config（評価器そのものの単体テスト用） ────────────────────
SYNTH = {
    "builds": [{"src": "index.html", "use": "@vercel/static"}],
    "routes": [
        {"src": "/(.*)", "continue": True, "headers": {"X-A": "1"}},
        {"src": "/dup/(.*)", "continue": True, "headers": {"X-A": "2", "X-B": "b"}},
        {"src": "/old/(.*)", "status": 308, "headers": {"Location": "/new/$1"}},
        {"src": "/page", "dest": "/page.html"},
        {"src": "/wild/(.*)", "dest": "/deep/$1.html"},
        {"src": "/ghost", "dest": "/ghost.html"},
        {"handle": "filesystem"},
        {"src": "/(.*)", "status": 404, "dest": "/404.html"},
    ],
}
SYNTH_SERVED = {"/index.html", "/page.html", "/404.html", "/real.txt", "/deep/x.html"}

FS_ONLY = {"routes": [{"handle": "filesystem"}, {"src": "/(.*)", "status": 404, "dest": "/404.html"}]}
NO_TERMINAL = {"routes": [{"src": "/(.*)", "continue": True, "headers": {"X-A": "1"}}]}


def test_evaluator_uses_fullmatch_not_prefix():
    # re.match だと "/pagex" が "/page" にマッチして /page.html を返してしまう。
    res = evaluate(SYNTH, "/pagex", SYNTH_SERVED)
    assert res.status == 404 and res.dest == "/404.html", f"部分一致している: {res}"


def test_continue_routes_accumulate_headers_and_later_wins():
    res = evaluate(SYNTH, "/dup/x", SYNTH_SERVED)
    assert res.headers["X-A"] == "2", "後の continue route が同名ヘッダーを上書きしていない"
    assert res.headers["X-B"] == "b", "後の continue route のヘッダーが積まれていない"


def test_status_route_expands_dollar_one_in_location():
    res = evaluate(SYNTH, "/old/a/b", SYNTH_SERVED)
    assert res.status == 308
    assert res.headers["Location"] == "/new/a/b", f"$1 が展開されていない: {res.headers}"


def test_dest_route_expands_dollar_one():
    res = evaluate(SYNTH, "/wild/x", SYNTH_SERVED)
    assert res.status == 200 and res.dest == "/deep/x.html"


def test_dest_not_in_served_becomes_404():
    # route はあるがビルド出力に無い＝本番では 404。routes だけ見て 200 と信じない。
    res = evaluate(SYNTH, "/ghost", SYNTH_SERVED)
    assert res.status == 404 and res.dest is None


def test_filesystem_handle_serves_existing_file():
    res = evaluate(SYNTH, "/real.txt", SYNTH_SERVED)
    assert res.status == 200 and res.dest == "/real.txt"


def test_filesystem_handle_maps_root_to_index_html():
    res = evaluate(FS_ONLY, "/", SYNTH_SERVED)
    assert res.status == 200 and res.dest == "/index.html"


def test_no_terminal_match_falls_through_to_404():
    res = evaluate(NO_TERMINAL, "/anything", SYNTH_SERVED)
    assert res.status == 404 and res.dest is None
    assert res.headers["X-A"] == "1", "確定しなかった場合も積んだヘッダーは残る"


def test_matched_records_evaluated_route_indexes():
    res = evaluate(SYNTH, "/dup/x", SYNTH_SERVED)
    assert res.matched == [0, 1, 6, 7], f"評価した route の index が想定と違う: {res.matched}"


def test_headers_survive_a_404():
    res = evaluate(SYNTH, "/nope", SYNTH_SERVED)
    assert res.status == 404
    assert res.headers["X-A"] == "1", "404 応答にヘッダー route が効いていない"


def test_expand_builds_returns_files_not_directories():
    served = expand_builds({"builds": [{"src": "js/**", "use": "@vercel/static"}]}, ROOT)
    assert "/js/main.js" in served
    assert "/js/lib/state.js" in served, "** が再帰していない"
    assert "/js" not in served and "/js/lib" not in served, "ディレクトリが混ざっている"


def test_expand_builds_accepts_plain_filenames():
    served = expand_builds({"builds": [{"src": "index.html", "use": "@vercel/static"}]}, ROOT)
    assert served == {"/index.html"}


def test_expand_builds_tolerates_missing_glob():
    # vendor/** は Task 4 で作る。まだ無い資産で routing のテストを落とさない。
    served = expand_builds({"builds": [{"src": "no-such-dir/**", "use": "@vercel/static"}]}, ROOT)
    assert served == set()


# ── ここから実 vercel.json ──────────────────────────────────
@pytest.fixture(scope="module")
def cfg():
    return load_config(ROOT)


@pytest.fixture(scope="module")
def served(cfg):
    # vendor/** は Task 4 で作られる。ルーティングの意味論は「配信物であること」だけに
    # 依存するので、代表 1 ファイルを合成で足して Cache-Control 段まで確定挙動を見る。
    return expand_builds(cfg, ROOT) | {"/vendor/deck.gl-core-9.3.4.min.js"}


def test_header_route_is_first_and_continue_only(cfg):
    routes = cfg.get("routes", [])
    assert routes, "vercel.json に routes が無い"
    r = routes[0]
    assert r["src"] == "/(.*)", "先頭がヘッダー route でない"
    assert r.get("continue") is True, "先頭 route が continue でない（全パスに乗らない）"
    assert "dest" not in r and "status" not in r, "ヘッダー route が dest/status を持っている"
    for h in SECURITY_HEADERS:
        assert h in r["headers"], f"ヘッダー route に {h} が無い"


def test_root_serves_index_html_with_security_headers(cfg, served):
    res = evaluate(cfg, "/", served)
    assert res.status == 200 and res.dest == "/index.html"
    for h in SECURITY_HEADERS:
        assert h in res.headers, f"/ の応答に {h} が乗らない"
    assert res.headers["Content-Security-Policy"].startswith("default-src 'self'")
    assert res.headers["Cache-Control"] == DOC_CACHE


def test_unknown_path_is_404_with_the_404_page(cfg, served):
    res = evaluate(cfg, "/this-path-does-not-exist", served)
    assert res.status == 404 and res.dest == "/404.html", "catch-all が 404.html を返していない"
    for h in SECURITY_HEADERS:
        assert h in res.headers, f"404 応答に {h} が乗らない"


@pytest.mark.parametrize("name", ["about", "terms", "privacy", "attribution"])
def test_clean_url_serves_page(cfg, served, name):
    res = evaluate(cfg, f"/{name}", served)
    assert res.status == 200 and res.dest == f"/{name}.html", f"/{name} が解決しない: {res}"
    assert res.headers["Cache-Control"] == DOC_CACHE


@pytest.mark.parametrize("name", ["about", "terms", "privacy", "attribution"])
def test_html_suffix_redirects_to_clean_url(cfg, served, name):
    res = evaluate(cfg, f"/{name}.html", served)
    assert res.status == 308, f"/{name}.html が 308 でない: {res}"
    assert res.headers["Location"] == f"/{name}", f"Location が違う: {res.headers.get('Location')}"


def test_index_html_redirects_to_root(cfg, served):
    res = evaluate(cfg, "/index.html", served)
    assert res.status == 308 and res.headers["Location"] == "/"


def test_direct_404_html_returns_404_status(cfg, served):
    # 直アクセスでも 200 で「404 ページ」を配らない（ソフト 404 を作らない）。
    res = evaluate(cfg, "/404.html", served)
    assert res.status == 404 and res.dest == "/404.html"


@pytest.mark.parametrize("name", [
    "briefing_sources.json", "instability.json", "forecast.json",
    "fips_countries.json", "news_feeds.json",
])
def test_collector_only_config_is_not_served(cfg, served, name):
    # ブラウザが読むのは live_channels / live_cameras の 2 つだけ（main.js:593-594）。
    # 残りは収集専用＝公開面から外す。
    res = evaluate(cfg, f"/config/{name}", served)
    assert res.status == 404, f"/config/{name} が配信されている: {res}"


@pytest.mark.parametrize("name", ["live_channels.json", "live_cameras.json"])
def test_browser_config_is_served(cfg, served, name):
    res = evaluate(cfg, f"/config/{name}", served)
    assert res.status == 200 and res.dest == f"/config/{name}"
    assert res.headers["Cache-Control"] == DOC_CACHE


@pytest.mark.parametrize("path", [
    "/README.md", "/vercel.json", "/requirements.txt", "/package.json", "/playwright.config.js",
])
def test_repo_files_are_not_served(cfg, served, path):
    res = evaluate(cfg, path, served)
    assert res.status == 404 and res.dest == "/404.html", f"{path} が配信されている: {res}"


def test_robots_txt_is_served(cfg, served):
    res = evaluate(cfg, "/robots.txt", served)
    assert res.status == 200 and res.dest == "/robots.txt"
    assert res.headers["Cache-Control"] == DOC_CACHE


@pytest.mark.parametrize("path,expected", [
    ("/vendor/deck.gl-core-9.3.4.min.js", IMMUTABLE),
    ("/icons/icon-192.png", ICON_CACHE),
    ("/icons/apple-touch-icon.png", ICON_CACHE),
    ("/favicon.svg", ICON_CACHE),
    ("/favicon-32.png", ICON_CACHE),
    ("/data/static/admin1_bbox.json", DATA_CACHE),
    ("/data/static/admin1/JA.geojson.gz", DATA_CACHE),
    ("/", DOC_CACHE),
    ("/about", DOC_CACHE),
    ("/js/main.js", DOC_CACHE),
    ("/css/orbis.css", DOC_CACHE),
    ("/sw.js", DOC_CACHE),
    ("/manifest.webmanifest", DOC_CACHE),
    ("/robots.txt", DOC_CACHE),
])
def test_cache_control_tier(cfg, served, path, expected):
    res = evaluate(cfg, path, served)
    assert res.status == 200, f"{path} が 200 で返らない: {res}"
    assert res.headers.get("Cache-Control") == expected, \
        f"{path} の Cache-Control が想定と違う: {res.headers.get('Cache-Control')}"


@pytest.mark.parametrize("path", [
    "/js/main.js", "/js/lib/presets.js", "/css/orbis.css", "/css/pages.css",
    "/sw.js", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-512.png",
    "/data/static/drilldown_manifest.json",
])
def test_static_assets_resolve_before_catchall(cfg, served, path):
    # 「builds に載っている」だけでは 200 の証拠にならない（route を catch-all の後ろに
    # 書けば 404 になる）。評価器で実際に 200 まで解決することを固定する。
    res = evaluate(cfg, path, served)
    assert res.status == 200 and res.dest == path, f"{path} が catch-all に食われている: {res}"
    assert (ROOT / path.lstrip("/")).exists(), "route はあるがディスクに実ファイルが無い"


def test_every_build_glob_resolves_at_least_one_file(cfg):
    # builds に書いたが実体が無い src を放置しない（vendor/** は Task 4 まで例外）。
    missing = []
    for b in cfg.get("builds", []):
        if b["src"] == "vendor/**":
            continue
        if not expand_builds({"builds": [b]}, ROOT):
            missing.append(b["src"])
    assert missing == [], f"builds の src がディスクに何も持たない: {missing}"


def test_route_result_shape():
    res = evaluate(SYNTH, "/", SYNTH_SERVED)
    assert isinstance(res, RouteResult)
    assert isinstance(res.status, int) and isinstance(res.headers, dict) and isinstance(res.matched, list)
```

- [ ] **Step 2: 失敗を確認**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q tests/test_vercel_routing_sim.py
```
Expected（失敗）: 収集エラー 1 件。
```
ERROR tests/test_vercel_routing_sim.py
ModuleNotFoundError: No module named 'vercel_routes'
```
要約行は `1 error in 0.0Xs`。

- [ ] **Step 3: 最小実装 A — `tests/vercel_routes.py`（評価器）**

`tests/vercel_routes.py` を新規作成（全文）:

```python
"""vercel.json の legacy builds+routes を Vercel のセマンティクスで評価する共有モジュール。

pytest（tests/test_vercel_routing_sim.py・tests/test_security_headers.py）と
e2e ハーネス（tests/harness/serve.py）が **この 1 つの評価器**を使う。
テストは自前実装で緑・ハーネスは別実装で配信、という嘘を作らないための一本化。

仕様の根拠＝Vercel Build Output API の routes（vercel.json の routes と同一仕様と明記）:
  https://vercel.com/docs/build-output-api/configuration#routes
  - src は incoming pathname 全体に対する PCRE マッチ（→ Python は re.fullmatch）
  - continue: true なら src がマッチしても評価を続ける（headers だけ積む）
  - status / dest が付いたマッチで確定する
  - handle: "filesystem" は「ここまでで確定しなければビルド出力の実ファイルを探す」境界

本モジュールは静的サイト（@vercel/static のみ）に必要な範囲だけを実装する。
Serverless Function・rewrite の再入・middleware は Orbis に無いので扱わない。

このシミュレーションが証明しないこと（本番 curl でしか確かめられない部分）:
- エッジでの実配信（TLS・CDN 層・Vercel が独自に足す HSTS 等）
- .gz 資産に Content-Encoding が付かないこと（骨格 Task 11 Step 3 の curl で確認する）
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class RouteResult:
    """1 リクエストの評価結果。

    status  … 最終ステータス（確定しなければ 404）
    dest    … 実際に配信されるビルド出力のパス（308 等・未解決なら None）
    headers … 確定までに積み上がったレスポンスヘッダー
    matched … 評価した routes の index（continue で通過したものと handle も含む）
    """

    status: int
    dest: str | None
    headers: dict[str, str]
    matched: list[int]


def load_config(root: Path) -> dict:
    """<root>/vercel.json を読む。"""
    return json.loads((Path(root) / "vercel.json").read_text(encoding="utf-8"))


def expand_builds(cfg: dict, root: Path) -> set[str]:
    """builds の src グロブを実ファイルへ展開し "/js/main.js" 形式の配信パス集合を返す。

    - 末尾 "/**" は「そのディレクトリ配下の全ファイル（再帰）」。ディレクトリ自身は含めない。
    - それ以外は Path.glob（"index.html" のような固定名もそのまま通る）。
    - ディスクに無い src（Task 4 より前の vendor/** など）は静かに無視する。
      まだ作っていない資産で routing のテストが落ちないようにするため。
    """
    root = Path(root)
    served: set[str] = set()
    for b in cfg.get("builds", []):
        src = b.get("src", "")
        if not src:
            continue
        if src.endswith("/**"):
            base = root / src[:-3]
            if not base.is_dir():
                continue
            candidates = base.rglob("*")
        else:
            candidates = root.glob(src)
        for p in candidates:
            if p.is_file():
                served.add("/" + p.relative_to(root).as_posix())
    return served


def _expand(template: str, m: re.Match) -> str:
    """$1..$N を捕獲グループで置換する（Vercel の dest / Location の記法）。

    捕獲が無い route では何も起きない（そのまま返る）。dest だけでなく headers にも
    適用するが、$ を含む値は Location しか無いので実質 Location 専用。
    """
    out = template
    for i, g in enumerate(m.groups(), start=1):
        out = out.replace(f"${i}", g if g is not None else "")
    return out


def evaluate(cfg: dict, path: str, served: set[str]) -> RouteResult:
    """path に対する routes の評価結果を返す。served は expand_builds の戻り値。"""
    headers: dict[str, str] = {}
    matched: list[int] = []

    for i, r in enumerate(cfg.get("routes", [])):
        # filesystem 境界: ここまでで確定していなければ実ファイルを探す。
        if r.get("handle") == "filesystem":
            matched.append(i)
            target = "/index.html" if path == "/" else path
            if target in served:
                return RouteResult(200, target, headers, matched)
            continue

        src = r.get("src")
        if src is None:
            continue
        m = re.fullmatch(src, path)
        if not m:
            continue
        matched.append(i)

        if "headers" in r:
            for k, v in r["headers"].items():
                headers[k] = _expand(v, m)

        if r.get("continue"):
            continue

        dest = _expand(r["dest"], m) if "dest" in r else None

        if "status" in r:
            # 308 / 明示 404 など。dest はあれば展開して返す（本文の出所）。
            return RouteResult(int(r["status"]), dest, headers, matched)

        if dest is not None:
            # route はあってもビルド出力に無ければ本番は 404。
            if dest not in served:
                return RouteResult(404, None, headers, matched)
            return RouteResult(200, dest, headers, matched)

        return RouteResult(200, None, headers, matched)

    return RouteResult(404, None, headers, matched)
```

- [ ] **Step 4: 中間確認（評価器は緑・実 vercel.json はまだ赤）**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q tests/test_vercel_routing_sim.py
```
Expected: 評価器の単体テスト **13 件が PASS**（`test_evaluator_uses_fullmatch_not_prefix` 〜 `test_expand_builds_tolerates_missing_glob`）。実 vercel.json を見る 40 件超がすべて FAILED で、先頭が
`AssertionError: vercel.json に routes が無い`（`test_header_route_is_first_and_continue_only`）。以降は
`AssertionError: assert 404 == 200` 系（現行 vercel.json に routes/builds が無く、評価器がすべて 404 を返すため）。

- [ ] **Step 5: 失敗するテストを書く（security headers）**

`tests/test_security_headers.py` を新規作成（全文）:

```python
"""vercel.json のセキュリティヘッダーと builds allowlist の契約（設計 §3.1）。

legacy builds+routes では top-level の headers / cleanUrls / redirects / rewrites が
routes と排他になる。よって routes 先頭の continue:true エントリで全パスにヘッダーを付け、
clean URL は routes の 308 + dest で再現する（cleanUrls キーは書かない）。

本ファイルは「値そのもの」の契約（verbatim）を持つ。ルーティングの挙動は
tests/test_vercel_routing_sim.py が評価器で見る（役割分担）。
"""
import json
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

CSP = (
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
    "form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; "
    "img-src 'self' data: blob: https:; font-src 'self'; "
    "connect-src 'self' https://raw.githubusercontent.com https://tiles.openfreemap.org wss://localhost:8900; "
    "frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; child-src 'self' blob:; "
    "manifest-src 'self'; media-src 'self'; upgrade-insecure-requests"
)
PERMISSIONS = (
    "accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), "
    "magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), "
    "screen-wake-lock=(), usb=(), xr-spatial-tracking=(), display-capture=(self)"
)
EXPECTED_HEADER_KEYS = {
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
}
EXPECTED_DIRECTIVES = {
    "default-src": {"'self'"},
    "base-uri": {"'self'"},
    "object-src": {"'none'"},
    "frame-ancestors": {"'none'"},
    "form-action": {"'self'"},
    "script-src": {"'self'", "'wasm-unsafe-eval'"},
    "style-src": {"'self'"},
    "img-src": {"'self'", "data:", "blob:", "https:"},
    "font-src": {"'self'"},
    "connect-src": {"'self'", "https://raw.githubusercontent.com",
                    "https://tiles.openfreemap.org", "wss://localhost:8900"},
    "frame-src": {"https://www.youtube-nocookie.com"},
    "worker-src": {"'self'", "blob:"},
    "child-src": {"'self'", "blob:"},
    "manifest-src": {"'self'"},
    "media-src": {"'self'"},
    "upgrade-insecure-requests": set(),
}
EXPECTED_BUILDS = {
    "index.html", "404.html", "about.html", "terms.html", "privacy.html", "attribution.html",
    "sw.js", "manifest.webmanifest", "robots.txt", "favicon.svg", "favicon-32.png",
    "icons/**", "js/**", "css/**", "vendor/**", "data/static/**",
    "config/live_channels.json", "config/live_cameras.json",
}
CACHE_TIERS = [
    ("/vendor/(.*)", "public, max-age=31536000, immutable"),
    (r"/(icons/.*|favicon\.svg|favicon-32\.png)", "public, max-age=86400"),
    ("/data/static/(.*)", "public, max-age=3600, stale-while-revalidate=86400"),
    (r"/(|index\.html|about|terms|privacy|attribution|sw\.js|manifest\.webmanifest|robots\.txt|js/.*|css/.*|config/.*)",
     "public, max-age=0, must-revalidate"),
]


@pytest.fixture(scope="module")
def cfg():
    return json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))


def _header_route(cfg):
    routes = cfg.get("routes", [])
    assert routes, "vercel.json に routes が無い"
    return routes[0]


def _directives(csp):
    out = {}
    for part in csp.split(";"):
        toks = part.split()
        if toks:
            out[toks[0]] = set(toks[1:])
    return out


# ── ヘッダー route の形と値 ────────────────────────────────────
def test_header_route_is_first_and_continues(cfg):
    r = _header_route(cfg)
    assert r["src"] == "/(.*)"
    assert r.get("continue") is True
    assert "headers" in r and "dest" not in r and "status" not in r


def test_header_set_is_exactly_six(cfg):
    got = set(_header_route(cfg)["headers"])
    assert got == EXPECTED_HEADER_KEYS, f"ヘッダーの集合が違う: 余分={got - EXPECTED_HEADER_KEYS} 不足={EXPECTED_HEADER_KEYS - got}"


def test_required_headers_are_verbatim(cfg):
    h = _header_route(cfg)["headers"]
    assert h["Content-Security-Policy"] == CSP
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["X-Frame-Options"] == "DENY"
    assert h["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert h["Cross-Origin-Opener-Policy"] == "same-origin"
    assert h["Permissions-Policy"] == PERMISSIONS


def test_headers_we_deliberately_do_not_send(cfg):
    # 公開サイトなので noindex は付けない。CORP は脅威モデル外。HSTS は Vercel が付ける。
    h = _header_route(cfg)["headers"]
    for k in ("X-Robots-Tag", "Cross-Origin-Resource-Policy", "Strict-Transport-Security",
              "Cross-Origin-Embedder-Policy", "Access-Control-Allow-Origin"):
        assert k not in h, f"{k} は出荷しない方針（設計 §3.1）"


# ── CSP ─────────────────────────────────────────────────
def test_csp_directive_names_match_exactly(cfg):
    got = set(_directives(_header_route(cfg)["headers"]["Content-Security-Policy"]))
    want = set(EXPECTED_DIRECTIVES)
    assert got == want, f"CSP のディレクティブ集合が違う: 余分={got - want} 不足={want - got}"


@pytest.mark.parametrize("name,tokens", sorted(EXPECTED_DIRECTIVES.items()))
def test_csp_directive_values(cfg, name, tokens):
    d = _directives(_header_route(cfg)["headers"]["Content-Security-Policy"])
    assert d[name] == tokens, f"{name} の値が違う: {d[name]}"


def test_csp_has_no_unsafe_escape_hatches(cfg):
    csp = _header_route(cfg)["headers"]["Content-Security-Policy"]
    for tok in ("'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "*"):
        assert tok not in csp, f"CSP に {tok} が入っている"


# ── Permissions-Policy（書かないものを固定する） ────────────────────
@pytest.mark.parametrize("feature", ["fullscreen", "autoplay", "picture-in-picture", "encrypted-media"])
def test_permissions_policy_omits_iframe_delegated_features(cfg, feature):
    # これらを書くと既定が上書きされ、YouTube 埋め込みの allow / allowfullscreen 委譲が
    # 黙って劣化する（全画面が効かない・自動再生が止まる）。既定のまま触らない。
    pp = _header_route(cfg)["headers"]["Permissions-Policy"]
    assert feature not in pp, f"Permissions-Policy に {feature} を書いてはいけない"


def test_permissions_policy_allows_display_capture_for_self(cfg):
    # AI 字幕の getDisplayMedia（タブ音声のキャプチャ）に必要。
    assert "display-capture=(self)" in _header_route(cfg)["headers"]["Permissions-Policy"]


# ── builds allowlist ────────────────────────────────────
def test_builds_expected_set(cfg):
    got = {b["src"] for b in cfg.get("builds", [])}
    assert got == EXPECTED_BUILDS, f"builds の集合が違う: 余分={got - EXPECTED_BUILDS} 不足={EXPECTED_BUILDS - got}"


def test_all_builds_are_static(cfg):
    uses = {b["use"] for b in cfg.get("builds", [])}
    assert uses == {"@vercel/static"}, f"静的以外の builder がある: {uses}"


@pytest.mark.parametrize("name", [
    "config/briefing_sources.json", "config/instability.json", "config/forecast.json",
    "config/fips_countries.json", "config/news_feeds.json",
    "README.md", "vercel.json", "requirements.txt", "package.json", "playwright.config.js",
])
def test_collector_only_and_repo_files_are_not_built(cfg, name):
    built = {b["src"] for b in cfg.get("builds", [])}
    assert name not in built, f"{name} が builds に載っている（公開面に出る）"


# ── routes の構造 ───────────────────────────────────────
def test_top_level_exclusive_keys_absent(cfg):
    for k in ("headers", "redirects", "rewrites", "cleanUrls", "trailingSlash", "functions"):
        assert k not in cfg, f"top-level {k} は builds/routes と排他（cleanUrls は routes で再現する）"


@pytest.mark.parametrize("src,value", CACHE_TIERS)
def test_cache_control_routes_are_continue_only(cfg, src, value):
    hits = [r for r in cfg.get("routes", []) if r.get("src") == src]
    assert len(hits) == 1, f"Cache-Control route {src} が 1 件でない: {len(hits)}"
    r = hits[0]
    assert r.get("continue") is True, f"{src} が continue でない（ここで確定してしまう）"
    assert r["headers"] == {"Cache-Control": value}, f"{src} の値が違う: {r['headers']}"
    assert "dest" not in r and "status" not in r


def test_catch_all_is_last_and_is_404(cfg):
    routes = cfg.get("routes", [])
    assert routes, "vercel.json に routes が無い"
    assert routes[-1] == {"src": "/(.*)", "status": 404, "dest": "/404.html"}, \
        f"末尾が catch-all 404 でない: {routes[-1]}"


def test_filesystem_handle_is_second_to_last(cfg):
    routes = cfg.get("routes", [])
    assert routes, "vercel.json に routes が無い"
    assert routes[-2] == {"handle": "filesystem"}, \
        f"filesystem 境界が catch-all の直前に無い: {routes[-2]}"


def test_direct_404_route_precedes_filesystem(cfg):
    routes = cfg.get("routes", [])
    srcs = [r.get("src") for r in routes]
    assert r"/404\.html" in srcs, "/404.html を 404 で返す route が無い（ソフト 404 になる）"
    assert srcs.index(r"/404\.html") < len(routes) - 2, "/404.html の route が filesystem より後ろにある"


def test_version_and_framework(cfg):
    assert cfg["version"] == 2
    assert cfg["framework"] is None
```

- [ ] **Step 6: 失敗を確認**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q tests/test_security_headers.py
```
Expected（失敗）: `test_top_level_exclusive_keys_absent` が
`AssertionError: top-level cleanUrls は builds/routes と排他（cleanUrls は routes で再現する）`、
`test_header_route_is_first_and_continues` ほかヘッダー系が `AssertionError: vercel.json に routes が無い`、
`test_builds_expected_set` が `AssertionError: builds の集合が違う: 余分=set() 不足={'index.html', ...}`。
`test_version_and_framework` だけ PASS。要約はおおむね `30 failed, 1 passed`。

- [ ] **Step 7: 最小実装 — `vercel.json`**

`vercel.json` の全文を次で置き換える（現在の 5 行を捨てる）:

```json
{
  "version": 2,
  "framework": null,
  "builds": [
    { "src": "index.html", "use": "@vercel/static" },
    { "src": "404.html", "use": "@vercel/static" },
    { "src": "about.html", "use": "@vercel/static" },
    { "src": "terms.html", "use": "@vercel/static" },
    { "src": "privacy.html", "use": "@vercel/static" },
    { "src": "attribution.html", "use": "@vercel/static" },
    { "src": "sw.js", "use": "@vercel/static" },
    { "src": "manifest.webmanifest", "use": "@vercel/static" },
    { "src": "robots.txt", "use": "@vercel/static" },
    { "src": "favicon.svg", "use": "@vercel/static" },
    { "src": "favicon-32.png", "use": "@vercel/static" },
    { "src": "icons/**", "use": "@vercel/static" },
    { "src": "js/**", "use": "@vercel/static" },
    { "src": "css/**", "use": "@vercel/static" },
    { "src": "vendor/**", "use": "@vercel/static" },
    { "src": "data/static/**", "use": "@vercel/static" },
    { "src": "config/live_channels.json", "use": "@vercel/static" },
    { "src": "config/live_cameras.json", "use": "@vercel/static" }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "continue": true,
      "headers": {
        "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://raw.githubusercontent.com https://tiles.openfreemap.org wss://localhost:8900; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; child-src 'self' blob:; manifest-src 'self'; media-src 'self'; upgrade-insecure-requests",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=(), display-capture=(self)",
        "Cross-Origin-Opener-Policy": "same-origin"
      }
    },
    { "src": "/vendor/(.*)", "continue": true, "headers": { "Cache-Control": "public, max-age=31536000, immutable" } },
    { "src": "/(icons/.*|favicon\\.svg|favicon-32\\.png)", "continue": true, "headers": { "Cache-Control": "public, max-age=86400" } },
    { "src": "/data/static/(.*)", "continue": true, "headers": { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } },
    { "src": "/(|index\\.html|about|terms|privacy|attribution|sw\\.js|manifest\\.webmanifest|robots\\.txt|js/.*|css/.*|config/.*)", "continue": true, "headers": { "Cache-Control": "public, max-age=0, must-revalidate" } },
    { "src": "/index\\.html", "status": 308, "headers": { "Location": "/" } },
    { "src": "/(about|terms|privacy|attribution)\\.html", "status": 308, "headers": { "Location": "/$1" } },
    { "src": "/(about|terms|privacy|attribution)", "dest": "/$1.html" },
    { "src": "/", "dest": "/index.html" },
    { "src": "/404\\.html", "status": 404, "dest": "/404.html" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "status": 404, "dest": "/404.html" }
  ]
}
```

読み方（順序の意味）:
- routes[0] がヘッダー route（`continue`）＝**200 も 308 も 404 も、すべての応答に 6 種が乗る**。
- routes[1..4] が Cache-Control の 4 段。いずれも `continue` でヘッダーだけ積む。
- routes[5..6] が 308（`/index.html`→`/`・`/*.html`→clean URL）。**Cache-Control 段より後ろ**に置くのは、リダイレクトにキャッシュ指示を積む必要が無いため（`/about.html` は routes[4] の候補に含まれない）。
- routes[7..8] が clean URL の解決（`/about`→`/about.html`・`/`→`/index.html`）。
- routes[9] が `/404.html` 直アクセスの 404 化（ソフト 404 を作らない）。**`handle: filesystem` の前**に置くのが要点で、後ろに置くと実ファイルが 200 で配られる。
- routes[10] が filesystem 境界、routes[11] が catch-all 404。

- [ ] **Step 8: 通ることを確認（Task 3 の 2 ファイル）**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q tests/test_vercel_routing_sim.py tests/test_security_headers.py
```
Expected（PASS）: 両ファイルとも failed 0（要約が `NN passed in 0.Xs`）。1 件でも赤が残る場合は
`AssertionError: /<path> が catch-all に食われている` のように**どのパスがどう解決したか**が出るので、routes の順序を見直す（vercel.json だけを直し、テストの期待値は変えない）。

- [ ] **Step 9: `.vercelignore` に 8 行追記**

`.vercelignore` の末尾（10 行目 `.superpowers/` の後）に次を追記する。builds が allowlist なので本来は不要だが、`vercel` CLI から手動デプロイした事故（builds を無視して丸ごと上がる経路）への二重化:

```
.claude/
.claire/
.venv/
.pytest_cache/
data/snapshots/
tools/
*.md
.closure-ok
```

追記後の `.vercelignore` 全文（18 行）:

```
collectors/
scripts/
tests/
.github/
requirements.txt
playwright.config.js
package.json
docs/
node_modules/
.superpowers/
.claude/
.claire/
.venv/
.pytest_cache/
data/snapshots/
tools/
*.md
.closure-ok
```

- [ ] **Step 10: `tests/test_pages.py` の builds xfail を外す**

`tests/test_pages.py` の次の 1 行（`def test_pages_are_declared_in_vercel_builds():` の直前）を **削除**する:

```python
@pytest.mark.xfail(strict=True, reason="Task 3 が vercel.json に builds を書いたら緑（Task 3 Step 10 でこの行を削除する）")
```

削除後、その関数は次の形になる（前後は変えない）:

```python
def test_pages_are_declared_in_vercel_builds():
    cfg = json.loads(read("vercel.json"))
    built = {b["src"] for b in cfg.get("builds", [])}
    missing = sorted(p for p in PAGES + ["robots.txt"] if p not in built)
    assert missing == [], f"vercel.json の builds に無い＝配信されない: {missing}"
```

**`test_no_youtube_com_embed_in_served_code` と `test_external_links_are_noopener_noreferrer` の xfail は残す**（Task 8 が外す）。

- [ ] **Step 11: 通ることを確認（全体）**

Run（1 実行目・pytest 全体）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q
```
Expected: failed 0・error 0。`tests/test_pages.py` の xfail は **2 件**（`3 xfailed` から `2 xfailed` に減る）。要約行は `NNN passed, 2 xfailed`。

Run（2 実行目・node 単体テスト）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && node --test tests/*.test.js 2>&1 | tail -20
```
Expected: `# fail 0`（Task 3 は JS を触っていないので変化なし）。

- [ ] **Step 12: コミット**

Run（この 1 ブロックで 1 コミット）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git add vercel.json .vercelignore tests/vercel_routes.py tests/test_vercel_routing_sim.py tests/test_security_headers.py tests/test_pages.py && git commit -F - <<'MSG'
feat(security): vercel.json を builds+routes に書き換えヘッダー 6 種と配信 allowlist を据える（A1）

監査所見 SECURITY-01/03/04/05/06/14・COST-04・DATA-17・OPS-13・LEGAL-20・404 gap。

- routes 先頭の continue エントリで全応答に CSP/XCTO/XFO/Referrer/Permissions/COOP
  （CSP は script-src 'self' 'wasm-unsafe-eval'・style-src 'self' で閉じる）
- Permissions-Policy に fullscreen/autoplay/picture-in-picture/encrypted-media を書かない
  （書くと YouTube 埋め込みの allow 委譲が黙って劣化する）
- Cache-Control 4 段（vendor=1年 immutable / icons=1日 / data/static=1h+SWR / それ以外=must-revalidate）
- cleanUrls を廃し routes で再現（/about → about.html・/index.html と /*.html は 308）
- builds を allowlist 化＝収集専用 config 5 件・README.md・vercel.json は catch-all 404 へ
- tests/vercel_routes.py に routes 評価器を切り出し（Task 10 の e2e ハーネスと共有）
- .vercelignore に CLI デプロイ事故用の二重化 8 行

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR
MSG
```
Expected: `6 files changed, ...`。`git log --oneline -1` の 1 行目が `feat(security): vercel.json を builds+routes に書き換えヘッダー 6 種と配信 allowlist を据える（A1）`。

---

## part1 の完了条件（Task 4 へ渡す前に確認する）

- [ ] `python3 -m pytest -q` が failed 0・error 0（`tests/test_pages.py` の xfail は **2 件のみ**＝Task 8 が外す分）
- [ ] `node --test tests/*.test.js` が `# fail 0`
- [ ] コミットが 3 本（Task 1・Task 2・Task 3）。**main への push はしていない**（骨格どおり main への push は Task 11 のみ）
- [ ] `vercel.json` の `builds` に `vendor/**` が入っている（実体は Task 4 が作る。`expand_builds` は無いディレクトリを黙って飛ばすのでテストは緑のまま）
- [ ] 実装者（サブエージェント）は Task 1 Step 6〜8 を **1 つも実行していない**（作業ブランチの push・workflow dispatch・orbis-data への書き込みはすべて親セッションの担当）

**骨格からの逸脱 1 点（明示）**: 骨格 Global Constraints は「`git push` は Task 11 のみ」と書いているが、Task 1 Step 6 で **作業ブランチ `worktree-enterprise-a` を origin へ通常 push** する（親セッションが実行）。`workflow_dispatch` はファイルが存在する ref を指定して起動するため、squash-data.yml を GitHub 上で走らせるにはブランチが origin に無ければならない。push 先は作業ブランチであって main ではなく、骨格が禁じている「main への push を Task 11 より前に行う」には当たらない。初回 squash を手元の clone からの `git push --force` で行わない（本人決定 2026-09-03）ための代替経路。Step 7 が GitHub 側の `workflow_dispatch` 登録の制約で起動できない場合は、初回 squash は骨格 Task 11 Step 5 に送る（このブランチ push は無駄にならず、Task 11 の merge 元としてそのまま使える）。

