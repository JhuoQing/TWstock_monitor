"""櫃買中心（TPEx）上櫃股票日行情。"""
from __future__ import annotations

from . import http
from .twse import kind_of
from .util import num, to_iso_date

URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"


def fetch_daily() -> list[dict]:
    data = http.get_json(URL, timeout=40)
    if not isinstance(data, list) or not data:
        raise ValueError("TPEx daily empty")
    return data


def _pick(x: dict, *needles: str):
    for k, v in x.items():
        kl = k.lower()
        if any(n in kl for n in needles):
            return v
    return None


def parse_daily(raw: list[dict]) -> list[dict]:
    """整理成與 twse.parse_stock_rows 相同的欄位，kind 以 'otc' 標示上櫃普通股。"""
    rows = []
    for x in raw:
        code = str(_pick(x, "securitiescompanycode", "代號") or "").strip()
        if not code or kind_of(code) != "stock":
            continue
        close, chg = num(_pick(x, "close", "收盤")), num(_pick(x, "change", "漲跌"))
        if close is None or chg is None:
            continue
        base = close - chg
        if base <= 0:
            continue
        rows.append({
            "code": code,
            "name": str(_pick(x, "companyname", "名稱") or "").strip(),
            "kind": "otc",
            "close": close,
            "chg": chg,
            "pct": round(chg / base * 100, 2),
            "value": round((num(_pick(x, "transactionamount", "成交金額"), 0) or 0) / 1e8, 2),
            "vol": int((num(_pick(x, "tradingshares", "成交股數"), 0) or 0) // 1000),
            "date": to_iso_date(_pick(x, "date", "日期")),
        })
    if not rows:
        raise ValueError("TPEx parse produced nothing")
    return rows


def build_rankings(rows: list[dict], n: int = 20) -> dict:
    def top(key: str, rev: bool, min_value: float = 0.0, sign: int = 0):
        pool = sorted((r for r in rows if r["value"] >= min_value and (sign == 0 or r["pct"] * sign > 0)),
                      key=lambda r: r[key], reverse=rev)
        return [{k: r[k] for k in ("code", "name", "close", "pct", "value", "vol")} for r in pool[:n]]

    return {
        "by_value": top("value", True),
        "by_volume": top("vol", True),
        "gainers": top("pct", True, 0.5, sign=1),
        "losers": top("pct", False, 0.5, sign=-1),
    }
