// 靜態檢查：每個相對路徑 import 的檔案都存在，而且具名匯入的名稱真的有被匯出。
// 沒有瀏覽器可跑時，這能抓到最常見的重構錯誤（打錯檔名、漏匯出）。
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/js');
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(root);

function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      names.add(t.split(/\s+as\s+/).pop().trim());
    }
  }
  if (/export\s+default\s/.test(src)) names.add('default');
  return names;
}

let bad = 0;
const fail = (msg) => { console.error('✗ ' + msg); bad++; };

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(root, f);
  const re = /import\s+(?:([\s\S]*?)\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const target = resolve(dirname(f), m[2]);
    if (!existsSync(target)) { fail(`${rel}: 找不到 ${m[2]}`); continue; }
    const clause = (m[1] || '').trim();
    if (!clause || clause.startsWith('*')) continue;
    const exp = exportsOf(readFileSync(target, 'utf8'));
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !exp.has(name)) fail(`${rel}: ${m[2]} 沒有匯出 ${name}`);
      }
    }
    if (/^[A-Za-z_$][\w$]*\s*(,|$)/.test(clause) && !exp.has('default')) fail(`${rel}: ${m[2]} 沒有 default 匯出`);
  }
  for (const m of src.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    if (!existsSync(resolve(dirname(f), m[1]))) fail(`${rel}: 動態匯入找不到 ${m[1]}`);
  }
}

if (bad) { console.error(`\n${bad} 個問題`); process.exit(1); }
console.log(`ok: ${files.length} 個模組的匯入都解析得到`);
