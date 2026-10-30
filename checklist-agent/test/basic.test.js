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

test('copilot config: local, github-token and BYOK modes with isolation', async () => {
  const { copilotConfig } = await import('../src/copilotEnv.js');
  const local = copilotConfig({});
  assert.equal(local.mode, 'local');
  assert.equal(local.baseDirectory, undefined);
  assert.equal(local.provider('x'), undefined);

  const tok = copilotConfig({ COPILOT_GITHUB_TOKEN: 'abc', COPILOT_MODEL: 'm1' });
  assert.equal(tok.mode, 'github-token');
  assert.equal(tok.clientOptions.gitHubToken, 'abc');
  assert.equal(tok.clientOptions.useLoggedInUser, false);
  assert.ok(tok.baseDirectory?.endsWith('.copilot-home'));
  assert.equal(tok.defaultModel, 'm1');

  const byok = copilotConfig({ COPILOT_PROVIDER_TYPE: 'azure', COPILOT_PROVIDER_BASE_URL: 'https://x.openai.azure.com', COPILOT_PROVIDER_API_KEY: 'k', COPILOT_BYOK_MODELS: 'gpt-a, gpt-b' });
  assert.equal(byok.mode, 'byok');
  assert.deepEqual(byok.clientOptions.onListModels().map((m) => m.id), ['gpt-a', 'gpt-b']);
  const p = byok.provider('gpt-b');
  assert.deepEqual([p.type, p.baseUrl, p.apiKey, p.wireModel], ['azure', 'https://x.openai.azure.com', 'k', 'gpt-b']);
  assert.equal(byok.defaultModel, 'gpt-a');
  assert.equal(copilotConfig({ COPILOT_PROVIDER_TYPE: 'azure', COPILOT_PROVIDER_BASE_URL: 'https://x', COPILOT_PROVIDER_AUTH: 'managed-identity' }).provider('m').bearerTokenProvider.constructor.name, 'AsyncFunction');
});

test('github-user mode uses the signed-in GitHub token and isolates the runtime', async () => {
  const { copilotConfig } = await import('../src/copilotEnv.js');
  const c = copilotConfig({}, 'gho_user');
  assert.equal(c.mode, 'github-user');
  assert.equal(c.clientOptions.gitHubToken, 'gho_user');
  assert.equal(c.clientOptions.useLoggedInUser, false);
  assert.ok(c.baseDirectory?.endsWith('.copilot-home'));
  // an explicit service token still wins over the interactive sign-in
  assert.equal(copilotConfig({ COPILOT_GITHUB_TOKEN: 'svc' }, 'gho_user').mode, 'github-token');
});

test('GitHub device flow signs in with a mocked GitHub', async () => {
  const gh = await import('../src/githubAuth.js');
  process.env.GITHUB_CLIENT_ID = 'test-client';
  let polls = 0;
  const mock = async (url) => {
    const json = (o, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => o });
    if (url.endsWith('/login/device/code')) return json({ device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0.01, expires_in: 60 });
    if (url.endsWith('/login/oauth/access_token')) return json(++polls < 2 ? { error: 'authorization_pending' } : { access_token: 'gho_abc' });
    if (url.endsWith('/user')) return json({ login: 'octo', name: 'Octo' });
    throw new Error(`unexpected ${url}`);
  };
  const start = await gh.startGithubLogin(mock);
  assert.equal(start.userCode, 'ABCD-1234');
  for (let i = 0; i < 100 && !gh.githubStatus().signedIn; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(gh.githubStatus().signedIn, true);
  assert.equal(gh.githubToken(), 'gho_abc');
  assert.equal(gh.githubStatus().user.login, 'octo');
  gh.githubLogout();
  assert.equal(gh.githubToken(), null);
  delete process.env.GITHUB_CLIENT_ID;
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
