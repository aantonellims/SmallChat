import { loadChecklist } from '../src/checklist.js';
import { parseModelUrl, SemanticModelClient } from '../src/fabric.js';
import { runChecklist } from '../src/agent.js';

// Debug a subset of items: node scripts/run-items.js "<model url>" i02,i03
const [url, ids] = process.argv.slice(2);
const r = await runChecklist({
  sections: loadChecklist(),
  model: new SemanticModelClient(parseModelUrl(url)),
  itemIds: ids.split(','),
  emit: (e) => console.log(JSON.stringify(e).slice(0, 400)),
});
console.log(JSON.stringify(r.results, null, 2));
