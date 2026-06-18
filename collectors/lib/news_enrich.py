"""ニュース enrich の LLM プロンプト組立・応答パース・最終整形（純粋）。"""
import json
import re

CATEGORIES = ["politics", "conflict", "disaster", "economy", "society", "science", "environment", "other"]


def rank_prompt(articles):
    """見出し一覧→世界的重要度の上位を番号で返させるプロンプト（純粋）。"""
    lines = "\n".join(f"{i + 1}. {a['title']}" for i, a in enumerate(articles))
    return (
        "あなたは国際ニュースの編集者です。以下は世界各国のニュース見出しです。\n"
        "いま世界にとって重要な順に、上位の番号だけをカンマ区切りで返してください"
        "（説明不要・番号のみ・最大40件）。\n\n" + lines
    )


def parse_rank(text, articles, top_n=30):
    """応答中の番号（1始まり）を順序付きで article に対応。重複/範囲外は無視し、
    足りなければ元順（recency）で補完。各 article に rank（0始まり）を付与（純粋）。"""
    nums = [int(n) for n in re.findall(r"\d+", text or "")]
    picked, seen = [], set()
    for n in nums:
        idx = n - 1
        if 0 <= idx < len(articles) and idx not in seen:
            seen.add(idx)
            picked.append(idx)
        if len(picked) >= top_n:
            break
    for idx in range(len(articles)):  # 補完
        if len(picked) >= top_n:
            break
        if idx not in seen:
            seen.add(idx)
            picked.append(idx)
    out = []
    for rank, idx in enumerate(picked[:top_n]):
        a = dict(articles[idx])
        a["rank"] = rank
        out.append(a)
    return out


def enrich_prompt(article):
    """1記事→ {title_ja,summary_ja,category,lat,lon,place} を JSON のみで返させる（純粋）。"""
    cats = ", ".join(CATEGORIES)
    return (
        "次のニュース見出しについて、JSON だけを返してください（前後の説明やコードフェンスも可）。\n"
        "キー: title_ja(日本語見出し), summary_ja(1〜2文の日本語要約), "
        f"category({cats} のいずれか1つ), lat(緯度,数値), lon(経度,数値), place(日本語の地名)。\n"
        "出来事の主な発生地の座標を入れてください。場所が特定できない場合は lat/lon を null に。\n\n"
        f"見出し: {article['title']}\n出典: {article.get('source', '')}"
    )


def _extract_json(text):
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except (json.JSONDecodeError, ValueError):
        return None


def parse_enrich(text):
    """enrich 応答を検証済み dict に。必須キー欠落・座標不正は None。category は既知集合に丸め（純粋）。"""
    d = _extract_json(text)
    if not isinstance(d, dict):
        return None
    title = str(d.get("title_ja") or "").strip()
    if not title:
        return None
    try:
        lat = float(d.get("lat"))
        lon = float(d.get("lon"))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    cat = d.get("category")
    if cat not in CATEGORIES:
        cat = "other"
    return {
        "title_ja": title,
        "summary_ja": str(d.get("summary_ja") or "").strip(),
        "category": cat,
        "lat": lat,
        "lon": lon,
        "place": str(d.get("place") or "").strip(),
    }
