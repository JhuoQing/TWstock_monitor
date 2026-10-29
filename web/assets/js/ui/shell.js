// 外殼：主題套用、跑馬燈、頁首狀態燈、導覽高亮、頁尾、提示訊息。

import { html } from '../lib/html.js';
import { num, pct, cls, ago } from '../lib/fmt.js';
import { D, resolve } from '../lib/app.js';
import { status } from '../lib/market.js';
import * as live from '../lib/live.js';
import { link } from './components.js';
import * as store from '../lib/store.js';

const $ = (id) => document.getElementById(id);
const TAPE = ['^TWII', '2330.TW', '2317.TW', '2454.TW', '^GSPC', '^IXIC', '^SOX', 'TSM', 'TWD=X', '^N225', 'GC=F', 'BTC-USD'];

export function applySettings() {
  const s = store.settings();
  const root = document.documentElement;
  const theme = s.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : s.theme;
  root.dataset.theme = theme;
  root.dataset.ud = s.ud;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#dce5f1' : '#080b1c');
  window.dispatchEvent(new Event('themechange'));
}

export function paintTape() {
  const el = $('tape');
  const items = TAPE.filter((k) => D.bySymbol.has(k)).map((k) => resolve(k));
  if (!items.length) { el.hidden = true; return; }
  const one = (hidden) => html`<span class="tape__in-copy" ${hidden ? html`aria-hidden="true"` : ''} style="display:inline-flex;gap:34px;padding-right:34px">${items.map((q) => html`<a class="tape__i" href="${link(q.key)}" ${hidden ? html`tabindex="-1"` : ''}><b>${q.name}</b><span class="num">${num(q.price, q.price >= 100 ? 2 : 3)}</span><span class="${cls(q.pct)}">${pct(q.pct)}</span></a>`)}</span>`;
  el.hidden = false;
  el.innerHTML = String(html`<div class="tape__in">${one(false)}${one(true)}</div>`);
}

export function paintStatus() {
  const st = status(D.index, new Date(), live.info());
  const b = $('status');
  b.className = `status ${st.cls}`;
  $('status-t').textContent = D.loading && !D.index ? '載入中' : st.text;
  $('status-u').textContent = D.index ? `更新 ${ago(D.index.updated_at)}` : '';
  b.setAttribute('aria-label', `資料狀態：${st.text}${D.index ? `，更新於 ${ago(D.index.updated_at)}` : ''}`);
}

export function paintNav(view) {
  document.querySelectorAll('#nav .nav__a').forEach((a) => {
    if (a.dataset.nav === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

export function paintFooter() {
  $('foot').innerHTML = String(html`
    <p>資料來源：Yahoo Finance、臺灣證券交易所、證券櫃檯買賣中心、臺灣期貨交易所、Google News／Yahoo 新聞 RSS、美國聖路易聯邦準備銀行 FRED。僅整理公開資訊，可能延遲或有誤。</p>
    <p>盤中加權指數與台股個股為證交所即時行情（約 5–15 秒延遲），籌碼、排行與新聞等區塊依排程更新。</p>
    <p>本網站內容不構成投資建議，投資有風險，請自行判斷並以券商報價為準。總體經濟摘要由 AI 產生，其餘內容皆為規則式計算。</p>
    <p>你的自選股、持股與警示只存在這個瀏覽器，不會上傳到任何伺服器。</p>`);
}

export function toast(msg, action) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { action.run(); el.remove(); });
    el.append(b);
  }
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), action ? 8000 : 3600);
}
