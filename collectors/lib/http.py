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
