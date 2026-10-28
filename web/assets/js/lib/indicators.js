// 技術指標。定義與 pipeline/indicators.py 一致（Wilder RSI 以簡單平均起算）。
// 輸入輸出皆為純陣列；資料不足的位置為 null。

export function sma(a, n) {
  const out = new Array(a.length).fill(null);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i];
    if (i >= n) sum -= a[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(a, n) {
  const k = 2 / (n + 1);
  const out = [];
  let p = null;
  for (const v of a) {
    p = p == null ? v : v * k + p * (1 - k);
    out.push(p);
  }
  return out;
}

export function rsi(c, n = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  const val = () => (l === 0 ? (g > 0 ? 100 : 50) : 100 - 100 / (1 + g / l));
  out[n] = val();
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

export function macd(c, fast = 12, slow = 26, sig = 9) {
  const a = ema(c, fast);
  const b = ema(c, slow);
  const m = a.map((v, i) => v - b[i]);
  const s = ema(m, sig);
  return { m, s, h: m.map((v, i) => v - s[i]) };
}

/** KD（隨機指標）：RSV 以 n 日高低計算，K、D 以 1/3 權重平滑，起始為 50。 */
export function kd(h, l, c, n = 9) {
  const K = new Array(c.length).fill(null);
  const D = new Array(c.length).fill(null);
  let k = 50;
  let d = 50;
  for (let i = n - 1; i < c.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      if (h[j] > hi) hi = h[j];
      if (l[j] < lo) lo = l[j];
    }
    const rsv = hi === lo ? 50 : ((c[i] - lo) / (hi - lo)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    K[i] = k;
    D[i] = d;
  }
  return { k: K, d: D };
}

/** 布林通道（母體標準差）。 */
export function boll(c, n = 20, mult = 2) {
  const mid = sma(c, n);
  const up = new Array(c.length).fill(null);
  const lo = new Array(c.length).fill(null);
  for (let i = n - 1; i < c.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    up[i] = mid[i] + mult * sd;
    lo[i] = mid[i] - mult * sd;
  }
  return { u: up, m: mid, l: lo };
}

/** 以 from 位置為基準的報酬率（%），用於多檔比較疊圖。 */
export function normalize(a, from = 0) {
  const base = a[from];
  return a.map((v, i) => (i < from || v == null || !base ? null : (v / base - 1) * 100));
}

/** 年化波動率（%）：最近 n 日對數報酬標準差。 */
export function volatility(c, n = 20) {
  const r = [];
  for (let i = Math.max(1, c.length - n); i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  if (r.length < 5) return null;
  const m = r.reduce((x, y) => x + y, 0) / r.length;
  const v = r.reduce((x, y) => x + (y - m) ** 2, 0) / r.length;
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

export const last = (a) => {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i];
  return null;
};
