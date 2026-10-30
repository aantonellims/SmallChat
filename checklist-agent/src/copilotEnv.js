import { CopilotClient } from '@github/copilot-sdk';
import { DefaultAzureCredential } from '@azure/identity';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { githubToken, githubStatus } from './githubAuth.js';

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS_DIR = path.join(APP_DIR, 'skills');
export const MCP_URL = process.env.PBI_MCP_URL || 'https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring';
const REQUIRED_SKILLS = ['semantic-model-review', 'powerbi-modeling'];

// How the app talks to a model. Chosen with environment variables (and the in-app GitHub sign-in) so the same code runs locally and when deployed:
//   local (default)     : the machine's Copilot / gh login (useLoggedInUser)
//   github-user         : the user signed in through "Connect GitHub Copilot" (GitHub OAuth device flow, needs GITHUB_CLIENT_ID): the user's OWN Copilot plan
//   github-token        : COPILOT_GITHUB_TOKEN (a token of a user or service account that has Copilot)
//   byok                : COPILOT_PROVIDER_TYPE=azure|openai|anthropic + COPILOT_PROVIDER_BASE_URL
//                         + COPILOT_PROVIDER_API_KEY, or COPILOT_PROVIDER_AUTH=managed-identity (Azure AI Foundry / Azure OpenAI, no Copilot seat)
//                         + COPILOT_BYOK_MODELS=deployment1,deployment2 (the models users can pick)
export function copilotConfig(env = process.env, signedInToken = undefined) {
  const baseUrl = env.COPILOT_PROVIDER_BASE_URL;
  const byok = !!(env.COPILOT_PROVIDER_TYPE && baseUrl);
  const token = env.COPILOT_GITHUB_TOKEN || signedInToken;
  const mode = byok ? 'byok' : env.COPILOT_GITHUB_TOKEN ? 'github-token' : signedInToken ? 'github-user' : 'local';
  // Deployed modes must not depend on (or leak) the host's ~/.copilot (user MCP servers, plugins, login).
  const baseDirectory = env.COPILOT_APP_HOME || (mode === 'local' ? undefined : path.join(APP_DIR, '.copilot-home'));
  const models = (env.COPILOT_BYOK_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);

  const clientOptions = { ...(baseDirectory ? { baseDirectory } : {}) };
  if (mode === 'github-token' || mode === 'github-user') Object.assign(clientOptions, { gitHubToken: token, useLoggedInUser: false });
  if (mode === 'byok') {
    clientOptions.useLoggedInUser = false;
    clientOptions.onListModels = () => models.map((id) => ({ id, name: id, capabilities: {} }));
  }

  const provider = (model) => {
    if (mode !== 'byok') return undefined;
    const p = { type: env.COPILOT_PROVIDER_TYPE, baseUrl, modelId: model, wireModel: model };
    if (env.COPILOT_PROVIDER_AUTH === 'managed-identity') {
      const cred = new DefaultAzureCredential();
      p.bearerTokenProvider = async () => (await cred.getToken('https://cognitiveservices.azure.com/.default')).token;
    } else if (env.COPILOT_PROVIDER_API_KEY) p.apiKey = env.COPILOT_PROVIDER_API_KEY;
    if (env.COPILOT_PROVIDER_API_VERSION) p.azure = { apiVersion: env.COPILOT_PROVIDER_API_VERSION };
    return p;
  };
  return { mode, clientOptions, provider, byokModels: models, defaultModel: env.COPILOT_MODEL || models[0] || undefined, baseDirectory };
}

// Re-evaluated on every use so signing in/out of GitHub takes effect immediately.
export const currentConfig = () => copilotConfig(process.env, githubToken());

export function createCopilotClient() {
  return new CopilotClient(currentConfig().clientOptions);
}

// Options every agent session must get so that the chosen model/provider is honoured.
export function modelSessionOptions(model) {
  const config = currentConfig();
  const m = model || config.defaultModel;
  const provider = config.provider(m);
  return { ...(m ? { model: m } : {}), ...(provider ? { provider } : {}) };
}

// Preflight: is the Copilot runtime usable here, which models can the user choose, are skills and the MCP in place?
export async function copilotStatus() {
  const config = currentConfig();
  const out = { mode: config.mode, isolated: !!config.baseDirectory, defaultModel: config.defaultModel ?? null, github: githubStatus(), auth: { ok: false }, models: [], skills: [], mcp: { url: MCP_URL, reachable: false }, problems: [] };
  const client = createCopilotClient();
  try {
    await client.start?.();
    try {
      const a = await client.getAuthStatus();
      out.auth = { ok: !!a.isAuthenticated, type: a.authType, login: a.login, statusMessage: a.statusMessage };
    } catch (e) {
      out.problems.push(`Could not read Copilot auth status: ${e.message}`);
    }
    if (config.mode === 'byok') out.auth.ok = true;
    if (out.auth.ok) {
      try {
        out.models = (await client.listModels())
          .filter((m) => !m.policy || m.policy.state !== 'disabled')
          .map((m) => ({ id: m.id, name: m.name || m.id, premium: m.billing?.multiplier ?? null, reasoning: !!m.supportedReasoningEfforts?.length }));
      } catch (e) {
        out.problems.push(`Could not list models: ${e.message}`);
      }
    } else {
      out.problems.push(
        config.mode === 'local'
          ? `Copilot is not signed in on this machine.${out.github.available ? ' Click "Connect GitHub Copilot" below to use your own GitHub account,' : ' Run "copilot" (or "gh auth login") once,'} or set COPILOT_GITHUB_TOKEN.`
          : 'Copilot authentication failed. Check the GitHub account / COPILOT_GITHUB_TOKEN (the owner needs a Copilot license) or the BYOK settings.',
      );
    }
  } catch (e) {
    out.problems.push(`Copilot runtime could not start: ${e.message}`);
  } finally {
    await client.stop?.().catch(() => {});
  }
  const have = existsSync(SKILLS_DIR) ? readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(path.join(SKILLS_DIR, d.name, 'SKILL.md'))).map((d) => d.name) : [];
  out.skills = REQUIRED_SKILLS.map((name) => ({ name, found: have.includes(name) }));
  for (const s of out.skills) if (!s.found) out.problems.push(`Skill "${s.name}" is missing in ${SKILLS_DIR}.`);
  try {
    await fetch(MCP_URL, { method: 'GET', signal: AbortSignal.timeout(8000) });
    out.mcp.reachable = true; // any HTTP answer (even 401) means the endpoint is reachable
  } catch (e) {
    out.problems.push(`Power BI authoring MCP not reachable (${e.message}). Outbound access to api.fabric.microsoft.com is required.`);
  }
  if (config.mode === 'byok' && !config.byokModels.length) out.problems.push('COPILOT_BYOK_MODELS is empty: set the deployment names users can choose.');
  out.ready = out.problems.length === 0 && out.auth.ok;
  return out;
}
