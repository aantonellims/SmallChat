import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadChecklist } from './checklist.js';
import { parseModelUrl, parseDataAgentUrl, fetchItemDefinition, SemanticModelClient } from './fabric.js';
import { runChecklist, runFix, renderReport } from './agent.js';
import { fileDiff, renderDiffHtml, toPatch, toZip, DIFF_CSS } from './fixes.js';
import { renderReportHtml, renderItemHtml } from './reportHtml.js';
import { startLogin, authStatus as realAuthStatus, logout, interactiveTokenProvider } from './auth.js';
import { azCliTokenProvider } from './fabric.js';

// AUTH_MODE=az reuses the Azure CLI login (local testing only); default is the interactive Microsoft sign-in.
const azMode = process.env.AUTH_MODE === 'az';
const authStatus = () => (azMode ? { signedIn: true, user: { name: 'Azure CLI session' }, error: null, pending: false } : realAuthStatus());
const tokenProvider = azMode ? azCliTokenProvider() : interactiveTokenProvider();

const app = express();
app.use(express.json());
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

const sections = loadChecklist();
const allIds = sections.flatMap((s) => s.items.map((i) => i.id));
const runIds = (run) => run.sections.flatMap((s) => s.items.map((i) => i.id));
const runs = new Map();

app.post('/api/login', async (req, res) => {
  try {
    res.json(await startLogin(String(req.body?.tenantId || '').trim()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/me', (_req, res) => res.json(authStatus()));
app.post('/api/logout', (_req, res) => {
  logout();
  res.sendStatus(204);
});

const requireLogin = (_req, res, next) => (authStatus().signedIn ? next() : res.status(401).json({ error: 'Please sign in first.' }));

app.get('/api/checklist', requireLogin, (_req, res) => res.json(sections));

// Starts (or re-starts) a run of the given items on an existing run object; results accumulate in run.results.
function execute(run, itemIds) {
  for (const id of itemIds ?? allIds) run.fixes.delete(id);
  run.state = 'running';
  run.error = null;
  run.events = [];
  run.controller = new AbortController();
  const emit = (evt) => {
    run.events.push(evt);
    for (const l of run.listeners) l(evt);
  };
  runChecklist({ sections: run.sections, model: run.model, emit, signal: run.controller.signal, itemIds, existing: run.results, dataAgent: run.dataAgent })
    .then((r) => {
      run.info = r.info;
      if (r.summary) run.summary = r.summary;
      run.state = 'done';
      emit({ type: 'done' });
    })
    .catch((e) => {
      run.state = 'error';
      run.error = e.message;
      emit({ type: 'error', message: e.message });
    });
}

const snapshot = (run) => ({
  id: run.id,
  state: run.state,
  error: run.error,
  info: run.info,
  summary: run.summary,
  results: Object.fromEntries(run.results),
});

// body: { url, dataAgentUrl?, prepare?: true, itemIds?: string[] }. prepare=true only creates the run so items can be run one by one.
// Data Agent sections are only part of the run when the customer provides the URL of an existing Data Agent.
app.post('/api/runs', requireLogin, (req, res) => {
  let ids;
  let dataAgent = null;
  try {
    ids = parseModelUrl(req.body?.url);
    if (String(req.body?.dataAgentUrl || '').trim()) {
      const d = parseDataAgentUrl(req.body.dataAgentUrl);
      dataAgent = { ...d, load: () => fetchItemDefinition({ workspaceId: d.workspaceId, itemId: d.itemId, getToken: tokenProvider }) };
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const id = randomUUID();
  const run = {
    id,
    state: 'ready',
    events: [],
    listeners: new Set(),
    results: new Map(),
    fixes: new Map(),
    sections: sections.filter((s) => s.scope === 'model' || dataAgent),
    dataAgent,
    summary: '',
    info: null,
    error: null,
    controller: new AbortController(),
    model: new SemanticModelClient({ ...ids, getToken: tokenProvider }),
  };
  runs.set(id, run);
  if (!req.body?.prepare) execute(run, Array.isArray(req.body?.itemIds) ? req.body.itemIds.filter((x) => runIds(run).includes(x)) : undefined);
  res.status(202).json({ id });
});

// Runs (or re-runs) selected items on an existing run, reusing the already downloaded model definition.
app.post('/api/runs/:id/items', requireLogin, (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.sendStatus(404);
  if (run.state === 'running') return res.status(409).json({ error: 'A run is already in progress.' });
  const itemIds = (req.body?.itemIds ?? []).filter((x) => runIds(run).includes(x));
  if (!itemIds.length) return res.status(400).json({ error: 'No valid itemIds.' });
  execute(run, itemIds);
  res.status(202).json({ id: run.id });
});

app.get('/api/runs/:id', (req, res) => {
  const run = runs.get(req.params.id);
  return run ? res.json(snapshot(run)) : res.sendStatus(404);
});

app.get('/api/runs/:id/events', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.sendStatus(404);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
  run.events.forEach(send);
  if (run.state !== 'running') return res.end();
  const l = (evt) => {
    send(evt);
    if (evt.type === 'done' || evt.type === 'error') res.end();
  };
  run.listeners.add(l);
  req.on('close', () => run.listeners.delete(l));
});

const reportInput = (run) => ({ sections: run.sections, results: Object.fromEntries(run.results), info: run.info ?? { displayName: 'Semantic model' }, summary: run.summary });

app.get('/api/runs/:id/report', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.sendStatus(404);
  res.type('text/markdown').send(renderReport(reportInput(run)));
});

app.get('/api/runs/:id/items/:itemId/html', (req, res) => {
  const run = runs.get(req.params.id);
  const item = sections.flatMap((s) => s.items).find((i) => i.id === req.params.itemId);
  if (!run || !item) return res.sendStatus(404);
  res.type('html').send(renderItemHtml(item, run.results.get(item.id)));
});

app.get('/diff.css', (_req, res) => res.type('text/css').send(DIFF_CSS));

// ---- Fix preview (no writes to the real model): the agent edits an in-memory copy; the user reviews a diff. ----
app.post('/api/runs/:id/items/:itemId/fix', requireLogin, (req, res) => {
  const run = runs.get(req.params.id);
  const item = sections.flatMap((s) => s.items).find((i) => i.id === req.params.itemId);
  const result = run?.results.get(req.params.itemId);
  if (!run || !item || !result) return res.sendStatus(404);
  if (!result.fixable) return res.status(400).json({ error: 'This recommendation cannot be applied as a model definition change.' });
  const existing = run.fixes.get(item.id);
  if (existing?.state === 'running') return res.status(202).json({ state: 'running' });
  const fix = { state: 'running', changes: [], files: null, summary: '', warnings: [], noFix: '', error: null };
  run.fixes.set(item.id, fix);
  runFix({ model: run.model, item, result, info: run.info ?? { displayName: 'Semantic model' } })
    .then((r) => Object.assign(fix, r, { state: 'done' }))
    .catch((e) => Object.assign(fix, { state: 'error', error: e.message }));
  res.status(202).json({ state: 'running' });
});

app.get('/api/runs/:id/items/:itemId/fix', (req, res) => {
  const fix = runs.get(req.params.id)?.fixes.get(req.params.itemId);
  if (!fix) return res.sendStatus(404);
  const stats = fix.changes.map(fileDiff).reduce((a, d) => ({ files: a.files + 1, added: a.added + d.added, removed: a.removed + d.removed }), { files: 0, added: 0, removed: 0 });
  res.json({ state: fix.state, error: fix.error, summary: fix.summary, warnings: fix.warnings, noFix: fix.noFix, stats, html: fix.state === 'done' ? renderDiffHtml(fix.changes) : '' });
});

app.get('/api/runs/:id/items/:itemId/fix.patch', (req, res) => {
  const fix = runs.get(req.params.id)?.fixes.get(req.params.itemId);
  if (!fix || fix.state !== 'done' || !fix.changes.length) return res.sendStatus(404);
  res.set('Content-Disposition', `attachment; filename="${req.params.itemId}-fix.patch"`).type('text/plain').send(toPatch(fix.changes));
});

app.get('/api/runs/:id/items/:itemId/fix.zip', (req, res) => {
  const fix = runs.get(req.params.id)?.fixes.get(req.params.itemId);
  if (!fix || fix.state !== 'done' || !fix.files) return res.sendStatus(404);
  res.set('Content-Disposition', `attachment; filename="${req.params.itemId}-patched-definition.zip"`).type('application/zip').send(toZip(fix.files));
});

app.get('/runs/:id/report', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).send('Run not found (the server may have restarted).');
  res.type('html').send(renderReportHtml(reportInput(run)));
});

app.delete('/api/runs/:id', (req, res) => {
  runs.get(req.params.id)?.controller.abort();
  res.sendStatus(204);
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '127.0.0.1', () => console.log(`Checklist agent on http://localhost:${port}`));
