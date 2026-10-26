import { execFile } from 'node:child_process';

const FABRIC_API = 'https://api.fabric.microsoft.com/v1';
const PBI_API = 'https://api.powerbi.com/v1.0/myorg';
const GUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

// Extracts workspace and semantic model ids from a Power BI / Fabric portal URL.
export function parseModelUrl(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw new Error('Invalid URL.');
  }
  if (!/(^|\.)(powerbi\.com|fabric\.microsoft\.com)$/i.test(u.hostname)) {
    throw new Error('URL must be a Power BI or Fabric portal URL.');
  }
  const m = new RegExp(`/groups/(${GUID})/(?:datasets|semanticmodels)/(${GUID})`, 'i').exec(u.pathname);
  if (!m) {
    throw new Error('Could not find /groups/<workspaceId>/(datasets|semanticmodels)/<modelId> in the URL.');
  }
  return { workspaceId: m[1], modelId: m[2] };
}

// Local-dev token provider based on the Azure CLI. Swap for another provider when hosted.
export function azCliTokenProvider() {
  const cache = new Map();
  return (resource) =>
    new Promise((resolve, reject) => {
      const hit = cache.get(resource);
      if (hit && hit.exp > Date.now()) return resolve(hit.token);
      execFile(
        process.platform === 'win32' ? 'cmd.exe' : 'az',
        [...(process.platform === 'win32' ? ['/c', 'az'] : []), 'account', 'get-access-token', '--resource', resource, '--query', 'accessToken', '-o', 'tsv'],
        { timeout: 60000 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(`az login required: ${(stderr || err.message).trim()}`));
          const token = stdout.trim();
          cache.set(resource, { token, exp: Date.now() + 30 * 60 * 1000 });
          resolve(token);
        },
      );
    });
}

async function http(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return res;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SemanticModelClient {
  constructor({ workspaceId, modelId, getToken = azCliTokenProvider() }) {
    this.workspaceId = workspaceId;
    this.modelId = modelId;
    this.getToken = getToken;
    this.files = null;
    this.info = null;
  }

  async getInfo() {
    if (this.info) return this.info;
    const token = await this.getToken('https://api.fabric.microsoft.com');
    const res = await http(`${FABRIC_API}/workspaces/${this.workspaceId}/semanticModels/${this.modelId}`, token);
    if (!res.ok) throw new Error(`Fabric get semantic model failed (${res.status}): ${await res.text()}`);
    this.info = await res.json();
    return this.info;
  }

  // Downloads the model definition in TMDL format (long-running operation) and caches the decoded files.
  async loadDefinition() {
    if (this.files) return this.files;
    const token = await this.getToken('https://api.fabric.microsoft.com');
    const start = `${FABRIC_API}/workspaces/${this.workspaceId}/semanticModels/${this.modelId}/getDefinition?format=TMDL`;
    let res = await http(start, token, { method: 'POST' });
    if (res.status === 202) {
      const location = res.headers.get('location');
      for (let i = 0; i < 90; i++) {
        await sleep(Math.max(1, Number(res.headers.get('retry-after') || 2)) * 1000);
        res = await http(location, token);
        if (res.status === 200) {
          const state = await res.clone().json().catch(() => ({}));
          if (state.status === 'Succeeded' || state.definition) {
            if (!state.definition) res = await http(`${location}/result`, token);
            break;
          }
          if (state.status === 'Failed') throw new Error(`getDefinition failed: ${JSON.stringify(state.error)}`);
        }
        if (res.status >= 400) throw new Error(`getDefinition poll failed (${res.status}): ${await res.text()}`);
      }
    }
    if (!res.ok) {
      const body = await res.text();
      const hint = res.status === 404 || res.status === 403 ? ' Reading the definition requires Read+Write permission on the semantic model (and the model must not be a system-generated usage metrics model).' : '';
      throw new Error(`getDefinition failed (${res.status}).${hint} ${body.slice(0, 300)}`);
    }
    const body = await res.json();
    const parts = body.definition?.parts;
    if (!parts) throw new Error('getDefinition returned no definition parts.');
    this.files = new Map(
      parts.filter((p) => p.payloadType === 'InlineBase64').map((p) => [p.path, Buffer.from(p.payload, 'base64').toString('utf8')]),
    );
    return this.files;
  }

  async executeDax(query, maxRows = 200) {
    const token = await this.getToken('https://analysis.windows.net/powerbi/api');
    const res = await http(`${PBI_API}/groups/${this.workspaceId}/datasets/${this.modelId}/executeQueries`, token, {
      method: 'POST',
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`executeQueries failed (${res.status}): ${text.slice(0, 1500)}`);
    const json = JSON.parse(text);
    const first = json.results?.[0];
    if (first?.error) throw new Error(JSON.stringify(first.error).slice(0, 1500));
    const rows = first?.tables?.[0]?.rows ?? [];
    return { rowCount: rows.length, rows: rows.slice(0, maxRows) };
  }
}
