import datetime as dt
import json
import sys
import types
from types import SimpleNamespace

import pytest

from pipeline import build as B
from pipeline import quotes as Q
from pipeline import taifex, tpex, twse
from pipeline.state import PrevState
from pipeline.util import TZ
from pipeline.validate import ValidationError, validate_index
from tests import fixtures as fx

NOW = dt.datetime(2026, 10, 28, 16, 0, tzinfo=TZ)
SYMS = {
    "symbols": [
        {"symbol": "^TWII", "name": "加權指數", "group": "台股", "kind": "index"},
        {"symbol": "2330.TW", "name": "台積電(預設名)", "group": "台股", "kind": "stock", "focus": True},
        {"symbol": "0050.TW", "name": "元大台灣50", "group": "台股", "kind": "etf"},
        {"symbol": "TWD=X", "name": "美元/台幣", "group": "匯率商品", "kind": "fx"},
        {"symbol": "GC=F", "name": "黃金", "group": "匯率商品", "kind": "commodity"},
    ]
}


def make_fx(**over):
    base = dict(
        histories=lambda syms: {s: fx.make_df(start=50 + i * 100, seed=i + 1) for i, s in enumerate(syms)},
        stock_day_all=lambda: fx.STOCK_DAY_ALL,
        profile=lambda: twse.parse_profile(fx.PROFILE),
        institutional=lambda: twse.parse_institutional(fx.BFI82U),
        t86=lambda d: twse.parse_t86(fx.T86),
        margin=lambda d: twse.parse_margin(fx.MARGIN),
        turnover_hist=lambda: twse.parse_turnover(fx.FMTQIK),
        tpex_daily=lambda: fx.TPEX,
        futures_oi=lambda: taifex.parse_futures_oi(fx.TAIFEX),
        dividends=lambda: twse.parse_dividends(fx.DIVIDENDS, today=dt.date(2026, 10, 28)),
        notices=lambda: {"attention": [], "punish": []},
        news=lambda: [{"title": "測試", "link": "https://x", "source": "s", "time": NOW.isoformat(), "score": 0, "important": False, "tone": "flat", "tags": []}],
        macro=lambda: [],
        ai_caller=None,
        send_alert=lambda text: None,
    )
    base.update(over)
    return SimpleNamespace(**base)


@pytest.fixture
def symbols_file(tmp_path):
    p = tmp_path / "symbols.json"
    p.write_text(json.dumps(SYMS), encoding="utf-8")
    return p


def run(symbols_file, out, prev=None, fx_=None, **kw):
    return B.build(symbols_file, out, PrevState(local_dir=prev), fx=fx_ or make_fx(), now=NOW, **kw)


def test_full_build_writes_expected_files(tmp_path, symbols_file):
    out = tmp_path / "data"
    idx = run(symbols_file, out)
    assert idx["schema"] == 2 and idx["trade_date"] == "2026-10-27"
    assert all(v["ok"] for v in idx["sources"].values())
    assert {q["symbol"] for q in idx["quotes"]} == {s["symbol"] for s in SYMS["symbols"]}
    tsmc = next(q for q in idx["quotes"] if q["symbol"] == "2330.TW")
    assert tsmc["name"] == "台積電"  # 以證交所名稱覆蓋預設名
    assert idx["breadth"]["up"] == 2 and idx["rankings"]["otc"]["by_value"][0]["code"] == "3293"
    assert idx["inst_hist"][-1]["foreign"] == -100.0 and idx["futures_hist"][-1]["foreign"] == -25000
    assert idx["ai"] is None and idx["macro"] == []
    for name in ("index.json", "universe.json", "macro_history.json", "profile.json", "sym/_TWII.json", "sym/2330.TW.json", "sym/GC_F.json", "sym/TWD_X.json"):
        assert (out / name).exists(), name
    d = json.loads((out / "sym/2330.TW.json").read_text())
    assert set(d) >= {"d", "o", "h", "l", "c", "v"} and len(d["d"]) == len(d["c"]) == 250
    uni = json.loads((out / "universe.json").read_text())
    assert ["2330", "台積電", 1010.0, 1.0, 300.0, "s"] in uni and any(u[5] == "o" for u in uni)
    assert len(idx["taiex"]["c"]) == 250
    assert (out / "index.json").stat().st_size < 60_000  # 首頁資料維持精簡


def test_failed_sources_carry_forward_previous_data(tmp_path, symbols_file):
    first = tmp_path / "v1"
    run(symbols_file, first)

    def boom(*a, **k):
        raise RuntimeError("down")

    def partial(syms):  # 黃金抓不到
        return {s: fx.make_df(start=50 + i * 100, seed=i + 1) for i, s in enumerate(syms) if s != "GC=F"}

    broken = make_fx(stock_day_all=boom, institutional=boom, t86=boom, margin=boom, tpex_daily=boom, futures_oi=boom,
                     news=boom, histories=partial)
    out2 = tmp_path / "v2"
    idx = run(symbols_file, out2, prev=first, fx_=broken)
    s = idx["sources"]
    assert not s["twse_daily"]["ok"] and not s["twse_institutional"]["ok"] and s["twse_daily"]["at"]  # 保留上次成功時間
    assert idx["institutional"]["date"] == "2026-10-27" and idx["breadth"]["up"] == 2  # 沿用舊資料
    assert idx["rankings"]["otc"] and idx["news"][0]["title"] == "測試" and idx["t86"]
    gold = next(q for q in idx["quotes"] if q["symbol"] == "GC=F")
    assert gold["stale"] is True and (out2 / "sym/GC_F.json").exists()
    assert s["quotes"]["ok"] and s["quotes"]["failed"] == ["GC=F"]
    assert len(json.loads((out2 / "universe.json").read_text())) > 5  # 搜尋表也沿用
    assert idx["inst_hist"] == json.loads((first / "index.json").read_text())["inst_hist"]


def test_history_accumulates_across_runs(tmp_path, symbols_file):
    first = tmp_path / "v1"
    run(symbols_file, first)
    inst2 = dict(fx.BFI82U, date="20261028")
    idx = run(symbols_file, tmp_path / "v2", prev=first, fx_=make_fx(institutional=lambda: twse.parse_institutional(inst2)))
    assert [h["date"] for h in idx["inst_hist"]] == ["2026-10-27", "2026-10-28"]
    again = run(symbols_file, tmp_path / "v3", prev=tmp_path / "v2", fx_=make_fx(institutional=lambda: twse.parse_institutional(inst2)))
    assert len(again["inst_hist"]) == 2  # 同日覆蓋，不重複


def test_validation_blocks_broken_output(tmp_path, symbols_file):
    with pytest.raises(ValidationError):
        run(symbols_file, tmp_path / "x", fx_=make_fx(histories=lambda syms: {}))
    assert not (tmp_path / "x" / "index.json").exists()  # 驗證失敗不寫出任何檔案


def test_macro_report_generated_once_and_archived(tmp_path, symbols_file, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    macro_rows = [{"id": "CPIAUCSL", "name": "美國 CPI 年增率", "value": 3.1, "prev": 3.0, "date": "2026-09-01", "unit": "%", "freq": "m", "hist": [["2026-08-01", 3.0], ["2026-09-01", 3.1]]}]
    calls = []
    good = {"headline": "h", "summary": "s", "sections": [], "watch": [], "risks": []}
    f = make_fx(macro=lambda: macro_rows, ai_caller=lambda p, k: (calls.append(p) or (good, "m")))
    out1 = tmp_path / "v1"
    idx1 = run(symbols_file, out1, fx_=f)
    assert idx1["ai"]["headline"] == "h" and len(calls) == 1
    assert len(json.loads((out1 / "macro_history.json").read_text())) == 1
    idx2 = run(symbols_file, tmp_path / "v2", prev=out1, fx_=f)
    assert len(calls) == 1 and idx2["ai"]["hash"] == idx1["ai"]["hash"]  # 數據沒變 → 不重複呼叫
    assert len(json.loads((tmp_path / "v2" / "macro_history.json").read_text())) == 1


def test_skip_ai_flag_never_calls(tmp_path, symbols_file, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    calls = []
    f = make_fx(macro=lambda: [{"id": "A", "name": "a", "value": 1, "prev": 1, "date": "d", "unit": "%", "freq": "m", "hist": []}],
                ai_caller=lambda p, k: calls.append(p))
    idx = run(symbols_file, tmp_path / "o", fx_=f, skip_ai=True)
    assert not calls and idx["ai"] is None


def test_alerts_sent_through_fx(tmp_path, symbols_file):
    alerts = tmp_path / "alerts.json"
    alerts.write_text(json.dumps({"rules": [{"symbol": "2330.TW", "op": ">=", "value": 0.001}]}))
    sent = []
    idx = run(symbols_file, tmp_path / "o", fx_=make_fx(send_alert=sent.append), alerts_path=alerts)
    assert len(sent) == 1 and "台積電" in sent[0]
    assert json.loads((tmp_path / "o" / "alert_state.json").read_text())
    assert idx  # 不影響主要輸出


def test_validate_index_rules():
    good = {"schema": 2, "updated_at": "x", "sources": {}, "taiex": {"d": ["a"] * 40, "c": [1] * 40},
            "quotes": [{"symbol": "^TWII", "price": 1, "pct": 0, "spark": []}]}
    validate_index(good, 1)
    with pytest.raises(ValidationError, match="TWII"):
        validate_index(dict(good, quotes=[{"symbol": "X", "price": 1, "pct": 0, "spark": []}]), 1)
    with pytest.raises(ValidationError, match="taiex"):
        validate_index(dict(good, taiex={"d": [], "c": []}), 1)
    with pytest.raises(ValidationError, match="too few"):
        validate_index(good, 30)


# ── yfinance 下載：用假模組驗證批次、重試與欄位相容 ──
def _fake_yf(batch_df, single=None, raises=False):
    m = types.ModuleType("yfinance")

    def download(tickers, **kw):
        if raises:
            raise RuntimeError("rate limited")
        return batch_df

    class Ticker:
        def __init__(self, s):
            self.s = s

        def history(self, **kw):
            return (single or {}).get(self.s)

    m.download, m.Ticker = download, Ticker
    return m


def test_download_histories_multiindex_and_single_retry(monkeypatch):
    import pandas as pd

    a, b = fx.make_df(seed=1), fx.make_df(seed=2)
    batch = pd.concat({"AAA": a}, axis=1)  # 只有 AAA 在批次結果內，BBB 要靠逐一重試
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(batch, single={"BBB": b}))
    out = Q.download_histories(["AAA", "BBB", "CCC"], sleep=0)
    assert set(out) == {"AAA", "BBB"} and len(out["AAA"]) == 250


def test_download_histories_survives_total_batch_failure(monkeypatch):
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(None, single={"AAA": fx.make_df()}, raises=True))
    assert set(Q.download_histories(["AAA", "BBB"], sleep=0)) == {"AAA"}


def test_clean_repairs_bad_ohlc_and_nan():
    df = fx.make_df(n=10)
    df.iloc[3, df.columns.get_loc("Close")] = float("nan")
    df.iloc[5, df.columns.get_loc("High")] = 0.0
    out = Q._clean(df)
    assert len(out) == 9 and (out["High"] >= out["Close"]).all() and (out["Low"] <= out["Close"]).all()
