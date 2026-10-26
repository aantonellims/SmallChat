import { DeviceCodeCredential } from '@azure/identity';

// Well-known public "Azure CLI" client id: lets users sign in interactively without an app registration.
const CLIENT_ID = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';

// Single-user local session. A hosted version should replace this with per-user sessions (e.g. Fabric SSO).
const state = { credential: null, pending: null, user: null, tenantId: null, error: null };

// Accepts a tenant GUID, a domain, or an email/UPN (domain is taken from it) and resolves it to a tenant GUID.
export async function resolveTenant(input) {
  let v = String(input || '').trim();
  if (!v) return undefined;
  if (v.includes('@')) v = v.split('@').pop();
  if (/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)) return v;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(v)}/v2.0/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`Could not resolve tenant "${v}". Use a tenant ID or a domain like contoso.onmicrosoft.com.`);
  const id = (await res.json()).issuer?.match(/microsoftonline\.com\/([^/]+)\//)?.[1];
  if (!id) throw new Error(`Could not resolve tenant "${v}".`);
  return id;
}

export async function startLogin(tenantInput) {
  state.error = null;
  state.user = null;
  state.tenantId = await resolveTenant(tenantInput);
  return new Promise((resolve, reject) => {
    const credential = new DeviceCodeCredential({
      clientId: CLIENT_ID,
      tenantId: state.tenantId,
      userPromptCallback: (info) => resolve({ userCode: info.userCode, verificationUri: info.verificationUri, message: info.message }),
    });
    state.credential = credential;
    state.pending = credential
      .authenticate('https://api.fabric.microsoft.com/.default')
      .then((rec) => {
        state.user = { name: rec?.username ?? 'signed in', tenantId: rec?.tenantId };
      })
      .catch((e) => {
        state.credential = null;
        state.error = e.message;
        reject(e);
      });
  });
}

export function authStatus() {
  return { signedIn: !!state.user, user: state.user, error: state.error, pending: !state.user && !state.error && !!state.pending };
}

export function logout() {
  Object.assign(state, { credential: null, pending: null, user: null, tenantId: null, error: null });
}

// Token provider with the same contract as azCliTokenProvider(resource) -> token.
export function interactiveTokenProvider() {
  return async (resource) => {
    if (!state.credential || !state.user) throw new Error('Not signed in.');
    const t = await state.credential.getToken(`${resource.replace(/\/$/, '')}/.default`);
    return t.token;
  };
}
