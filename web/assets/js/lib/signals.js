// 技術訊號的顯示資訊。訊號由 pipeline 以日 K 計算，這裡只負責文字與分組。
// 方向（bull／bear／neu）是依訊號本身的定義，不代表任何買賣建議。

export const SIGNALS = {
  golden_cross: { label: '黃金交叉', dir: 'bull', hint: '5 日線近 3 日內上穿 20 日線' },
  death_cross: { label: '死亡交叉', dir: 'bear', hint: '5 日線近 3 日內下穿 20 日線' },
  breakout20: { label: '突破 20 日高', dir: 'bull', hint: '收盤高於前 20 日最高價' },
  breakdown20: { label: '跌破 20 日低', dir: 'bear', hint: '收盤低於前 20 日最低價' },
  vol_surge: { label: '爆量', dir: 'neu', hint: '成交量達 20 日均量 2 倍以上' },
  rsi_overbought: { label: 'RSI 偏高', dir: 'neu', hint: 'RSI(14) ≥ 70' },
  rsi_oversold: { label: 'RSI 偏低', dir: 'neu', hint: 'RSI(14) ≤ 30' },
  ma_bull: { label: '均線多頭', dir: 'bull', hint: '5 日 > 20 日 > 60 日，且收盤在 20 日線上' },
  ma_bear: { label: '均線空頭', dir: 'bear', hint: '5 日 < 20 日 < 60 日，且收盤在 20 日線下' },
  new_high: { label: '逼近一年高', dir: 'bull', hint: '收盤在 52 週高點附近' },
};

export const SCAN_ORDER = ['golden_cross', 'breakout20', 'new_high', 'vol_surge', 'rsi_overbought', 'rsi_oversold', 'death_cross', 'breakdown20'];

export const sigInfo = (code) => SIGNALS[code] || { label: code, dir: 'neu', hint: '' };

/** 依訊號分組（只含個股與 ETF），每組最多 limit 檔，依漲跌幅排序。 */
export function scan(quotes, limit = 8) {
  const groups = {};
  for (const q of quotes) {
    if (q.kind !== 'stock' && q.kind !== 'etf') continue;
    for (const s of q.signals || []) (groups[s] ||= []).push(q);
  }
  return SCAN_ORDER.filter((s) => groups[s]?.length).map((s) => ({
    code: s,
    ...sigInfo(s),
    list: groups[s].sort((a, b) => b.pct - a.pct).slice(0, limit),
    total: groups[s].length,
  }));
}
