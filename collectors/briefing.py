"""既存スナップショットを毎時 Sonnet で合成 → ワールド・ブリーフィング（キーゲート）。"""
import json
import os
from datetime import datetime, timezone

from collectors.lib.manifest import update_manifest
from collectors.lib.intel import build_context, parse_brief, briefing_prompt, BRIEFING_SYSTEM

SNAPSHOT_DIR = "data/snapshots"
CONFIG_PATH = "config/briefing_sources.json"
MODEL = "claude-sonnet-4-6"


def _load_snapshots(cfg, snap_dir):
    snaps = {}
    for src in cfg:
        p = os.path.join(snap_dir, src["file"])
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    snaps[src["id"]] = json.load(f)
            except (json.JSONDecodeError, OSError):
                pass
    return snaps


def _ask(prompt):
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=MODEL, max_tokens=1500, temperature=0,
        system=BRIEFING_SYSTEM, messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("[briefing] ANTHROPIC_API_KEY not set; skip")
        return 0
    out_dir = os.path.abspath(SNAPSHOT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    snap_path = os.path.join(out_dir, "briefing.json")
    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
        snaps = _load_snapshots(cfg, out_dir)
        if "news" not in snaps:
            print("[briefing] no news snapshot; skip")
            return 1
        brief = parse_brief(_ask(briefing_prompt(build_context(snaps, cfg))))
        if not brief["lead"] and not brief["cards"]:
            print("[briefing] empty result; keeping previous")
            return 1
    except Exception as e:  # 全体失敗は前回温存
        print(f"[briefing] failed: {e}; keeping previous")
        return 1
    snap = {"updated": now_iso, "model": MODEL, "lead": brief["lead"], "cards": brief["cards"]}
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)
    update_manifest(os.path.join(out_dir, "manifest.json"), "briefing", now_iso, len(brief["cards"]))
    print(f"[briefing] wrote lead + {len(brief['cards'])} cards -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
