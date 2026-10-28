import numpy as np
import pandas as pd

from pipeline.indicators import rsi_series, tech_summary
from tests.fixtures import make_df


def test_rsi_monotonic_up_is_100_and_down_is_0():
    up = pd.Series(np.arange(1.0, 40.0))
    assert rsi_series(up).iloc[-1] == 100.0
    down = pd.Series(np.arange(40.0, 1.0, -1.0))
    assert rsi_series(down).iloc[-1] == 0.0
    assert rsi_series(up).iloc[:14].isna().all()


def test_rsi_matches_wilder_reference():
    # Wilder 經典範例資料（StockCharts RSI 範例），第 15 筆 RSI ≈ 70.53
    closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]
    assert abs(rsi_series(pd.Series(closes)).iloc[14] - 70.53) < 0.1


def _frame(closes, vol=1000):
    c = pd.Series(closes, dtype=float)
    return pd.DataFrame({"Open": c, "High": c * 1.001, "Low": c * 0.999, "Close": c, "Volume": [vol] * len(c)})


def test_breakout_and_volume_surge_and_new_high():
    closes = [100.0] * 150 + [101.0] * 40 + [110.0]
    df = _frame(closes)
    df.loc[df.index[-1], "Volume"] = 5000
    tech, sig = tech_summary(df)
    assert "breakout20" in sig and "vol_surge" in sig and "new_high" in sig
    assert tech["vr"] == 5.0
    assert tech["ret_1y"] == 10.0


def test_golden_cross_detected_within_three_days():
    closes = list(np.linspace(120, 100, 60)) + [100.0] * 10 + [101, 104, 110]
    _, sig = tech_summary(_frame(closes))
    assert "golden_cross" in sig


def test_bear_alignment_and_oversold():
    closes = list(np.linspace(150, 60, 120))
    tech, sig = tech_summary(_frame(closes))
    assert "ma_bear" in sig and "rsi_oversold" in sig
    assert tech["from_hi"] < -50


def test_tech_summary_on_random_data_is_json_safe():
    import json

    tech, sig = tech_summary(make_df())
    json.dumps(tech)
    assert all(isinstance(s, str) for s in sig)
    assert tech["rsi"] is not None and 0 <= tech["rsi"] <= 100
