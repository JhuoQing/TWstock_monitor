// 對話框：設定（主題、顏色慣例、備份）與資料來源狀態。

import { html } from '../lib/html.js';
import { ago, stamp } from '../lib/fmt.js';
import { D, load } from '../lib/app.js';
import { act, onInput, onSubmit } from '../lib/actions.js';
import { SOURCE_LABEL, status as marketStatus } from '../lib/market.js';
import * as store from '../lib/store.js';
import { WORKER_URL, forceUpdate } from '../lib/admin.js';
import { loadIndex } from '../lib/api.js';
import * as layers from './layers.js';
import { ctx } from './ctx.js';

const $ = (id) => document.getElementById(id);
let current = null;
let armedClear = false;
let forcing = false;

function seg(label, name, options, value) {
  return html`<div class="row"><div>${label}</div><div class="seg" role="group" aria-label="${label}">${options.map(([v, n]) => html`<button type="button" data-act="set" data-name="${name}" data-v="${v}" aria-pressed="${String(String(value) === v)}">${n}</button>`)}</div></div>`;
}

function settingsHtml() {
  const s = store.settings();
  const g = store.get();
  return html`
    <h2>設定</h2>
    ${seg('外觀', 'theme', [['auto', '跟隨系統'], ['dark', '夜間'], ['light', '晨霧']], s.theme)}
    ${seg('漲跌顏色', 'ud', [['tw', '紅漲綠跌'], ['intl', '綠漲紅跌']], s.ud)}
    <div class="row"><label for="set-refresh"><div>自動更新</div><small>開著頁面時每 5 分鐘重新讀取資料</small></label><input type="checkbox" id="set-refresh" data-change="set-refresh" ${s.refresh ? 'checked' : ''}></div>
    <div class="row"><div><div>備份</div><small>自選 ${g.watch.length} 檔、持股 ${g.holdings.length} 筆、警示 ${g.alerts.length} 則，只存在這個瀏覽器</small></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="btn btn--sm" data-act="export">匯出</button><label class="btn btn--sm" for="import-file" style="cursor:pointer">匯入</label><input type="file" id="import-file" accept="application/json,.json" class="sr" data-change="import-file"></div></div>
    <div class="row"><div><div>清除本機資料</div><small>刪除自選、持股、警示與設定</small></div><button type="button" class="btn btn--sm" data-act="clear">${armedClear ? '再按一次確認' : '清除'}</button></div>
    <div class="row"><div><div>快速鍵</div><small><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> 或 <kbd>/</kbd> 搜尋　<kbd>Esc</kbd> 關閉視窗</small></div></div>
    <div class="foot"><button type="button" class="btn btn--lamp" data-act="close-layer">完成</button></div>`;
}

function statusHtml() {
  const ix = D.index;
  if (!ix) return html`<h2>資料狀態</h2><div class="empty">資料還沒載入。</div><div class="foot"><button type="button" class="btn" data-act="close-layer">關閉</button></div>`;
  const st = marketStatus(ix);
  const src = Object.entries(ix.sources || {});
  return html`
    <h2>資料狀態</h2>
    <p class="mute" style="margin:0 0 8px">資料日期 ${ix.trade_date}；最後更新 ${stamp(ix.updated_at)}（${ago(ix.updated_at)}）。${st.stale ? ' 資料已過期，可能是排程暫停或來源異常。' : ''}</p>
    ${ix.sample ? html`<p class="banner">目前顯示的是開發用的範例資料，不是真實行情。</p>` : ''}
    ${src.map(([k, v]) => html`<div class="src"><span class="${v.ok ? 'flat' : 'up'}" aria-hidden="true">${v.ok ? '●' : '▲'}</span><span>${SOURCE_LABEL[k] || k}${v.got != null ? html`<small>　${v.got}/${v.total} 檔</small>` : ''}${!v.ok && v.error ? html`<small>　${v.error}</small>` : ''}</span><small>${v.ok ? '正常' : '失敗，沿用舊資料'}</small></div>`)}
    ${WORKER_URL ? html`<form class="row" data-submit="force-update" style="gap:8px;flex-wrap:wrap;margin-top:12px"><label for="adm-pw" style="flex:1 1 100%"><div>強制更新（管理員）</div><small>輸入管理密碼後，立即觸發一次資料更新，約 2 分鐘完成</small></label><input id="adm-pw" name="password" type="password" autocomplete="current-password" placeholder="管理密碼" style="flex:1 1 160px" required><button type="submit" class="btn btn--sm" ${forcing ? 'disabled' : ''}>${forcing ? '更新中…' : '強制更新'}</button></form>` : ''}
    <p class="note" style="margin-top:12px">免費來源可能延遲或暫時失效；失敗的項目會沿用上一次成功的資料並標示「舊資料」。價格並非即時，請以券商報價為準。</p>
    <div class="foot"><button type="button" class="btn" data-act="refresh">立即重新讀取</button><button type="button" class="btn btn--lamp" data-act="close-layer">關閉</button></div>`;
}

function paint() {
  const prev = document.activeElement;
  const key = prev?.dataset?.name ? `[data-name="${prev.dataset.name}"][data-v="${prev.dataset.v}"]` : prev?.dataset?.act ? `[data-act="${prev.dataset.act}"]` : prev?.id ? `#${prev.id}` : null;
  $('dlg').innerHTML = String(current === 'settings' ? settingsHtml() : statusHtml());
  if (key) $('dlg').querySelector(key)?.focus({ preventScroll: true });
}

export function openDialog(name) {
  current = name;
  armedClear = false;
  $('dlg').setAttribute('aria-label', name === 'settings' ? '設定' : '資料狀態');
  paint();
  layers.open('dlg', { onClose: () => { current = null; } });
}

export function refresh() {
  if (current) paint();
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bind() {
  act('settings', () => openDialog('settings'));
  act('status', () => openDialog('status'));
  act('set', (el) => { store.setSetting(el.dataset.name, el.dataset.v); paint(); });
  onInput('set-refresh', (el) => { store.setSetting('refresh', el.checked); });
  act('export', () => { download(`twstock-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson()); ctx.toast('已匯出備份檔'); });
  onInput('import-file', async (el) => {
    const f = el.files?.[0];
    if (!f) return;
    if (f.size > 1_000_000) return ctx.toast('檔案太大，不像是備份檔');
    const res = store.importJson(await f.text());
    el.value = '';
    ctx.toast(res.ok ? `已匯入：自選 ${res.watch} 檔、持股 ${res.holdings} 筆、警示 ${res.alerts} 則` : res.error);
    ctx.rerender();
    paint();
  });
  act('clear', () => {
    if (!armedClear) { armedClear = true; paint(); return; }
    store.clearAll();
    armedClear = false;
    ctx.toast('已清除本機資料');
    ctx.rerender();
    paint();
  });
  onSubmit('force-update', async (form) => {
    if (forcing) return;
    const pw = form.elements.password.value;
    form.elements.password.value = '';
    forcing = true;
    paint();
    const r = await forceUpdate(pw);
    if (!r.ok) {
      forcing = false;
      paint();
      return ctx.toast(r.error);
    }
    ctx.toast('已觸發更新，約 2 分鐘後完成');
    const before = D.index?.updated_at;
    const t0 = Date.now();
    // 每 15 秒看一次 index.json，更新時間變了就重新載入畫面（最多等 6 分鐘）
    const timer = setInterval(async () => {
      try {
        const ix = await loadIndex();
        if (ix?.updated_at && ix.updated_at !== before) {
          clearInterval(timer);
          forcing = false;
          await load();
          ctx.rerender();
          paint();
          ctx.toast('資料已更新');
        }
      } catch { /* 部署切換瞬間可能暫時失敗，下一輪再試 */ }
      if (Date.now() - t0 > 360000) { clearInterval(timer); forcing = false; paint(); ctx.toast('等待逾時，請稍後按「立即重新讀取」'); }
    }, 15000);
  });
  act('refresh', async () => {
    await load();
    ctx.rerender();
    paint();
    ctx.toast('已重新讀取');
  });
}
