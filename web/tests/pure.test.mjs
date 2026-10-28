import test from 'node:test';
import assert from 'node:assert/strict';

import { html, raw, esc, safeUrl } from '../assets/js/lib/html.js';
import * as F from '../assets/js/lib/fmt.js';
import * as I from '../assets/js/lib/indicators.js';
import { squarify, layoutSectors } from '../assets/js/lib/treemap.js';
import { ticks, niceStep, decimalsFor, timeTicks } from '../assets/js/charts/scale.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('html`` escapes interpolations but not nested html or raw', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  assert.equal(String(html`<p>${evil}</p>`), '<p>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p>');
  assert.equal(String(html`<ul>${[1, 2].map((n) => html`<li>${n}</li>`)}</ul>`), '<ul><li>1</li><li>2</li></ul>');
  assert.equal(String(html`${raw('<b>x</b>')}${null}${false}${undefined}`), '<b>x</b>');
  assert.equal(String(html`<a title="${'" onmouseover="x'}">`), '<a title="&quot; onmouseover=&quot;x">');
  assert.equal(esc(null), '');
});

test('safeUrl only allows http(s)', () => {
  assert.equal(safeUrl('https://a.com/x?y=1'), 'https://a.com/x?y=1');
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,hi'), '#');
  assert.equal(safeUrl('//evil.com'), '#');
  assert.equal(safeUrl(undefined), '#');
});

test('formatters', () => {
  assert.equal(F.num(1234.5), '1,234.50');
  assert.equal(F.num(null), '—');
  assert.equal(F.pct(1.234), '+1.23%');
  assert.equal(F.pct(-0.5), '-0.50%');
  assert.equal(F.pct(0), '0.00%');
  assert.equal(F.cls(-1) + F.cls(1) + F.cls(0), 'downupflat');
  assert.equal(F.yi(3500), '3,500 億');
  assert.equal(F.yi(25000), '2.50 兆');
  assert.equal(F.yi(12.34), '12.3 億');
  assert.equal(F.lots(12345), '1.2 萬張');
  assert.equal(F.price(1005.5), '1,005.50');
  assert.equal(F.price(0.5), '0.5000');
  assert.equal(F.dateShort('2026-10-07'), '10/7');
  assert.equal(F.ago('2026-10-28T10:00:00Z', Date.parse('2026-10-28T10:30:00Z')), '30 分鐘前');
  assert.equal(F.ago('2026-10-28T10:00:00Z', Date.parse('2026-10-28T13:00:00Z')), '3 小時前');
  assert.equal(F.todayTW(new Date('2026-10-28T17:00:00Z')), '2026-10-29'); // 台北已過午夜
});

test('symFile matches the Python pipeline', () => {
  assert.equal(F.symFile('^TWII'), '_TWII');
  assert.equal(F.symFile('GC=F'), 'GC_F');
  assert.equal(F.symFile('TWD=X'), 'TWD_X');
  assert.equal(F.symFile('2330.TW'), '2330.TW');
  assert.equal(F.symFile('BTC-USD'), 'BTC-USD');
  assert.equal(F.symFile('DX-Y.NYB'), 'DX-Y.NYB');
});

test('sma / ema / rsi (Wilder reference) / boll', () => {
  assert.deepEqual(I.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = I.ema([10, 10, 10, 20], 3);
  assert.equal(e[0], 10);
  close(e[3], 15);
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const r = I.rsi(closes, 14);
  assert.ok(r.slice(0, 14).every((v) => v === null));
  assert.ok(Math.abs(r[14] - 70.53) < 0.1, String(r[14]));
  assert.equal(I.rsi(Array.from({ length: 30 }, (_, i) => i + 1)).at(-1), 100);
  const b = I.boll([1, 2, 3, 4, 5], 5, 2);
  close(b.m[4], 3);
  close(b.u[4], 3 + 2 * Math.sqrt(2));
  close(b.l[4], 3 - 2 * Math.sqrt(2));
});

test('macd and kd basics', () => {
  const up = Array.from({ length: 60 }, (_, i) => 100 + i);
  const m = I.macd(up);
  assert.ok(m.m.at(-1) > 0 && m.h.length === 60);
  const h = up.map((v) => v + 1);
  const l = up.map((v) => v - 1);
  const { k, d } = I.kd(h, l, up, 9);
  assert.equal(k[7], null);
  assert.ok(k.at(-1) > 70 && d.at(-1) > 60 && k.at(-1) <= 100);
  const flat = Array(20).fill(5);
  close(I.kd(flat, flat, flat).k.at(-1), 50, 1e-9);
});

test('normalize and volatility', () => {
  assert.deepEqual(I.normalize([100, 110, 90], 0).map((v) => Math.round(v * 1e6) / 1e6), [0, 10, -10]);
  assert.deepEqual(I.normalize([100, 110, 90], 1).map((v) => v && Math.round(v * 100) / 100), [null, 0, -18.18]);
  assert.equal(I.volatility([1, 2, 3]), null);
  const flat = Array(30).fill(100);
  assert.equal(I.volatility(flat), 0);
});

test('squarify: areas proportional, inside bounds, no overlap', () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ value: v, id: i }));
  const W = 600;
  const H = 400;
  const out = squarify(items, 0, 0, W, H);
  assert.equal(out.length, items.length);
  const total = items.reduce((s, i) => s + i.value, 0);
  for (const r of out) {
    close((r.w * r.h) / (W * H), r.item.value / total, 1e-9);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6);
  }
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(!(ox > 1e-6 && oy > 1e-6), `overlap ${i}/${j}`);
    }
  }
  assert.deepEqual(squarify([], 0, 0, 10, 10), []);
  assert.deepEqual(squarify([{ value: 0 }], 0, 0, 10, 10), []);
});

test('layoutSectors nests stocks inside their sector', () => {
  const sectors = [
    { name: 'A', value: 70, stocks: [{ c: '1', v: 40 }, { c: '2', v: 30 }] },
    { name: 'B', value: 30, stocks: [{ c: '3', v: 30 }] },
  ];
  const lay = layoutSectors(sectors, 500, 300, 18, 2);
  assert.equal(lay.length, 2);
  for (const s of lay) {
    for (const c of s.cells) {
      assert.ok(c.x >= s.x - 1e-6 && c.y >= s.y + s.header - 1e-6 && c.x + c.w <= s.x + s.w + 1e-6 && c.y + c.h <= s.y + s.h + 1e-6);
    }
  }
});

test('axis ticks', () => {
  assert.deepEqual(ticks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(ticks(0.1, 0.5, 4), [0.1, 0.2, 0.3, 0.4, 0.5]);
  assert.equal(niceStep(100, 5), 20);
  assert.equal(decimalsFor(0.05), 2);
  assert.equal(decimalsFor(5), 0);
  assert.deepEqual(ticks(5, 5, 4), [5]);
});

test('timeTicks: days for short ranges, months for long ranges', () => {
  const dates = Array.from({ length: 250 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  const x = (i) => i * 4;
  const short = timeTicks(dates, 200, 230, x, 64);
  assert.ok(short.length >= 2 && /^\d+\/\d+$/.test(short[0].label));
  const long = timeTicks(dates, 0, 249, x, 64);
  assert.ok(long.some((t) => /月$/.test(t.label)) && long[0].label === '26/1');
  for (let i = 1; i < long.length; i++) assert.ok(x(long[i].i) - x(long[i - 1].i) >= 64);
});
