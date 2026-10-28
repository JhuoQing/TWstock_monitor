#!/usr/bin/env python3
"""產生「開發用樣本資料」到 web/data/（合成資料，不是真實行情，不需要網路）。

用法：
    python tools/make_sample_data.py            # 輸出到 web/data
    python -m http.server -d web 8000           # 開 http://localhost:8000 預覽

整條流程走的是正式的 pipeline.build，所以同時是管線的整合測試。
輸出的 index.json 會帶 "sample": true，前端會顯示「樣本資料」提示。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import build as B  # noqa: E402
from pipeline import quotes as Q  # noqa: E402
from pipeline import taifex, tpex, twse  # noqa: E402
from pipeline.state import PrevState  # noqa: E402
from pipeline.util import TZ  # noqa: E402

SYLLABLES = list("富邦台聯華大中宏旺金科電達光新永遠國億鴻精能創昇碩康泰順嘉信揚晶宇力威")
START = {"^TWII": 24000, "^TWOII": 280, "^GSPC": 6500, "^IXIC": 22000, "^DJI": 44000, "^SOX": 6000, "TSM": 230,
         "ES=F": 6520, "NQ=F": 23500, "^N225": 43000, "^KS11": 3400, "^HSI": 25000, "000001.SS": 3600,
         "^GDAXI": 24000, "^VIX": 16, "TWD=X": 30.8, "JPY=X": 149, "DX-Y.NYB": 99, "^TNX": 4.2, "GC=F": 3900,
         "CL=F": 62, "HG=F": 4.8, "BTC-USD": 105000, "2330.TW": 1100, "2317.TW": 210, "2454.TW": 1400, "0050.TW": 60}


def last_weekday(d: dt.date) -> dt.date:
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


def synth_df(n: int, start: float, seed: int, end: dt.date, vol_scale: float, sigma: float = 0.014) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=end, periods=n, tz="Asia/Taipei")
    close = start * np.cumprod(1 + 0.0004 + rng.normal(0, sigma, n))
    open_ = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, 0.003, n))
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.012, n))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.012, n))
    vol = (vol_scale * rng.lognormal(0, 0.4, n)).astype(int)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx)


def make_world(end: dt.date, seed: int = 7):
    rng = np.random.default_rng(seed)
    syms = Q.load_symbols(ROOT / "symbols.json")
    hist = {}
    for i, s in enumerate(syms):
        start = START.get(s.symbol) or float(rng.choice([25, 38, 55, 82, 130, 210, 380, 640]))
        sigma = 0.006 if s.kind in ("fx",) else 0.011 if s.kind in ("index", "future", "rate") else 0.017
        hist[s.symbol] = synth_df(250, start, 100 + i, end, vol_scale=int(rng.integers(2_000, 80_000)) * 1000 if s.kind == "stock" else 10_000, sigma=sigma)

    # 全市場日行情：追蹤清單中的台股 + 填充用的合成股票
    inds = list(twse.INDUSTRY)
    rows, profile = [], []
    used = set()
    for s in syms:
        if s.kind not in ("stock", "etf"):
            continue
        code = s.symbol.split(".")[0]
        used.add(code)
        df = hist[s.symbol]
        c, p = float(df["Close"].iloc[-1]), float(df["Close"].iloc[-2])
        val = c * float(df["Volume"].iloc[-1]) * 1.0
        rows.append(dict(Code=code, Name=s.name, TradeVolume=str(int(df["Volume"].iloc[-1])), TradeValue=str(int(val)),
                         OpeningPrice=f"{df['Open'].iloc[-1]:.2f}", HighestPrice=f"{df['High'].iloc[-1]:.2f}",
                         LowestPrice=f"{df['Low'].iloc[-1]:.2f}", ClosingPrice=f"{c:.2f}", Change=f"{c - p:.2f}", Transaction="1000"))
        if s.kind == "stock":
            profile.append({"公司代號": code, "公司簡稱": s.name, "產業別": str(rng.choice(["24", "24", "28", "25", "17", "17", "15", "03", "10", "31"]))})
    while len([r for r in rows if len(r["Code"]) == 4 and r["Code"].isdigit()]) < 380:
        code = str(int(rng.integers(1101, 9958)))
        if code in used or len(code) != 4:
            continue
        used.add(code)
        name = "".join(rng.choice(SYLLABLES, size=int(rng.integers(2, 4))))
        price = float(rng.lognormal(3.4, 0.9))
        pct = float(np.clip(rng.normal(0, 2.4), -10, 10))
        base = price / (1 + pct / 100)
        value = float(rng.lognormal(19.5, 1.5))
        rows.append(dict(Code=code, Name=name, TradeVolume=str(int(value / price)), TradeValue=str(int(value)),
                         OpeningPrice=f"{base:.2f}", HighestPrice=f"{max(price, base) * 1.01:.2f}", LowestPrice=f"{min(price, base) * 0.99:.2f}",
                         ClosingPrice=f"{price:.2f}", Change=f"{price - base:.2f}", Transaction="500"))
        profile.append({"公司代號": code, "公司簡稱": name, "產業別": str(rng.choice(inds))})

    otc = []
    for _ in range(160):
        code = str(int(rng.integers(3000, 8999)))
        if code in used:
            continue
        used.add(code)
        price = float(rng.lognormal(3.6, 0.9))
        pct = float(np.clip(rng.normal(0, 2.8), -10, 10))
        base = price / (1 + pct / 100)
        value = float(rng.lognormal(18.8, 1.4))
        otc.append({"Date": end.strftime("%Y%m%d"), "SecuritiesCompanyCode": code, "CompanyName": "".join(rng.choice(SYLLABLES, size=3)),
                    "Close": f"{price:.2f}", "Change": f"{price - base:+.2f}", "TradingShares": str(int(value / price)), "TransactionAmount": str(int(value))})
    return syms, hist, rows, profile, otc, rng


def t86_for(rows, rng, end):
    fields = ["證券代號", "證券名稱", "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)", "外陸資買賣超股數(不含外資自營商)",
              "外資自營商買進股數", "外資自營商賣出股數", "外資自營商買賣超股數", "投信買進股數", "投信賣出股數", "投信買賣超股數",
              "自營商買賣超股數", "自營商買進股數(自行買賣)", "自營商賣出股數(自行買賣)", "自營商買賣超股數(自行買賣)",
              "自營商買進股數(避險)", "自營商賣出股數(避險)", "自營商買賣超股數(避險)", "三大法人買賣超股數"]
    data = []
    for r in rows:
        v = int(r["TradeVolume"])
        f, t, d = (int(rng.normal(0, v * 0.08)), int(rng.normal(0, v * 0.01)), int(rng.normal(0, v * 0.02)))
        x = ["0"] * 19
        x[0], x[1], x[4], x[10], x[11], x[18] = r["Code"], r["Name"], f"{f:,}", f"{t:,}", f"{d:,}", f"{f + t + d:,}"
        data.append(x)
    return {"stat": "OK", "date": end.strftime("%Y%m%d"), "fields": fields, "data": data}


def make_news(now: dt.datetime):
    heads = [
        ("外資連三日賣超 台股指數回測月線", "經濟日報", ["金融"]),
        ("Fed 官員暗示年內仍有降息空間 美債殖利率走低", "工商時報", ["總經"]),
        ("台積電法說會登場 市場聚焦先進製程產能與資本支出", "鉅亨網", ["半導體"]),
        ("AI 伺服器供應鏈出貨動能延續 ODM 廠財測樂觀", "經濟日報", ["AI", "電子"]),
        ("新台幣小幅升值 外資匯入帶動", "中央社", ["匯率"]),
        ("航運股走強 運價指數連續上揚", "工商時報", ["航運"]),
        ("美國對半導體加徵關稅傳聞再起 科技股承壓", "路透社", ["地緣", "半導體"]),
        ("央行理監事會議登場 市場預期利率持平", "自由財經", ["總經"]),
        ("油價回落 能源類股拉回整理", "鉅亨網", ["能源"]),
        ("投信本週買超電子權值股 作帳行情可期", "聯合新聞網", ["電子"]),
        ("金控 9 月獲利出爐 壽險匯損壓力趨緩", "經濟日報", ["金融"]),
        ("生技類股補漲 新藥授權題材發酵", "工商時報", ["生技"]),
        ("散熱族群創高 液冷滲透率成長受關注", "鉅亨網", ["AI", "電子"]),
        ("融資餘額連降 籌碼面持續沉澱", "中央社", []),
    ]
    out = []
    for i, (t, s, tg) in enumerate(heads):
        sc = 3 if any(w in t for w in ("Fed", "央行", "關稅", "法說")) else 1
        tone = "down" if any(w in t for w in ("賣超", "承壓", "回測")) else "up" if any(w in t for w in ("創高", "走強", "樂觀", "買超", "上揚", "升值")) else "flat"
        out.append({"title": t, "link": "https://example.com/sample", "source": s, "time": (now - dt.timedelta(minutes=35 * i + 12)).isoformat(timespec="seconds"),
                    "score": sc, "important": sc >= 3, "tone": tone, "tags": tg, "also": ["聯合新聞網"] if i % 5 == 0 else []})
    out.sort(key=lambda z: (z["important"], z["time"]), reverse=True)
    return out


def make_macro(rng):
    spec = [("FEDFUNDS", "美國聯邦基金利率", 4.1, 0.0, "%", "m"), ("DGS10", "美國10年期公債殖利率", 4.2, 0.05, "%", "d"),
            ("T10Y2Y", "美債 10Y-2Y 利差", 0.55, 0.03, "%", "d"), ("CPIAUCSL", "美國 CPI 年增率", 3.0, 0.08, "%", "m"),
            ("PCEPILFE", "美國核心 PCE 年增率", 2.8, 0.06, "%", "m"), ("UNRATE", "美國失業率", 4.3, 0.05, "%", "m"),
            ("PAYEMS", "非農就業人數月增", 85, 25, "千人", "m"), ("DTWEXBGS", "廣義美元指數", 120.5, 0.4, "", "d"),
            ("BAMLH0A0HYM2", "高收益債信用利差", 3.1, 0.06, "%", "d")]
    rows = []
    for sid, name, base, step, unit, freq in spec:
        vals = base + np.cumsum(rng.normal(0, step, 24))
        dates = [(dt.date(2026, 9, 1) - dt.timedelta(days=30 * (23 - i))).isoformat() for i in range(24)]
        rows.append({"id": sid, "name": name, "unit": unit, "freq": freq, "value": round(float(vals[-1]), 2), "prev": round(float(vals[-2]), 2),
                     "date": dates[-1], "hist": [[d, round(float(v), 3)] for d, v in zip(dates, vals)]})
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "web" / "data"))
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    now = dt.datetime.now(TZ)
    end = last_weekday(now.date())
    syms, hist, rows, profile, otc, rng = make_world(end, a.seed)

    os.environ["GEMINI_API_KEY"] = "sample"
    report = {"headline": "通膨黏著、就業降溫，利率路徑偏向觀望",
              "summary": "（樣本資料）核心通膨仍高於目標，就業增速放緩，殖利率曲線維持正斜率。以下內容為開發用的假資料，不代表任何真實數據。",
              "sections": [{"title": "通膨", "text": "CPI 與核心 PCE 年增率仍在 3% 附近，降溫速度緩慢。"},
                           {"title": "就業與成長", "text": "非農月增放緩至 8 萬人上下，失業率小幅上升。"},
                           {"title": "利率與殖利率曲線", "text": "10 年期殖利率約 4.2%，10Y-2Y 利差為正。"}],
              "watch": ["下月 CPI 與非農報告", "美元指數是否續強"], "risks": ["信用利差走闊"]}

    fx = SimpleNamespace(
        histories=lambda s: {k: hist[k] for k in s if k in hist},
        stock_day_all=lambda: rows, profile=lambda: twse.parse_profile(profile),
        institutional=lambda: twse.parse_institutional({"stat": "OK", "date": end.strftime("%Y%m%d"), "data": [
            ["自營商(自行買賣)", "1", "1", f"{int(rng.normal(0, 3e9))}"], ["自營商(避險)", "1", "1", f"{int(rng.normal(0, 5e9))}"],
            ["投信", "1", "1", f"{int(rng.normal(2e9, 3e9))}"], ["外資及陸資(不含外資自營商)", "1", "1", f"{int(rng.normal(-5e9, 4e10))}"],
            ["外資自營商", "0", "0", "0"], ["合計", "1", "1", "0"]]}),
        t86=lambda d: twse.parse_t86(t86_for(rows, rng, end)),
        margin=lambda d: {"date": end.isoformat(), "margin": {"bal": 8_420_000, "chg": -52_000}, "short": {"bal": 410_000, "chg": 6_000},
                          "margin_amt": {"bal": 3_350.0, "chg": -18.5}},
        turnover_hist=lambda: [{"d": d.date().isoformat(), "v": round(float(rng.normal(4200, 700)), 1), "i": None}
                               for d in hist["^TWII"].index[-30:]],
        tpex_daily=lambda: otc, futures_oi=lambda: {"date": end.isoformat(), "rows": [
            {"name": "外資及陸資", "net": int(rng.normal(-20000, 8000))}, {"name": "投信", "net": int(rng.normal(9000, 2000))},
            {"name": "自營商", "net": int(rng.normal(-2000, 1500))}]},
        dividends=lambda: [{"date": (end + dt.timedelta(days=2 + 3 * i)).isoformat(), "code": c, "name": n, "type": "息", "cash": v, "stock": None}
                           for i, (c, n, v) in enumerate([("2330", "台積電", 5.0), ("2881", "富邦金", 2.5), ("2412", "中華電", 4.6), ("2886", "兆豐金", 1.4)])],
        notices=lambda: {"attention": [{"code": "2603", "name": "長榮", "date": end.isoformat(), "note": "最近 6 個營業日累積收盤價漲幅異常"}],
                         "punish": [{"code": "3017", "name": "奇鋐", "date": end.isoformat(), "note": "處置期間 5 分鐘撮合一次"}]},
        news=lambda: make_news(now), macro=lambda: make_macro(rng),
        ai_caller=lambda prompt, key: (report, "sample"), send_alert=lambda t: None,
    )
    out = Path(a.out)
    idx = B.build(ROOT / "symbols.json", out, PrevState(), fx=fx, now=now)

    # 補上歷史走勢（正式環境由每次執行累積而成）並標記為樣本
    days = [d.date().isoformat() for d in hist["^TWII"].index[-40:]]
    idx["inst_hist"] = [{"date": d, "foreign": round(float(rng.normal(-5, 90)), 2), "trust": round(float(rng.normal(3, 15)), 2),
                         "dealer": round(float(rng.normal(0, 25)), 2), "total": 0.0} for d in days]
    for h in idx["inst_hist"]:
        h["total"] = round(h["foreign"] + h["trust"] + h["dealer"], 2)
    idx["futures_hist"] = [{"date": d, "foreign": int(rng.normal(-20000, 9000)), "trust": int(rng.normal(9000, 2500)), "dealer": int(rng.normal(-2000, 2000))} for d in days]
    idx["margin_hist"] = [{"date": d, "margin": int(8_400_000 + i * 1500 + rng.normal(0, 30_000)), "short": int(400_000 + rng.normal(0, 9000)),
                           "margin_amt": round(3300 + i * 1.2 + float(rng.normal(0, 15)), 1)} for i, d in enumerate(days)]
    idx["sample"] = True
    B.write_json(out / "index.json", idx)
    print(f"sample data written to {out} ({len(idx['quotes'])} quotes, {len(json.loads((out / 'universe.json').read_text()))} universe)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
