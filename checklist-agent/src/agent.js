import { CopilotClient, approveAll, defineTool } from '@github/copilot-sdk';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { guidanceFor } from './prompts.js';

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');

export const STATUSES = ['pass', 'warn', 'fail', 'manual', 'not_applicable'];
const MAX_TOOL_CHARS = 24000;

const clip = (s, n = MAX_TOOL_CHARS) => (s.length > n ? `${s.slice(0, n)}\n...[truncated ${s.length - n} chars]` : s);

const SYSTEM = `You are a Power BI / Microsoft Fabric semantic model expert preparing a model for Fabric Data Agent and Copilot (Prep for AI).
You assess ONE checklist section at a time against a real semantic model and you EXECUTE the checks yourself. Never delegate a check to the user when you can run it.
Tools:
- Custom read-only tools: list_model_files / read_model_file / search_model (the downloaded TMDL definition) and record_item_result. There is NO other DAX tool: all live DAX/INFO/DMV queries MUST go through the powerbi-modeling MCP.
- MCP server "powerbi-modeling" (hosted Power BI authoring MCP, already authenticated as the signed-in user). Its tools are deferred: call tool_search_tool (e.g. pattern "powerbi-modeling") to load them; they are named powerbi-modeling-<tool> (ignore any "powerbi-modeling-mcp-*" duplicates). FIRST call powerbi-modeling-connection_operations with {"request":{"operation":"ConnectFabric", ...}} using the workspace/model ids from the prompt (call operation "Help" first if unsure). Then use powerbi-modeling-dax_query_operations (Execute) for DAX incl. INFO.* functions and timing, and model/table/column/measure/relationship/partition/database (ExportTMDL) operations with READ-ONLY operations only (Help, Get, List, Execute, Validate, ExportTMDL, ConnectFabric, Disconnect, ClearCache). Any Create/Update/Delete/Refresh/Rename/Remove operation is forbidden and will be rejected.
- Skill semantic-model-review: procedures for Best Practice Analyzer rules, Memory Analyzer, performance timing, dependency tracing.
Rules:
- Gather evidence by running tools before judging. Never guess. Prefer MCP/DAX results over inference from TMDL.
- Prep for AI settings (AI data schema, verified answers, AI instructions) may be exposed in the definition (Copilot/ folder, annotations) or via MCP; look for them. If after looking nothing is visible, you cannot prove they are missing: use manual and explain how to verify; use fail only with concrete evidence.
- For EVERY checklist item call record_item_result exactly once with status:
  pass = verified OK; warn = partially OK / improvement advised; fail = clearly not met;
  manual = only for pure process/UI items that no tool can verify (Data Agent UI, M365 publishing, team processes) or when your tools genuinely failed (state the error);
  not_applicable = does not apply to this model (e.g. Direct Lake items on an Import model).
- evidence: concrete findings with object names, counts, measured numbers (max 1200 chars). recommendation: detailed, actionable fix with exact object names and, where useful, the corrected DAX/TMDL/steps (max 1000 chars; empty if pass).
- Items marked critical matter most; be strict.
- Do not modify the model. Do not ask the user questions; decide with the evidence available.`;

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
        const r = { itemId: item_id, status, evidence: evidence.slice(0, 1500), recommendation: recommendation.slice(0, 1200) };
        results.set(item_id, r);
        emit({ type: 'item', ...r });
        return 'recorded';
      },
    }),
  ];
}

const TOOL_NAMES = ['list_model_files', 'read_model_file', 'search_model', 'record_item_result', 'mcp:*', 'skill', 'tool_search_tool'];
const MCP_SERVER = 'powerbi-modeling';
const MCP_URL = process.env.PBI_MCP_URL || 'https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring';
const READ_ONLY_OPS = /^(help|get\w*|list\w*|execute\w*|validate\w*|exporttmdl|connectfabric|connect|disconnect|clearcache|checkstatus)$/i;

// Allows read-only MCP operations and benign built-ins; rejects any mutating MCP operation, shell, file writes and URLs.
export function permissionHandler(request) {
  if (request.kind === 'mcp') {
    if (request.serverName !== MCP_SERVER) return { kind: 'reject', feedback: `Only the ${MCP_SERVER} MCP server may be used in this review.` };
    let op = '';
    try {
      const a = typeof request.args === 'string' ? JSON.parse(request.args) : request.args;
      const body = typeof a?.request === 'string' ? JSON.parse(a.request) : (a?.request ?? a);
      op = String(body?.operation ?? body?.Operation ?? '');
    } catch {
      /* fall through: unknown shape handled below */
    }
    if (op ? READ_ONLY_OPS.test(op) : request.readOnly) return { kind: 'approve-once' };
    return { kind: 'reject', feedback: `Operation "${op || 'unknown'}" is not allowed: this review is read-only.` };
  }
  if (['shell', 'write', 'url'].includes(request.kind)) return { kind: 'reject', feedback: 'Not allowed in this review.' };
  return { kind: 'approve-once' };
}

function sectionPrompt(section, info, ctx) {
  const lines = section.items.map((i) => {
    const g = guidanceFor(i.id);
    return `- ${i.id}${i.critical ? ' [CRITICAL]' : ''}: ${i.text}\n    How to assess: ${g.how}${g.manual ? '\n    (Process/UI item: answer manual unless a tool gives direct evidence.)' : ''}`;
  });
  return `Use the semantic-model-review skill for procedures.
Semantic model: "${info.displayName}" (modelId ${info.id}) in Fabric workspace "${ctx.workspaceName}" (workspaceId ${ctx.workspaceId}).
Your FIRST action must be tool_search_tool with pattern "powerbi-modeling" to load the MCP tools, then powerbi-modeling-connection_operations ConnectFabric (workspaceId ${ctx.workspaceId}, modelId ${info.id}). Do not assess any item before the connection succeeds; if it fails, retry once and report the error in evidence.
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
  const ctx = { workspaceId: model.workspaceId, workspaceName: (await model.getWorkspaceName?.()) ?? model.workspaceId };

  const results = new Map();
  const client = new CopilotClient();
  await client.start?.();
  try {
    for (const section of sections) {
      if (signal?.aborted) throw new Error('Run cancelled.');
      emit({ type: 'section', id: section.id, title: section.title, items: section.items.length });
      const token = await model.getToken('https://api.fabric.microsoft.com');
      const session = await client.createSession({
        ...(copilotModel ? { model: copilotModel } : {}),
        tools: buildTools({ model, results, emit }),
        skillDirectories: [SKILLS_DIR],
        mcpServers: { 'powerbi-modeling': { type: 'http', url: MCP_URL, headers: { Authorization: `Bearer ${token}` }, tools: ['*'] } },
        availableTools: TOOL_NAMES,
        systemMessage: { mode: 'append', content: SYSTEM },
        onPermissionRequest: permissionHandler,
      });
      const off = session.on((evt) => {
        if (evt.type === 'tool.execution_start') {
          const name = evt.data?.toolName ?? evt.data?.name;
          if (name && name !== 'record_item_result') emit({ type: 'tool', name });
        }
      });
      try {
        await session.sendAndWait({ prompt: sectionPrompt(section, info, ctx) }, 25 * 60 * 1000);
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
      return `${i.id} | ${s.title} | ${i.critical ? 'CRITICAL | ' : ''}${r.status} | ${i.text.slice(0, 120)} | ${r.evidence.slice(0, 700)} | ${r.recommendation}`;
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
        prompt: `Model: ${info.displayName}. Findings (id | section | [critical] | status | item | evidence | recommendation):\n${rows.join('\n')}\n\nWrite a DETAILED markdown report using only ### headings (never # or ##): 1) "### Executive summary" (5-6 sentences: readiness for Fabric Data Agent, biggest risks, what was measured), 2) "### Key findings" (grouped by theme: schema, naming/descriptions, measures, performance/memory, Prep for AI; each finding cites the evidence with numbers and object names), 3) "### Prioritized recommendations" (ordered; critical failures first; for each: what to change, exact objects, how to do it, expected benefit, effort S/M/L; include corrected DAX/TMDL snippets where useful), 4) "### Quick wins", 5) "### Remaining manual steps" (only items not verifiable by tools, with how-to). Do not repeat the full item table.`,
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
