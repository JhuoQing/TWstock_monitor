import datetime as dt

import pytest

from pipeline import taifex, tpex, twse
from tests import fixtures as fx


def rows():
    return twse.parse_stock_rows(fx.STOCK_DAY_ALL)


def test_parse_stock_rows_skips_suspended_and_classifies():
    r = {x["code"]: x for x in rows()}
    assert "9999" not in r
    assert r["2330"]["kind"] == "stock" and r["0050"]["kind"] == "etf" and r["00878"]["kind"] == "etf"
    assert r["030001"]["kind"] == "other"
    assert r["2330"]["pct"] == 1.0 and r["2330"]["value"] == 300.0 and r["2330"]["vol"] == 30000
    assert r["2603"]["pct"] == 10.0 and r["1102"]["pct"] == -10.0


def test_rankings_exclude_other_and_apply_liquidity_floor():
    rk = twse.build_rankings(rows())
    assert [x["code"] for x in rk["stock"]["by_value"]][:3] == ["2330", "2317", "2603"]
    gain = [x["code"] for x in rk["stock"]["gainers"]]
    assert gain[0] == "2603" and "1102" not in gain  # 跌幅股不會進漲幅榜，權證不會進任何榜
    assert "030001" not in [x["code"] for x in rk["stock"]["by_value"] + rk["etf"]["by_value"]]
    assert rk["etf"]["by_value"][0]["code"] == "0050"


def test_breadth_counts():
    b = twse.build_breadth(rows())
    assert (b["up"], b["down"], b["flat"], b["count"]) == (2, 3, 1, 6)
    assert b["limit_up"] == 1 and b["limit_down"] == 1
    assert b["turnover"] == 300 + 120 + 100 + 5 + 3 + 20 + 80 + 40


def test_profile_and_heatmap():
    prof = twse.parse_profile(fx.PROFILE)
    assert prof["2330"] == "半導體" and prof["2603"] == "航運業" and prof["1101"] == "水泥工業"
    tree, stats = twse.build_heatmap(rows(), prof, top_n=10)
    assert tree[0]["name"] == "半導體" and tree[0]["stocks"][0]["c"] == "2330"
    cement = next(s for s in stats if s["name"] == "水泥工業")
    assert cement["n"] == 2 and cement["down"] == 2 and cement["pct"] < -9
    assert stats[0]["pct"] >= stats[-1]["pct"]
    with pytest.raises(ValueError):
        twse.parse_profile([{"x": 1}])


def test_institutional_summary():
    inst = twse.parse_institutional(fx.BFI82U)
    assert inst["date"] == "2026-10-27"
    assert inst["summary"] == {"foreign": -100.0, "trust": 20.0, "dealer": -10.0, "total": -90.0}
    with pytest.raises(ValueError):
        twse.parse_institutional({"stat": "很抱歉，沒有符合條件的資料!"})


def test_t86_ranking_and_unit_conversion():
    t = twse.parse_t86(fx.T86)
    assert t["date"] == "2026-10-27"
    assert t["total"]["buy"][0] == {"code": "2330", "name": "台積電", "net": 6000}  # 股 → 張
    assert t["total"]["sell"][0]["code"] == "2317" and t["total"]["sell"][0]["net"] == -8000
    assert all(i["code"] != "030001" for i in t["total"]["buy"])
    assert t["trust"]["buy"][0]["code"] == "2330"
    bad = dict(fx.T86, fields=["a", "b"])
    with pytest.raises(ValueError):
        twse.parse_t86(bad)


def test_margin_parse():
    m = twse.parse_margin(fx.MARGIN)
    assert m["margin"] == {"bal": 9500, "chg": -500}
    assert m["short"] == {"bal": 1100, "chg": 100}
    assert m["margin_amt"] == {"bal": 495.0, "chg": -5.0}
    with pytest.raises(ValueError):
        twse.parse_margin({"stat": "OK", "tables": []})


def test_turnover_parse():
    t = twse.parse_turnover(fx.FMTQIK)
    assert t == [{"d": "2026-10-26", "v": 3000.0, "i": 46000.0}, {"d": "2026-10-27", "v": 3500.0, "i": 46500.0}]


def test_dividends_only_future_sorted():
    d = twse.parse_dividends(fx.DIVIDENDS, today=dt.date(2026, 10, 28))
    assert [x["code"] for x in d] == ["2330"] and d[0]["cash"] == 5.0 and d[0]["date"] == "2026-10-30"


def test_tpex_parse_and_rank():
    r = tpex.parse_daily(fx.TPEX)
    assert {x["code"] for x in r} == {"6488", "3293"}
    gl = next(x for x in r if x["code"] == "6488")
    assert gl["pct"] == 2.56 and gl["value"] == 4.0 and gl["kind"] == "otc"
    rk = tpex.build_rankings(r)
    assert rk["by_value"][0]["code"] == "3293" and rk["losers"][0]["code"] == "3293"


def test_taifex_net_oi_for_big_contract_only():
    f = taifex.parse_futures_oi(fx.TAIFEX)
    assert f["date"] == "2026-10-27"
    assert {r["name"]: r["net"] for r in f["rows"]} == {"外資及陸資": -25000, "投信": 12000, "自營商": -3000}
    with pytest.raises(ValueError):
        taifex.parse_futures_oi([{"Item": "其他"}])
