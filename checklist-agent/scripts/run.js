import { writeFileSync } from 'node:fs';
import { loadChecklist } from '../src/checklist.js';
import { parseModelUrl, SemanticModelClient } from '../src/fabric.js';
import { runChecklist, renderReport } from '../src/agent.js';

// CLI runner: node scripts/run.js <semantic model url> [output.md]
const [url, out = 'report.md'] = process.argv.slice(2);
const sections = loadChecklist();
const r = await runChecklist({
  sections,
  model: new SemanticModelClient(parseModelUrl(url)),
  emit: (e) => {
    if (e.type === 'item') console.log(`  ${e.itemId} ${e.status}`);
    else if (e.type === 'section' || e.type === 'status') console.log(e.title ?? e.message);
  },
});
writeFileSync(out, renderReport({ sections, ...r }));
console.log(`Report written to ${out}`);
