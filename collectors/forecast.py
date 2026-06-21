"""AI FORECASTS：決定論注視度＋（任意で）Haikuナラティブを毎時合成。"""
import json
import os
from datetime import datetime, timezone

from collectors.lib.manifest import update_manifest
from collectors.lib import forecast as F
from collectors.lib.geo_country import load_polygons

SNAP_DIR = "data/snapshots"
CONFIG_PATH = "config/forecast.json"
FIPS_PATH = "config/fips_countries.json"
BOUNDS_PATH = "data/static/country_bounds.geojson"
HISTORY_FILE = "forecast_history.json"
OUT_FILE = "forecast.json"
MODEL = "claude-haiku-4-5"
SNAP_FILES = {"conflict": "conflict.json", "protests": "protests.json", "news": "news.json",
              "quakes": "quakes.json", "ships": "ships.json"}


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def _ask(prompt):
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(model=MODEL, max_tokens=3000, temperature=0,
                                 system=F.FORECAST_SYSTEM,
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
            print("[forecast] no config; skip")
            return 1
        fips = _load(FIPS_PATH, {})
        polys = load_polygons(_load(BOUNDS_PATH, {"features": []}))
        snaps = {k: _load(os.path.join(out_dir, v), {}) for k, v in SNAP_FILES.items()}
        instab = _load(os.path.join(out_dir, "instability.json"), {})
        history = _load(os.path.join(out_dir, HISTORY_FILE), {})
        agg = F.aggregate_signals(snaps, polys, instab, cfg)
        items = F.score_attention(agg, history, instab, cfg)
        cards = F.build_cards(items, history, fips, now_ms, cfg)
        new_hist = F.update_history(history, items, now_ms, cfg)
    except Exception as e:
        print(f"[forecast] failed: {e}; keeping previous")
        return 1
    model = None
    if os.environ.get("ANTHROPIC_API_KEY") and any(c["status"] == "active" for c in cards):
        try:
            F.apply_narratives(cards, F.parse_narratives(_ask(F.forecast_prompt(cards, cfg))))
            model = MODEL
        except Exception as e:
            print(f"[forecast] narrative skipped: {e}")
    snap = {"generated_at": now_iso, "model": model,
            "thresholds": {"level": cfg["level_thresholds"], "top_n": cfg["top_n_narrative"]},
            "cards": cards}
    with open(os.path.join(out_dir, OUT_FILE), "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, HISTORY_FILE), "w", encoding="utf-8") as f:
        json.dump(new_hist, f, ensure_ascii=False, separators=(",", ":"))
    update_manifest(os.path.join(out_dir, "manifest.json"), "forecast", now_iso, len(cards))
    print(f"[forecast] wrote {len(cards)} cards -> {OUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
