// 「天際線」系列：把每個交易日畫成一棟大樓，樓高 = 收盤指數；最右邊（最新一日）的樓頂依當日漲跌亮紅或綠。
// 這是整個介面唯一刻意突出的視覺。

import { registerSeries } from './chart.js';
import { alpha, mix } from './color.js';

const rangeOf = (arr, i0, i1) => {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const v = arr[i];
    if (v == null) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return Number.isFinite(mn) ? [mn, mx] : null;
};

// 決定性的雜湊，讓每棟樓亮燈的窗戶固定、不會每次重畫就閃動
function hash(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

registerSeries('skyline', {
  range: (s, i0, i1) => rangeOf(s.c, i0, i1),
  draw(ctx, a, s) {
    const { rect, bw } = a;
    const bottom = rect.y + rect.h;
    const gap = bw >= 6 ? 2 : bw >= 3.5 ? 1 : 0;
    const w = Math.max(1, bw - gap);
    const lastI = s.c.length - 1;
    const revealX = rect.x + a.progress * rect.w;
    const lit = alpha(a.pal.lamp, 0.55);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y - 40, Math.max(0, revealX - rect.x), rect.h + 40);
    ctx.clip();

    // 樓體
    for (let i = a.i0; i <= a.i1; i++) {
      if (s.c[i] == null) continue;
      const x = a.x(i) - w / 2;
      const y = a.y(s.c[i]);
      const g = ctx.createLinearGradient(0, y, 0, bottom);
      g.addColorStop(0, mix(a.pal.sil, a.pal.lamp, 0.26));
      g.addColorStop(0.45, mix(a.pal.sil, a.pal.lamp, 0.07));
      g.addColorStop(1, mix(a.pal.sil, a.pal.bg, 0.4));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, bottom - y);
      // 窗戶：只在夠寬的樓上畫，集中在樓頂附近
      if (bw >= 4.5) {
        const pitch = bw >= 7 ? 5 : 3.5;
        const cols = Math.max(1, Math.floor((w - 2) / pitch));
        const rows = Math.min(12, Math.floor((bottom - y - 8) / 7));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const h = hash(i, r, c);
            if (h > 0.2) continue;
            ctx.fillStyle = h < 0.05 ? alpha(a.pal.lamp, 0.9) : lit;
            ctx.fillRect(x + 1.5 + c * pitch, y + 6 + r * 7, 2, 3);
          }
        }
      }
    }
    // 樓頂線：寬樓畫各自的屋頂，窄樓連成一條線
    ctx.strokeStyle = alpha(a.pal.lamp, 0.9);
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    for (let i = Math.max(0, a.i0 - 1); i <= Math.min(lastI, a.i1 + 1); i++) {
      if (s.c[i] == null) { pen = false; continue; }
      const y = a.y(s.c[i]);
      if (bw >= 4) {
        ctx.moveTo(a.x(i) - w / 2, y);
        ctx.lineTo(a.x(i) + w / 2, y);
      } else if (!pen) { ctx.moveTo(a.x(i), y); pen = true; } else ctx.lineTo(a.x(i), y);
    }
    ctx.stroke();
    ctx.restore();

    // 最新一日：樓頂加一條依漲跌著色的粗線（紅/綠），一眼看出今天的位置
    if (a.i1 === lastI && a.progress >= 0.98 && s.c[lastI] != null) {
      const cap = s.dir > 0 ? a.pal.up : s.dir < 0 ? a.pal.down : a.pal.lamp;
      const y = a.y(s.c[lastI]);
      ctx.strokeStyle = cap;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x(lastI) - w / 2, y);
      ctx.lineTo(a.x(lastI) + w / 2, y);
      ctx.stroke();
    }
  },
  legend(s, i) {
    return s.c[i] == null ? [] : [{ t: s.c[i].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), color: 'ink' }];
  },
});
