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

async function fetchMis(chans) {
  const url = `${MIS_URL}?ex_ch=${encodeURIComponent(chans.join('|'))}&json=1&delay=0&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      // MIS 會看這兩個標頭，缺了可能被擋
      Referer: 'https://mis.twse.com.tw/stock/index.jsp',
      'User-Agent': 'Mozilla/5.0 (compatible; twstock-monitor/1.0)',
      Accept: 'application/json, text/plain, */*',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`mis_http_${res.status}`);
  return res.json();
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

  let raw;
  try {
    raw = await fetchMis(chans);
  } catch (e) {
    return json(env, req, 502, { ok: false, error: 'upstream', detail: String(e?.message || e).slice(0, 80) });
  }
  const code = String(raw?.rtcode ?? '');
  if (code && code !== '0000') {
    return json(env, req, 502, { ok: false, error: 'mis', rtcode: code, message: String(raw?.rtmessage || '').slice(0, 80) });
  }
  if (url.searchParams.get('raw') === '1') return json(env, req, 200, raw); // 除錯用，不進快取

  const body = { ok: true, at: new Date().toISOString(), delay: toNum(raw?.userDelay), q: normalizeMis(raw) };
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
