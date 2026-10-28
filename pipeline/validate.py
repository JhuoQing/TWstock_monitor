"""輸出前的資料檢查。驗證失敗會讓工作流程失敗，因此不會部署壞掉的網站，線上維持上一版。"""
from __future__ import annotations

import math
from numbers import Real


class ValidationError(Exception):
    pass


def _is_num(x) -> bool:
    return isinstance(x, Real) and not isinstance(x, bool) and not math.isnan(float(x))


def validate_index(idx: dict, expected_symbols: int) -> None:
    errs: list[str] = []
    for k in ("schema", "updated_at", "quotes", "taiex", "sources"):
        if k not in idx:
            errs.append(f"missing key: {k}")
    quotes = idx.get("quotes") or []
    need = min(expected_symbols, max(10, int(expected_symbols * 0.6)))
    if len(quotes) < need:
        errs.append(f"too few quotes: {len(quotes)} < {need}")
    syms = {q.get("symbol") for q in quotes}
    if "^TWII" not in syms:
        errs.append("^TWII missing")
    for q in quotes:
        if not (_is_num(q.get("price")) and _is_num(q.get("pct")) and isinstance(q.get("spark"), list) and q.get("symbol")):
            errs.append(f"bad quote: {q.get('symbol')}")
            if len(errs) > 8:
                break
    tw = idx.get("taiex") or {}
    if len(tw.get("c") or []) < 30 or len(tw.get("c") or []) != len(tw.get("d") or []):
        errs.append("taiex history too short or inconsistent")
    if errs:
        raise ValidationError("; ".join(errs[:8]))
