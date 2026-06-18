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
