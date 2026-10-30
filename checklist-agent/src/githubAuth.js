// GitHub sign-in (OAuth device flow) so the deployed app runs on the user's OWN Copilot profile instead of the host machine's login.
// Needs a GitHub OAuth App (or GitHub App) with "Device Flow" enabled; set GITHUB_CLIENT_ID. No client secret is required for the device flow.
// Single-user, in-memory session (same model as the Microsoft sign-in). A multi-user deployment must keep one token per user.

const state = { token: null, user: null, pending: null, error: null, abort: null };

export const githubAvailable = () => !!process.env.GITHUB_CLIENT_ID;

export async function startGithubLogin(fetchImpl = fetch) {
  if (!githubAvailable()) throw new Error('GITHUB_CLIENT_ID is not set. Create a GitHub OAuth App with Device Flow enabled and set its client id.');
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
export const githubStatus = () => ({ available: githubAvailable(), signedIn: !!state.token, user: state.user, pending: !state.token && !state.error && !!state.pending, error: state.error });

export function githubLogout() {
  state.abort?.abort();
  Object.assign(state, { token: null, user: null, pending: null, error: null, abort: null });
}
