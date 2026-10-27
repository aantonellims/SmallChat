# UX and "Preview fix" diff: brief for re-implementing in another app

Context: a tool where a customer pastes a semantic model URL and a GitHub Copilot agent runs a checklist, then reports findings and recommendations.
This brief covers only the **user experience** and the **diff / fix preview**, so they can be applied in another app. Reference implementation: `public/index.html`, `src/reportHtml.js`, `src/fixes.js`, `src/agent.js`, `src/server.js`.

## 1. What the product owner asked for (requirements)

1. **Sign in first**, then land on the checklist page (Microsoft device-code sign-in; tenant ID, domain or email accepted).
2. **Compact results.** One row per checklist item: status icon, item text, a **one-line finding**. No walls of text in the table.
3. **Details on click.** Clicking a row opens a side panel with:
   - **What to do**: a short, prioritized bullet list in plain language (written for end users, not engineers).
   - **Technical details**: collapsed by default, well formatted (bullets, tables), for experts.
4. **Full report page**: a separate link ("Open full report") with a section sidebar, executive summary, collapsible findings (failed ones expanded), printable. Plus a markdown download.
5. **Run independently.** Load the model first, then run **everything**, **a section**, **selected items** (checkboxes) or **one item** (▶ / ↻ re-run). Re-runs reuse the already downloaded model definition and keep other results.
6. **Optional parts stay out of the way.** Data Agent sections only appear if the user pastes a Data Agent URL.
7. **Preview fix** (only where relevant): for findings that can be fixed by editing the model definition, show **exactly what would change** as a colored diff, and let the user download it. **Nothing is written to the model** in this phase.

## 2. UX rules (apply these)

| Area | Rule |
|---|---|
| Table | Columns: checkbox, status icon, item, one-line headline, run button. Status: ✅ pass, 🟡 warn, ❌ fail, 🖐️ manual, ➖ not applicable, ⏳ not run. Critical items bold. |
| Headline | Plain language, max ~120 chars, states the finding with a number when possible ("16 rule violations found (3 high, 7 medium, 6 low)"). |
| What to do | 2-6 bullets, **most important first**, each = verb + exact object + where/how + short reason, e.g. `- **Turn off auto date/time** (File > Options > Current file > Data load): removes 18 hidden date tables.` Never a paragraph. At most one short code block, last. Empty when the item passes. |
| Technical details | Collapsed. Short bullets with bold labels; a **markdown table** when more than ~4 objects. Max ~25 lines. |
| Markdown rendering | Render server-side (`marked`, `breaks: true`, GFM tables) and **escape raw HTML from the model** (`<` to `&lt;`) because model output is untrusted. |
| Progress | Stream events (SSE): section started, tool used, item verdict. Update rows live as verdicts arrive. |
| Errors | Never leave a spinner forever. Handle: server restarted (run no longer exists: say so and tell the user to reload and re-run), lost connection, timeout (10 min), non-JSON error bodies. |
| Failed checks | Retry missing items once automatically; if still failing, show the real error and a "re-run" hint. |

## 3. Fix preview: behaviour

**Button visibility.** Show **🔧 Preview fix** only when the agent marked the item `fixable: true`. The agent sets it only if the recommendation can be implemented by editing the model definition (TMDL): descriptions, hidden, `summarizeBy`, `formatString`, data type, DAX expression, rename, removing tables/columns. Not for UI/process/source/Power Query/service-setting actions. Items that pass never get a button.

**Flow.**
1. Click **Preview fix** → full-screen review panel opens with "preparing the change... Working for N s".
2. A separate agent session edits an **in-memory copy** of the model files (it never touches the real model). Typical duration 1-3 minutes.
3. The panel shows:
   - one-sentence summary ("Sets Summarize by to None on 3 rank columns and ...");
   - counts: files changed, `+added` / `-removed`;
   - a notice: **"Preview only. Nothing has been changed in your semantic model."**;
   - **"Check before applying"**: 0-4 short impact warnings (e.g. "Renaming X may break existing reports");
   - the diff;
   - downloads: **`.patch`** (git-apply compatible) and **ZIP of the patched files**.
4. If the change cannot be expressed as a file edit, show "No automatic change available" with the reason and point back to the manual "What to do" steps.
5. Re-running an item discards its old preview.

**Diff rendering.** Per file, collapsible: header with path, `+n -m`, badge "file deleted". Unified hunks with **old/new line numbers**, green rows for added, red rows for removed, blue hunk headers (`@@ -a,b +c,d @@`), monospace, wrapped. Colors: add `#e6ffec` (text `#116329`), delete `#ffebe9` (text `#82071e`), hunk `#ddf4ff`.

## 4. Fix preview: implementation contract

**Agent side**
- Record tool per item: `record_item_result({ item_id, status, headline, fixable, evidence, recommendation })`. Validate `item_id` against the ids of the current section and reject unknown ids (the agent otherwise sometimes stores a result under `undefined`).
- Fix session tools (all operate on the in-memory copy):
  - `list_model_files`, `read_model_file`, `search_model` (read the working copy, including edits made so far)
  - `replace_in_model_file(path, old_str, new_str, replace_all?)`: exact string, must match **once** unless `replace_all`; errors tell the agent how to correct itself
  - `delete_model_file(path)`: refuses `.platform`, `definition.pbism`, `database.tmdl`
  - `finish_fix({ summary, warnings[] })` and `no_fix({ reason })`
- Prompt rules for the fix session: minimal edits; respect TMDL syntax (tab indentation, `///` description lines above objects, `summarizeBy`, `isHidden`, `formatString`); when deleting a table also remove relationship entries and `ref table` lines; when renaming, update every DAX reference found with search; if more than ~30 objects, do the most important and say so in warnings; if not expressible as an edit, call `no_fix`.
- Read-only guard on the Power BI MCP: allow only operations matching `help|get*|list*|execute*|validate*|exportTmdl|connectFabric|disconnect|clearCache`; reject any other operation, any other MCP server, shell, file write and URL permissions.

**Server endpoints** (run-scoped, results kept in memory)
```
POST /api/runs                       { url, dataAgentUrl?, prepare? }   create run (prepare = load only)
POST /api/runs/:id/items             { itemIds[] }                      run / re-run items
GET  /api/runs/:id/events            SSE: status | section | tool | item | done | error
GET  /api/runs/:id/items/:item/html  rendered "What to do" + collapsed technical details
POST /api/runs/:id/items/:item/fix   start fix preview (400 if not fixable)
GET  /api/runs/:id/items/:item/fix   { state, summary, warnings, noFix, stats, html }  (poll every 2.5 s)
GET  /api/runs/:id/items/:item/fix.patch   unified diff, attachment
GET  /api/runs/:id/items/:item/fix.zip     patched definition files, attachment
GET  /runs/:id/report                full HTML report;  GET /api/runs/:id/report  markdown
```

**Diff logic.** Libraries: `diff` (structuredPatch, createTwoFilesPatch) and `fflate` (zip). `ModelCopy` keeps the original `Map<path, text>` and a mutable copy; `changes()` returns `{ path, before, after|null }` for changed files only.

## 5. Safety and scope decisions

- Phase 1 (done): **preview + download only**, no writes to the model.
- Phase 2 (proposed): apply the patch to a **copy** of the model via the authoring MCP inside a transaction, after validation.
- Phase 3 (proposed): apply to the original only after a second confirmation. For production prefer Fabric git / deployment pipelines.
- Impact warnings are mandatory for fixes that change meaning (renames, formula corrections, dropped columns).

## 6. Pitfalls we hit (save your colleague time)

- Agent tool allow-lists must include `tool_search_tool` and `mcp:*`: MCP tools are deferred; without them the agent silently falls back to weaker tools.
- Restricting MCP to one server: allow `mcp:*` in `availableTools`, then enforce the server name in the **permission handler** (other servers from the user's config are loaded too).
- A stale page after a server restart looked like an endless "preparing" spinner: always handle 404 and non-JSON responses.
- Windows: spawning `az` needs `cmd.exe /c az ...`; `npx`/`npm` need the `.cmd` form in restricted PowerShell.
- `node --test test/` fails on Node 24; use a glob (`"test/*.test.js"`).
- Strip BOM from downloaded skill files (it breaks front matter).
- Re-running a section must not treat an old result as a fresh verdict: track which items were recorded **in this run** to detect "no verdict".
