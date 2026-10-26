# Semantic Model Checklist Agent

Paste a Power BI / Fabric semantic model URL; a GitHub Copilot agent (via `@github/copilot-sdk`) runs the
[Semantic Model Data Agent Checklist](https://github.com/microsoft/fabric-toolbox/blob/main/samples/data_agent_checklist_notebooks/Semantic%20Model%20Data%20Agent%20Checklist.md)
(`checklist.md`, from microsoft/fabric-toolbox) section by section and produces a recommendation report.

## How it works
- `src/fabric.js` - parses the URL, downloads the model definition (TMDL) via Fabric REST `getDefinition`, runs read-only DAX via Power BI `executeQueries`.
- `src/agent.js` - one Copilot session per checklist section; the agent only has read-only custom tools
  (`list_model_files`, `read_model_file`, `search_model`, `run_dax`) and records one verdict per item
  (`pass|warn|fail|manual|not_applicable`) with `record_item_result`. A final session writes the prioritized report.
- `src/server.js` + `public/index.html` - Express API with SSE progress and a single-page UI.

## Run locally
Prerequisites: Node 20+, GitHub Copilot CLI signed in (`copilot`), Azure CLI signed in (`az login`) with access to the model
(Build permission; Fabric item read + definition access).

```bash
npm install
npm test                 # unit tests
node scripts/smoke.js    # offline agent smoke test (uses Copilot, no Fabric)
npm start                # http://localhost:3000
```

Optional: `COPILOT_MODEL=<model id>` to pick the model. Items that cannot be verified from the definition/DAX
(notebook runs, Desktop-only UI, Data Agent UI) are reported as `manual` with guidance.
