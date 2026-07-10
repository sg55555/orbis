"""scripts/lib/pinyin_kana.py のユニットテスト（ピンイン→カタカナ近似の読み補助）。
syllable_to_kana は純関数（pypinyin 非依存）。name_to_reading は pypinyin 必須のため
未導入環境では該当テストを skip する。"""
import importlib.util

import pytest

from scripts.lib.pinyin_kana import name_to_reading, syllable_to_kana

_HAS_PYPINYIN = importlib.util.find_spec("pypinyin") is not None


# ---------------------------------------------------------------------------
# syllable_to_kana: 声母+韻母合成の代表音（純関数・pypinyin 不要）
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("syl,kana", [
    ("pu", "プー"), ("tian", "ティエン"), ("shi", "シー"),      # 莆田市
    ("chuan", "チュアン"),                                      # 銅川（u 介音を落とさない）
    ("guang", "グアン"), ("zhou", "チョウ"),                    # 広州（u 介音 + zh=チ行）
    ("zhen", "チェン"), ("shen", "シェン"),                     # 深圳
    ("quan", "チュエン"), ("ping", "ピン"), ("di", "ディー"),   # 平地泉
    ("bei", "ベイ"), ("jing", "ジン"),                          # 北京
    ("an", "アン"), ("xi", "シー"),                             # 安西
    ("nan", "ナン"), ("tou", "トウ"), ("xian", "シエン"),       # 南投県
    ("xiong", "シオン"),                                        # 高雄
])
def test_syllable_to_kana_representative(syl, kana):
    assert syllable_to_kana(syl) == kana


def test_syllable_to_kana_u_medial_not_dropped():
    # 回帰: ua/uai/uan/uang は介音 u を落とさない（chuan→チュン, guang→グン のバグ防止）。
    assert syllable_to_kana("chuan") == "チュアン"
    assert syllable_to_kana("guang") == "グアン"
    assert syllable_to_kana("hua") == "フア"


def test_syllable_to_kana_empty_or_invalid_returns_none():
    assert syllable_to_kana("") is None
    assert syllable_to_kana(None) is None


# ---------------------------------------------------------------------------
# name_to_reading: 漢字名の全体読み（pypinyin 必須）
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not _HAS_PYPINYIN, reason="pypinyin 未導入")
@pytest.mark.parametrize("name,reading", [
    ("莆田市", "プーティエンシー"),
    ("銅川市", "トンチュアンシー"),
    ("広州市", "グアンチョウシー"),
    ("深圳市", "シェンチェンシー"),
    ("北京市", "ベイジンシー"),
    ("平地泉鎮", "ピンディーチュエンチェン"),
    ("安西", "アンシー"),
])
def test_name_to_reading_chinese(name, reading):
    assert name_to_reading(name) == reading


def test_name_to_reading_rejects_non_han():
    # カタカナ混在（例: 内モンゴル自治区）は部分誤読を避けて None（pypinyin 有無に依らず）。
    assert name_to_reading("内モンゴル自治区") is None
    assert name_to_reading("ジャンツー") is None
    assert name_to_reading("") is None
    assert name_to_reading(None) is None
