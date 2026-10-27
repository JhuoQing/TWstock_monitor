#!/usr/bin/env python3
"""抓取台股儀表板資料並輸出 data.json（由 GitHub Actions 定時執行）。"""
import json, os, datetime as dt
from urllib.parse import quote
import requests, feedparser, yfinance as yf

TZ = dt.timezone(dt.timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (twstock-monitor)"}

SYMBOLS = [
    ("^TWII", "加權指數", "台股"), ("^TWOII", "櫃買指數", "台股"),
    ("2330.TW", "台積電", "台股"), ("2317.TW", "鴻海", "台股"),
    ("2454.TW", "聯發科", "台股"), ("0050.TW", "元大台灣50", "台股"),
    ("^GSPC", "S&P 500", "全球"), ("^IXIC", "那斯達克", "全球"),
    ("^SOX", "費城半導體", "全球"), ("^N225", "日經225", "全球"),
    ("^KS11", "韓國 KOSPI", "全球"), ("^HSI", "恆生指數", "全球"),
    ("^VIX", "VIX 恐慌指數", "全球"),
    ("TWD=X", "美元/台幣", "匯率商品"), ("^TNX", "美國10年期殖利率", "匯率商品"),
    ("GC=F", "黃金", "匯率商品"), ("CL=F", "WTI 原油", "匯率商品"),
    ("BTC-USD", "比特幣", "匯率商品"),
]

def num(s):
    try:
        return float(str(s).replace(",", "").replace("+", "").strip())
    except Exception:
        return None

def fetch_quotes():
    out, hist = [], {}
    for sym, name, grp in SYMBOLS:
        try:
            c = yf.Ticker(sym).history(period="1y", interval="1d")["Close"].dropna()
            if len(c) < 2:
                continue
            last, prev = float(c.iloc[-1]), float(c.iloc[-2])
            out.append({
                "symbol": sym, "name": name, "group": grp,
                "price": round(last, 2), "chg": round(last - prev, 2),
                "pct": round((last / prev - 1) * 100, 2),
                "date": c.index[-1].strftime("%Y-%m-%d"),
                "spark": [round(float(x), 2) for x in c.iloc[-30:]],
            })
            if sym == "^TWII":
                hist = {"dates": [d.strftime("%Y-%m-%d") for d in c.index],
                        "close": [round(float(x), 2) for x in c]}
        except Exception as e:
            print("skip", sym, e)
    return out, hist

def fetch_institutional():
    """三大法人買賣金額統計（億元）"""
    try:
        r = requests.get("https://www.twse.com.tw/rwd/zh/fund/BFI82U",
                         params={"type": "day", "response": "json"}, headers=UA, timeout=20)
        j = r.json()
        rows = [{"name": x[0], "buy": round(num(x[1]) / 1e8, 2),
                 "sell": round(num(x[2]) / 1e8, 2), "net": round(num(x[3]) / 1e8, 2)}
                for x in j.get("data", [])]
        return {"date": j.get("date", ""), "rows": rows}
    except Exception as e:
        print("institutional failed", e)
        return {"date": "", "rows": []}

def fetch_rankings():
    """全市場成交值排行、漲跌幅排行（證交所 OpenAPI）"""
    try:
        r = requests.get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
                         headers=UA, timeout=30)
        rows = []
        for x in r.json():
            code, close, chg, val = x.get("Code", ""), num(x.get("ClosingPrice")), num(x.get("Change")), num(x.get("TradeValue"))
            if len(code) != 4 or not code.isdigit() or close is None or chg is None or val is None:
                continue
            base = close - chg
            if base <= 0:
                continue
            rows.append({"code": code, "name": x.get("Name", ""), "close": close,
                         "pct": round(chg / base * 100, 2), "value": round(val / 1e8, 1)})
        top = lambda key, rev, n=10: sorted(rows, key=lambda z: z[key], reverse=rev)[:n]
        liquid = [z for z in rows if z["value"] >= 1]  # 排除成交值過小的標的
        return {"by_value": top("value", True),
                "gainers": sorted(liquid, key=lambda z: -z["pct"])[:10],
                "losers": sorted(liquid, key=lambda z: z["pct"])[:10]}
    except Exception as e:
        print("rankings failed", e)
        return {"by_value": [], "gainers": [], "losers": []}

KW = {"升息": 3, "降息": 3, "央行": 3, "聯準會": 3, "Fed": 3, "FOMC": 3, "關稅": 3, "制裁": 3,
      "重挫": 3, "大跌": 3, "暴跌": 3, "崩盤": 3, "熔斷": 3, "外資": 2, "台積電": 2, "輝達": 2,
      "大漲": 2, "飆": 2, "創高": 2, "創新高": 2, "地緣": 2, "CPI": 2, "通膨": 2, "財報": 2,
      "法說": 2, "停牌": 2, "金管會": 2, "貶值": 2, "升值": 2, "戰": 2,
      "匯率": 1, "AI": 1, "半導體": 1, "出口": 1, "景氣": 1, "證交所": 1}

def gn(q):
    return f"https://news.google.com/rss/search?q={quote(q + ' when:2d')}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"

FEEDS = [gn("台股"), gn("外資 台股"), gn("台積電"), gn("央行 利率"), gn("聯準會"),
         gn("關稅 半導體"), "https://tw.stock.yahoo.com/rss?category=tw-market"]

def fetch_news():
    seen, items = set(), []
    now = dt.datetime.now(dt.timezone.utc)
    for url in FEEDS:
        try:
            feed = feedparser.parse(requests.get(url, headers=UA, timeout=20).content)
        except Exception as e:
            print("feed failed", url, e)
            continue
        for e in feed.entries:
            title = e.get("title", "").strip()
            if not title or title in seen:
                continue
            seen.add(title)
            src = (e.get("source") or {}).get("title", "")
            if " - " in title and not src:
                title, src = title.rsplit(" - ", 1)
            p = e.get("published_parsed")
            t = dt.datetime(*p[:6], tzinfo=dt.timezone.utc) if p else now
            if (now - t).days > 3:
                continue
            score = sum(w for k, w in KW.items() if k in title)
            items.append({"title": title, "link": e.get("link", ""), "source": src or "新聞",
                          "time": t.astimezone(TZ).isoformat(), "score": score, "important": score >= 3})
    items.sort(key=lambda z: (z["important"], z["time"]), reverse=True)
    return items[:60]

FRED = [("FEDFUNDS", "美國聯邦基金利率", "level"), ("DGS10", "美國10年期公債殖利率", "level"),
        ("T10Y2Y", "美債 10Y-2Y 利差", "level"), ("CPIAUCSL", "美國 CPI 年增率", "yoy"),
        ("UNRATE", "美國失業率", "level")]

def fetch_macro():
    key = os.environ.get("FRED_API_KEY")
    if not key:
        return []
    out = []
    for sid, name, mode in FRED:
        try:
            r = requests.get("https://api.stlouisfed.org/fred/series/observations",
                             params={"series_id": sid, "api_key": key, "file_type": "json",
                                     "sort_order": "desc", "limit": 20}, timeout=20)
            obs = [(o["date"], float(o["value"])) for o in r.json()["observations"] if o["value"] != "."]
            if mode == "yoy":
                val, prev = (obs[0][1] / obs[12][1] - 1) * 100, (obs[1][1] / obs[13][1] - 1) * 100
            else:
                val, prev = obs[0][1], obs[1][1]
            out.append({"name": name, "value": round(val, 2), "prev": round(prev, 2), "date": obs[0][0], "unit": "%"})
        except Exception as e:
            print("fred skip", sid, e)
    return out

if __name__ == "__main__":
    quotes, hist = fetch_quotes()
    data = {"updated_at": dt.datetime.now(TZ).isoformat(timespec="seconds"),
            "quotes": quotes, "taiex_history": hist,
            "institutional": fetch_institutional(), "rankings": fetch_rankings(),
            "news": fetch_news(), "macro": fetch_macro()}
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("ok", len(quotes), "quotes;", len(data["news"]), "news")
