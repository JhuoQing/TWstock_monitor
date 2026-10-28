"""讀取「上一版」已部署的資料，用於失敗時沿用舊值、AI 報告節流與歷史累積。

網站改由 GitHub Actions 部署後不再把 data.json commit 進倉庫，
所以上一版資料改從線上網站（PREV_BASE_URL）或本機目錄（PREV_DIR）讀取。
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from . import http

log = logging.getLogger("pipeline.state")


class PrevState:
    def __init__(self, base_url: str | None = None, local_dir: str | os.PathLike | None = None):
        self.base_url = (base_url or "").rstrip("/")
        self.local_dir = Path(local_dir) if local_dir else None
        self._cache: dict[str, Any] = {}

    def get(self, relpath: str) -> Any | None:
        """讀取相對於 data/ 的 JSON；取不到回傳 None（絕不丟例外）。"""
        if relpath in self._cache:
            return self._cache[relpath]
        val = self._load(relpath)
        self._cache[relpath] = val
        return val

    def _load(self, relpath: str) -> Any | None:
        if self.local_dir is not None:
            p = self.local_dir / relpath
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None
        if self.base_url:
            try:
                r = http.session().get(f"{self.base_url}/data/{relpath}", timeout=15)
                if r.status_code != 200:
                    return None
                return r.json()
            except Exception as e:  # noqa: BLE001 - 取不到舊資料不應中斷主流程
                log.info("prev state unavailable: %s (%s)", relpath, type(e).__name__)
                return None
        return None
