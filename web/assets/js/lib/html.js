// 以標籤樣板產生 HTML：所有插入的值預設會被跳脫，只有 html`` 的結果（Safe）與 raw() 不會。
// 這讓「忘了跳脫」成為不可能的錯誤，是這個專案防 XSS 的主要手段。

export class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Safe(String(s ?? ''));

function part(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
}

/** 只允許 http(s) 外部連結，其餘一律換成 '#'。 */
export function safeUrl(u) {
  const s = String(u ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return '#';
  try {
    return new URL(s).href;
  } catch {
    return '#';
  }
}
