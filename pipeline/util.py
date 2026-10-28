"""共用小工具：數值解析、日期轉換、字串處理。"""
from __future__ import annotations

import datetime as dt
import math
import re
from typing import Any

TZ = dt.timezone(dt.timedelta(hours=8))

_EMPTY = {"", "-", "--", "---", "X", "x", "N/A", "n/a", "nan", "NaN", "None", "null"}
_TAG = re.compile(r"<[^>]+>")


def now_tw() -> dt.datetime:
    return dt.datetime.now(TZ)


def strip_html(s: Any) -> str:
    return _TAG.sub("", str(s or "")).strip()


def num(s: Any, default: float | None = None) -> float | None:
    """把 '1,234.5'、'+12'、' 0.50'、'-' 這類字串轉成 float；無法解析時回傳 default。"""
    if s is None:
        return default
    if isinstance(s, bool):
        return default
    if isinstance(s, (int, float)):
        f = float(s)
        return default if math.isnan(f) or math.isinf(f) else f
    t = strip_html(s).replace(",", "").replace("+", "").replace(" ", "").replace("%", "")
    if t in _EMPTY:
        return default
    try:
        f = float(t)
    except ValueError:
        return default
    return default if math.isnan(f) or math.isinf(f) else f


def to_iso_date(s: Any) -> str:
    """支援 '20261027'、'2026-10-27'、'2026/10/27'、民國 '1151027'、'115/10/27' → '2026-10-27'。失敗回傳空字串。"""
    if s is None:
        return ""
    t = str(s).strip()
    m = re.fullmatch(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", t)
    if m:
        y, mo, d = map(int, m.groups())
        return _safe_date(y, mo, d)
    m = re.fullmatch(r"(\d{2,3})[-/](\d{1,2})[-/](\d{1,2})", t)  # 民國 115/10/27
    if m:
        y, mo, d = map(int, m.groups())
        return _safe_date(y + 1911, mo, d)
    digits = re.sub(r"\D", "", t)
    if len(digits) == 8:
        return _safe_date(int(digits[:4]), int(digits[4:6]), int(digits[6:]))
    if len(digits) == 7:  # 民國 1151027
        return _safe_date(int(digits[:3]) + 1911, int(digits[3:5]), int(digits[5:]))
    return ""


def _safe_date(y: int, m: int, d: int) -> str:
    try:
        return dt.date(y, m, d).isoformat()
    except ValueError:
        return ""


def to_compact_date(iso: str) -> str:
    return iso.replace("-", "")


def rnd(x: float, digits: int | None = None) -> float:
    """依數值大小自動選小數位：<10 取 4 位，其餘取 2 位。"""
    if digits is None:
        digits = 4 if abs(x) < 10 else 2
    return round(float(x), digits)


def clip(x: Any, n: int) -> str:
    return str(x or "")[:n]


def safe_filename(symbol: str) -> str:
    """代號 → 檔名；與前端 symFile() 規則一致。"""
    return symbol.replace("^", "_").replace("=", "_").replace("/", "_")
