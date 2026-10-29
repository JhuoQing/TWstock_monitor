// 使用者資料（自選股、警示、持股、設定），只存在這個瀏覽器的 localStorage，不會上傳。

const KEY = 'twm:v2';
const OPS = ['>=', '<='];

const defaults = () => ({
  v: 2,
  settings: { theme: 'auto', ud: 'tw', refresh: true, live: true },
  watch: [],
  alerts: [],
  holdings: [],
  recent: [],
});

let storage = null;
try {
  storage = globalThis.localStorage ?? null;
} catch {
  storage = null;
}

let state = defaults();
const subs = new Set();

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const validAlert = (a) => a && typeof a.sym === 'string' && OPS.includes(a.op) && isNum(a.value) && typeof a.id === 'string';
const validHolding = (h) => h && typeof h.sym === 'string' && isNum(h.shares) && h.shares > 0 && isNum(h.cost) && h.cost >= 0;

export function normalize(p) {
  const d = defaults();
  const s = p && typeof p === 'object' ? p : {};
  const st = s.settings && typeof s.settings === 'object' ? s.settings : {};
  return {
    v: 2,
    settings: {
      theme: ['auto', 'dark', 'light'].includes(st.theme) ? st.theme : d.settings.theme,
      ud: ['tw', 'intl'].includes(st.ud) ? st.ud : d.settings.ud,
      refresh: st.refresh !== false,
      live: st.live !== false,
    },
    watch: Array.isArray(s.watch) ? [...new Set(s.watch.filter((x) => typeof x === 'string' && x))].slice(0, 200) : [],
    alerts: Array.isArray(s.alerts) ? s.alerts.filter(validAlert).slice(0, 100).map((a) => ({ id: a.id, sym: a.sym, op: a.op, value: a.value, on: a.on !== false, at: a.at || null, note: String(a.note || '').slice(0, 40) })) : [],
    recent: Array.isArray(s.recent) ? s.recent.filter((x) => typeof x === 'string' && x).slice(0, 8) : [],
    holdings: Array.isArray(s.holdings) ? s.holdings.filter(validHolding).slice(0, 200).map((h) => ({ sym: h.sym, shares: h.shares, cost: h.cost })) : [],
  };
}

function load() {
  try {
    const raw = storage && storage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* 資料損毀時退回預設值 */
  }
  return defaults();
}

function save() {
  try {
    storage && storage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 無痕模式或空間已滿：僅本次有效 */
  }
}

/** 測試用：換掉儲存後端並重新載入。 */
export function configure({ storage: s }) {
  storage = s;
  state = load();
}

state = load();

export const get = () => state;
export const settings = () => state.settings;

export function update(fn) {
  fn(state);
  save();
  subs.forEach((f) => f(state));
}

export function subscribe(f) {
  subs.add(f);
  return () => subs.delete(f);
}

// ── 自選股（key 為追蹤代號如 '2330.TW'，或全市場代號如 '6488'） ──
export const inWatch = (k) => state.watch.includes(k);

export function toggleWatch(k) {
  update((s) => {
    const i = s.watch.indexOf(k);
    if (i < 0) s.watch.push(k);
    else s.watch.splice(i, 1);
  });
  return inWatch(k);
}

export function moveWatch(k, dir) {
  update((s) => {
    const i = s.watch.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.watch.length) return;
    [s.watch[i], s.watch[j]] = [s.watch[j], s.watch[i]];
  });
}

export function pushRecent(k) {
  update((s) => {
    s.recent = [k, ...s.recent.filter((x) => x !== k)].slice(0, 8);
  });
}

// ── 價格警示 ──
let seq = 0;
export function addAlert({ sym, op, value, note = '' }) {
  if (!sym || !OPS.includes(op) || !isNum(value)) return null;
  const id = `a${Date.now().toString(36)}${(seq++).toString(36)}`;
  update((s) => s.alerts.push({ id, sym, op, value, on: true, at: null, note: String(note).slice(0, 40) }));
  return id;
}

export const removeAlert = (id) => update((s) => { s.alerts = s.alerts.filter((a) => a.id !== id); });
export const rearmAlert = (id) => update((s) => { const a = s.alerts.find((x) => x.id === id); if (a) { a.on = true; a.at = null; } });

/** 檢查警示；回傳這次剛觸發的規則（並標記為已觸發）。 */
export function checkAlerts(priceOf, nowIso = new Date().toISOString()) {
  const hit = [];
  for (const a of state.alerts) {
    if (!a.on) continue;
    const p = priceOf(a.sym);
    if (!isNum(p)) continue;
    if ((a.op === '>=' && p >= a.value) || (a.op === '<=' && p <= a.value)) hit.push({ ...a, price: p });
  }
  if (hit.length) {
    update((s) => {
      for (const h of hit) {
        const a = s.alerts.find((x) => x.id === h.id);
        if (a) { a.on = false; a.at = nowIso; }
      }
    });
  }
  return hit;
}

// ── 持股 ──
export function setHolding(sym, shares, cost) {
  if (!(isNum(shares) && shares > 0 && isNum(cost) && cost >= 0)) return false;
  update((s) => {
    const h = s.holdings.find((x) => x.sym === sym);
    if (h) { h.shares = shares; h.cost = cost; } else s.holdings.push({ sym, shares, cost });
  });
  return true;
}
export const removeHolding = (sym) => update((s) => { s.holdings = s.holdings.filter((h) => h.sym !== sym); });

// ── 設定、備份 ──
export const setSetting = (k, v) => update((s) => { s.settings[k] = v; });
export const exportJson = () => JSON.stringify({ app: 'twstock-monitor', ...state }, null, 2);

export function importJson(text) {
  let p;
  try {
    p = JSON.parse(text);
  } catch {
    return { ok: false, error: '檔案不是有效的 JSON' };
  }
  if (!p || typeof p !== 'object' || (p.app && p.app !== 'twstock-monitor')) return { ok: false, error: '這不是台股夜盤的備份檔' };
  const next = normalize(p);
  update((s) => Object.assign(s, next));
  return { ok: true, watch: next.watch.length, alerts: next.alerts.length, holdings: next.holdings.length };
}

export function clearAll() {
  update((s) => Object.assign(s, defaults()));
}
