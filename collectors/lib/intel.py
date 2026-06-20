"""AIインテリジェンス基盤（純粋）。スナップショット集約とLLM出力検証。後続サブPJも再利用。"""
import json
import re

CATEGORIES = {"politics", "conflict", "disaster", "economy", "society",
              "science", "environment", "other"}
MAX_CARDS = 10

BRIEFING_SYSTEM = (
    "あなたは地政学アナリストです。与えられたデータ（ニュース見出し・要約と、"
    "紛争/抗議/地震の集計）のみを根拠に、現在の世界情勢を日本語で合成します。"
    "データに無い出来事を作らない（捏造禁止）。予測・助言はしない（現状の俯瞰のみ）。"
    "出力は厳格な JSON のみ。"
)


def build_context(snapshots: dict, sources_cfg: list) -> str:
    """各スナップショットを config どおり圧縮し、合成用の簡潔テキストに。"""
    blocks = []
    for src in sources_cfg:
        snap = snapshots.get(src["id"])
        if not snap:
            continue
        rows = snap.get(src.get("key", "items"), []) or []
        count = snap.get("count", len(rows))
        if src.get("group_by"):
            gb, w = src["group_by"], src.get("weight")
            agg: dict = {}
            for r in rows:
                k = r.get(gb)
                if not k:
                    continue
                agg[k] = agg.get(k, 0) + (float(r.get(w, 1) or 0) if w else 1)
            top = sorted(agg.items(), key=lambda kv: kv[1], reverse=True)[: src.get("top", 8)]
            tops = ", ".join(f"{k}({int(v)})" for k, v in top)
            blocks.append(f"[{src['id']}] count={count}; top by {gb}: {tops}")
        else:
            if src.get("sort_by"):
                rows = sorted(rows, key=lambda r: r.get(src["sort_by"], 0) or 0, reverse=True)
            rows = rows[: src.get("take", 10)]
            fields = src.get("fields", [])
            lines = ["  - " + "; ".join(f"{f}={r.get(f)}" for f in fields) for r in rows]
            blocks.append(f"[{src['id']}] count={count}\n" + "\n".join(lines))
    return "\n\n".join(blocks)


def _strip_fence(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n", "", t)
        t = re.sub(r"\n```$", "", t).strip()
    return t


def parse_brief(text: str) -> dict:
    """LLM 出力を検証し {lead, cards} に整形（捏造・XSS・範囲外を弾く）。"""
    try:
        data = json.loads(_strip_fence(text))
    except (json.JSONDecodeError, TypeError):
        return {"lead": "", "cards": []}
    if not isinstance(data, dict):
        return {"lead": "", "cards": []}
    lead = data.get("lead", "")
    if not isinstance(lead, str):
        lead = ""
    out = []
    for c in (data.get("cards") or [])[:MAX_CARDS]:
        if not isinstance(c, dict) or not c.get("title_ja"):
            continue
        cat = c.get("category")
        if cat not in CATEGORIES:
            cat = "other"
        try:
            sev = max(1, min(5, int(c.get("severity", 3))))
        except (TypeError, ValueError):
            sev = 3
        card = {"title_ja": str(c["title_ja"]), "summary_ja": str(c.get("summary_ja", "")),
                "category": cat, "severity": sev}
        lat, lon = c.get("lat"), c.get("lon")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) \
                and -90 <= lat <= 90 and -180 <= lon <= 180:
            card["lat"], card["lon"] = float(lat), float(lon)
            if c.get("place"):
                card["place"] = str(c["place"])
        srcs = []
        for s in (c.get("sources") or []):
            url = s.get("url") if isinstance(s, dict) else None
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                srcs.append({"title": str(s.get("title", "")), "url": url})
        card["sources"] = srcs
        out.append(card)
    return {"lead": lead, "cards": out}


def briefing_prompt(context: str, max_cards: int = MAX_CARDS) -> str:
    return (
        "次のデータから、(1) 現在の世界の俯瞰を2〜4文の日本語で 'lead' に、"
        f"(2) 重要な展開を最大{max_cards}件 'cards' に（全ソース横断で重複排除し重要度順）。"
        "各cardは {title_ja, summary_ja(1〜2文), category("
        "politics|conflict|disaster|economy|society|science|environment|other), "
        "severity(1-5), lat, lon, place, sources:[{title,url}]}。"
        "座標と出典は入力データに在るものだけを使う（無ければ省略）。JSON のみ返す。\n\n"
        f"=== データ ===\n{context}"
    )
