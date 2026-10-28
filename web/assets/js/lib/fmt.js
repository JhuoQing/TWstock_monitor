// 數字與日期格式化（繁體中文、台灣慣例）。

const cache = new Map();
function nf(min, max) {
  const k = min + ':' + max;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(k, f);
  }
  return f;
}

const ok = (n) => n != null && Number.isFinite(Number(n));

export const num = (n, d = 2) => (ok(n) ? nf(d, d).format(Number(n)) : '—');
export const int = (n) => num(n, 0);
export const sg = (v) => (v > 0 ? '+' : '');
export const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
export const pct = (v, d = 2) => (ok(v) ? `${sg(v)}${num(v, d)}%` : '—');
export const signed = (v, d = 2) => (ok(v) ? `${sg(v)}${num(v, d)}` : '—');

/** 依大小自動選小數位的價格：>=1000 取 2 位，<10 取 3~4 位。 */
export function price(v) {
  if (!ok(v)) return '—';
  const a = Math.abs(v);
  return num(v, a >= 10 ? 2 : a >= 1 ? 3 : 4);
}

/** 以「億元」為單位的金額 → '3,500 億' 或 '1.2 兆'。 */
export function yi(v, d = 0) {
  if (!ok(v)) return '—';
  const a = Math.abs(v);
  if (a >= 10000) return `${num(v / 10000, 2)} 兆`;
  return `${num(v, a < 100 ? Math.max(d, 1) : d)} 億`;
}

/** 張數 → '1.2 萬張' / '3.4 億張'。 */
export function lots(n) {
  if (!ok(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e8) return `${num(n / 1e8, 2)} 億張`;
  if (a >= 1e4) return `${num(n / 1e4, 1)} 萬張`;
  return `${num(n, 0)} 張`;
}

/** 一般數量（股、口）的簡寫。 */
export function compact(n) {
  if (!ok(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e8) return `${num(n / 1e8, 2)} 億`;
  if (a >= 1e4) return `${num(n / 1e4, 1)} 萬`;
  return num(n, 0);
}

export function ago(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, (now - t) / 6e4);
  if (m < 1) return '剛剛';
  if (m < 60) return `${Math.round(m)} 分鐘前`;
  if (m < 1440) return `${Math.round(m / 60)} 小時前`;
  return `${Math.round(m / 1440)} 天前`;
}

const TW = { timeZone: 'Asia/Taipei', hour12: false };
export function stamp(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('zh-TW', { ...TW, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const dateShort = (iso) => (iso && iso.length >= 10 ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : '');

/** 台北時區今天的 YYYY-MM-DD。 */
export function todayTW(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return p; // en-CA → 2026-10-28
}

/** 與 pipeline/util.py 的 safe_filename 規則一致。 */
export const symFile = (s) => String(s).replace(/\^/g, '_').replace(/=/g, '_').replace(/\//g, '_');

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 分鐘數 → '15 分鐘'／'3 小時'／'2 天'。 */
export function dur(mins) {
  if (!ok(mins)) return '';
  if (mins < 60) return `${Math.max(1, Math.round(mins))} 分鐘`;
  if (mins < 1440) return `${Math.round(mins / 60)} 小時`;
  return `${Math.round(mins / 1440)} 天`;
}
