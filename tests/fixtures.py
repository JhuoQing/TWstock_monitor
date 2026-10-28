"""測試用的資料樣本（依證交所 / 櫃買 / 期交所實際回傳格式縮小而成）。"""
from __future__ import annotations

import numpy as np
import pandas as pd

STOCK_DAY_ALL = [
    {"Code": "2330", "Name": "台積電", "TradeVolume": "30000000", "TradeValue": "30000000000", "OpeningPrice": "1000", "HighestPrice": "1012", "LowestPrice": "995", "ClosingPrice": "1010", "Change": "10", "Transaction": "50000"},
    {"Code": "2317", "Name": "鴻海", "TradeVolume": "50000000", "TradeValue": "12000000000", "OpeningPrice": "200", "HighestPrice": "201", "LowestPrice": "197", "ClosingPrice": "198", "Change": "-2", "Transaction": "30000"},
    {"Code": "2603", "Name": "長榮", "TradeVolume": "45000000", "TradeValue": "10000000000", "OpeningPrice": "205", "HighestPrice": "220", "LowestPrice": "205", "ClosingPrice": "220", "Change": "20", "Transaction": "20000"},
    {"Code": "1101", "Name": "台泥", "TradeVolume": "16000000", "TradeValue": "500000000", "OpeningPrice": "33", "HighestPrice": "33", "LowestPrice": "30", "ClosingPrice": "30", "Change": "-3", "Transaction": "3000"},
    {"Code": "1102", "Name": "亞泥", "TradeVolume": "16000000", "TradeValue": "300000000", "OpeningPrice": "20", "HighestPrice": "20", "LowestPrice": "18", "ClosingPrice": "18", "Change": "-2", "Transaction": "2000"},
    {"Code": "2881", "Name": "富邦金", "TradeVolume": "20000000", "TradeValue": "2000000000", "OpeningPrice": "90", "HighestPrice": "91", "LowestPrice": "89", "ClosingPrice": "90", "Change": "0.0000", "Transaction": "9000"},
    {"Code": "0050", "Name": "元大台灣50", "TradeVolume": "44000000", "TradeValue": "8000000000", "OpeningPrice": "180", "HighestPrice": "181", "LowestPrice": "179", "ClosingPrice": "180", "Change": "0.5", "Transaction": "9000"},
    {"Code": "00878", "Name": "國泰永續高股息", "TradeVolume": "180000000", "TradeValue": "4000000000", "OpeningPrice": "22", "HighestPrice": "22", "LowestPrice": "22", "ClosingPrice": "22", "Change": "0.0000", "Transaction": "9000"},
    {"Code": "030001", "Name": "某權證", "TradeVolume": "1000", "TradeValue": "1000000", "OpeningPrice": "1", "HighestPrice": "1", "LowestPrice": "1", "ClosingPrice": "1", "Change": "0.1", "Transaction": "10"},
    {"Code": "9999", "Name": "停牌股", "TradeVolume": "0", "TradeValue": "0", "OpeningPrice": "", "HighestPrice": "", "LowestPrice": "", "ClosingPrice": "", "Change": "", "Transaction": "0"},
]

PROFILE = [
    {"公司代號": "2330", "公司簡稱": "台積電", "產業別": "24"},
    {"公司代號": "2317", "公司簡稱": "鴻海", "產業別": "31"},
    {"公司代號": "2603", "公司簡稱": "長榮", "產業別": "15"},
    {"公司代號": "1101", "公司簡稱": "台泥", "產業別": "01"},
    {"公司代號": "1102", "公司簡稱": "亞泥", "產業別": "01"},
    {"公司代號": "2881", "公司簡稱": "富邦金", "產業別": "17"},
]

BFI82U = {
    "stat": "OK", "date": "20261027",
    "fields": ["單位名稱", "買進金額", "賣出金額", "買賣差額"],
    "data": [
        ["自營商(自行買賣)", "10,000,000,000", "9,000,000,000", "1,000,000,000"],
        ["自營商(避險)", "20,000,000,000", "22,000,000,000", "-2,000,000,000"],
        ["投信", "5,000,000,000", "3,000,000,000", "2,000,000,000"],
        ["外資及陸資(不含外資自營商)", "100,000,000,000", "110,000,000,000", "-10,000,000,000"],
        ["外資自營商", "0", "0", "0"],
        ["合計", "135,000,000,000", "144,000,000,000", "-9,000,000,000"],
    ],
}

T86_FIELDS = [
    "證券代號", "證券名稱", "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)", "外陸資買賣超股數(不含外資自營商)",
    "外資自營商買進股數", "外資自營商賣出股數", "外資自營商買賣超股數", "投信買進股數", "投信賣出股數", "投信買賣超股數",
    "自營商買賣超股數", "自營商買進股數(自行買賣)", "自營商賣出股數(自行買賣)", "自營商買賣超股數(自行買賣)",
    "自營商買進股數(避險)", "自營商賣出股數(避險)", "自營商買賣超股數(避險)", "三大法人買賣超股數",
]


def _t86(code, name, foreign, trust, total):
    r = ["0"] * 19
    r[0], r[1], r[4], r[10], r[18] = code, name, f"{foreign:,}", f"{trust:,}", f"{total:,}"
    return r


T86 = {
    "stat": "OK", "date": "20261027", "fields": T86_FIELDS,
    "data": [
        _t86("2330", "台積電", 5_000_000, 1_000_000, 6_000_000),
        _t86("2317", "鴻海", -8_000_000, 0, -8_000_000),
        _t86("2603", "長榮", 2_000_000, 500_000, 2_500_000),
        _t86("030001", "某權證", 9_000_000, 0, 9_000_000),
    ],
}

MARGIN = {
    "stat": "OK", "date": "20261027",
    "tables": [
        {"title": "信用交易統計", "fields": ["項目", "買進", "賣出", "現金(券)償還", "前日餘額", "今日餘額"],
         "data": [["融資(交易單位)", "1,000", "2,000", "300", "10,000", "9,500"],
                  ["融券(交易單位)", "100", "200", "0", "1,000", "1,100"],
                  ["融資金額(仟元)", "100,000", "200,000", "30,000", "50,000,000", "49,500,000"]]},
        {"title": "融資融券彙總", "fields": ["代號", "名稱"], "data": []},
    ],
}

FMTQIK = {
    "stat": "OK",
    "fields": ["日期", "成交股數", "成交金額", "成交筆數", "發行量加權股價指數", "漲跌點數"],
    "data": [["115/10/26", "5,000,000,000", "300,000,000,000", "2,000,000", "46,000.00", "-100.00"],
             ["115/10/27", "6,000,000,000", "350,000,000,000", "2,100,000", "46,500.00", "+500.00"]],
}

TPEX = [
    {"Date": "1151027", "SecuritiesCompanyCode": "6488", "CompanyName": "環球晶", "Close": "400.00", "Change": "+10.00", "Open": "392", "High": "402", "Low": "390", "TradingShares": "1000000", "TransactionAmount": "400000000"},
    {"Date": "1151027", "SecuritiesCompanyCode": "3293", "CompanyName": "鈊象", "Close": "900.00", "Change": " -45.00", "Open": "940", "High": "945", "Low": "899", "TradingShares": "500000", "TransactionAmount": "450000000"},
    {"Date": "1151027", "SecuritiesCompanyCode": "00679B", "CompanyName": "債券ETF", "Close": "30.00", "Change": "0.10", "Open": "30", "High": "30", "Low": "30", "TradingShares": "1000", "TransactionAmount": "30000"},
]

TAIFEX = [
    {"Date": "20261027", "Item": "臺股期貨", "InstitutionalInvestors": "外資及陸資", "OpenInterest(Net)": "-25000"},
    {"Date": "20261027", "Item": "臺股期貨", "InstitutionalInvestors": "投信", "OpenInterest(Net)": "12000"},
    {"Date": "20261027", "Item": "臺股期貨", "InstitutionalInvestors": "自營商", "OpenInterest(Net)": "-3000"},
    {"Date": "20261027", "Item": "小型臺指期貨", "InstitutionalInvestors": "外資及陸資", "OpenInterest(Net)": "9999"},
]

DIVIDENDS = [
    {"Date": "1151030", "Code": "2330", "Name": "台積電", "Exdividend": "息", "CashDividend": "5.0", "StockDividendRatio": ""},
    {"Date": "1151001", "Code": "2317", "Name": "鴻海", "Exdividend": "息", "CashDividend": "1.0"},
]

RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>t</title>
<item><title>\xe5\x8f\xb0\xe8\x82\xa1\xe5\xa4\xa7\xe6\xbc\xb2 \xe5\xa4\x96\xe8\xb3\x87\xe8\xb2\xb7\xe8\xb6\x85 - \xe5\xb7\xa5\xe5\x95\x86\xe6\x99\x82\xe5\xa0\xb1</title><link>https://a.example/1</link><pubDate>Tue, 27 Oct 2026 05:00:00 GMT</pubDate><source url="https://ctee.com.tw">\xe5\xb7\xa5\xe5\x95\x86\xe6\x99\x82\xe5\xa0\xb1</source></item>
<item><title>\xe5\x8f\xb0\xe8\x82\xa1\xe5\xa4\xa7\xe6\xbc\xb2 \xe5\xa4\x96\xe8\xb3\x87\xe8\xb2\xb7\xe8\xb6\x85300\xe5\x84\x84 - \xe7\xb6\x93\xe6\xbf\x9f\xe6\x97\xa5\xe5\xa0\xb1</title><link>https://a.example/2</link><pubDate>Tue, 27 Oct 2026 04:30:00 GMT</pubDate><source url="https://udn.com">\xe7\xb6\x93\xe6\xbf\x9f\xe6\x97\xa5\xe5\xa0\xb1</source></item>
<item><title>Fed \xe6\x9a\x97\xe7\xa4\xba\xe9\x99\x8d\xe6\x81\xaf \xe5\xbe\x8c\xe5\xb8\x82\xe8\xbd\x89\xe5\xbc\xb7 - Yahoo</title><link>https://a.example/3</link><pubDate>Tue, 27 Oct 2026 03:00:00 GMT</pubDate></item>
<item><title>\xe5\xa4\xaa\xe8\x88\x8a\xe7\x9a\x84\xe6\x96\xb0\xe8\x81\x9e - \xe6\x9f\x90\xe5\xa0\xb1</title><link>https://a.example/4</link><pubDate>Mon, 20 Oct 2026 03:00:00 GMT</pubDate></item>
</channel></rss>"""


def make_df(n: int = 250, start: float = 100.0, drift: float = 0.0005, seed: int = 1, end: str = "2026-10-27") -> pd.DataFrame:
    """產生確定性的假 OHLCV（平日索引，最後一日為 end）。"""
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=end, periods=n, tz="Asia/Taipei")
    close = start * np.cumprod(1 + drift + rng.normal(0, 0.01, n))
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.01, n))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.01, n))
    vol = rng.integers(1_000, 100_000, n)
    return pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol}, index=idx)
