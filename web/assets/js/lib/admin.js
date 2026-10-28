// 強制更新：把管理密碼送到 Cloudflare Worker，由 Worker 驗證後觸發 GitHub Actions。
// 密碼只在送出時存在記憶體，不寫入 localStorage。部署 Worker 後把網址填在下面（見 worker/README.md）。

export const WORKER_URL = ''; // 例如 'https://twstock-admin.<你的子網域>.workers.dev'

const MSG = {
  unauthorized: '密碼錯誤',
  slow_down: '操作太快，請稍後再試',
  cooldown: '剛剛已觸發過更新，請稍候幾分鐘',
  github: 'GitHub 拒絕了請求，請檢查 Worker 的 token 權限',
  origin: '來源不被允許',
};

export async function forceUpdate(password, fetchFn = fetch) {
  if (!WORKER_URL) return { ok: false, error: '尚未設定 Worker 網址' };
  try {
    const res = await fetchFn(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) return { ok: true };
    return { ok: false, error: MSG[j.error] || `失敗（${res.status}）` };
  } catch {
    return { ok: false, error: '無法連線到 Worker' };
  }
}
