// 個股詳情（側邊欄／手機底部抽屜）：K 線與技術指標、比較、警示、分享。
// 圖表本體只建立一次；標題、工具列、統計、警示各自局部重繪，避免切換指標時圖表閃爍。

import { html } from '../lib/html.js';
import { num, int, pct, signed, cls, price, compact, dateShort, secs } from '../lib/fmt.js';
import { D, resolve, yahooSymbol } from '../lib/app.js';
import { sourceOf } from '../lib/live.js';
import { act, onSubmit } from '../lib/actions.js';
import * as api from '../lib/api.js';
import * as store from '../lib/store.js';
import { sma, rsi, macd, kd, boll, normalize, volatility } from '../lib/indicators.js';
import { sigTags } from './components.js';
import { TimeChart } from '../charts/chart.js';
import { ctx } from './ctx.js';
import { safeUrl } from '../lib/html.js';

const TF = [['1M', 22], ['3M', 66], ['6M', 130], ['1Y', 250], ['全部', 9999]];
const IND = [['ma', '均線'], ['boll', '布林'], ['vol', '成交量'], ['rsi', 'RSI'], ['macd', 'MACD'], ['kd', 'KD']];
const CMP_COLORS = ['#5aa9ff', '#b387ff', '#4dd0c8'];
const MA = [['MA5', 5, 'lamp'], ['MA20', 20, '#5aa9ff'], ['MA60', 60, '#b387ff']];

const S = {
  key: null,
  r: null,
  hist: null,
  err: null,
  tf: 130,
  type: 'candle',
  ind: { ma: true, boll: false, vol: true, rsi: false, macd: false, kd: false },
  compare: [], // {key, name, hist}
  chart: null,
};

const $ = (id) => document.getElementById(id);
const put = (id, h) => { const el = $(id); if (el) el.innerHTML = String(h); };

// ───────── 繪製各區 ─────────
function paintHead() {
  const r = S.r;
  if (!r) return;
  const wl = store.inWatch(r.key);
  put('dt-head', html`
    <div>
      <div class="dt__sub">${r.group || ''}　${r.code}${r.stale ? ' · 舊資料' : ''}${r.tracked ? '' : ' · 僅當日報價'}</div>
      <h2 class="dt__title" id="dt-title">${r.name}</h2>
    </div>
    <div class="dt__px"><span class="dt__price ${cls(r.pct)}">${price(r.price)}</span><span class="${cls(r.pct)} num" style="font-size:20px">${signed(r.chg, 2)}　${pct(r.pct)}</span>${r.live ? html`<small><span class="tag tag--live" title="${sourceOf(r.liveSrc).title}">${sourceOf(r.liveSrc).label}</span> ${r.liveAt || ''}${r.liveDelay == null ? '' : html` · 延遲 ${secs(r.liveDelay)}`}</small>` : r.quote?.date ? html`<small>${dateShort(r.quote.date)}</small>` : ''}</div>
    <div class="dt__act">
      <button type="button" class="btn" data-act="dt-watch" aria-pressed="${String(wl)}">${wl ? '已在自選' : '加入自選'}</button>
      <button type="button" class="btn" data-act="dt-share">分享連結</button>
      ${S.chart ? html`<button type="button" class="btn" data-act="dt-png">存成圖片</button>` : ''}
      <a class="btn" href="${safeUrl(`https://tw.stock.yahoo.com/quote/${encodeURIComponent(yahooSymbol(r))}`)}" target="_blank" rel="noopener noreferrer">Yahoo 奇摩</a>
      <button type="button" class="btn" data-act="close-layer" aria-label="關閉個股視窗">關閉</button>
    </div>`);
}

function paintTools() {
  if (!S.hist) return put('dt-tools', '');
  put('dt-tools', html`
    <div class="group seg" role="group" aria-label="時間範圍">${TF.map(([n, c]) => html`<button type="button" data-act="dt-tf" data-n="${c}" aria-pressed="${String(S.tf === c)}">${n}</button>`)}</div>
    <div class="group seg" role="group" aria-label="圖表類型"><button type="button" data-act="dt-type" data-v="candle" aria-pressed="${String(S.type === 'candle')}">K 線</button><button type="button" data-act="dt-type" data-v="line" aria-pressed="${String(S.type === 'line')}">折線</button></div>
    <div class="group chips" role="group" aria-label="技術指標">${IND.map(([k, n]) => html`<button type="button" class="tag" data-act="dt-ind" data-k="${k}" aria-pressed="${String(S.ind[k])}">${n}</button>`)}</div>
    <div class="group">
      ${S.compare.map((c, i) => html`<span class="tag" style="border-color:${CMP_COLORS[i]};color:${CMP_COLORS[i]}">${c.name} <button type="button" class="link" data-act="dt-cmp-rm" data-k="${c.key}" aria-label="移除比較 ${c.name}" style="text-decoration:none">×</button></span>`)}
      ${S.compare.length < 3 ? html`<button type="button" class="btn btn--sm" data-act="dt-cmp-add">＋ 比較</button>` : ''}
      <button type="button" class="btn btn--sm" data-act="dt-reset">重設縮放</button>
    </div>`);
}

function statCell(n, v) {
  return html`<div><div class="n">${n}</div><div class="v">${v}</div></div>`;
}

function paintStats() {
  const r = S.r;
  const t = r?.quote?.tech;
  const H = S.hist;
  const i = H ? H.c.length - 1 : -1;
  const vol = H && volatility(H.c, 20);
  const cells = [];
  if (H && i >= 0) {
    cells.push(statCell('開', price(H.o[i])), statCell('高', price(H.h[i])), statCell('低', price(H.l[i])), statCell('收', price(H.c[i])));
    if (H.v?.[i]) cells.push(statCell('成交量（張）', int(H.v[i])));
  } else if (r?.value != null) cells.push(statCell('今日成交金額', `${num(r.value, 1)} 億`));
  if (t) {
    cells.push(
      statCell('52 週高', price(t.hi52)), statCell('52 週低', price(t.lo52)),
      statCell('距 52 週高', html`<span class="${cls(t.from_hi)}">${pct(t.from_hi)}</span>`),
      statCell('近 1 週', html`<span class="${cls(t.ret_1w)}">${pct(t.ret_1w)}</span>`),
      statCell('近 1 月', html`<span class="${cls(t.ret_1m)}">${pct(t.ret_1m)}</span>`),
      statCell('近 3 月', html`<span class="${cls(t.ret_3m)}">${pct(t.ret_3m)}</span>`),
      statCell('近 1 年', html`<span class="${cls(t.ret_1y)}">${pct(t.ret_1y)}</span>`),
      statCell('RSI(14)', t.rsi != null ? num(t.rsi, 1) : '—'),
      statCell('MA5 / 20 / 60', `${price(t.ma5)} / ${price(t.ma20)} / ${price(t.ma60)}`),
      statCell('量比（對 20 日均量）', t.vr != null ? `${num(t.vr, 2)} 倍` : '—'),
    );
  }
  if (vol != null) cells.push(statCell('20 日年化波動', `${num(vol, 1)}%`));
  put('dt-stats', html`
    ${r?.quote?.signals?.length ? html`<div style="margin-top:18px">${sigTags(r.quote.signals)}<span class="note"> 依日 K 機械計算，只供參考</span></div>` : ''}
    ${cells.length ? html`<div class="stats">${cells}</div>` : ''}`);
}

function paintAlerts() {
  const r = S.r;
  if (!r) return;
  const al = store.get().alerts.filter((a) => a.sym === r.key);
  put('dt-alerts', html`
    <h3 style="margin:26px 0 6px;font-size:15px">價格警示</h3>
    <form class="form" data-submit="dt-alert">
      <select class="field" name="op" aria-label="條件"><option value=">=">價格 ≥</option><option value="<=">價格 ≤</option></select>
      <input class="field" name="value" type="number" min="0" step="any" required placeholder="${price(r.price)}" aria-label="警示價位" style="width:120px">
      <button class="btn" type="submit">新增警示</button>
    </form>
    ${al.map((a) => html`<div class="inst" style="grid-template-columns:1fr auto auto"><span>${a.op === '>=' ? '≥' : '≤'} ${price(a.value)} ${a.note || ''}</span><span class="tag ${a.on ? '' : 'tag--imp'}">${a.on ? '監控中' : '已觸發'}</span><button type="button" class="btn btn--sm" data-act="dt-alert-rm" data-id="${a.id}">刪除</button></div>`)}
    <p class="note">只在你開著網站時檢查。</p>`);
}

// ───────── 圖表 ─────────
const fmtVol = (v) => compact(v);
const pf = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

function buildModel() {
  const H = S.hist;
  const c = H.c;
  const n = c.length;
  const cmp = S.compare.filter((x) => x.hist);
  const start = Math.max(0, n - Math.min(S.tf, n));
  const panes = [];

  const main = [];
  const priceFmt = cmp.length ? pf : undefined;
  if (cmp.length) {
    main.push({ kind: 'line', v: normalize(c, start), name: S.r.name, color: 'lamp', width: 2, fmt: pf });
    cmp.forEach((x, i) => {
      const map = new Map(x.hist.d.map((d, j) => [d, x.hist.c[j]]));
      main.push({ kind: 'line', v: normalize(H.d.map((d) => map.get(d) ?? null), start), name: x.name, color: CMP_COLORS[i], width: 1.6, fmt: pf });
    });
  } else {
    if (S.ind.boll) {
      const b = boll(c);
      main.push({ kind: 'band', hi: b.u, lo: b.l, color: '#8fa0c8', alpha: 0.08 });
      main.push({ kind: 'line', v: b.m, color: '#8fa0c8', width: 1, dash: [4, 3], name: '布林中軌' });
    }
    if (S.type === 'candle') main.push({ kind: 'candle', o: H.o, h: H.h, l: H.l, c });
    else main.push({ kind: 'line', v: c, color: 'ink', width: 1.8, fill: true, name: '收盤' });
    if (S.ind.ma) for (const [name, p, color] of MA) main.push({ kind: 'line', v: sma(c, p), name, color, width: 1.2 });
  }
  panes.push({ id: 'price', weight: 3.6, series: main, fmt: priceFmt, lastLine: cmp.length ? undefined : { value: c[n - 1], color: 'lamp' } });

  const hasVol = H.v && H.v.some((x) => x);
  if (S.ind.vol && hasVol) {
    panes.push({ id: 'vol', weight: 0.9, zeroBase: true, fmt: fmtVol, series: [{ kind: 'bars', v: H.v, colors: c.map((x, i) => (i && x < c[i - 1] ? 'down' : 'up')), name: '量', fmt: fmtVol, alpha: 0.75 }] });
  }
  if (S.ind.rsi) panes.push({ id: 'rsi', weight: 1, range: [0, 100], guides: [30, 70], fmt: (v) => v.toFixed(0), series: [{ kind: 'line', v: rsi(c), name: 'RSI', color: 'lamp', fmt: (v) => v.toFixed(1) }] });
  if (S.ind.macd) {
    const m = macd(c);
    panes.push({ id: 'macd', weight: 1, fmt: (v) => v.toFixed(2), series: [{ kind: 'hist', v: m.h, name: '柱' }, { kind: 'line', v: m.m, name: 'DIF', color: '#5aa9ff', fmt: (v) => v.toFixed(2) }, { kind: 'line', v: m.s, name: 'DEA', color: '#b387ff', fmt: (v) => v.toFixed(2) }] });
  }
  if (S.ind.kd) {
    const k = kd(H.h, H.l, c);
    panes.push({ id: 'kd', weight: 1, range: [0, 100], guides: [20, 80], fmt: (v) => v.toFixed(0), series: [{ kind: 'line', v: k.k, name: 'K', color: 'lamp', fmt: (v) => v.toFixed(1) }, { kind: 'line', v: k.d, name: 'D', color: '#5aa9ff', fmt: (v) => v.toFixed(1) }] });
  }
  return { x: H.d, panes };
}

function paintChart() {
  const host = $('dt-chart');
  if (!host || !S.hist) return;
  if (!S.chart) {
    S.chart = new TimeChart(host, { label: `${S.r.name} 日 K 線圖`, wheelZoom: 'modifier', axisW: 64 });
    paintHead();
  }
  S.chart.setModel(buildModel(), { count: Math.min(S.tf, S.hist.c.length) });
}

function setLoading(msg) {
  put('dt-body', html`<div class="empty"><b>${msg}</b></div>`);
}

// ───────── 開啟與關閉 ─────────
function skeleton() {
  return html`<div class="dt" role="document">
    <div class="dt__head" id="dt-head"></div>
    <div class="dt__tools" id="dt-tools"></div>
    <div id="dt-body"><div class="dt__chart" id="dt-chart"></div></div>
    <div id="dt-stats"></div>
    <div id="dt-alerts"></div>
  </div>`;
}

export async function show(key) {
  const el = $('sheet');
  const r = resolve(key);
  destroyChart();
  Object.assign(S, { key, r, hist: null, err: null, compare: [] });
  el.innerHTML = String(skeleton());
  el.scrollTop = 0;
  if (!r) {
    put('dt-body', html`<div class="err"><b>找不到這個標的</b>資料可能還沒載入，或代號輸入有誤。<div style="margin-top:12px"><button class="btn" type="button" data-act="close-layer">關閉</button></div></div>`);
    return;
  }
  store.pushRecent(r.key);
  paintHead();
  paintStats();
  paintAlerts();
  if (!r.tracked) {
    put('dt-body', html`<div class="banner">這檔不在追蹤清單，只有今日報價，沒有歷史走勢圖。若要看 K 線，請把它加進專案的 symbols.json（見 README）。</div>`);
    return;
  }
  setLoading('載入走勢中…');
  try {
    const hist = await api.loadHistory(r.symbol);
    if (S.key !== key) return; // 使用者已切換到其他標的
    S.hist = hist;
    put('dt-body', html`<div class="dt__chart" id="dt-chart"></div>`);
    paintTools();
    paintChart();
    paintStats();
  } catch (e) {
    if (S.key !== key) return;
    put('dt-body', html`<div class="err"><b>無法載入走勢資料</b>${e.message}<div style="margin-top:12px"><button class="btn" type="button" data-act="dt-retry">重試</button></div></div>`);
  }
}

function destroyChart() {
  S.chart?.destroy();
  S.chart = null;
}

export function hide() {
  destroyChart();
  S.key = null;
  S.r = null;
  S.hist = null;
}

/** 資料更新後，重繪不影響圖表的部分。 */
export function repaint() {
  if (!S.key) return;
  S.r = resolve(S.key) || S.r;
  paintHead();
  paintStats();
  paintAlerts();
}

export const current = () => S.key;

export async function addCompare(key) {
  const r = resolve(key);
  if (!r?.tracked || r.symbol === S.r?.symbol || S.compare.some((c) => c.key === r.symbol)) return ctx.toast('這檔無法加入比較（需要是追蹤清單內、且尚未加入的標的）');
  const item = { key: r.symbol, name: r.name, hist: null };
  S.compare.push(item);
  paintTools();
  try {
    item.hist = await api.loadHistory(r.symbol);
  } catch {
    S.compare = S.compare.filter((c) => c !== item);
    ctx.toast(`無法載入 ${r.name} 的走勢`);
  }
  paintTools();
  paintChart();
}

// ───────── 事件 ─────────
export function bind() {
  act('dt-tf', (el) => { S.tf = +el.dataset.n; paintTools(); paintChart(); });
  act('dt-type', (el) => { S.type = el.dataset.v; paintTools(); paintChart(); });
  act('dt-ind', (el) => { S.ind[el.dataset.k] = !S.ind[el.dataset.k]; paintTools(); paintChart(); });
  act('dt-reset', () => S.chart?.resetView());
  act('dt-cmp-add', () => ctx.openPalette({ mode: 'compare' }));
  act('dt-cmp-rm', (el) => { S.compare = S.compare.filter((c) => c.key !== el.dataset.k); paintTools(); paintChart(); });
  act('dt-retry', () => show(S.key));
  act('dt-watch', () => {
    const on = store.toggleWatch(S.r.key);
    ctx.toast(on ? `已加入自選：${S.r.name}` : `已從自選移除：${S.r.name}`);
    paintHead();
  });
  act('dt-share', async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: `${S.r.name} | 台股夜盤`, url });
      else {
        await navigator.clipboard.writeText(url);
        ctx.toast('已複製連結');
      }
    } catch (e) {
      if (e?.name !== 'AbortError') ctx.toast('無法複製，請直接複製網址列的網址');
    }
  });
  act('dt-png', () => {
    if (!S.chart) return;
    const a = document.createElement('a');
    a.href = S.chart.toDataURL();
    a.download = `${S.r.code}-${S.hist.d.at(-1)}.png`;
    document.body.append(a);
    a.click();
    a.remove();
  });
  onSubmit('dt-alert', (f) => {
    const d = new FormData(f);
    if (!store.addAlert({ sym: S.r.key, op: d.get('op'), value: +d.get('value') })) return ctx.toast('請輸入有效的價位');
    ctx.toast('已新增警示');
    paintAlerts();
  });
  act('dt-alert-rm', (el) => { store.removeAlert(el.dataset.id); paintAlerts(); });
}
