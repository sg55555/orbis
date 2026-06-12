"""配信スナップショットの鮮度を集約する manifest.json の読み書き。"""
import json
import os


def update_manifest(path, layer, updated_iso, count):
    """manifest.json を読み（無ければ作り）、指定レイヤーのエントリを更新して書き戻す。"""
    data = {"layers": {}}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    data.setdefault("layers", {})[layer] = {"updated": updated_iso, "count": count}
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data
