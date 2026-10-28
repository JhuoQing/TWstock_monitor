// 自製 Canvas 時間序列圖表引擎：多窗格（價格／成交量／指標）、K 線、十字游標、縮放與平移。
// 沒有任何外部相依。系列型別以 registerSeries() 註冊，hero 的「天際線」就是額外註冊的一種型別。

import { ticks, decimalsFor, timeTicks } from './scale.js';
import { alpha } from './color.js';

const REG = new Map();
export function registerSeries(kind, impl) {
  REG.set(kind, impl);
}

const TOKENS = ['up', 'down', 'lamp', 'mute', 'faint', 'ink', 'sil', 'edge', 'surface', 'bg'];
const FONT = '11px "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const p = {};
  for (const t of TOKENS) p[t] = cs.getPropertyValue('--' + t).trim() || '#888';
  return p;
}

const defaultFmt = (step) => {
  const d = decimalsFor(step);
  return (v) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

export class TimeChart {
  /**
   * @param {HTMLElement} host 需有明確高度、position:relative
   * @param {{pad?:number,minBars?:number,axisW?:number,axisH?:number,intro?:number,wheelZoom?:'always'|'modifier',label?:string,title?:string}} opts
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = { pad: 4, minBars: 12, axisW: 58, axisH: 22, intro: 0, wheelZoom: 'always', ...opts };
    this.base = document.createElement('canvas');
    this.over = document.createElement('canvas');
    this.base.className = 'tc-canvas';
    this.over.className = 'tc-canvas tc-over';
    this.over.tabIndex = 0;
    this.over.setAttribute('role', 'img');
    if (opts.label) this.over.setAttribute('aria-label', opts.label);
    host.append(this.base, this.over);

    this.model = null;
    this.n = 0;
    this.view = { start: 0, count: 100 };
    this.defaultCount = null;
    this.hover = null;
    this.ptrs = new Map();
    this.drag = null;
    this.pinch = null;
    this.listeners = { hover: [] };
    this.palette = readPalette();
    this.progress = 1;
    this._introDone = false;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;

    this._bind();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(host);
    this._onTheme = () => {
      this.palette = readPalette();
      this.draw();
    };
    window.addEventListener('themechange', this._onTheme);
  }

  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
    return this;
  }

  _emit(type, payload) {
    for (const f of this.listeners[type] || []) f(payload);
  }

  // ───────── 模型與視窗 ─────────
  setModel(model, { count } = {}) {
    this.model = model;
    this.n = model.x.length;
    this.hover = null;
    this.defaultCount = count ?? this.defaultCount ?? Math.min(this.n, 130);
    this.setCount(count ?? this.view.count ?? this.defaultCount);
    if (this.opts.intro && !this._introDone) this._startIntro();
    this.draw();
  }

  setCount(count) {
    const n = this.n;
    const pad = this.opts.pad;
    const c = clamp(count, Math.min(this.opts.minBars, n + pad), n + pad);
    this.view.count = c;
    this.view.start = n + pad - c;
  }

  resetView() {
    this.setCount(this.defaultCount || this.n);
    this.hover = null;
    this.draw();
  }

  _clampStart() {
    const max = this.n + this.opts.pad - this.view.count;
    this.view.start = clamp(this.view.start, 0, Math.max(0, max));
  }

  _startIntro() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this._introDone = true;
      return;
    }
    const t0 = performance.now();
    const dur = this.opts.intro;
    const tick = () => {
      const t = performance.now() - t0;
      this.progress = clamp(t / dur, 0, 1);
      this.lampT = clamp((t - dur) / 500, 0, 1);
      this.draw();
      if (t < dur + 520) this._raf = requestAnimationFrame(tick);
      else {
        this._introDone = true;
        this.progress = 1;
        this.lampT = 1;
        this.draw();
      }
    };
    this.progress = 0;
    this.lampT = 0;
    this._raf = requestAnimationFrame(tick);
  }

  resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    for (const c of [this.base, this.over]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    this.draw();
  }

  destroy() {
    this._ro.disconnect();
    window.removeEventListener('themechange', this._onTheme);
    cancelAnimationFrame(this._raf);
    this.base.remove();
    this.over.remove();
  }

  // ───────── 座標 ─────────
  _layout() {
    const { axisW, axisH } = this.opts;
    const left = 6;
    const right = this.w - axisW;
    const top = 4;
    const bottom = this.h - axisH;
    const panes = this.model.panes;
    const total = panes.reduce((s, p) => s + (p.weight ?? 1), 0);
    const gap = 6;
    const usable = bottom - top - gap * (panes.length - 1);
    let y = top;
    this.rects = panes.map((p) => {
      const h = (usable * (p.weight ?? 1)) / total;
      const r = { x: left, y, w: right - left, h };
      y += h + gap;
      return r;
    });
    this.plot = { left, right, top, bottom, w: right - left };
  }

  _xOf = (i) => this.plot.left + ((i + 0.5 - this.view.start) / this.view.count) * this.plot.w;
  _idxAt = (x) => clamp(Math.round(((x - this.plot.left) / this.plot.w) * this.view.count + this.view.start - 0.5), 0, this.n - 1);

  _visible() {
    return {
      i0: Math.max(0, Math.floor(this.view.start)),
      i1: Math.min(this.n - 1, Math.ceil(this.view.start + this.view.count) - 1),
    };
  }

  _yRange(p, i0, i1) {
    if (p.range) return [...p.range];
    let mn = Infinity;
    let mx = -Infinity;
    for (const s of p.series) {
      const r = REG.get(s.kind)?.range?.(s, i0, i1);
      if (r) {
        mn = Math.min(mn, r[0]);
        mx = Math.max(mx, r[1]);
      }
    }
    if (!Number.isFinite(mn)) {
      mn = 0;
      mx = 1;
    }
    if (mx === mn) {
      mx += 1;
      mn -= 1;
    }
    const d = mx - mn;
    if (p.zeroBase) {
      mn = Math.min(0, mn);
      mx += d * (p.padTop ?? 0.08);
    } else {
      mx += d * (p.padTop ?? 0.06);
      mn -= d * (p.padBottom ?? 0.06);
    }
    return [mn, mx];
  }

  col = (c) => this.palette[c] || c;

  // ───────── 繪製 ─────────
  draw() {
    if (!this.model || !this.w) return;
    const ctx = this.base.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this._layout();
    const { i0, i1 } = this._visible();
    const pal = this.palette;
    const bw = this.plot.w / this.view.count;
    const panes = this.model.panes;

    panes.forEach((p, k) => {
      const r = this.rects[k];
      const [mn, mx] = this._yRange(p, i0, i1);
      const y = (v) => r.y + ((mx - v) / (mx - mn)) * r.h;
      p._r = r;
      p._min = mn;
      p._max = mx;
      p._y = y;
      p._v = (py) => mx - ((py - r.y) / r.h) * (mx - mn);

      // 格線與右側刻度
      const step = ticks(mn, mx, Math.max(2, Math.floor(r.h / 44)));
      const fmt = p.fmt || defaultFmt(step.length > 1 ? step[1] - step[0] : 1);
      p._fmt = fmt;
      ctx.save();
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.lineWidth = 1;
      for (const t of step) {
        const ty = Math.round(y(t)) + 0.5;
        if (ty < r.y - 1 || ty > r.y + r.h + 1) continue;
        ctx.strokeStyle = alpha(pal.edge, 0.55);
        ctx.beginPath();
        ctx.moveTo(r.x, ty);
        ctx.lineTo(r.x + r.w, ty);
        ctx.stroke();
        ctx.fillStyle = pal.mute;
        ctx.fillText(fmt(t), r.x + r.w + 6, ty);
      }
      ctx.restore();

      // 圖面（裁切在窗格內）
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      for (const g of p.guides || []) {
        const gy = Math.round(y(g)) + 0.5;
        ctx.strokeStyle = alpha(pal.faint, 0.7);
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(r.x, gy);
        ctx.lineTo(r.x + r.w, gy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const api = { ctx, x: this._xOf, y, pal, col: this.col, bw, i0, i1, rect: r, pane: p, progress: this.progress, lampT: this.lampT ?? 1, n: this.n, plot: this.plot };
      for (const s of p.series) REG.get(s.kind)?.draw(ctx, api, s);
      if (p.lastLine) {
        const ly = Math.round(y(p.lastLine.value)) + 0.5;
        ctx.strokeStyle = alpha(this.col(p.lastLine.color || 'mute'), 0.8);
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(r.x, ly);
        ctx.lineTo(r.x + r.w, ly);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

      if (p.lastLine) {
        const ly = y(p.lastLine.value);
        if (ly > r.y && ly < r.y + r.h) this._tag(ctx, fmt(p.lastLine.value), r.x + r.w + 2, ly, this.col(p.lastLine.color || 'mute'), pal.bg);
      }
    });

    // 時間軸
    ctx.save();
    ctx.font = FONT;
    ctx.fillStyle = pal.mute;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ty = this.plot.bottom + this.opts.axisH / 2 + 1;
    for (const t of timeTicks(this.model.x, i0, i1, this._xOf, 64)) {
      const x = this._xOf(t.i);
      if (x < this.plot.left + 14 || x > this.plot.right - 14) continue;
      ctx.fillText(t.label, x, ty);
    }
    ctx.restore();

    this._drawOver();
  }

  _tag(ctx, text, x, y, bg, fg) {
    ctx.save();
    ctx.font = FONT;
    const w = ctx.measureText(text).width + 10;
    const h = 17;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect?.(x, y - h / 2, w, h, 3);
    if (!ctx.roundRect) ctx.rect(x, y - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 5, y + 0.5);
    ctx.restore();
  }

  _drawOver() {
    const ctx = this.over.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.model || !this.plot) return;
    const { i0, i1 } = this._visible();
    const idx = this.hover ? this.hover.i : i1;
    const pal = this.palette;
    const api = { x: this._xOf, pal, col: this.col, n: this.n };

    // 圖例（左上角）：游標所在那根（沒有游標時為最右一根）的數值
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    this.model.panes.forEach((p) => {
      const r = p._r;
      if (!r) return;
      let x = r.x + 6;
      const y = r.y + 10;
      const segs = [];
      if (p.title) segs.push({ t: p.title, color: 'mute' });
      for (const s of p.series) segs.push(...(REG.get(s.kind)?.legend?.(s, idx, { ...api, pane: p }) || []));
      for (const sg of segs) {
        const w = ctx.measureText(sg.t).width;
        if (x + w > r.x + r.w - 4) break;
        ctx.fillStyle = alpha(pal.bg, 0.55);
        ctx.fillRect(x - 2, y - 7, w + 4, 14);
        ctx.fillStyle = this.col(sg.color || 'ink');
        ctx.fillText(sg.t, x, y);
        x += w + 10;
      }
    });

    if (!this.hover) return;
    const x = this._xOf(this.hover.i);
    if (x < this.plot.left || x > this.plot.right) return;
    ctx.save();
    ctx.strokeStyle = alpha(pal.ink, 0.35);
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    const cx = Math.round(x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, this.plot.top);
    ctx.lineTo(cx, this.plot.bottom);
    ctx.stroke();
    // 水平線與右側價格標籤（游標所在窗格）
    const hy = this.hover.y;
    const k = this.rects.findIndex((r) => hy >= r.y && hy <= r.y + r.h);
    if (k >= 0 && this.hover.mouse) {
      const p = this.model.panes[k];
      ctx.beginPath();
      ctx.moveTo(this.plot.left, Math.round(hy) + 0.5);
      ctx.lineTo(this.plot.right, Math.round(hy) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      this._tag(ctx, p._fmt(p._v(hy)), this.plot.right + 2, hy, pal.ink, pal.bg);
    }
    ctx.setLineDash([]);
    const label = this.model.x[this.hover.i];
    ctx.font = FONT;
    const tw = ctx.measureText(label).width + 12;
    const tx = clamp(x - tw / 2, this.plot.left, this.plot.right - tw + this.opts.axisW - 4);
    ctx.fillStyle = pal.ink;
    ctx.fillRect(tx, this.plot.bottom + 3, tw, 17);
    ctx.fillStyle = pal.bg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tx + tw / 2, this.plot.bottom + 12);
    ctx.restore();
  }

  _setHover(h) {
    const same = (!h && !this.hover) || (h && this.hover && h.i === this.hover.i && h.y === this.hover.y);
    if (same) return;
    this.hover = h;
    this._drawOver();
    this._emit('hover', h ? { i: h.i } : null);
  }

  // ───────── 互動 ─────────
  _pos(e) {
    const b = this.over.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  _bind() {
    const o = this.over;
    o.addEventListener('pointerdown', (e) => {
      if (!this.model || !this.plot) return;
      o.setPointerCapture?.(e.pointerId);
      this.ptrs.set(e.pointerId, this._pos(e));
      if (this.ptrs.size === 1) {
        const p = this._pos(e);
        this.drag = { x: p.x, start: this.view.start, moved: false, type: e.pointerType };
      } else if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, count: this.view.count, start: this.view.start, cx: (a.x + b.x) / 2 };
        this.drag = null;
      }
    });
    o.addEventListener('pointermove', (e) => {
      if (!this.model || !this.plot) return;
      const p = this._pos(e);
      if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
      if (this.pinch && this.ptrs.size >= 2) {
        const [a, b] = [...this.ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const pc = this.pinch;
        const anchor = pc.start + ((pc.cx - this.plot.left) / this.plot.w) * pc.count;
        const count = clamp(pc.count * (pc.d / d), Math.min(this.opts.minBars, this.n + this.opts.pad), this.n + this.opts.pad);
        this.view.count = count;
        this.view.start = anchor - ((pc.cx - this.plot.left) / this.plot.w) * count;
        this._clampStart();
        this.draw();
        return;
      }
      if (this.drag && this.ptrs.has(e.pointerId) && (e.buttons || e.pointerType !== 'mouse')) {
        const dx = p.x - this.drag.x;
        if (Math.abs(dx) > 3) this.drag.moved = true;
        if (this.drag.moved) {
          this.view.start = this.drag.start - (dx / this.plot.w) * this.view.count;
          this._clampStart();
          this.draw();
          return;
        }
      }
      if (e.pointerType === 'mouse') this._setHover({ i: this._idxAt(p.x), y: p.y, mouse: true });
    });
    const up = (e) => {
      const d = this.drag;
      this.ptrs.delete(e.pointerId);
      if (this.ptrs.size < 2) this.pinch = null;
      if (this.ptrs.size === 0) {
        if (d && !d.moved && d.type !== 'mouse' && e.type === 'pointerup') {
          const p = this._pos(e);
          this._setHover(this.hover && this.hover.i === this._idxAt(p.x) ? null : { i: this._idxAt(p.x), y: p.y, mouse: false });
        }
        this.drag = null;
      }
    };
    o.addEventListener('pointerup', up);
    o.addEventListener('pointercancel', up);
    o.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.drag) this._setHover(null);
    });
    o.addEventListener('wheel', (e) => {
      if (!this.model || !this.plot) return;
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (this.opts.wheelZoom === 'modifier' && !horizontal && !(e.ctrlKey || e.metaKey)) return; // 讓頁面正常捲動
      e.preventDefault();
      const p = this._pos(e);
      if (horizontal) {
        this.view.start += (e.deltaX / this.plot.w) * this.view.count;
        this._clampStart();
      } else {
        const anchor = this.view.start + ((p.x - this.plot.left) / this.plot.w) * this.view.count;
        const count = clamp(this.view.count * Math.exp(e.deltaY * 0.0015), Math.min(this.opts.minBars, this.n + this.opts.pad), this.n + this.opts.pad);
        this.view.count = count;
        this.view.start = anchor - ((p.x - this.plot.left) / this.plot.w) * count;
        this._clampStart();
      }
      this.draw();
    }, { passive: false });
    o.addEventListener('dblclick', () => this.resetView());
    o.addEventListener('keydown', (e) => {
      if (!this.model || !this.plot) return;
      const cur = this.hover ? this.hover.i : this._visible().i1;
      const move = (i) => this._setHover({ i: clamp(i, 0, this.n - 1), y: this.hover?.y ?? 0, mouse: false });
      if (e.key === 'ArrowLeft') move(cur - 1);
      else if (e.key === 'ArrowRight') move(cur + 1);
      else if (e.key === 'Home') move(0);
      else if (e.key === 'End') move(this.n - 1);
      else if (e.key === '+' || e.key === '=') { this.setCount(this.view.count * 0.8); this.draw(); }
      else if (e.key === '-') { this.setCount(this.view.count * 1.25); this.draw(); }
      else if (e.key === 'Escape') this._setHover(null);
      else return;
      e.preventDefault();
    });
  }

  /** 匯出目前畫面為 PNG（含背景與標題浮水印）。 */
  toDataURL() {
    const c = document.createElement('canvas');
    c.width = this.base.width;
    c.height = this.base.height;
    const g = c.getContext('2d');
    g.fillStyle = this.palette.bg;
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(this.base, 0, 0);
    g.drawImage(this.over, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.font = '600 13px "Noto Sans TC",system-ui,sans-serif';
    g.fillStyle = alpha(this.palette.ink, 0.5);
    g.textAlign = 'right';
    g.fillText(`${this.opts.title ? this.opts.title + '　' : ''}台股夜盤`, this.w - this.opts.axisW - 8, this.h - 28);
    return c.toDataURL('image/png');
  }
}

// ───────── 內建系列型別 ─────────
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

const fmtN = (v, d = 2) => (v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

registerSeries('line', {
  range: (s, i0, i1) => rangeOf(s.v, Math.max(0, i0 - 1), Math.min(s.v.length - 1, i1 + 1)),
  draw(ctx, a, s) {
    const from = Math.max(0, a.i0 - 1);
    const to = Math.min(s.v.length - 1, a.i1 + 1);
    const path = () => {
      let pen = false;
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        const v = s.v[i];
        if (v == null) { pen = false; continue; }
        const x = a.x(i);
        const y = a.y(v);
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      }
    };
    const color = a.col(s.color || 'lamp');
    if (s.fill) {
      path();
      let lastI = to;
      while (lastI > from && s.v[lastI] == null) lastI--;
      let firstI = from;
      while (firstI < lastI && s.v[firstI] == null) firstI++;
      ctx.lineTo(a.x(lastI), a.rect.y + a.rect.h);
      ctx.lineTo(a.x(firstI), a.rect.y + a.rect.h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, a.rect.y, 0, a.rect.y + a.rect.h);
      g.addColorStop(0, alpha(color, 0.28));
      g.addColorStop(1, alpha(color, 0));
      ctx.fillStyle = g;
      ctx.fill();
    }
    path();
    ctx.strokeStyle = color;
    ctx.lineWidth = s.width ?? 1.5;
    ctx.lineJoin = 'round';
    ctx.setLineDash(s.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  legend(s, i, a) {
    if (!s.name || s.v[i] == null) return [];
    return [{ t: `${s.name} ${(s.fmt || fmtN)(s.v[i])}`, color: s.color || 'lamp' }];
  },
});

registerSeries('band', {
  range: (s, i0, i1) => {
    const a = rangeOf(s.hi, i0, i1);
    const b = rangeOf(s.lo, i0, i1);
    return a && b ? [Math.min(a[0], b[0]), Math.max(a[1], b[1])] : null;
  },
  draw(ctx, a, s) {
    ctx.beginPath();
    let started = false;
    for (let i = a.i0; i <= a.i1; i++) {
      if (s.hi[i] == null) continue;
      const x = a.x(i);
      if (!started) { ctx.moveTo(x, a.y(s.hi[i])); started = true; } else ctx.lineTo(x, a.y(s.hi[i]));
    }
    for (let i = a.i1; i >= a.i0; i--) if (s.lo[i] != null) ctx.lineTo(a.x(i), a.y(s.lo[i]));
    ctx.closePath();
    ctx.fillStyle = alpha(a.col(s.color || 'lamp'), s.alpha ?? 0.1);
    ctx.fill();
    ctx.strokeStyle = alpha(a.col(s.color || 'lamp'), 0.45);
    ctx.lineWidth = 1;
    ctx.stroke();
  },
});

registerSeries('candle', {
  range: (s, i0, i1) => {
    const lo = rangeOf(s.l, i0, i1);
    const hi = rangeOf(s.h, i0, i1);
    return lo && hi ? [lo[0], hi[1]] : null;
  },
  draw(ctx, a, s) {
    const body = Math.max(1, Math.floor(a.bw * 0.68));
    for (let i = a.i0; i <= a.i1; i++) {
      const o = s.o[i];
      const c = s.c[i];
      if (o == null || c == null) continue;
      const color = c > o ? a.pal.up : c < o ? a.pal.down : a.pal.mute;
      const x = Math.round(a.x(i)) + 0.5;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, a.y(s.h[i]));
      ctx.lineTo(x, a.y(s.l[i]));
      ctx.stroke();
      const yo = a.y(o);
      const yc = a.y(c);
      ctx.fillRect(Math.round(a.x(i) - body / 2), Math.min(yo, yc), body, Math.max(1, Math.abs(yc - yo)));
    }
  },
  legend(s, i) {
    const o = s.o[i];
    if (o == null) return [];
    const prev = i > 0 ? s.c[i - 1] : null;
    const pct = prev ? ((s.c[i] / prev - 1) * 100) : null;
    const color = pct == null ? 'ink' : pct > 0 ? 'up' : pct < 0 ? 'down' : 'ink';
    const f = s.fmt || fmtN;
    const t = `開 ${f(o)}　高 ${f(s.h[i])}　低 ${f(s.l[i])}　收 ${f(s.c[i])}` + (pct == null ? '' : `　${pct > 0 ? '+' : ''}${fmtN(pct)}%`);
    return [{ t, color }];
  },
});

registerSeries('bars', {
  range: (s, i0, i1) => {
    const r = rangeOf(s.v, i0, i1);
    return r ? [0, r[1]] : null;
  },
  draw(ctx, a, s) {
    const w = Math.max(1, Math.floor(a.bw * 0.7));
    const y0 = a.y(0);
    for (let i = a.i0; i <= a.i1; i++) {
      const v = s.v[i];
      if (v == null) continue;
      const c = s.colors ? s.colors[i] : s.color;
      ctx.fillStyle = alpha(a.col(c || 'faint'), s.alpha ?? 0.85);
      const y = a.y(v);
      ctx.fillRect(Math.round(a.x(i) - w / 2), y, w, Math.max(1, y0 - y));
    }
  },
  legend(s, i) {
    return s.name && s.v[i] != null ? [{ t: `${s.name} ${(s.fmt || fmtN)(s.v[i])}`, color: 'mute' }] : [];
  },
});

registerSeries('hist', {
  range: (s, i0, i1) => {
    const r = rangeOf(s.v, i0, i1);
    if (!r) return null;
    const m = Math.max(Math.abs(r[0]), Math.abs(r[1]));
    return [-m, m];
  },
  draw(ctx, a, s) {
    const w = Math.max(1, Math.floor(a.bw * 0.7));
    const y0 = a.y(0);
    for (let i = a.i0; i <= a.i1; i++) {
      const v = s.v[i];
      if (v == null) continue;
      ctx.fillStyle = alpha(v >= 0 ? a.pal.up : a.pal.down, 0.8);
      const y = a.y(v);
      ctx.fillRect(Math.round(a.x(i) - w / 2), Math.min(y, y0), w, Math.max(1, Math.abs(y0 - y)));
    }
  },
  legend(s, i) {
    return s.name && s.v[i] != null ? [{ t: `${s.name} ${fmtN(s.v[i], 3)}`, color: 'mute' }] : [];
  },
});
