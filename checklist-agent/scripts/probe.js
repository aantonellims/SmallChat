import { SemanticModelClient } from '../src/fabric.js';

// Plumbing check only (no LLM): node scripts/probe.js <workspaceId> <modelId>
const [workspaceId, modelId] = process.argv.slice(2);
const m = new SemanticModelClient({ workspaceId, modelId });
const info = await m.getInfo();
console.log('model:', info.displayName);
const files = await m.loadDefinition();
console.log('definition files:', files.size, [...files.keys()].slice(0, 8));
try {
  const r = await m.executeDax('EVALUATE INFO.TABLES()', 5);
  console.log('INFO.TABLES rows:', r.rowCount);
} catch (e) {
  console.log('DAX error:', e.message.slice(0, 300));
}
