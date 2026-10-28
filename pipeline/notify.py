"""選用：價格警示推播（Telegram）。

在倉庫根目錄放 alerts.json 設定規則；在 GitHub Secrets 設定 TELEGRAM_BOT_TOKEN 與 TELEGRAM_CHAT_ID 後才會啟用。
沒有設定時完全不做事。每條規則只在「由未觸發變成觸發」時通知一次，條件解除後會重新待命。
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from . import http

log = logging.getLogger("pipeline.notify")

OPS = {">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b}


def load_rules(path: str | Path) -> list[dict]:
    p = Path(path)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except ValueError as e:
        log.warning("alerts.json invalid: %s", e)
        return []
    rules = data.get("rules", []) if isinstance(data, dict) else data
    return [r for r in rules if isinstance(r, dict) and r.get("symbol") and r.get("op") in OPS and isinstance(r.get("value"), (int, float))]


def evaluate(rules: list[dict], quotes: list[dict], prev_state: dict | None, now_iso: str) -> tuple[list[str], dict]:
    qmap = {q["symbol"]: q for q in quotes}
    prev_state = prev_state or {}
    state: dict[str, dict] = {}
    messages: list[str] = []
    for r in rules:
        q = qmap.get(r["symbol"])
        if not q:
            continue
        key = f"{r['symbol']}{r['op']}{r['value']}"
        on = OPS[r["op"]](q["price"], r["value"])
        was = bool(prev_state.get(key, {}).get("on"))
        state[key] = {"on": on, "at": now_iso if (on and not was) else prev_state.get(key, {}).get("at")}
        if on and not was:
            note = f"（{r['note']}）" if r.get("note") else ""
            messages.append(f"{q['name']} {r['symbol']} 現價 {q['price']} {r['op']} {r['value']}{note}")
    return messages, state


def send_telegram(text: str) -> bool:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return False
    try:
        http.post_json(f"https://api.telegram.org/bot{token}/sendMessage",
                       json={"chat_id": chat, "text": text, "disable_web_page_preview": True}, timeout=20)
        return True
    except Exception as e:  # noqa: BLE001 - 推播失敗不應中斷資料更新
        log.warning("telegram failed: %s", type(e).__name__)
        return False
