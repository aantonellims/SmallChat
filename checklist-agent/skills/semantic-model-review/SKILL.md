---
name: semantic-model-review
description: Review a Power BI / Fabric semantic model TMDL definition for Fabric Data Agent and Copilot readiness. Use when assessing star schema, naming, descriptions, synonyms, row labels, measures, summarization, hidden fields, Prep for AI and Data Agent configuration.
---

# Semantic model review (TMDL) - how to find evidence

Files: `definition/model.tmdl`, `definition/relationships.tmdl`, `definition/tables/<Table>.tmdl`, `definition/cultures/*.tmdl` (synonyms), `definition.pbism`, `definition/expressions.tmdl`, optional Copilot / Prep for AI files.

| Need | Where / regex (use search_model) |
|---|---|
| Tables, fact vs dimension | `^table ` ; relationships: `fromColumn|toColumn|crossFilteringBehavior|isActive` in relationships.tmdl (facts = many side) |
| Auto date tables | `LocalDateTable_|DateTableTemplate_` (noise, hurts AI schema) |
| Data types | `dataType:` ; flag numbers/dates stored as `string`, booleans as text/int |
| Hidden objects | `isHidden` |
| Descriptions | a `///` line directly above `table`, `column`, `measure` is the description; count objects without it |
| Synonyms | linguistic metadata in `cultures/*.tmdl` (`"Synonyms"`) |
| Row label / key | `isDefaultLabel`, `isKey` |
| Summarization | `summarizeBy:` on numeric columns (should be `none` for ids, years, ages, rates) |
| Measures | `^\s*measure ` ; explicit vs implicit (columns with `summarizeBy: sum` and no measure) ; duplicates = same expression or near-identical names |
| Calculation groups / field parameters / UDFs | `calculationGroup`, `NAMEOF(`, `function ` |
| Storage mode / Direct Lake | `mode: directLake|import|directQuery` in partitions |
| Prep for AI | files or annotations containing `Copilot`, `AIInstructions`, `VerifiedAnswers`, `PBI_` ; if absent say "not visible in the definition" -> manual, never fail |
| Unused columns | columns not referenced in any measure/relationship/hierarchy/sort-by (search the column name) |

Rules: cite concrete object names and counts; quote little; never invent.

## Connecting and DAX via MCP
1. `connection_operations` -> operation `ConnectFabric` with the workspace id + model id given in the prompt (operation `Help` shows the shape).
2. `dax_query_operations` Execute runs real DAX including `INFO.*` (INFO.TABLES(), INFO.COLUMNS(), INFO.MEASURES(), INFO.RELATIONSHIPS(), INFO.PARTITIONS(), INFO.CALCDEPENDENCY(), INFO.STORAGETABLECOLUMNS(), INFO.STORAGETABLECOLUMNSEGMENTS(), INFO.STORAGETABLES()...) - use `dax_query_operations` help for the exact request shape. If an INFO function is unavailable, try the equivalent `$SYSTEM.DISCOVER_*` / `$SYSTEM.TMSCHEMA_*` DMV query.
3. All operations must be read-only.

## Best Practice Analyzer (execute these rules, report violations with counts + objects)
Performance: avoid bi-directional / many-to-many relationships; disable auto date/time tables (LocalDateTable_*); hide/remove unused or high-cardinality columns (GUIDs, free text, datetime with time part -> split); avoid calculated columns/tables that can be done in the source; set `summarizeBy none` on non-additive numerics; avoid measures with nested iterators / FILTER(ALL(...)) / entire-table FILTER; use DIVIDE instead of "/"; avoid IFERROR/ISERROR; avoid ADDCOLUMNS+SUMMARIZE misuse; use variables for repeated expressions.
Error prevention: relationships on integer keys, active relationships have matching types, no ambiguous inactive relationships without USERELATIONSHIP measures, mark a proper Date table, no columns with data type mismatch, no empty/duplicate keys on the one side.
Formatting: every visible measure has formatString; visible columns have friendly names/format; hide foreign keys, sort-by helper columns; display folders for >10 measures; consistent naming (no snake_case/prefixes) and descriptions.
Maintenance: remove unused measures/columns (no references in INFO.CALCDEPENDENCY and not used in relationships/sort-by/hierarchies), no hard-coded values or fully qualified measure refs `Table[Measure]` (use `[Measure]`), partitions/incremental refresh sanity.
Output per rule: id/name, severity, #objects, top examples, recommended fix.

## Memory Analyzer
Query INFO.STORAGETABLECOLUMNS() / INFO.STORAGETABLECOLUMNSEGMENTS() / INFO.STORAGETABLES() (or DMVs) and aggregate: total size, size per table, top columns by DICTIONARY_SIZE + DATA size, cardinality (distinct count), encoding (hash/value), relationship/hierarchy overhead. Flag: columns with cardinality close to row count, datetime with time part, wide text columns, unused big columns. Recommend drop/hide/split/aggregate with estimated saving.

## Performance timing (Performance Analyzer equivalent)
For each key measure run `EVALUATE ROW("v", [Measure])` and `EVALUATE SUMMARIZECOLUMNS(<key dim column>, "v", [Measure])` through dax_query_operations Execute; use the tool's timing output if present, else wall-clock the call. Cold vs warm: ClearCache first when available. Flag > 1 s or errors; suggest DAX/model fixes.
