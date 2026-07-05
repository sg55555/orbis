---
date: 2026-07-05
tags: [orbis, place-profile, geopolitical, cache, batch-api, cost]
project: orbis
related: [[2026-07-04-orbis-place-profile-geopolitical-redesign]]
status: design-approved
---

# Orbis 2.5c — v2 生成キャッシュ ＋ manifest マージ ＋ fetch レート緩和（degraded 詰め・本番効率化）

## 背景 / 目的

2.5c（地政学プロフィール v2・Batch API）は Task1-7+fix で本番相当まで実装済み
（`place-profile-geo` worktree・Python236/JS629 緑）。日本1国パイロット実生成で品質は良好
（シンガポール実生成が5要望完璧）だが、次の2つが**本番（全11,600地域）と degraded 詰めのブロッカー**:

1. **生成キャッシュが無い** — `run_batch` は毎回**全プロンプト**を Batch 送信する。fetch
   キャッシュ（Wikidata/Wikipedia）はあるが**生成（LLM 出力）キャッシュが無い**ため、degraded を
   詰めるための再実行が**成功済み地域も含めて全再課金**になる。11,600地域では非現実的。
2. **manifest 丸ごと上書き** — `_write_manifest` は現 targets 分だけで
   `profiles_manifest.json` を上書きする。日本のみ再実行すると他国が manifest から消え、
   フロントで "profile 無しトースト" になる。
3. **連続 fetch のレート制限** — PASS1 で117地域を連続 fetch すると sleep 0.2/0.4 では
   Wikipedia 本文取得が "今回空" になり即 degraded（qid 欠落は0なので degraded の主因はこれ）。

**このタスクのゴール**: 再実行で**成功済み地域を再 Batch 課金せず**、degraded/未生成だけを生成する。
併せて日本のみ実行で他国が消えない manifest マージと、レート制限緩和で1パスあたりの degraded を減らす。

## 用語 / 前提（コードで確認済み）

- `is_degraded_v2(qid, parsed)` = `qid` 無し **or** `layers` 皆無。**成功 = qid 有り ＆ layers≥1**。
- `parsed` = `{layers, timeline, tourism}`（LLM 出力のパース結果 = Batch 課金で得られる高価な成果物）。
- 組立（`assemble_profile_v2`）は `parsed` + `facts` + `source` から安価に再構成できる。
- degraded は既に**永久キャッシュしない**設計（8c 品質ゲートで fetch_* のレート制限空応答を非キャッシュ化）
  ＝再実行で自然にリトライされる下地がある。生成キャッシュはこれと整合させる。
- custom_id = `f"{level}_{pid}"`。PASS1 で重複 dedup 済み・Batch 送信対象は `^[a-zA-Z0-9_-]{1,64}$`
  準拠（ファイル名として安全）。

## 設計

### 1. v2 生成キャッシュ（核心・採用=フルプロフィール粒度）

- **保存先**: `scripts/.cache/profiles/v2_prof_<custom_id>.json`（既存 CACHE ディレクトリ）。
  中身は**フルの assembled profile**（`_write` で書くのと同じ JSON）。
- **キャッシュ書き込みは成功（非 degraded）時のみ**。degraded は保存しない → 次回再取得・再生成される。
  これが唯一の無効化ルール（degraded の永久固定を防ぐ）。
- **PASS1 でキャッシュヒット（成功済みが在る）なら fetch も Batch もスキップ**して即 `finished` へ。
  → 再実行では degraded/未生成だけが fetch＋Batch に乗る＝**成功地域は再課金ゼロ・fetch もゼロ**。
  ヒット地域は純キャッシュ読取なので、再実行のレート制限予算を degraded 地域に集中できる。
- **無効化 = 手動クリア**（採用）。プロンプト/スキーマを変えたら `scripts/.cache/profiles/v2_prof_*`
  を手動削除して全再生成する。version tag は持たない（意図せず全再課金しないため）。プロンプトは
  Task1-7 で確定済みで安定。README/docstring にこのエスケープハッチを明記する。
- **粒度=フルプロフィール（採用・A案）の理由**: 既存 v1 `_gen_cached` と同型でシンプル、再実行が最速
  （成功地域は fetch すらしない）。トレードオフ = `facts`/`generated_at` が固定される（全更新は
  キャッシュ削除で対応・degraded 詰めの用途では成功地域を触らないのが正しい）。

**関数**:
- `_gen_cache_get(cid)` → 非 degraded の cached profile or None（thin wrapper）。
- `_gen_cache_put(cid, prof)` → `prof["degraded"]` が False の時だけ書く。
- 統合: `_pass1_prepare` の dedup 直後にキャッシュ照会を挟み、ヒットは `cached`（=finished 相当）へ。
  `_main_v2` は `finished` の非 degraded を `_gen_cache_put`（ヒットの再書き込みは冪等・無害）。

### 2. manifest マージ

- **純関数 `merge_manifest(existing, current)`** → `country/admin1/city` それぞれで
  `existing` に `current` を `update`（同 id は current で上書き、他 id は温存）。
- `_write_manifest` を「既存 `profiles_manifest.json` があれば読み、`merge_manifest` してから書く」に変更。
  ファイルが無ければ current をそのまま。
- → 日本のみ実行でも他国エントリが残り "profile 無しトースト" にならない。degraded の地域も
  entry は残る（present・degraded:true）ので、フロントは facts-only 表示（トーストではない）。

### 3. fetch レート緩和

- **`PROFILE_FETCH_SLEEP` env**（既定 0.5 秒・現状 0.2/0.4 より上げる）。module 定数
  `FETCH_SLEEP = float(os.environ.get("PROFILE_FETCH_SLEEP", "0.5"))`。
  - `fetch_wikidata`: 現 0.2 → `FETCH_SLEEP`。
  - `fetch_wikidata_props` / `fetch_article_plaintext`: 現 0.4 → `FETCH_SLEEP * 2`（重い endpoint）。
- **`FETCH_MAX_RETRIES` 4 → 6**（指数バックオフ上限 2^5=32s まで・一時的レート制限に強く）。
- 生成キャッシュにより**再実行は degraded 部分だけ fetch** なので、sleep を上げても再実行は速い。
  初回パスだけ丁寧に流す想定。

### 4. Minor（任意・低優先）

- `ask_llm_v2`（PROFILE_BATCH=0 の少数検証用）の `max_tokens=2000` は country/admin1 で truncate し得る。
  level を渡して `MAX_TOKENS_BY_LEVEL` を使うか一律引き上げ。Batch 本線には影響しない。
- v1 `fetch_wikipedia`（dummy パス専用）のリトライ欠如。本線 v2 は無関係。**今回はやらなくてよい**。

## データフロー（再実行時）

```
_collect_targets → items
  _pass1_prepare:
    for item:
      dedup custom_id
      ┌─ _gen_cache_get(cid) ヒット(非degraded)? ── yes → cached[]（fetch/Batch skip）
      └─ no → fetch_wikidata/article … → qid無し/本文空 → immediate[](degraded)
                                       └─ それ以外 → prompts[]/pending{}
  run_batch(prompts)  ← degraded/未生成だけ = 再課金なし
  _pass2_finish
  finished = cached + immediate + pass2
  for prof in finished:
    _write(...) ; _gen_cache_put(cid, prof)（非degradedのみ）; manifest[level][pid]=…
  _write_manifest = merge_manifest(load_existing(), manifest) を書く
```

## テスト（pytest・実課金なし）

1. **gen-cache skip**: 成功 profile をキャッシュに事前投入 → `_pass1_prepare` がその cid を prompts に
   積まず cached に入れる（fetch 注入がヒット地域で呼ばれない）。
2. **degraded 非キャッシュ**: `_gen_cache_put` に degraded profile を渡すとファイルが作られない。
3. **merge_manifest**: 既存 {JA…, US…} に current {JA'…} をマージ → US 温存・JA 更新。純関数単体。
4. **sleep env**: `PROFILE_FETCH_SLEEP` を読み `FETCH_SLEEP` に反映（境界: 未設定=0.5）。
5. 既存 pytest（236）が緑のままであること（回帰）。

実生成（日本再実行・実課金）は太田さんが手元で:
`export ANTHROPIC_API_KEY=…; PROFILE_FIPS=JA PYTHONPATH=. .venv/bin/python scripts/build_profiles.py`

## スコープ外（将来）

- **Batch 途中クラッシュのレジューム**（batch.id 永続化）。11,600 の単一 Batch が長時間で中断されると
  ロスト。当面は国単位インクリメンタル（日本→韓国…）で各 Batch を小さく保ち、生成キャッシュで
  再実行を安全にする。batch-resume は別タスク。
- **近隣数カ国拡大**（韓国/中国/台湾/SG/タイ）。本タスクの効率化が入った後に実行フェーズで。
- フロントの degraded 表示改善（別 backlog）。

## エスケープハッチ

- 全再生成したい（プロンプト/スキーマ変更後）: `rm scripts/.cache/profiles/v2_prof_*` してから実行。
- fetch だけ全再取得: `rm scripts/.cache/profiles/{wd_,v2_wp_,v2_label_}*`（生成キャッシュは残る）。
