// 圖表座標軸的刻度計算（純函式）。

export function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  return nf * p;
}

export function ticks(min, max, target) {
  if (!(max > min)) return [min];
  const step = niceStep(max - min, target);
  const t0 = Math.ceil(min / step - 1e-9) * step;
  const out = [];
  for (let v = t0; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

export function decimalsFor(step) {
  if (step >= 1) return 0;
  return Math.min(6, Math.ceil(-Math.log10(step) + 1e-9));
}

/** 時間軸刻度：回傳 [{i, label}]，標籤間距至少 minGap 像素。dates 為 'YYYY-MM-DD'。 */
export function timeTicks(dates, i0, i1, xOf, minGap = 64) {
  const out = [];
  const count = i1 - i0 + 1;
  const bw = count > 1 ? Math.abs(xOf(i0 + 1) - xOf(i0)) : minGap;
  let lastX = -Infinity;
  const push = (i, label) => {
    const x = xOf(i);
    if (x - lastX >= minGap) {
      out.push({ i, label });
      lastX = x;
    }
  };
  if (count <= 70) {
    const step = Math.max(1, Math.ceil(minGap / bw));
    for (let i = i0; i <= i1; i += step) push(i, `${+dates[i].slice(5, 7)}/${+dates[i].slice(8, 10)}`);
  } else {
    for (let i = i0; i <= i1; i++) {
      const m = dates[i].slice(0, 7);
      if (i === i0 || m !== dates[i - 1].slice(0, 7)) {
        const mo = +dates[i].slice(5, 7);
        push(i, mo === 1 || i === i0 ? `${dates[i].slice(2, 4)}/${mo}` : `${mo}月`);
      }
    }
  }
  return out;
}
