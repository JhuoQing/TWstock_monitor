"""HTTP 工具：共用 Session、自動重試（含 429 / 5xx 退避）。"""
from __future__ import annotations

from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

UA = {"User-Agent": "Mozilla/5.0 (twstock-monitor; +https://github.com/JhuoQing/TWstock_monitor)"}

_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        s = requests.Session()
        retry = Retry(
            total=3,
            connect=3,
            read=2,
            backoff_factor=1.0,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(["GET", "POST"]),
            respect_retry_after_header=True,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=8)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        s.headers.update(UA)
        _session = s
    return _session


def get(url: str, *, params: dict | None = None, timeout: float = 25, headers: dict | None = None) -> requests.Response:
    r = session().get(url, params=params, timeout=timeout, headers=headers)
    r.raise_for_status()
    return r


def get_json(url: str, *, params: dict | None = None, timeout: float = 25, headers: dict | None = None) -> Any:
    r = get(url, params=params, timeout=timeout, headers=headers)
    try:
        return r.json()
    except ValueError as e:
        # 來源回了空內容或 HTML（尚未公布、被擋、維護中），把線索寫進錯誤訊息方便從 Actions log 判斷
        preview = " ".join(r.text[:120].split())
        raise ValueError(
            f"non-JSON response from {r.url.split('?')[0]}: status={r.status_code} "
            f"type={r.headers.get('content-type', '?')} bytes={len(r.content)} body={preview!r}"
        ) from e


def post_json(url: str, *, json: Any, headers: dict | None = None, timeout: float = 90) -> requests.Response:
    r = session().post(url, json=json, headers=headers, timeout=timeout)
    r.raise_for_status()
    return r
