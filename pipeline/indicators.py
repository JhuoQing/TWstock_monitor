"""技術指標摘要（供首頁「訊號掃描」與清單使用）。圖表上的完整指標由前端以相同定義自行計算。"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

# 訊號代碼（前端 signals.js 有對應的中文名稱）
SIGNALS = (
    "golden_cross",  # MA5 上穿 MA20（近 3 日內）
    "death_cross",   # MA5 下穿 MA20（近 3 日內）
    "breakout20",    # 收盤突破前 20 日最高價
    "breakdown20",   # 收盤跌破前 20 日最低價
    "vol_surge",     # 成交量 ≥ 20 日均量 2 倍
    "rsi_overbought",
    "rsi_oversold",
    "ma_bull",       # 多頭排列：MA5 > MA20 > MA60 且收盤 > MA20
    "ma_bear",       # 空頭排列
    "new_high",      # 逼近 / 創一年新高
)


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def rsi_series(close: pd.Series, n: int = 14) -> pd.Series:
    """Wilder RSI：前 n 期用簡單平均起算，之後遞迴平滑（與前端定義一致）。"""
    c = close.to_numpy(dtype=float)
    out = np.full(len(c), np.nan)
    if len(c) <= n:
        return pd.Series(out, index=close.index)
    d = np.diff(c)
    gain = np.where(d > 0, d, 0.0)
    loss = np.where(d < 0, -d, 0.0)
    g = gain[:n].mean()
    l = loss[:n].mean()
    out[n] = _rsi_val(g, l)
    for i in range(n + 1, len(c)):
        g = (g * (n - 1) + gain[i - 1]) / n
        l = (l * (n - 1) + loss[i - 1]) / n
        out[i] = _rsi_val(g, l)
    return pd.Series(out, index=close.index)


def _rsi_val(g: float, l: float) -> float:
    if l == 0:
        return 100.0 if g > 0 else 50.0
    return 100.0 - 100.0 / (1.0 + g / l)


def _f(x: Any, digits: int = 2) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return round(v, digits)


def tech_summary(df: pd.DataFrame) -> tuple[dict, list[str]]:
    """回傳 (tech 數值摘要, 訊號代碼列表)。df 需含 Open/High/Low/Close/Volume。"""
    c = df["Close"].astype(float)
    h = df["High"].astype(float)
    l = df["Low"].astype(float)
    v = df["Volume"].astype(float).fillna(0)
    n = len(c)
    last = float(c.iloc[-1])

    ma5, ma20, ma60 = sma(c, 5), sma(c, 20), sma(c, 60)
    rsi = rsi_series(c, 14)
    hi52, lo52 = float(h.max()), float(l.min())

    def ret(days: int) -> float | None:
        return _f((last / float(c.iloc[-1 - days]) - 1) * 100) if n > days else None

    avg20 = float(v.iloc[-21:-1].mean()) if n >= 22 else 0.0
    vr = _f(float(v.iloc[-1]) / avg20) if avg20 > 0 else None

    logret = np.log(c / c.shift(1)).dropna().iloc[-20:]
    vol20 = _f(float(logret.std(ddof=0)) * math.sqrt(252) * 100, 1) if len(logret) >= 10 else None

    tech = {
        "rsi": _f(rsi.iloc[-1], 1),
        "ma5": _f(ma5.iloc[-1], 4),
        "ma20": _f(ma20.iloc[-1], 4),
        "ma60": _f(ma60.iloc[-1], 4),
        "hi52": _f(hi52, 4),
        "lo52": _f(lo52, 4),
        "from_hi": _f((last / hi52 - 1) * 100) if hi52 else None,
        "ret_1w": ret(5),
        "ret_1m": ret(21),
        "ret_3m": ret(63),
        "ret_1y": _f((last / float(c.iloc[0]) - 1) * 100) if n > 1 else None,
        "vr": vr,
        "vol20": vol20,
    }

    sig: list[str] = []
    # 均線交叉（近 3 日）
    if n >= 24 and not math.isnan(ma20.iloc[-1]):
        diff = (ma5 - ma20).iloc[-4:]
        if not diff.isna().any():
            if diff.iloc[-1] > 0 and (diff.iloc[:-1] <= 0).any():
                sig.append("golden_cross")
            elif diff.iloc[-1] < 0 and (diff.iloc[:-1] >= 0).any():
                sig.append("death_cross")
    # 20 日高低突破
    if n >= 22:
        prev_hi = float(h.iloc[-21:-1].max())
        prev_lo = float(l.iloc[-21:-1].min())
        if last > prev_hi:
            sig.append("breakout20")
        elif last < prev_lo:
            sig.append("breakdown20")
    if vr is not None and vr >= 2:
        sig.append("vol_surge")
    r = tech["rsi"]
    if r is not None:
        if r >= 70:
            sig.append("rsi_overbought")
        elif r <= 30:
            sig.append("rsi_oversold")
    m5, m20, m60 = tech["ma5"], tech["ma20"], tech["ma60"]
    if None not in (m5, m20, m60):
        if m5 > m20 > m60 and last > m20:
            sig.append("ma_bull")
        elif m5 < m20 < m60 and last < m20:
            sig.append("ma_bear")
    if tech["from_hi"] is not None and tech["from_hi"] >= -1.0 and n >= 120:
        sig.append("new_high")
    return tech, sig
