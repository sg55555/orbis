"""中国語（普通話）ピンイン → カタカナ近似の読み補助（stdlib のみの純関数群 + name_to_reading）。

用途: 中国・台湾の漢字地名は日本語話者に読み方が分かりづらいため、build 時に
「現地音（普通話）のカタカナ近似」を `reading` として付与する（LLM 不使用＝生成の追加課金ゼロ）。

- `syllable_to_kana(syllable)` は声母(initial)+韻母(final) の合成 + 不規則音 override による純関数
  （pypinyin 非依存・pytest 対象）。声調は落とす近似。
- `name_to_reading(name)` は pypinyin（遅延 import）で漢字列を声調なしピンインに分解して合成する。
  pypinyin 未導入や、名前にカタカナ/ひらがな/ラテン文字が混在する場合（部分的な誤読を避けるため）は
  None を返す＝呼び出し側は reading を付けない。
"""

# 韻母(final) → ゼロ声母時のカタカナ。合成では先頭モーラを声母で置換する（先頭1文字を捨て、CV で置換）。
_FINALS = {
    "a": "ア", "o": "オ", "e": "ウー", "ai": "アイ", "ei": "エイ", "ao": "アオ", "ou": "オウ",
    "an": "アン", "en": "エン", "ang": "アン", "eng": "オン", "ong": "オン", "er": "アル",
    "i": "イー", "ia": "イア", "ie": "イエ", "iao": "イアオ", "iu": "イウ", "ian": "イエン",
    "in": "イン", "iang": "イアン", "ing": "イン", "iong": "イオン",
    "u": "ウー", "ua": "ウア", "uo": "ウオ", "uai": "ウアイ", "ui": "ウェイ", "uan": "ウアン",
    "un": "ウン", "uang": "ウアン", "ueng": "ウオン",
    "v": "ユイ", "ve": "ユエ", "van": "ユエン", "vn": "ユン",  # ü 系（j/q/x/y の u は ü）
}
# 韻母の頭母音（どの母音行の声母カタカナを使うか）。"e" は曖昧母音 → u 行（ドゥー/グー等）で近似。
_HEAD_VOWEL = {
    "a": "a", "o": "o", "e": "u", "ai": "a", "ei": "e", "ao": "a", "ou": "o", "an": "a", "en": "e",
    "ang": "a", "eng": "e", "ong": "o", "er": "a", "i": "i", "ia": "i", "ie": "i", "iao": "i", "iu": "i",
    "ian": "i", "in": "i", "iang": "i", "ing": "i", "iong": "i", "u": "u", "ua": "u", "uo": "u", "uai": "u",
    "ui": "u", "uan": "u", "un": "u", "uang": "u", "ueng": "u", "v": "v", "ve": "v", "van": "v", "vn": "v",
}
# 声母 + 母音 → 先頭カタカナ（韻母カタカナの先頭1文字を置換）。zh は日本の慣用に合わせ ch と同じチ行。
_CV = {
    "b": {"a": "バ", "i": "ビ", "u": "ブ", "e": "ベ", "o": "ボ"}, "p": {"a": "パ", "i": "ピ", "u": "プ", "e": "ペ", "o": "ポ"},
    "m": {"a": "マ", "i": "ミ", "u": "ム", "e": "メ", "o": "モ"}, "f": {"a": "ファ", "i": "フィ", "u": "フ", "e": "フェ", "o": "フォ"},
    "d": {"a": "ダ", "i": "ディ", "u": "ドゥ", "e": "デ", "o": "ド"}, "t": {"a": "タ", "i": "ティ", "u": "トゥ", "e": "テ", "o": "ト"},
    "n": {"a": "ナ", "i": "ニ", "u": "ヌ", "e": "ネ", "o": "ノ"}, "l": {"a": "ラ", "i": "リ", "u": "ル", "e": "レ", "o": "ロ"},
    "g": {"a": "ガ", "i": "ギ", "u": "グ", "e": "ゲ", "o": "ゴ"}, "k": {"a": "カ", "i": "キ", "u": "ク", "e": "ケ", "o": "コ"},
    "h": {"a": "ハ", "i": "ヒ", "u": "フ", "e": "ホ", "o": "ホ"},
    "j": {"a": "ジャ", "i": "ジ", "u": "ジュ", "e": "ジェ", "o": "ジョ", "v": "ジュ"},
    "q": {"a": "チャ", "i": "チ", "u": "チュ", "e": "チェ", "o": "チョ", "v": "チュ"},
    "x": {"a": "シャ", "i": "シ", "u": "シュ", "e": "シェ", "o": "ショ", "v": "シュ"},
    "zh": {"a": "チャ", "i": "チ", "u": "チュ", "e": "チェ", "o": "チョ"}, "ch": {"a": "チャ", "i": "チ", "u": "チュ", "e": "チェ", "o": "チョ"},
    "sh": {"a": "シャ", "i": "シ", "u": "シュ", "e": "シェ", "o": "ショ"}, "r": {"a": "ラ", "i": "リ", "u": "ル", "e": "レ", "o": "ロ"},
    "z": {"a": "ザ", "i": "ズ", "u": "ズ", "e": "ゼ", "o": "ゾ"}, "c": {"a": "ツァ", "i": "ツ", "u": "ツ", "e": "ツェ", "o": "ツォ"},
    "s": {"a": "サ", "i": "ス", "u": "ス", "e": "セ", "o": "ソ"},
    "": {"a": "ア", "i": "イ", "u": "ウ", "e": "エ", "o": "オ", "v": "ユ"},
}
# 空母音（-i の buzz）や y/w 始まりの音節全体を直接指定する override。
_OVERRIDE = {
    "zhi": "チー", "chi": "チー", "shi": "シー", "ri": "リー", "zi": "ズー", "ci": "ツー", "si": "スー", "er": "アル",
    "wu": "ウー", "yi": "イー", "yu": "ユイ", "ye": "イエ", "ya": "ヤー", "yao": "ヤオ", "you": "ヨウ",
    "yan": "イエン", "yin": "イン", "yang": "ヤン", "ying": "イン", "yong": "ヨン", "yuan": "ユエン",
    "yue": "ユエ", "yun": "ユン", "wa": "ワー", "wo": "ウオ", "wai": "ワイ", "wei": "ウェイ", "wan": "ワン",
    "wen": "ウェン", "wang": "ワン", "weng": "ウオン",
}
_INITIALS_2 = ("zh", "ch", "sh")


def _split_syllable(s):
    """音節を (声母, 韻母) に分解。zh/ch/sh は2文字声母。母音始まりは声母 ""。"""
    for ini in _INITIALS_2:
        if s.startswith(ini):
            return ini, s[len(ini):]
    if s and s[0] in "bpmfdtnlgkhjqxrzcsyw":
        return s[0], s[1:]
    return "", s


def _normalize_final(ini, fin):
    """空韻母（zh/ch/sh/r/z/c/s の -i buzz）と、j/q/x の u=ü（v 系）への正規化。"""
    if fin == "":
        fin = "i" if ini in ("zh", "ch", "sh", "r", "z", "c", "s") else ""
    if ini in ("j", "q", "x") and fin and fin[0] == "u":
        fin = {"u": "v", "ue": "ve", "uan": "van", "un": "vn"}.get(fin, fin)
    return fin


def syllable_to_kana(syllable):
    """普通話1音節（声調なしピンイン・小文字）→ カタカナ近似。未知音節は None。"""
    if not isinstance(syllable, str) or not syllable:
        return None
    syl = syllable.lower()
    if syl in _OVERRIDE:
        return _OVERRIDE[syl]
    ini, fin = _split_syllable(syl)
    if ini == "y":  # override 漏れの y- は i 介音のゼロ声母として近似
        ini, fin = "", ("i" + fin if fin and fin[0] not in "iu" else fin)
    if ini == "w":  # override 漏れの w- は u 介音のゼロ声母として近似
        ini, fin = "", ("u" + fin if fin and fin[0] != "u" else fin)
    fin = _normalize_final(ini, fin)
    base = _FINALS.get(fin)
    hv = _HEAD_VOWEL.get(fin)
    if base is None or hv is None:
        return None
    head = _CV.get(ini, {}).get(hv)
    if head is None:
        return None
    return head + base[1:]


def _is_all_han(name):
    """name が漢字（CJK 統合漢字）と少数の許容記号のみで構成されるか。カタカナ/ひらがな/ラテンが
    混じる名は部分的な誤読を避けるため reading 対象外にする（True のときだけ pypinyin にかける）。"""
    if not name:
        return False
    allowed = "・()（） 　"
    saw_han = False
    for c in name:
        if "一" <= c <= "鿿" or "㐀" <= c <= "䶿":  # CJK 統合漢字（拡張A含む）
            saw_han = True
        elif c in allowed:
            continue
        else:
            return False
    return saw_han


def name_to_reading(name):
    """漢字地名 → カタカナ読み（現地音の近似）。pypinyin 未導入・非漢字混在・変換不能は None。

    build_profiles から中国/台湾の地域名にのみ呼ぶ（ピンイン＝中国語発音のため他体系には適用しない）。"""
    if not _is_all_han(name):
        return None
    try:
        from pypinyin import Style, pinyin
    except Exception:
        return None
    out = []
    # errors="default": pypinyin 辞書に無い文字は原字のまま返る → ピンインでない group を検知できる。
    for group in pinyin(name, style=Style.NORMAL, errors="default"):
        syl = group[0] if group else ""
        if isinstance(syl, str) and syl.isascii() and syl.isalpha():
            kana = syllable_to_kana(syl)
            if kana is None:
                return None  # 未知音節 → 全体を諦める（中途半端な読みを出さない）
            out.append(kana)
        elif all(c in "・()（） 　" for c in syl):
            continue        # 許容記号は読みに寄与しないのでスキップ
        else:
            return None      # ピンイン化できない文字（辞書外の漢字等）→ 未知音節と同じく全体を諦める
    reading = "".join(out)
    return reading or None
