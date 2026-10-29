// 進入點：載入資料、路由、各頁面渲染、浮層與自動更新。

import { html } from './lib/html.js';
import { D, load, priceOf, resolve, startAutoRefresh, subscribe as onData, syncLiveTargets } from './lib/app.js';
import * as live from './lib/live.js';
import * as store from './lib/store.js';
import * as router from './lib/router.js';
import { install as installActions, act } from './lib/actions.js';
import { dur } from './lib/fmt.js';
import { failedSources, status as marketStatus } from './lib/market.js';
import { ctx } from './ui/ctx.js';
import * as layers from './ui/layers.js';
import * as shell from './ui/shell.js';
import * as overview from './ui/overview.js';
import * as market from './ui/market.js';
import * as mine from './ui/mine.js';
import * as news from './ui/news.js';
import * as macro from './ui/macro.js';
import * as detail from './ui/detail.js';
import * as palette from './ui/palette.js';
import * as dialogs from './ui/dialogs.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const TITLES = { overview: '總覽', market: '市場', mine: '自選', news: '新聞', macro: '總經' };

let base = { view: 'overview', sub: '' };
let cleanup = () => {};

function banners() {
  const ix = D.index;
  const out = [];
  if (ix?.sample) out.push(html`<p class="banner">目前顯示的是開發用的範例資料，不是真實行情。</p>`);
  if (ix) {
    const st = marketStatus(ix);
    if (st.stale) out.push(html`<p class="banner">資料已有一段時間沒有更新（已 ${dur(st.mins)}）。可能是排程暫停或來源異常，請參考<button type="button" class="link" data-act="status">資料狀態</button>。</p>`);
    const bad = failedSources(ix.sources);
    if (bad.length) out.push(html`<p class="banner">有 ${bad.length} 項資料來源暫時失效，相關區塊沿用舊資料。<button type="button" class="link" data-act="status">查看詳情</button></p>`);
  }
  return out;
}

function errorView() {
  return html`<div class="err" role="alert"><b>資料載入失敗</b>${D.error?.message || '無法連線'}。可能是網路暫時中斷，或網站資料尚未部署。<div style="margin-top:12px"><button type="button" class="btn btn--lamp" data-act="retry">重新載入</button></div></div>`;
}

function renderView() {
  cleanup();
  cleanup = () => {};
  if (!D.index) {
    if (D.error) view.innerHTML = String(errorView());
    return;
  }
  const ix = D.index;
  const { view: v, sub } = base;
  let body;
  if (v === 'market') body = market.render(ix, sub);
  else if (v === 'mine') body = mine.render(ix);
  else if (v === 'news') body = news.render(ix);
  else if (v === 'macro') body = macro.render(ix);
  else body = overview.render(ix);
  view.innerHTML = String(html`${banners()}${body}`);
  view.removeAttribute('aria-busy');
  if (v === 'market') cleanup = market.mount(view, ix, sub);
  else if (v === 'overview') cleanup = overview.mount(view, ix);
  shell.paintNav(v);
  document.title = `${TITLES[v]} | 台股夜盤`;
}

function chrome() {
  shell.paintStatus();
  shell.paintTape();
  dialogs.refresh();
}

function onRoute() {
  const r = router.parse(location.hash);
  // 舊版連結（#2330.TW）改寫成新格式，不新增歷史紀錄
  if (location.hash && !location.hash.startsWith('#/')) history.replaceState(null, '', router.href(r));
  if (r.sym) {
    if (!layers.isOpen('sheet')) layers.open('sheet', { onClose: onSheetClosed, focus: '[data-act="close-layer"]' });
    detail.show(r.sym);
    return;
  }
  if (layers.isOpen('sheet')) layers.close('sheet');
  const changed = r.view !== base.view || r.sub !== base.sub;
  base = r;
  renderView();
  if (changed) {
    window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  }
}

function onSheetClosed() {
  detail.hide();
  if (router.parse(location.hash).sym) router.go(base);
}

// ───────── 資料更新與警示 ─────────
function checkAlerts() {
  const hit = store.checkAlerts(priceOf);
  for (const h of hit) {
    const r = resolve(h.sym);
    const msg = `${r?.name ?? h.sym} 已${h.op === '>=' ? '漲到' : '跌到'} ${h.price}（警示 ${h.op === '>=' ? '≥' : '≤'} ${h.value}）`;
    shell.toast(msg, { label: '查看', run: () => router.go({ sym: h.sym }) });
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) new Notification('台股夜盤 價格警示', { body: msg });
    } catch { /* 部分環境不允許 */ }
  }
}

const typingInView = () => view.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);

function afterLoad() {
  chrome();
  if (!D.index) return renderView();
  if (!typingInView()) renderView();
  detail.repaint();
  live.start();
  checkAlerts();
}

/** 即時報價進來：只更新有價格的地方，不重建整頁（每 15 秒重畫會打斷閱讀與輸入）。 */
function onLive() {
  shell.paintStatus();
  shell.paintTape();
  if (D.index) {
    if (base.view === 'overview') overview.paintLive(view);
    // 自選頁整頁都是報價，直接重畫；使用者正在輸入時先跳過，下一輪再更新
    else if (base.view === 'mine' && !typingInView()) renderView();
  }
  detail.repaint();
  checkAlerts();
}

async function refresh() {
  await load();
  afterLoad();
}

// ───────── 啟動 ─────────
ctx.rerender = renderView;
ctx.toast = shell.toast;
ctx.openDialog = dialogs.openDialog;
ctx.closeLayer = () => layers.closeTop();
ctx.openPalette = palette.openPalette;

layers.install();
installActions();
market.bind();
mine.bind();
news.bind();
macro.bind();
detail.bind();
palette.bind();
dialogs.bind();

act('close-layer', () => layers.closeTop());
act('retry', refresh);
act('hero-range', (el) => {
  overview.setRange(+el.dataset.n);
  el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
});

store.subscribe(() => {
  shell.applySettings();
  // 自選股變動會改變要追的即時標的
  if (syncLiveTargets()) live.start();
  // 自選股／警示變動時，目前頁面可能需要更新（個股視窗另行局部更新）
  if (base.view === 'mine') renderView();
});

onData(() => shell.paintStatus());
live.subscribe(onLive);

shell.applySettings();
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => shell.applySettings());
shell.paintFooter();
window.addEventListener('hashchange', onRoute);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (Date.now() - D.loadedAt > 5 * 60000 && store.settings().refresh) refresh();
  live.start(); // 回到前景立刻補抓一次（背景時不輪詢）
});
setInterval(shell.paintStatus, 60000);
// 盤前開著頁面時，到了開盤時間要自己啟動
setInterval(() => live.start(), 60000);

(async () => {
  const r = router.parse(location.hash);
  if (!r.sym) base = r;
  live.configure({ enabled: store.settings().live });
  await load();
  chrome();
  renderView();
  if (r.sym) onRoute();
  startAutoRefresh(afterLoad);
  live.start();
  checkAlerts();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
