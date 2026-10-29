// 總覽：天際線 hero、資訊帶、焦點個股、法人、訊號掃描，以及右側的新聞／總經／國際行情。

import { html } from '../lib/html.js';
import { num, int, pct, signed, cls, price, yi, dateShort } from '../lib/fmt.js';
import { D, resolve, rows } from '../lib/app.js';
import { scan } from '../lib/signals.js';
import { href } from '../lib/router.js';
import { head, empty, quoteRow, newsList, link, netBar } from './components.js';
import { spark, columns, volumeBars, breadthBar } from '../charts/mini.js';
import { TimeChart } from '../charts/chart.js';
import '../charts/skyline.js';

const MINI = ['^TWOII', '^GSPC', 'TSM', 'TWD=X'];
const GLOBAL = ['^GSPC', '^IXIC', '^SOX', 'TSM', '^N225', '^KS11', '^VIX', 'TWD=X'];
const MACRO_PICK = ['FEDFUNDS', 'DGS10', 'T10Y2Y', 'CPIAUCSL'];

const last = (a, n) => (a || []).slice(-n);

/** 一句純描述式的盤面摘要（規則產生，不是 AI）。 */
export function mood(ix) {
  const b = ix.breadth;
  const parts = [];
  if (b && b.up != null) parts.push(`上漲 ${int(b.up)} 家、下跌 ${int(b.down)} 家`);
  const f = ix.institutional?.summary?.foreign;
  if (f != null && f !== 0) parts.push(`外資${f > 0 ? '買超' : '賣超'} ${num(Math.abs(f), 1)} 億`);
  return parts.join('；');
}

function fact(to, name, value, sub, viz) {
  return html`<a class="fact" href="${to}"><div class="fact__n">${name}</div><span class="fact__v">${value}</span>${viz || ''}<div class="fact__s">${sub}</div></a>`;
}

function factsBand(ix) {
  const items = [];
  const b = ix.breadth;
  if (b && b.count) {
    items.push(fact(href({ view: 'market', sub: 'heat' }), '漲跌家數',
      html`<span class="up">${int(b.up)}</span> <small>/</small> <span class="down">${int(b.down)}</span>`,
      `持平 ${int(b.flat)}　漲停 ${int(b.limit_up)}　跌停 ${int(b.limit_down)}`, breadthBar(b.up, b.flat, b.down)));
  }
  const th = last(ix.turnover_hist, 20);
  const turn = b?.turnover ?? th.at(-1)?.v;
  if (turn != null) {
    const avg = th.length ? th.reduce((s, x) => s + x.v, 0) / th.length : null;
    items.push(fact(href({ view: 'market', sub: 'chips' }), '成交金額', yi(turn), avg ? `近 ${th.length} 日平均 ${yi(avg)}` : '', volumeBars(th.map((x) => x.v))));
  }
  const s = ix.institutional?.summary;
  if (s && s.foreign != null) {
    items.push(fact(href({ view: 'market', sub: 'chips' }), '外資買賣超',
      html`<span class="${cls(s.foreign)}">${signed(s.foreign, 1)}</span><small>億</small>`,
      `投信 ${signed(s.trust, 1)}　自營商 ${signed(s.dealer, 1)}`, columns(last(ix.inst_hist, 20).map((x) => x.foreign))));
  }
  const fut = ix.futures?.rows?.find((r) => r.name.includes('外資'));
  if (fut) {
    items.push(fact(href({ view: 'market', sub: 'chips' }), '外資台指期淨部位',
      html`<span class="${cls(fut.net)}">${signed(fut.net, 0)}</span><small>口</small>`,
      '未平倉淨多空口數', columns(last(ix.futures_hist, 20).map((x) => x.foreign))));
  }
  const m = ix.margin?.margin_amt;
  if (m && m.bal != null) {
    items.push(fact(href({ view: 'market', sub: 'chips' }), '融資餘額',
      html`${yi(m.bal)}`, html`較前日 <span class="${cls(m.chg)}">${signed(m.chg, 1)} 億</span>`,
      html`<span class="${cls(m.chg)}">${spark(last(ix.margin_hist, 30).map((x) => x.margin_amt), { w: 140, h: 30 })}</span>`));
  }
  return items.length ? html`<div class="facts" role="list" aria-label="市場重點數據">${items}</div>` : '';
}

function macroLine(m) {
  const d = m.value != null && m.prev != null ? m.value - m.prev : null;
  return html`<a class="qrow qrow--simple" href="${href({ view: 'macro' })}"><span class="qrow__nm">${m.name}</span><span class="qrow__px num">${num(m.value, 2)}${m.unit === '%' ? '%' : ''}</span><span class="${cls(d)} qrow__px">${d == null ? '' : signed(d, 2)}</span></a>`;
}

/** hero 價格底下那行小字：即時報價顯示時間，否則顯示資料日期。 */
function heroStamp(t) {
  if (t.live) return html`<span class="tag tag--live">即時</span> ${t.liveAt || ''}`;
  return html`${dateShort(t.date)} ${t.stale ? '（舊資料）' : ''}`;
}

const heroChg = (t) => html`${signed(t.chg, 2)} <span>${pct(t.pct)}</span><small>${heroStamp(t)}</small>`;

const miniRow = (r) => html`<a href="${link(r.key)}"><span class="n">${r.name}</span><span class="v num">${price(r.price)}<span class="${cls(r.pct)}">${pct(r.pct)}</span></span></a>`;

export function render(ix) {
  const t = resolve('^TWII');
  const focus = D.quotes.filter((q) => q.focus && (q.kind === 'stock' || q.kind === 'etf')).map((q) => resolve(q.symbol));
  const groups = scan(D.quotes).slice(0, 5);
  const s = ix.institutional?.summary;
  const maxInst = s ? Math.max(Math.abs(s.foreign), Math.abs(s.trust), Math.abs(s.dealer), 1) : 1;
  const news = [...(ix.news || [])].sort((a, b) => Number(b.important) - Number(a.important) || new Date(b.time) - new Date(a.time)).slice(0, 6);
  const macros = MACRO_PICK.map((id) => (ix.macro || []).find((m) => m.id === id)).filter(Boolean);
  const globals = rows(GLOBAL.filter((k) => D.bySymbol.has(k)));
  const divs = (ix.dividends || []).slice(0, 5);
  const t86f = ix.t86?.foreign;

  return html`
    <section class="hero" aria-label="加權指數">
      <div class="hero__grid">
        <div class="hero__main">
          <div class="hero__lbl">加權指數</div>
          ${t ? html`
            <a class="hero__num" id="hero-px" href="${link('^TWII')}" aria-label="加權指數 ${num(t.price, 2)}，查看走勢圖">${num(t.price, 2)}</a>
            <div class="hero__chg ${cls(t.pct)}" id="hero-chg">${heroChg(t)}</div>
            <p class="hero__mood">${mood(ix)}</p>`
          : empty('暫時沒有加權指數資料', '資料更新後會自動出現。')}
          <div class="hero__mini" id="hero-mini">
            ${MINI.filter((k) => D.bySymbol.has(k)).map((k) => miniRow(resolve(k)))}
          </div>
        </div>
        <div class="hero__chart-wrap">
          <div class="seg hero__rng" role="group" aria-label="天際線範圍">
            <button type="button" data-act="hero-range" data-n="60" aria-pressed="false">3 月</button>
            <button type="button" data-act="hero-range" data-n="120" aria-pressed="true">6 月</button>
            <button type="button" data-act="hero-range" data-n="250" aria-pressed="false">1 年</button>
          </div>
          <div class="hero__chart" id="hero-chart"></div>
        </div>
      </div>
    </section>
    <div style="margin-top:20px">${factsBand(ix)}</div>

    <div class="cols2 sec">
      <div>
        <section>
          ${head('焦點個股', '點選看技術圖', html`<a class="link" href="${href({ view: 'mine' })}">管理自選</a>`)}
          <div id="focus-list">${focus.length ? focus.map((r) => quoteRow(r)) : empty('尚無個股資料')}</div>
        </section>

        <section class="sec">
          ${head('法人動向', ix.institutional?.date ? `${ix.institutional.date}　單位：億元` : '', html`<a class="link" href="${href({ view: 'market', sub: 'chips' })}">更多籌碼</a>`)}
          ${s ? html`
            ${[['外資及陸資', s.foreign], ['投信', s.trust], ['自營商', s.dealer]].map(([n, v]) => html`<div class="inst"><span>${n}</span>${netBar(v, maxInst)}<span class="v ${cls(v)}">${signed(v, 1)}</span></div>`)}
            ${t86f ? html`<div class="grid2" style="margin-top:18px">
              <div><div class="sh__sub" style="margin-bottom:4px">外資買超個股（張）</div>${t86f.buy.slice(0, 5).map((x) => html`<a class="qrow qrow--simple" href="${link(x.code)}"><span class="qrow__nm">${x.name}<small>${x.code}</small></span><span class="qrow__px up">+${int(x.net)}</span>${html`<span class="chip ${cls(x.pct)}">${pct(x.pct)}</span>`}</a>`)}</div>
              <div><div class="sh__sub" style="margin-bottom:4px">外資賣超個股（張）</div>${t86f.sell.slice(0, 5).map((x) => html`<a class="qrow qrow--simple" href="${link(x.code)}"><span class="qrow__nm">${x.name}<small>${x.code}</small></span><span class="qrow__px down">${int(x.net)}</span>${html`<span class="chip ${cls(x.pct)}">${pct(x.pct)}</span>`}</a>`)}</div>
            </div>` : ''}`
          : empty('法人資料尚未公布', '證交所通常在盤後 16:30 前後更新。')}
        </section>

        <section class="sec">
          ${head('訊號掃描', '依日 K 計算，追蹤清單內的個股與 ETF')}
          ${groups.length ? groups.map((g) => html`<div class="scan"><span class="sig sig--${g.dir}" title="${g.hint}" style="justify-self:start">${g.label}</span><div class="scan__who">${g.list.slice(0, 7).map((q) => html`<a href="${link(q.symbol)}">${q.name} <span class="${cls(q.pct)}">${pct(q.pct, 1)}</span></a>`)}${g.total > 7 ? html`<span class="mute">等 ${g.total} 檔</span>` : ''}</div></div>`)
            : empty('目前沒有觸發訊號', '訊號是機械式的技術條件，只供參考。')}
        </section>
      </div>

      <aside>
        <section>
          ${head('重點新聞', '', html`<a class="link" href="${href({ view: 'news' })}">全部新聞</a>`)}
          ${newsList(news, { compact: true })}
        </section>
        <section class="sec">
          ${head('總經速覽', '', html`<a class="link" href="${href({ view: 'macro' })}">完整報告</a>`)}
          ${ix.ai?.headline ? html`<p style="margin:12px 0 6px;font-weight:700">${ix.ai.headline}</p>` : ''}
          ${macros.length ? macros.map(macroLine) : empty('總經資料尚未設定', '需要在專案設定 FRED_API_KEY。')}
        </section>
        <section class="sec">
          ${head('國際行情')}
          ${globals.map((r) => quoteRow(r, { withSpark: false }))}
        </section>
        ${divs.length ? html`<section class="sec">
          ${head('近期除權息')}
          ${divs.map((d) => html`<a class="qrow qrow--simple" href="${link(d.code)}"><span class="qrow__nm">${d.name}<small>${d.code}　${dateShort(d.date)}</small></span><span class="qrow__px">${d.cash != null ? `現金 ${num(d.cash, 2)}` : ''}${d.stock ? ` 股票 ${num(d.stock, 2)}` : ''}</span><span class="tag" style="justify-self:end">${d.type}</span></a>`)}
        </section>` : ''}
      </aside>
    </div>`;
}

let chart = null;
let introPlayed = false; // 天際線的進場動畫每次載入頁面只播一次
let baseX = null; // 排程產出的收盤序列，盤中用它加上今天那一棟
let baseC = null;

/** 把最新報價接到收盤序列後面：已經有今天就改寫樓高，還沒有就蓋一棟新的。 */
function skylineModel(t) {
  const x = [...baseX];
  const c = [...baseC];
  if (t && Number.isFinite(t.price) && t.date) {
    if (t.date > x.at(-1)) {
      x.push(t.date);
      c.push(t.price);
    } else if (t.date === x.at(-1)) {
      c[c.length - 1] = t.price;
    }
  }
  return { x, panes: [{ id: 'sky', padTop: 0.34, padBottom: 0.04, series: [{ kind: 'skyline', c, dir: Math.sign(t?.pct ?? 0) }] }] };
}

/** 建立天際線。回傳清理函式。 */
export function mount(root, ix) {
  const host = root.querySelector('#hero-chart');
  if (!host || !ix.taiex?.c?.length) return () => {};
  baseX = [...ix.taiex.d];
  baseC = [...ix.taiex.c];
  chart = new TimeChart(host, { intro: introPlayed ? 0 : 1100, wheelZoom: 'modifier', label: '加權指數天際線：每個交易日一棟大樓，樓高為收盤指數', axisW: 62 });
  chart.setModel(skylineModel(resolve('^TWII')), { count: 120 });
  introPlayed = true;
  return () => {
    chart?.destroy();
    chart = null;
    baseX = baseC = null;
  };
}

/** 即時報價進來時只更新 hero 與天際線末柱，不重建整頁（避免捲動與焦點被打斷）。 */
export function paintLive(root) {
  const t = resolve('^TWII');
  if (!t) return;
  const px = root.querySelector('#hero-px');
  if (px) {
    px.textContent = num(t.price, 2);
    px.setAttribute('aria-label', `加權指數 ${num(t.price, 2)}，查看走勢圖`);
  }
  const chg = root.querySelector('#hero-chg');
  if (chg) {
    chg.className = `hero__chg ${cls(t.pct)}`;
    chg.innerHTML = String(heroChg(t));
  }
  const mini = root.querySelector('#hero-mini');
  if (mini) mini.innerHTML = String(html`${MINI.filter((k) => D.bySymbol.has(k)).map((k) => miniRow(resolve(k)))}`);
  // 焦點個股也是台股，跑馬燈動了這裡就不能停在收盤價
  const list = root.querySelector('#focus-list');
  if (list) {
    const focus = D.quotes.filter((q) => q.focus && (q.kind === 'stock' || q.kind === 'etf')).map((q) => resolve(q.symbol));
    if (focus.length) list.innerHTML = String(html`${focus.map((r) => quoteRow(r))}`);
  }
  // 使用者正在看十字線時不要重畫，否則游標資訊會被清掉
  if (chart && baseX && !chart.hover) chart.setModel(skylineModel(t));
}

export function setRange(n) {
  chart?.setCount(n);
  chart?.draw();
}
