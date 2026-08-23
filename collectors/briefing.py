"""既存スナップショットを毎時 Sonnet で合成 → ワールド・ブリーフィング（キーゲート）。"""
import json
import os
from datetime import datetime, timezone

from collectors.lib.manifest import update_manifest
from collectors.lib.keycheck import key_or_skip
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
        # temperature は anthropic SDK v1.0.0 で create() の引数から削除された（渡すと TypeError）。
        # ただし sonnet-4-6 / haiku-4-5 は API 側では今も受け付けるので、決定性を保つため
        # extra_body でボディに直接載せる（MIGRATION.md が案内する正規の経路・旧版でも同じ挙動）。
        model=MODEL, max_tokens=4000, extra_body={"temperature": 0},
        system=BRIEFING_SYSTEM, messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def main():
    if key_or_skip("briefing", "ANTHROPIC_API_KEY") is None:
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
