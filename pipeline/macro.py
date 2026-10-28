"""美國總體經濟指標（FRED）。需要環境變數 FRED_API_KEY；沒設定時整段略過。"""
from __future__ import annotations

import logging
import os

from . import http

log = logging.getLogger("pipeline.macro")

# (series_id, 名稱, 模式, 單位, 頻率)
#   level：直接取值；yoy：年增率（月資料，需 13 期以上）；diff：與前一期差（千人）
SERIES = [
    ("FEDFUNDS", "美國聯邦基金利率", "level", "%", "m"),
    ("DGS10", "美國10年期公債殖利率", "level", "%", "d"),
    ("T10Y2Y", "美債 10Y-2Y 利差", "level", "%", "d"),
    ("CPIAUCSL", "美國 CPI 年增率", "yoy", "%", "m"),
    ("PCEPILFE", "美國核心 PCE 年增率", "yoy", "%", "m"),
    ("UNRATE", "美國失業率", "level", "%", "m"),
    ("PAYEMS", "非農就業人數月增", "diff", "千人", "m"),
    ("DTWEXBGS", "廣義美元指數", "level", "", "d"),
    ("BAMLH0A0HYM2", "高收益債信用利差", "level", "%", "d"),
]

HIST_POINTS = 24


def derive(obs: list[tuple[str, float]], mode: str) -> list[tuple[str, float]]:
    """obs 為由新到舊排列。回傳由新到舊的衍生序列 [(date, value)]。"""
    if mode == "level":
        return obs
    if mode == "diff":
        return [(obs[i][0], obs[i][1] - obs[i + 1][1]) for i in range(len(obs) - 1)]
    if mode == "yoy":
        return [(obs[i][0], (obs[i][1] / obs[i + 12][1] - 1) * 100) for i in range(len(obs) - 12)]
    raise ValueError(mode)


def build_row(sid: str, name: str, mode: str, unit: str, freq: str, obs: list[tuple[str, float]]) -> dict:
    series = derive(obs, mode)
    if len(series) < 2:
        raise ValueError(f"{sid}: not enough observations")
    hist = [[d, round(v, 3)] for d, v in reversed(series[:HIST_POINTS])]
    return {
        "id": sid, "name": name, "unit": unit, "freq": freq,
        "value": round(series[0][1], 2), "prev": round(series[1][1], 2),
        "date": series[0][0], "hist": hist,
    }


def fetch_macro() -> list[dict]:
    key = os.environ.get("FRED_API_KEY")
    if not key:
        return []
    out = []
    for sid, name, mode, unit, freq in SERIES:
        try:
            r = http.get_json(
                "https://api.stlouisfed.org/fred/series/observations",
                params={"series_id": sid, "api_key": key, "file_type": "json", "sort_order": "desc", "limit": 60},
                timeout=20,
            )
            obs = [(o["date"], float(o["value"])) for o in r["observations"] if o["value"] != "."]
            out.append(build_row(sid, name, mode, unit, freq, obs))
        except Exception as e:  # noqa: BLE001
            log.warning("fred skip %s: %s", sid, type(e).__name__)
    return out
