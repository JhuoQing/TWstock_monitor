// 事件委派：在 HTML 上寫 data-act="名稱" data-...，統一在 document 處理，
// 這樣重新渲染 innerHTML 後不需要重新綁定，CSP 也不需要 inline handler。

const clicks = new Map();
const submits = new Map();
const inputs = new Map();

export const act = (name, fn) => clicks.set(name, fn);
export const onSubmit = (name, fn) => submits.set(name, fn);
export const onInput = (name, fn) => inputs.set(name, fn);

export function install(root = document) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-act]');
    if (!el || el.disabled) return;
    const fn = clicks.get(el.dataset.act);
    if (!fn) return;
    // 連結本身要導覽時（例如新聞）不攔截
    if (el.tagName !== 'A' || el.getAttribute('href') === '#') e.preventDefault();
    fn(el, e);
  });
  root.addEventListener('submit', (e) => {
    const f = e.target.closest?.('[data-submit]');
    const fn = f && submits.get(f.dataset.submit);
    if (!fn) return;
    e.preventDefault();
    fn(f, e);
  });
  root.addEventListener('input', (e) => {
    const el = e.target.closest?.('[data-input]');
    const fn = el && inputs.get(el.dataset.input);
    if (fn) fn(el, e);
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest?.('[data-change]');
    const fn = el && inputs.get(el.dataset.change);
    if (fn) fn(el, e);
  });
}
