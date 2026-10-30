# Deploying the app (Azure Web App, container, Rayfin) - Copilot, MCP, skills and models

## What the app needs at runtime

| Need | How it is provided | Where checked |
|---|---|---|
| **GitHub Copilot runtime** (the SDK starts the bundled Copilot CLI as a child process) | A long-running Node 20+ process with outbound HTTPS; no browser, no TTY | `GET /api/copilot/status` and the startup log |
| **Copilot authentication** | `COPILOT_GITHUB_TOKEN` (service/user token with a Copilot license) **or** BYOK provider **or** the machine login (local dev only) | same |
| **Skills** | Shipped inside the app: `skills/semantic-model-review`, `skills/powerbi-modeling` (passed with `skillDirectories`) | status lists each skill found/missing |
| **MCP** | Hosted Power BI authoring MCP `https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring`, attached per session with the **signed-in user's** Fabric token; read-only operations only (permission guard) | status checks reachability |
| **Model choice** | Dropdown filled from the runtime (`listModels`) or from `COPILOT_BYOK_MODELS`; the choice is validated server-side and applied to every session of the run (agent, retries, fix preview, summary) | verified: the session reports the selected model |

Preflight: on start the server logs `Preflight OK: N model(s) available, skills and MCP found.` or the list of problems. The UI shows the same as a banner ("The Copilot agent is not ready") with the exact fix.

## Authentication modes (environment variables)

1. **Local (default)** - uses the Copilot / `gh` login of the machine. Fine for a developer, **not for a server**.
2. **`github-token`** - set `COPILOT_GITHUB_TOKEN`. The runtime ignores the host login and uses this token. The token owner needs a Copilot license; all usage is billed to that identity.
3. **`byok` (bring your own model, no Copilot seat)** - Azure AI Foundry / Azure OpenAI / OpenAI / Anthropic:
   ```
   COPILOT_PROVIDER_TYPE=azure            # azure | openai | anthropic
   COPILOT_PROVIDER_BASE_URL=https://<resource>.openai.azure.com
   COPILOT_PROVIDER_AUTH=managed-identity # or COPILOT_PROVIDER_API_KEY=...
   COPILOT_PROVIDER_API_VERSION=...       # optional (Azure)
   COPILOT_BYOK_MODELS=gpt-4.1,gpt-5      # deployment names users can pick
   ```
   With `managed-identity`, grant the web app's identity the *Cognitive Services OpenAI User* role. Models must support tool calling.

Other variables: `COPILOT_MODEL` (default model), `COPILOT_APP_HOME` (Copilot data dir), `PBI_MCP_URL`, `PORT`, `HOST` (set `0.0.0.0` on a web app; default is `127.0.0.1`).

**Isolation.** In `github-token` and `byok` modes the runtime uses its own data directory (`.copilot-home`, or `COPILOT_APP_HOME`) instead of `~/.copilot`, so a host's personal MCP servers, plugins and login can never leak into a deployed agent. In local mode the user's `~/.copilot` is still read (we need its login); the tool allow-list and the permission guard still restrict the agent to the read-only Power BI MCP and the app's own tools.

## Azure Web App (Linux) / container

- Runtime: Node 20+, **Always On**, a writable disk for `.copilot-home` (App Service `/home` is fine), outbound access to `api.githubcopilot.com`, `api.github.com`, `api.fabric.microsoft.com`, `login.microsoftonline.com` (or your BYOK endpoint).
- Startup: `npm ci && npm start` with `HOST=0.0.0.0` (App Service provides `PORT`).
- Long requests: agent runs take minutes; the app returns immediately and streams progress (SSE). Disable proxy buffering / keep idle timeout above 4 minutes.
- State: runs live in memory. Use a single instance (or sticky sessions) and expect runs to disappear on restart; persist them (Cosmos/Blob) before scaling out.

## Rayfin / Fabric Apps

- Rayfin **functions cannot host this agent** (the Copilot SDK needs a Node runtime plus the CLI process). Use Rayfin for the static UI and data entities, and keep the agent API on Azure Web App / Container Apps.
- The UI and report pages are plain HTML/JS and portable; the API contract is documented in `docs/ux-and-fix-preview.md`.

## Known limitations before a multi-user deployment (important)

1. **Sign-in is single-user.** `src/auth.js` keeps one Microsoft device-code session in server memory, so every visitor would share the first user's Fabric identity. Replace it with per-user sessions: App Service Authentication (Entra) or Fabric SSO, and acquire Fabric / Power BI tokens **on behalf of each user** (`https://api.fabric.microsoft.com/.default`). The model and Data Agent reads and the MCP must always run as the end user, never as the app.
2. **Copilot identity and licensing.** With `COPILOT_GITHUB_TOKEN` all users consume one identity's Copilot entitlement and quota. Check your GitHub Copilot terms for shared service use; for multi-user production prefer BYOK (Azure AI Foundry, managed identity) or per-user GitHub sign-in.
3. **BYOK models** are not the Copilot catalogue: names come from `COPILOT_BYOK_MODELS`, and quality/tool-calling depends on the deployed model.
4. **Runs are in memory** (see above) and there is no per-user isolation of runs yet: add the user id to the run and check it on every endpoint.
5. **Secrets**: keep tokens in App Service settings / Key Vault, never in the repo (`.env` is git-ignored).
