// 新聞：規則式篩選（重點、關鍵詞偏多／偏空、主題、搜尋）。不使用 AI。

import { html } from '../lib/html.js';
import { act, onInput } from '../lib/actions.js';
import { head, newsList } from './components.js';
import { ctx } from './ctx.js';

const ui = { mode: 'all', tag: '', q: '' };
const MODES = [['all', '全部'], ['important', '重點'], ['up', '關鍵詞偏多'], ['down', '關鍵詞偏空']];

export function filter(items, { mode, tag, q }) {
  const k = q.trim().toLowerCase();
  return items.filter((n) => (mode === 'all' ? true : mode === 'important' ? n.important : n.tone === mode) && (!tag || (n.tags || []).includes(tag)) && (!k || n.title.toLowerCase().includes(k) || (n.source || '').toLowerCase().includes(k)));
}

export function render(ix) {
  const all = [...(ix.news || [])].sort((a, b) => Number(b.important) - Number(a.important) || new Date(b.time) - new Date(a.time));
  const count = {};
  for (const n of all) for (const t of n.tags || []) count[t] = (count[t] || 0) + 1;
  const tags = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const list = filter(all, ui);
  return html`
    <section class="sec--first" style="max-width:860px">
      ${head('財經新聞', `${list.length} / ${all.length} 則`, html`<span class="mute">依標題關鍵字整理，不使用 AI</span>`)}
      <div class="form">
        <span class="seg" role="group" aria-label="新聞篩選">${MODES.map(([k, n]) => html`<button type="button" data-act="news-mode" data-v="${k}" aria-pressed="${String(ui.mode === k)}">${n}</button>`)}</span>
        <input class="field" type="search" id="news-q" placeholder="搜尋標題或來源" aria-label="搜尋新聞" value="${ui.q}" data-input="news-q" style="flex:1;min-width:160px;max-width:300px">
      </div>
      ${tags.length ? html`<div class="chips" role="group" aria-label="主題">${tags.map((t) => html`<button type="button" class="tag" data-act="news-tag" data-v="${t}" aria-pressed="${String(ui.tag === t)}">${t} ${count[t]}</button>`)}</div>` : ''}
      ${newsList(list)}
      <p class="note">「關鍵詞判讀」是用標題中的字詞（如「大漲」「重挫」）粗略判斷，可能出錯，只供瀏覽參考，不構成投資建議。</p>
    </section>`;
}

export function bind() {
  act('news-mode', (el) => { ui.mode = el.dataset.v; ctx.rerender(); });
  act('news-tag', (el) => { ui.tag = ui.tag === el.dataset.v ? '' : el.dataset.v; ctx.rerender(); });
  onInput('news-q', (el) => {
    ui.q = el.value;
    const pos = el.selectionStart;
    ctx.rerender();
    const n = document.getElementById('news-q');
    if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  });
}
