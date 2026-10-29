"""主流程：抓取各來源 → 失敗沿用舊資料 → 檢查 → 輸出到 web/data/。

輸出檔案（相對於 --out）：
  index.json          首頁所需的全部資料（小）
  universe.json       全市場代號搜尋表（延遲載入）
  sym/<代號>.json     個股 OHLCV 歷史（點開才載入）
  macro_history.json  AI 總經報告歷史
  profile.json        產業別對照（快取）
  alert_state.json    推播警示狀態（選用）
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import shutil
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

from . import SCHEMA_VERSION, ai, macro as macro_mod, news as news_mod, notify, quotes as quotes_mod
from . import taifex, tpex, twse
from .state import PrevState
from .util import TZ, clip, rnd, safe_filename
from .validate import validate_index

log = logging.getLogger("pipeline.build")

ROOT = Path(__file__).resolve().parent.parent
PROFILE_MAX_AGE_DAYS = 7
HIST_KEEP = 60


def default_fetchers() -> SimpleNamespace:
    return SimpleNamespace(
        histories=quotes_mod.download_histories,
        stock_day_all=twse.fetch_stock_day_all,
        profile=twse.fetch_profile,
        institutional=twse.fetch_institutional,
        t86=twse.fetch_t86,
        margin=twse.fetch_margin,
        turnover_hist=twse.fetch_turnover_hist,
        tpex_daily=tpex.fetch_daily,
        futures_oi=taifex.fetch_futures_oi,
        dividends=twse.fetch_dividends,
        notices=twse.fetch_notices,
        news=news_mod.fetch_news,
        macro=macro_mod.fetch_macro,
        ai_caller=None,
        send_alert=notify.send_telegram,
    )


def merge_hist(prev: list[dict] | None, entry: dict | None, key: str = "date", keep: int = HIST_KEEP) -> list[dict]:
    """把今天的資料併入歷史（同日覆蓋），依日期排序並保留最近 keep 筆。"""
    hist = [h for h in (prev or []) if not entry or h.get(key) != entry.get(key)]
    if entry and entry.get(key):
        hist.append(entry)
    hist.sort(key=lambda h: h.get(key) or "")
    return hist[-keep:]


def apply_official_index(qlist: list[dict], taiex: dict, turnover_hist: list[dict] | None) -> dict | None:
    """用證交所 FMTQIK 的官方加權指數收盤，補上 Yahoo 還沒更新的交易日。

    Yahoo 的 ^TWII 日 K 有時落後好幾個交易日（整批下載被限流時尤其明顯），首頁報價就會停在
    舊日期。FMTQIK 本來就會抓（成交金額用），其中的 ``i`` 欄位正是當日加權股價指數收盤。

    只修首頁報價與天際線的收盤序列；``sym/_TWII.json`` 的 K 線與技術指標不動，因為那些需要
    完整的開高低收才算得準，而 FMTQIK 只有收盤。

    回傳補上的資訊，或 None 表示 Yahoo 本來就是最新、或沒有官方資料可用。
    """
    series = sorted(
        (r["d"], float(r["i"])) for r in (turnover_hist or [])
        if r.get("d") and r.get("i") is not None
    )
    q = next((x for x in qlist if x["symbol"] == "^TWII"), None)
    if not series or q is None:
        return None
    yahoo_date = q.get("date") or ""
    extra = [(d, v) for d, v in series if d > yahoo_date]
    if not extra:
        return None

    # 天際線的收盤序列：同日覆蓋、新日附加，最後依日期排序
    dates = list(taiex.get("d") or [])
    closes = list(taiex.get("c") or [])
    at = {d: i for i, d in enumerate(dates)}
    for d, v in extra:
        if d in at:
            closes[at[d]] = rnd(v)
        else:
            dates.append(d)
            closes.append(rnd(v))
    order = sorted(range(len(dates)), key=lambda i: dates[i])
    taiex["d"] = [dates[i] for i in order]
    taiex["c"] = [closes[i] for i in order]

    # 首頁報價：最新一筆官方收盤；前一日取官方序列的前一筆，沒有就退回 Yahoo 的最後收盤
    date, close = extra[-1]
    earlier = [v for d, v in series if d < date]
    prev = earlier[-1] if earlier else q.get("price")
    q["price"] = rnd(close)
    q["date"] = date
    q["stale"] = False
    q["src"] = "twse"
    if prev:
        q["chg"] = rnd(close - prev)
        q["pct"] = round((close / prev - 1) * 100, 2)
    if q.get("spark"):
        q["spark"] = (list(q["spark"]) + [rnd(v) for _, v in extra])[-30:]
    return {"date": date, "close": rnd(close), "days": len(extra), "yahoo_date": yahoo_date}


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build(symbols_path: Path, out_dir: Path, state: PrevState, *, fx: SimpleNamespace | None = None,
          now: dt.datetime | None = None, skip_ai: bool = False, alerts_path: Path | None = None) -> dict:
    fx = fx or default_fetchers()
    now = now or dt.datetime.now(TZ)
    now_iso = now.isoformat(timespec="seconds")
    symbols = quotes_mod.load_symbols(symbols_path)

    prev = state.get("index.json") or {}
    prev_sources = prev.get("sources") or {}
    sources: dict[str, dict] = {}

    def step(name: str, fn: Callable[[], Any], prev_key: str | None = None, default: Any = None) -> tuple[Any, bool]:
        t0 = time.time()
        try:
            val = fn()
            sources[name] = {"ok": True, "at": now_iso, "ms": int((time.time() - t0) * 1000)}
            return val, True
        except Exception as e:  # noqa: BLE001 - 單一來源失敗要沿用舊資料，不能中斷
            log.warning("step %s failed: %s: %s", name, type(e).__name__, str(e)[:200])
            sources[name] = {"ok": False, "at": (prev_sources.get(name) or {}).get("at"),
                             "error": clip(f"{type(e).__name__}: {e}", 140)}
            return (prev.get(prev_key, default) if prev_key else default), False

    # ── 證交所日行情 → 排行 / 廣度 / 熱力圖 / 搜尋表 ──
    raw, ok_day = step("twse_daily", fx.stock_day_all)
    rows = twse.parse_stock_rows(raw) if ok_day else None
    rankings_prev = prev.get("rankings") or {}
    universe_prev = state.get("universe.json") or []

    profile_doc = state.get("profile.json") or {}
    profile = profile_doc.get("map") or {}
    age_ok = False
    try:
        age_ok = bool(profile) and (now - dt.datetime.fromisoformat(profile_doc["generated_at"])) < dt.timedelta(days=PROFILE_MAX_AGE_DAYS)
    except (KeyError, ValueError):
        age_ok = False
    if not age_ok:
        fresh, ok_prof = step("twse_profile", fx.profile)
        if ok_prof and fresh:
            profile = fresh
            profile_doc = {"generated_at": now_iso, "map": profile}
    else:
        sources["twse_profile"] = {"ok": True, "at": profile_doc["generated_at"], "cached": True}

    tpex_rows, ok_tpex = step("tpex_daily", lambda: tpex.parse_daily(fx.tpex_daily()))

    if rows:
        rankings = twse.build_rankings(rows)
        breadth = twse.build_breadth(rows)
        heatmap, sector_stats = twse.build_heatmap(rows, profile)
    else:
        rankings = {k: v for k, v in rankings_prev.items() if k in ("stock", "etf")}
        breadth, heatmap, sector_stats = prev.get("breadth"), prev.get("heatmap"), prev.get("sector_stats")
    if ok_tpex and tpex_rows:
        rankings["otc"] = tpex.build_rankings(tpex_rows)
    elif rankings_prev.get("otc"):
        rankings["otc"] = rankings_prev["otc"]

    if rows is not None:
        letter = {"stock": "s", "etf": "e", "otc": "o"}
        universe = [[r["code"], r["name"], r["close"], r["pct"], r["value"], letter[r["kind"]]]
                    for r in (rows + (tpex_rows or [])) if r["kind"] in letter]
    else:
        universe = universe_prev

    names = {r["code"]: r["name"] for r in (rows or []) if r["kind"] in ("stock", "etf")}

    # ── 報價與歷史（Yahoo） ──
    syms = [s.symbol for s in symbols]
    t0 = time.time()
    try:
        histories = fx.histories(syms)
    except Exception as e:  # noqa: BLE001
        log.warning("histories failed: %s", e)
        histories = {}
    prev_quotes = {q["symbol"]: q for q in (prev.get("quotes") or [])}
    qlist, details, failed = quotes_mod.build_all(
        symbols, histories, names, prev_quotes,
        prev_detail_loader=lambda s: state.get(f"sym/{safe_filename(s)}.json"),
    )
    got = len(syms) - len(failed)
    sources["quotes"] = {"ok": got >= len(syms) * 0.8, "at": now_iso, "ms": int((time.time() - t0) * 1000),
                         "got": got, "total": len(syms)}
    if failed:
        sources["quotes"]["failed"] = failed[:12]
        if not sources["quotes"]["ok"]:
            sources["quotes"]["at"] = (prev_sources.get("quotes") or {}).get("at")

    # ── 法人（大盤 / 個股）、融資券、成交金額、期貨 ──
    inst, ok_inst = step("twse_institutional", fx.institutional, "institutional")
    inst_date = (inst or {}).get("date", "")
    inst_hist = prev.get("inst_hist")
    if ok_inst and inst and inst_date:
        inst_hist = merge_hist(inst_hist, {"date": inst_date, **inst["summary"]})

    t86, _ = step("twse_t86", lambda: fx.t86(inst_date), "t86")
    if t86 and rows:  # 補上收盤價與漲跌幅
        rmap = {r["code"]: r for r in rows}
        for grp in ("total", "foreign", "trust"):
            for side in ("buy", "sell"):
                for it in (t86.get(grp) or {}).get(side, []):
                    r = rmap.get(it["code"])
                    if r:
                        it["close"], it["pct"] = r["close"], r["pct"]

    margin, ok_margin = step("twse_margin", lambda: fx.margin(inst_date), "margin")
    margin_hist = prev.get("margin_hist")
    if ok_margin and margin and margin.get("date"):
        margin_hist = merge_hist(margin_hist, {
            "date": margin["date"],
            "margin": (margin.get("margin") or {}).get("bal"),
            "short": (margin.get("short") or {}).get("bal"),
            "margin_amt": (margin.get("margin_amt") or {}).get("bal"),
        })

    turnover_hist, _ = step("twse_turnover", fx.turnover_hist, "turnover_hist", [])

    futures, ok_fut = step("taifex_oi", fx.futures_oi, "futures")
    futures_hist = prev.get("futures_hist")
    if ok_fut and futures and futures.get("date"):
        def pick(word: str) -> int | None:
            return next((r["net"] for r in futures["rows"] if word in r["name"]), None)
        futures_hist = merge_hist(futures_hist, {"date": futures["date"], "foreign": pick("外資"),
                                                 "trust": pick("投信"), "dealer": pick("自營")})

    dividends, _ = step("twse_dividends", fx.dividends, "dividends", [])
    notices, _ = step("twse_notices", fx.notices, "notices")

    # ── 新聞、總經、AI（僅總經） ──
    news, _ = step("news", fx.news, "news", [])
    macro, ok_macro = step("fred", fx.macro, "macro", [])
    if ok_macro and not macro and os.environ.get("FRED_API_KEY") and prev.get("macro"):
        macro = prev["macro"]
        sources["fred"] = {"ok": False, "at": (prev_sources.get("fred") or {}).get("at"), "error": "empty result, kept previous"}

    prev_ai = prev.get("ai")
    ai_report, ai_new = (None, False)
    if not skip_ai:
        try:
            ai_report, ai_new = ai.maybe_generate(macro or [], qlist, prev_ai, now=now, caller=fx.ai_caller)
        except Exception as e:  # noqa: BLE001 - AI 是加值功能，任何錯誤都不能讓整次資料更新失敗
            log.warning("ai step failed: %s %s", type(e).__name__, str(e)[:160])
            ai_report, ai_new = prev_ai, False
    else:
        ai_report = prev_ai
    macro_history = state.get("macro_history.json") or []
    if ai_new and ai_report:
        macro_history = ai.append_history(macro_history, ai_report)

    # ── 首頁大盤走勢（^TWII）──
    tw_detail = details.get("^TWII")
    taiex = {"d": list(tw_detail["d"]), "c": list(tw_detail["c"])} if tw_detail else (prev.get("taiex") or {"d": [], "c": []})
    # Yahoo 的 ^TWII 可能落後幾個交易日：用證交所官方收盤補上，否則首頁會停在舊日期
    official = apply_official_index(qlist, taiex, turnover_hist)
    if official:
        log.info("taiex: yahoo at %s, filled %d day(s) from TWSE up to %s",
                 official["yahoo_date"] or "—", official["days"], official["date"])
        sources["twse_index"] = {"ok": True, "at": now_iso, "date": official["date"],
                                 "note": f"Yahoo 停在 {official['yahoo_date'] or '—'}，改用證交所收盤"}
    twii_q = next((q for q in qlist if q["symbol"] == "^TWII"), None)

    index = {
        "schema": SCHEMA_VERSION,
        "updated_at": now_iso,
        "trade_date": (twii_q or {}).get("date", ""),
        "run": {"id": os.environ.get("GITHUB_RUN_ID", ""), "sha": os.environ.get("GITHUB_SHA", "")[:7]},
        "sources": sources,
        "quotes": qlist,
        "taiex": taiex,
        "institutional": inst,
        "inst_hist": inst_hist or [],
        "t86": t86,
        "margin": margin,
        "margin_hist": margin_hist or [],
        "futures": futures,
        "futures_hist": futures_hist or [],
        "breadth": breadth,
        "turnover_hist": turnover_hist or [],
        "rankings": rankings,
        "heatmap": heatmap or [],
        "sector_stats": sector_stats or [],
        "dividends": dividends or [],
        "notices": notices,
        "news": news or [],
        "macro": macro or [],
        "ai": ai_report,
    }
    validate_index(index, len(symbols))

    # ── 選用：價格警示推播 ──
    alert_state = None
    if alerts_path is not None:
        rules = notify.load_rules(alerts_path)
        if rules:
            msgs, alert_state = notify.evaluate(rules, qlist, state.get("alert_state.json"), now_iso)
            if msgs:
                fx.send_alert("📈 台股夜盤警示\n" + "\n".join(msgs))

    # ── 寫檔 ──
    sym_dir = out_dir / "sym"
    if sym_dir.exists():
        shutil.rmtree(sym_dir)
    for sym, detail in details.items():
        write_json(sym_dir / f"{safe_filename(sym)}.json", detail)
    write_json(out_dir / "index.json", index)
    write_json(out_dir / "universe.json", universe)
    write_json(out_dir / "macro_history.json", macro_history)
    if profile_doc:
        write_json(out_dir / "profile.json", profile_doc)
    if alert_state is not None:
        write_json(out_dir / "alert_state.json", alert_state)
    return index


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="產生台股夜盤的靜態資料")
    p.add_argument("--out", default=str(ROOT / "web" / "data"))
    p.add_argument("--symbols", default=str(ROOT / "symbols.json"))
    p.add_argument("--alerts", default=str(ROOT / "alerts.json"))
    p.add_argument("--prev-url", default=os.environ.get("PREV_BASE_URL", ""), help="上一版網站網址（讀取舊資料）")
    p.add_argument("--prev-dir", default=os.environ.get("PREV_DIR", ""), help="本機上一版 data 目錄（開發 / 測試用）")
    p.add_argument("--skip-ai", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    state = PrevState(base_url=a.prev_url, local_dir=a.prev_dir or None)
    idx = build(Path(a.symbols), Path(a.out), state, skip_ai=a.skip_ai, alerts_path=Path(a.alerts))
    bad = [k for k, v in idx["sources"].items() if not v.get("ok")]
    print(f"ok: {len(idx['quotes'])} quotes, {len(idx['news'])} news, ai={'yes' if idx['ai'] else 'no'}, "
          f"sources failed: {', '.join(bad) if bad else 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
