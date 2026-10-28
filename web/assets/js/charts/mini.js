// 小型 SVG 圖：走勢線、柱狀、漲跌家數條。顏色一律用 currentColor / CSS class，
// 所以切換日夜主題或「紅漲綠跌」慣例時不需要重畫。

import { html, raw } from '../lib/html.js';

const f1 = (n) => (+n).toFixed(1);

export function spark(values, { w = 84, h = 26, fill = true } = {}) {
  const a = (values || []).filter((v) => v != null);
  if (a.length < 2) return html`<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const mn = Math.min(...a);
  const mx = Math.max(...a);
  const r = mx - mn || 1;
  const pts = a.map((v, i) => [(i / (a.length - 1)) * w, h - 3 - ((v - mn) / r) * (h - 6)]);
  const line = pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ');
  return html`<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${fill ? raw(`<polygon points="0,${h} ${line} ${w},${h}" fill="currentColor" opacity=".12"/>`) : ''}<polyline points="${line}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

/** 以 0 為基準的柱狀圖（正值用 up 色、負值用 down 色）。 */
export function columns(values, { w = 140, h = 36 } = {}) {
  const a = values || [];
  if (!a.length) return html`<svg class="cols" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const m = Math.max(1e-9, ...a.map((v) => Math.abs(v ?? 0)));
  const bw = w / a.length;
  const mid = h / 2;
  const bars = a.map((v, i) => {
    if (v == null) return '';
    const bh = Math.max(0.8, (Math.abs(v) / m) * (mid - 1));
    const y = v >= 0 ? mid - bh : mid;
    return `<rect x="${f1(i * bw + 0.5)}" y="${f1(y)}" width="${f1(Math.max(1, bw - 1))}" height="${f1(bh)}" class="${v >= 0 ? 'f-up' : 'f-down'}"/>`;
  });
  return html`<svg class="cols" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${mid}" y2="${mid}" class="axis"/>${raw(bars.join(''))}</svg>`;
}

/** 由 0 起算的單色柱狀（例如成交金額）。 */
export function volumeBars(values, { w = 140, h = 36 } = {}) {
  const a = values || [];
  if (!a.length) return html`<svg class="cols" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const m = Math.max(1e-9, ...a.map((v) => v ?? 0));
  const bw = w / a.length;
  const bars = a.map((v, i) => {
    const bh = Math.max(0.8, ((v ?? 0) / m) * (h - 2));
    const last = i === a.length - 1;
    return `<rect x="${f1(i * bw + 0.5)}" y="${f1(h - bh)}" width="${f1(Math.max(1, bw - 1))}" height="${f1(bh)}" class="${last ? 'f-lamp' : 'f-faint'}"/>`;
  });
  return html`<svg class="cols" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${raw(bars.join(''))}</svg>`;
}

/** 漲／平／跌家數的橫條。 */
export function breadthBar(up, flat, down) {
  const t = Math.max(1, up + flat + down);
  const p = (n) => ((n / t) * 100).toFixed(2);
  return html`<div class="breadth" role="img" aria-label="上漲 ${up} 家、持平 ${flat} 家、下跌 ${down} 家"><i class="b-up" style="width:${p(up)}%"></i><i class="b-flat" style="width:${p(flat)}%"></i><i class="b-down" style="width:${p(down)}%"></i></div>`;
}
