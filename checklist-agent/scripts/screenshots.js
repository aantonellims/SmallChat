import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChecklist } from '../src/checklist.js';
import { renderItemHtml, renderReportHtml } from '../src/reportHtml.js';
import { renderDiffHtml, ModelCopy, fileDiff } from '../src/fixes.js';

// Regenerates the README screenshots: node scripts/screenshots.js
// Runs the REAL server and UI in headless Edge; identity/model calls are stubbed with generic sample data (no customer data).
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'img');
mkdirSync(out, { recursive: true });
const PORT = 3955;
const BASE = `http://127.0.0.1:${PORT}`;
const edge = [`${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`].find((p) => existsSync(p));
if (!edge) throw new Error('Microsoft Edge not found.');

const sections = loadChecklist();
const items = sections.flatMap((s) => s.items);
const R = (status, headline, recommendation = '', evidence = '', fixable = false) => ({ status, headline, recommendation, evidence, fixable });
const sample = {
  i01: R('warn', 'Mostly a star schema, but 18 auto date tables and repeated user columns add noise', '- **Turn off auto date/time** (File > Options > Current file > Data load): removes 18 hidden date tables.\n- **Hide the repeated user columns** on Issues and Pull requests: keeps the model focused.', '- **Facts:** Issues, Pull requests, Contributions\n- **Dimensions:** Users, Date, Milestones', true),
  i02: R('warn', '16 rule violations found (3 high, 7 medium, 6 low)', '- **Turn off auto date/time** (File > Options > Current file > Data load): drops 18 hidden date tables.\n- **Mark `Date` as the date table** (Table tools > Mark as date table): makes time intelligence reliable.\n- **Replace the 3 rank columns on `Users` with measures**: columns freeze at refresh.', '| Severity | Rule | Objects | Fix |\n|---|---|---|---|\n| High | Auto date/time tables enabled | 18 | Disable auto date/time |\n| High | Date table not marked | 1 (`Date`) | Mark as date table |\n| Medium | Numbers stored as text | 6 | Change data type |', true),
  i03: R('warn', 'Model is about 28 MB; free-text body columns are about half of it', '- **Remove or hide `Issues[body]` and `Pull requests[body]`**: they are about 14 MB of the model.', '**Total size:** 28.1 MB\n\n| Table | Size MB |\n|---|---|\n| Issues | 12.6 |\n| Pull requests | 8.3 |'),
  i04: R('not_applicable', 'The model uses Import storage, so Direct Lake tuning does not apply'),
  i05: R('fail', '7 columns have the wrong data type (numbers stored as text)', '- **Change `Milestones[open_issues]` and `[closed_issues]` to whole number**: so they can be summed.\n- **Change `Issues[locked]` to true/false**.', '- **Source:** INFO.COLUMNS()', true),
  i07: R('pass', 'All key measures answer in under 0.2 seconds'),
  i08: R('warn', 'Several visible columns use technical names', '- **Rename `stargazers_count` to `Stars`** and similar columns.', '', true),
  i09: R('fail', 'No table, column or measure has a description: 0 of 102 visible objects', '- **Add a one-line description to each of the 8 tables**.\n- **Describe the 37 visible measures first**, starting with Contributions (15) and Issues (13).', '- 8 of 8 tables undescribed', true),
  i13: R('fail', '7 numeric columns wrongly sum up instead of "Don\'t summarize"', '- **Set Summarize by to None** on the 3 rank columns on `Users`, `Date[WeekOfYear]` and `RepoStats[Key]`.\n- **Keep `Issues[Age (Days)]` as Average**.', '| Column | Issue |\n|---|---|\n| Users[Rank by commits all time] | Sum on rank |', true),
};
const results = {};
for (const i of items.slice(0, 15)) results[i.id] = { itemId: i.id, ...(sample[i.id] ?? R('pass', 'Checked: nothing to change')) };
const info = { displayName: 'GitHub repository analytics' };
const copilot = { mode: 'local', isolated: false, ready: true, defaultModel: null, auth: { ok: true, login: 'octocat' }, github: { available: true, signedIn: false }, problems: [], mcp: { reachable: true }, skills: [{ name: 'semantic-model-review', found: true }, { name: 'powerbi-modeling', found: true }],
  models: [{ id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', premium: 1, reasoning: true }, { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', premium: 1, reasoning: true }, { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', premium: 0.33, reasoning: false }] };

const files = new Map([['definition/tables/Users.tmdl', "table Users\n\tcolumn 'Rank by commits this year' = CALCULATE([User Rank by Commits],'Date'[isCurrentYear])\n\t\tsummarizeBy: sum\n\n\tcolumn 'Rank by commits all time' = CALCULATE([User Rank by Commits])\n\t\tsummarizeBy: sum\n\n\tcolumn user\n\t\tsummarizeBy: none\n"]]);
const copy = new ModelCopy(files);
copy.replace('definition/tables/Users.tmdl', "this year' = CALCULATE([User Rank by Commits],'Date'[isCurrentYear])\n\t\tsummarizeBy: sum", "this year' = CALCULATE([User Rank by Commits],'Date'[isCurrentYear])\n\t\tsummarizeBy: none");
copy.replace('definition/tables/Users.tmdl', "all time' = CALCULATE([User Rank by Commits])\n\t\tsummarizeBy: sum", "all time' = CALCULATE([User Rank by Commits])\n\t\tsummarizeBy: none");
const changes = copy.changes();
const stats = changes.map(fileDiff).reduce((a, d) => ({ files: a.files + 1, added: a.added + d.added, removed: a.removed + d.removed }), { files: 0, added: 0, removed: 0 });

const server = spawn(process.execPath, ['src/server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), COPILOT_PREFLIGHT: '0' }, stdio: 'ignore' });
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/diff.css`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 780 }, deviceScaleFactor: 1.5 })).newPage();

  let signedIn = false;
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const m = route.request().method();
    if (p === '/api/me') return json(route, { signedIn, user: signedIn ? { name: 'you@contoso.com' } : null, error: null, pending: false });
    if (p === '/api/login') return json(route, { userCode: 'D868-EWSH', verificationUri: 'https://login.microsoft.com/device', message: '' });
    if (p === '/api/checklist') return json(route, sections);
    if (p === '/api/copilot/status') return json(route, copilot);
    if (p === '/api/github/status') return json(route, copilot.github);
    if (p === '/api/github/login') return json(route, { userCode: '7844-B94E', verificationUri: 'https://github.com/login/device', method: 'cli' });
    if (p === '/api/runs' && m === 'POST') return json(route, { id: 'demo' }, 202);
    if (p === '/api/runs/demo/items' && m === 'POST') return json(route, { id: 'demo' }, 202);
    if (p === '/api/runs/demo/events') {
      const ev = [{ type: 'model', name: info.displayName }, { type: 'section', title: sections[0].title }, ...Object.values(results).map((r) => ({ type: 'item', ...r })), { type: 'done' }];
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ev.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') });
    }
    const it = /^\/api\/runs\/demo\/items\/(i\d+)\/html$/.exec(p);
    if (it) return route.fulfill({ status: 200, contentType: 'text/html', body: renderItemHtml(items.find((x) => x.id === it[1]), results[it[1]]) });
    if (/\/fix$/.test(p)) return json(route, m === 'POST' ? { state: 'running' } : { state: 'done', summary: 'Sets Summarize by to None on the Users rank columns so they are no longer summed.', warnings: ['Reports that relied on an automatic sum of these columns will show individual values instead.'], noFix: '', stats, html: renderDiffHtml(changes) }, m === 'POST' ? 202 : 200);
    return route.continue();
  });
  await page.route('**/runs/demo/report', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: renderReportHtml({ sections: sections.slice(0, 1), results, info, summary: '### Verdict\nThe model is **not yet ready** for a Fabric Data Agent: it has no descriptions, wrong data types and 18 auto date tables.\n\n### Top 5 actions\n1. **Add descriptions** to the 8 tables and 37 measures.\n2. **Turn off auto date/time** (File > Options > Data load).\n3. **Fix 7 data types** (text to number / true-false).' }) }));

  const shot = (name, opts = {}) => page.screenshot({ path: path.join(out, name), ...opts });

  // 1. Microsoft sign-in with the device code
  await page.goto(BASE);
  await page.waitForSelector('#login:not([hidden])');
  await page.click('#lb');
  await page.waitForSelector('#code b');
  await shot('01-sign-in-microsoft.png', { clip: { x: 0, y: 0, width: 1180, height: 330 } });

  // 2. Main page: the app's GitHub Copilot profile + model picker
  signedIn = true;
  await page.goto(BASE);
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForSelector('#modelsel option:nth-child(2)', { state: 'attached' });
  await page.fill('#url', 'https://app.powerbi.com/groups/00000000-0000-0000-0000-000000000000/datasets/11111111-1111-1111-1111-111111111111');
  await shot('02-main-page.png', { clip: { x: 0, y: 0, width: 1180, height: 520 } });

  // 3. Optional: sign in with your own GitHub account (code to type at github.com/login/device)
  await page.click('#ghconnect');
  await page.waitForSelector('#ghcode b');
  await shot('03-sign-in-github-code.png', { clip: { x: 0, y: 40, width: 1180, height: 190 } });

  // 4. Results after "Run full checklist"
  await page.click('#go');
  await page.waitForSelector('#status:has-text("Done")');
  await shot('04-results.png', { clip: { x: 0, y: 150, width: 1180, height: 600 } });

  // 5. Details panel
  await page.click('tr[data-item="i09"] td.t');
  await page.waitForSelector('#drawer.open #dbody ul');
  await page.waitForTimeout(400);
  await shot('05-details-what-to-do.png');
  await page.click('#close');

  // 6. Preview fix (colored diff)
  await page.click('tr[data-item="i13"] td.t');
  await page.waitForSelector('#fixbtn');
  await page.click('#fixbtn');
  await page.waitForSelector('#fixbody table.diff', { timeout: 15000 });
  await page.waitForTimeout(400);
  await shot('06-preview-fix-diff.png');
  await page.click('#fixclose');

  // 7. Full report page
  await page.goto(`${BASE}/runs/demo/report`);
  await page.waitForSelector('#summary');
  await shot('07-full-report.png', { clip: { x: 0, y: 0, width: 1180, height: 700 } });

  await browser.close();
  console.log('Screenshots written to', out);
} finally {
  server.kill();
}
