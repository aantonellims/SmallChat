import { SemanticModelClient } from '../src/fabric.js';

// DAX-only probe: node scripts/probe-dax.js <workspaceId> <modelId>
const [workspaceId, modelId] = process.argv.slice(2);
const m = new SemanticModelClient({ workspaceId, modelId });
for (const fn of ['ROW', 'TABLES', 'COLUMNS', 'MEASURES', 'RELATIONSHIPS', 'ANNOTATIONS', 'PARTITIONS']) {
  try {
    const q = fn === 'ROW' ? 'EVALUATE ROW("x", 1)' : `EVALUATE INFO.${fn}()`;
    const r = await m.executeDax(q, 3);
    console.log(fn, 'rows:', r.rowCount, 'cols:', Object.keys(r.rows[0] ?? {}).slice(0, 6).join(','));
  } catch (e) {
    console.log(fn, 'ERR', e.message.slice(0, 900));
  }
}
