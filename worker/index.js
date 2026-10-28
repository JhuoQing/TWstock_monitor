// 強制更新閘道：驗證管理密碼後，替網站呼叫 GitHub workflow_dispatch。
// 需要的 secret（用 wrangler secret put 設定，不要寫進程式或 wrangler.toml）：
//   ADMIN_PASSWORD  管理密碼
//   GITHUB_TOKEN    fine-grained PAT，只授權本 repo，權限 Actions: Read and write
// 一般變數（wrangler.toml 的 [vars]）：
//   GH_REPO, GH_WORKFLOW, GH_REF, ALLOWED_ORIGIN, COOLDOWN_SECONDS

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

function cors(env, origin) {
  const ok = origin && origin === env.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': ok ? origin : env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, origin) });
    if (req.method !== 'POST') return json(env, req, 405, { ok: false, error: 'method' });
    if (origin !== env.ALLOWED_ORIGIN) return json(env, req, 403, { ok: false, error: 'origin' });

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
