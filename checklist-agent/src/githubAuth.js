// GitHub sign-in so the deployed app runs on the user's OWN Copilot profile instead of the host machine's login. Two methods:
//  1. CLI device flow (default, NO setup): the app runs `copilot login --device-code` in its own isolated Copilot home; GitHub's own Copilot
//     CLI OAuth app is used, so the end user only types a code on github.com/login/device.
//  2. OAuth App device flow (optional): set GITHUB_CLIENT_ID (OAuth App with "Enable Device Flow"); the access token is kept in memory.
// Single-user, in-memory session (same model as the Microsoft sign-in). A multi-user deployment must keep one identity per user.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = { token: null, user: null, pending: null, error: null, abort: null, cliProc: null };

// Where the isolated Copilot runtime keeps its data (and the CLI login).
export const appHome = (env = process.env) => env.COPILOT_APP_HOME || path.join(APP_DIR, '.copilot-home');
const marker = () => path.join(appHome(), '.cli-login');
const cliLoader = () => process.env.COPILOT_CLI_PATH || path.join(APP_DIR, 'node_modules', '@github', 'copilot', 'npm-loader.js');
export const cliAvailable = () => existsSync(cliLoader());
export const githubCliLoggedIn = () => existsSync(marker());
export const githubAvailable = () => !!process.env.GITHUB_CLIENT_ID || cliAvailable();

function cliCommand(args) {
  const loader = cliLoader();
  return loader.endsWith('.js') ? [process.execPath, [loader, ...args]] : [loader, args];
}
function cliEnv() {
  // Ambient tokens would make the CLI skip the login, so remove them; the runtime reads the login from COPILOT_HOME.
  const env = { ...process.env, COPILOT_HOME: appHome() };
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN']) delete env[k];
  return env;
}

// Runs `copilot login --device-code`, resolves with the code to show, and completes the sign-in in the background.
export function startCliLogin(spawnImpl = spawn) {
  state.error = null;
  state.cliProc?.kill();
  mkdirSync(appHome(), { recursive: true });
  const [cmd, args] = cliCommand(['login', '--device-code']);
  const proc = spawnImpl(cmd, args, { env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  state.cliProc = proc;
  let output = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`The Copilot CLI did not return a sign-in code. Output: ${output.slice(0, 300) || '(none)'}`)); }, 30000);
    const onData = (chunk) => {
      output += chunk.toString();
      const m = /visit\s+(\S+)\s+and enter code\s+([A-Z0-9-]+)/i.exec(output);
      if (m) {
        clearTimeout(timer);
        resolve({ userCode: m[2], verificationUri: m[1], method: 'cli' });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => { clearTimeout(timer); state.error = e.message; reject(e); });
    proc.on('exit', (code) => {
      state.cliProc = null;
      if (code === 0) writeFileSync(marker(), new Date().toISOString());
      else if (!/enter code/i.test(output)) { clearTimeout(timer); reject(new Error(`Copilot CLI sign-in failed: ${output.slice(0, 300)}`)); }
      else state.error = 'GitHub sign-in did not complete. Try again.';
    });
  });
}

export const githubAvailableMethod = () => (process.env.GITHUB_CLIENT_ID ? 'oauth' : cliAvailable() ? 'cli' : null);

export async function startGithubLogin(fetchImpl = fetch) {
  if (githubAvailableMethod() === 'cli') return startCliLogin();
  if (!githubAvailable()) throw new Error('GitHub sign-in is not available: the Copilot CLI package is missing and GITHUB_CLIENT_ID is not set.');
  state.error = null;
  state.abort?.abort();
  const res = await fetchImpl('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, scope: process.env.GITHUB_SCOPE || 'read:user' }),
  });
  const d = await res.json();
  if (!res.ok || d.error) throw new Error(`${d.error_description || d.error || `GitHub device flow failed (HTTP ${res.status})`}. Check GITHUB_CLIENT_ID and that "Enable Device Flow" is ticked on the GitHub OAuth App.`);
  const controller = new AbortController();
  state.abort = controller;
  state.pending = poll(d, controller.signal, fetchImpl).catch((e) => {
    state.error = e.message;
  });
  return { userCode: d.user_code, verificationUri: d.verification_uri, expiresIn: d.expires_in };
}

async function poll(d, signal, fetchImpl) {
  let interval = d.interval || 5;
  const deadline = Date.now() + (d.expires_in || 900) * 1000;
  while (!signal.aborted && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const res = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    const t = await res.json();
    if (t.access_token) {
      const me = await fetchImpl('https://api.github.com/user', { headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json', 'User-Agent': 'checklist-agent' } });
      if (!me.ok) throw new Error(`Could not read the GitHub user (HTTP ${me.status}).`);
      const u = await me.json();
      state.token = t.access_token;
      state.user = { login: u.login, name: u.name };
      return;
    }
    if (t.error === 'authorization_pending') continue;
    if (t.error === 'slow_down') {
      interval += 5;
      continue;
    }
    throw new Error(t.error_description || t.error || 'GitHub sign-in failed.');
  }
  if (!signal.aborted) throw new Error('GitHub sign-in expired. Try again.');
}

export const githubToken = () => state.token;
export const githubStatus = () => ({
  available: githubAvailable(),
  method: githubAvailableMethod(),
  signedIn: !!state.token || githubCliLoggedIn(),
  user: state.user,
  pending: !state.token && !githubCliLoggedIn() && !state.error && (!!state.pending || !!state.cliProc),
  error: state.error,
});

export function githubLogout() {
  state.abort?.abort();
  state.cliProc?.kill();
  if (existsSync(marker())) {
    rmSync(marker(), { force: true });
    // Best effort: also clear the credential the CLI stored for this home.
    try {
      const [cmd, args] = cliCommand(['logout']);
      spawn(cmd, args, { env: cliEnv(), stdio: 'ignore', windowsHide: true }).on('error', () => {});
    } catch { /* ignore */ }
  }
  Object.assign(state, { token: null, user: null, pending: null, error: null, abort: null, cliProc: null });
}
