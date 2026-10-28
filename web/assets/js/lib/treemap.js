// Squarified treemap（Bruls、Huizing、van Wijk, 2000）。回傳每個項目的矩形，面積與 value 成正比。

/**
 * @param {{value:number}[]} items 需由大到小排序
 * @returns {{item:any,x:number,y:number,w:number,h:number}[]}
 */
export function squarify(items, x, y, w, h) {
  const list = items.filter((i) => i.value > 0);
  const total = list.reduce((s, i) => s + i.value, 0);
  if (!(total > 0) || !(w > 0) || !(h > 0)) return [];
  const k = (w * h) / total;
  const nodes = list.map((it) => ({ it, area: it.value * k }));
  const out = [];
  let rect = { x, y, w, h };
  let row = [];

  const sum = (r) => r.reduce((s, n) => s + n.area, 0);
  const worst = (r, side) => {
    const s = sum(r);
    let mx = -Infinity;
    let mn = Infinity;
    for (const n of r) {
      if (n.area > mx) mx = n.area;
      if (n.area < mn) mn = n.area;
    }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };

  function place(r, rc) {
    const s = sum(r);
    if (rc.w >= rc.h) {
      // 沿左側放一欄
      const cw = s / rc.h;
      let cy = rc.y;
      for (const n of r) {
        const nh = n.area / cw;
        out.push({ item: n.it, x: rc.x, y: cy, w: cw, h: nh });
        cy += nh;
      }
      return { x: rc.x + cw, y: rc.y, w: rc.w - cw, h: rc.h };
    }
    // 沿上方放一列
    const rh = s / rc.w;
    let cx = rc.x;
    for (const n of r) {
      const nw = n.area / rh;
      out.push({ item: n.it, x: cx, y: rc.y, w: nw, h: rh });
      cx += nw;
    }
    return { x: rc.x, y: rc.y + rh, w: rc.w, h: rc.h - rh };
  }

  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(rect.w, rect.h);
    const n = nodes[i];
    if (row.length === 0 || worst([...row, n], side) <= worst(row, side)) {
      row.push(n);
      i++;
    } else {
      rect = place(row, rect);
      row = [];
    }
  }
  if (row.length) place(row, rect);
  return out;
}

/** 兩層：先排類股，再在每個類股矩形內排個股（上方保留 header 高度放類股名稱）。 */
export function layoutSectors(sectors, w, h, header = 18, gap = 2) {
  const top = squarify(sectors.map((s) => ({ ...s, value: s.value })), 0, 0, w, h);
  return top.map((t) => {
    const hh = t.h > header * 2.2 && t.w > 56 ? header : 0;
    const inner = squarify(
      t.item.stocks.map((s) => ({ ...s, value: s.v })),
      t.x + gap / 2,
      t.y + hh + gap / 2,
      Math.max(0, t.w - gap),
      Math.max(0, t.h - hh - gap),
    );
    return { sector: t.item, x: t.x, y: t.y, w: t.w, h: t.h, header: hh, cells: inner };
  });
}
