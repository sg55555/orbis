"""Layer2 鮮度モニタの純ロジック（I/O 無し・manifest dict を受け取り分類するだけ）。

Layer1（mark_error / keycheck）が残す2穴を、collector の終了コード・キー判定に依存せず
manifest.updated の**経過時間そのもの**で塞ぐ cause-agnostic な backstop：
  穴1＝REQUIRED 追記忘れ層のキー失効（key_or_skip が無言 None）
  穴2＝flights 型（exit0 なのに no-write で updated 凍結）
どちらも「なぜ古いか」を問わず age > MAX_AGE で発火する。

シグナルは last_error_at の有無でクラス分割する（#1 リスク＝オオカミ少年の回避）：
  silent_stale … last_error_at 無で閾値超＝Layer1 が盲目の危険クラス → RED（exit1）
  erroring_stale … last_error_at 有＝Layer1 が既に ::warning::+last_error_at で担当 → warning
  fresh_empty  … NEVER_EMPTY 層で count==0（flights の HTTP200 空＝stamped-empty） → warning
  missing/cold … reset/初回で updated が無い → warning（RED-storm 回避）

閾値は明示 dict に置く（cron 由来は却下）：collect.yml 群の実 cadence を駆動するのは
外部 cron-job.org（約15分毎）で、これは .github/workflows のどの文字列にも現れない＝
モニタがパースできる真実源が無い。値は観測ドリフト（2026-07-17/21 監査）に基づく。
"""
from collections import namedtuple
from datetime import datetime, timezone

# 唯一の閾値宣言 {layer: seconds}。完全性テストが set(MAX_AGE)==eligible_layer_names() を強制する。
# 2 tier：fast（collect.yml 群・外部cron約15分＋yml fallback）=6h／
#         slow・firms（collect-slow/collect-firms・純 yml schedule 3h cadence・重い/外部cron無）=12h。
_FAST_S = 6 * 3600      # 21600
_SLOW_S = 12 * 3600     # 43200
MAX_AGE = {
    "quakes": _FAST_S,
    "flights": _FAST_S,
    "conflict": _FAST_S,
    "protests": _FAST_S,
    "ships": _FAST_S,
    "airtemp": _SLOW_S,
    "sst": _SLOW_S,
    "firms": _SLOW_S,
}

# count==0 が正当になり得ない層。GDELT（conflict/protests）は静穏窓で 0 になり得るので除外。
NEVER_EMPTY = frozenset({"quakes", "flights", "ships", "airtemp", "sst", "firms"})

# 観測された yml-single fallback の最悪 gap（4.9h）。閾値をこれ未満へ締める tightening を静的封鎖する床。
OBSERVED_MAX_GAP_S = 17640

# status ∈ {fresh, fresh_empty, silent_stale, erroring_stale, missing, cold}
Finding = namedtuple("Finding", "layer status age_seconds max_seconds has_error count")


def parse_iso(s):
    """ISO8601（末尾 Z＝UTC）を tz-aware datetime に。None/未パースは None を返す（例外を投げない）。"""
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _classify(layer, entry, now, max_s, any_updated):
    """1層を分類して Finding を返す。決して例外を投げない（安全側 silent_stale へ倒す）。"""
    try:
        # エントリ欠落＝reset/初回。全層に updated が無ければ cold（fresh clone/full reset）、
        # 他層が生きていれば missing（この層だけ初回書込待ち）。どちらも warning（RED でない）。
        if not isinstance(entry, dict):
            if entry is None:
                return Finding(layer, "cold" if not any_updated else "missing",
                               None, max_s, False, None)
            # 値が dict でない壊れたエントリ＝異常。見落とさない（RED）。
            return Finding(layer, "silent_stale", None, max_s, False, None)

        err_at = parse_iso(entry.get("last_error_at"))
        has_error = err_at is not None
        # Layer1（mark_error）が「今」担当していると言えるのは last_error_at が新鮮な時だけ。
        # 陳腐化した error（層の budget 超）＝「一度鳴いて以後 exit0-no-write 沈黙」で Layer1 は現在盲目
        # ＝穴2 の本命象限。ここは erroring_stale(warning) に握りつぶさず silent_stale(RED) で拾う。
        # 逆に error が新鮮（現 ships＝毎 run 失敗）なら warning 維持＝#1 オオカミ少年回避。
        recent_error = has_error and (now - err_at).total_seconds() <= max_s
        count = entry.get("count")
        updated = parse_iso(entry.get("updated"))

        if updated is None:
            # updated が無い/壊れている。error が新鮮なら Layer1 可視＝warning、それ以外は RED（見落とさない）。
            status = "erroring_stale" if recent_error else "silent_stale"
            return Finding(layer, status, None, max_s, has_error, count)

        age = (now - updated).total_seconds()
        if age > max_s:  # strict `>`＝境界フラップ回避
            status = "erroring_stale" if recent_error else "silent_stale"
            return Finding(layer, status, age, max_s, has_error, count)

        # age 上は fresh。NEVER_EMPTY 層で count==0 は「新鮮な空」＝stamped-empty を warning で拾う。
        if layer in NEVER_EMPTY and count == 0:
            return Finding(layer, "fresh_empty", age, max_s, has_error, count)
        return Finding(layer, "fresh", age, max_s, has_error, count)
    except Exception:
        # どんな異常でも例外を漏らさず、見落とさない側（silent_stale）へ倒す。
        return Finding(layer, "silent_stale", None, max_s, False, None)


def evaluate(manifest, now, max_age=MAX_AGE):
    """manifest（{"layers": {...}}）を now 基準で分類し、max_age の各層に1つ Finding を返す（純粋・非raise）。"""
    layers = {}
    if isinstance(manifest, dict):
        raw = manifest.get("layers")
        if isinstance(raw, dict):
            layers = raw
    # 「どの層にも成功 updated が無い」＝cold（全 reset/clone）判定用。
    any_updated = any(
        isinstance(e, dict) and parse_iso(e.get("updated")) is not None
        for e in layers.values()
    )
    return [
        _classify(layer, layers.get(layer), now, max_age[layer], any_updated)
        for layer in max_age
    ]


def reds(findings):
    """RED（exit1 に値する）＝silent_stale のみ。erroring_stale は Layer1 が担当ゆえ含めない。"""
    return [f for f in findings if f.status == "silent_stale"]


def is_red(findings):
    return bool(reds(findings))
