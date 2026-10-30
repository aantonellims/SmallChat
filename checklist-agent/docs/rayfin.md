# Rayfin (Fabric App) deployment

The checklist UI is deployed as a Rayfin app (Fabric App). The agent itself (Node + GitHub Copilot SDK) **cannot run inside Rayfin**: Rayfin functions are request/response and cannot host the Copilot runtime process, live progress (SSE) or multi-minute runs. So the split is:

| Part | Where | Notes |
|---|---|---|
| UI | Rayfin static hosting, behind Fabric sign-in (`assetAccess: protected`) | the template's auth gate is kept; the checklist page is served same-origin in a frame |
| Agent API (Express + Copilot SDK + Power BI MCP) | the Node app in this repo, run anywhere reachable by the browser | needs `ALLOWED_ORIGINS` to include the Rayfin hosting origin |

## What was deployed

| Item | Value |
|---|---|
| Tenant | `bd87d1c7-540b-4037-9451-8c6708dc9233` |
| Capacity | `msfabric001` (F8, West US 3) `c8d06060-0532-4828-8d1a-684f1b94a1e9` |
| Workspace | `SemanticModelChecklistAgent` `aca6dcc1-53ee-43e9-ae9b-1e75dccf91b3` |
| Rayfin item | `semantic-model-checklist-agent` `bc080be3-96a9-4f72-8512-d0cfc3a3cecd` |
| Hosting URL | `https://ultra-cove-89fc104e52-westus3.webapp.fabricapps.net` (protected: unauthenticated requests get 401) |
| Fabric portal | `https://app.fabric.microsoft.com/groups/aca6dcc1-53ee-43e9-ae9b-1e75dccf91b3/appbackends/bc080be3-96a9-4f72-8512-d0cfc3a3cecd?ctid=bd87d1c7-540b-4037-9451-8c6708dc9233` |

## How the UI reaches the agent API

- `public/index.html` works standalone (same-origin API) and, when opened with `?api=<base url>`, sends every call (fetch, SSE, report and download links) to that base. The Rayfin app opens it as `checklist/index.html?api=<VITE_CHECKLIST_API_URL>`.
- `VITE_CHECKLIST_API_URL` is set in the Rayfin project (`packages/frontend/.env.production`). It is currently `http://localhost:3000`: the UI works on the machine that runs the agent API. Point it at the deployed API (for example an Azure Web App or Container App) and redeploy for everyone else.
- Start the API allowing the Rayfin origin: `ALLOWED_ORIGINS=https://ultra-cove-89fc104e52-westus3.webapp.fabricapps.net node src/server.js` (comma-separated; `*.example.com` suffixes are supported). Only listed origins get CORS access; the private-network preflight header is answered for public pages calling a local server.
- Chrome's Local Network Access may ask the user to allow the Fabric page to connect to a local server the first time.

## Redeploy

From the Rayfin project: `npm run build && npx rayfin up --workspace-id aca6dcc1-53ee-43e9-ae9b-1e75dccf91b3` (preview first with `-n`). After changing `public/index.html`, copy it to `packages/frontend/public/checklist/index.html`.

## Known limits of this deployment

- The Microsoft and GitHub sign-ins of the agent API are single-user (see `docs/deployment.md`); the Fabric sign-in of the Rayfin app only protects the UI. For several users, move the API to per-user sessions (OBO tokens for Fabric) and host it.
- The API URL is baked in at build time.
- The deployed runtime was verified at the HTTP level (deployment status, protected hosting returns 401, CORS/preflight from the hosting origin). A signed-in browser check of the Fabric-hosted page requires an interactive Fabric sign-in.
