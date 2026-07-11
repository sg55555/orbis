#!/usr/bin/env python3
"""地域(国/県/都市)の Wikipedia(ja)/Wikidata 事実を Claude で日本語プロフィール化し
data/static/profiles/** ＋ profiles_manifest.json を生成する（build 時オフライン）。

新スキーマ v2（因果レイヤー/確度/年表/観光・§docs/superpowers/specs/2026-07-04-...）を
Anthropic Message Batches API（50%オフ）で一括生成する。PASS1（全対象の取得＋プロンプト
構築・LLM未呼び出し）→ PASS2（Batch 送信・回収・custom_id ひも付け・パース・書き出し）の
2パス構成。PROFILE_BATCH=0 で generate_profile_v2 の逐次呼び出しにフォールバック（少数検証用）。
ANTHROPIC_API_KEY 必須（無ければ全 degraded・事実のみ表示）。

旧スキーマ（sections[{title,body}]）の PROFILE_DUMMY=1 デザイン確認パイプラインは
非破壊で残置（フロントの新スキーマ移行が終わるまでの互換用）。

対象国は env PROFILE_FIPS（カンマ区切り FIPS・既定=FIPS_JA 全部）。
キャッシュ scripts/.cache/profiles/ に raw/生成を保存し再実行はスキップ（v2 は v2_* 別名）。
実行: PYTHONPATH=. python3 scripts/build_profiles.py
"""
import gzip
import hashlib
import json
import os
import re
import time

import requests

from scripts.lib.profile_prep import (
    generate_profile, resolve_qid, SECTIONS,
    generate_profile_v2, wikidata_facts, named_props, ja_wikipedia_title,
    extract_sections, build_profile_prompt_v2, parse_profile_v2,
    assemble_profile_v2, is_degraded_v2, PROFILE_SYSTEM_V2, is_safe_custom_id,
    strip_profile_labels, is_suspicious_name_ja,
)
from scripts.lib.pinyin_kana import name_to_reading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NE = os.path.join(ROOT, "scripts/.cache/ne")
CACHE = os.path.join(ROOT, "scripts/.cache/profiles")
OUT = os.path.join(ROOT, "data/static/profiles")
MODEL = os.environ.get("PROFILE_LLM_MODEL", "claude-sonnet-4-6")
UA = {"User-Agent": "orbis-profile-collector"}
FETCH_MAX_RETRIES = 6  # 429/例外時の指数バックオフ上限（2^5=32s まで・連続fetchのレート制限に強く）
PROFILE_SYSTEM = ("あなたは地理事典の編集者です。与えられた事実のみを根拠に、"
                  "字幕でなく説明文として自然で簡潔な日本語プロフィールを作ります。")


def load_fips_ja():
    src = open(os.path.join(ROOT, "js/lib/places.js"), encoding="utf-8").read()
    body = re.search(r"export const FIPS_JA = \{(.*?)\};", src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def _cache_get(name):
    p = os.path.join(CACHE, name)
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _cache_put(name, obj):
    os.makedirs(CACHE, exist_ok=True)
    json.dump(obj, open(os.path.join(CACHE, name), "w", encoding="utf-8"), ensure_ascii=False)


def _fetch_sleep(mult=1.0):
    """fetch 間の待機秒（PROFILE_FETCH_SLEEP 既定 0.5）× mult。呼び出し毎に env を読む（テスト可能）。
    連続 fetch のレート制限で Wikipedia 本文が空→即 degraded になるのを緩和する。生成キャッシュにより
    再実行は degraded 部分だけ fetch なので、sleep を上げても再実行は速い。"""
    return float(os.environ.get("PROFILE_FETCH_SLEEP", "0.5")) * mult


def _gen_cache_name(cid):
    """v2 生成キャッシュのファイル名。custom_id をファイル名安全に正規化する。非 degraded の cid は
    Batch の ^[a-zA-Z0-9_-]{1,64}$ 準拠で既に安全だが、_gen_cache_get は degrade 候補（qid 無し等）の
    cid でも呼ばれるため防御的に正規化する（cache dir 外への脱出防止）。"""
    return f"v2_prof_{re.sub(r'[^A-Za-z0-9_-]', '_', cid)}.json"


def _gen_cache_get(cid):
    """成功済み（非 degraded）の生成プロフィールがキャッシュにあれば返す（無ければ None）。
    _gen_cache_put で非 degraded のみ書かれるが、防御的に degraded/非 dict は None 扱い。"""
    prof = _cache_get(_gen_cache_name(cid))
    if isinstance(prof, dict) and not prof.get("degraded"):
        return prof
    return None


def _gen_cache_put(cid, prof):
    """生成プロフィールを **非 degraded の時だけ** キャッシュに書く（degraded は保存せず次回再生成）。
    唯一の無効化ルール。プロンプト/スキーマ変更時は scripts/.cache/profiles/v2_prof_* を手動削除する。"""
    if prof and not prof.get("degraded"):
        _cache_put(_gen_cache_name(cid), prof)


def _get_with_retry(url, params=None, max_retries=FETCH_MAX_RETRIES):
    """GET を 429（レート制限）や例外時に指数バックオフでリトライする（fetch_wikidata /
    fetch_article_plaintext / fetch_wikidata_props 共通）。8c 品質ゲートで発覚したバグ（レート制限で
    空応答→そのまま無条件キャッシュ→以後ずっと空のまま）への対策。最終的に成功すれば Response を、
    上限まで失敗したら None を返す。None は呼び出し側で「取得失敗＝キャッシュしない」の合図として扱うこと。"""
    for attempt in range(max_retries):
        try:
            r = requests.get(url, params=params, timeout=30, headers=UA)
            if r.status_code == 429:
                raise requests.exceptions.HTTPError(f"429 rate limited: {url}")
            r.raise_for_status()
            return r
        except Exception:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    return None


def _json_ok(r):
    """_get_with_retry の Response から JSON を取り出す。r が None（HTTP 失敗）、JSON パース失敗、
    または MediaWiki が高負荷時に返す top-level "error" キー（HTTP 200 + maxlag 等で "entities"/"query"
    が欠落する）を、すべて「取得失敗」として扱い (None, False) を返す。成功時は (data, True)。
    False の chunk/地域は呼び出し側でキャッシュせず次回再取得させる（8c 品質ゲート修正）。"""
    if r is None:
        return None, False
    try:
        data = r.json()
    except Exception:
        return None, False
    if isinstance(data, dict) and "error" in data:
        return None, False
    return data, True


def fetch_wikidata(qid):
    """QID → Wikidata entity（v1 関数だが v2 の _pass1_prepare/generate_profile_v2 で全地域に呼ばれる
    本番ホットパス）。429/例外は _get_with_retry で指数バックオフ再試行し、maxlag 等の "error" 応答も
    失敗扱い。**entity を取得できたときだけ `_cache_put`**（None/失敗はキャッシュせず次回再取得＝
    fetch_article_plaintext と同じ契約。8c 品質ゲートで発覚した「レート制限の None を永久キャッシュ→
    facts/named_props/title 全滅で degraded 永久固定」バグの修正）。"""
    cached = _cache_get(f"wd_{qid}.json")
    if cached is not None:
        return cached.get("entity")
    url = f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
    data, ok = _json_ok(_get_with_retry(url))
    entity = (data.get("entities") or {}).get(qid) if ok else None
    if entity is not None:  # 取得成功時のみキャッシュ（None/失敗は再取得可能なままにする）
        _cache_put(f"wd_{qid}.json", {"entity": entity})
    time.sleep(_fetch_sleep())
    return entity


def fetch_wikipedia(title):
    key = hashlib.md5(title.encode("utf-8")).hexdigest()
    cached = _cache_get(f"wp_{key}.json")
    if cached is not None:
        return cached.get("summary")
    url = "https://ja.wikipedia.org/api/rest_v1/page/summary/" + requests.utils.quote(title, safe="")
    try:
        r = requests.get(url, timeout=30, headers=UA)
        r.raise_for_status()
        summary = r.json().get("extract") or None
    except Exception:
        summary = None
    _cache_put(f"wp_{key}.json", {"summary": summary})
    time.sleep(0.2)
    return summary


def ask_llm(prompt):
    # ダミーモード(PROFILE_DUMMY=1): 実 LLM を呼ばずデザイン確認用のサンプル本文を返す（API キー不要）。
    if os.environ.get("PROFILE_DUMMY") == "1":
        return json.dumps({"sections": [
            {"title": t, "body": f"（サンプル）{t}の説明テキスト。デザイン・体裁確認用のダミーです。"}
            for t in SECTIONS]}, ensure_ascii=False)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return ""
    try:
        import anthropic
        client = anthropic.Anthropic()
        msg = client.messages.create(model=MODEL, max_tokens=1200, temperature=0,
                                     system=PROFILE_SYSTEM,
                                     messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text
    except Exception as e:
        print(f"[profiles] llm error: {e}")
        return ""


DUMMY = os.environ.get("PROFILE_DUMMY") == "1"


def _dummy_wikidata(qid):
    return {"claims": {"P1082": [{"mainsnak": {"datavalue": {"value": {"amount": "+1000000"}}}}],
                       "P2046": [{"mainsnak": {"datavalue": {"value": {"amount": "+1000"}}}}]},
            "sitelinks": {"jawiki": {"title": "（ダミー）"}}}


def _dummy_wikipedia(title):
    return "（ダミー要約）デザイン・体裁確認用のサンプル説明文です。"


def _gen_cached(level, pid, name_ja, qid):
    """generated_<level>_<pid>.json をキャッシュ。無ければ生成。ダミーは別キャッシュ名。
    （旧スキーマ v1・PROFILE_DUMMY=1 のデザイン確認パイプライン専用。v2 は _pass1_prepare/run_batch/generate_profile_v2。）"""
    cname = f"{'dummy_' if DUMMY else ''}gen_{level}_{re.sub(r'[^A-Za-z0-9_-]', '_', pid)}.json"
    cached = _cache_get(cname)
    if cached is not None:
        return cached
    fw = _dummy_wikidata if DUMMY else fetch_wikidata
    fwp = _dummy_wikipedia if DUMMY else fetch_wikipedia
    prof = generate_profile(level, pid, name_ja, qid or ("Q_DUMMY" if DUMMY else None),
                            fetch_wikidata=fw, fetch_wikipedia=fwp, ask_llm=ask_llm)
    _cache_put(cname, prof)
    return prof


# ============================================================
# v2（因果レイヤー/確度/年表/観光・Anthropic Message Batches API）
# ============================================================

def fetch_wikidata_props(qids):
    """QID リスト → 日本語ラベル dict（wbgetentities batch・QID 単位キャッシュ v2_label_*）。
    named_props の label_resolver として注入する。未解決 QID は None（呼び側の dedup_names で除外）。
    429/例外は _get_with_retry で指数バックオフ再試行。chunk の HTTP 取得そのものが最終的に失敗した
    場合（レート制限で entities が得られなかった場合）は、その chunk の全 QID を **キャッシュしない**
    （見かけ上は今回 None を返すが、次回実行時に再取得できるようにするため。8c 品質ゲートで発覚した
    「レート制限の空応答を無条件キャッシュして以後ずっと degraded のまま」というバグの修正）。
    個々の QID に ja ラベルが本当に無い（chunk 取得自体は成功）場合の None は正当な結果としてキャッシュする。"""
    qids = list(dict.fromkeys(q for q in qids if q))  # 順序保持で重複除去
    out = {}
    missing = []
    for q in qids:
        cached = _cache_get(f"v2_label_{q}.json")
        if cached is not None:
            out[q] = cached.get("label")
        else:
            missing.append(q)
    for i in range(0, len(missing), 50):  # wbgetentities の ids 上限（通常ユーザー）
        chunk = missing[i:i + 50]
        data, fetched_ok = _json_ok(_get_with_retry("https://www.wikidata.org/w/api.php", params={
            "action": "wbgetentities", "ids": "|".join(chunk),
            "props": "labels", "languages": "ja", "format": "json",
        }))
        entities = (data.get("entities") or {}) if fetched_ok else {}
        for q in chunk:
            label = None
            v = (((entities.get(q) or {}).get("labels") or {}).get("ja") or {}).get("value")
            if isinstance(v, str) and v.strip():
                label = v.strip()
            out[q] = label
            if fetched_ok:  # chunk 取得が成功した場合のみキャッシュ（レート制限の空応答は非キャッシュ）
                _cache_put(f"v2_label_{q}.json", {"label": label})
        time.sleep(_fetch_sleep(2))
    return out


def fetch_article_plaintext(title):
    """ja Wikipedia extracts(explaintext) で全文プレーンテキストを取得（v2・キャッシュ v2_wp_*）。
    extract_sections で節抽出する前段。取得失敗/該当ページ無しは空文字。
    429/例外は _get_with_retry で指数バックオフ再試行。「レート制限による一時的な空」と「ページが
    本当に存在せず extract が空の正当な空」をコードで確実に区別できないため、安全側に倒して
    **非空テキストが取れたときだけキャッシュ**する（8c 品質ゲートで発覚した「レート制限の空応答を
    無条件キャッシュして以後ずっと degraded のまま」というバグの修正。空/失敗は次回実行時に
    再取得できるようキャッシュしない）。"""
    key = hashlib.md5(title.encode("utf-8")).hexdigest()
    cname = f"v2_wp_{key}.json"
    cached = _cache_get(cname)
    if cached is not None:
        return cached.get("text") or ""
    data, ok = _json_ok(_get_with_retry("https://ja.wikipedia.org/w/api.php", params={
        "action": "query", "prop": "extracts", "explaintext": 1,
        "titles": title, "format": "json",
    }))
    text = ""
    if ok:
        pages = ((data.get("query") or {}).get("pages") or {})
        page = next(iter(pages.values()), {}) if pages else {}
        text = page.get("extract") or ""
    if text:  # 非空のときだけキャッシュ（空/失敗は再取得可能なままにする）
        _cache_put(cname, {"text": text})
    time.sleep(_fetch_sleep(2))
    return text


def ask_llm_v2(prompt):
    """v2 逐次 LLM 呼び出し（PROFILE_BATCH=0 の少数検証/ダミー用フォールバック）。
    ANTHROPIC_API_KEY 無ければ空文字（呼び出し元で degraded 扱いになる・generate_profile_v2 と同じ規約）。"""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return ""
    try:
        import anthropic
        client = anthropic.Anthropic()
        msg = client.messages.create(model=MODEL, max_tokens=2000, temperature=0,
                                     system=PROFILE_SYSTEM_V2,
                                     messages=[{"role": "user", "content": prompt}])
        return next((b.text for b in msg.content if getattr(b, "type", None) == "text"), "")
    except Exception as e:
        print(f"[profiles] llm error: {e}")
        return ""


# level 別 max_tokens（Batch API request 構築用・応答の上限＝ceiling ゆえ短い応答の課金は不変、
# 長い応答の truncate だけ防ぐ）。US 大都市(シカゴ/ワシントンD.C.等)は本文が長く 6000 では
# stop_reason=="max_tokens" で JSON が途中打ち切り→parse 失敗→degraded になったため 8000 に統一。
MAX_TOKENS_BY_LEVEL = {"country": 8000, "admin1": 8000, "city": 8000}
DEFAULT_MAX_TOKENS = 8000


def _max_tokens_for_cid(cid):
    """custom_id (= f"{level}_{pid}"、_pass1_prepare 参照) から level を取り出し level 別 max_tokens を返す。
    未知の level は DEFAULT_MAX_TOKENS にフォールバック。custom_id は Batch API のパターン
    ^[a-zA-Z0-9_-]{1,64}$ に従う（区切りはコロン不可 → アンダースコア）。"""
    level = cid.split("_", 1)[0]
    return MAX_TOKENS_BY_LEVEL.get(level, DEFAULT_MAX_TOKENS)


def run_batch(prompts):
    """prompts: list[(custom_id, prompt)] → {custom_id: response_text}。
    Anthropic Message Batches API（50%オフ）。custom_id で結果をひも付ける（順序は保証されない＝
    位置対応させない）。実行は課金を伴う（Task5では未実行・配線のみ。実行はユーザー承認後の Task8）。
    anthropic は遅延 import（未インストールでも本モジュールの import/pytest 収集を壊さない）。
    max_tokens は level 別（_max_tokens_for_cid）。succeeded でも stop_reason=="max_tokens" は
    truncate（課金済みだが本文欠落→parse_profile_v2 失敗→silent degraded）のサインなので warn する。"""
    import anthropic
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    client = anthropic.Anthropic()
    reqs = [Request(custom_id=cid, params=MessageCreateParamsNonStreaming(
                model=MODEL, max_tokens=_max_tokens_for_cid(cid), temperature=0, system=PROFILE_SYSTEM_V2,
                messages=[{"role": "user", "content": p}]))
            for cid, p in prompts]
    batch = client.messages.batches.create(requests=reqs)
    while client.messages.batches.retrieve(batch.id).processing_status != "ended":
        time.sleep(30)
    out = {}
    for r in client.messages.batches.results(batch.id):
        if r.result.type == "succeeded":
            stop_reason = getattr(r.result.message, "stop_reason", None)
            if stop_reason == "max_tokens":
                print(f"[profiles] WARN: max_tokens で打ち切り ({r.custom_id}) — "
                      f"課金済みだが応答が truncate され本文が不完全な degraded になる可能性があります")
            elif stop_reason == "refusal":
                print(f"[profiles] WARN: refusal で応答拒否 ({r.custom_id}) — 本文が空で degraded になります")
            text = next((b.text for b in r.result.message.content if b.type == "text"), "")
            if not text.strip():
                print(f"[profiles] WARN: 応答テキストが空 ({r.custom_id} / stop={stop_reason}) — degraded になります")
            out[r.custom_id] = text
        else:
            # succeeded 以外(errored/canceled/expired)は out に入らず無言で degraded 化していた。
            # どの custom_id がなぜ落ちたかを必ずログする（degraded の原因診断のため）。
            err = getattr(r.result, "error", None)
            etype = getattr(err, "type", None) or getattr(getattr(err, "error", None), "type", None)
            emsg = getattr(err, "message", None) or getattr(getattr(err, "error", None), "message", "")
            print(f"[profiles] WARN: batch result {r.result.type} ({r.custom_id}) — "
                  f"degraded になります。error_type={etype} message={emsg}")
    n_ok, n_req = len(out), len(prompts)
    if n_ok < n_req:
        print(f"[profiles] batch 成功 {n_ok}/{n_req}（{n_req - n_ok} 件が非成功/空応答で degraded）")
    return out


def _country_qid_by_fips(features):
    """NE admin0 features → {FIPS: QID}。同じ FIPS に複数国が落ちる2種の衝突を優先規則で捌く:
    ①ISO_A2 が汚れている国（台湾は "CN-TW"・ノルウェー/コソボ/フランス/係争領土は "-99" 等）は
      clean な ISO_A2 で引けないため ISO_A2_EH でフォールバックする。
    ②下位地域が本土と同じ FIPS を共有する（オーランド AX と本土フィンランド FI は共に FIPS "FI"）。
    3パス構成（すべて setdefault = 先勝ち固定・後段は既取得 FIPS を上書きしない）:
      A1: clean ISO_A2 かつ主権国（ADMIN==SOVEREIGNT）を最優先確定（Åland より Finland）。
      A2: 残る clean ISO_A2（従属地域）を補完。
      B : ISO_A2_EH フォールバック（ISO_A2 汚染国）。
    これがないと台湾 country は qid=None（5層分析が永続 degraded）、FI は Åland(Q5689) 誤解決になる。"""
    from scripts.lib.fips_of_iso import FIPS_OF_ISO
    qid_by_fips = {}

    def _claim(iterable, iso_key):
        for f in iterable:
            p = f["properties"]
            fp = FIPS_OF_ISO.get((p.get(iso_key) or "").upper())
            q = resolve_qid(p)
            if fp and q:
                qid_by_fips.setdefault(fp, q)

    def _is_sovereign(f):
        p = f["properties"]
        return (p.get("ADMIN") or None) == (p.get("SOVEREIGNT") or None)

    _claim((f for f in features if _is_sovereign(f)), "ISO_A2")  # A1: 主権国優先
    _claim(features, "ISO_A2")                                    # A2: 従属地域を補完
    _claim(features, "ISO_A2_EH")                                 # B : EH フォールバック
    return qid_by_fips


# --- データ是正 override（2.5c 実機点検で確定・regeneration 時に適用） ---
# admin1 の QID を人手で確定した curated override（NE の resolve_qid より優先＝常に上書き）。
# TW-TXG 台中市（台湾第2都市・admin1で唯一の wikidataid 空白で永続 degraded）は都市 Q245023 と同一エンティティ。
ADMIN1_QID_OVERRIDE = {"TW-TXG": "Q245023"}
# cities/*.json の name_ja が QID/座標の指す実際の場所と別（大都市の同音名に誤ラベル）の是正。
# QID/座標/en/zh は小さな町で一致し name_ja だけ誤り → name_ja を実地名へ補正する。
CITY_NAME_JA_OVERRIDE = {
    "Q11060772": "平地泉鎮",  # 済寧(山東)に誤ラベル→実体は内モンゴルの平地泉鎮
    "Q10884943": "伊図里河鎮",  # 玉林(広西)に誤ラベル→実体は内モンゴルの伊図里河鎮
    "Q4778099": "安西",       # 安渓(福建)に誤ラベル→実体は甘粛の安西
}
# reading（現地音カタカナ）を付与する対象＝ピンイン＝中国語発音が正しく当たる中国語圏のみ。
READING_FIPS = {"CH", "TW"}


def _warn_suspicious(name_ja, level, pid):
    """name_ja が文字化けの疑い（漢字中の孤立カタカナ/置換文字）なら warn（regeneration 時の検知網）。"""
    if is_suspicious_name_ja(name_ja):
        print(f"[profiles] WARN: name_ja に文字化けの疑い ({level}_{pid} / {name_ja!r}) — "
              f"CITY_NAME_JA_OVERRIDE 等での是正を検討してください")


def _country_of(prof):
    """プロフィールの所属国 FIPS（country は自身の id・admin1/city は belongs_to.id）。"""
    if prof.get("level") == "country":
        return prof.get("id")
    return (prof.get("belongs_to") or {}).get("id")


def _add_reading(prof):
    """中国・台湾の県/都市の地域名に現地音カタカナ読みを付与（build 時・LLM 不使用）。
    国名（中国/台湾）自体は日本語話者に既知のため付けない＝『読めない地名の補助』の意図に沿う。
    他体系/変換不能は付けない。"""
    if prof.get("level") != "country" and _country_of(prof) in READING_FIPS:
        r = name_to_reading(prof.get("name_ja"))
        if r:
            prof["reading"] = r
    return prof


def _collect_targets(fips_ja, targets):
    """(level, pid, name_ja, qid, belongs_to) のリストを構築（country→admin1→city の順）。
    国/県/都市の対象発見ロジックは v1 main() を踏襲（NE admin0/admin1・cities/<FIPS>.json）。
    belongs_to は国のみ None・県/都市は所属国 {"level":"country","id":fips,"name_ja":...}（外交リンク・§spec6）。"""
    items = []

    # 国: NE admin0 から QID（ISO_A2 汚染国は ISO_A2_EH フォールバック）。
    ne0 = json.load(open(os.path.join(NE, "ne_50m_admin_0_countries.geojson"), encoding="utf-8"))
    qid_by_fips = _country_qid_by_fips(ne0["features"])

    for fips in targets:
        name_ja = fips_ja.get(fips, fips)
        items.append(("country", fips, name_ja, qid_by_fips.get(fips), None))

    # 県/州: NE admin1（a1code・wikidataid）。対象国のみ。
    ne1 = json.load(open(os.path.join(NE, "ne_10m_admin_1_states_provinces.geojson"), encoding="utf-8"))
    from scripts.lib.ne_prep import resolve_fips, is_excluded_admin1
    name_index = {f["properties"]["name"]: f["properties"]["code"]
                  for f in json.load(open(os.path.join(ROOT, "data/static/country_bounds.geojson"), encoding="utf-8"))["features"]}
    for f in ne1["features"]:
        p = f["properties"]
        fips = resolve_fips(p, name_index)
        if fips not in targets:
            continue
        a1 = p.get("iso_3166_2") or p.get("code_hasc") or p.get("adm1_code")
        if not a1:
            continue
        if is_excluded_admin1(a1):  # 係争地（例 CN-X01~ パラセル諸島）は主権国 admin1 として生成しない
            continue
        name_ja = p.get("name_ja") or p.get("name") or a1
        _warn_suspicious(name_ja, "admin1", a1)
        qid = ADMIN1_QID_OVERRIDE.get(a1) or resolve_qid(p)  # NE の wikidataid 欠落を補完
        belongs_to = {"level": "country", "id": fips, "name_ja": fips_ja.get(fips, fips)}
        items.append(("admin1", a1, name_ja, qid, belongs_to))

    # 都市: cities/<FIPS>.json（qid 付与済）。対象国のみ。
    for fips in targets:
        cpath = os.path.join(ROOT, "data/static/cities", f"{fips}.json")
        if not os.path.exists(cpath):
            continue
        belongs_to = {"level": "country", "id": fips, "name_ja": fips_ja.get(fips, fips)}
        for c in json.load(open(cpath, encoding="utf-8")):
            qid = c.get("qid") or None
            if not qid:
                continue
            name_ja = CITY_NAME_JA_OVERRIDE.get(qid) or c.get("name_ja") or c.get("name") or qid
            _warn_suspicious(name_ja, "city", qid)
            items.append(("city", qid, name_ja, qid, belongs_to))

    return items


def _pass1_prepare(items, generated_at):
    """PASS1: 全対象の Wikidata/Wikipedia 取得＋プロンプト構築（LLM未呼び出し）。
    qid 無し／本文(節抽出後)が空、のいずれかは即 degraded profile を組み立てて immediate へ
    （Batch 対象外）。それ以外は prompts へ (custom_id, prompt) を積み、pending に組立材料を保持する。
    custom_id (= f"{level}_{pid}") は admin1 の iso_3166_2/code_hasc/adm1_code フォールバックや
    city の qid 跨ぎ等で重複し得る。Batch API は重複 custom_id を 400 で拒否し run 全体を落とすため、
    2件目以降は Wikidata/Wikipedia を取得する前にスキップして warn する（dedupe・run は止めない）。
    戻り値: (immediate: [(level,pid,prof)], prompts: [(custom_id,prompt)], pending: {custom_id: dict})"""
    immediate = []
    prompts = []
    pending = {}
    seen_cids = set()
    for level, pid, name_ja, qid, belongs_to in items:
        cid = f"{level}_{pid}"
        if not is_safe_custom_id(cid):
            # Batch API custom_id 規則違反（例 pid に "~" を含む係争地コード）は run 全体を 400 で
            # 落とすため、Batch へ送らずスキップして warn（denylist を擦り抜けた不正 pid の最終防御）。
            print(f"[profiles] WARN: 不正な custom_id をスキップ ({cid} / {name_ja}) — "
                  f"Batch API は [a-zA-Z0-9_-]{{1,64}} のみ許容")
            continue
        if cid in seen_cids:
            print(f"[profiles] WARN: 重複 custom_id をスキップ ({cid} / {name_ja}) — "
                  f"Batch API は同一 custom_id を拒否するため後続の対象は無視されます")
            continue
        seen_cids.add(cid)
        cached_prof = _gen_cache_get(cid)
        if cached_prof is not None:
            immediate.append((level, pid, cached_prof))  # 成功済み=fetch/Batch skip（再課金なし）
            continue
        if not qid:
            prof = assemble_profile_v2(pid, level, name_ja, wikidata_facts({}),
                                       {"layers": [], "timeline": [], "tourism": []},
                                       {"qid": None, "wikipedia_url": None, "wikidata_props": []},
                                       True, belongs_to, generated_at)
            immediate.append((level, pid, prof))
            continue
        entity = fetch_wikidata(qid) or {}
        facts = wikidata_facts(entity)
        named = named_props(entity, label_resolver=fetch_wikidata_props)
        title = ja_wikipedia_title(entity)
        section_text = extract_sections(fetch_article_plaintext(title)) if title else ""
        url = f"https://ja.wikipedia.org/wiki/{title}" if title else None
        props = [p for p, v in [("P37", named["languages"]), ("P47", named["borders"]), ("P463", named["memberships"])] if v]
        source = {"qid": qid, "wikipedia_url": url, "wikidata_props": props}
        if not section_text:
            prof = assemble_profile_v2(pid, level, name_ja, facts,
                                       {"layers": [], "timeline": [], "tourism": []},
                                       source, True, belongs_to, generated_at)
            immediate.append((level, pid, prof))
            continue
        belongs_name = (belongs_to or {}).get("name_ja") if belongs_to else None
        prompt = build_profile_prompt_v2(name_ja, level, facts, named, section_text, belongs_name)
        prompts.append((cid, prompt))
        pending[cid] = {"level": level, "pid": pid, "name_ja": name_ja, "facts": facts,
                        "source": source, "belongs_to": belongs_to}
    return immediate, prompts, pending


def _pass2_finish(pending, results, generated_at):
    """PASS2: run_batch の結果(custom_id→応答テキスト)をパース・組立。
    custom_id でひも付け（Batch の結果順序は不定＝位置で対応させない）。結果に無い custom_id
    （failed/expired 等）は応答テキスト無し扱い＝parse_profile_v2("") で degraded になる。"""
    out = []
    for cid, meta in pending.items():
        text = results.get(cid, "")
        parsed = parse_profile_v2(text)
        degraded = is_degraded_v2(meta["source"]["qid"], parsed)
        if degraded and text.strip():
            # Batch応答はあるのに layers を取れず degraded＝非JSON/想定外フォーマット。頭を出して診断可能にする。
            print(f"[profiles] WARN: batch応答はあるが parse で layers 0件→degraded ({cid} / {meta['name_ja']}) "
                  f"resp_len={len(text)} head={text[:140]!r}")
        prof = assemble_profile_v2(meta["pid"], meta["level"], meta["name_ja"], meta["facts"],
                                   parsed, meta["source"], degraded,
                                   meta["belongs_to"], generated_at)
        out.append((meta["level"], meta["pid"], prof))
    return out


def _write(level, pid, prof, gz):
    d = os.path.join(OUT, level)
    os.makedirs(d, exist_ok=True)
    if gz:
        path = os.path.join(d, f"{pid}.json.gz")
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(prof, f, ensure_ascii=False, separators=(",", ":"))
    else:
        path = os.path.join(d, f"{pid}.json")
        json.dump(prof, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(path)


def merge_manifest(existing, current):
    """既存 manifest に current を level 別マージ（同 id は current 優先・他 id は温存）。
    国単位インクリメンタル生成で、日本のみ実行しても他国のエントリが消えない（純関数）。"""
    return {level: {**(existing.get(level) or {}), **(current.get(level) or {})}
            for level in ("country", "admin1", "city")}


def _load_manifest():
    """既存 profiles_manifest.json を読む（無ければ空の3レベル dict）。"""
    p = os.path.join(ROOT, "data/static/profiles_manifest.json")
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return {"country": {}, "admin1": {}, "city": {}}


def _write_manifest(manifest, targets):
    """profiles_manifest.json を atomic に書く（同ディレクトリの .tmp へ dump → os.replace）。
    truncate-then-write だとクラッシュ時に破損 JSON が残り、次回 _load_manifest が JSONDecodeError で
    空 dict にフォールバック→マージで他国のエントリが全消滅する（本機能が防ぐべきバグそのもの）。
    os.replace は同一ファイルシステム上で atomic なので同ディレクトリの .tmp を使う。"""
    os.makedirs(OUT, exist_ok=True)
    merged = merge_manifest(_load_manifest(), manifest)
    path = os.path.join(ROOT, "data/static/profiles_manifest.json")
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp_path, path)
    nc, na, ncity = len(merged["country"]), len(merged["admin1"]), len(merged["city"])
    print(f"[profiles] manifest total: country={nc} admin1={na} city={ncity} "
          f"(this run targets={targets[:5]}{'…' if len(targets) > 5 else ''})")


def _write_all(finished):
    """finished=[(level,pid,prof)] を disk 書き出し＋成功のみ生成キャッシュ＋manifest を構築して返す。
    country は非 gz・admin1/city は gz（_main_v2 のインライン処理を抽出・テスト可能化）。"""
    manifest = {"country": {}, "admin1": {}, "city": {}}
    for level, pid, prof in finished:
        # 出力チョークポイントで確度ラベル注記を除去（生成キャッシュ由来の immediate は parse を経ず
        # strip 前のため、書き出し前にここで一括除去してキャッシュも self-heal させる）。
        strip_profile_labels(prof)
        _add_reading(prof)  # 中国/台湾のみ現地音カタカナ読みを付与（キャッシュ由来も self-heal）
        b = _write(level, pid, prof, gz=(level != "country"))
        _gen_cache_put(f"{level}_{pid}", prof)  # 内部で degraded を skip（成功のみ保存）
        manifest[level][pid] = {"bytes": b, "degraded": prof["degraded"]}
    return manifest


def _main_dummy(fips_ja, targets):
    """旧スキーマ v1・PROFILE_DUMMY=1 デザイン確認パイプライン（非破壊で残置）。
    実 HTTP/実 LLM を呼ばずサンプル本文を生成（_dummy_wikidata/_dummy_wikipedia/ask_llm の PROFILE_DUMMY 分岐）。"""
    manifest = {"country": {}, "admin1": {}, "city": {}}

    # 国: NE admin0 から QID（ISO_A2 汚染国は ISO_A2_EH フォールバック）。
    ne0 = json.load(open(os.path.join(NE, "ne_50m_admin_0_countries.geojson"), encoding="utf-8"))
    qid_by_fips = _country_qid_by_fips(ne0["features"])

    for fips in targets:
        name_ja = fips_ja.get(fips, fips)
        prof = _gen_cached("country", fips, name_ja, qid_by_fips.get(fips))
        b = _write("country", fips, prof, gz=False)
        manifest["country"][fips] = {"bytes": b, "degraded": prof["degraded"]}

    # 県/州: NE admin1（a1code・wikidataid）。対象国のみ。
    ne1 = json.load(open(os.path.join(NE, "ne_10m_admin_1_states_provinces.geojson"), encoding="utf-8"))
    from scripts.lib.ne_prep import resolve_fips, is_excluded_admin1
    name_index = {f["properties"]["name"]: f["properties"]["code"]
                  for f in json.load(open(os.path.join(ROOT, "data/static/country_bounds.geojson"), encoding="utf-8"))["features"]}
    for f in ne1["features"]:
        p = f["properties"]
        fips = resolve_fips(p, name_index)
        if fips not in targets:
            continue
        a1 = p.get("iso_3166_2") or p.get("code_hasc") or p.get("adm1_code")
        if not a1:
            continue
        if is_excluded_admin1(a1):  # 係争地（例 CN-X01~ パラセル諸島）は主権国 admin1 として生成しない
            continue
        name_ja = p.get("name_ja") or p.get("name") or a1
        prof = _gen_cached("admin1", a1, name_ja, resolve_qid(p))
        b = _write("admin1", a1, prof, gz=True)
        manifest["admin1"][a1] = {"bytes": b, "degraded": prof["degraded"]}

    # 都市: cities/<FIPS>.json（qid 付与済）。対象国のみ。
    for fips in targets:
        cpath = os.path.join(ROOT, "data/static/cities", f"{fips}.json")
        if not os.path.exists(cpath):
            continue
        for c in json.load(open(cpath, encoding="utf-8")):
            qid = c.get("qid") or None
            if not qid:
                continue
            name_ja = c.get("name_ja") or c.get("name") or qid
            prof = _gen_cached("city", qid, name_ja, qid)
            b = _write("city", qid, prof, gz=True)
            manifest["city"][qid] = {"bytes": b, "degraded": prof["degraded"]}

    _write_manifest(manifest, targets)


def _main_v2(fips_ja, targets):
    """v2（Batch API）本線。PROFILE_BATCH=0 で generate_profile_v2 の逐次呼び出しにフォールバック
    （少数検証用・Batch を経由しない）。既定は PASS1（取得＋プロンプト構築）→PASS2（Batch回収→組立）。
    ANTHROPIC_API_KEY 無しは全 degraded（ask_llm_v2/run_batch いずれも空応答扱いに帰着）。"""
    items = _collect_targets(fips_ja, targets)
    generated_at = time.strftime("%Y-%m-%d")

    if os.environ.get("PROFILE_BATCH") == "0":
        finished = [
            (level, pid, generate_profile_v2(
                level, pid, name_ja, qid, belongs_to, generated_at,
                fetch_wikidata=fetch_wikidata, fetch_article=fetch_article_plaintext,
                label_resolver=fetch_wikidata_props, ask_llm=ask_llm_v2))
            for level, pid, name_ja, qid, belongs_to in items
        ]
    else:
        immediate, prompts, pending = _pass1_prepare(items, generated_at)
        has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
        print(f"[profiles] PASS1: immediate(degraded)={len(immediate)} / Batch対象prompts={len(prompts)} / "
              f"ANTHROPIC_API_KEY={'set' if has_key else 'UNSET'}")
        if prompts and not has_key:
            print(f"[profiles] WARN: ANTHROPIC_API_KEY 未設定のため Batch をスキップ — "
                  f"{len(prompts)}件が生成されず degraded のままになります")
        if prompts and has_key:
            print(f"[profiles] run_batch: {len(prompts)}件を Batch API へ送信して生成します…")
        results = run_batch(prompts) if prompts and has_key else {}
        finished = immediate + _pass2_finish(pending, results, generated_at)

    manifest = _write_all(finished)

    _write_manifest(manifest, targets)


def main():
    fips_ja = load_fips_ja()
    target = os.environ.get("PROFILE_FIPS")
    targets = [c.strip() for c in target.split(",")] if target else list(fips_ja)

    if DUMMY:
        _main_dummy(fips_ja, targets)
    else:
        _main_v2(fips_ja, targets)


if __name__ == "__main__":
    main()
