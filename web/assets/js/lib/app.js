// 資料中樞：載入 index／universe、提供「以 key 取得標的」的統一介面、自動更新。
// key 有兩種：追蹤標的的 symbol（'2330.TW'、'^TWII'），或全市場的股票代號（'6488'，只有當日報價）。

import * as api from './api.js';
import * as store from './store.js';

const CODE_RE = /^(\d{4,6}[A-Z]?)\.(TW|TWO)$/;

export const D = {
  index: null,
  universe: [],
  quotes: [],
  bySymbol: new Map(),
  byCode: new Map(), // 代號 → 追蹤標的 symbol
  uni: new Map(), // 代號 → universe 列
  loadedAt: 0,
  error: null,
  loading: false,
};

const subs = new Set();
export const subscribe = (f) => (subs.add(f), () => subs.delete(f));
const emit = () => subs.forEach((f) => f(D));

export function ingest(index, universe) {
  D.index = index;
  D.quotes = index.quotes || [];
  D.bySymbol = new Map(D.quotes.map((q) => [q.symbol, q]));
  D.byCode = new Map();
  for (const q of D.quotes) {
    const m = CODE_RE.exec(q.symbol);
    if (m) D.byCode.set(m[1], q.symbol);
  }
  if (universe) {
    D.universe = universe;
    D.uni = new Map(universe.map((r) => [r[0], r]));
  }
  D.loadedAt = Date.now();
  D.error = null;
}

export async function load() {
  if (D.loading) return;
  D.loading = true;
  emit();
  try {
    const [index, universe] = await Promise.all([api.loadIndex(), D.universe.length && Date.now() - D.loadedAt < 30 * 60000 ? Promise.resolve(null) : api.loadUniverse().catch(() => null)]);
    ingest(index, universe);
  } catch (e) {
    D.error = e;
  } finally {
    D.loading = false;
    emit();
  }
}

const UNI_KIND = { s: 'stock', e: 'etf', o: 'otc' };

/** 統一的標的資料。找不到回傳 null。 */
export function resolve(key) {
  const q = D.bySymbol.get(key) || (D.byCode.has(key) ? D.bySymbol.get(D.byCode.get(key)) : null);
  if (q) {
    const m = CODE_RE.exec(q.symbol);
    return { key: q.symbol, symbol: q.symbol, code: m ? m[1] : q.symbol, name: q.name, price: q.price, chg: q.chg, pct: q.pct, kind: q.kind, group: q.group, tracked: true, quote: q, stale: q.stale };
  }
  const u = D.uni.get(key);
  if (u) {
    const [code, name, close, pct, value, t] = u;
    const chg = close != null && pct != null ? close - close / (1 + pct / 100) : null;
    return { key: code, symbol: null, code, name, price: close, chg, pct, value, kind: UNI_KIND[t] || 'stock', group: '台股', tracked: false, quote: null };
  }
  return null;
}

export const priceOf = (key) => resolve(key)?.price ?? null;

/** 目前 key 的顯示名稱；資料還沒載入時退回 key 本身。 */
export const nameOf = (key) => resolve(key)?.name ?? key;

/** 外部（Yahoo 奇摩）連結用的代號。 */
export function yahooSymbol(r) {
  if (!r) return '';
  if (r.symbol) return r.symbol;
  return D.uni.get(r.code)?.[5] === 'o' ? `${r.code}.TWO` : `${r.code}.TW`;
}

/** 搜尋追蹤標的與全市場個股。 */
export function search(query, limit = 14) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const rank = (code, name, symbol) => {
    const c = code.toLowerCase();
    const n = name.toLowerCase();
    if (c === q || symbol.toLowerCase() === q) return 0;
    if (c.startsWith(q)) return 1;
    if (n.startsWith(q)) return 2;
    if (n.includes(q)) return 3;
    if (symbol.toLowerCase().includes(q)) return 4;
    return -1;
  };
  const out = [];
  const seen = new Set();
  for (const t of D.quotes) {
    const r = rank(CODE_RE.exec(t.symbol)?.[1] ?? t.symbol, t.name, t.symbol);
    if (r < 0) continue;
    seen.add(CODE_RE.exec(t.symbol)?.[1] ?? t.symbol);
    out.push({ r, item: resolve(t.symbol) });
  }
  for (const u of D.universe) {
    if (seen.has(u[0])) continue;
    const r = rank(u[0], u[1], u[0]);
    if (r < 0) continue;
    out.push({ r: r + 0.5, item: resolve(u[0]) });
  }
  out.sort((a, b) => a.r - b.r || (b.item.value ?? 0) - (a.item.value ?? 0));
  return out.slice(0, limit).map((x) => x.item);
}

/** 自選股／警示用：把 key 轉成可顯示的資料列，找不到的也保留（資料可能暫時缺漏）。 */
export const rows = (keys) => keys.map((k) => resolve(k) || { key: k, code: k, name: k, price: null, pct: null, missing: true });

// ── 自動更新 ──
let timer = null;
export function startAutoRefresh(onTick) {
  stopAutoRefresh();
  if (!store.settings().refresh) return;
  const tick = async () => {
    if (document.hidden) return;
    await load();
    onTick?.();
  };
  timer = setInterval(tick, 5 * 60000);
}
export function stopAutoRefresh() {
  clearInterval(timer);
  timer = null;
}
