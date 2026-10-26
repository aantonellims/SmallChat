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

Rules: cite concrete object names and counts; quote little; never invent. DAX via run_dax only supports EVALUATE (no INFO.* functions).
