"""Layer2 鮮度モニタの純ロジック（freshness_policy）と完全性契約を固定する。

Layer1 が残す2穴を cause-agnostic に塞ぐ backstop の分類ロジックをテストで縛る：
- silent-stale（last_error_at 無で古い＝穴1/穴2 の危険クラス・Layer1 が盲目）→ RED
- erroring-stale（last_error_at 有＝Layer1 が既に担当・現 ships）→ warning（RED にしない＝#1 オオカミ少年回避）
- missing/cold（reset/初回）→ warning（RED-storm 回避）
- fresh_empty（NEVER_EMPTY 層で count==0＝flights 型 stamped-empty）→ warning
完全性＝set(MAX_AGE) == eligible_layer_names()（module→layer 自動展開・停止層自動除外）。

pyyaml は使わない（root requirements.txt は Vercel 全 api/ 関数へ install されるため）。
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import collectors.lib.freshness_policy as fp
import collectors.lib.wf_eligibility as wfe

NOW = datetime(2026, 7, 21, 14, 0, 0, tzinfo=timezone.utc)


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _man(layers):
    return {"layers": layers}


def _by_layer(manifest, now=NOW):
    return {f.layer: f for f in fp.evaluate(manifest, now)}


# ── 分類ロジック（cause-agnostic age backstop の中核）
def test_fresh_layer_not_stale():
    m = _man({"flights": {"updated": _iso(NOW - timedelta(hours=1)), "count": 4000}})
    f = _by_layer(m)["flights"]
    assert f.status == "fresh"
    assert fp.is_red(fp.evaluate(m, NOW)) is False


def test_silent_stale_reds():
    # exit0-no-write（updated 凍結・last_error_at 無）＝穴2 の canonical backstop。
    m = _man({"flights": {"updated": _iso(NOW - timedelta(hours=9)), "count": 4000}})
    findings = fp.evaluate(m, NOW)
    f = _by_layer(m)["flights"]
    assert f.status == "silent_stale"
    assert fp.is_red(findings) is True


def test_erroring_stale_is_warning_not_red():
    # 現 ships（AISStream 失効・last_error_at 有）＝Layer1 が既にアラート → warning に降格。
    m = _man({"ships": {"updated": _iso(NOW - timedelta(hours=39)),
                        "count": 1960, "last_error_at": _iso(NOW)}})
    f = _by_layer(m)["ships"]
    assert f.status == "erroring_stale"
    assert f.has_error is True
    assert fp.is_red(fp.evaluate(m, NOW)) is False


def test_missing_entry_is_warning_not_red():
    # パイプライン稼働中（他層 fresh）にこの eligible 層のエントリだけ欠落 → missing（RED でなく warning）。
    m = _man({"flights": {"updated": _iso(NOW), "count": 100}})
    f = _by_layer(m)["firms"]
    assert f.status == "missing"
    assert fp.is_red(fp.evaluate(m, NOW)) is False


def test_all_missing_is_cold_not_red():
    # 全層に updated が無い＝fresh clone / full reset → cold（RED-storm を出さない）。
    m = _man({})
    findings = fp.evaluate(m, NOW)
    assert findings, "MAX_AGE 層ぶんの Finding が出るはず"
    assert all(f.status == "cold" for f in findings)
    assert fp.is_red(findings) is False


def test_updated_absent_but_error_present_is_erroring():
    # record_manifest_error だけが立った層（updated 無・last_error_at 有）＝Layer1 可視 → warning。
    m = _man({"flights": {"last_error_at": _iso(NOW)}})
    f = _by_layer(m)["flights"]
    assert f.status == "erroring_stale"
    assert fp.is_red(fp.evaluate(m, NOW)) is False


def test_unparseable_iso_is_silent_stale_no_crash():
    m = _man({"flights": {"updated": "not-a-date", "count": 5}})
    findings = fp.evaluate(m, NOW)  # 例外を投げないこと
    assert _by_layer(m)["flights"].status == "silent_stale"
    assert fp.is_red(findings) is True


def test_boundary_age_equals_max_is_fresh():
    # age == max はちょうど fresh（stale は strict `>`・真上フラップ回避）。
    max_s = fp.MAX_AGE["flights"]
    m = _man({"flights": {"updated": _iso(NOW - timedelta(seconds=max_s)), "count": 100}})
    assert _by_layer(m)["flights"].status == "fresh"


def test_count_zero_fresh_is_warning_for_never_empty():
    # HTTP200 空で fresh timestamp＋count0（flights 型 stamped-empty）＝純 age では取りこぼす → warning。
    m = _man({"flights": {"updated": _iso(NOW), "count": 0}})
    f = _by_layer(m)["flights"]
    assert f.status == "fresh_empty"
    assert fp.is_red(fp.evaluate(m, NOW)) is False


def test_count_zero_allowed_for_gdelt_layers():
    # GDELT は静穏窓で正当に 0 になりうる → conflict/protests は count==0 を warning にしない。
    m = _man({"conflict": {"updated": _iso(NOW), "count": 0}})
    assert _by_layer(m)["conflict"].status == "fresh"


def test_stale_error_with_frozen_updated_is_silent_stale():
    # 「一度 error → その後 exit0-no-write 沈黙」＝last_error_at も updated も閾値超で凍結＝
    # Layer1 は現在盲目（最後に鳴いたきり）→ RED で拾う（穴2 本命象限・レビュー確定 finding）。
    m = _man({"flights": {"updated": _iso(NOW - timedelta(days=5)), "count": 4406,
                          "last_error_at": _iso(NOW - timedelta(days=4))}})
    f = _by_layer(m)["flights"]
    assert f.status == "silent_stale"
    assert fp.is_red(fp.evaluate(m, NOW)) is True


def test_recent_error_stays_erroring_stale():
    # 現 ships（毎 run 失敗＝last_error_at 新鮮）は warning 維持＝#1 オオカミ少年回避を壊さない。
    m = _man({"ships": {"updated": _iso(NOW - timedelta(hours=65)), "count": 1960,
                        "last_error_at": _iso(NOW - timedelta(minutes=10))}})
    assert _by_layer(m)["ships"].status == "erroring_stale"
    assert fp.is_red(fp.evaluate(m, NOW)) is False


def test_thresholds_pin_loosening_direction_for_all_layers():
    # 全8層の tier 境界を『緩め方向』（Layer2 が盲目化する危険方向）で挙動固定する。
    # 閾値を大きく緩める回帰／tier 取り違え（例 conflict を slow へ）を捕捉（レビュー確定 finding）。
    for layer, max_s in fp.MAX_AGE.items():
        just_over = _man({layer: {"updated": _iso(NOW - timedelta(seconds=max_s + 120)), "count": 5}})
        assert _by_layer(just_over)[layer].status == "silent_stale", f"{layer}: 閾値+120s は RED のはず"
        just_under = _man({layer: {"updated": _iso(NOW - timedelta(seconds=max_s - 120)), "count": 5}})
        assert _by_layer(just_under)[layer].status == "fresh", f"{layer}: 閾値-120s は fresh のはず"


# ── 完全性契約（monitor 自身が層を無言で取りこぼさない＝メタ穴の封鎖）
def test_max_age_covers_exactly_eligible_layers():
    # 等式：新 eligible 層に閾値が無ければ CI 赤／停止層の残存閾値も CI 赤（両方向）。
    assert set(fp.MAX_AGE) == wfe.eligible_layer_names()


def test_gdelt_expands_to_conflict_and_protests():
    names = wfe.eligible_layer_names()
    assert {"conflict", "protests"} <= names
    assert "gdelt_events" not in names  # module 名でなく層名（footgun 固定）


def test_stopped_layers_absent_from_max_age():
    for m in ("news", "briefing", "forecast", "instability"):
        assert m not in fp.MAX_AGE, f"{m} は意図停止＝監視対象にしない（24日 stale で誤警報しない）"


def test_thresholds_above_observed_drift_floor():
    # 観測最悪 gap（4.9h）未満へ誰も締められない（生存者バイアスでの過度な tightening を静的封鎖）。
    assert all(v >= fp.OBSERVED_MAX_GAP_S for v in fp.MAX_AGE.values())


def test_completeness_breaks_if_threshold_removed():
    # 完全性等式が「閾値を1つ落とす」変異で実際に壊れることを証明する。
    partial = dict(fp.MAX_AGE)
    partial.pop("flights")
    assert set(partial) != wfe.eligible_layer_names()
