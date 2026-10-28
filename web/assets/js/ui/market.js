// 市場：熱力圖／排行／籌碼／事件／國際。

import { html } from '../lib/html.js';
import { num, int, pct, signed, cls, price, yi, lots, dateShort, clamp } from '../lib/fmt.js';
import { D, rows } from '../lib/app.js';
import { act } from '../lib/actions.js';
import { href, MARKET_SUBS } from '../lib/router.js';
import { layoutSectors } from '../lib/treemap.js';
import { head, empty, rankRow, quoteRow, link, netBar, pctChip } from './components.js';
import { columns, volumeBars } from '../charts/mini.js';
import { ctx } from './ctx.js';

const TABS = { heat: '熱力圖', rank: '排行', chips: '籌碼', events: '事件', global: '國際' };
const ui = { rank: 'stock', t86: 'total' };

const tabs = (sub) => html`<nav class="tabs" aria-label="市場分頁" style="margin:26px 0 4px">${MARKET_SUBS.map((s) => html`<a class="tab" href="${href({ view: 'market', sub: s })}" ${s === sub ? html`aria-current="page"` : ''}>${TABS[s]}</a>`)}</nav>`;

// ───────── 熱力圖 ─────────
function heat(ix) {
  const sec = [...(ix.sector_stats || [])].sort((a, b) => b.pct - a.pct);
  const maxAbs = Math.max(1, ...sec.map((s) => Math.abs(s.pct)));
  return html`
    <section class="sec--first">
      ${head('類股熱力圖', '面積 = 成交金額，顏色 = 漲跌幅（今日成交值前 120 檔）')}
      ${ix.heatmap?.length ? html`<div class="hm" id="hm" role="group" aria-label="類股熱力圖"></div>
        <div class="hm__legend"><span class="down">−4%</span><i class="hm__scale"></i><span class="up">+4%</span><span style="margin-left:auto">點選方塊開啟個股</span></div>`
      : empty('熱力圖資料尚未產生', '需要證交所行情與公司產業別兩項資料。')}
    </section>
    <section class="sec">
      ${head('類股強弱', '依成交值加權的平均漲跌幅')}
      ${sec.length ? sec.map((s) => html`<div class="sbar"><span>${s.name}</span>${netBar(s.pct, maxAbs)}<span class="${cls(s.pct)}" style="text-align:right">${pct(s.pct)}</span></div>`) : empty('沒有類股統計')}
    </section>`;
}

const heatColor = (p) => {
  const k = Math.round(clamp(Math.abs(p) / 4, 0, 1) * 82) + (p ? 6 : 0);
  return `color-mix(in srgb, var(--${p >= 0 ? 'up' : 'down'}) ${k}%, var(--cellbase))`;
};

function drawHeat(host, ix) {
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (!w || !h) return;
  const lay = layoutSectors(ix.heatmap, w, h);
  const px = (n) => `${n.toFixed(1)}px`;
  host.innerHTML = lay.map((s) => html`<div class="hm__sec" style="left:${px(s.x)};top:${px(s.y)};width:${px(s.w)};height:${px(s.h)}">${s.header ? html`<span class="hm__lbl">${s.sector.name}　${pct(s.sector.pct, 1)}</span>` : ''}</div>${s.cells.map((c) => {
    const st = c.item;
    const big = c.w > 52 && c.h > 34;
    return html`<a class="hm__c" href="${link(st.c)}" style="left:${px(c.x)};top:${px(c.y)};width:${px(c.w)};height:${px(c.h)};background:${heatColor(st.p)}" title="${st.n} ${st.c}　${price(st.x)}　${pct(st.p)}">${c.w > 30 && c.h > 20 ? html`<b>${st.n}</b>` : ''}${big ? pct(st.p, 1) : ''}</a>`;
  })}`).join('');
}

// ───────── 排行 ─────────
function rank(ix) {
  const r = ix.rankings?.[ui.rank];
  const kinds = [['stock', '上市個股'], ['etf', 'ETF'], ['otc', '上櫃']];
  const list = (title, arr, metric) => html`<div><div class="sh__sub" style="margin:0 0 4px;font-weight:700;color:var(--ink)">${title}</div>${arr?.length ? arr.slice(0, 10).map((x, i) => rankRow(i, x, { max: Math.max(...arr.map((y) => (metric === 'value' ? y.value : y.vol))), metric })) : empty('沒有資料')}</div>`;
  return html`
    <section class="sec--first">
      ${head('排行榜', ix.trade_date, html`<span class="seg" role="group" aria-label="排行範圍">${kinds.map(([k, n]) => html`<button type="button" data-act="rank-set" data-v="${k}" aria-pressed="${String(ui.rank === k)}">${n}</button>`)}</span>`)}
      ${r ? html`<div class="grid2" style="margin-top:14px">
        ${list('成交金額（億）', r.by_value, 'value')}${list('成交量（張）', r.by_volume, 'vol')}
        ${list('漲幅', r.gainers, 'value')}${list('跌幅', r.losers, 'value')}
      </div>` : empty('這個範圍目前沒有資料')}
    </section>`;
}

// ───────── 籌碼 ─────────
function chips(ix) {
  const h = ix.inst_hist || [];
  const sum = (key, n) => h.slice(-n).reduce((s, x) => s + (x[key] || 0), 0);
  const who = [['foreign', '外資及陸資'], ['trust', '投信'], ['dealer', '自營商']];
  const t86 = ix.t86?.[ui.t86];
  const m = ix.margin;
  const mh = ix.margin_hist || [];
  const fh = ix.futures_hist || [];
  const th = (ix.turnover_hist || []).slice(-30);
  return html`
    <section class="sec--first">
      ${head('三大法人買賣超', '近 30 個交易日，單位：億元')}
      ${h.length ? html`<div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-top:14px">
        ${who.map(([k, n]) => html`<div><div class="sh__sub">${n}</div><div class="num ${cls(h.at(-1)[k])}" style="font-size:26px">${signed(h.at(-1)[k], 1)}</div>${columns(h.slice(-30).map((x) => x[k]), { w: 240, h: 56 })}<div class="note">近 5 日 <span class="${cls(sum(k, 5))}">${signed(sum(k, 5), 1)}</span>　近 20 日 <span class="${cls(sum(k, 20))}">${signed(sum(k, 20), 1)}</span></div></div>`)}
      </div>` : empty('法人歷史資料累積中', '資料部署後每個交易日會累積一筆。')}
    </section>

    <section class="sec">
      ${head('個股買賣超排行', ix.t86?.date || '單位：張', html`<span class="seg" role="group" aria-label="法人別">${[['total', '三大法人'], ['foreign', '外資'], ['trust', '投信']].map(([k, n]) => html`<button type="button" data-act="t86-set" data-v="${k}" aria-pressed="${String(ui.t86 === k)}">${n}</button>`)}</span>`)}
      ${t86 ? html`<div class="grid2" style="margin-top:12px">
        <div><div class="sh__sub up" style="font-weight:700">買超</div>${t86.buy.slice(0, 10).map((x, i) => html`<a class="rk" href="${link(x.code)}"><i>${i + 1}</i><span>${x.name}<small class="mute"> ${x.code}</small></span><span class="r num">${price(x.close)}</span><span class="r ${cls(x.pct)}">${pct(x.pct)}</span><span class="r vcol up num">+${int(x.net)}</span></a>`)}</div>
        <div><div class="sh__sub down" style="font-weight:700">賣超</div>${t86.sell.slice(0, 10).map((x, i) => html`<a class="rk" href="${link(x.code)}"><i>${i + 1}</i><span>${x.name}<small class="mute"> ${x.code}</small></span><span class="r num">${price(x.close)}</span><span class="r ${cls(x.pct)}">${pct(x.pct)}</span><span class="r vcol down num">${int(x.net)}</span></a>`)}</div>
      </div>` : empty('個股法人資料尚未公布')}
    </section>

    <section class="sec">
      ${head('台指期與信用交易')}
      <div class="grid2" style="margin-top:12px">
        <div>
          <div class="sh__sub">外資台指期未平倉淨部位（口）</div>
          ${ix.futures?.rows?.length ? ix.futures.rows.map((r) => html`<div class="inst" style="grid-template-columns:100px 1fr 90px"><span>${r.name}</span><span></span><span class="v ${cls(r.net)}">${signed(r.net, 0)}</span></div>`) : empty('期貨資料尚未取得')}
          ${fh.length ? columns(fh.slice(-30).map((x) => x.foreign), { w: 240, h: 56 }) : ''}
        </div>
        <div>
          <div class="sh__sub">融資融券</div>
          ${m ? html`<div class="inst" style="grid-template-columns:100px 1fr 120px"><span>融資餘額</span><span class="mute">${yi(m.margin_amt?.bal)}</span><span class="v">${lots(m.margin?.bal)}</span></div>
            <div class="inst" style="grid-template-columns:100px 1fr 120px"><span>融資增減</span><span></span><span class="v ${cls(m.margin?.chg)}">${signed(m.margin?.chg, 0)} 張</span></div>
            <div class="inst" style="grid-template-columns:100px 1fr 120px"><span>融券餘額</span><span></span><span class="v">${lots(m.short?.bal)}</span></div>` : empty('融資融券資料尚未取得')}
          ${mh.length > 1 ? columns(mh.slice(-30).map((x, i, a) => (i ? x.margin_amt - a[i - 1].margin_amt : null)), { w: 240, h: 56 }) : ''}
          <div class="note">下方柱狀為融資金額的每日變化</div>
        </div>
      </div>
    </section>

    <section class="sec">
      ${head('成交金額', '近 30 個交易日，單位：億元')}
      ${th.length ? html`<div style="margin-top:12px">${volumeBars(th.map((x) => x.v), { w: 600, h: 70 })}<div class="note">${dateShort(th[0].d)} – ${dateShort(th.at(-1).d)}　最新 ${yi(th.at(-1).v)}</div></div>` : empty('成交金額歷史尚未取得')}
    </section>`;
}

// ───────── 事件 ─────────
function events(ix) {
  const dv = ix.dividends || [];
  const n = ix.notices || {};
  const noticeList = (title, arr) => html`<div><div class="sh__sub" style="font-weight:700;color:var(--ink)">${title}</div>${arr?.length ? arr.map((x) => html`<a class="qrow qrow--simple" href="${link(x.code)}" style="grid-template-columns:minmax(0,1fr) 90px"><span class="qrow__nm">${x.name}<small>${x.code}　${x.note || ''}</small></span><span class="qrow__px mute">${dateShort(x.date)}</span></a>`) : empty('目前沒有')}</div>`;
  return html`
    <section class="sec--first">
      ${head('除權息預告', '近期將除權息的個股')}
      ${dv.length ? html`<div class="tbl__scroll"><table class="tbl"><thead><tr><th>個股</th><th>日期</th><th>類型</th><th>現金股利</th><th>股票股利</th></tr></thead><tbody>
        ${dv.map((d) => html`<tr><td class="nm"><a href="${link(d.code)}" style="text-decoration:none">${d.name}<small>${d.code}</small></a></td><td>${d.date}</td><td>${d.type}</td><td>${d.cash != null ? num(d.cash, 2) : '—'}</td><td>${d.stock ? num(d.stock, 2) : '—'}</td></tr>`)}
      </tbody></table></div>` : empty('目前沒有預告')}
    </section>
    <section class="sec">
      ${head('注意與處置股票')}
      <div class="grid2" style="margin-top:12px">${noticeList('注意股票', n.attention)}${noticeList('處置股票', n.punish)}</div>
    </section>`;
}

// ───────── 國際 ─────────
function globalView() {
  const g = (grp) => rows(D.quotes.filter((q) => q.group === grp).map((q) => q.symbol));
  return html`
    <div class="grid2 sec--first">
      <section>${head('全球股市與波動')}${g('全球').map((r) => quoteRow(r))}</section>
      <section>${head('匯率、利率與商品')}${g('匯率商品').map((r) => quoteRow(r))}</section>
    </div>`;
}

export function render(ix, sub) {
  const body = { heat, rank, chips, events, global: globalView }[sub](ix);
  return html`${tabs(sub)}${body}`;
}

let ro = null;
export function mount(root, ix, sub) {
  ro?.disconnect();
  ro = null;
  if (sub !== 'heat') return () => {};
  const host = root.querySelector('#hm');
  if (!host || !ix.heatmap?.length) return () => {};
  drawHeat(host, ix);
  ro = new ResizeObserver(() => drawHeat(host, ix));
  ro.observe(host);
  return () => ro?.disconnect();
}

export function bind() {
  act('rank-set', (el) => { ui.rank = el.dataset.v; ctx.rerender(); });
  act('t86-set', (el) => { ui.t86 = el.dataset.v; ctx.rerender(); });
}
