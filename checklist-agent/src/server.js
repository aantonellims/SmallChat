import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadChecklist } from './checklist.js';
import { parseModelUrl, SemanticModelClient } from './fabric.js';
import { runChecklist, renderReport } from './agent.js';
import { startLogin, authStatus, logout, interactiveTokenProvider } from './auth.js';

const app = express();
app.use(express.json());
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

const sections = loadChecklist();
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

app.post('/api/runs', requireLogin, (req, res) => {
  let ids;
  try {
    ids = parseModelUrl(req.body?.url);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const id = randomUUID();
  const run = { id, state: 'running', events: [], listeners: new Set(), report: null, error: null, controller: new AbortController() };
  runs.set(id, run);
  const emit = (evt) => {
    run.events.push(evt);
    for (const l of run.listeners) l(evt);
  };
  runChecklist({ sections, model: new SemanticModelClient({ ...ids, getToken: interactiveTokenProvider() }), emit, signal: run.controller.signal })
    .then((r) => {
      run.report = renderReport({ sections, ...r });
      run.state = 'done';
      emit({ type: 'done' });
    })
    .catch((e) => {
      run.state = 'error';
      run.error = e.message;
      emit({ type: 'error', message: e.message });
    });
  res.status(202).json({ id });
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

app.get('/api/runs/:id/report', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.sendStatus(404);
  if (run.state !== 'done') return res.status(409).json({ state: run.state, error: run.error });
  res.type('text/markdown').send(run.report);
});

app.delete('/api/runs/:id', (req, res) => {
  runs.get(req.params.id)?.controller.abort();
  res.sendStatus(204);
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '127.0.0.1', () => console.log(`Checklist agent on http://localhost:${port}`));
