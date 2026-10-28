// 以範例資料渲染每一個頁面，確認不會丟例外、不會出現 undefined／NaN，且使用者可控的文字都被跳脫。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { D, ingest, resolve, search } from '../assets/js/lib/app.js';
import * as overview from '../assets/js/ui/overview.js';
import * as market from '../assets/js/ui/market.js';
import * as mine from '../assets/js/ui/mine.js';
import * as news from '../assets/js/ui/news.js';
import * as macro from '../assets/js/ui/macro.js';
import * as store from '../assets/js/lib/store.js';
import { MARKET_SUBS } from '../assets/js/lib/router.js';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const fresh = () => {
  const ix = structuredClone(load('index'));
  ingest(ix, load('universe'));
  return ix;
};
const BAD = /undefined|NaN|\[object|Infinity/;
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('每個頁面都能渲染且沒有壞值', () => {
  store.configure({ storage: mem() });
  const ix = fresh();
  const pages = {
    overview: String(overview.render(ix)),
    mine: String(mine.render(ix)),
    news: String(news.render(ix)),
    macro: String(macro.render(ix)),
  };
  for (const s of MARKET_SUBS) pages[`market/${s}`] = String(market.render(ix, s));
  for (const [name, h] of Object.entries(pages)) {
    assert.ok(h.length > 200, `${name} 內容太短`);
    const m = h.match(BAD);
    assert.equal(m, null, `${name} 含有 ${m && m[0]}：…${m && h.slice(Math.max(0, m.index - 60), m.index + 40)}…`);
  }
  assert.match(pages.overview, /加權指數/);
  assert.match(pages['market/chips'], /三大法人/);
});

test('缺少資料時頁面仍可渲染（降級而不是崩潰）', () => {
  store.configure({ storage: mem() });
  const ix = fresh();
  for (const k of ['institutional', 'inst_hist', 't86', 'margin', 'margin_hist', 'futures', 'futures_hist', 'breadth', 'turnover_hist', 'heatmap', 'sector_stats', 'dividends', 'notices', 'news', 'macro', 'ai', 'taiex']) delete ix[k];
  ix.rankings = {};
  ingest(ix, []);
  const pages = [overview.render(ix), mine.render(ix), news.render(ix), macro.render(ix), ...MARKET_SUBS.map((s) => market.render(ix, s))].map(String);
  for (const h of pages) assert.equal(h.match(BAD), null);
});

test('新聞標題與連結會被跳脫／過濾', () => {
  store.configure({ storage: mem() });
  const ix = fresh();
  ix.news = [{ title: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)', source: '<b>來源</b>', time: '2026-10-28T10:00:00+08:00', score: 1, important: true, tone: 'up', tags: ['<script>'], also: [] }];
  const h = String(news.render(ix));
  assert.ok(!h.includes('<img'), '標題未跳脫');
  assert.ok(!h.includes('<script>'), '標籤未跳脫');
  assert.ok(!h.includes('javascript:'), '危險連結未過濾');
  assert.match(h, /&lt;img/);
});

test('搜尋與解析：追蹤標的、全市場代號、名稱', () => {
  fresh();
  assert.equal(resolve('2330.TW').tracked, true);
  assert.equal(resolve('2330').symbol, '2330.TW');
  const hit = search('台積');
  assert.ok(hit.length && hit[0].code === '2330');
  const u = D.universe.find((r) => !D.byCode.has(r[0]));
  const r = resolve(u[0]);
  assert.equal(r.tracked, false);
  assert.equal(r.price, u[2]);
  assert.equal(resolve('不存在'), null);
  assert.deepEqual(search(''), []);
});

test('持股與自選頁會顯示使用者資料', () => {
  store.configure({ storage: mem() });
  const ix = fresh();
  store.toggleWatch('2330.TW');
  store.setHolding('2330.TW', 1000, 500);
  store.addAlert({ sym: '2330.TW', op: '>=', value: 9999 });
  const h = String(mine.render(ix));
  assert.match(h, /台積電/);
  assert.match(h, /未實現損益/);
  assert.match(h, /監控中/);
  assert.equal(h.match(BAD), null);
});

test('切換鈕的 aria-pressed 會輸出 "true"／"false"（布林值不能被 html`` 吞掉）', () => {
  store.configure({ storage: mem() });
  const ix = fresh();
  const h = String(news.render(ix));
  assert.match(h, /aria-pressed="true"/);
  assert.match(h, /aria-pressed="false"/);
  assert.match(String(market.render(ix, 'rank')), /aria-pressed="true"/);
});
