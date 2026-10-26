import { marked } from 'marked';

const ICON = { pass: '✅', warn: '🟡', fail: '❌', manual: '🖐️', not_applicable: '➖' };
const LABEL = { pass: 'Pass', warn: 'Warning', fail: 'Fail', manual: 'Manual', not_applicable: 'N/A' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Model output is untrusted: render markdown, then strip raw HTML.
export const md = (s) => marked.parse(String(s ?? '').replace(/</g, '&lt;'), { gfm: true });

export function renderItemHtml(item, r) {
  if (!r) return '<p><i>Not run yet. Use the ▶ button to run this item.</i></p>';
  return `<p class="head"><b>${esc(r.headline)}</b></p>${r.evidence ? `<h4>Evidence</h4>${md(r.evidence)}` : ''}${r.recommendation ? `<h4>Recommendation</h4>${md(r.recommendation)}` : ''}`;
}

export function renderReportHtml({ sections, results, info, summary }) {
  const count = (s) => Object.values(results).filter((r) => r.status === s).length;
  const chips = Object.keys(LABEL).map((s) => `<span class="chip ${s}">${ICON[s]} ${LABEL[s]} ${count(s)}</span>`).join('');
  const toc = sections.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join('');
  const body = sections.map((s) => `<section id="${s.id}"><h2>${esc(s.title)}</h2>` + s.items.map((i) => {
    const r = results[i.id];
    if (!r) return `<div class="item pending"><b>⏳ ${esc(i.text)}</b><div class="head">Not run yet</div></div>`;
    return `<details class="item ${r.status}" id="${i.id}" ${r.status === 'fail' ? 'open' : ''}>
<summary><span class="st">${ICON[r.status]}</span> <b>${i.critical ? '⚠ ' : ''}${esc(i.text)}</b><div class="head">${esc(r.headline)}</div></summary>
${r.evidence ? `<h4>Evidence</h4>${md(r.evidence)}` : ''}${r.recommendation ? `<h4>Recommendation</h4>${md(r.recommendation)}` : ''}</details>`;
  }).join('') + '</section>').join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Readiness report - ${esc(info.displayName)}</title>
<style>
body{font:15px/1.55 Segoe UI,system-ui,sans-serif;margin:0;color:#1b1b1b;background:#fafafa}
header{background:#0f2b46;color:#fff;padding:1.2rem 2rem}header h1{margin:0;font-size:1.4rem}
.wrap{display:flex;gap:2rem;max-width:1200px;margin:0 auto;padding:1.5rem 2rem}
nav{position:sticky;top:1rem;align-self:flex-start;min-width:230px;display:flex;flex-direction:column;gap:.4rem}
nav a{color:#0f6cbd;text-decoration:none}main{flex:1;min-width:0}
.chip{display:inline-block;margin:.2rem .4rem .2rem 0;padding:.2rem .7rem;border-radius:99px;background:#fff;border:1px solid #ddd}
.summary,.item{background:#fff;border:1px solid #e1e1e1;border-radius:8px;padding:.8rem 1.1rem;margin:.7rem 0}
.item.fail{border-left:5px solid #c4314b}.item.warn{border-left:5px solid #e0a800}.item.pass{border-left:5px solid #2e8b57}.item.manual{border-left:5px solid #8a8a8a}
summary{cursor:pointer}.head{color:#555;margin-top:.2rem}h2{margin-top:2rem}h4{margin:1rem 0 .2rem;color:#0f2b46}
pre{background:#f3f3f3;padding:.8rem;overflow:auto;border-radius:6px}code{background:#f3f3f3;padding:0 .25rem;border-radius:4px}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.3rem .6rem}
@media print{nav{display:none}details{display:block}}
</style></head><body>
<header><h1>Semantic model readiness report</h1><div>${esc(info.displayName)}</div></header>
<div class="wrap"><nav><b>Sections</b><a href="#summary">Executive summary</a>${toc}</nav>
<main><div>${chips}</div>
<section id="summary" class="summary">${summary ? md(summary) : '<i>The executive summary is generated once every item has a verdict.</i>'}</section>
${body}</main></div></body></html>`;
}
