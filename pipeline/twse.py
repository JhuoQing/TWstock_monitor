"""臺灣證券交易所（TWSE）資料。

每個資料來源拆成 fetch_*（網路）與 parse_* / build_*（純函式，可用測試樣本驗證）。
證交所的欄位偶爾調整，所以解析一律「依欄位名稱找欄位」，找不到就丟例外，由 build.py 沿用舊資料。
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from . import http
from .util import TZ, clip, num, strip_html, to_compact_date, to_iso_date

log = logging.getLogger("pipeline.twse")

WWW = "https://www.twse.com.tw"
OPENAPI = "https://openapi.twse.com.tw/v1"

# 產業別代碼 → 名稱（t187ap03_L「產業別」欄）
INDUSTRY = {
    "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維", "05": "電機機械",
    "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙工業", "10": "鋼鐵工業", "11": "橡膠工業",
    "12": "汽車工業", "14": "建材營造", "15": "航運業", "16": "觀光餐旅", "17": "金融保險",
    "18": "貿易百貨", "19": "綜合", "20": "其他", "21": "化學工業", "22": "生技醫療",
    "23": "油電燃氣", "24": "半導體", "25": "電腦週邊", "26": "光電業", "27": "通信網路",
    "28": "電子零組件", "29": "電子通路", "30": "資訊服務", "31": "其他電子", "35": "文化創意",
    "36": "農業科技", "37": "電子商務", "38": "運動休閒", "39": "居家生活", "91": "存託憑證",
}


# ───────────────────────── 日行情（STOCK_DAY_ALL） ─────────────────────────

def kind_of(code: str) -> str:
    """'stock' 普通股、'etf' ETF、'other' 其他（權證、特別股、債券 ETF 等）。"""
    if code.startswith("00") and len(code) >= 4:
        return "etf"
    if len(code) == 4 and code.isdigit():
        return "stock"
    return "other"


def fetch_stock_day_all() -> list[dict]:
    data = http.get_json(f"{OPENAPI}/exchangeReport/STOCK_DAY_ALL", timeout=40)
    if not isinstance(data, list) or not data:
        raise ValueError("STOCK_DAY_ALL empty")
    return data


def parse_stock_rows(raw: list[dict]) -> list[dict]:
    """整理成 [{code,name,kind,close,chg,pct,value(億),vol(張),open,high,low}]；停牌（無收盤價）者略過。"""
    rows = []
    for x in raw:
        code = str(x.get("Code", "")).strip()
        if not code:
            continue
        close, chg = num(x.get("ClosingPrice")), num(x.get("Change"))
        if close is None or chg is None:
            continue
        base = close - chg
        if base <= 0:
            continue
        rows.append({
            "code": code,
            "name": str(x.get("Name", "")).strip(),
            "kind": kind_of(code),
            "close": close,
            "chg": chg,
            "pct": round(chg / base * 100, 2),
            "value": round((num(x.get("TradeValue"), 0) or 0) / 1e8, 2),
            "vol": int((num(x.get("TradeVolume"), 0) or 0) // 1000),
            "open": num(x.get("OpeningPrice")),
            "high": num(x.get("HighestPrice")),
            "low": num(x.get("LowestPrice")),
        })
    return rows


def _top(rows: list[dict], key: str, reverse: bool, n: int, min_value: float = 0.0, sign: int = 0) -> list[dict]:
    """sign=1 只取 pct>0（漲幅榜）、sign=-1 只取 pct<0（跌幅榜）。"""
    pool = [r for r in rows if r["value"] >= min_value and (sign == 0 or r["pct"] * sign > 0)]
    pool.sort(key=lambda r: r[key], reverse=reverse)
    return [{k: r[k] for k in ("code", "name", "close", "pct", "value", "vol")} for r in pool[:n]]


def build_rankings(rows: list[dict], n: int = 20) -> dict:
    out: dict[str, Any] = {}
    for kind, min_val in (("stock", 1.0), ("etf", 0.3)):
        pool = [r for r in rows if r["kind"] == kind]
        out[kind] = {
            "by_value": _top(pool, "value", True, n),
            "by_volume": _top(pool, "vol", True, n),
            "gainers": _top(pool, "pct", True, n, min_val, sign=1),
            "losers": _top(pool, "pct", False, n, min_val, sign=-1),
        }
    return out


def build_breadth(rows: list[dict]) -> dict:
    stocks = [r for r in rows if r["kind"] == "stock"]
    up = sum(1 for r in stocks if r["chg"] > 0)
    down = sum(1 for r in stocks if r["chg"] < 0)
    flat = len(stocks) - up - down
    return {
        "up": up,
        "down": down,
        "flat": flat,
        "limit_up": sum(1 for r in stocks if r["pct"] >= 9.45),
        "limit_down": sum(1 for r in stocks if r["pct"] <= -9.45),
        "turnover": round(sum(r["value"] for r in rows if r["kind"] in ("stock", "etf")), 1),
        "count": len(stocks),
    }


# ───────────────────────── 產業別、熱力圖 ─────────────────────────

def fetch_profile() -> dict[str, str]:
    """上市公司代號 → 產業名稱。"""
    data = http.get_json(f"{OPENAPI}/opendata/t187ap03_L", timeout=40)
    return parse_profile(data)


def parse_profile(data: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for x in data:
        code = ind = None
        for k, v in x.items():
            if code is None and ("代號" in k or k.lower() in ("code", "companycode")):
                code = str(v).strip()
            if ind is None and ("產業別" in k or "industry" in k.lower()):
                ind = str(v).strip()
        if code and ind:
            out[code] = INDUSTRY.get(ind.zfill(2), INDUSTRY.get(ind, "其他"))
    if not out:
        raise ValueError("profile parse produced nothing")
    return out


def build_heatmap(rows: list[dict], profile: dict[str, str], top_n: int = 120) -> tuple[list[dict], list[dict]]:
    """回傳 (treemap 用的類股與個股, 全市場類股強弱統計)。"""
    stocks = [r for r in rows if r["kind"] == "stock"]
    # 全市場類股統計
    agg: dict[str, dict] = {}
    for r in stocks:
        sec = profile.get(r["code"], "其他")
        a = agg.setdefault(sec, {"name": sec, "value": 0.0, "wp": 0.0, "up": 0, "down": 0, "n": 0})
        a["value"] += r["value"]
        a["wp"] += r["value"] * r["pct"]
        a["n"] += 1
        a["up"] += 1 if r["chg"] > 0 else 0
        a["down"] += 1 if r["chg"] < 0 else 0
    sector_stats = [
        {"name": a["name"], "value": round(a["value"], 1), "pct": round(a["wp"] / a["value"], 2) if a["value"] else 0.0,
         "up": a["up"], "down": a["down"], "n": a["n"]}
        for a in agg.values()
    ]
    sector_stats.sort(key=lambda s: -s["pct"])

    # treemap：成交值前 N 檔
    top = sorted((r for r in stocks if r["value"] > 0), key=lambda r: -r["value"])[:top_n]
    groups: dict[str, list[dict]] = {}
    for r in top:
        groups.setdefault(profile.get(r["code"], "其他"), []).append(r)
    tree = []
    for name, lst in groups.items():
        tv = sum(x["value"] for x in lst)
        tree.append({
            "name": name,
            "value": round(tv, 1),
            "pct": round(sum(x["value"] * x["pct"] for x in lst) / tv, 2) if tv else 0.0,
            "stocks": [{"c": x["code"], "n": x["name"], "v": x["value"], "p": x["pct"], "x": x["close"]} for x in lst],
        })
    tree.sort(key=lambda s: -s["value"])
    return tree, sector_stats


# ───────────────────────── 三大法人（大盤） ─────────────────────────

def fetch_institutional() -> dict:
    j = http.get_json(f"{WWW}/rwd/zh/fund/BFI82U", params={"type": "day", "response": "json"}, timeout=25)
    return parse_institutional(j)


def parse_institutional(j: dict) -> dict:
    stat = str(j.get("stat", "OK"))
    if not stat.upper().startswith("OK"):
        raise ValueError(f"BFI82U stat={stat}")
    rows = []
    for x in j.get("data", []):
        b, s, n = num(x[1]), num(x[2]), num(x[3])
        if b is None or s is None or n is None:
            continue
        rows.append({"name": strip_html(x[0]), "buy": round(b / 1e8, 2), "sell": round(s / 1e8, 2), "net": round(n / 1e8, 2)})
    if not rows:
        raise ValueError("BFI82U no rows")

    def net(pred) -> float:
        return round(sum(r["net"] for r in rows if pred(r["name"])), 2)

    summary = {
        "foreign": net(lambda n: "外資" in n),
        "trust": net(lambda n: n.startswith("投信")),
        "dealer": net(lambda n: n.startswith("自營商") and "外資" not in n),
        "total": net(lambda n: n.startswith("合計")),
    }
    if not any(r["name"].startswith("合計") for r in rows):
        summary["total"] = round(summary["foreign"] + summary["trust"] + summary["dealer"], 2)
    return {"date": to_iso_date(j.get("date")), "rows": rows, "summary": summary}


# ───────────────────────── 個股法人買賣超（T86） ─────────────────────────

def fetch_t86(iso_date: str) -> dict:
    params = {"selectType": "ALLBUT0999", "response": "json"}
    if iso_date:
        params["date"] = to_compact_date(iso_date)
    j = http.get_json(f"{WWW}/rwd/zh/fund/T86", params=params, timeout=30)
    return parse_t86(j)


def _col(fields: list[str], *needles: str, exact: str | None = None) -> int | None:
    for i, f in enumerate(fields):
        if exact is not None and f.strip() == exact:
            return i
    for i, f in enumerate(fields):
        if all(n in f for n in needles):
            return i
    return None


def parse_t86(j: dict, n: int = 15) -> dict:
    stat = str(j.get("stat", "OK"))
    if not stat.upper().startswith("OK"):
        raise ValueError(f"T86 stat={stat}")
    fields = [strip_html(f) for f in j["fields"]]
    i_code = _col(fields, "證券代號")
    i_name = _col(fields, "證券名稱")
    i_total = _col(fields, "三大法人買賣超")
    i_for = _col(fields, "外陸資買賣超股數", exact=None)
    if i_for is None:
        i_for = _col(fields, "外資", "買賣超")
    i_trust = _col(fields, "投信買賣超")
    if None in (i_code, i_name, i_total):
        raise ValueError(f"T86 fields unexpected: {fields[:6]}")

    items = []
    for x in j["data"]:
        code = str(x[i_code]).strip()
        if kind_of(code) == "other":
            continue
        tot = num(x[i_total])
        if tot is None:
            continue
        items.append({
            "code": code,
            "name": str(x[i_name]).strip(),
            "total": int(tot // 1000),
            "foreign": int((num(x[i_for], 0) or 0) // 1000) if i_for is not None else 0,
            "trust": int((num(x[i_trust], 0) or 0) // 1000) if i_trust is not None else 0,
        })

    def top(key: str, rev: bool) -> list[dict]:
        pool = [i for i in items if (i[key] > 0 if rev else i[key] < 0)]
        pool.sort(key=lambda i: i[key], reverse=rev)
        return [{"code": i["code"], "name": i["name"], "net": i[key]} for i in pool[:n]]

    return {
        "date": to_iso_date(j.get("date")),
        "total": {"buy": top("total", True), "sell": top("total", False)},
        "foreign": {"buy": top("foreign", True), "sell": top("foreign", False)},
        "trust": {"buy": top("trust", True), "sell": top("trust", False)},
    }


# ───────────────────────── 融資融券 ─────────────────────────

def fetch_margin(iso_date: str) -> dict:
    params = {"selectType": "MS", "response": "json"}
    if iso_date:
        params["date"] = to_compact_date(iso_date)
    j = http.get_json(f"{WWW}/rwd/zh/marginTrading/MI_MARGN", params=params, timeout=30)
    return parse_margin(j)


def parse_margin(j: dict) -> dict:
    stat = str(j.get("stat", "OK"))
    if not stat.upper().startswith("OK"):
        raise ValueError(f"MI_MARGN stat={stat}")
    table = None
    for t in j.get("tables", []):
        if any("今日餘額" in strip_html(f) for f in t.get("fields", [])):
            table = t
            break
    if table is None:
        raise ValueError("MI_MARGN credit table not found")
    fields = [strip_html(f) for f in table["fields"]]
    i_today, i_prev = _col(fields, "今日餘額"), _col(fields, "前日餘額")
    if i_today is None or i_prev is None:
        raise ValueError("MI_MARGN balance columns missing")
    out: dict[str, Any] = {"date": to_iso_date(j.get("date"))}
    for row in table["data"]:
        label = strip_html(row[0])
        today, prev = num(row[i_today]), num(row[i_prev])
        if today is None or prev is None:
            continue
        if "融資金額" in label:  # 仟元 → 億元
            out["margin_amt"] = {"bal": round(today * 1e3 / 1e8, 1), "chg": round((today - prev) * 1e3 / 1e8, 1)}
        elif "融資" in label:
            out["margin"] = {"bal": int(today), "chg": int(today - prev)}
        elif "融券" in label:
            out["short"] = {"bal": int(today), "chg": int(today - prev)}
    if "margin" not in out and "margin_amt" not in out:
        raise ValueError("MI_MARGN rows missing")
    return out


# ───────────────────────── 每日市場成交資訊（成交金額走勢） ─────────────────────────

def fetch_turnover_hist(today: dt.date | None = None, days: int = 30) -> list[dict]:
    today = today or dt.datetime.now(TZ).date()
    firsts = [today.replace(day=1)]
    prev_last = firsts[0] - dt.timedelta(days=1)
    firsts.insert(0, prev_last.replace(day=1))
    rows: list[dict] = []
    for first in firsts:
        j = http.get_json(f"{WWW}/rwd/zh/afterTrading/FMTQIK",
                          params={"date": first.strftime("%Y%m%d"), "response": "json"}, timeout=25)
        rows.extend(parse_turnover(j))
    rows.sort(key=lambda r: r["d"])
    if not rows:
        raise ValueError("FMTQIK empty")
    return rows[-days:]


def parse_turnover(j: dict) -> list[dict]:
    stat = str(j.get("stat", "OK"))
    if not stat.upper().startswith("OK"):
        return []
    fields = [strip_html(f) for f in j.get("fields", [])]
    i_d, i_v = _col(fields, "日期"), _col(fields, "成交金額")
    i_idx = _col(fields, "加權股價指數")
    if i_d is None or i_v is None:
        raise ValueError(f"FMTQIK fields unexpected: {fields}")
    out = []
    for x in j.get("data", []):
        d, v = to_iso_date(x[i_d]), num(x[i_v])
        if d and v is not None:
            out.append({"d": d, "v": round(v / 1e8, 1), "i": num(x[i_idx]) if i_idx is not None else None})
    return out


# ───────────────────────── 除權息、注意與處置 ─────────────────────────

def _pick(x: dict, *needles: str) -> Any:
    for k, v in x.items():
        kl = k.lower()
        if any(n.lower() in kl for n in needles):
            return v
    return None


def fetch_dividends(today: dt.date | None = None) -> list[dict]:
    data = http.get_json(f"{OPENAPI}/exchangeReport/TWT48U_ALL", timeout=30)
    return parse_dividends(data, today)


def parse_dividends(data: list[dict], today: dt.date | None = None, limit: int = 40) -> list[dict]:
    today = today or dt.datetime.now(TZ).date()
    out = []
    for x in data:
        d = to_iso_date(_pick(x, "date", "日期"))
        code = str(_pick(x, "code", "代號") or "").strip()
        if not d or not code or d < today.isoformat():
            continue
        out.append({
            "date": d,
            "code": code,
            "name": str(_pick(x, "name", "名稱") or "").strip(),
            "type": clip(_pick(x, "exdividend", "權息", "type"), 6),
            "cash": num(_pick(x, "cashdividend", "現金")),
            "stock": num(_pick(x, "stockdividend", "股票")),
        })
    out.sort(key=lambda r: (r["date"], r["code"]))
    return out[:limit]


def fetch_notices() -> dict:
    out: dict[str, list[dict]] = {}
    for key, path in (("attention", "announcement/notice"), ("punish", "announcement/punish")):
        try:
            out[key] = parse_notices(http.get_json(f"{OPENAPI}/{path}", timeout=25))
        except Exception as e:  # noqa: BLE001 - 單一清單失敗不影響另一個
            log.warning("notices %s failed: %s", key, e)
            out[key] = []
    if not out["attention"] and not out["punish"]:
        raise ValueError("notices empty")
    return out


def parse_notices(data: list[dict], limit: int = 60) -> list[dict]:
    out = []
    for x in data:
        code = str(_pick(x, "code", "代號") or "").strip()
        if not code:
            continue
        out.append({
            "code": code,
            "name": str(_pick(x, "name", "名稱") or "").strip(),
            "date": to_iso_date(_pick(x, "date", "日期")),
            "note": clip(strip_html(_pick(x, "reason", "原因", "measure", "處置措施", "period", "期間") or ""), 80),
        })
    return out[:limit]
