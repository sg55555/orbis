"""地域プロフィール生成の純関数群（stdlib のみ・pytest 対象）。I/O は build_profiles.py。"""
import json
import re

SECTIONS = ["概要", "気候", "特産・名物", "主要産業", "交通・地理", "観光名所"]


def resolve_qid(props):
    """NE feature properties → Wikidata QID（"Q…"）。無効/欠落は None。"""
    for k in ("wikidataid", "WIKIDATAID", "wikidataId"):
        v = props.get(k)
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("Q") and v[1:].isdigit():
                return v
    return None


def _claim_coord(claims):
    for c in claims.get("P625") or []:
        try:
            v = c["mainsnak"]["datavalue"]["value"]
            return float(v["latitude"]), float(v["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
    return None, None


# 面積(P2046)・標高(P2044) の Wikidata 単位 → 基準単位(km²/m) 換算係数。未知/単位なしは係数 1.0。
_AREA_UNIT_KM2 = {
    "Q712226": 1.0,        # 平方キロメートル
    "Q25343": 1e-6,        # 平方メートル
    "Q35852": 0.01,        # ヘクタール
    "Q232291": 2.589988,   # 平方マイル
}
_ELEV_UNIT_M = {
    "Q11573": 1.0,      # メートル
    "Q3710": 0.3048,    # フート
    "Q828224": 1000.0,  # キロメートル
}


def _unit_qid(value):
    """datavalue.value の unit（"http://.../Q…"）→ "Q…"。単位なし(例 "1")/不明は None。"""
    u = value.get("unit") if isinstance(value, dict) else None
    if isinstance(u, str) and "/" in u:
        return u.rsplit("/", 1)[-1]
    return None


def _point_in_time(claim):
    """qualifier P585（時点）の time 文字列。無ければ ""（ISO 昇順=文字列比較で最新判定可）。"""
    try:
        return claim["qualifiers"]["P585"][0]["datavalue"]["value"]["time"] or ""
    except (KeyError, TypeError, IndexError):
        return ""


def _select_claim(claims, pid):
    """amount を持つ claim から rank=preferred を最優先、次に P585 時点が最新、無ければ配列順で
    最初を返す。時系列統計（人口など）で配列先頭＝古い値を拾う不具合を解消する。"""
    best, best_key = None, None
    for c in claims.get(pid) or []:
        try:
            v = c["mainsnak"]["datavalue"]["value"]
        except (KeyError, TypeError):
            continue
        if not (isinstance(v, dict) and "amount" in v):
            continue
        key = (1 if c.get("rank") == "preferred" else 0, _point_in_time(c))
        if best_key is None or key > best_key:
            best, best_key = c, key
    return best


def _amount_in_unit(claim, unit_map):
    """選んだ claim の amount を unit_map で基準単位へ換算。単位なし/不明は係数 1.0。無効は None。"""
    if not claim:
        return None
    try:
        v = claim["mainsnak"]["datavalue"]["value"]
        amt = float(v["amount"])
    except (KeyError, TypeError, ValueError):
        return None
    return round(amt * unit_map.get(_unit_qid(v), 1.0), 6)


def wikidata_facts(entity):
    """Wikidata entity → 事実 dict。P1082 人口/P2046 面積/P625 座標/P2044 標高/P2132 一人当たりGDP。
    面積・標高は単位(m²/km²・foot/m 等)を正規化し、人口は preferred/最新時点の統計を選ぶ。"""
    claims = (entity or {}).get("claims") or {}
    pop = _amount_in_unit(_select_claim(claims, "P1082"), {})  # 人口は単位なし（係数常に 1.0）
    lat, lon = _claim_coord(claims)
    return {
        "population": int(pop) if pop is not None else None,
        "area_km2": _amount_in_unit(_select_claim(claims, "P2046"), _AREA_UNIT_KM2),
        "lat": lat, "lon": lon,
        "elevation_m": _amount_in_unit(_select_claim(claims, "P2044"), _ELEV_UNIT_M),
        # P2132 も rank/最新時点で選ぶ（人口と同じ stale バグ回避）。通貨単位は正規化不能ゆえ生値。
        "gdp_per_capita": _amount_in_unit(_select_claim(claims, "P2132"), {}),
    }


def _prop_qids(claims, pid):
    """claims[pid] の各 claim から item 値の QID を抽出（壊れた claim は無視）。"""
    out = []
    for c in claims.get(pid) or []:
        try:
            v = c["mainsnak"]["datavalue"]["value"]
            if isinstance(v, dict) and "id" in v:
                out.append(v["id"])
        except (KeyError, TypeError):
            continue
    return out


def dedup_names(names):
    """順序保持で重複除去・空/None を除外。"""
    seen, out = set(), []
    for n in names:
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def named_props(entity, *, label_resolver):
    """Wikidata entity → 固有名（日本語ラベル）dict。P37 公用語/P47 隣接/P463 加盟機関。
    label_resolver(qids) -> {qid: ja_label} を注入（未解決は None→dedup_names で除外）。"""
    claims = (entity or {}).get("claims") or {}
    langs = _prop_qids(claims, "P37")
    borders = _prop_qids(claims, "P47")
    members = _prop_qids(claims, "P463")
    lut = label_resolver(langs + borders + members) if (langs or borders or members) else {}
    name = lambda qs: dedup_names([lut.get(q) for q in qs])
    return {"languages": name(langs), "borders": name(borders), "memberships": name(members)}


def ja_wikipedia_title(entity):
    """entity の日本語 Wikipedia サイトリンク title。無ければ None。"""
    sl = (entity or {}).get("sitelinks") or {}
    t = (sl.get("jawiki") or {}).get("title")
    return t.strip() if isinstance(t, str) and t.strip() else None


def build_profile_prompt(name_ja, level, facts, wiki_summary):
    """取得事実のみを根拠に日本語プロフィールを JSON 生成させるプロンプト。"""
    facts_lines = "\n".join(f"- {k}: {v}" for k, v in (facts or {}).items() if v is not None)
    return (
        f"地域「{name_ja}」（種別: {level}）の日本語プロフィールを作成してください。\n"
        f"以下の Wikipedia 要約と事実(Wikidata)のみを根拠とし、ここに無い情報は書かないでください。\n\n"
        f"# Wikipedia 要約\n{wiki_summary or '(なし)'}\n\n"
        f"# 事実(Wikidata)\n{facts_lines or '(なし)'}\n\n"
        f"# 出力形式（JSON のみ・前後に文章を付けない）\n"
        f'{{"sections":[{{"title":"概要","body":"…"}}]}}\n'
        f"title は次から該当するものだけ・順序維持: {', '.join(SECTIONS)}。\n"
        f"各 body は 1〜3 文の簡潔な日本語。根拠が無いセクションは省略し、断定は避ける。"
    )


def parse_profile_response(text):
    """LLM 応答テキスト→ sections。SECTIONS の title・非空 body のみ・重複除外。"""
    if not isinstance(text, str):
        return []
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return []
    out, seen = [], set()
    for s in (data or {}).get("sections") or []:
        t = (s or {}).get("title")
        b = (s or {}).get("body")
        if t in SECTIONS and t not in seen and isinstance(b, str) and b.strip():
            out.append({"title": t, "body": b.strip()})
            seen.add(t)
    return out


def is_degraded(qid, sections):
    """QID 無し or セクション皆無 = degraded（事実のみ表示にフォールバック）。"""
    return (not qid) or (len(sections) == 0)


def assemble_profile(pid, level, name_ja, facts, sections, source, degraded):
    """出力スキーマに整形。"""
    return {
        "id": pid, "level": level, "name_ja": name_ja,
        "facts": facts, "sections": sections,
        "source": source, "degraded": bool(degraded),
    }


# 正規化キー: geography/history/economy/politics/foreign/society/tourism/transport/overview
SECTION_SYNONYMS = {
    "概要": "overview", "地理": "geography", "地理・地域": "geography", "自然環境": "geography", "気候": "geography",
    "歴史": "history", "国名": "history",
    "経済": "economy", "産業": "economy", "経済・産業": "economy",
    "政治": "politics",
    "国際関係": "foreign", "対外関係": "foreign",
    "国民": "society", "人口": "society", "都民": "society", "民族": "society", "文化": "society",
    "観光": "tourism", "文化・スポーツ・観光": "tourism",
    "交通": "transport",
}
SECTION_ALLOW = {"overview", "geography", "history", "economy", "politics", "foreign", "society", "tourism", "transport"}
_HEAD = re.compile(r"^(={2,})\s*(.+?)\s*\1\s*$", re.M)


def extract_sections(plaintext, *, max_chars=6000):
    """Wikipedia extracts(explaintext) 本文 → allowlist 節のみを結合した本文。
    見出し(== 見出し ==)で分割し SECTION_SYNONYMS で正規化・SECTION_ALLOW でフィルタ。
    先頭(最初の見出し前)は概要相当として残す。max_chars で末尾トリム。"""
    if not plaintext:
        return ""
    # 分割点（見出し位置）を集める
    marks = [(m.start(), m.group(2).strip()) for m in _HEAD.finditer(plaintext)]
    # 先頭（最初の見出し前）＝概要相当
    blocks = []
    lead_end = marks[0][0] if marks else len(plaintext)
    lead = plaintext[:lead_end].strip()
    if lead:
        blocks.append(("overview", lead))
    for i, (pos, head) in enumerate(marks):
        key = SECTION_SYNONYMS.get(head)
        if key not in SECTION_ALLOW:
            continue
        nl = plaintext.find("\n", pos)
        body_start = len(plaintext) if nl == -1 else nl + 1
        body_end = marks[i + 1][0] if i + 1 < len(marks) else len(plaintext)
        body = plaintext[body_start:body_end].strip()
        if body:
            blocks.append((key, f"【{head}】\n{body}"))
    text = "\n\n".join(b for _, b in blocks)
    return text[:max_chars]


def generate_profile(level, pid, name_ja, qid, *, fetch_wikidata, fetch_wikipedia, ask_llm):
    """1 地域のプロフィール生成。I/O は注入（テスト可能）。
    qid 無し or ja Wikipedia 無し or セクション皆無 → degraded（事実のみ）。"""
    if not qid:
        return assemble_profile(pid, level, name_ja, wikidata_facts({}), [],
                                {"qid": None, "wikipedia_url": None}, True)
    entity = fetch_wikidata(qid) or {}
    facts = wikidata_facts(entity)
    title = ja_wikipedia_title(entity)
    summary = fetch_wikipedia(title) if title else None
    sections = []
    if summary:
        sections = parse_profile_response(ask_llm(build_profile_prompt(name_ja, level, facts, summary)))
    wiki_url = f"https://ja.wikipedia.org/wiki/{title}" if title else None
    return assemble_profile(pid, level, name_ja, facts, sections,
                            {"qid": qid, "wikipedia_url": wiki_url}, is_degraded(qid, sections))


# 因果レイヤー5層（diplomacy は国のみ・県/都市はレベル別縮退で省略し所属国へ集約）
LAYERS = [
    {"key": "geography", "title": "地勢・立地", "levels": {"country", "admin1", "city"}},
    {"key": "economy", "title": "産業の成り立ちと近代化", "levels": {"country", "admin1", "city"}},
    {"key": "society", "title": "社会・人口", "levels": {"country", "admin1", "city"}},
    {"key": "geopolitics", "title": "地政学的位置づけ", "levels": {"country", "admin1", "city"}},
    {"key": "diplomacy", "title": "外交姿勢と国際的立場", "levels": {"country"}},  # 国のみ
]

PROFILE_SYSTEM_V2 = (
    "あなたは地理・地政学の事典編集者兼アナリストです。与えられた事実(Wikidata)と"
    "Wikipedia本文の抜粋のみを根拠に、地域を『因果の連鎖』で読み解く日本語の分析プロフィールを作ります。\n"
    "規則: (1)カテゴリ要約でなく固有名を列挙(『4公用語』でなく言語名、宗教・産業・隣接国も固有名)。"
    "(2)断定は根拠のある事実に限り、因果の解釈は confidence=inferred、時事依存は time_sensitive と明示。"
    "(3)材料に無い情報を創作しない。書けない層は省略してよい。"
    "(4)各層に evidence(何を見たか)と dig_deeper(次に見る指標)を付す。出力はJSONのみ。"
)


def build_profile_prompt_v2(name_ja, level, facts, named, section_text, belongs_to_name=None):
    """因果レイヤー(地勢→産業→社会→地政→外交)＋確度ラベル＋年表＋観光の分析プロンプトを構築。
    diplomacy はレベル別縮退（国のみフル・県/都市は省略し所属国へ集約）。"""
    layers = [layer for layer in LAYERS if level in layer["levels"]]
    has_diplomacy = any(layer["key"] == "diplomacy" for layer in layers)
    layer_lines = "\n".join(f'  - {layer["key"]}: {layer["title"]}' for layer in layers)
    facts_lines = "\n".join(f"- {k}: {v}" for k, v in (facts or {}).items() if v is not None)
    named_lines = "\n".join(f"- {k}: {', '.join(v)}" for k, v in (named or {}).items() if v)
    # レベル別縮退：diplomacy 層が対象外のとき（県・都市）は省略し所属国へ集約する旨を明示。
    # 縮退時はプロンプト全体から "diplomacy" という語自体を排し、diplomacy 層が完全に不在であることを保証する。
    dip_note = ("" if has_diplomacy else
                f"\n※この地域は{level}のため外交層は省略（外交は所属国「{belongs_to_name}」に集約）。")
    dip_guidance = (
        "・外交(diplomacy)は恒常的な立場を certain/inferred で、時々刻々の動向は time_sensitive とし dig_deeper へ。"
        if has_diplomacy else ""
    )
    return (
        f"地域「{name_ja}」(種別: {level}) の因果分析プロフィールをJSONで作成。{dip_note}\n\n"
        f"# 対象レイヤー(この順・書ける層のみ)\n{layer_lines}\n\n"
        f"# 事実(Wikidata)\n{facts_lines or '(なし)'}\n"
        f"# 固有名(Wikidata・そのまま使う)\n{named_lines or '(なし)'}\n\n"
        f"# Wikipedia本文(抜粋)\n{section_text or '(なし)'}\n\n"
        f'# 出力形式(JSONのみ)\n'
        '{"layers":[{"key":"geography","title":"地勢・立地","body":"…因果の散文…",'
        '"confidence":[{"label":"certain","kind":"地理","note":"…"},{"label":"inferred","kind":"解釈","note":"…"}],'
        '"evidence":"…","dig_deeper":["…","…"]}],'
        '"timeline":[{"year":"1819","event":"…","confidence":"certain","cause_note":"…(推定)"}],'
        '"tourism":["…"]}\n'
        "・body は1〜4文の散文。confidence は label∈{certain,inferred,time_sensitive}。"
        "確度ラベル(certain/inferred/time_sensitive)や『confidence=…』は confidence 配列にのみ記し、"
        "body・cause_note・dig_deeper・evidence の散文中に『(inferred)』等の形で書かない(表示ノイズになる)。"
        "・timeline は近代化の経緯(economy層に対応・年号は本文/事実に明示があれば certain、記憶に頼る年は inferred)。"
        "各エントリの year はその事象自体が発生した年に限る。"
        "「〜の後」等の緩い言及で別事象を誤った年に折り込まない・同一事象を複数年に二重計上しない。"
        "tourism は実際に一般訪問できる観光地の固有名(都市は厚め)。"
        "係争地・軍事管理下・一般アクセス不可の島嶼/地形は観光として挙げない。"
        f"{dip_guidance}"
        "\n\n# 出力前の必須チェック（最優先・順に適用）\n"
        "1) 「事実(Wikidata)」「固有名(Wikidata)」に載る値(人口・面積・座標・標高・公用語・隣接国・加盟機関)は"
        "確実な根拠。これらは certain としてよい(過度に inferred へ倒さない)。\n"
        "2) それ以外の主張を certain にするなら、裏づけ語句を「Wikipedia本文(抜粋)」から探し、"
        "note にその語句をそのまま引用(コピー)する。引用できなければ certain にしない"
        "(「本文に明記」等の要約で代替しない・出典の捏造禁止)。\n"
        "3) 人物の党派・政治的立場、歴史事象の主体(王朝・国・自治体名)、制度や資格の要件、"
        "受賞・認定の分野などの具体属性は、上記の材料に明示が無ければ certain でも inferred でも書かず省略する"
        "(誤りを解釈として書かない)。「唯一・最初・only」等の全称も同様。\n"
        "4) 金額・人口・面積は桁(兆/億/万/km²)を明示し「事実」と整合させる。"
        "訳語・産業名が対象地域の地理(内陸/沿海など)と矛盾しないか点検する。\n"
        f"5) 記述は必ず対象地域「{name_ja}」自身に限定する。"
    )


_LAYER_KEYS = {layer["key"] for layer in LAYERS}
_CONF = {"certain", "inferred", "time_sensitive"}

# 本文プロースへ漏れた確度ラベル注記を除去する（確度は confidence 構造化フィールドに保持されるため
# body/cause_note 等に「(inferred)」「(confidence=inferred)」と書かれるのは表示ノイズ）。方針:
#  - 除去できる形（ラベルのみの括弧・na-形容詞『<label>な』・区切り記号で区切られたラベル）は削除する。
#  - 日本語文法に融合して削除すると非文になる裸ラベル（『certainだが』『certain化』『は…寄り』等）は、
#    日本語へ言い換える（certain→確実 / inferred→推定 / time_sensitive→時事依存）＝文法を絶対に壊さない。
#  - ラベル語を含まない括弧（『推定』『面積』やふりがな『（らんが）』）は温存する。
#  - ASCII 字境界で "uncertainty" 等の英単語内部を誤ヒットしない。
_LBL = r"(?<![A-Za-z])(?:certain|inferred|time_sensitive)(?![A-Za-z])"
_LBL_PFX = r"(?:confidence\s*[:：=]?\s*)?" + _LBL  # 任意の "confidence" 接頭辞つきラベル
_LABEL_ONLY = re.compile(_LBL, re.I)             # ラベル語のみ（存在判定・言い換え用）
_PAREN_GROUP = re.compile(r"[（(]([^（）()]*)[）)]")
_SEP_CHARS = " 　・,、:：=／/"
# na-形容詞「<label>な名詞」→「<label>な」ごと除去（後続名詞が自立する）。
_BARE_NA = re.compile(r"[ 　]*" + _LBL_PFX + r"[ 　]*な", re.I)
# 区切り記号（コロン・中黒・読点/）で区切られたラベル → 区切りごと除去（説明が自立する）。
_DELIM_LABEL = re.compile(r"[：:・、,／/][ 　]*" + _LBL_PFX + r"|" + _LBL_PFX + r"[ 　]*[：:・、,／/]", re.I)
# 言い換え用: 前後の空白と "confidence" 接頭辞ごとラベルを掴み、日本語へ置換。
_LABEL_SPAN = re.compile(r"[ 　]*" + _LBL_PFX + r"[ 　]*", re.I)
_LABEL_JA = {"certain": "確実", "inferred": "推定", "time_sensitive": "時事依存"}


def _translate_labels(text):
    """削除で文法が壊れる融合ラベルを日本語へ言い換える（前後空白と confidence 接頭辞ごと置換）。"""
    return _LABEL_SPAN.sub(lambda m: _LABEL_JA[_LABEL_ONLY.search(m.group(0)).group(0).lower()], text)


def _has_substance_without_labels(text):
    """ラベル語・接続子・confidence 接頭辞を全部除いて実体（説明）が残るか。"""
    x = re.sub(r"confidence\s*[:：=]?\s*", "", text, flags=re.I)
    x = _LABEL_ONLY.sub("", x)
    x = re.sub(r"([・、,／/：:])\1+", r"\1", x).strip(_SEP_CHARS)
    return bool(x)


def _clean_paren_inner(inner):
    """括弧内のラベル注記を処理。除去できる形は除き、実体が残らなければ None（括弧ごと削除）、
    実体が残るなら融合ラベルを日本語化して返す（『はな』非文や末尾ダングリングを作らない）。"""
    x = _BARE_NA.sub("", inner)       # 埋め込み na-形容詞（『はtime_sensitiveな』→『は』）
    x = _DELIM_LABEL.sub("", x)       # 区切り記号つきラベル（『inferred：…』→『…』）
    if not _has_substance_without_labels(x):
        return None                   # ラベル/接続子/接頭辞のみ → 括弧ごと削除
    return _translate_labels(re.sub(r"([・、,／/：:])\1+", r"\1", x).strip(_SEP_CHARS))


def strip_confidence_labels(text):
    """文字列から漏れた確度ラベル注記を文法を壊さずに処理する純関数（除去または日本語言い換え）。"""
    if not isinstance(text, str) or not text:
        return text

    def _repl(m):
        inner = m.group(1)
        if not _LABEL_ONLY.search(inner):
            return m.group(0)  # ラベル語を含まない括弧（推定・面積・ふりがな 等）は温存
        new_inner = _clean_paren_inner(inner)
        return "" if new_inner is None else f"（{new_inner}）"

    out = _PAREN_GROUP.sub(_repl, text)   # 括弧内（この後、残るラベルは全て括弧外＝裸）
    out = _BARE_NA.sub("", out)           # 裸: 連体 na-形容詞
    out = _DELIM_LABEL.sub("", out)       # 裸: 区切り記号つきラベル
    out = _translate_labels(out)          # 裸: 融合ラベルを日本語へ言い換え（削除では非文になるもの）
    out = re.sub(r"[ 　]+([。、．，！？」』）)])", r"\1", out)  # 句読点前の空白除去
    out = re.sub(r"[ 　]{2,}", " ", out)
    return out.strip()


def strip_profile_labels(obj):
    """{layers,timeline,tourism} を持つ dict の全テキストフィールドから確度ラベル注記を除去（破壊的）。
    parse_profile_v2（生成時）と既存データ後処理の双方で使う単一の choke point。"""
    for layer in obj.get("layers") or []:
        if isinstance(layer.get("body"), str):
            layer["body"] = strip_confidence_labels(layer["body"])
        if isinstance(layer.get("evidence"), str):
            layer["evidence"] = strip_confidence_labels(layer["evidence"])
        layer["dig_deeper"] = [strip_confidence_labels(d) if isinstance(d, str) else d
                               for d in (layer.get("dig_deeper") or [])]
        for c in layer.get("confidence") or []:
            if isinstance(c.get("note"), str):
                c["note"] = strip_confidence_labels(c["note"])
    for t in obj.get("timeline") or []:
        if isinstance(t.get("event"), str):
            t["event"] = strip_confidence_labels(t["event"])
        if isinstance(t.get("cause_note"), str):
            t["cause_note"] = strip_confidence_labels(t["cause_note"])
    obj["tourism"] = [strip_confidence_labels(x) if isinstance(x, str) else x
                      for x in (obj.get("tourism") or [])]
    return obj


# Batch API custom_id は ^[a-zA-Z0-9_-]{1,64}$ のみ許容。admin1 コードは NE の係争地マーカー
# "~"（例 CN-X01~）を含み得るため、不正 cid を Batch へ送ると 400 で run 全体が落ちる。
_SAFE_CUSTOM_ID = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")


def is_safe_custom_id(cid):
    """cid が Batch API custom_id の許容文字集合・長さに収まるか。"""
    return isinstance(cid, str) and _SAFE_CUSTOM_ID.match(cid) is not None


def parse_profile_v2(text):
    """build_profile_prompt_v2 応答テキスト → {layers,timeline,tourism}（検証済）。
    未知 layer key・不正 confidence label・空 body はフィルタして捨てる。"""
    if not isinstance(text, str):
        return {"layers": [], "timeline": [], "tourism": []}
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return {"layers": [], "timeline": [], "tourism": []}
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return {"layers": [], "timeline": [], "tourism": []}
    if not isinstance(data, dict):
        return {"layers": [], "timeline": [], "tourism": []}
    raw_layers = data.get("layers")
    raw_layers = raw_layers if isinstance(raw_layers, list) else []
    layers, seen = [], set()
    for s in raw_layers:
        if not isinstance(s, dict):
            continue
        k = s.get("key")
        b = s.get("body")
        if not isinstance(k, str):
            continue
        if k in _LAYER_KEYS and k not in seen and isinstance(b, str) and b.strip():
            raw_conf = s.get("confidence")
            conf = [c for c in (raw_conf if isinstance(raw_conf, list) else [])
                    if isinstance(c, dict) and isinstance(c.get("label"), str)
                    and c.get("label") in _CONF and c.get("note")]
            raw_dig = s.get("dig_deeper")
            dig = [d for d in (raw_dig if isinstance(raw_dig, list) else [])
                   if isinstance(d, str) and d.strip()]
            ti = s.get("title")
            ev = s.get("evidence")
            layers.append({"key": k, "title": ti if isinstance(ti, str) and ti.strip() else k,
                           "body": b.strip(), "confidence": conf,
                           "evidence": ev.strip() if isinstance(ev, str) else "",
                           "dig_deeper": dig})
            seen.add(k)
    raw_timeline = data.get("timeline")
    raw_timeline = raw_timeline if isinstance(raw_timeline, list) else []
    timeline = []
    for t in raw_timeline:
        if not isinstance(t, dict):
            continue
        ev = t.get("event")
        if not (isinstance(ev, str) and ev.strip()):
            continue
        conf = t.get("confidence")
        cn = t.get("cause_note")
        timeline.append({"year": str(t.get("year")), "event": ev.strip(),
                         "confidence": conf if isinstance(conf, str) and conf in _CONF else "certain",
                         "cause_note": cn.strip() if isinstance(cn, str) else ""})
    raw_tourism = data.get("tourism")
    raw_tourism = raw_tourism if isinstance(raw_tourism, list) else []
    tourism = [x.strip() for x in raw_tourism if isinstance(x, str) and x.strip()]
    # 生成応答が body/cause_note 等に確度ラベルを書き込んでも、ここで一括除去して漏れを封じる
    # （確度は confidence 構造化フィールドに保持済み・§プロンプトでも禁止を明示）。
    return strip_profile_labels({"layers": layers, "timeline": timeline, "tourism": tourism})


def is_degraded_v2(qid, parsed):
    """QID 無し or layers 皆無 = degraded（v2）。"""
    return (not qid) or (len(parsed.get("layers") or []) == 0)


def assemble_profile_v2(pid, level, name_ja, facts, parsed, source, degraded, belongs_to, generated_at):
    """出力スキーマ v2 に整形。"""
    return {
        "id": pid, "level": level, "name_ja": name_ja, "belongs_to": belongs_to,
        "facts": facts, "layers": parsed["layers"], "timeline": parsed["timeline"],
        "tourism": parsed["tourism"], "source": source, "degraded": bool(degraded),
        "generated_at": generated_at,
    }


def generate_profile_v2(level, pid, name_ja, qid, belongs_to, generated_at,
                        *, fetch_wikidata, fetch_article, label_resolver, ask_llm):
    """1 地域の v2 プロフィール生成（逐次モード用）。I/O は全て注入（テスト可能・build_profiles が実 I/O を渡す）。
    qid 無し／ja Wikipedia 無し／節本文が抽出できない／layers 皆無 → degraded（事実のみ表示にフォールバック）。
    Batch 一括生成（既定）では PASS1/PASS2 に分解した同等ロジックを build_profiles.py 側で実施する
    （本関数は PROFILE_BATCH=0 の少数検証/ダミー用フォールバックとして使う）。"""
    if not qid:
        return assemble_profile_v2(pid, level, name_ja, wikidata_facts({}),
                                   {"layers": [], "timeline": [], "tourism": []},
                                   {"qid": None, "wikipedia_url": None, "wikidata_props": []},
                                   True, belongs_to, generated_at)
    entity = fetch_wikidata(qid) or {}
    facts = wikidata_facts(entity)
    named = named_props(entity, label_resolver=label_resolver)
    title = ja_wikipedia_title(entity)
    section_text = extract_sections(fetch_article(title)) if title else ""
    parsed = {"layers": [], "timeline": [], "tourism": []}
    if section_text:
        belongs_name = (belongs_to or {}).get("name_ja") if belongs_to else None
        prompt = build_profile_prompt_v2(name_ja, level, facts, named, section_text, belongs_name)
        parsed = parse_profile_v2(ask_llm(prompt))
    url = f"https://ja.wikipedia.org/wiki/{title}" if title else None
    props = [p for p, v in [("P37", named["languages"]), ("P47", named["borders"]), ("P463", named["memberships"])] if v]
    return assemble_profile_v2(pid, level, name_ja, facts, parsed,
                               {"qid": qid, "wikipedia_url": url, "wikidata_props": props},
                               is_degraded_v2(qid, parsed), belongs_to, generated_at)
