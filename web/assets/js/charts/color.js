// 解析 CSS 顏色字串（#rgb、#rrggbb、rgb()、rgba()）並產生帶透明度的顏色。供 Canvas 繪圖用。

export function parseColor(str) {
  const s = String(str || '').trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (m) {
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!Number.isFinite(a)) a = 1;
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), a];
  }
  return [128, 128, 128, 1];
}

/** 以指定透明度（乘上原本的透明度）回傳 rgba 字串。 */
export function alpha(color, a) {
  const [r, g, b, o] = parseColor(color);
  return `rgba(${r},${g},${b},${+(o * a).toFixed(3)})`;
}

/** 兩色線性混合，t=0 為 a、t=1 為 b。 */
export function mix(a, b, t) {
  const x = parseColor(a);
  const y = parseColor(b);
  const f = (i) => Math.round(x[i] + (y[i] - x[i]) * t);
  return `rgb(${f(0)},${f(1)},${f(2)})`;
}
