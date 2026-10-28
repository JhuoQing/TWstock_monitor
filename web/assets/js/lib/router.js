// Hash 路由：#/overview、#/market/<heat|rank|chips|events|global>、#/mine、#/news、#/macro、#/s/<代號>
// 個股頁是疊在目前頁面上的側邊欄，所以 parse 只回報 sym，不改變底下的 view。

export const VIEWS = ['overview', 'market', 'mine', 'news', 'macro'];
export const MARKET_SUBS = ['heat', 'rank', 'chips', 'events', 'global'];

export function parse(hash) {
  let h = String(hash || '').replace(/^#/, '');
  // 舊版連結 #2330.TW
  if (h && !h.startsWith('/')) h = `/s/${h}`;
  const seg = h.split('/').filter(Boolean).map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
  if (seg[0] === 's' && seg[1]) return { sym: seg[1] };
  const view = VIEWS.includes(seg[0]) ? seg[0] : 'overview';
  let sub = seg[1] || '';
  if (view === 'market' && !MARKET_SUBS.includes(sub)) sub = 'heat';
  if (view !== 'market') sub = '';
  return { view, sub };
}

export function href(route) {
  if (route.sym) return `#/s/${encodeURIComponent(route.sym)}`;
  return `#/${route.view}${route.sub ? '/' + route.sub : ''}`;
}

export function go(route) {
  const next = typeof route === 'string' ? route : href(route);
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}
