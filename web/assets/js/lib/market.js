// 台股交易時段與資料新鮮度。純函式，方便測試。

const TZ = 'Asia/Taipei';

function parts(now) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = {};
  for (const p of f.formatToParts(now)) o[p.type] = p.value;
  return { wd: o.weekday, min: +o.hour * 60 + +o.minute };
}

/** 'open'（盤中）、'pre'（開盤前）、'post'（已收盤）、'weekend'。不含國定假日。 */
export function session(now = new Date()) {
  const { wd, min } = parts(now);
  if (wd === 'Sat' || wd === 'Sun') return 'weekend';
  if (min < 9 * 60) return 'pre';
  if (min <= 13 * 60 + 30) return 'open';
  return 'post';
}

export const SESSION_LABEL = { open: '盤中', pre: '盤前', post: '已收盤', weekend: '休市' };

/** 資料距今多久；盤中超過 90 分鐘、其他時間超過 3 天視為過期。 */
export function freshness(updatedAt, now = new Date()) {
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return { mins: null, level: 'unknown' };
  const mins = Math.max(0, (now.getTime() - t) / 60000);
  const open = session(now) === 'open';
  const limit = open ? 90 : 3 * 1440;
  return { mins, level: mins > limit ? 'stale' : mins > limit / 2 && open ? 'late' : 'fresh' };
}

/** 頁首狀態燈。 */
export function status(index, now = new Date()) {
  const s = session(now);
  if (!index) return { cls: '', text: '載入中', detail: '' };
  const f = freshness(index.updated_at, now);
  const stale = f.level === 'stale';
  const dataOpen = s === 'open' && !stale;
  return {
    cls: stale ? 'is-warn' : dataOpen ? 'is-open' : '',
    text: stale ? '資料過期' : SESSION_LABEL[s],
    session: s,
    stale,
    mins: f.mins,
  };
}

/** 失敗的資料來源（sources 內 ok=false）。 */
export function failedSources(sources) {
  return Object.entries(sources || {}).filter(([, v]) => v && v.ok === false).map(([k]) => k);
}

export const SOURCE_LABEL = {
  quotes: '個股／指數報價（Yahoo Finance）',
  twse_daily: '證交所 · 上市每日行情',
  twse_profile: '證交所 · 公司產業別',
  tpex_daily: '櫃買中心 · 上櫃每日行情',
  twse_institutional: '證交所 · 三大法人買賣超',
  twse_t86: '證交所 · 個股法人買賣超',
  twse_margin: '證交所 · 融資融券',
  twse_turnover: '證交所 · 成交金額',
  taifex_oi: '期交所 · 外資期貨未平倉',
  twse_dividends: '證交所 · 除權息預告',
  twse_notices: '證交所 · 注意／處置股',
  news: '新聞 RSS',
  fred: '總體經濟（FRED）',
};
