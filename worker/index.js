// 兩個用途：
//   POST /          強制更新閘道：驗證管理密碼後，替網站呼叫 GitHub workflow_dispatch。
//   GET  /live      盤中即時行情代理：轉送證交所 MIS 快照給網頁（MIS 沒有 CORS 標頭，瀏覽器不能直接讀）。
// 需要的 secret（用 wrangler secret put 設定，不要寫進程式或 wrangler.toml）：
//   ADMIN_PASSWORD  管理密碼
//   GITHUB_TOKEN    fine-grained PAT，只授權本 repo，權限 Actions: Read and write
// 一般變數（wrangler.toml 的 [vars]）：
//   GH_REPO, GH_WORKFLOW, GH_REF, ALLOWED_ORIGIN（可用逗號分隔多個）, COOLDOWN_SECONDS

const enc = new TextEncoder();

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

// 常數時間比較：先各自雜湊成固定長度再逐位元比對，避免長度與時間洩漏
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const origins = (env) => String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);

function cors(env, origin) {
  const list = origins(env);
  const ok = origin && list.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (list[0] || '*'),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (env, req, status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env, req.headers.get('Origin')), ...extra },
  });

async function dispatch(env) {
  const url = `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${env.GH_WORKFLOW}/dispatches`;
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'twstock-admin-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: env.GH_REF || 'main' }),
  });
}

// 以 Cache API 當作簡易節流（每個 Cloudflare 資料中心各自計算，個人使用已足夠）
async function throttle(req, key, seconds) {
  const cache = caches.default;
  const k = new Request(`https://throttle.invalid/${key}`);
  if (await cache.match(k)) return true;
  await cache.put(k, new Response('1', { headers: { 'Cache-Control': `max-age=${seconds}` } }));
  return false;
}

// ───────────────────────── 即時行情（證交所 MIS） ─────────────────────────

const MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
// 允許的頻道：tse_2330.tw（上市）、otc_6488.tw（上櫃）、tse_t00.tw（加權指數）、otc_o00.tw（櫃買指數）
// 代號可能帶大寫字母（債券 ETF 如 00679B），一律保留原樣送給 MIS
const CH_RE = /^(tse|otc)_[0-9A-Za-z]{2,10}\.tw$/;
const MAX_CH = 40;
const LIVE_TTL = 10; // 邊緣快取秒數：MIS 自己的更新頻率約 5 秒，再快也沒有意義

const r2 = (x) => Math.round(x * 100) / 100;

function toNum(v) {
  if (v == null) return null;
  const x = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
}

/** 把 MIS 的 msgArray 整理成網頁要用的最小形狀。匯出供測試。 */
export function normalizeMis(j) {
  const arr = Array.isArray(j?.msgArray) ? j.msgArray : [];
  const out = [];
  for (const m of arr) {
    if (!m || !m.ex || !m.ch) continue;
    const ch = `${m.ex}_${m.ch}`;
    const prev = toNum(m.y);
    // z 是最近成交價；盤前與無成交時是 '-'，退回開盤價、再退回昨收
    const price = toNum(m.z) ?? toNum(m.o) ?? prev;
    if (price == null) continue;
    const chg = prev == null ? null : r2(price - prev);
    out.push({
      ch,
      price,
      prev,
      chg,
      pct: prev ? r2((price / prev - 1) * 100) : null,
      open: toNum(m.o),
      high: toNum(m.h),
      low: toNum(m.l),
      vol: toNum(m.v),
      d: typeof m.d === 'string' ? m.d : '',
      t: typeof m.t === 'string' ? m.t : '',
      ts: toNum(m.tlong),
    });
  }
  return out;
}

function parseChannels(raw) {
  const seen = new Set();
  for (const s of String(raw || '').split('|')) {
    const c = s.trim();
    if (CH_RE.test(c)) seen.add(c);
    if (seen.size >= MAX_CH) break;
  }
  return [...seen];
}

// MIS 對「看起來像機器人」的請求很敏感：沒有 session cookie、或 UA 一看就是程式，
// 後端會直接把連線丟掉（從 Worker 看到的是 HTTP 520，不是乾淨的 403）。
// 所以先訪問一次首頁拿 cookie，並且整組標頭都照真的瀏覽器送。
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MIS_HOME = 'https://mis.twse.com.tw/stock/index.jsp';
const COOKIE_TTL = 600; // 秒

function browserHeaders(extra = {}) {
  return {
    'User-Agent': BROWSER_UA,
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    ...extra,
  };
}

/** 取得（並快取）MIS 的 session cookie。拿不到就回空字串，讓呼叫端照樣試一次。 */
async function misCookie(force = false) {
  const cache = caches.default;
  const key = new Request('https://miscookie.invalid/');
  if (!force) {
    const hit = await cache.match(key);
    if (hit) return hit.text();
  }
  let cookie = '';
  try {
    const res = await fetch(MIS_HOME, {
      headers: browserHeaders({ Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }),
      signal: AbortSignal.timeout(8000),
    });
    // 只留 name=value，丟掉 Path/Expires 等屬性
    const raw = res.headers.get('set-cookie') || '';
    cookie = raw.split(/,(?=[^;]+?=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  } catch {
    cookie = '';
  }
  if (cookie) {
    await cache.put(key, new Response(cookie, { headers: { 'Cache-Control': `max-age=${COOKIE_TTL}` } }));
  }
  return cookie;
}

async function misRequest(chans, cookie) {
  const url = `${MIS_URL}?ex_ch=${encodeURIComponent(chans.join('|'))}&json=1&delay=0&_=${Date.now()}`;
  return fetch(url, {
    headers: browserHeaders({
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: MIS_HOME,
      Origin: 'https://mis.twse.com.tw',
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {}),
    }),
    signal: AbortSignal.timeout(8000),
  });
}

async function fetchMis(chans) {
  let res = await misRequest(chans, await misCookie());
  // cookie 過期時 MIS 同樣是丟連線而不是回 401，所以失敗就重拿一次 cookie 再試
  if (!res.ok) res = await misRequest(chans, await misCookie(true));
  if (!res.ok) throw new Error(`mis_http_${res.status}`);
  return res.json();
}

// ── 後備來源：Yahoo Finance ──
// MIS 連不上時至少還有盤中報價可看。延遲大約 15–20 分鐘，由 exchangeDataDelayedBy 告知，
// 前端會照實顯示，不會假裝成即時。
const YAHOO_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const MAX_YAHOO = 15; // 一個標的一個請求，要控制 Worker 的 subrequest 數量

/** MIS 頻道 → Yahoo 代號。tse_t00.tw → ^TWII、tse_2330.tw → 2330.TW、otc_6488.tw → 6488.TWO */
export function yahooSymbol(ch) {
  const m = /^(tse|otc)_([0-9A-Za-z]{2,10})\.tw$/.exec(String(ch || ''));
  if (!m) return null;
  const [, ex, code] = m;
  if (code === 't00') return '^TWII';
  if (code === 'o00') return '^TWOII';
  if (!/^\d/.test(code)) return null; // 其他指數代號沒有對應的 Yahoo 符號
  return `${code}.${ex === 'otc' ? 'TWO' : 'TW'}`;
}

/** 把 Yahoo chart 的回應整理成跟 normalizeMis 一樣的形狀。匯出供測試。 */
export function normalizeYahoo(j, ch) {
  const r = j?.chart?.result?.[0];
  const meta = r?.meta;
  if (!meta) return null;
  const price = toNum(meta.regularMarketPrice);
  const prev = toNum(meta.chartPreviousClose) ?? toNum(meta.previousClose);
  if (price == null) return null;
  const ts = toNum(meta.regularMarketTime);
  const at = ts == null ? null : (ts > 1e11 ? ts : ts * 1000); // 有時是秒、有時是毫秒
  const chg = prev == null ? null : r2(price - prev);
  return {
    ch,
    price,
    prev,
    chg,
    pct: prev ? r2((price / prev - 1) * 100) : null,
    open: toNum(meta.regularMarketOpen),
    high: toNum(meta.regularMarketDayHigh),
    low: toNum(meta.regularMarketDayLow),
    vol: toNum(meta.regularMarketVolume),
    d: at == null ? '' : new Date(at + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ''),
    t: at == null ? '' : new Date(at + 8 * 3600e3).toISOString().slice(11, 19),
    ts: at,
    delayed: toNum(meta.exchangeDataDelayedBy),
  };
}

async function fetchYahoo(chans) {
  const picked = chans.map((ch) => [ch, yahooSymbol(ch)]).filter(([, s]) => s).slice(0, MAX_YAHOO);
  if (!picked.length) throw new Error('yahoo_no_symbol');
  const settled = await Promise.allSettled(picked.map(async ([ch, sym]) => {
    const res = await fetch(`${YAHOO_URL}${encodeURIComponent(sym)}?range=1d&interval=1m`, {
      headers: browserHeaders({ Accept: 'application/json' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`yahoo_http_${res.status}`);
    return normalizeYahoo(await res.json(), ch);
  }));
  const out = settled.filter((s) => s.status === 'fulfilled' && s.value).map((s) => s.value);
  if (!out.length) {
    const why = settled.find((s) => s.status === 'rejected');
    throw new Error(why ? String(why.reason?.message || why.reason).slice(0, 40) : 'yahoo_empty');
  }
  return out;
}

async function live(req, env, url) {
  const chans = parseChannels(url.searchParams.get('ch'));
  if (!chans.length) return json(env, req, 400, { ok: false, error: 'no_channel' });

  const cache = caches.default;
  const key = new Request(`https://live.invalid/?ch=${[...chans].sort().join('|')}`);
  const hit = await cache.match(key);
  if (hit) {
    const body = await hit.json().catch(() => null);
    if (body) return json(env, req, 200, { ...body, cached: true });
  }

  const debug = url.searchParams.get('debug') === '1';
  const tried = [];

  // ── 第一順位：證交所 MIS（真即時，約 5–15 秒） ──
  let misRaw = null;
  try {
    misRaw = await fetchMis(chans);
    const code = String(misRaw?.rtcode ?? '');
    if (code && code !== '0000') {
      tried.push({ src: 'mis', error: 'rtcode', rtcode: code, message: String(misRaw?.rtmessage || '').slice(0, 80) });
      misRaw = null;
    }
  } catch (e) {
    tried.push({ src: 'mis', error: String(e?.message || e).slice(0, 80) });
  }
  if (url.searchParams.get('raw') === '1') return json(env, req, 200, misRaw ?? { tried }); // 除錯用，不進快取

  let body = null;
  if (misRaw) {
    const q = normalizeMis(misRaw);
    if (q.length) {
      body = { ok: true, src: 'mis', at: new Date().toISOString(), delay: toNum(misRaw?.userDelay), q };
    } else {
      tried.push({ src: 'mis', error: 'empty_after_parse' });
    }
  }

  // ── 第二順位：Yahoo（延遲約 15–20 分鐘，總比看昨天的收盤好） ──
  if (!body) {
    try {
      const q = await fetchYahoo(chans);
      body = { ok: true, src: 'yahoo', at: new Date().toISOString(), delay: (q[0]?.delayed ?? 0) * 1000 || null, q };
    } catch (e) {
      tried.push({ src: 'yahoo', error: String(e?.message || e).slice(0, 80) });
    }
  }

  if (!body) return json(env, req, 502, { ok: false, error: 'upstream', detail: tried.map((t) => `${t.src}: ${t.rtcode || t.error}`).join('; ').slice(0, 160), tried });
  if (debug) body.tried = tried; // 看得出來為什麼掉到後備來源

  await cache.put(key, new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `max-age=${LIVE_TTL}` },
  }));
  return json(env, req, 200, body, { 'Cache-Control': `public, max-age=${LIVE_TTL}` });
}

// ───────────────────────── 入口 ─────────────────────────

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, origin) });

    // 即時行情：唯讀的公開資料，不需要密碼。沒帶 Origin（curl 測試）也放行。
    if (url.pathname === '/live') {
      if (req.method !== 'GET') return json(env, req, 405, { ok: false, error: 'method' });
      if (origin && !origins(env).includes(origin)) return json(env, req, 403, { ok: false, error: 'origin' });
      return live(req, env, url);
    }

    if (req.method !== 'POST') return json(env, req, 405, { ok: false, error: 'method' });
    if (!origin || !origins(env).includes(origin)) return json(env, req, 403, { ok: false, error: 'origin' });

    let body;
    try { body = await req.json(); } catch { return json(env, req, 400, { ok: false, error: 'bad_json' }); }
    const pw = typeof body?.password === 'string' ? body.password.slice(0, 200) : '';

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    // 密碼錯誤：每個 IP 每 3 秒只能試一次，降低暴力破解速度
    if (await throttle(req, `try:${ip}`, 3)) return json(env, req, 429, { ok: false, error: 'slow_down' });

    if (!(await safeEqual(pw, env.ADMIN_PASSWORD || ''))) return json(env, req, 401, { ok: false, error: 'unauthorized' });

    // 驗證通過後，全站每 N 秒只允許觸發一次，避免連點讓部署排隊
    const cool = Number(env.COOLDOWN_SECONDS) || 300;
    if (await throttle(req, 'dispatch', cool)) return json(env, req, 429, { ok: false, error: 'cooldown', retry_after: cool });

    const res = await dispatch(env);
    if (res.status === 204) return json(env, req, 200, { ok: true });
    return json(env, req, 502, { ok: false, error: 'github', status: res.status });
  },

  // 選配：Cron Trigger 定時觸發，作為 GitHub 排程被跳過時的備援
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },
};
