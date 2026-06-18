import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
import requests
from collectors.lib.http import retry, is_transient, collect_batches


def _http_error(code):
    resp = requests.Response()
    resp.status_code = code
    return requests.exceptions.HTTPError(response=resp)


def test_retry_returns_value_on_first_success():
    calls = []
    def f():
        calls.append(1)
        return "ok"
    assert retry(f, attempts=3, wait=0, sleep=lambda s: None) == "ok"
    assert len(calls) == 1


def test_retry_retries_on_timeout_then_succeeds():
    n = {"i": 0}
    def f():
        n["i"] += 1
        if n["i"] < 3:
            raise requests.exceptions.ReadTimeout("boom")
        return "ok"
    slept = []
    assert retry(f, attempts=5, wait=7, sleep=slept.append) == "ok"
    assert n["i"] == 3
    assert slept == [7, 7]   # 2回待ってから3回目で成功


def test_retry_reraises_non_transient_immediately():
    n = {"i": 0}
    def f():
        n["i"] += 1
        raise ValueError("nope")
    with pytest.raises(ValueError):
        retry(f, attempts=3, wait=0, sleep=lambda s: None)
    assert n["i"] == 1   # 非一時的エラーはリトライしない


def test_retry_exhausts_attempts_then_raises_transient():
    n = {"i": 0}
    def f():
        n["i"] += 1
        raise requests.exceptions.ConnectTimeout("boom")
    with pytest.raises(requests.exceptions.ConnectTimeout):
        retry(f, attempts=3, wait=0, sleep=lambda s: None)
    assert n["i"] == 3


def test_retry_retries_on_429_http_error():
    n = {"i": 0}
    def f():
        n["i"] += 1
        if n["i"] < 2:
            raise _http_error(429)
        return "ok"
    assert retry(f, attempts=3, wait=0, sleep=lambda s: None) == "ok"
    assert n["i"] == 2


def test_collect_batches_all_success_sleeps_between():
    batches = [[1, 2], [3, 4], [5, 6]]
    slept = []
    resp, failed, aborted = collect_batches(
        batches, lambda b: [x * 10 for x in b], sleep_between=lambda: slept.append(1))
    assert resp == [[10, 20], [30, 40], [50, 60]]
    assert failed == 0 and aborted is False
    assert len(slept) == 2   # バッチ間のみ（最後の後は sleep しない）


def test_collect_batches_fills_none_on_sparse_failure_and_continues():
    batches = [[1, 2], [3, 4], [5, 6]]
    def fetch(b):
        if b == [3, 4]:
            raise requests.exceptions.ReadTimeout("x")
        return [v * 10 for v in b]
    resp, failed, aborted = collect_batches(batches, fetch)
    assert resp == [[10, 20], [None, None], [50, 60]]   # 失敗バッチは欠損で埋め続行
    assert failed == 1 and aborted is False


def test_collect_batches_aborts_on_consecutive_failures():
    batches = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]
    def fetch(b):
        if b in ([3, 4], [5, 6], [7, 8]):
            raise requests.exceptions.ConnectionError("down")
        return [v * 10 for v in b]
    resp, failed, aborted = collect_batches(batches, fetch, max_consecutive_fail=3)
    assert aborted is True and failed == 3
    assert len(resp) == 4    # batch1成功 + 3連続失敗で早期abort（batch5未到達）


def test_is_transient_classification():
    assert is_transient(requests.exceptions.ReadTimeout()) is True
    assert is_transient(requests.exceptions.ConnectTimeout()) is True
    assert is_transient(requests.exceptions.ConnectionError()) is True
    assert is_transient(_http_error(429)) is True
    assert is_transient(_http_error(503)) is True
    assert is_transient(_http_error(404)) is False
    assert is_transient(ValueError()) is False
