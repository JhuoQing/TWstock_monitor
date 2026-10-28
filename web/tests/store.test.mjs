import test from 'node:test';
import assert from 'node:assert/strict';

import * as S from '../assets/js/lib/store.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('watchlist toggle, order and persistence', () => {
  const st = fakeStorage();
  S.configure({ storage: st });
  assert.equal(S.toggleWatch('2330.TW'), true);
  S.toggleWatch('2317.TW');
  S.toggleWatch('6488');
  S.moveWatch('6488', -1);
  assert.deepEqual(S.get().watch, ['2330.TW', '6488', '2317.TW']);
  assert.equal(S.toggleWatch('2330.TW'), false);
  S.configure({ storage: st }); // 重新載入
  assert.deepEqual(S.get().watch, ['6488', '2317.TW']);
});

test('alerts fire once, then need re-arming', () => {
  S.configure({ storage: fakeStorage() });
  const id = S.addAlert({ sym: '2330.TW', op: '>=', value: 1000, note: '突破' });
  assert.ok(id);
  assert.equal(S.addAlert({ sym: 'x', op: '=', value: 1 }), null);
  assert.equal(S.checkAlerts(() => 990).length, 0);
  const hit = S.checkAlerts(() => 1010, '2026-10-28T00:00:00Z');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].price, 1010);
  assert.equal(S.checkAlerts(() => 1020).length, 0); // 已觸發
  S.rearmAlert(id);
  assert.equal(S.checkAlerts(() => 1020).length, 1);
  S.removeAlert(id);
  assert.equal(S.get().alerts.length, 0);
});

test('holdings validate input', () => {
  S.configure({ storage: fakeStorage() });
  assert.equal(S.setHolding('2330.TW', 1000, 900), true);
  assert.equal(S.setHolding('2330.TW', 0, 900), false);
  assert.equal(S.setHolding('2330.TW', 1000, -1), false);
  S.setHolding('2330.TW', 2000, 950);
  assert.deepEqual(S.get().holdings, [{ sym: '2330.TW', shares: 2000, cost: 950 }]);
  S.removeHolding('2330.TW');
  assert.equal(S.get().holdings.length, 0);
});

test('corrupt storage falls back to defaults; import sanitizes', () => {
  S.configure({ storage: fakeStorage({ 'twm:v2': '{not json' }) });
  assert.deepEqual(S.get().watch, []);
  assert.equal(S.get().settings.theme, 'auto');

  const bad = S.importJson('nope');
  assert.equal(bad.ok, false);
  assert.equal(S.importJson(JSON.stringify({ app: 'other' })).ok, false);

  const res = S.importJson(JSON.stringify({
    app: 'twstock-monitor', watch: ['2330.TW', 2330, '2330.TW', ''], settings: { theme: 'neon', ud: 'intl' },
    alerts: [{ id: 'a1', sym: 'x', op: '>=', value: 1 }, { id: 'a2', sym: 'x', op: '!!', value: 1 }],
    holdings: [{ sym: 'x', shares: 5, cost: 1 }, { sym: 'y', shares: -1, cost: 1 }],
  }));
  assert.deepEqual(res, { ok: true, watch: 1, alerts: 1, holdings: 1 });
  assert.equal(S.get().settings.theme, 'auto'); // 非法值回到預設
  assert.equal(S.get().settings.ud, 'intl');
  const round = JSON.parse(S.exportJson());
  assert.equal(round.app, 'twstock-monitor');
  S.clearAll();
  assert.equal(S.get().watch.length, 0);
});

test('subscribers are notified on update', () => {
  S.configure({ storage: fakeStorage() });
  let n = 0;
  const off = S.subscribe(() => n++);
  S.toggleWatch('a');
  S.setSetting('theme', 'dark');
  off();
  S.toggleWatch('b');
  assert.equal(n, 2);
  assert.equal(S.get().settings.theme, 'dark');
});

test('recent items are deduped, newest first, capped at 8', () => {
  S.configure({ storage: fakeStorage() });
  for (const k of ['a', 'b', 'c', 'a', 'd', 'e', 'f', 'g', 'h', 'i']) S.pushRecent(k);
  assert.deepEqual(S.get().recent, ['i', 'h', 'g', 'f', 'e', 'd', 'a', 'c']);
});
