"""国家不安定性インデックス：決定論スコア＋トレンド＋（任意で）Haikuナラティブを毎時合成。"""
import json
import os
from datetime import datetime, timezone

from collectors.lib.manifest import update_manifest
from collectors.lib import instability as I
from collectors.lib.geo_country import load_polygons

SNAP_DIR = "data/snapshots"
CONFIG_PATH = "config/instability.json"
FIPS_PATH = "config/fips_countries.json"
BOUNDS_PATH = "data/static/country_bounds.geojson"
HISTORY_FILE = "instability_history.json"
OUT_FILE = "instability.json"
MODEL = "claude-haiku-4-5"
SNAP_FILES = {"conflict": "conflict.json", "protests": "protests.json",
              "news": "news.json", "quakes": "quakes.json"}


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def _ask(prompt):
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(model=MODEL, max_tokens=2000, temperature=0,
                                 system=I.NARRATIVE_SYSTEM,
                                 messages=[{"role": "user", "content": prompt}])
    return msg.content[0].text


def main():
    out_dir = os.path.abspath(SNAP_DIR)
    os.makedirs(out_dir, exist_ok=True)
    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    now_ms = int(now.timestamp() * 1000)
    try:
        cfg = _load(CONFIG_PATH, None)
        if not cfg:
            print("[instability] no config; skip")
            return 1
        fips = _load(FIPS_PATH, {})
        polys = load_polygons(_load(BOUNDS_PATH, {"features": []}))
        snaps = {k: _load(os.path.join(out_dir, v), {}) for k, v in SNAP_FILES.items()}
        agg = I.aggregate(snaps, polys, cfg)
        countries = I.score_countries(agg, cfg, fips)
        history = _load(os.path.join(out_dir, HISTORY_FILE), {})
        I.apply_trend(countries, history, now_ms, cfg)
        new_hist = I.update_history(history, countries, now_ms, cfg)
    except Exception as e:  # best-effort：前回を温存
        print(f"[instability] failed: {e}; keeping previous")
        return 1
    model = None
    if os.environ.get("ANTHROPIC_API_KEY") and countries:
        try:
            narr = I.parse_narratives(_ask(I.narrative_prompt(countries, cfg)))
            for c in countries:
                if c["code"] in narr:
                    c["narrative_ja"] = narr[c["code"]]
            model = MODEL
        except Exception as e:
            print(f"[instability] narrative skipped: {e}")
    snap = {"updated": now_iso, "model": model,
            "thresholds": {"mag_min": cfg["quake"]["mag_min"], "top_n": cfg["top_n_narrative"]},
            "countries": countries}
    with open(os.path.join(out_dir, OUT_FILE), "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, HISTORY_FILE), "w", encoding="utf-8") as f:
        json.dump(new_hist, f, ensure_ascii=False, separators=(",", ":"))
    update_manifest(os.path.join(out_dir, "manifest.json"), "instability", now_iso, len(countries))
    print(f"[instability] wrote {len(countries)} countries -> {OUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
