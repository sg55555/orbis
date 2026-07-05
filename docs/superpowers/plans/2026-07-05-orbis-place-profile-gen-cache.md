# Orbis 2.5c v2生成キャッシュ + manifestマージ + fetch緩和 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 地政学プロフィール v2 を再実行しても成功済み地域を再 Batch 課金せず、degraded/未生成だけを生成する（+日本のみ実行で他国が消えない manifest マージ + fetch レート制限緩和）。

**Architecture:** `scripts/build_profiles.py` に「フルプロフィール粒度の生成キャッシュ（成功のみ・手動クリア無効化）」を追加。PASS1（`_pass1_prepare`）でキャッシュヒットなら fetch も Batch もスキップして即 finished へ。書き出しは `_write_all` に抽出し成功のみキャッシュ。`_write_manifest` は既存 manifest を読んで純関数 `merge_manifest` でマージ。fetch sleep は env 化。

**Tech Stack:** Python 3.14、pytest、Anthropic Message Batches API（本タスクでは実呼び出しなし・monkeypatch/フェイク）、requests（monkeypatch）。

## Global Constraints

- **実 API/実 HTTP を一切呼ばない**：anthropic は `sys.modules` にフェイク、requests/fetch_* は monkeypatch（既存 tests/test_build_profiles.py の規約）。実生成（実課金）は太田さん手元でのみ。
- **degraded は非キャッシュ**：これが唯一の無効化ルール（degraded の永久固定を防ぐ）。成功=`degraded is False`（`is_degraded_v2` = qid有り＆layers≥1）だけキャッシュする。
- **無効化=手動クリア**：version tag は持たない。`rm scripts/.cache/profiles/v2_prof_*` で全再生成。
- **キャッシュ粒度=フルプロフィール**（`_write` で書くのと同じ assembled profile JSON）。
- **custom_id = `f"{level}_{pid}"`**。cache 名は `_gen_cache_name(cid)` で防御的に正規化（`[^A-Za-z0-9_-]`→`_`）。
- **既存 pytest を緑のまま維持**（回帰）。retry テストは `FETCH_MAX_RETRIES` 定数を参照するので定数変更でも通る。
- **フロント（JS）変更なし**：manifest/profiles スキーマ不変・degraded 表示も不変。純 Python/データパイプライン変更。
- **実行環境**：worktree ルートから `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest …`（venv は main 共有）。

---

## File Structure

- **Modify** `scripts/build_profiles.py`：生成キャッシュヘルパ / PASS1 統合 / `_write_all` 抽出 / manifest マージ / fetch 緩和。
- **Modify** `tests/test_build_profiles.py`：新規ユニットテスト追加＋既存2件の PASS1 テストを cache-miss 硬化。
- 他ファイル変更なし。

---

### Task 1: 生成キャッシュ ヘルパ（`_gen_cache_name` / `_gen_cache_get` / `_gen_cache_put`）

**Files:**
- Modify: `scripts/build_profiles.py`（`_cache_put`（〜62行）の直後に3ヘルパを追加）
- Test: `tests/test_build_profiles.py`

**Interfaces:**
- Consumes: 既存 `_cache_get(name)` / `_cache_put(name, obj)`（module 内）。`re`（import 済）。
- Produces:
  - `_gen_cache_name(cid: str) -> str`：`"v2_prof_<sanitized_cid>.json"`
  - `_gen_cache_get(cid: str) -> dict | None`：非 degraded の cached profile or None
  - `_gen_cache_put(cid: str, prof: dict) -> None`：`prof` が非 degraded の時だけ `_cache_put`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_build_profiles.py` の末尾に追記：

```python
# ---------------------------------------------------------------------------
# 2.5c: v2 生成キャッシュ ヘルパ（成功のみキャッシュ・degraded 非キャッシュ）
# ---------------------------------------------------------------------------

def test_gen_cache_name_sanitizes_cid():
    assert build_profiles._gen_cache_name("city_Q1490") == "v2_prof_city_Q1490.json"
    assert build_profiles._gen_cache_name("admin1_JP-13") == "v2_prof_admin1_JP-13.json"
    # ファイル名に使えない文字は _ に潰す（防御的正規化）
    assert build_profiles._gen_cache_name("x/y z") == "v2_prof_x_y_z.json"


def test_gen_cache_put_writes_only_success(monkeypatch):
    puts = []
    monkeypatch.setattr(build_profiles, "_cache_put", lambda name, obj: puts.append((name, obj)))
    ok = {"id": "JA", "level": "country", "degraded": False, "layers": [{"key": "geo"}]}
    build_profiles._gen_cache_put("country_JA", ok)
    assert puts == [("v2_prof_country_JA.json", ok)]


def test_gen_cache_put_skips_degraded(monkeypatch):
    puts = []
    monkeypatch.setattr(build_profiles, "_cache_put", lambda name, obj: puts.append((name, obj)))
    bad = {"id": "JP-99", "level": "admin1", "degraded": True, "layers": []}
    build_profiles._gen_cache_put("admin1_JP-99", bad)
    assert puts == [], "degraded は保存せず次回再生成させる"


def test_gen_cache_get_returns_cached_success(monkeypatch):
    ok = {"id": "JA", "degraded": False, "layers": [{"key": "geo"}]}
    monkeypatch.setattr(build_profiles, "_cache_get",
                        lambda name: ok if name == "v2_prof_country_JA.json" else None)
    assert build_profiles._gen_cache_get("country_JA") is ok


def test_gen_cache_get_none_on_degraded_or_miss(monkeypatch):
    monkeypatch.setattr(build_profiles, "_cache_get", lambda name: {"degraded": True})
    assert build_profiles._gen_cache_get("country_JA") is None  # 防御的（本来 put されない）
    monkeypatch.setattr(build_profiles, "_cache_get", lambda name: None)
    assert build_profiles._gen_cache_get("country_JA") is None  # miss
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k gen_cache -q`
Expected: FAIL（`AttributeError: module ... has no attribute '_gen_cache_name'`）

- [ ] **Step 3: 最小実装を書く**

`scripts/build_profiles.py` の `_cache_put`（〜62行）の直後に追加：

```python
def _gen_cache_name(cid):
    """v2 生成キャッシュのファイル名。custom_id をファイル名安全に正規化する。非 degraded の cid は
    Batch の ^[a-zA-Z0-9_-]{1,64}$ 準拠で既に安全だが、_gen_cache_get は degrade 候補（qid 無し等）の
    cid でも呼ばれるため防御的に正規化する（cache dir 外への脱出防止）。"""
    return f"v2_prof_{re.sub(r'[^A-Za-z0-9_-]', '_', cid)}.json"


def _gen_cache_get(cid):
    """成功済み（非 degraded）の生成プロフィールがキャッシュにあれば返す（無ければ None）。
    _gen_cache_put で非 degraded のみ書かれるが、防御的に degraded/非 dict は None 扱い。"""
    prof = _cache_get(_gen_cache_name(cid))
    if isinstance(prof, dict) and not prof.get("degraded"):
        return prof
    return None


def _gen_cache_put(cid, prof):
    """生成プロフィールを **非 degraded の時だけ** キャッシュに書く（degraded は保存せず次回再生成）。
    唯一の無効化ルール。プロンプト/スキーマ変更時は scripts/.cache/profiles/v2_prof_* を手動削除する。"""
    if prof and not prof.get("degraded"):
        _cache_put(_gen_cache_name(cid), prof)
```

- [ ] **Step 4: テストが通ることを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k gen_cache -q`
Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/build_profiles.py tests/test_build_profiles.py
git commit -m "feat(profiles): v2生成キャッシュのヘルパ(成功のみ保存・degraded非キャッシュ)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: PASS1 にキャッシュヒット skip を統合（+既存テスト硬化）

**Files:**
- Modify: `scripts/build_profiles.py:379-385`（`_pass1_prepare` のループ・`seen_cids.add(cid)` の直後）
- Test: `tests/test_build_profiles.py`（新規1件 + 既存2件を cache-miss 硬化）

**Interfaces:**
- Consumes: `_gen_cache_get(cid)`（Task 1）。`_pass1_prepare(items, generated_at) -> (immediate, prompts, pending)`（3-tuple は不変・cache-hit は immediate に畳む）。
- Produces: cache ヒット地域は fetch/Batch を経由せず `immediate` に `(level, pid, cached_prof)` として入る。

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_build_profiles.py` に追記：

```python
def test_pass1_prepare_gen_cache_hit_skips_fetch_and_batch(monkeypatch):
    # キャッシュヒット地域は fetch_wikidata も呼ばれず prompts にも入らない（即 immediate）。
    cached = {"id": "JP-13", "level": "admin1", "degraded": False, "layers": [{"key": "geo"}]}
    monkeypatch.setattr(build_profiles, "_gen_cache_get",
                        lambda cid: cached if cid == "admin1_JP-13" else None)

    def _boom(qid):
        raise AssertionError("cache ヒット地域で fetch_wikidata が呼ばれてはいけない")
    monkeypatch.setattr(build_profiles, "fetch_wikidata", _boom)

    items = [("admin1", "JP-13", "東京都", "Q1490",
              {"level": "country", "id": "JP", "name_ja": "日本"})]
    immediate, prompts, pending = build_profiles._pass1_prepare(items, "2026-07-05")
    assert prompts == []
    assert pending == {}
    assert immediate == [("admin1", "JP-13", cached)]
```

既存2件を cache-miss で硬化（実 cache に v2_prof_* が在っても決定的にするため）。各テストの `monkeypatch.setattr(build_profiles, "extract_sections", ...)` 行の直後に1行追加：

```python
    monkeypatch.setattr(build_profiles, "_gen_cache_get", lambda cid: None)  # cache-miss を固定
```

対象＝`test_pass1_prepare_skips_duplicate_custom_id_and_warns`（46行付近）と `test_pass1_prepare_distinct_custom_ids_both_kept`（74行付近）。

- [ ] **Step 2: テストが失敗することを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k "gen_cache_hit or pass1_prepare" -q`
Expected: `test_pass1_prepare_gen_cache_hit_skips_fetch_and_batch` が FAIL（`AttributeError: ... '_gen_cache_get'` は Task 1 で解決済みなので、統合未実装により `_boom` が呼ばれて `AssertionError`）。既存2件は PASS のまま。

- [ ] **Step 3: 最小実装を書く**

`scripts/build_profiles.py` の `_pass1_prepare`、`seen_cids.add(cid)` の直後（`if not qid:` の前）に追加：

```python
        cached_prof = _gen_cache_get(cid)
        if cached_prof is not None:
            immediate.append((level, pid, cached_prof))  # 成功済み=fetch/Batch skip（再課金なし）
            continue
```

- [ ] **Step 4: テストが通ることを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k "gen_cache or pass1_prepare" -q`
Expected: PASS（新規1 + 既存2）

- [ ] **Step 5: コミット**

```bash
git add scripts/build_profiles.py tests/test_build_profiles.py
git commit -m "feat(profiles): PASS1でキャッシュヒット地域はfetch/Batchをskip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `_write_all` 抽出（成功のみキャッシュ書き込み）+ `_main_v2` 配線

**Files:**
- Modify: `scripts/build_profiles.py`（`_write_manifest`（〜448行）の後に `_write_all` 追加、`_main_v2:531-536` の finished ループを差し替え）
- Test: `tests/test_build_profiles.py`

**Interfaces:**
- Consumes: `_write(level, pid, prof, gz)`（既存・bytes を返す）、`_gen_cache_put(cid, prof)`（Task 1）。
- Produces: `_write_all(finished: list[(level, pid, prof)]) -> manifest dict`。各 prof を disk 書き出し（country は非 gz・他は gz）＋成功のみ `_gen_cache_put`＋`manifest[level][pid] = {"bytes", "degraded"}` を構築して返す。

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_build_profiles.py` に追記：

```python
def test_write_all_builds_manifest_and_caches_each(monkeypatch, tmp_path):
    monkeypatch.setattr(build_profiles, "OUT", str(tmp_path))
    put_cids = []
    monkeypatch.setattr(build_profiles, "_gen_cache_put",
                        lambda cid, prof: put_cids.append(cid))
    finished = [
        ("country", "JA", {"id": "JA", "degraded": False, "layers": [{"key": "geo"}]}),
        ("admin1", "JP-13", {"id": "JP-13", "degraded": True, "layers": []}),
        ("city", "Q1490", {"id": "Q1490", "degraded": False, "layers": [{"key": "geo"}]}),
    ]
    manifest = build_profiles._write_all(finished)

    # manifest は level 別に degraded フラグ付きで全件入る
    assert manifest["country"]["JA"]["degraded"] is False
    assert manifest["admin1"]["JP-13"]["degraded"] is True
    assert manifest["city"]["Q1490"]["degraded"] is False
    assert isinstance(manifest["country"]["JA"]["bytes"], int)
    # _gen_cache_put は全 finished で呼ばれる（degraded skip は _gen_cache_put 内部＝Task1で担保）
    assert put_cids == ["country_JA", "admin1_JP-13", "city_Q1490"]
    # country は非 gz、admin1/city は gz で書かれる
    assert (tmp_path / "country" / "JA.json").exists()
    assert (tmp_path / "admin1" / "JP-13.json.gz").exists()
    assert (tmp_path / "city" / "Q1490.json.gz").exists()
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k write_all -q`
Expected: FAIL（`AttributeError: ... '_write_all'`）

- [ ] **Step 3: 最小実装を書く**

`scripts/build_profiles.py` の `_write_manifest` の後に追加：

```python
def _write_all(finished):
    """finished=[(level,pid,prof)] を disk 書き出し＋成功のみ生成キャッシュ＋manifest を構築して返す。
    country は非 gz・admin1/city は gz（_main_v2 のインライン処理を抽出・テスト可能化）。"""
    manifest = {"country": {}, "admin1": {}, "city": {}}
    for level, pid, prof in finished:
        b = _write(level, pid, prof, gz=(level != "country"))
        _gen_cache_put(f"{level}_{pid}", prof)  # 内部で degraded を skip（成功のみ保存）
        manifest[level][pid] = {"bytes": b, "degraded": prof["degraded"]}
    return manifest
```

`_main_v2` の finished ループ（`manifest = {"country": {}, ...}` から `manifest[level][pid] = {...}` までの5行）を1行に差し替え：

```python
    manifest = _write_all(finished)

    _write_manifest(manifest, targets)
```

（差し替え前の該当ブロック＝`manifest = {"country": {}, "admin1": {}, "city": {}}` / `for level, pid, prof in finished:` / `b = _write(...)` / `manifest[level][pid] = {...}` / `_write_manifest(manifest, targets)`）

- [ ] **Step 4: テストが通ることを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k write_all -q`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add scripts/build_profiles.py tests/test_build_profiles.py
git commit -m "refactor(profiles): 書き出しを_write_allに抽出し成功のみ生成キャッシュ

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: manifest マージ（`merge_manifest` / `_load_manifest`）

**Files:**
- Modify: `scripts/build_profiles.py`（`merge_manifest` / `_load_manifest` 追加、`_write_manifest:443-448` を改修）
- Test: `tests/test_build_profiles.py`

**Interfaces:**
- Consumes: 無し（純関数＋既存 ROOT パス）。
- Produces:
  - `merge_manifest(existing: dict, current: dict) -> dict`：country/admin1/city を level 別に `{**existing, **current}`（同 id は current 優先・他 id 温存）。
  - `_load_manifest() -> dict`：`data/static/profiles_manifest.json` を読む（無ければ `{"country":{},"admin1":{},"city":{}}`）。
  - `_write_manifest` は `merge_manifest(_load_manifest(), manifest)` を書く。

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_build_profiles.py` に追記：

```python
def test_merge_manifest_keeps_other_regions(monkeypatch):
    existing = {
        "country": {"US": {"bytes": 10, "degraded": False}},
        "admin1": {"US-CA": {"bytes": 5, "degraded": False}},
        "city": {},
    }
    current = {
        "country": {"JA": {"bytes": 20, "degraded": False}},
        "admin1": {},
        "city": {"Q1490": {"bytes": 7, "degraded": False}},
    }
    merged = build_profiles.merge_manifest(existing, current)
    assert set(merged["country"]) == {"US", "JA"}          # 他国(US)を温存
    assert merged["country"]["JA"]["bytes"] == 20          # 新規(JA)を追加
    assert merged["admin1"]["US-CA"]["bytes"] == 5         # 既存 admin1 温存
    assert merged["city"]["Q1490"]["bytes"] == 7


def test_merge_manifest_current_overwrites_same_id():
    existing = {"country": {"JA": {"bytes": 1, "degraded": True}}, "admin1": {}, "city": {}}
    current = {"country": {"JA": {"bytes": 99, "degraded": False}}, "admin1": {}, "city": {}}
    merged = build_profiles.merge_manifest(existing, current)
    assert merged["country"]["JA"] == {"bytes": 99, "degraded": False}  # 再生成で degraded 解消を反映


def test_write_manifest_merges_existing_file(monkeypatch, tmp_path):
    monkeypatch.setattr(build_profiles, "ROOT", str(tmp_path))
    (tmp_path / "data" / "static").mkdir(parents=True)
    (tmp_path / "data" / "static" / "profiles_manifest.json").write_text(
        '{"country":{"US":{"bytes":10,"degraded":false}},"admin1":{},"city":{}}',
        encoding="utf-8")
    build_profiles._write_manifest(
        {"country": {"JA": {"bytes": 20, "degraded": False}}, "admin1": {}, "city": {}},
        ["JA"])
    import json as _json
    data = _json.loads((tmp_path / "data" / "static" / "profiles_manifest.json").read_text())
    assert set(data["country"]) == {"US", "JA"}, "日本のみ実行でも他国(US)が残る"
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k "merge_manifest or write_manifest_merges" -q`
Expected: FAIL（`AttributeError: ... 'merge_manifest'`）

- [ ] **Step 3: 最小実装を書く**

`scripts/build_profiles.py` の `_write_manifest` の直前に追加：

```python
def merge_manifest(existing, current):
    """既存 manifest に current を level 別マージ（同 id は current 優先・他 id は温存）。
    国単位インクリメンタル生成で、日本のみ実行しても他国のエントリが消えない（純関数）。"""
    return {level: {**(existing.get(level) or {}), **(current.get(level) or {})}
            for level in ("country", "admin1", "city")}


def _load_manifest():
    """既存 profiles_manifest.json を読む（無ければ空の3レベル dict）。"""
    p = os.path.join(ROOT, "data/static/profiles_manifest.json")
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return {"country": {}, "admin1": {}, "city": {}}
```

`_write_manifest` を改修（既存を読んでマージしてから書く・print は書き出した全体の件数）：

```python
def _write_manifest(manifest, targets):
    os.makedirs(OUT, exist_ok=True)
    merged = merge_manifest(_load_manifest(), manifest)
    json.dump(merged, open(os.path.join(ROOT, "data/static/profiles_manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    nc, na, ncity = len(merged["country"]), len(merged["admin1"]), len(merged["city"])
    print(f"[profiles] manifest total: country={nc} admin1={na} city={ncity} "
          f"(this run targets={targets[:5]}{'…' if len(targets) > 5 else ''})")
```

- [ ] **Step 4: テストが通ることを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k "merge_manifest or write_manifest_merges" -q`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add scripts/build_profiles.py tests/test_build_profiles.py
git commit -m "feat(profiles): manifestをマージ書き込み(日本のみ実行で他国を温存)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: fetch レート緩和（`_fetch_sleep` env + `FETCH_MAX_RETRIES` 4→6）

**Files:**
- Modify: `scripts/build_profiles.py`（`FETCH_MAX_RETRIES`（40行）、`_fetch_sleep` 追加、`fetch_wikidata:112` / `fetch_wikidata_props:217` / `fetch_article_plaintext:245` の sleep 差し替え）
- Test: `tests/test_build_profiles.py`

**Interfaces:**
- Consumes: `os`（import 済）。
- Produces: `_fetch_sleep(mult: float = 1.0) -> float`：`PROFILE_FETCH_SLEEP`（既定 0.5）× mult。呼び出し毎に env を読む（テスト可能）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_build_profiles.py` に追記：

```python
def test_fetch_sleep_default(monkeypatch):
    monkeypatch.delenv("PROFILE_FETCH_SLEEP", raising=False)
    assert build_profiles._fetch_sleep() == 0.5
    assert build_profiles._fetch_sleep(2) == 1.0  # 重い endpoint は ×2


def test_fetch_sleep_env_override(monkeypatch):
    monkeypatch.setenv("PROFILE_FETCH_SLEEP", "1.0")
    assert build_profiles._fetch_sleep() == 1.0
    assert build_profiles._fetch_sleep(2) == 2.0


def test_fetch_max_retries_raised():
    assert build_profiles.FETCH_MAX_RETRIES == 6
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k "fetch_sleep or fetch_max_retries" -q`
Expected: FAIL（`_fetch_sleep` 未定義 / `FETCH_MAX_RETRIES == 4`）

- [ ] **Step 3: 最小実装を書く**

`scripts/build_profiles.py:40` を変更：

```python
FETCH_MAX_RETRIES = 6  # 429/例外時の指数バックオフ上限（2^5=32s まで・連続fetchのレート制限に強く）
```

`_cache_put` 直後（Task 1 のヘルパ群の近く）に追加：

```python
def _fetch_sleep(mult=1.0):
    """fetch 間の待機秒（PROFILE_FETCH_SLEEP 既定 0.5）× mult。呼び出し毎に env を読む（テスト可能）。
    連続 fetch のレート制限で Wikipedia 本文が空→即 degraded になるのを緩和する。生成キャッシュにより
    再実行は degraded 部分だけ fetch なので、sleep を上げても再実行は速い。"""
    return float(os.environ.get("PROFILE_FETCH_SLEEP", "0.5")) * mult
```

sleep の差し替え（3箇所）：
- `fetch_wikidata`（112行）：`time.sleep(0.2)` → `time.sleep(_fetch_sleep())`
- `fetch_wikidata_props`（217行）：`time.sleep(0.4)` → `time.sleep(_fetch_sleep(2))`
- `fetch_article_plaintext`（245行）：`time.sleep(0.4)` → `time.sleep(_fetch_sleep(2))`

（`fetch_wikipedia`（129行・v1 dummy パス専用）は変更しない＝スコープ外。）

- [ ] **Step 4: テストが通ることを確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/test_build_profiles.py -k "fetch_sleep or fetch_max_retries" -q`
Expected: PASS（3 tests）

- [ ] **Step 5: 全 pytest 回帰確認**

Run: `PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python -m pytest tests/ -q`
Expected: 全 PASS（既存236 + 本タスク新規、retry 3件は `FETCH_MAX_RETRIES==6` で6回リトライして緑・sleep はモック済で高速）

- [ ] **Step 6: コミット**

```bash
git add scripts/build_profiles.py tests/test_build_profiles.py
git commit -m "feat(profiles): fetch sleepをenv化(PROFILE_FETCH_SLEEP)+リトライ4→6でレート緩和

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完了後の検証（実課金なし・コード完結）

1. **全 pytest 緑**（上記 Task 5 Step 5）。
2. **ドライラン（生成キャッシュの再実行 skip を実確認・LLM 課金なし）**：
   `PROFILE_BATCH=0` かつ `ANTHROPIC_API_KEY` 未設定で `PROFILE_FIPS` を小さい国1つに絞って2回実行し、
   2回目が既存 `v2_prof_*` キャッシュを読んで fetch を再実行しない（＝ログ/所要時間で確認）ことを見る。
   ※ ただし 1回目で degraded になった地域はキャッシュされないので、この確認は「成功地域が2回目で
   fetch skip される」観点。実 LLM 成功は太田さん手元の実課金でのみ得られる。
3. **manifest マージ**：既存 `data/static/profiles_manifest.json`（日本 WIP）を退避 → 別国を小さく実行 →
   マージで日本エントリが残ることを確認（or Task 4 の pytest で担保済み）。

## 太田さん手元の実生成（実課金・本番反映）

```bash
export ANTHROPIC_API_KEY=…
cd /home/shugo/apps/orbis/.claude/worktrees/place-profile-geo   # または merge 後 main
PROFILE_FIPS=JA PYTHONPATH=. /home/shugo/apps/orbis/.venv/bin/python scripts/build_profiles.py
# 1回目でdegradedが残ったら、同じコマンドを再実行（成功地域は再課金されず、degraded/未生成だけBatchに乗る）
# degradedがほぼ0になったら近隣国へ PROFILE_FIPS=KS,CH,TW,SN,TH… と広げる（manifestは自動マージ）
```

- 全再生成したい（プロンプト/スキーマ変更後）：`rm scripts/.cache/profiles/v2_prof_*`
- fetch だけ全再取得：`rm scripts/.cache/profiles/{wd_,v2_wp_,v2_label_}*`（生成キャッシュは残す）

## スコープ外（将来・spec 参照）

- Batch 途中クラッシュのレジューム（batch.id 永続化）。当面は国単位で Batch を小さく保つ。
- 近隣数カ国拡大の実行フェーズ（本タスクの効率化が入った後）。
- `ask_llm_v2`（PROFILE_BATCH=0）の max_tokens=2000（Batch 本線に影響なし・Minor）。
