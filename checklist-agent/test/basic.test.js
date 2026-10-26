import test from 'node:test';
import assert from 'node:assert/strict';
import { loadChecklist } from '../src/checklist.js';
import { parseModelUrl } from '../src/fabric.js';

test('checklist parses sections, items and critical flags', () => {
  const s = loadChecklist();
  assert.ok(s.length >= 6);
  const items = s.flatMap((x) => x.items);
  assert.ok(items.length > 50);
  assert.ok(items.some((i) => i.critical));
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.ok(!items.some((i) => i.text.includes('](')));
});

test('every checklist item has item-specific guidance', async () => {
  const { ITEM_GUIDANCE } = await import('../src/prompts.js');
  const ids = loadChecklist().flatMap((s) => s.items.map((i) => i.id));
  assert.deepEqual(ids.filter((id) => !ITEM_GUIDANCE[id]), []);
  assert.deepEqual(Object.keys(ITEM_GUIDANCE).filter((id) => !ids.includes(id)), []);
});

test('permission guard allows read-only MCP operations and blocks mutations', async () => {
  const { permissionHandler } = await import('../src/agent.js');
  const mcp = (operation, readOnly = false, serverName = 'powerbi-modeling') => ({ kind: 'mcp', readOnly, serverName, args: { request: { operation } } });
  assert.equal(permissionHandler(mcp('List', false, 'msxi-snap')).kind, 'reject');
  for (const op of ['Help', 'List', 'Get', 'Execute', 'ConnectFabric', 'ExportTMDL']) assert.equal(permissionHandler(mcp(op)).kind, 'approve-once', op);
  for (const op of ['Create', 'Update', 'Delete', 'Refresh', 'Rename', 'RefreshWithAPI']) assert.equal(permissionHandler(mcp(op)).kind, 'reject', op);
  assert.equal(permissionHandler({ kind: 'mcp', serverName: 'powerbi-modeling', readOnly: false, args: { request: JSON.stringify({ operation: 'Delete' }) } }).kind, 'reject');
  assert.equal(permissionHandler({ kind: 'shell' }).kind, 'reject');
});

test('html report renders markdown and neutralizes raw HTML', async () => {
  const { renderReportHtml } = await import('../src/reportHtml.js');
  const sections = [{ id: 's1', title: 'S', notes: [], items: [{ id: 'i01', text: 'Item', critical: true }] }];
  const results = { i01: { itemId: 'i01', status: 'fail', headline: 'H <b>x</b>', evidence: '- **a**\n<script>alert(1)</script>', recommendation: '```dax\nEVALUATE 1\n```' } };
  const html = renderReportHtml({ sections, results, info: { displayName: 'M' }, summary: '### Sum' });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('<strong>a</strong>') && html.includes('<pre>') && html.includes('<h3>Sum</h3>'));
});

test('ModelCopy edits a copy, rejects ambiguous edits and produces a diff/patch/zip', async () => {
  const { ModelCopy, fileDiff, toPatch, toZip, renderDiffHtml } = await import('../src/fixes.js');
  const files = new Map([
    ['definition/tables/A.tmdl', 'table A\n\tcolumn X\n\t\tsummarizeBy: sum\n\tcolumn Y\n\t\tsummarizeBy: sum\n'],
    ['definition/tables/B.tmdl', 'table B\n'],
    ['definition/database.tmdl', 'database\n'],
  ]);
  const copy = new ModelCopy(files);
  assert.throws(() => copy.replace('definition/tables/A.tmdl', 'summarizeBy: sum', 'summarizeBy: none'), /matches 2 times/);
  assert.throws(() => copy.replace('definition/tables/A.tmdl', 'nope', 'x'), /not found/);
  copy.replace('definition/tables/A.tmdl', '\tcolumn X\n\t\tsummarizeBy: sum', '\tcolumn X\n\t\tsummarizeBy: none');
  copy.remove('definition/tables/B.tmdl');
  assert.throws(() => copy.remove('definition/database.tmdl'));
  assert.equal(files.get('definition/tables/A.tmdl').includes('none'), false);
  const changes = copy.changes();
  assert.equal(changes.length, 2);
  const d = fileDiff(changes[0]);
  assert.deepEqual([d.added, d.removed], [1, 1]);
  assert.ok(toPatch(changes).includes('+\t\tsummarizeBy: none'));
  assert.ok(renderDiffHtml(changes).includes('class="add"') && renderDiffHtml(changes).includes('file deleted'));
  assert.ok(toZip(copy.files).length > 20);
});

test('data agent sections are scoped out unless a Data Agent URL is given', async () => {
  const { parseDataAgentUrl } = await import('../src/fabric.js');
  const s = loadChecklist();
  assert.deepEqual(s.filter((x) => x.scope === 'dataagent').map((x) => x.title), ['Data Agent Configuration', 'Testing and Validation']);
  assert.equal(s.filter((x) => x.scope === 'model').length, 6);
  const dax = s[1];
  assert.equal(dax.title, 'DAX Best Practices');
  assert.equal(dax.items.length, 13);
  assert.ok(dax.items.some((i) => i.critical));
  const q = s[2];
  assert.equal(q.title, 'Question-to-DAX Validation (run by the agent)');
  assert.equal(q.items.length, 6);
  assert.equal(new Set(s.flatMap((x) => x.items.map((i) => i.id))).size, 75);
  const ws = '11111111-1111-1111-1111-111111111111';
  const id = '33333333-3333-3333-3333-333333333333';
  assert.deepEqual(parseDataAgentUrl(`https://app.fabric.microsoft.com/groups/${ws}/aiskills/${id}?experience=fabric-developer`), { workspaceId: ws, itemId: id, url: `https://app.fabric.microsoft.com/groups/${ws}/aiskills/${id}?experience=fabric-developer` });
  assert.throws(() => parseDataAgentUrl('https://example.com/x'));
  assert.throws(() => parseDataAgentUrl('https://app.fabric.microsoft.com/home'));
});

test('parseModelUrl handles datasets and semanticmodels URLs', () => {
  const ws = '11111111-1111-1111-1111-111111111111';
  const id = '22222222-2222-2222-2222-222222222222';
  for (const p of ['datasets', 'semanticmodels', 'modeling']) {
    const r = parseModelUrl(`https://app.powerbi.com/groups/${ws}/${p}/${id}/details?experience=power-bi`);
    assert.deepEqual(r, { workspaceId: ws, modelId: id });
  }
  assert.throws(() => parseModelUrl('https://example.com/groups/x'));
  assert.throws(() => parseModelUrl('https://app.powerbi.com/home'));
});
