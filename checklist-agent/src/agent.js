import { CopilotClient, approveAll, defineTool } from '@github/copilot-sdk';

export const STATUSES = ['pass', 'warn', 'fail', 'manual', 'not_applicable'];
const MAX_TOOL_CHARS = 24000;

const clip = (s, n = MAX_TOOL_CHARS) => (s.length > n ? `${s.slice(0, n)}\n...[truncated ${s.length - n} chars]` : s);

const SYSTEM = `You are a Power BI / Microsoft Fabric semantic model reviewer preparing a model for Fabric Data Agent and Copilot (Prep for AI).
You assess ONE checklist section at a time against a real semantic model, using ONLY the provided tools (read-only).
Rules:
- Gather evidence with list_model_files, read_model_file, search_model and run_dax before judging. Never guess.
- The model definition is TMDL. Prep for AI settings (AI instructions, verified answers, AI data schema) may live in files under a Copilot/ folder or in model annotations; search for them.
- For EVERY checklist item call record_item_result exactly once with status:
  pass = verified OK; warn = partially OK / improvement advised; fail = clearly not met;
  manual = cannot be verified from the model definition or DAX (e.g. runs in a notebook, Power BI Desktop UI, Data Agent UI, report-level artifacts, process items) - say what the user must do;
  not_applicable = does not apply to this model (e.g. Direct Lake items on an Import model).
- evidence: concrete facts (object names, counts, file paths), max 600 chars. recommendation: one actionable fix (empty if pass), max 400 chars.
- Items marked critical matter most; be strict on them.
- run_dax is read-only: use EVALUATE only, keep results small (TOPN / INFO.* functions are fine).
- Do not modify anything. Do not ask the user questions; decide with the evidence available.`;

export function buildTools({ model, results, emit }) {
  const files = async () => model.loadDefinition();
  return [
    defineTool('list_model_files', {
      description: 'List all files of the semantic model definition (TMDL) with their size in characters.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      skipPermission: true,
      handler: async () => {
        const f = await files();
        return [...f].map(([p, c]) => `${p}\t${c.length}`).join('\n');
      },
    }),
    defineTool('read_model_file', {
      description: 'Read a file of the semantic model definition by exact path (see list_model_files). Large files are paged with offset.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 } },
        required: ['path'],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async ({ path, offset = 0 }) => {
        const f = await files();
        if (!f.has(path)) return `File not found: ${path}. Use list_model_files.`;
        return clip(f.get(path).slice(offset));
      },
    }),
    defineTool('search_model', {
      description: 'Case-insensitive regex search over all model definition files. Returns path:line: text (max 80 hits).',
      parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'], additionalProperties: false },
      skipPermission: true,
      handler: async ({ pattern }) => {
        let re;
        try {
          re = new RegExp(pattern, 'i');
        } catch (e) {
          return `Invalid regex: ${e.message}`;
        }
        const hits = [];
        for (const [p, c] of await files()) {
          c.split(/\r?\n/).forEach((line, i) => {
            if (hits.length < 80 && re.test(line)) hits.push(`${p}:${i + 1}: ${line.trim().slice(0, 200)}`);
          });
        }
        return hits.length ? hits.join('\n') : 'No matches.';
      },
    }),
    defineTool('run_dax', {
      description: 'Run a read-only DAX query (must start with EVALUATE or DEFINE) against the semantic model. Returns up to 100 rows as JSON.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
      skipPermission: true,
      handler: async ({ query }) => {
        if (!/^\s*(--[^\n]*\n\s*|\/\/[^\n]*\n\s*)*(EVALUATE|DEFINE)\b/i.test(query)) return 'Only EVALUATE/DEFINE queries are allowed.';
        try {
          const r = await model.executeDax(query, 100);
          return clip(JSON.stringify(r));
        } catch (e) {
          return `DAX error: ${e.message}`;
        }
      },
    }),
    defineTool('record_item_result', {
      description: 'Record the verdict for one checklist item. Call exactly once per item.',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'string' },
          status: { type: 'string', enum: STATUSES },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: ['item_id', 'status', 'evidence'],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: async ({ item_id, status, evidence, recommendation = '' }) => {
        if (!STATUSES.includes(status)) return `Invalid status. Use one of: ${STATUSES.join(', ')}`;
        const r = { itemId: item_id, status, evidence: evidence.slice(0, 800), recommendation: recommendation.slice(0, 600) };
        results.set(item_id, r);
        emit({ type: 'item', ...r });
        return 'recorded';
      },
    }),
  ];
}

const TOOL_NAMES = ['list_model_files', 'read_model_file', 'search_model', 'run_dax', 'record_item_result'];

function sectionPrompt(section, info) {
  const lines = section.items.map((i) => `- ${i.id}${i.critical ? ' [CRITICAL]' : ''}: ${i.text}`);
  return `Semantic model: "${info.displayName}" (${info.id}).
Checklist section: "${section.title}"
${section.notes.length ? `Context: ${section.notes.join(' ')}\n` : ''}Assess every item below and call record_item_result once per item id.
${lines.join('\n')}
When all items are recorded, reply with the single word DONE.`;
}

export async function runChecklist({ sections, model, emit, copilotModel = process.env.COPILOT_MODEL, signal }) {
  const info = await model.getInfo();
  emit({ type: 'model', name: info.displayName, id: info.id });
  emit({ type: 'status', message: 'Downloading semantic model definition (TMDL)...' });
  const files = await model.loadDefinition();
  emit({ type: 'status', message: `Definition loaded: ${files.size} files.` });

  const results = new Map();
  const client = new CopilotClient();
  await client.start?.();
  try {
    for (const section of sections) {
      if (signal?.aborted) throw new Error('Run cancelled.');
      emit({ type: 'section', id: section.id, title: section.title, items: section.items.length });
      const session = await client.createSession({
        ...(copilotModel ? { model: copilotModel } : {}),
        tools: buildTools({ model, results, emit }),
        availableTools: TOOL_NAMES,
        systemMessage: { mode: 'append', content: SYSTEM },
        onPermissionRequest: approveAll,
      });
      const off = session.on((evt) => {
        if (evt.type === 'tool.execution_start') {
          const name = evt.data?.toolName ?? evt.data?.name;
          if (name && name !== 'record_item_result') emit({ type: 'tool', name });
        }
      });
      try {
        await session.sendAndWait({ prompt: sectionPrompt(section, info) }, 15 * 60 * 1000);
      } catch (e) {
        emit({ type: 'status', message: `Section "${section.title}" failed: ${e.message}` });
      } finally {
        off();
        await session.disconnect();
      }
      for (const item of section.items) {
        if (!results.has(item.id)) {
          const r = { itemId: item.id, status: 'manual', evidence: 'The agent did not return a verdict for this item.', recommendation: 'Review this item manually.' };
          results.set(item.id, r);
          emit({ type: 'item', ...r });
        }
      }
    }
    emit({ type: 'status', message: 'Writing recommendations...' });
    const summary = await summarize({ client, sections, results, info, copilotModel });
    return { info, results: Object.fromEntries(results), summary };
  } finally {
    await client.stop?.();
  }
}

async function summarize({ client, sections, results, info, copilotModel }) {
  const rows = sections.flatMap((s) =>
    s.items.map((i) => {
      const r = results.get(i.id);
      return `${i.id} | ${s.title} | ${i.critical ? 'CRITICAL | ' : ''}${r.status} | ${i.text.slice(0, 120)} | ${r.evidence.slice(0, 200)} | ${r.recommendation}`;
    }),
  );
  const session = await client.createSession({
    ...(copilotModel ? { model: copilotModel } : {}),
    availableTools: [],
    systemMessage: { mode: 'append', content: 'You write concise, prioritized remediation reports for semantic model owners. Use only the findings provided.' },
    onPermissionRequest: approveAll,
  });
  try {
    const res = await session.sendAndWait(
      {
        prompt: `Model: ${info.displayName}. Findings (id | section | [critical] | status | item | evidence | recommendation):\n${rows.join('\n')}\n\nWrite markdown using only ### headings (never # or ##) with: 1) "### Readiness summary" (3-4 sentences for Fabric Data Agent), 2) "### Top priorities" (max 8, ordered; critical failures first, each with the concrete fix), 3) "### Quick wins", 4) "### Manual follow-ups". Do not repeat the full table.`,
      },
      5 * 60 * 1000,
    );
    return res?.data?.content ?? '';
  } finally {
    await session.disconnect();
  }
}

export function renderReport({ sections, results, info, summary }) {
  const icon = { pass: '✅', warn: '🟡', fail: '❌', manual: '🖐️', not_applicable: '➖' };
  const count = (s) => Object.values(results).filter((r) => r.status === s).length;
  const out = [`# Semantic model readiness report: ${info.displayName}`, ''];
  out.push(`Pass ${count('pass')} · Warn ${count('warn')} · Fail ${count('fail')} · Manual ${count('manual')} · N/A ${count('not_applicable')}`, '');
  if (summary) out.push(summary, '');
  for (const s of sections) {
    out.push(`## ${s.title}`, '', '| | Item | Evidence | Recommendation |', '|---|---|---|---|');
    for (const i of s.items) {
      const r = results[i.id];
      const cell = (t) => String(t || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      out.push(`| ${icon[r.status]} | ${i.critical ? '**' : ''}${cell(i.text)}${i.critical ? '**' : ''} | ${cell(r.evidence)} | ${cell(r.recommendation)} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
