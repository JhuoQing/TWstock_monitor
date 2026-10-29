// 盤中即時報價：向 Cloudflare Worker 的 /live 取得證交所 MIS 快照，覆蓋在排程產生的靜態資料之上。
//
// 為什麼要這一層：靜態資料由 GitHub Actions 排程產生，cron 本身就有 5–15 分鐘誤差，
// 再加上 Yahoo 的日 K 有時落後好幾個交易日，首頁報價可能停在前幾天。
// 這一層只在台股盤中運作，拿到的價格直接覆蓋顯示，但不寫進任何靜態檔，也不影響歷史與技術指標。
//
// 沒設定 Worker 網址、使用者關掉設定、非交易時段、或 MIS 連不上時，整層會安靜地退場，畫面維持原本的收盤資料。

import { WORKER_URL } from './admin.js';
import { todayTW } from './fmt.js';

const POLL_MS = 15000;
const BACKOFF_MS = [20000, 45000, 90000, 180000]; // 連續失敗時逐步放慢
const MAX_AGE_MS = 150000; // 超過這麼久沒有成功更新就停止覆蓋，寧可顯示收盤價也不要顯示過期的「即時」
const MAX_TARGETS = 40; // 一次請求的頻道上限，與 Worker 的 MAX_CH 一致
const TIMEOUT_MS = 8000;

const CODE_RE = /^(\d{4,6}[A-Z]?)(?:\.(TW|TWO))?$/;

/** 標的 key →  MIS 頻道。kind 用來判斷沒有後綴的代號是上市還是上櫃。回傳 null 表示不支援（美股、匯率、期貨等）。 */
export function misChannel(key, kind) {
  if (key === '^TWII') return 'tse_t00.tw';
  if (key === '^TWOII') return 'otc_o00.tw';
  const m = CODE_RE.exec(String(key || ''));
  if (!m) return null;
  const otc = m[2] === 'TWO' || (!m[2] && kind === 'otc');
  return `${otc ? 'otc' : 'tse'}_${m[1]}.tw`; // 代號保留原樣：債券 ETF 帶大寫字母
}

/** 台股盤中（含開盤前的試撮與收盤後的零股撮合尾段）。純函式，方便測試。 */
export function liveWindow(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = {};
  for (const p of f.formatToParts(now)) o[p.type] = p.value;
  if (o.weekday === 'Sat' || o.weekday === 'Sun') return false;
  const min = +o.hour * 60 + +o.minute;
  return min >= 8 * 60 + 45 && min <= 13 * 60 + 40;
}

const compactToday = (now) => todayTW(now).replace(/-/g, '');

/** MIS 的 'YYYYMMDD' → 'YYYY-MM-DD'；拿不到回傳 null。 */
export const isoDate = (e) => (e?.d && /^\d{8}$/.test(e.d) ? `${e.d.slice(0, 4)}-${e.d.slice(4, 6)}-${e.d.slice(6, 8)}` : null);

/** 這筆即時資料能不能用來覆蓋：必須是今天，而且今天已經有成交。 */
export function usable(e, now = new Date()) {
  if (!e || !Number.isFinite(e.price)) return false;
  if (e.d && e.d !== compactToday(now)) return false; // 休市日 MIS 會回上一個交易日
  return (e.vol ?? 0) > 0 || (e.chg ?? 0) !== 0; // 盤前沒有成交時 price 會退回昨收，不要當成即時
}

// ── 狀態 ──
const byKey = new Map();
const subs = new Set();
let targets = [];
let timer = null;
let fails = 0;
let lastAt = 0;
let lastError = null;
let enabled = true;
let running = false;

export const subscribe = (f) => (subs.add(f), () => subs.delete(f));
const emit = () => subs.forEach((f) => f());

/** 目前覆蓋中的即時資料；不可用或已過期回傳 null。 */
export function get(key, now = Date.now()) {
  if (!enabled || !lastAt || now - lastAt > MAX_AGE_MS) return null;
  const e = byKey.get(key);
  return usable(e, new Date(now)) ? e : null;
}

/** 給 UI 顯示的狀態。 */
export function info(now = Date.now()) {
  const fresh = !!lastAt && now - lastAt <= MAX_AGE_MS;
  return {
    configured: !!WORKER_URL,
    enabled,
    window: liveWindow(new Date(now)),
    running,
    fresh,
    at: lastAt || null,
    count: fresh ? [...byKey.keys()].filter((k) => get(k, now)).length : 0,
    error: lastError,
  };
}

/** 要追的標的：[{ key, ch }]。重複的頻道會合併，超過上限的忽略。 */
export function setTargets(list) {
  const seen = new Set();
  const next = [];
  for (const t of list || []) {
    if (!t?.key || !t?.ch || seen.has(t.ch)) continue;
    seen.add(t.ch);
    next.push({ key: t.key, ch: t.ch });
    if (next.length >= MAX_TARGETS) break;
  }
  const changed = next.length !== targets.length || next.some((t, i) => t.ch !== targets[i].ch);
  targets = next;
  return changed;
}

export function configure({ enabled: on }) {
  if (typeof on === 'boolean') enabled = on;
  if (!enabled) stop();
  emit();
}

async function fetchOnce(fetchFn = fetch) {
  const base = String(WORKER_URL).replace(/\/+$/, '');
  const url = `${base}/live?ch=${encodeURIComponent(targets.map((t) => t.ch).join('|'))}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctl.signal, cache: 'no-store' });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(j?.error ? `${j.error}` : `HTTP ${res.status}`);
    return j;
  } finally {
    clearTimeout(t);
  }
}

const ERRORS = {
  upstream: '證交所 MIS 沒有回應',
  mis: '證交所 MIS 回報錯誤',
  no_channel: '沒有可查詢的標的',
  origin: 'Worker 不接受這個來源',
  method: 'Worker 版本太舊，請重新部署',
};

function errorText(e) {
  const m = String(e?.message || e);
  if (e?.name === 'AbortError') return '連線逾時';
  if (m === 'Failed to fetch' || m.includes('NetworkError')) return '無法連線到 Worker';
  if (m === 'HTTP 404') return 'Worker 還沒有 /live，請重新部署';
  return ERRORS[m] || m.slice(0, 60);
}

/** 抓一次並更新狀態。回傳是否成功。匯出供測試與「立即重新讀取」使用。 */
export async function tick(fetchFn = fetch) {
  if (!WORKER_URL || !enabled || !targets.length) return false;
  try {
    const j = await fetchOnce(fetchFn);
    // MIS 回傳的頻道大小寫不一定跟送出的一致，比對時一律轉小寫
    const toKey = new Map(targets.map((t) => [t.ch.toLowerCase(), t.key]));
    for (const e of j.q || []) {
      const key = toKey.get(String(e?.ch || '').toLowerCase());
      if (key) byKey.set(key, e);
    }
    lastAt = Date.now();
    lastError = null;
    fails = 0;
    emit();
    return true;
  } catch (e) {
    fails++;
    lastError = errorText(e);
    emit();
    return false;
  }
}

function schedule() {
  clearTimeout(timer);
  if (!running) return;
  const wait = fails ? BACKOFF_MS[Math.min(fails - 1, BACKOFF_MS.length - 1)] : POLL_MS;
  timer = setTimeout(run, wait);
}

async function run() {
  if (!running) return;
  // 分頁在背景時不打擾伺服器；回到前景會由 start() 立刻補一次
  if (typeof document !== 'undefined' && document.hidden) return schedule();
  if (!liveWindow()) {
    running = false;
    emit();
    return;
  }
  await tick();
  schedule();
}

/** 盤中才會真的開始輪詢；非交易時段呼叫是安全的空操作。 */
export function start() {
  if (!WORKER_URL || !enabled || !targets.length || !liveWindow()) {
    stop();
    return false;
  }
  if (running) {
    // 已在跑：只有在資料明顯過舊時才補抓，避免切換分頁就打一次
    if (!lastAt || Date.now() - lastAt > POLL_MS) {
      clearTimeout(timer);
      run();
    }
    return true;
  }
  running = true;
  emit();
  clearTimeout(timer);
  run();
  return true;
}

export function stop() {
  clearTimeout(timer);
  timer = null;
  if (running) {
    running = false;
    emit();
  }
}

/** 測試用：清掉所有狀態。 */
export function reset() {
  stop();
  byKey.clear();
  targets = [];
  fails = 0;
  lastAt = 0;
  lastError = null;
  enabled = true;
}
