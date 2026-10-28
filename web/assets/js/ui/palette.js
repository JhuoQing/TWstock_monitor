// 搜尋／指令面板（Ctrl/⌘ + K 或 /）：找股票、跳頁、切換設定。也用在「新增比較」。

import { html } from '../lib/html.js';
import { price, pct, cls } from '../lib/fmt.js';
import { D, resolve, search } from '../lib/app.js';
import { act, onInput } from '../lib/actions.js';
import { go } from '../lib/router.js';
import * as store from '../lib/store.js';
import * as layers from './layers.js';
import * as detail from './detail.js';
import { ctx } from './ctx.js';

const P = { mode: 'go', items: [], sel: 0 };
const $ = (id) => document.getElementById(id);

const COMMANDS = () => [
  { label: '總覽', run: () => go({ view: 'overview' }), kw: 'overview home 首頁' },
  { label: '市場 · 類股熱力圖', run: () => go({ view: 'market', sub: 'heat' }), kw: 'heatmap 熱力圖 類股' },
  { label: '市場 · 排行榜', run: () => go({ view: 'market', sub: 'rank' }), kw: 'rank 排行 漲幅 成交' },
  { label: '市場 · 籌碼', run: () => go({ view: 'market', sub: 'chips' }), kw: 'chips 法人 融資 期貨 籌碼' },
  { label: '市場 · 事件', run: () => go({ view: 'market', sub: 'events' }), kw: 'events 除權息 注意 處置' },
  { label: '市場 · 國際行情', run: () => go({ view: 'market', sub: 'global' }), kw: 'global 美股 匯率 國際' },
  { label: '自選股、持股與警示', run: () => go({ view: 'mine' }), kw: 'watchlist 自選 持股 警示' },
  { label: '新聞', run: () => go({ view: 'news' }), kw: 'news 新聞' },
  { label: '總體經濟', run: () => go({ view: 'macro' }), kw: 'macro 總經 fed 利率' },
  { label: '設定', run: () => ctx.openDialog('settings'), kw: 'settings 設定 主題' },
  { label: '資料來源狀態', run: () => ctx.openDialog('status'), kw: 'status 狀態 資料 更新' },
  {
    label: '切換深色／淺色',
    run: () => store.setSetting('theme', document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'),
    kw: 'theme dark light 主題 深色 淺色',
  },
  {
    label: '切換漲跌顏色（紅漲綠跌／綠漲紅跌）',
    run: () => store.setSetting('ud', store.settings().ud === 'tw' ? 'intl' : 'tw'),
    kw: 'color 顏色 紅漲 綠漲',
  },
];

function compute(q) {
  const query = q.trim();
  const items = [];
  if (!query) {
    const recent = store.get().recent.map(resolve).filter(Boolean).filter((r) => P.mode !== 'compare' || r.tracked);
    const watch = P.mode === 'go' ? store.get().watch.map(resolve).filter(Boolean) : [];
    const seen = new Set();
    for (const r of recent) if (!seen.has(r.key)) { seen.add(r.key); items.push({ group: '最近瀏覽', r }); }
    for (const r of watch.slice(0, 6)) if (!seen.has(r.key)) { seen.add(r.key); items.push({ group: '自選股', r }); }
    if (P.mode === 'go') for (const c of COMMANDS().slice(0, 9)) items.push({ group: '前往', cmd: c });
    return items;
  }
  let stocks = search(query, 14);
  if (P.mode === 'compare') stocks = stocks.filter((r) => r.tracked);
  for (const r of stocks) items.push({ group: '股票', r });
  if (P.mode === 'go') {
    const k = query.toLowerCase();
    for (const c of COMMANDS()) if (c.label.toLowerCase().includes(k) || c.kw.toLowerCase().includes(k)) items.push({ group: '功能', cmd: c });
  }
  return items;
}

function paint() {
  const list = $('pal-list');
  let last = '';
  const out = P.items.map((it, i) => {
    const head = it.group !== last ? html`<div class="pal__grp" role="presentation">${it.group}</div>` : '';
    last = it.group;
    const sel = i === P.sel;
    if (it.r) {
      const r = it.r;
      return html`${head}<button type="button" class="pal__i" role="option" id="pal-o-${i}" aria-selected="${String(sel)}" data-act="pal-pick" data-i="${i}" tabindex="-1"><span>${r.name}<small>${r.code}${r.tracked ? '' : ' · 僅當日'}</small></span><span class="num">${price(r.price)}</span><span class="${cls(r.pct)}">${pct(r.pct)}</span></button>`;
    }
    return html`${head}<button type="button" class="pal__i" role="option" id="pal-o-${i}" aria-selected="${String(sel)}" data-act="pal-pick" data-i="${i}" tabindex="-1"><span>${it.cmd.label}</span><span></span><span></span></button>`;
  });
  list.innerHTML = String(out.length ? html`${out}` : html`<div class="empty"><b>找不到相符的結果</b>試試股票代號（2330）或名稱的一部分。</div>`);
  const inp = $('pal-in');
  if (P.items.length) inp.setAttribute('aria-activedescendant', `pal-o-${P.sel}`);
  else inp.removeAttribute('aria-activedescendant');
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function pick(i) {
  const it = P.items[i];
  if (!it) return;
  const mode = P.mode;
  layers.close('pal');
  if (it.r) {
    if (mode === 'compare') detail.addCompare(it.r.key);
    else go({ sym: it.r.key });
  } else it.cmd.run();
}

export function openPalette({ mode = 'go' } = {}) {
  P.mode = mode;
  const inp = $('pal-in');
  inp.value = '';
  inp.placeholder = mode === 'compare' ? '輸入要比較的追蹤標的（代號或名稱）' : '輸入代號或名稱，例如 2330、台積電';
  P.items = compute('');
  P.sel = 0;
  paint();
  layers.open('pal', { focus: '#pal-in' });
}

export function bind() {
  onInput('pal-q', (el) => {
    P.items = compute(el.value);
    P.sel = 0;
    paint();
  });
  act('pal-pick', (el) => pick(+el.dataset.i));
  act('palette', () => openPalette());
  $('pal-in').addEventListener('keydown', (e) => {
    const n = P.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); P.sel = n ? (P.sel + 1) % n : 0; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); P.sel = n ? (P.sel - 1 + n) % n : 0; paint(); }
    else if (e.key === 'Home') { e.preventDefault(); P.sel = 0; paint(); }
    else if (e.key === 'End') { e.preventDefault(); P.sel = Math.max(0, n - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(P.sel); }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (layers.isOpen('pal')) layers.close('pal');
      else openPalette();
    } else if (e.key === '/' && !typing && !layers.topId()) {
      e.preventDefault();
      openPalette();
    }
  });
}
