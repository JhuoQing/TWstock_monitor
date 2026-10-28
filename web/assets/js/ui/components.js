// 共用的小元件。全部回傳 Safe（html``），可直接嵌進其他樣板。

import { html, raw, safeUrl } from '../lib/html.js';
import { num, pct, signed, cls, price, yi, ago, stamp } from '../lib/fmt.js';
import { href } from '../lib/router.js';
import { sigInfo } from '../lib/signals.js';
import { spark } from '../charts/mini.js';

export const link = (key) => href({ sym: key });

export const pctChip = (v) => html`<span class="chip ${cls(v)}">${pct(v)}</span>`;

export function head(title, sub = '', actions = '') {
  return html`<div class="sh"><h2>${title}</h2>${sub ? html`<span class="sh__sub">${sub}</span>` : ''}${actions ? html`<span class="sh__act">${actions}</span>` : ''}</div>`;
}

export function empty(title, text = '') {
  return html`<div class="empty"><b>${title}</b>${text}</div>`;
}

/** 報價列：名稱、走勢、價格、漲跌幅。r 來自 app.resolve()。 */
export function quoteRow(r, { withSpark = true } = {}) {
  const sp = withSpark && r.quote?.spark ? spark(r.quote.spark.slice(-30)) : '';
  const dir = cls(r.pct);
  return html`<a class="qrow ${withSpark ? '' : 'qrow--simple'}" href="${link(r.key)}">
    <span class="qrow__nm">${r.name}<small>${r.code}</small>${r.stale ? html` <span class="tag tag--stale">舊資料</span>` : ''}</span>
    ${withSpark ? html`<span class="${dir}">${sp}</span>` : ''}
    <span class="qrow__px num">${r.missing ? '—' : price(r.price)}</span>
    ${pctChip(r.pct)}
  </a>`;
}

/** 排行榜一列。metric：'value'（成交金額，億）或 'vol'（張）。 */
export function rankRow(i, x, { max = 0, metric = 'value' } = {}) {
  const w = max > 0 ? Math.min(100, ((metric === 'value' ? x.value : x.vol) / max) * 100) : 0;
  const m = metric === 'value' ? yi(x.value, 1) : `${num(Math.round(x.vol / 1000), 0)}`;
  return html`<a class="rk" href="${link(x.code)}">
    <i>${i + 1}</i>
    <span>${x.name}<small class="mute"> ${x.code}</small></span>
    <span class="r num">${price(x.close)}</span>
    <span class="r ${cls(x.pct)}">${pct(x.pct)}</span>
    <span class="r vcol num">${m}</span>
    ${w ? html`<b class="rk__bar" style="width:${w.toFixed(1)}%"></b>` : ''}
  </a>`;
}

export function sigTags(codes = []) {
  return codes.map((c) => {
    const s = sigInfo(c);
    return html`<span class="sig sig--${s.dir}" title="${s.hint}">${s.label}</span> `;
  });
}

const TONE = { up: '偏多', down: '偏空' };

export function newsItem(n, { compact = false } = {}) {
  const tone = TONE[n.tone];
  return html`<li class="ni ${n.important ? 'ni--imp' : ''}">
    <a href="${safeUrl(n.link)}" target="_blank" rel="noopener noreferrer">${n.title}</a>
    <div class="ni__m">
      ${n.important ? html`<span class="tag tag--imp">重點</span>` : ''}
      <span>${n.source}</span><time datetime="${n.time}" title="${stamp(n.time)}">${ago(n.time)}</time>
      ${compact ? '' : (n.tags || []).map((t) => html`<span class="tag">${t}</span>`)}
      ${tone ? html`<span class="tone tone--${n.tone}" title="依標題關鍵字判讀，僅供參考，不是投資建議">關鍵詞判讀：${tone}</span>` : ''}
      ${!compact && n.also?.length ? html`<span class="mute">另有 ${n.also.length} 則相似報導</span>` : ''}
    </div>
  </li>`;
}

export function newsList(items, opts = {}) {
  if (!items.length) return empty('沒有符合的新聞', '換個篩選條件試試。');
  return html`<ul class="nl ${opts.compact ? 'nl--compact' : ''}" style="list-style:none">${items.map((n) => newsItem(n, opts))}</ul>`;
}

/** 橫向的買賣超條：以 0 為中線，正值往右（紅）、負值往左（綠）。 */
export function netBar(v, max) {
  const w = max > 0 ? Math.min(50, (Math.abs(v) / max) * 50) : 0;
  const style = v >= 0 ? `left:50%;width:${w}%;background:var(--up)` : `left:${50 - w}%;width:${w}%;background:var(--down)`;
  return html`<div class="track" role="img" aria-label="${v >= 0 ? '買超' : '賣超'} ${yi(Math.abs(v))}"><i style="${style}"></i></div>`;
}

export const netCell = (v) => html`<span class="${cls(v)}">${signed(v, 1)}</span>`;

export const sourceNote = (text) => html`<p class="note" style="margin-top:8px">${raw(text)}</p>`;
