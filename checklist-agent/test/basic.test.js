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
