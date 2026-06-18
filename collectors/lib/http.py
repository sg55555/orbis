"""コレクタ共有の HTTP リトライ。

外部APIの一時的エラー（読取/接続タイムアウト・接続断・429・5xx）で
待機リトライする。GitHub Actions の共有IPでは Open-Meteo/OpenSky への
リクエストが散発的に Read/Connect timeout する（429ではない）ため、
これらを一時的エラーとして扱い、層全体を1回の失敗で落とさない。
"""
import time
import requests

# リトライ価値のある HTTP ステータス（レート制限・一時的なサーバ側障害）。
TRANSIENT_STATUS = {429, 500, 502, 503, 504}


def is_transient(exc):
    """例外が一時的（リトライ価値あり）かを判定（純粋）。"""
    # Timeout(Read/Connect) と ConnectionError はネットワーク一時障害。
    if isinstance(exc, (requests.exceptions.Timeout, requests.exceptions.ConnectionError)):
        return True
    if isinstance(exc, requests.exceptions.HTTPError):
        code = getattr(getattr(exc, "response", None), "status_code", None)
        return code in TRANSIENT_STATUS
    return False


def retry(fetcher, attempts=3, wait=2.0, sleep=time.sleep):
    """fetcher() を呼び、一時的エラーなら wait 秒待って最大 attempts 回試行する。

    非一時的エラーは即座に再送出。最後の試行でも失敗ならその例外を送出。
    sleep はテスト用に注入可能（既定は time.sleep）。
    """
    for k in range(attempts):
        try:
            return fetcher()
        except Exception as e:
            if not is_transient(e) or k == attempts - 1:
                raise
            sleep(wait)


def collect_batches(batches, fetch_one, sleep_between=lambda: None, max_consecutive_fail=3):
    """グリッド収集を best-effort 化する。各バッチを fetch_one(batch) で取得し、
    失敗したバッチは [None]*len(batch) で埋めて**続行**する（1バッチ失敗で層全体を捨てない）。

    ただし max_consecutive_fail 回連続で失敗したらエンドポイント障害とみなし早期 abort する
    （全バッチを無駄に試して時間を浪費しない）。
    返り値: (responses, failed_count, aborted)。
    sleep_between はバッチ間にのみ呼ぶ（テスト用に注入可能）。
    """
    responses, failed, consec = [], 0, 0
    for i, batch in enumerate(batches):
        try:
            responses.append(fetch_one(batch))
            consec = 0
        except Exception as e:
            failed += 1
            consec += 1
            responses.append([None] * len(batch))
            print(f"[collect] batch {i + 1}/{len(batches)} failed: {e}; filling None")
            if consec >= max_consecutive_fail:
                print(f"[collect] {consec} consecutive failures; aborting (endpoint likely down)")
                return responses, failed, True
        if i + 1 < len(batches):
            sleep_between()
    return responses, failed, False
