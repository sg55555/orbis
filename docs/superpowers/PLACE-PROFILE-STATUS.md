# 地域プロフィール・ドリルダウン（Phase2.5）— 再開ステータス

> worktree `worktree-place-profile`（`.claude/worktrees/place-profile`）の再開ポインタ。
> **2.5a パイプライン＝ダミーモードで実装・検証完了。次＝2.5b UI（未着手）。**
> 太田さん実機FB起点（Phase2 ドリルダウンの中身をイベント集計→地域プロフィールへ）。

## 設計・計画（コミット済）
- spec：`docs/superpowers/specs/2026-06-25-orbis-place-profile-drilldown-design.md`
- 計画：`docs/superpowers/plans/2026-06-25-orbis-place-profile-phase2.5a.md`（ダミーモード対応版）

## 確定スコープ（spec）
- データ源＝**ハイブリッド**（Wikipedia(ja)/Wikidata で事実取得→Claude Sonnet 4.6 で日本語整形・grounding で幻覚抑制）
- 粒度＝全レベル（国246＋県/州4575＋都市6775 ≒ 11,600）・**build 時生成→静的 JSON 配信**（ランタイム LLM 無し）
- 構成＝全レベルがプロフィール中心・イベントは下部に折りたたみで小さく
- UI＝**ページ風フロートパネル**（Phase2 #drilldown 基盤を流用）
- schema＝`{id, level, name_ja, facts{population,area_km2,lat,lon,elevation_m}, sections[{title,body}], source{qid,wikipedia_url}, degraded}`
- セクション順＝概要/気候/特産・名物/主要産業/交通・地理/観光名所

## ✅ 2.5a 実装済（tip 533a6a8・subagent-driven・pytest 149 緑）
- `scripts/lib/profile_prep.py`（純関数：resolve_qid / wikidata_facts / ja_wikipedia_title / build_profile_prompt / parse_profile_response / assemble_profile / is_degraded / generate_profile）
- `scripts/build_profiles.py`（Wikidata/Wikipedia 取得＋Claude 整形＋cache＋manifest・**`PROFILE_DUMMY=1` でダミー生成**・`PROFILE_LLM_MODEL` 既定 claude-sonnet-4-6・`PROFILE_FIPS` で対象国）
- `scripts/build_cities.py`（都市に `qid` 付与）→ `data/static/cities/*.json` 再生成済（qid 入り）
- `tests/test_profile_prep.py`（14 件）
- **ダミー生成済**：`PROFILE_DUMMY=1 PROFILE_FIPS=JA` で `data/static/profiles/{country/JA.json, admin1/*.gz×47, city/*.gz×69}` ＋ `data/static/profiles_manifest.json`（全 degraded=false・地名は実名/本文はダミー・484K）。NE キャッシュは `scripts/.cache/ne/`（コピー済・gitignore）。

## ⚠️ ユーザー決定（2026-06-25）
- **実 LLM 生成（約11,600件・数千円）は将来タスクへ延期**。今はダミーで「デザイン・体裁が分かる」ところまで。
- 将来やるなら：`ANTHROPIC_API_KEY` を設定し `PROFILE_DUMMY` 無しで `build_profiles.py` を全 FIPS 実行（2.5c）。`PROFILE_LLM_MODEL` で Haiku 退避可。

## 次＝2.5b UI（未着手・これで初めて体裁が見える）
ダミープロフィールをページ風パネルで描画する。想定：
- `js/lib/drilldown/profile_view.js`（純関数：profile schema → HTML・escapeHtml・degraded 対応）＝hero ヘッダ（地域名＋種別＋人口/面積）＋セクション縦スクロール＋出典リンク
- `js/ui/drilldown.js`/`country_click.js` 配線：国/県/都市クリック→ profiles_manifest 確認→ fetch（admin1/city は .gz を DecompressionStream gunzip）→ profile_view 描画
- パンくず（国›県›市）＋イベントは下部折りたたみ（Phase2 集計流用）＋ flyTo（bboxCenter）＋ウォッチリスト維持／モバイル bottom-sheet
- 太田さんは **UI 案のブラウザ実物比較を好む** → レイアウト設計から（brainstorming）入るのが良い
- 2.5a+2.5b をまとめて main 統合→デプロイ→実機でダミー体裁確認。OK なら 2.5c（実生成）を将来。

## 再開手順
1. worktree 再入：`EnterWorktree path=.claude/worktrees/place-profile`（または `git checkout worktree-place-profile`）＝**新規 worktree を作らない**（tip 533a6a8）。
2. このファイル＋ spec＋計画を読む。`data/static/profiles/` のダミーを起点に 2.5b UI を brainstorm→実装。
3. 統合は main で merge → push（Vercel）。**注意：main は別スレッド並行更新中**（fetch して最新から）。
