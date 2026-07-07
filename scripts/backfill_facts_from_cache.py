"""コミット済プロフィールの facts を、修正版 wikidata_facts で cached Wikidata entity から
再算出するバックフィル（LLM 非依存・再課金ゼロ）。

対象バグ：
- 面積 area_km2 の単位無視（m²(Q25343) を km² 欄へ生格納＝10^6 倍）。
- 人口 population の配列先頭 claim 誤選択（時系列で古い値を拾う）→ preferred/最新 P585 選択へ。

既定は dry-run（差分表示のみ）。--apply で profile 実体（country=.json / admin1・city=.json.gz）と
profiles_manifest.json の bytes を書き換える。facts 以外のフィールド（LLM 生成の layers/timeline/
tourism 等）は一切触らない。

使い方:
  PYTHONPATH=. python scripts/backfill_facts_from_cache.py           # dry-run
  PYTHONPATH=. python scripts/backfill_facts_from_cache.py --apply   # 書き換え
"""
import glob
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import scripts.build_profiles as bp  # noqa: E402
from scripts.lib.profile_prep import wikidata_facts  # noqa: E402

PROF = os.path.join(bp.ROOT, "data/static/profiles")


def _load_profile(path):
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _cached_entity(qid):
    p = os.path.join(bp.CACHE, f"wd_{qid}.json")
    if not qid or not os.path.exists(p):
        return None
    try:
        return json.load(open(p, encoding="utf-8")).get("entity")
    except (OSError, ValueError):
        return None


def _profile_paths(level):
    d = os.path.join(PROF, level)
    ext = "*.json" if level == "country" else "*.json.gz"
    return sorted(glob.glob(os.path.join(d, ext)))


def run(apply):
    changed = []      # (level, pid, name, old_facts, new_facts) — output が変わったもの
    cache_stale = []  # (level, pid) — 生成キャッシュの facts が古く再同期したもの
    skipped_no_entity = []
    manifest_updates = {"country": {}, "admin1": {}, "city": {}}

    for level in ("country", "admin1", "city"):
        for path in _profile_paths(level):
            prof = _load_profile(path)
            pid = prof.get("id")
            qid = (prof.get("source") or {}).get("qid")
            entity = _cached_entity(qid)
            if entity is None:
                skipped_no_entity.append((level, pid, qid))
                continue
            old = prof.get("facts") or {}
            new = wikidata_facts(entity)
            cid = f"{level}_{pid}"

            # (1) 出力プロフィールの facts を是正（変わる時だけ書き換え）。
            if new != old:
                changed.append((level, pid, prof.get("name_ja"), old, new))
                if apply:
                    prof["facts"] = new
                    b = bp._write(level, pid, prof, gz=(level != "country"))
                    manifest_updates[level][pid] = {"bytes": b, "degraded": prof.get("degraded", False)}

            # (2) 生成キャッシュ(v2_prof_*)も再同期。次回ビルドが stale cached facts で
            #     出力を巻き戻すのを防ぐ（output 変更の有無に依らず、cached facts が古ければ facts のみ差替）。
            cached = bp._gen_cache_get(cid)
            if cached is not None and (cached.get("facts") or {}) != new:
                cache_stale.append((level, pid))
                if apply:
                    cached["facts"] = new
                    bp._gen_cache_put(cid, cached)

    # 報告
    def _fmt(o, n, key):
        return f"{o.get(key)} -> {n.get(key)}"

    print(f"=== backfill facts ({'APPLY' if apply else 'DRY-RUN'}) ===")
    print(f"profiles scanned: "
          f"{sum(len(_profile_paths(lv)) for lv in ('country', 'admin1', 'city'))}  "
          f"output changed: {len(changed)}  gen-cache resynced: {len(cache_stale)}  "
          f"skipped(no cached entity): {len(skipped_no_entity)}")
    area_ch = [c for c in changed if (c[3].get("area_km2") != c[4].get("area_km2"))]
    pop_ch = [c for c in changed if (c[3].get("population") != c[4].get("population"))]
    print(f"\n-- area_km2 changed: {len(area_ch)} --")
    for level, pid, nm, o, n in sorted(area_ch, key=lambda c: -(c[3].get("area_km2") or 0)):
        print(f"  {level:8} {str(pid):10} {nm:12} {_fmt(o, n, 'area_km2')}")
    print(f"\n-- population changed: {len(pop_ch)} --")
    for level, pid, nm, o, n in sorted(pop_ch, key=lambda c: -(c[3].get("population") or 0)):
        print(f"  {level:8} {str(pid):10} {nm:12} {_fmt(o, n, 'population')}")
    if skipped_no_entity:
        print(f"\n-- skipped (no cached wd_ entity) --\n  {skipped_no_entity}")

    if cache_stale:
        print(f"\n-- gen-cache (v2_prof_*) resynced: {len(cache_stale)} --\n  "
              f"{[f'{lv}_{p}' for lv, p in cache_stale][:12]}"
              f"{'…' if len(cache_stale) > 12 else ''}")

    if apply:
        current = {level: m for level, m in manifest_updates.items() if m}
        if current:
            bp._write_manifest(current, targets=["backfill"])
        print("\n[applied] output rewritten, manifest bytes updated, gen-cache facts resynced.")
    else:
        print("\n[dry-run] no files written. Re-run with --apply to write.")
    return {"changed": changed, "cache_stale": cache_stale}


if __name__ == "__main__":
    run("--apply" in sys.argv)
