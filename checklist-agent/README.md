# Semantic Model Checklist Agent

Paste a Power BI / Fabric semantic model URL; a GitHub Copilot agent (via `@github/copilot-sdk`) runs the
[Semantic Model Data Agent Checklist](https://github.com/microsoft/fabric-toolbox/blob/main/samples/data_agent_checklist_notebooks/Semantic%20Model%20Data%20Agent%20Checklist.md)
(`checklist.md`, from microsoft/fabric-toolbox) section by section and produces a recommendation report.

## How it works
- `checklist.md` is the upstream Microsoft checklist; `checklist-extra.md` adds two sections shown right after "Semantic Model Optimization":
  - **DAX Best Practices** (13 items): the agent collects every measure expression through the MCP, analyses anti-patterns (FILTER over tables,
    "/" vs DIVIDE, IFERROR, VAR, iterators/context transition, references, SELECTEDVALUE, time intelligence, calculated columns, BLANK/literals,
    SUMMARIZE/TREATAS/LOOKUPVALUE patterns), runs the key measures to verify correctness and robustness under filters. Query timing is owned by the
    upstream "Use Performance Analyzer" item and model-structure rules by the BPA item, so nothing is reported twice.
  - **Question-to-DAX Validation** (6 items): the agent acts as a Data Agent without needing one: it writes 8-10 realistic business questions and the DAX for each,
    executes them, cross-checks answers with an independent calculation, times them and lists questions the model answers poorly.
  Sources: Microsoft Learn DAX best practices, Power BI optimization guidance and the awesome-copilot `powerbi-modeling` skill (`skills/powerbi-modeling`, MIT, see `NOTICE.md`).
- `src/fabric.js` - parses the URL, downloads the model definition (TMDL) via Fabric REST `getDefinition`.
- `src/agent.js` - one Copilot session per checklist section. The agent is given: (1) the hosted **Power BI authoring MCP**
  (`https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring`, authenticated with the signed-in user) to connect to the model and
  run live DAX / `INFO.*` queries; (2) read-only TMDL tools; (3) the `semantic-model-review` skill (`skills/`) with the procedures
  to execute a Best Practice Analyzer pass, a Memory Analyzer pass (storage DMVs), performance timing and dependency tracing;
  (4) a specific prompt per checklist item (`src/prompts.js`). A permission guard rejects every non read-only MCP operation and any other MCP server.
  Each item gets a verdict (`pass|warn|fail|manual|not_applicable`) with evidence and a detailed recommendation; a final session writes the executive report.
- `src/auth.js` - Microsoft device-code sign-in (tenant ID, domain or email accepted).
- `src/server.js` + `public/index.html` - Express API with SSE progress; login page, then the checklist page.

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

CLI alternative: `node scripts/run.js "<model url>" report.md`.

## Known limitations (found while testing on a real model)
- Reading the definition uses Fabric `getDefinition`, which needs **Read + Write** permission on the model; system-generated
  "Usage Metrics" models are not supported (404).
- DAX goes through the `executeQueries` REST API: needs Build permission, `INFO.*` functions are not supported, and some
  models/tenants disallow it. The agent falls back to the TMDL definition and marks runtime-only items as `manual`.
- Prep for AI settings (AI schema, verified answers, instructions) were not present in the returned definition of the tested
  model, so those items are reported as `manual` rather than `fail`.
