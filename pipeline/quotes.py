"""報價與歷史資料（Yahoo Finance，經 yfinance）。

重點：
- 批次下載（分塊），失敗的標的逐一重試；
- 仍失敗時沿用上一版資料並標記 stale，而不是讓標的從頁面消失；
- yfinance 於函式內才匯入，方便測試時以假模組取代。
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from .indicators import tech_summary
from .util import rnd

log = logging.getLogger("pipeline.quotes")

CHUNK = 30
RETRIES = 2


@dataclass(frozen=True)
class Sym:
    symbol: str
    name: str
    group: str
    kind: str
    focus: bool = False


def load_symbols(path: str | Path) -> list[Sym]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    out, seen = [], set()
    for x in raw["symbols"]:
        s = x["symbol"].strip()
        if s in seen:
            continue
        seen.add(s)
        out.append(Sym(s, x["name"], x["group"], x.get("kind", "stock"), bool(x.get("focus", False))))
    return out


def _extract(df: pd.DataFrame, symbol: str) -> pd.DataFrame | None:
    """從 yf.download 結果取出單一標的（相容不同版本的欄位階層）。"""
    if df is None or df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        if symbol in df.columns.get_level_values(0):
            sub = df[symbol]
        elif symbol in df.columns.get_level_values(1):
            sub = df.xs(symbol, axis=1, level=1)
        else:
            return None
    else:
        sub = df
    return _clean(sub)


def _clean(sub: pd.DataFrame | None) -> pd.DataFrame | None:
    if sub is None or sub.empty or "Close" not in sub.columns:
        return None
    sub = sub.copy()
    sub = sub[sub["Close"].notna()]
    if len(sub) < 2:
        return None
    for col in ("Open", "High", "Low"):
        if col not in sub.columns:
            sub[col] = sub["Close"]
        sub[col] = sub[col].fillna(sub["Close"])
    if "Volume" not in sub.columns:
        sub["Volume"] = 0
    sub["Volume"] = sub["Volume"].fillna(0)
    # 修正資料源偶發的高低價錯置
    sub["High"] = sub[["High", "Open", "Close"]].max(axis=1)
    sub["Low"] = sub[["Low", "Open", "Close"]].min(axis=1)
    return sub


def download_histories(symbols: list[str], *, sleep: float = 1.0) -> dict[str, pd.DataFrame]:
    """回傳 {symbol: DataFrame}；抓不到的標的不在結果內。"""
    import yfinance as yf  # 延遲匯入

    out: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), CHUNK):
        chunk = symbols[i : i + CHUNK]
        try:
            df = yf.download(
                chunk, period="1y", interval="1d", group_by="ticker",
                auto_adjust=False, threads=True, progress=False, timeout=30,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("batch download failed (%s…): %s", chunk[0], e)
            df = None
        for s in chunk:
            sub = _extract(df, s) if df is not None else None
            if sub is not None:
                out[s] = sub
        if i + CHUNK < len(symbols):
            time.sleep(sleep)

    missing = [s for s in symbols if s not in out]
    for s in missing:
        for attempt in range(1, RETRIES + 1):
            try:
                h = yf.Ticker(s).history(period="1y", interval="1d", auto_adjust=False)
                sub = _clean(h)
                if sub is not None:
                    out[s] = sub
                    break
            except Exception as e:  # noqa: BLE001
                log.info("retry %s #%d failed: %s", s, attempt, e)
            time.sleep(sleep * attempt)
    return out


def build_quote(sym: Sym, df: pd.DataFrame, name: str | None = None) -> tuple[dict, dict]:
    """回傳 (index 用的 quote, 個股詳細檔 detail)。"""
    c = df["Close"].astype(float)
    last, prev = float(c.iloc[-1]), float(c.iloc[-2])
    tech, signals = tech_summary(df)
    dates = [d.strftime("%Y-%m-%d") for d in df.index]
    quote = {
        "symbol": sym.symbol,
        "name": name or sym.name,
        "group": sym.group,
        "kind": sym.kind,
        "focus": sym.focus,
        "price": rnd(last),
        "chg": rnd(last - prev),
        "pct": round((last / prev - 1) * 100, 2) if prev else 0.0,
        "date": dates[-1],
        "vol": int(df["Volume"].iloc[-1]),
        "spark": [rnd(x) for x in c.iloc[-30:]],
        "tech": tech,
        "signals": signals,
        "stale": False,
    }
    detail = {
        "symbol": sym.symbol,
        "name": quote["name"],
        "group": sym.group,
        "kind": sym.kind,
        "d": dates,
        "o": [rnd(x) for x in df["Open"].astype(float)],
        "h": [rnd(x) for x in df["High"].astype(float)],
        "l": [rnd(x) for x in df["Low"].astype(float)],
        "c": [rnd(x) for x in c],
        "v": [int(x) for x in df["Volume"]],
    }
    return quote, detail


def build_all(
    symbols: list[Sym],
    histories: dict[str, pd.DataFrame],
    names: dict[str, str] | None = None,
    prev_quotes: dict[str, dict] | None = None,
    prev_detail_loader: Any = None,
) -> tuple[list[dict], dict[str, dict], list[str]]:
    """組合所有標的。回傳 (quotes, details, failed_symbols)。

    取不到新資料的標的：沿用上一版 quote（stale=True）與詳細檔（若能取得）。
    """
    names = names or {}
    prev_quotes = prev_quotes or {}
    quotes: list[dict] = []
    details: dict[str, dict] = {}
    failed: list[str] = []
    for s in symbols:
        df = histories.get(s.symbol)
        if df is not None:
            code = s.symbol.split(".")[0]
            nm = names.get(code) if s.kind in ("stock", "etf") else None
            q, d = build_quote(s, df, nm)
            quotes.append(q)
            details[s.symbol] = d
            continue
        failed.append(s.symbol)
        pq = prev_quotes.get(s.symbol)
        if pq:
            pq = dict(pq)
            pq["stale"] = True
            quotes.append(pq)
            if prev_detail_loader:
                d = prev_detail_loader(s.symbol)
                if d:
                    details[s.symbol] = d
    return quotes, details, failed
