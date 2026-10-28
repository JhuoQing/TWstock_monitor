"""期交所（TAIFEX）三大法人期貨未平倉（臺股期貨）。

欄位名稱依 OpenAPI 回傳為準，這裡以「關鍵字」容錯比對；若解析不到就丟例外，由 build.py 沿用舊資料。
"""
from __future__ import annotations

from . import http
from .util import num, to_iso_date

URL = "https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate"


def fetch_futures_oi() -> dict:
    data = http.get_json(URL, timeout=30)
    return parse_futures_oi(data)


def _val(x: dict, *needles: str):
    for k, v in x.items():
        kl = k.lower().replace(" ", "").replace("_", "")
        if all(n in kl for n in needles):
            return v
    return None


def parse_futures_oi(data: list[dict]) -> dict:
    """取「臺股期貨」各身分別的未平倉淨口數（多方 − 空方）。"""
    rows = []
    date = ""
    for x in data:
        item = " ".join(str(v) for k, v in x.items() if any(w in k.lower() for w in ("item", "商品", "contract")))
        who = str(_val(x, "investor") or _val(x, "identity") or _val(x, "身份") or _val(x, "institutional") or "").strip()
        # 只要大台（臺股期貨），排除小型、微型與電子、金融期貨
        if "臺股期貨" not in item and "台股期貨" not in item:
            continue
        if any(w in item for w in ("小型", "微型", "電子", "金融")):
            continue
        net = num(_val(x, "openinterest", "net"))
        if net is None:
            long_, short_ = num(_val(x, "openinterest", "long")), num(_val(x, "openinterest", "short"))
            if long_ is None or short_ is None:
                continue
            net = long_ - short_
        d = to_iso_date(_val(x, "date") or _val(x, "日期"))
        date = d or date
        if who:
            rows.append({"name": who, "net": int(net)})
    if not rows:
        raise ValueError("TAIFEX OI parse produced nothing")
    return {"date": date, "rows": rows}
