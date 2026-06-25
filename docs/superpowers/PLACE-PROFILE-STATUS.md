# 地域プロフィール・ドリルダウン（Phase2.5）— 再開ステータス

> worktree `worktree-place-profile`（`.claude/worktrees/place-profile`）の再開ポインタ。
> **2.5a パイプライン＝ダミー完了。2.5b UI＝実装完了・全テスト緑・最終レビュー済。**
> **次＝太田さん実機サニティ（GPU/globe 依存の map-click→flyTo）→ OK なら main 統合。**
> 太田さん実機FB起点（Phase2 ドリルダウンの中身をイベント集計→地域プロフィールへ）。

## 設計・計画（コミット済）
- 親 spec：`docs/superpowers/specs/2026-06-24-orbis-place-profile-drilldown-design.md`（2.5 全体）
- 2.5b UI 設計：`docs/superpowers/specs/2026-06-25-orbis-place-profile-2.5b-ui-design.md`（案C 中央フロート確定）
- 2.5a 計画：`docs/superpowers/plans/2026-06-25-orbis-place-profile-phase2.5a.md`
- 2.5b 計画：`docs/superpowers/plans/2026-06-25-orbis-place-profile-phase2.5b.md`（TDD 11タスク）
- 承認モック＆実機検証スクショ：`docs/superpowers/mockups/place-profile-2.5b/`（mockup-c.html／approved-c-*.png／live-realcode-*.png）

## ✅ 2.5a 実装済（pytest 149 緑・ダミー生成）
- `scripts/lib/profile_prep.py`（純関数）＋`scripts/build_profiles.py`（`PROFILE_DUMMY=1`）＋`scripts/build_cities.py`（qid 付与）。
- ダミー生成済：`data/static/profiles/{country/JA.json, admin1/*.gz×47, city/*.gz×69}`＋`profiles_manifest.json`（全 degraded=false・実名／本文ダミー）。NE キャッシュ `scripts/.cache/ne/`（gitignore）。

## ✅ 2.5b 実装済（tip 3e4d409・node 602/0・Python 149・subagent-driven TDD）
案C 中央フロート＋全部入りヒーロー。Phase2 #drilldown／country_click を流用し再スタイル。
- 純関数：`js/lib/drilldown/region_shape.js`（rings→形状SVG・最大環/Y反転/間引き）／`profile_view.js`（schema＋付帯→HTML・escapeHtml・formatFacts・events空はフッタ非表示）／`resolve_place.js`（最具体かつ manifest 在り＝city→admin1→country・admin1Hit返却）。
- データ層：`js/lib/drilldown/profile_data.js`（country素JSON／admin1・city は gz DecompressionStream・manifest gating・null非キャッシュ・inflight共有）。
- 描画：`js/ui/drilldown.js renderProfile`（.dd-body へ profileHtml・パンくず data-level/id→onNavigate・close/watch は onclick 置換＝再描画安全）。renderDrilldown/renderWatchlist 保持。
- 統合：`js/ui/country_click.js`（**openCountry 廃止**・`openPlace`＝FIPS→loadCountryGeo→loadPolygonsFn→resolvePlace→**reveal は target 確定後**→loadProfile→model→renderProfile→flyTo[country bbox/admin1 bbox/city center]・各 await 後にレースガード・no-profile 国は reveal せず onOceanMiss トースト）＋`navigate`（chain 流用・パンくず切詰）。events=buildDrilldown を `{emoji,where,title}` に map。
- `js/main.js`：`profiles_manifest.json` 取得＋profile deps（getter）＋#drill-scrim クリック/Esc→closeCountry。
- `css/orbis.css`：#drilldown を中央フロート（min(920px,95vw)・92vh・近不透明・オーロラ縁・**backdrop-filter 無し**）＋#drill-scrim＋.pf-* 移植＋モバイル全幅ボトムシート（drag-handle）。旧右ドック grid 撤去。
- `index.html`：#drill-scrim 追加。`sw.js`：CACHE `orbis-v49`。

### 検証済 / 未検証
- ✅ 全テスト緑（node 602／Python 149）。実コード＋実orbis.css ハーネスで中央フロート／実JP-13 形状（viewBox 0 0 100 40.2）／6セクション／イベント折りたたみ／モバイルシート＋drag-handle を視覚確認（live-realcode-*.png）。
- ✅ 最終 opus レビュー：ブロッカー（no-profile 国クリックで空パネル）を捕捉・修正済（3e4d409）。
- ⏳ **未検証＝太田さん実機サニティ**：本物の globe を起動し国/県/都市クリック→openPlace→flyTo の寄り具合（WebGL/GPU 依存・headless 不可）。日本以外は profile 無し→トーストが出る（ダミーは JA のみ生成）。

## ⚠️ ユーザー決定（2026-06-25）
- 実 LLM 生成（約11,600件・数千円）は将来タスク（2.5c）へ延期。今はダミーで体裁確認まで。
- 締め方＝**worktree 保持・実機サニティ後に統合**（即 merge/push しない）。

## 統合手順（実機サニティ OK 後）
1. **git fetch**（main は別スレッド並行更新中）。`git fetch origin && git log --oneline origin/main -5`。
2. **SW 再調整**：worktree は `orbis-v49`。main 最新版を確認し `sw.js` を main最新版+1 へ（`tests/drilldown_sw.test.js` も合わせる）。
3. main ツリーで merge。**衝突注意**＝`css/orbis.css`（secfit/HUD 中盤 vs #drilldown 末尾・領域分離気味）・`index.html`（scrim vs secfit 見出し markup）。設計言語トークンを最新 main の secfit（`.sec-h`/rim 系）へ寄せる微修正。
4. `node --test tests/*.test.js` ＋ `pytest -q` 緑を再確認 → push（Vercel）→ 本番 curl で profiles_manifest/profile gz 反映確認。
5. **記憶昇格**（統合後のみ）：MEMORY.md／Obsidian Projects/orbis-feature-roadmap.md を 2.5b 完了で更新。→ 次 2.5c（実 LLM 生成・要 ANTHROPIC_API_KEY・コスト承認）。

## 再開手順
1. worktree 再入：`EnterWorktree path=.claude/worktrees/place-profile`。
2. このファイル＋2.5b 計画/設計を読む。実機サニティ or 2.5c。
3. 累積 Minor（任意・最終レビューで acceptable 判定）＝`.superpowers/sdd/progress.md` 末尾に記録（region_shape 1行複数文・stale 文言など）。
