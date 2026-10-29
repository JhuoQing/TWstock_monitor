// 盤中即時報價層：符號對應、交易時段判斷、可用性門檻、輪詢與覆蓋。
import test from 'node:test';
import assert from 'node:assert/strict';

import * as live from '../assets/js/lib/live.js';
import { normalizeMis, normalizeYahoo, yahooSymbol } from '../../worker/index.js';
import { todayTW } from '../assets/js/lib/fmt.js';

const today = () => todayTW(new Date()).replace(/-/g, '');

test('misChannel 把標的對應到 MIS 頻道', () => {
  assert.equal(live.misChannel('^TWII'), 'tse_t00.tw');
  assert.equal(live.misChannel('^TWOII'), 'otc_o00.tw');
  assert.equal(live.misChannel('2330.TW'), 'tse_2330.tw');
  assert.equal(live.misChannel('6488.TWO'), 'otc_6488.tw');
  assert.equal(live.misChannel('00679B.TW'), 'tse_00679B.tw'); // 債券 ETF 的大寫要保留
  assert.equal(live.misChannel('6488', 'otc'), 'otc_6488.tw'); // 全市場代號靠 kind 判斷
  assert.equal(live.misChannel('6488'), 'tse_6488.tw');
  // 台股以外的標的沒有 MIS 即時行情
  for (const k of ['^GSPC', 'TSM', 'TWD=X', 'GC=F', 'BTC-USD', '', null]) {
    assert.equal(live.misChannel(k), null, String(k));
  }
});

test('liveWindow 只在平日盤中為真', () => {
  const at = (iso) => live.liveWindow(new Date(iso));
  assert.equal(at('2026-10-29T01:51:00Z'), true); // 四 09:51 台北
  assert.equal(at('2026-10-29T00:45:00Z'), true); // 四 08:45 開始
  assert.equal(at('2026-10-29T05:40:00Z'), true); // 四 13:40 結束
  assert.equal(at('2026-10-29T00:30:00Z'), false); // 四 08:30 還太早
  assert.equal(at('2026-10-29T05:41:00Z'), false); // 四 13:41 已結束
  assert.equal(at('2026-10-31T02:00:00Z'), false); // 六 10:00 休市
  assert.equal(at('2026-11-01T02:00:00Z'), false); // 日 10:00 休市
});

test('usable 擋掉非今日與盤前沒成交的資料', () => {
  const now = new Date();
  const base = { price: 100, chg: 1, vol: 500, d: today() };
  assert.equal(live.usable(base, now), true);
  assert.equal(live.usable({ ...base, d: '20200101' }, now), false); // 休市日 MIS 回上一個交易日
  assert.equal(live.usable({ ...base, vol: 0, chg: 0 }, now), false); // 盤前 price 會退回昨收
  assert.equal(live.usable({ ...base, vol: 0, chg: -3 }, now), true); // 有漲跌就是真的在動
  assert.equal(live.usable({ ...base, price: null }, now), false);
  assert.equal(live.usable(null, now), false);
});

test('isoDate 轉換 MIS 的日期格式', () => {
  assert.equal(live.isoDate({ d: '20261029' }), '2026-10-29');
  assert.equal(live.isoDate({ d: '2026-10-29' }), null);
  assert.equal(live.isoDate({}), null);
  assert.equal(live.isoDate(null), null);
});

test('quoteTime 以台北時間解讀 MIS 的日期與時間', () => {
  // 2026-10-29 10:31:05 台北 = 02:31:05Z
  assert.equal(live.quoteTime({ d: '20261029', t: '10:31:05' }), Date.parse('2026-10-29T02:31:05Z'));
  // 沒有可用的 t 就退回 tlong
  assert.equal(live.quoteTime({ d: '20261029', t: '-', ts: 1700000000000 }), 1700000000000);
  assert.equal(live.quoteTime({ d: '-', t: '-' }), null);
  assert.equal(live.quoteTime(null), null);
});

test('delaySec 算出報價距今幾秒，時鐘不對時不顯示', () => {
  const e = { d: '20261029', t: '10:31:05' };
  const quoted = Date.parse('2026-10-29T02:31:05Z');
  assert.equal(live.delaySec(e, quoted + 12_000), 12);
  assert.equal(live.delaySec(e, quoted + 500), 1); // 四捨五入
  assert.equal(live.delaySec(e, quoted), 0);
  assert.equal(live.delaySec(e, quoted - 5_000), 0); // 時鐘小幅落後 → 當作 0，不顯示負數
  assert.equal(live.delaySec(e, quoted - 120_000), null); // 時鐘明顯不對 → 不顯示
  assert.equal(live.delaySec(e, quoted + 3600_000), null); // 大到不合理 → 不顯示
  assert.equal(live.delaySec(null), null);
});

test('setTargets 去除重複頻道並回報是否有變動', () => {
  live.reset();
  assert.equal(live.setTargets([{ key: '^TWII', ch: 'tse_t00.tw' }, { key: 'x', ch: 'tse_t00.tw' }]), true);
  assert.equal(live.setTargets([{ key: '^TWII', ch: 'tse_t00.tw' }]), false); // 去重後其實一樣
  assert.equal(live.setTargets([{ key: '2330.TW', ch: 'tse_2330.tw' }]), true);
  live.reset();
});

test('tick 成功後覆蓋報價，失敗時保留原狀並記錄原因', async () => {
  live.reset();
  live.setTargets([{ key: '^TWII', ch: 'tse_t00.tw' }, { key: '2330.TW', ch: 'tse_2330.tw' }]);

  const body = {
    ok: true,
    at: new Date().toISOString(),
    q: [
      // 大小寫故意跟送出的不同，應該還是要對得上
      { ch: 'TSE_T00.TW', price: 27543.21, prev: 27499, chg: 44.21, pct: 0.16, vol: 4200, d: today(), t: '09:51:03' },
      { ch: 'tse_2330.tw', price: 1015, prev: 1010, chg: 5, pct: 0.5, vol: 900, d: today(), t: '09:51:03' },
    ],
  };
  let url = '';
  const okFetch = (u) => (url = u, Promise.resolve({ ok: true, json: () => Promise.resolve(body) }));

  assert.equal(await live.tick(okFetch), true);
  assert.match(url, /\/live\?ch=/);
  assert.match(decodeURIComponent(url), /tse_t00\.tw\|tse_2330\.tw/);
  assert.equal(live.get('^TWII').price, 27543.21);
  assert.equal(live.get('2330.TW').pct, 0.5);
  assert.equal(live.get('0050.TW'), null); // 沒追的標的不會有值
  assert.equal(live.info().count, 2);
  assert.equal(live.info().error, null);
  assert.equal(typeof live.get('^TWII').t, 'string');

  // Worker 回錯誤：維持上一次的值，並把原因留給「資料狀態」顯示
  const badFetch = () => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ ok: false, error: 'upstream' }) });
  assert.equal(await live.tick(badFetch), false);
  assert.equal(live.info().error, '證交所 MIS 沒有回應');
  assert.equal(live.get('^TWII').price, 27543.21);

  // 太久沒有成功更新就停止覆蓋，寧可顯示收盤價
  assert.equal(live.get('^TWII', Date.now() + 10 * 60000), null);
  live.reset();
});

test('關閉設定後完全不覆蓋也不連線', async () => {
  live.reset();
  live.setTargets([{ key: '^TWII', ch: 'tse_t00.tw' }]);
  live.configure({ enabled: false });
  let called = 0;
  assert.equal(await live.tick(() => (called++, Promise.reject(new Error('nope')))), false);
  assert.equal(called, 0);
  assert.equal(live.get('^TWII'), null);
  assert.equal(live.start(), false);
  live.reset();
});

// ── Worker 端的 MIS 解析 ──

test('normalizeMis 取出價格、昨收與漲跌', () => {
  const [q] = normalizeMis({
    msgArray: [{ ex: 'tse', ch: 't00.tw', n: '發行量加權股價指數', z: '27,543.21', y: '27,499.00', o: '27,600.00', h: '27,650.00', l: '27,500.00', v: '4,200', d: '20261029', t: '09:51:03', tlong: '1793...' }],
  });
  assert.equal(q.ch, 'tse_t00.tw');
  assert.equal(q.price, 27543.21); // 千分位要去掉
  assert.equal(q.prev, 27499);
  assert.equal(q.chg, 44.21);
  assert.equal(q.pct, 0.16);
  assert.equal(q.open, 27600);
  assert.equal(q.vol, 4200);
  assert.equal(q.d, '20261029');
  assert.equal(q.t, '09:51:03');
  assert.equal(q.ts, null); // 壞掉的 tlong 不要變成 NaN
});

test('normalizeMis 在沒有成交價時退回開盤、再退回昨收', () => {
  const rows = normalizeMis({
    msgArray: [
      { ex: 'tse', ch: '2330.tw', z: '-', o: '1,012.00', y: '1,010.00' },
      { ex: 'tse', ch: '2317.tw', z: '-', o: '-', y: '205.50' },
      { ex: 'tse', ch: '2454.tw', z: '-', o: '-', y: '-' }, // 完全沒有價格 → 丟掉
      { ex: 'otc', ch: '', z: '1' }, // 沒有頻道 → 丟掉
      null,
    ],
  });
  assert.deepEqual(rows.map((r) => [r.ch, r.price, r.chg]), [
    ['tse_2330.tw', 1012, 2],
    ['tse_2317.tw', 205.5, 0],
  ]);
});

test('normalizeMis 容忍空的或壞掉的回應', () => {
  assert.deepEqual(normalizeMis({}), []);
  assert.deepEqual(normalizeMis(null), []);
  assert.deepEqual(normalizeMis({ msgArray: 'nope' }), []);
});

// ── 後備來源：Yahoo ──

test('yahooSymbol 把 MIS 頻道轉成 Yahoo 代號', () => {
  assert.equal(yahooSymbol('tse_t00.tw'), '^TWII');
  assert.equal(yahooSymbol('otc_o00.tw'), '^TWOII');
  assert.equal(yahooSymbol('tse_2330.tw'), '2330.TW');
  assert.equal(yahooSymbol('otc_6488.tw'), '6488.TWO');
  assert.equal(yahooSymbol('tse_00679B.tw'), '00679B.TW');
  assert.equal(yahooSymbol('tse_xyz.tw'), null); // 其他指數沒有對應代號
  assert.equal(yahooSymbol('garbage'), null);
  assert.equal(yahooSymbol(null), null);
});

test('normalizeYahoo 整理成跟 MIS 一樣的形狀，時間換算成台北', () => {
  const ts = Date.parse('2026-10-29T02:33:00Z') / 1000; // 台北 10:33:00
  const q = normalizeYahoo({ chart: { result: [{ meta: {
    regularMarketPrice: 27543.21, chartPreviousClose: 27499, regularMarketTime: ts,
    regularMarketOpen: 27600, regularMarketDayHigh: 27650, regularMarketDayLow: 27500,
    regularMarketVolume: 4200, exchangeDataDelayedBy: 1200,
  } }] } }, 'tse_t00.tw');
  assert.equal(q.ch, 'tse_t00.tw');
  assert.equal(q.price, 27543.21);
  assert.equal(q.chg, 44.21);
  assert.equal(q.pct, 0.16);
  assert.equal(q.d, '20261029');
  assert.equal(q.t, '10:33:00');
  assert.equal(q.ts, ts * 1000);
  assert.equal(q.delayed, 1200);
});

test('normalizeYahoo 接受毫秒時間戳，並擋掉缺資料的回應', () => {
  const ms = Date.parse('2026-10-29T02:33:00Z');
  assert.equal(normalizeYahoo({ chart: { result: [{ meta: { regularMarketPrice: 1, regularMarketTime: ms } }] } }, 'x').ts, ms);
  assert.equal(normalizeYahoo({ chart: { result: [{ meta: { regularMarketTime: ms } }] } }, 'x'), null); // 沒有價格
  assert.equal(normalizeYahoo({ chart: { result: [] } }, 'x'), null);
  assert.equal(normalizeYahoo({}, 'x'), null);
  assert.equal(normalizeYahoo(null, 'x'), null);
});

test('退到 Yahoo 時每筆報價都標示來源，狀態也看得出來', async () => {
  live.reset();
  live.setTargets([{ key: '^TWII', ch: 'tse_t00.tw' }]);
  const body = { ok: true, src: 'yahoo', at: new Date().toISOString(), delay: 1200000, q: [
    { ch: 'tse_t00.tw', price: 27543.21, prev: 27499, chg: 44.21, pct: 0.16, vol: 4200, d: today(), t: '10:33:00' },
  ] };
  assert.equal(await live.tick(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })), true);
  assert.equal(live.get('^TWII').src, 'yahoo');
  assert.equal(live.info().src, 'yahoo');
  assert.equal(live.sourceOf('yahoo').label, 'Yahoo');
  assert.equal(live.sourceOf('mis').label, '即時');
  assert.equal(live.sourceOf(null).label, '即時'); // 舊版 Worker 沒有 src 欄位時當成 MIS
  live.reset();
});
