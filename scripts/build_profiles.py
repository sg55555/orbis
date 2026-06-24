#!/usr/bin/env python3
"""地域(国/県/都市)の Wikipedia(ja)/Wikidata 事実を Claude で日本語プロフィール化し
data/static/profiles/** ＋ profiles_manifest.json を生成する（build 時オフライン）。

対象国は env PROFILE_FIPS（カンマ区切り FIPS・既定=FIPS_JA 全部）。
キャッシュ scripts/.cache/profiles/ に raw/生成を保存し再実行はスキップ。
実行: PYTHONPATH=. python3 scripts/build_profiles.py
"""
import gzip
import json
import os
import re
import time

import requests

from scripts.lib.profile_prep import generate_profile, resolve_qid, SECTIONS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NE = os.path.join(ROOT, "scripts/.cache/ne")
CACHE = os.path.join(ROOT, "scripts/.cache/profiles")
OUT = os.path.join(ROOT, "data/static/profiles")
MODEL = os.environ.get("PROFILE_LLM_MODEL", "claude-sonnet-4-6")
UA = {"User-Agent": "orbis-profile-collector"}
PROFILE_SYSTEM = ("あなたは地理事典の編集者です。与えられた事実のみを根拠に、"
                  "字幕でなく説明文として自然で簡潔な日本語プロフィールを作ります。")


def load_fips_ja():
    src = open(os.path.join(ROOT, "js/lib/places.js"), encoding="utf-8").read()
    body = re.search(r"export const FIPS_JA = \{(.*?)\};", src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def _cache_get(name):
    p = os.path.join(CACHE, name)
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _cache_put(name, obj):
    os.makedirs(CACHE, exist_ok=True)
    json.dump(obj, open(os.path.join(CACHE, name), "w", encoding="utf-8"), ensure_ascii=False)


def fetch_wikidata(qid):
    cached = _cache_get(f"wd_{qid}.json")
    if cached is not None:
        return cached.get("entity")
    url = f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
    try:
        r = requests.get(url, timeout=30, headers=UA)
        r.raise_for_status()
        entity = (r.json().get("entities") or {}).get(qid)
    except Exception:
        entity = None
    _cache_put(f"wd_{qid}.json", {"entity": entity})
    time.sleep(0.2)
    return entity


def fetch_wikipedia(title):
    key = re.sub(r"[^A-Za-z0-9_]", "_", title)[:80]
    cached = _cache_get(f"wp_{key}.json")
    if cached is not None:
        return cached.get("summary")
    url = "https://ja.wikipedia.org/api/rest_v1/page/summary/" + requests.utils.quote(title, safe="")
    try:
        r = requests.get(url, timeout=30, headers=UA)
        r.raise_for_status()
        summary = r.json().get("extract") or None
    except Exception:
        summary = None
    _cache_put(f"wp_{key}.json", {"summary": summary})
    time.sleep(0.2)
    return summary


def ask_llm(prompt):
    # ダミーモード(PROFILE_DUMMY=1): 実 LLM を呼ばずデザイン確認用のサンプル本文を返す（API キー不要）。
    if os.environ.get("PROFILE_DUMMY") == "1":
        return json.dumps({"sections": [
            {"title": t, "body": f"（サンプル）{t}の説明テキスト。デザイン・体裁確認用のダミーです。"}
            for t in SECTIONS]}, ensure_ascii=False)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return ""
    try:
        import anthropic
        client = anthropic.Anthropic()
        msg = client.messages.create(model=MODEL, max_tokens=1200, temperature=0,
                                     system=PROFILE_SYSTEM,
                                     messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text
    except Exception as e:
        print(f"[profiles] llm error: {e}")
        return ""


DUMMY = os.environ.get("PROFILE_DUMMY") == "1"


def _dummy_wikidata(qid):
    return {"claims": {"P1082": [{"mainsnak": {"datavalue": {"value": {"amount": "+1000000"}}}}],
                       "P2046": [{"mainsnak": {"datavalue": {"value": {"amount": "+1000"}}}}]},
            "sitelinks": {"jawiki": {"title": "（ダミー）"}}}


def _dummy_wikipedia(title):
    return "（ダミー要約）デザイン・体裁確認用のサンプル説明文です。"


def _gen_cached(level, pid, name_ja, qid):
    """generated_<level>_<pid>.json をキャッシュ。無ければ生成。ダミーは別キャッシュ名。"""
    cname = f"{'dummy_' if DUMMY else ''}gen_{level}_{re.sub(r'[^A-Za-z0-9_-]', '_', pid)}.json"
    cached = _cache_get(cname)
    if cached is not None:
        return cached
    fw = _dummy_wikidata if DUMMY else fetch_wikidata
    fwp = _dummy_wikipedia if DUMMY else fetch_wikipedia
    prof = generate_profile(level, pid, name_ja, qid or ("Q_DUMMY" if DUMMY else None),
                            fetch_wikidata=fw, fetch_wikipedia=fwp, ask_llm=ask_llm)
    _cache_put(cname, prof)
    return prof


def _write(level, pid, prof, gz):
    d = os.path.join(OUT, level)
    os.makedirs(d, exist_ok=True)
    if gz:
        path = os.path.join(d, f"{pid}.json.gz")
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(prof, f, ensure_ascii=False, separators=(",", ":"))
    else:
        path = os.path.join(d, f"{pid}.json")
        json.dump(prof, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(path)


def main():
    fips_ja = load_fips_ja()
    target = os.environ.get("PROFILE_FIPS")
    targets = [c.strip() for c in target.split(",")] if target else list(fips_ja)
    manifest = {"country": {}, "admin1": {}, "city": {}}

    # 国: NE admin0 から QID。
    ne0 = json.load(open(os.path.join(NE, "ne_50m_admin_0_countries.geojson"), encoding="utf-8"))
    iso_to_qid = {}
    for f in ne0["features"]:
        p = f["properties"]
        iso_to_qid[(p.get("ISO_A2") or "").upper()] = resolve_qid(p)

    from scripts.lib.fips_of_iso import FIPS_OF_ISO
    qid_by_fips = {}
    for iso, q in iso_to_qid.items():
        fp = FIPS_OF_ISO.get(iso)
        if fp and q:
            qid_by_fips.setdefault(fp, q)

    for fips in targets:
        name_ja = fips_ja.get(fips, fips)
        prof = _gen_cached("country", fips, name_ja, qid_by_fips.get(fips))
        b = _write("country", fips, prof, gz=False)
        manifest["country"][fips] = {"bytes": b, "degraded": prof["degraded"]}

    # 県/州: NE admin1（a1code・wikidataid）。対象国のみ。
    ne1 = json.load(open(os.path.join(NE, "ne_10m_admin_1_states_provinces.geojson"), encoding="utf-8"))
    from scripts.lib.ne_prep import resolve_fips
    name_index = {f["properties"]["name"]: f["properties"]["code"]
                  for f in json.load(open(os.path.join(ROOT, "data/static/country_bounds.geojson"), encoding="utf-8"))["features"]}
    for f in ne1["features"]:
        p = f["properties"]
        fips = resolve_fips(p, name_index)
        if fips not in targets:
            continue
        a1 = p.get("iso_3166_2") or p.get("code_hasc") or p.get("adm1_code")
        if not a1:
            continue
        name_ja = p.get("name_ja") or p.get("name") or a1
        prof = _gen_cached("admin1", a1, name_ja, resolve_qid(p))
        b = _write("admin1", a1, prof, gz=True)
        manifest["admin1"][a1] = {"bytes": b, "degraded": prof["degraded"]}

    # 都市: cities/<FIPS>.json（qid 付与済）。対象国のみ。
    for fips in targets:
        cpath = os.path.join(ROOT, "data/static/cities", f"{fips}.json")
        if not os.path.exists(cpath):
            continue
        for c in json.load(open(cpath, encoding="utf-8")):
            qid = c.get("qid") or None
            if not qid:
                continue
            name_ja = c.get("name_ja") or c.get("name") or qid
            prof = _gen_cached("city", qid, name_ja, qid)
            b = _write("city", qid, prof, gz=True)
            manifest["city"][qid] = {"bytes": b, "degraded": prof["degraded"]}

    os.makedirs(OUT, exist_ok=True)
    json.dump(manifest, open(os.path.join(ROOT, "data/static/profiles_manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    nc, na, ncity = len(manifest["country"]), len(manifest["admin1"]), len(manifest["city"])
    print(f"[profiles] country={nc} admin1={na} city={ncity} (targets={targets[:5]}{'…' if len(targets) > 5 else ''})")


if __name__ == "__main__":
    main()
