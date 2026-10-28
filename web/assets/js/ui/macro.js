// 總經：FRED 指標 + 唯一使用 AI 的地方（Gemini 總經摘要）。

import { html } from '../lib/html.js';
import { num, signed, cls, stamp } from '../lib/fmt.js';
import { act } from '../lib/actions.js';
import * as api from '../lib/api.js';
import { head, empty } from './components.js';
import { spark } from '../charts/mini.js';
import { ctx } from './ctx.js';

const ui = { arch: null, open: false };

function cell(m) {
  const d = m.value != null && m.prev != null ? m.value - m.prev : null;
  const h = (m.hist || []).map((x) => x[1]);
  return html`<div class="mcell">
    <div class="mcell__n">${m.name}</div>
    <div class="mcell__v num">${num(m.value, 2)}<small>${m.unit || ''}</small></div>
    <div class="mcell__s">較前期 <span class="${cls(d)}">${d == null ? '—' : signed(d, 2)}</span>　資料月份 ${(m.date || '').slice(0, 7)}</div>
    ${spark(h, { w: 160, h: 34 })}
  </div>`;
}

function report(ai, ix) {
  if (!ai) return html`${head('AI 總經摘要')}${empty('尚未產生摘要', '需要在專案設定 FRED_API_KEY 與 GEMINI_API_KEY 兩個 Secret；沒有設定時其他功能不受影響。')}`;
  return html`
    ${head('AI 總經摘要', ai.generated_at ? `產生於 ${stamp(ai.generated_at)}` : '', html`<span class="tag">AI 產生</span>`)}
    <div class="ai">
      <h3 class="ai__head">${ai.headline}</h3>
      <p class="ai__sum">${ai.summary}</p>
      ${ai.sections?.length ? html`<div class="ai__secs">${ai.sections.map((s) => html`<div class="ai__sec"><b>${s.title}</b>${s.text}</div>`)}</div>` : ''}
      ${ai.watch?.length || ai.risks?.length ? html`<div class="ai__lists">
        ${ai.watch?.length ? html`<div class="ai__sec"><b>接下來要看</b><ul>${ai.watch.map((w) => html`<li>${w}</li>`)}</ul></div>` : ''}
        ${ai.risks?.length ? html`<div class="ai__sec"><b>風險</b><ul>${ai.risks.map((w) => html`<li>${w}</li>`)}</ul></div>` : ''}
      </div>` : ''}
      <p class="ai__foot">由 ${ai.model || 'Gemini'} 根據下方 FRED 指標與市場報價整理${ai.data_date ? `，資料截至 ${ai.data_date.slice(0, 7)}` : ''}。可能有誤，僅供參考，不構成投資建議。網站其他區塊（新聞、訊號、排行）都不使用 AI。</p>
    </div>`;
}

function archive() {
  const a = ui.arch;
  return html`<details class="arch" ${ui.open ? 'open' : ''}>
    <summary data-act="arch-toggle">過去的摘要</summary>
    ${a === 'loading' ? html`<div class="empty">載入中…</div>` : Array.isArray(a) ? (a.length ? a.slice(0, 20).map((x) => html`<div class="arch__i"><b>${x.headline}</b> <span class="arch__d">${stamp(x.generated_at)}</span><div class="mute">${x.summary}</div></div>`) : empty('還沒有歷史摘要')) : ''}
  </details>`;
}

export function render(ix) {
  return html`
    <section class="sec--first">${report(ix.ai, ix)}${archive()}</section>
    <section class="sec">
      ${head('總體經濟指標', '美國 FRED 資料，月度資料公布時間較晚')}
      ${ix.macro?.length ? html`<div class="mgrid">${ix.macro.map(cell)}</div>` : empty('尚未設定總經資料', '在專案的 Secrets 加上 FRED_API_KEY（免費申請）後，下次更新會自動出現。')}
    </section>`;
}

export function bind() {
  act('arch-toggle', async (el, e) => {
    e.preventDefault();
    ui.open = !ui.open;
    if (ui.open && ui.arch == null) {
      ui.arch = 'loading';
      ctx.rerender();
      try { ui.arch = await api.loadMacroHistory(); } catch { ui.arch = []; }
    }
    ctx.rerender();
  });
}
