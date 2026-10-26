import { runChecklist, renderReport } from '../src/agent.js';

// Offline smoke test: real Copilot agent loop against a tiny in-memory model.
const files = new Map([
  ['definition/model.tmdl', 'model Model\n\tculture: en-US\n'],
  ['definition/tables/Sales.tmdl', "table Sales\n\tcolumn TR_AMT\n\t\tdataType: string\n\tcolumn CustName\n\t\tdataType: string\n\tmeasure 'Total Sales' = SUM(Sales[TR_AMT])\n"],
]);
const model = {
  getInfo: async () => ({ id: 'fake', displayName: 'Smoke model' }),
  loadDefinition: async () => files,
  executeDax: async () => ({ rowCount: 0, rows: [] }),
};
const sections = [
  {
    id: 's1',
    title: 'Smoke',
    notes: [],
    items: [
      { id: 'i01', text: 'Use clear, business-friendly names for tables, columns, and measures (not TR_AMT, CustName)', critical: false },
      { id: 'i02', text: 'Add descriptions to tables, columns, and measures', critical: false },
    ],
  },
];
const r = await runChecklist({ sections, model, emit: (e) => console.log(JSON.stringify(e)) });
console.log(renderReport({ sections, ...r }));
