// 取得 pipeline 產出的靜態 JSON。資料檔都在同源的 data/ 底下。

import { symFile } from './fmt.js';

const BASE = 'data/';
const cache = new Map();

async function getJson(path, { fresh = false, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    // 以分鐘為單位的查詢字串：避開 CDN／瀏覽器的舊副本，又不會每次都重抓
    const q = fresh ? `?t=${Math.floor(Date.now() / 60000)}` : '';
    const res = await fetch(BASE + path + q, { signal: ctl.signal, cache: fresh ? 'no-cache' : 'default' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const loadIndex = () => getJson('index.json', { fresh: true });
export const loadUniverse = () => getJson('universe.json', { fresh: true });

/** 單一追蹤標的的日 K。同一個 session 內重複開啟會用快取。 */
export async function loadHistory(symbol) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.t < 10 * 60000) return hit.v;
  const v = await getJson(`sym/${symFile(symbol)}.json`, { fresh: true });
  cache.set(symbol, { t: Date.now(), v });
  return v;
}

export const loadMacroHistory = () => getJson('macro_history.json', { fresh: true });

export function clearCache() {
  cache.clear();
}
