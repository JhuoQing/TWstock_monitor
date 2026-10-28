"""財經新聞：RSS 彙整、去重、重要度評分、主題標籤與關鍵詞判讀（皆為規則式，不使用 AI）。"""
from __future__ import annotations

import datetime as dt
import email.utils
import logging
import re
import xml.etree.ElementTree as ET
from urllib.parse import quote

from . import http
from .util import TZ

log = logging.getLogger("pipeline.news")

MAX_AGE_DAYS = 3
MAX_ITEMS = 80
MAX_BYTES = 3_000_000


def gn(q: str) -> str:
    return f"https://news.google.com/rss/search?q={quote(q + ' when:2d')}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"


FEEDS = [
    gn("台股"), gn("外資 台股"), gn("台積電"), gn("央行 利率"), gn("聯準會"),
    gn("關稅 半導體"), gn("新台幣 匯率"),
    "https://tw.stock.yahoo.com/rss?category=tw-market",
]

# 重要度關鍵字（權重 1–3；≥3 視為重大）
KW = {
    "升息": 3, "降息": 3, "央行": 3, "聯準會": 3, "Fed": 3, "FOMC": 3, "關稅": 3, "制裁": 3,
    "重挫": 3, "大跌": 3, "暴跌": 3, "崩盤": 3, "熔斷": 3, "貿易戰": 3, "戰爭": 3, "開戰": 3,
    "外資": 2, "台積電": 2, "輝達": 2, "大漲": 2, "飆": 2, "創高": 2, "創新高": 2, "地緣": 2,
    "CPI": 2, "通膨": 2, "財報": 2, "法說": 2, "停牌": 2, "金管會": 2, "貶值": 2, "升值": 2,
    "匯率": 1, "AI": 1, "半導體": 1, "出口": 1, "景氣": 1, "證交所": 1,
}

UP_WORDS = ("大漲", "飆", "創高", "創新高", "買超", "看好", "上修", "轉強", "反彈", "回升", "增溫", "利多", "樂觀", "強勁", "漲停")
DOWN_WORDS = ("大跌", "重挫", "暴跌", "崩盤", "熔斷", "賣超", "看壞", "下修", "轉弱", "衰退", "利空", "悲觀", "疲弱", "跌停", "停牌", "制裁")

TOPICS = {
    "半導體": ("半導體", "晶圓", "台積", "聯電", "封測", "IC設計", "晶片", "聯發科"),
    "AI": ("AI", "輝達", "NVIDIA", "伺服器", "算力", "GPU", "人工智慧", "資料中心"),
    "金融": ("金控", "銀行", "壽險", "券商", "金管會", "金融股"),
    "航運": ("航運", "長榮", "陽明", "萬海", "貨櫃"),
    "電子": ("PCB", "面板", "光電", "蘋果", "iPhone", "電子股", "零組件"),
    "傳產": ("鋼鐵", "塑化", "水泥", "紡織", "食品", "營建", "航空"),
    "總經": ("Fed", "聯準會", "降息", "升息", "CPI", "通膨", "非農", "央行", "利率", "GDP", "就業", "FOMC"),
    "匯率": ("匯率", "新台幣", "美元", "日圓", "貶值", "升值"),
    "能源": ("原油", "油價", "能源", "OPEC"),
    "生技": ("生技", "新藥", "醫療"),
    "地緣": ("關稅", "制裁", "地緣", "戰爭", "烏克蘭", "中東", "川普", "貿易戰"),
}

_PUNCT = re.compile(r"[\s\W_]+", re.UNICODE)


def parse_rss(content: bytes) -> list[dict]:
    if len(content) > MAX_BYTES:
        raise ValueError("feed too large")
    root = ET.fromstring(content)
    out = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        if not title:
            continue
        src_el = it.find("source")
        src = (src_el.text or "").strip() if src_el is not None and src_el.text else ""
        if src and title.endswith(" - " + src):
            title = title[: -len(" - " + src)].strip()
        elif " - " in title and not src:
            title, src = title.rsplit(" - ", 1)
            title, src = title.strip(), src.strip()
        out.append({"title": title, "link": (it.findtext("link") or "").strip(),
                    "source": src or "新聞", "time": _parse_time(it.findtext("pubDate"))})
    return out


def _parse_time(s: str | None) -> dt.datetime:
    if s:
        try:
            t = email.utils.parsedate_to_datetime(s.strip())
            if t.tzinfo is None:
                t = t.replace(tzinfo=dt.timezone.utc)
            return t.astimezone(dt.timezone.utc)
        except (TypeError, ValueError):
            pass
    return dt.datetime.now(dt.timezone.utc)


def _bigrams(title: str) -> set[str]:
    t = _PUNCT.sub("", title.lower())
    return {t[i:i + 2] for i in range(len(t) - 1)} or {t}


def similar(a: set[str], b: set[str], threshold: float = 0.6) -> bool:
    if not a or not b:
        return False
    return len(a & b) / len(a | b) >= threshold


def score(title: str) -> int:
    return sum(w for k, w in KW.items() if k in title)


def tone(title: str) -> str:
    up = sum(1 for w in UP_WORDS if w in title)
    down = sum(1 for w in DOWN_WORDS if w in title)
    return "up" if up > down else "down" if down > up else "flat"


def tags(title: str, limit: int = 3) -> list[str]:
    hit = []
    for name, words in TOPICS.items():
        if any(w.lower() in title.lower() for w in words):
            hit.append(name)
        if len(hit) >= limit:
            break
    return hit


def build_items(entries: list[dict], now: dt.datetime | None = None) -> list[dict]:
    now = now or dt.datetime.now(dt.timezone.utc)
    items: list[dict] = []
    grams: list[set[str]] = []
    for e in sorted(entries, key=lambda z: z["time"], reverse=True):
        if (now - e["time"]).days > MAX_AGE_DAYS:
            continue
        g = _bigrams(e["title"])
        dup = next((i for i, h in enumerate(grams) if similar(g, h)), None)
        if dup is not None:
            also = items[dup].setdefault("also", [])
            if e["source"] != items[dup]["source"] and e["source"] not in also and len(also) < 3:
                also.append(e["source"])
            continue
        grams.append(g)
        sc = score(e["title"])
        items.append({
            "title": e["title"], "link": e["link"], "source": e["source"],
            "time": e["time"].astimezone(TZ).isoformat(timespec="seconds"),
            "score": sc, "important": sc >= 3, "tone": tone(e["title"]), "tags": tags(e["title"]),
        })
    items.sort(key=lambda z: (z["important"], z["time"]), reverse=True)
    return items[:MAX_ITEMS]


def fetch_news(feeds: list[str] | None = None) -> list[dict]:
    entries: list[dict] = []
    ok = 0
    for url in feeds or FEEDS:
        try:
            entries.extend(parse_rss(http.get(url, timeout=20).content))
            ok += 1
        except Exception as e:  # noqa: BLE001 - 單一來源失敗不影響其他
            log.warning("feed failed %s: %s", url[:60], type(e).__name__)
    if not ok:
        raise ValueError("all news feeds failed")
    return build_items(entries)
