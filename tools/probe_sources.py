#!/usr/bin/env python3
"""探測各資料來源：連線 → 解析 → 回報結果與原始資料形狀（輸出 Markdown）。"""
from __future__ import annotations

import datetime as dt
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import http, macro, news, taifex, tpex, twse  # noqa: E402


def shape(obj, depth: int = 0) -> str:
    """用一行描述資料形狀（只列欄位名稱與第一筆資料），方便對照解析器假設。"""
    if isinstance(obj, list):
        head = shape(obj[0], depth + 1) if obj else "∅"
        return f"list[{len(obj)}] of {head}"
    if isinstance(obj, dict):
        keys = list(obj.keys())
        s = ", ".join(map(str, keys[:24])) + (" …" if len(keys) > 24 else "")
        return "{" + s + "}"
    return type(obj).__name__


def raw_sample(obj) -> str:
    try:
        if isinstance(obj, list) and obj:
            obj = obj[0]
        elif isinstance(obj, dict) and isinstance(obj.get("data"), list) and obj["data"]:
            obj = {k: (v if k != "data" else v[:1]) for k, v in obj.items() if k in ("stat", "date", "fields", "data")}
        return json.dumps(obj, ensure_ascii=False)[:700]
    except Exception:  # noqa: BLE001
        return "(unprintable)"


def probe(name: str, fetch_raw, parse):
    print(f"\n### {name}")
    raw = None
    try:
        raw = fetch_raw()
        print(f"- 連線：✅ {shape(raw)}")
    except Exception as e:  # noqa: BLE001
        print(f"- 連線：❌ `{type(e).__name__}: {str(e)[:200]}`")
        return
    try:
        out = parse(raw)
        n = len(out) if hasattr(out, "__len__") else "-"
        print(f"- 解析：✅（{n}）")
    except Exception as e:  # noqa: BLE001
        print(f"- 解析：❌ `{type(e).__name__}: {str(e)[:200]}`")
        print(f"- 原始樣本：`{raw_sample(raw)}`")
        traceback.print_exc(file=sys.stderr)


def main() -> int:
    print(f"## 資料來源探測　{dt.datetime.now(twse.TZ).isoformat(timespec='seconds')}")
    probe("證交所 STOCK_DAY_ALL（日行情）", twse.fetch_stock_day_all, twse.parse_stock_rows)
    probe("證交所 t187ap03_L（產業別）", lambda: http.get_json(f"{twse.OPENAPI}/opendata/t187ap03_L", timeout=40), twse.parse_profile)
    probe("證交所 BFI82U（三大法人）", lambda: http.get_json(f"{twse.WWW}/rwd/zh/fund/BFI82U", params={"type": "day", "response": "json"}), twse.parse_institutional)
    probe("證交所 T86（個股法人）", lambda: http.get_json(f"{twse.WWW}/rwd/zh/fund/T86", params={"selectType": "ALLBUT0999", "response": "json"}, timeout=30), twse.parse_t86)
    probe("證交所 MI_MARGN（融資融券）", lambda: http.get_json(f"{twse.WWW}/rwd/zh/marginTrading/MI_MARGN", params={"selectType": "MS", "response": "json"}, timeout=30), twse.parse_margin)
    today = dt.datetime.now(twse.TZ).date().replace(day=1)
    probe("證交所 FMTQIK（成交金額）", lambda: http.get_json(f"{twse.WWW}/rwd/zh/afterTrading/FMTQIK", params={"date": today.strftime("%Y%m%d"), "response": "json"}), twse.parse_turnover)
    probe("證交所 TWT48U_ALL（除權息）", lambda: http.get_json(f"{twse.OPENAPI}/exchangeReport/TWT48U_ALL", timeout=30), twse.parse_dividends)
    probe("證交所 注意股票", lambda: http.get_json(f"{twse.OPENAPI}/announcement/notice", timeout=25), twse.parse_notices)
    probe("證交所 處置股票", lambda: http.get_json(f"{twse.OPENAPI}/announcement/punish", timeout=25), twse.parse_notices)
    probe("櫃買 上櫃日行情", tpex.fetch_daily, tpex.parse_daily)
    probe("期交所 三大法人期貨未平倉", lambda: http.get_json(taifex.URL, timeout=30), taifex.parse_futures_oi)
    probe("Google 新聞 RSS", lambda: http.get(news.gn("台股"), timeout=20).content, news.parse_rss)
    probe("Yahoo 股市 RSS", lambda: http.get(news.FEEDS[-1], timeout=20).content, news.parse_rss)

    print("\n### Yahoo Finance（yfinance）")
    try:
        from pipeline.quotes import download_histories

        got = download_histories(["^TWII", "2330.TW", "TWD=X"], sleep=0.5)
        print(f"- 取得 {sorted(got)}；^TWII 最新日 {got['^TWII'].index[-1].date() if '^TWII' in got else '—'}")
    except Exception as e:  # noqa: BLE001
        print(f"- ❌ `{type(e).__name__}: {str(e)[:200]}`")

    print("\n### FRED")
    try:
        rows = macro.fetch_macro()
        print(f"- {'✅' if rows else '⚠️ 沒有資料（未設定 FRED_API_KEY 或全部失敗）'}（{len(rows)} 項）")
    except Exception as e:  # noqa: BLE001
        print(f"- ❌ `{type(e).__name__}: {str(e)[:200]}`")
    return 0


if __name__ == "__main__":
    sys.exit(main())
