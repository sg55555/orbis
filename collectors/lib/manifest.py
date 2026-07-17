"""配信スナップショットの鮮度を集約する manifest.json の読み書き。"""
import json
import os


def _load(path):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"layers": {}}


def _save(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def update_manifest(path, layer, updated_iso, count):
    """manifest.json を読み（無ければ作り）、指定レイヤーのエントリを更新して書き戻す。

    エントリごと差し替えるため、前回の last_error_at は成功時に消える（＝復旧を表す）。
    """
    data = _load(path)
    data.setdefault("layers", {})[layer] = {"updated": updated_iso, "count": count}
    _save(path, data)
    return data


def record_manifest_error(path, layer, error_iso):
    """収集失敗を記録する。updated/count（＝最後に成功した鮮度）はそのまま残し、
    last_error_at だけを立てる。一度も成功していない層に updated を捏造しない。

    例外メッセージは載せない：FIRMS 等の URL には MAP_KEY が載るうえ、manifest は
    PUBLIC な orbis-data へ commit されるため（Actions ログと違い秘密のマスクが効かない）。
    失敗の中身は同じ run のステップログ（::warning::）側で見る。
    """
    data = _load(path)
    entry = data.setdefault("layers", {}).setdefault(layer, {})
    entry["last_error_at"] = error_iso
    _save(path, data)
    return data
