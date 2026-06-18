import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
import requests
from collectors.lib.http import retry, is_transient


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


def test_is_transient_classification():
    assert is_transient(requests.exceptions.ReadTimeout()) is True
    assert is_transient(requests.exceptions.ConnectTimeout()) is True
    assert is_transient(requests.exceptions.ConnectionError()) is True
    assert is_transient(_http_error(429)) is True
    assert is_transient(_http_error(503)) is True
    assert is_transient(_http_error(404)) is False
    assert is_transient(ValueError()) is False
