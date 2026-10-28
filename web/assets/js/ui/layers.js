// 浮層管理：個股側欄、搜尋面板、設定對話框共用的開關、焦點陷阱、Esc、背景 inert。
// 浮層可以疊起來（例如在個股側欄裡開搜尋來新增比較）。

const BACKGROUND = ['tape', 'view', 'foot'];
const stack = []; // {el, back, onClose}

const $ = (id) => document.getElementById(id);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function setInert(on, el) {
  if (!el) return;
  if (on) el.setAttribute('inert', '');
  else el.removeAttribute('inert');
}

function sync() {
  const bg = stack.length > 0;
  for (const id of BACKGROUND) setInert(bg, $(id));
  setInert(bg, document.querySelector('header.top'));
  stack.forEach((l, i) => {
    const top = i === stack.length - 1;
    setInert(!top, l.el);
    l.el.setAttribute('aria-hidden', String(!top));
  });
  $('scrim').classList.toggle('on', bg);
  document.documentElement.style.overflow = bg ? 'hidden' : '';
}

export function open(id, { onClose, focus } = {}) {
  const el = $(id);
  if (!el) return;
  const existing = stack.findIndex((l) => l.el === el);
  if (existing >= 0) stack.splice(existing, 1);
  stack.push({ el, back: document.activeElement, onClose });
  el.classList.add('on');
  sync();
  // visibility 的過場開始瞬間仍是 hidden，focus() 會失敗，所以在幾個時間點重試到成功為止
  const tryFocus = () => {
    if (el.contains(document.activeElement) && document.activeElement !== el) return true;
    const target = (focus && el.querySelector(focus)) || el.querySelector(FOCUSABLE);
    if (target) target.focus({ preventScroll: true });
    else {
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }
    return el.contains(document.activeElement);
  };
  requestAnimationFrame(() => {
    if (!tryFocus()) setTimeout(() => { if (!tryFocus()) setTimeout(tryFocus, 120); }, 40);
  });
}

export function close(id) {
  const i = id ? stack.findIndex((l) => l.el.id === id) : stack.length - 1;
  if (i < 0) return false;
  const [l] = stack.splice(i, 1);
  l.el.classList.remove('on');
  l.el.setAttribute('aria-hidden', 'true');
  setInert(false, l.el);
  sync();
  l.onClose?.();
  if (l.back && document.contains(l.back) && !stack.length) l.back.focus({ preventScroll: true });
  else if (stack.length) stack.at(-1).el.querySelector(FOCUSABLE)?.focus({ preventScroll: true });
  return true;
}

export const isOpen = (id) => stack.some((l) => l.el.id === id);
export const topId = () => stack.at(-1)?.el.id || null;
export const closeTop = () => close();

export function install() {
  document.addEventListener('keydown', (e) => {
    const top = stack.at(-1);
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const f = [...top.el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);
}
