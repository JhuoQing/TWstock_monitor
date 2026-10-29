// Service worker：讓網站可安裝、離線時仍能看到上一次的畫面。
// 資料（data/）一律先走網路、失敗才用快取；程式與樣式採 stale-while-revalidate。
const VERSION = 'twm-v2-2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'assets/css/app.css', 'assets/js/boot.js', 'assets/js/main.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function put(req, res) {
  if (res && res.ok && res.type === 'basic') {
    const c = await caches.open(VERSION);
    await c.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 字型等第三方資源交給瀏覽器處理

  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req).then((r) => put(req, r)).catch(() => caches.match(req).then((r) => r || Response.error())),
    );
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((r) => put(req, r)).catch(() => hit);
      return hit || net;
    }),
  );
});
