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

test('parseModelUrl handles datasets and semanticmodels URLs', () => {
  const ws = '11111111-1111-1111-1111-111111111111';
  const id = '22222222-2222-2222-2222-222222222222';
  for (const p of ['datasets', 'semanticmodels']) {
    const r = parseModelUrl(`https://app.powerbi.com/groups/${ws}/${p}/${id}/details?experience=power-bi`);
    assert.deepEqual(r, { workspaceId: ws, modelId: id });
  }
  assert.throws(() => parseModelUrl('https://example.com/groups/x'));
  assert.throws(() => parseModelUrl('https://app.powerbi.com/home'));
});
