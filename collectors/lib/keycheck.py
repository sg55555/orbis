"""key-gated collector の観測性規約を1箇所に集約する（2026-07-21 規約決定）。

背景：collect*.yml の各ステップは
`python -m collectors.<layer> || python -m collectors.lib.mark_error <layer>` で、
mark_error は collector が **非ゼロ終了したときだけ** ::warning:: と last_error_at を立てる。
ところが key-gated collector（ships/firms/news/briefing）は API キー欠落時に return 0（無言）で
抜けるため、本番でキーが失効/削除/typo で消えても run は緑のまま＝flights 型のサイレント失敗を
キー欠落経路が構造的に迂回していた（2026-07-17 監査）。

この規約：本番 CI（GitHub Actions）で「本番で存在すべき」と宣言済みのキーが欠落したときだけ
SystemExit(1) を投げ、既存の `|| mark_error` に流して可視化する。それ以外
（REQUIRED 未登録の新層／停止中の層／ローカル）は従来どおり無言で None を返す。

『本番で必須のキー』は yml 文字列マーカーでなくこの REQUIRED dict に置く：
step をコピペしても stray マーカーが伝播せず、宣言が1箇所に集約される（監査の footgun 根絶）。
REQUIRED への追記は secret を作成する同一 PR でのみ行う（implement-first を守る運用規律）。

判定は env のみに依存する（manifest の成功履歴を見ない）＝初回 typo・manifest reset・初回 run
でも失効を検知でき、成功履歴 discriminator の死角を回避する。
"""
import os

# 唯一の『本番で必須のキー』宣言。{layer: ENV_NAME}。
# ここに載る＝「その層は本番CIでこのキーが供給されているべき」＝欠落は退行として警報する。
REQUIRED = {
    "ships": "AISSTREAM_API_KEY",
    "firms": "FIRMS_MAP_KEY",
}


def _in_production():
    """本番CIか。GitHub Actions runner が自動注入する＝ローカルには存在しない。"""
    return os.environ.get("GITHUB_ACTIONS") == "true"


def key_or_skip(layer, key_name):
    """キーを返すか、欠落を無言 skip（None）か、本番退行なら SystemExit(1) を投げる。

    戻り値:
      truthy(str) … 供給済み。呼び出し側は続行する。
      None        … キー欠落だが「REQUIRED かつ本番CI」でない
                     （implement-first 期間／停止層／ローカル）。
                     呼び出し側は従来どおり print skip して return 0/None する。
    送出:
      SystemExit(1) … REQUIRED かつ本番CI でキーが空＝供給済みが消えた退行。
                      ステップ非ゼロ→既存 `|| mark_error <layer>` が
                      ::warning:: と last_error_at を立てる（flights 型と機構一本化）。

    ・SystemExit は int コードのみ・メッセージ引数を持たせない＝例外文言経路を開かない（不変則4）。
    ・必ずスナップショット書込みの前に呼ぶこと＝keep-previous-snapshot を壊さない（不変則2）。
    """
    value = os.environ.get(key_name)
    if value:
        return value
    if REQUIRED.get(layer) == key_name and _in_production():
        # ログは層名のみ補間（キーVALUE/例外/URL は載せない・不変則4）。詳細はステップログの
        # ::warning:: 側で見る（mark_error 既存方針と統一）。
        print(f"[{layer}] required API key absent in production; alerting via mark_error")
        raise SystemExit(1)
    return None
