import { structuredPatch, createTwoFilesPatch } from 'diff';
import { zipSync, strToU8 } from 'fflate';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Mutable in-memory copy of the model definition. The real model is never touched.
export class ModelCopy {
  constructor(files) {
    this.original = files;
    this.files = new Map(files);
  }

  replace(path, oldStr, newStr, replaceAll = false) {
    if (!this.files.has(path)) throw new Error(`File not found: ${path}`);
    if (!oldStr) throw new Error('old_str must not be empty.');
    const text = this.files.get(path);
    const count = text.split(oldStr).length - 1;
    if (count === 0) throw new Error('old_str not found. Copy it exactly from read_model_file (tabs/spaces matter).');
    if (count > 1 && !replaceAll) throw new Error(`old_str matches ${count} times; add more context or set replace_all.`);
    this.files.set(path, replaceAll ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr));
    return count;
  }

  remove(path) {
    if (!this.files.has(path)) throw new Error(`File not found: ${path}`);
    if (/^\.platform$|definition\.pbism$|database\.tmdl$/.test(path)) throw new Error('This file cannot be deleted.');
    this.files.delete(path);
  }

  // Changed files with before/after (after = null when deleted).
  changes() {
    const out = [];
    for (const [path, before] of this.original) {
      const after = this.files.has(path) ? this.files.get(path) : null;
      if (after !== before) out.push({ path, before, after });
    }
    return out;
  }
}

export function fileDiff({ path, before, after }) {
  const hunks = structuredPatch(path, path, before, after ?? '', '', '', { context: 3 }).hunks;
  let added = 0;
  let removed = 0;
  for (const h of hunks) for (const l of h.lines) (l[0] === '+' ? added++ : l[0] === '-' ? removed++ : 0);
  return { path, deleted: after === null, hunks, added, removed };
}

export function toPatch(changes) {
  return changes.map((c) => createTwoFilesPatch(`a/${c.path}`, `b/${c.path}`, c.before, c.after ?? '', '', '', { context: 3 })).join('\n');
}

export function toZip(files) {
  const data = {};
  for (const [p, c] of files) data[p] = strToU8(c);
  return Buffer.from(zipSync(data));
}

export function renderDiffHtml(changes) {
  if (!changes.length) return '<p><i>No file changes.</i></p>';
  return changes.map((c) => {
    const d = fileDiff(c);
    const hunks = d.hunks.map((h) => {
      let o = h.oldStart;
      let n = h.newStart;
      const rows = h.lines.map((l) => {
        const t = l[0];
        const left = t === '+' ? '' : o++;
        const right = t === '-' ? '' : n++;
        return `<tr class="${t === '+' ? 'add' : t === '-' ? 'del' : 'ctx'}"><td class="ln">${left}</td><td class="ln">${right}</td><td class="sg">${t === ' ' ? '' : t}</td><td class="tx">${esc(l.slice(1)) || '&nbsp;'}</td></tr>`;
      }).join('');
      return `<tr class="hunk"><td colspan="4">@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@</td></tr>${rows}`;
    }).join('');
    return `<details class="file" open><summary><b>${esc(c.path)}</b> ${d.deleted ? '<span class="badge del">file deleted</span>' : ''}<span class="stat"><span class="plus">+${d.added}</span> <span class="minus">-${d.removed}</span></span></summary><table class="diff">${hunks}</table></details>`;
  }).join('');
}

export const DIFF_CSS = `
.file{border:1px solid #d0d7de;border-radius:6px;margin:.7rem 0;background:#fff}.file>summary{cursor:pointer;padding:.4rem .7rem;background:#f6f8fa}
.stat{float:right;font-family:Consolas,monospace}.plus{color:#1a7f37}.minus{color:#cf222e}.badge{background:#ffebe9;color:#cf222e;border-radius:99px;padding:0 .5rem;margin-left:.4rem;font-size:.8em}
table.diff{border-collapse:collapse;width:100%;font:12.5px/1.45 Consolas,Menlo,monospace}table.diff td{border:0;padding:0 .4rem;vertical-align:top}
td.ln{width:2.6rem;text-align:right;color:#8c959f;user-select:none;background:#f6f8fa}td.sg{width:1rem;user-select:none}td.tx{white-space:pre-wrap;word-break:break-all}
tr.add{background:#e6ffec}tr.add td.sg,tr.add td.tx{color:#116329}tr.del{background:#ffebe9}tr.del td.sg,tr.del td.tx{color:#82071e}
tr.hunk td{background:#ddf4ff;color:#0550ae;padding:.1rem .5rem}`;
