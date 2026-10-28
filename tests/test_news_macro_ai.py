import datetime as dt
import json

import pytest
import requests

from pipeline import ai, macro, news, notify
from pipeline.util import TZ
from tests import fixtures as fx

NOW = dt.datetime(2026, 10, 28, 10, 0, tzinfo=TZ)


# ── news ──
def test_parse_rss_strips_source_suffix():
    items = news.parse_rss(fx.RSS)
    assert items[0]["title"] == "台股大漲 外資買超" and items[0]["source"] == "工商時報"
    assert items[2]["source"] == "Yahoo"  # 沒有 <source> 時由標題尾端切出


def test_build_items_dedupes_scores_and_drops_old():
    items = news.build_items(news.parse_rss(fx.RSS), now=NOW.astimezone(dt.timezone.utc))
    titles = [i["title"] for i in items]
    assert len(items) == 2  # 重複的合併、超過 3 天的捨棄
    assert not any("太舊" in t for t in titles)
    big = next(i for i in items if "大漲" in i["title"])
    assert big["important"] and big["tone"] == "up" and big["also"] == ["經濟日報"]
    fed = next(i for i in items if "Fed" in i["title"])
    assert fed["important"] and "總經" in fed["tags"]
    assert items[0]["important"]  # 重大新聞排前面


def test_tone_and_tags():
    assert news.tone("台股重挫 外資賣超") == "down" and news.tone("今日開盤") == "flat"
    assert news.tags("AI 伺服器需求強勁 台積電擴產") == ["半導體", "AI"]


# ── macro ──
def test_derive_modes():
    obs = [("2026-09-01", 120.0), ("2026-08-01", 118.0)] + [(f"d{i}", 100.0) for i in range(11)] + [("2025-09-01", 100.0), ("2025-08-01", 100.0)]
    assert macro.derive(obs, "level")[0][1] == 120.0
    assert macro.derive(obs, "diff")[0][1] == 2.0
    yoy = macro.derive(obs, "yoy")
    assert round(yoy[0][1], 2) == 20.0 and len(yoy) == len(obs) - 12


def test_build_row_has_ascending_history():
    obs = [(f"2026-{12 - i:02d}-01", 100 + i) for i in range(12)]
    row = macro.build_row("X", "測試", "level", "%", "m", obs)
    assert row["value"] == 100 and row["prev"] == 101
    assert [h[0] for h in row["hist"]] == sorted(h[0] for h in row["hist"])
    with pytest.raises(ValueError):
        macro.build_row("X", "測試", "yoy", "%", "m", obs[:5])


def test_fetch_macro_without_key_returns_empty(monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    assert macro.fetch_macro() == []


# ── ai：只做總經報告，且要節流 ──
MACRO = [{"id": "CPIAUCSL", "name": "美國 CPI 年增率", "value": 3.1, "prev": 3.0, "date": "2026-09-01", "unit": "%", "freq": "m",
          "hist": [["2026-07-01", 2.9], ["2026-08-01", 3.0], ["2026-09-01", 3.1]]}]
QUOTES = [{"symbol": "^TNX", "name": "美國10年期殖利率", "price": 4.2, "pct": 1.0, "spark": [4.0, 4.0, 4.1, 4.1, 4.1, 4.2]},
          {"symbol": "^TWII", "name": "加權指數", "price": 46000, "pct": -1.0, "spark": [1] * 6}]
GOOD = {"headline": "通膨緩升", "summary": "CPI 年增率升至 3.1%。", "sections": [{"title": "通膨", "text": "CPI 3.1%"}], "watch": ["下月 CPI"], "risks": []}


def test_context_is_macro_only():
    ctx = ai.build_context(MACRO, QUOTES)
    assert set(ctx) == {"總經指標", "相關市場"}
    assert [m["名稱"] for m in ctx["相關市場"]] == ["美國10年期殖利率"]  # 加權指數不會送給 AI


def test_no_key_or_no_macro_means_no_call(monkeypatch):
    called = []
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert ai.maybe_generate(MACRO, QUOTES, None, caller=lambda *a: called.append(1)) == (None, False)
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert ai.maybe_generate([], QUOTES, None, caller=lambda *a: called.append(1)) == (None, False)
    assert not called


def test_generates_once_then_throttles(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    calls = []

    def caller(prompt, key):
        calls.append(prompt)
        return GOOD, "m1"

    r1, new1 = ai.maybe_generate(MACRO, QUOTES, None, now=NOW, caller=caller)
    assert new1 and r1["headline"] == "通膨緩升" and r1["model"] == "m1" and len(calls) == 1
    assert "不得給買賣" in calls[0]
    # 數據沒變 → 不呼叫
    r2, new2 = ai.maybe_generate(MACRO, QUOTES, r1, now=NOW + dt.timedelta(hours=30), caller=caller)
    assert not new2 and r2 is r1 and len(calls) == 1
    # 市場報價變動不影響 hash
    q2 = [dict(QUOTES[0], price=9.9, pct=5.0)] + QUOTES[1:]
    assert not ai.maybe_generate(MACRO, q2, r1, now=NOW + dt.timedelta(hours=30), caller=caller)[1]
    # 數據變了但距上次不足 20 小時 → 仍不呼叫
    changed = [dict(MACRO[0], value=3.2)]
    assert not ai.maybe_generate(changed, QUOTES, r1, now=NOW + dt.timedelta(hours=5), caller=caller)[1]
    # 數據變了且超過間隔 → 呼叫
    assert ai.maybe_generate(changed, QUOTES, r1, now=NOW + dt.timedelta(hours=21), caller=caller)[1]
    assert len(calls) == 2


def test_failure_keeps_previous_report(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    prev = {"summary": "舊的", "hash": "old", "generated_at": (NOW - dt.timedelta(days=2)).isoformat()}

    def boom(*a):
        raise RuntimeError("quota")

    assert ai.maybe_generate(MACRO, QUOTES, prev, now=NOW, caller=boom) == (prev, False)


def test_sanitize_clips_and_history_caps():
    long = {"headline": "x" * 100, "summary": "y" * 2000, "sections": [{"title": "t", "text": "z" * 999}] * 9, "watch": ["w"] * 9, "risks": "ab"}
    s = ai.sanitize(long)
    assert len(s["headline"]) == 40 and len(s["summary"]) == 700 and len(s["sections"]) == 5 and len(s["watch"]) == 3
    hist = []
    for i in range(40):
        hist = ai.append_history(hist, {"hash": str(i), "summary": "s", "generated_at": "t"})
    assert len(hist) == ai.HISTORY_KEEP and hist[0]["hash"] == "39"


def test_call_gemini_falls_through_on_404(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "bad-model")
    seen = []

    class R:
        def __init__(self, code, body=None):
            self.status_code, self._b = code, body

        def json(self):
            return self._b

    def fake_post(url, **kw):
        seen.append(url)
        if "bad-model" in url:
            e = requests.HTTPError("404")
            e.response = R(404)
            raise e
        return R(200, {"candidates": [{"content": {"parts": [{"text": json.dumps(GOOD)}]}}]})

    monkeypatch.setattr(ai.http, "post_json", fake_post)
    res, model = ai.call_gemini("p", "k")
    assert res["headline"] == "通膨緩升" and model == "gemini-flash-latest" and len(seen) == 2


# ── notify ──
def test_alert_fires_once_and_rearms():
    rules = [{"symbol": "2330.TW", "op": ">=", "value": 1000, "note": "突破"}, {"symbol": "2317.TW", "op": "<=", "value": 100}]
    q = [{"symbol": "2330.TW", "name": "台積電", "price": 1010}, {"symbol": "2317.TW", "name": "鴻海", "price": 198}]
    msgs, st = notify.evaluate(rules, q, None, "t1")
    assert len(msgs) == 1 and "台積電" in msgs[0] and "突破" in msgs[0]
    assert notify.evaluate(rules, q, st, "t2")[0] == []  # 已觸發，不重複通知
    q[0]["price"] = 990
    _, st2 = notify.evaluate(rules, q, st, "t3")
    q[0]["price"] = 1005
    assert len(notify.evaluate(rules, q, st2, "t4")[0]) == 1  # 解除後再次觸發


def test_load_rules_filters_bad_entries(tmp_path):
    p = tmp_path / "a.json"
    p.write_text(json.dumps({"rules": [{"symbol": "A", "op": ">=", "value": 1}, {"symbol": "B", "op": "??", "value": 1}, {"op": ">=", "value": 1}]}))
    assert [r["symbol"] for r in notify.load_rules(p)] == ["A"]
    assert notify.load_rules(tmp_path / "missing.json") == []


def test_send_telegram_is_noop_without_secrets(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    assert notify.send_telegram("x") is False


def test_env_float_tolerates_empty_and_bad_values(monkeypatch):
    # GitHub Actions 未定義的 vars.* 會變成空字串，這曾讓整次更新崩潰
    for raw in ["", "  ", "abc", "-3"]:
        monkeypatch.setenv("AI_MIN_INTERVAL_HOURS", raw)
        assert ai.env_float("AI_MIN_INTERVAL_HOURS", 20.0) == 20.0
    monkeypatch.setenv("AI_MIN_INTERVAL_HOURS", "6")
    assert ai.env_float("AI_MIN_INTERVAL_HOURS", 20.0) == 6.0
    monkeypatch.delenv("AI_MIN_INTERVAL_HOURS")
    assert ai.env_float("AI_MIN_INTERVAL_HOURS", 20.0) == 20.0


def test_maybe_generate_with_empty_interval_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("AI_MIN_INTERVAL_HOURS", "")
    r, new = ai.maybe_generate(MACRO, QUOTES, None, now=NOW, caller=lambda p, k: (GOOD, "m"))
    assert new and r["model"] == "m"
