# Deploying the app (Azure Web App, container, Rayfin) - Copilot, MCP, skills and models

## Short answer: which GitHub/Copilot profile does a deployed app use?

On a web app there is no developer machine login, so you choose the identity explicitly. In order of preference for **a single user or a small trusted team**:

| Option | Copilot identity | Setup | Best for |
|---|---|---|---|
| **A. "Connect GitHub Copilot" (in-app, no setup)** | The signed-in user's **own** Copilot plan (`github-user` mode) | Nothing to configure: the button runs the Copilot CLI's device-code sign-in (GitHub's own app) in the app's isolated Copilot home; the user types a code on github.com/login/device. Optional alternative: your own OAuth App via `GITHUB_CLIENT_ID` | Your own deployment: the profile follows you, not the server |
| **B. Service token** | One account's Copilot plan (`COPILOT_GITHUB_TOKEN`) | Store the token as an App Service setting / Key Vault secret | Unattended use by one owner; usage is billed to that account |
| **C. Bring your own model** | No Copilot seat: Azure AI Foundry / Azure OpenAI / OpenAI / Anthropic | `COPILOT_PROVIDER_*` variables, managed identity | Teams, production, central cost control |

Everything else is configuration as code and is the same in all three: the skills ship in `skills/`, the Power BI MCP is attached per session (read-only guard), the model list is read from the runtime, and the readiness banner / `GET /api/copilot/status` shows what is missing.

## What is onboarded with the app (nothing is read from the developer's machine)

| Piece | Where it lives | Reaches the agent via | Verified |
|---|---|---|---|
| Skills `semantic-model-review`, `powerbi-modeling` (MIT, from awesome-copilot) | `skills/` inside the app/image | `skillDirectories` on every session | A run from an empty isolated Copilot home loaded the skill |
| Power BI authoring MCP | `src/agent.js` (URL in `PBI_MCP_URL`), per-session `mcpServers` with the signed-in user's Fabric token | session config | Same run connected and ran DAX through it |
| Checklist, per-item prompts, system prompts, read-only guard | `checklist*.md`, `src/prompts.js`, `src/agent.js` | code | tests |
| Copilot runtime + data dir | bundled by `@github/copilot-sdk`; data in `COPILOT_APP_HOME` (`.copilot-home`) | `baseDirectory` | the clean-home run created its own runtime files only |
| Copilot CLI (for the in-app GitHub sign-in) | npm dependency `@github/copilot` | spawned by the sign-in button | sign-in code obtained from the real CLI |

What is **not** carried over from your machine, on purpose: your personal MCP servers and plugins in `~/.copilot`, and your Copilot login. In `github-token`, `github-user` and `byok` modes the runtime runs from its own isolated home, so anything the agent needs must be in the table above. If you add a skill or MCP, add it to `skills/` or the session config (and the allow-list), not to the host. Scope of option A to verify when you create the OAuth App: the app requests `read:user` by default (override with `GITHUB_SCOPE` if Copilot rejects the token).

**Optional: your own OAuth App instead of the CLI sign-in (not needed).** Only if you prefer GitHub's OAuth device flow with your own app (GitHub has no API for this): GitHub, Settings, Developer settings, OAuth Apps, New OAuth App:

| Field | Value |
|---|---|
| Application name | `Semantic Model Checklist Agent` (anything) |
| Homepage URL | `http://localhost:3000` locally, or your web app URL |
| Authorization callback URL | same as the homepage (the device flow does not use it, but the form requires one) |
| **Enable Device Flow** | **tick this box** |

Do not generate a client secret (the device flow does not need one). Copy the **Client ID** and start the app with `GITHUB_CLIENT_ID=<client id>` (PowerShell: `$env:GITHUB_CLIENT_ID='<id>'; node src/server.js`; on a web app: an application setting). The page then shows **Connect GitHub Copilot**.

## "Prebuilt environment in the GitHub cloud": what exists and what fits

1. **Prebuilt container (recommended).** The `Dockerfile` bakes the app, the Copilot runtime (bundled with `@github/copilot-sdk`), the skills and the MCP configuration into one image; run it on Azure Container Apps / Web App for Containers / any host. It is the closest thing to "a prebuilt Copilot environment" that keeps the interactive UX. *Status: written from the SDK docs; not built here (no Docker on the dev machine), but the production-only dependency install and a start with the image's file set were verified.* GitHub documents a variant where the Copilot CLI runs separately in headless mode (`copilot --headless --port 4321`) and the app connects with `RuntimeConnection.forUri`; there is no official CLI image, you build your own.
2. **GitHub Copilot cloud agent** (runs on GitHub Actions or in a cloud sandbox). You *can* prebuild its environment (`.github/workflows/copilot-setup-steps.yml`, secrets and variables for the agent, a custom environment on your own Linux machine or codespace) and ship skills/custom agents in the repo. **It is not a good fit for this tool**: it is repository/pull-request centric and asynchronous (a task produces a PR), it runs under a GitHub-managed identity, and the checks must run **as the signed-in user** against their Fabric/Power BI model; the cloud agent would need a service principal and could not provide the interactive page, live progress, diff review or per-item runs. Reasonable only for scheduled, unattended audits with a service principal.
3. **Codespaces / dev containers** are development environments, not hosting.

## Single-user caveats that stay true when deployed

- The Microsoft sign-in and the GitHub sign-in are one server-side session each (this is intended for a single user). Do not expose the same instance to several people: they would share the first user's identities. For several users keep one session per user and acquire Fabric tokens on behalf of each user.
- Runs are in memory; the container needs one replica (or sticky sessions) and runs vanish on restart.
- The runtime uses the SDK default mode (`copilot-cli`) with a strict tool allow-list and a read-only permission guard. For a **shared** server GitHub recommends `mode: "empty"` plus explicit tools per session; adopt it before multi-user use.


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
1b. **`github-user`** - the user clicks **Connect GitHub Copilot** (GitHub device flow, needs `GITHUB_CLIENT_ID`); the app then uses that user's own Copilot plan and the runtime ignores the host login.
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
