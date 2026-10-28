// 自選：自選股清單、持股損益試算、價格警示。所有資料只存在本機瀏覽器。

import { html } from '../lib/html.js';
import { num, int, pct, signed, cls, price, stamp } from '../lib/fmt.js';
import { D, resolve, rows, search } from '../lib/app.js';
import { act, onSubmit } from '../lib/actions.js';
import * as store from '../lib/store.js';
import { head, empty, link } from './components.js';
import { spark } from '../charts/mini.js';
import { ctx } from './ctx.js';

const SUGGEST = ['2330.TW', '2317.TW', '2454.TW', '0050.TW', '2881.TW', '2603.TW'];

function pick(q) {
  const r = search(q, 1)[0];
  if (!r) ctx.toast(`找不到「${q}」，請輸入股票代號或名稱`);
  return r;
}

function watchSection() {
  const keys = store.get().watch;
  const list = rows(keys);
  return html`
    <section class="sec--first">
      ${head('自選股', keys.length ? `${keys.length} 檔` : '', html`<button type="button" class="link" data-act="palette">搜尋並加入</button>`)}
      <form class="form" data-submit="watch-add"><input class="field" name="q" placeholder="輸入代號或名稱，例如 2330" aria-label="加入自選股" autocomplete="off" required><button class="btn btn--lamp" type="submit">加入自選</button></form>
      ${list.length ? html`<div class="tbl__scroll"><table class="tbl"><thead><tr><th>個股</th><th>走勢</th><th>價格</th><th>漲跌幅</th><th><span class="sr">操作</span></th></tr></thead><tbody>
        ${list.map((r, i) => html`<tr><td class="nm"><a href="${link(r.key)}" style="text-decoration:none">${r.name}<small>${r.code}</small></a>${r.tracked === false ? html` <span class="tag" title="只有當日報價，沒有歷史走勢">僅當日</span>` : ''}</td>
          <td style="width:90px"><span class="${cls(r.pct)}">${r.quote?.spark ? spark(r.quote.spark.slice(-30)) : ''}</span></td>
          <td class="num">${price(r.price)}</td><td class="${cls(r.pct)}">${pct(r.pct)}</td>
          <td class="acts"><button type="button" class="btn btn--sm" data-act="watch-move" data-k="${r.key}" data-d="-1" aria-label="上移 ${r.name}" ${i === 0 ? 'disabled' : ''}>↑</button> <button type="button" class="btn btn--sm" data-act="watch-move" data-k="${r.key}" data-d="1" aria-label="下移 ${r.name}" ${i === list.length - 1 ? 'disabled' : ''}>↓</button> <button type="button" class="btn btn--sm" data-act="watch-rm" data-k="${r.key}" aria-label="移除 ${r.name}">移除</button></td></tr>`)}
      </tbody></table></div>`
      : html`<div class="empty"><b>還沒有自選股</b>輸入代號加入，或從常見標的開始：<div class="chips" style="margin-top:10px">${SUGGEST.filter((k) => D.bySymbol.has(k)).map((k) => html`<button type="button" class="tag" data-act="watch-add-key" data-k="${k}">+ ${D.bySymbol.get(k).name}</button>`)}</div></div>`}
    </section>`;
}

function holdSection() {
  const hs = store.get().holdings;
  const calc = hs.map((h) => {
    const r = resolve(h.sym);
    const px = r?.price;
    const cost = h.shares * h.cost;
    const val = px != null ? h.shares * px : null;
    return { h, r, px, cost, val, pl: val != null ? val - cost : null, ret: val != null && cost ? (val / cost - 1) * 100 : null };
  });
  const ok = calc.filter((c) => c.val != null);
  const tv = ok.reduce((s, c) => s + c.val, 0);
  const tc = ok.reduce((s, c) => s + c.cost, 0);
  const pl = tv - tc;
  return html`
    <section class="sec">
      ${head('持股損益試算', '只存在你的瀏覽器，不會上傳；未計手續費與證交稅')}
      <form class="form" data-submit="hold-set">
        <input class="field" name="q" placeholder="代號或名稱" aria-label="持股標的" autocomplete="off" required style="width:140px">
        <input class="field" name="shares" type="number" min="1" step="1" placeholder="股數" aria-label="持有股數" required style="width:110px">
        <input class="field" name="cost" type="number" min="0" step="any" placeholder="平均成本" aria-label="每股平均成本" required style="width:120px">
        <button class="btn btn--lamp" type="submit">儲存持股</button>
      </form>
      ${calc.length ? html`
        <div class="sum">
          <div><span class="n">總市值</span><span class="v">${num(tv, 0)}</span></div>
          <div><span class="n">總成本</span><span class="v">${num(tc, 0)}</span></div>
          <div><span class="n">未實現損益</span><span class="v ${cls(pl)}">${signed(pl, 0)}</span></div>
          <div><span class="n">報酬率</span><span class="v ${cls(pl)}">${tc ? pct((pl / tc) * 100) : '—'}</span></div>
        </div>
        ${tv > 0 ? html`<div class="alloc" role="img" aria-label="持股比重">${ok.map((c, i) => html`<i style="width:${((c.val / tv) * 100).toFixed(2)}%;background:color-mix(in srgb,var(--lamp) ${Math.max(25, 100 - i * 18)}%,var(--sil))" title="${c.r?.name} ${((c.val / tv) * 100).toFixed(1)}%"></i>`)}</div>` : ''}
        <div class="tbl__scroll"><table class="tbl"><thead><tr><th>個股</th><th>股數</th><th>成本</th><th>現價</th><th>市值</th><th>損益</th><th>報酬率</th><th><span class="sr">操作</span></th></tr></thead><tbody>
          ${calc.map((c) => html`<tr><td class="nm"><a href="${link(c.h.sym)}" style="text-decoration:none">${c.r?.name ?? c.h.sym}<small>${c.r?.code ?? ''}</small></a></td>
            <td>${int(c.h.shares)}</td><td class="num">${price(c.h.cost)}</td><td class="num">${price(c.px)}</td><td>${c.val != null ? num(c.val, 0) : '—'}</td>
            <td class="${cls(c.pl)}">${c.pl != null ? signed(c.pl, 0) : '—'}</td><td class="${cls(c.ret)}">${c.ret != null ? pct(c.ret) : '—'}</td>
            <td class="acts"><button type="button" class="btn btn--sm" data-act="hold-rm" data-k="${c.h.sym}" aria-label="刪除 ${c.r?.name ?? c.h.sym} 的持股">刪除</button></td></tr>`)}
        </tbody></table></div>
        <p class="note">要修改，直接用同一檔再儲存一次即可。現價為最近一次更新的收盤／即時資料，不是即時報價。</p>`
      : empty('尚未輸入持股', '輸入股數與平均成本，就能看到目前的未實現損益。')}
    </section>`;
}

function alertSection() {
  const al = store.get().alerts;
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  return html`
    <section class="sec">
      ${head('價格警示', '每次資料更新（約 5 分鐘）時在這個頁面檢查，觸發後只通知一次')}
      <form class="form" data-submit="alert-add">
        <input class="field" name="q" placeholder="代號或名稱" aria-label="警示標的" autocomplete="off" required style="width:140px">
        <select class="field" name="op" aria-label="條件"><option value=">=">價格 ≥</option><option value="<=">價格 ≤</option></select>
        <input class="field" name="value" type="number" min="0" step="any" placeholder="價位" aria-label="警示價位" required style="width:110px">
        <input class="field" name="note" maxlength="40" placeholder="備註（選填）" aria-label="備註" style="width:160px">
        <button class="btn btn--lamp" type="submit">新增警示</button>
      </form>
      ${al.length ? html`<div class="tbl__scroll"><table class="tbl"><thead><tr><th>個股</th><th>條件</th><th>目前價</th><th>狀態</th><th><span class="sr">操作</span></th></tr></thead><tbody>
        ${al.map((a) => html`<tr><td class="nm"><a href="${link(a.sym)}" style="text-decoration:none">${resolve(a.sym)?.name ?? a.sym}</a>${a.note ? html`<small>${a.note}</small>` : ''}</td>
          <td>${a.op === '>=' ? '≥' : '≤'} ${price(a.value)}</td><td class="num">${price(resolve(a.sym)?.price)}</td>
          <td>${a.on ? html`<span class="tag">監控中</span>` : html`<span class="tag tag--imp">已觸發 ${stamp(a.at)}</span>`}</td>
          <td class="acts">${a.on ? '' : html`<button type="button" class="btn btn--sm" data-act="alert-rearm" data-id="${a.id}">重新啟用</button> `}<button type="button" class="btn btn--sm" data-act="alert-rm" data-id="${a.id}" aria-label="刪除警示">刪除</button></td></tr>`)}
      </tbody></table></div>` : empty('還沒有警示', '例如「台積電 ≥ 1,000」，價格達到時會顯示提示。')}
      <p class="note" style="margin-top:10px">警示只在你開著這個頁面時檢查，頁面關閉就不會通知。想要手機推播，可改用專案的 Telegram 設定（見 README）。
        ${perm === 'default' ? html` <button type="button" class="link" data-act="notif">允許瀏覽器通知</button>` : perm === 'granted' ? ' 瀏覽器通知已開啟。' : perm === 'denied' ? ' 瀏覽器通知被封鎖，只會顯示頁面內提示。' : ''}</p>
    </section>`;
}

export const render = () => html`${watchSection()}${holdSection()}${alertSection()}`;

export function bind() {
  const add = (r) => {
    if (!r) return;
    if (store.inWatch(r.key)) return ctx.toast(`${r.name} 已經在自選股`);
    store.toggleWatch(r.key);
    ctx.toast(`已加入自選：${r.name}`);
    ctx.rerender();
  };
  onSubmit('watch-add', (f) => add(pick(new FormData(f).get('q'))));
  act('watch-add-key', (el) => add(resolve(el.dataset.k)));
  act('watch-rm', (el) => { store.toggleWatch(el.dataset.k); ctx.rerender(); });
  act('watch-move', (el) => { store.moveWatch(el.dataset.k, +el.dataset.d); ctx.rerender(); });
  onSubmit('hold-set', (f) => {
    const d = new FormData(f);
    const r = pick(d.get('q'));
    if (!r) return;
    if (!store.setHolding(r.key, +d.get('shares'), +d.get('cost'))) return ctx.toast('股數要大於 0，成本不可為負');
    ctx.toast(`已儲存持股：${r.name}`);
    ctx.rerender();
  });
  act('hold-rm', (el) => { store.removeHolding(el.dataset.k); ctx.rerender(); });
  onSubmit('alert-add', (f) => {
    const d = new FormData(f);
    const r = pick(d.get('q'));
    if (!r) return;
    if (!store.addAlert({ sym: r.key, op: d.get('op'), value: +d.get('value'), note: d.get('note') })) return ctx.toast('警示條件不完整');
    ctx.toast(`已新增警示：${r.name}`);
    ctx.rerender();
  });
  act('alert-rm', (el) => { store.removeAlert(el.dataset.id); ctx.rerender(); });
  act('alert-rearm', (el) => { store.rearmAlert(el.dataset.id); ctx.rerender(); });
  act('notif', async () => {
    try { await Notification.requestPermission(); } catch { /* 部分瀏覽器不支援 */ }
    ctx.rerender();
  });
}
