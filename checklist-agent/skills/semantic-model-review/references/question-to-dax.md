# Question-to-DAX validation (the agent acts as a Data Agent against the model)

Goal: prove the model can answer real business questions correctly and quickly, by writing and running the DAX yourself with the powerbi-modeling MCP (`dax_query_operations` Execute). No Data Agent is needed.

## Step 1 - understand the model
Read measures (`INFO.VIEW.MEASURES()`), tables/columns (`INFO.VIEW.TABLES()`, `INFO.VIEW.COLUMNS()`), relationships (`INFO.VIEW.RELATIONSHIPS()`), descriptions/synonyms in the TMDL, and any AI instructions you can find. Identify the business domain and the ~8 most important measures and dimensions.

## Step 2 - write 8-10 questions (and the DAX for each)
Mix, as a real business user would ask:
- simple total ("How many commits did we have?")
- by dimension ("Top 5 contributors by commits")
- time comparison ("Commits this year vs last year")
- filtered ("Open issues for milestone X")
- ambiguous wording ("recent", "last year", "revenue" when several measures could fit)
- one question the model should NOT be able to answer (a metric that does not exist)
Write the DAX the way a Data Agent should: reuse explicit measures, `SUMMARIZECOLUMNS`/`TOPN`, correct date field, `USERELATIONSHIP` only when needed, results limited with TOPN.

## Step 3 - execute and validate
Run each query through the MCP. Classify: ok / error / empty / implausible (negative, >100%, constant across rows, all BLANK). If an error is caused by your own DAX, fix it and re-run once (say so in the evidence). Do not hide failures.

## Step 4 - independent cross-check
For 3 answered questions recompute through a different path (e.g. `COUNTROWS` on the fact table, a different measure route, or a raw `SUMMARIZE`) and compare. Flag mismatches with the likely cause.

## Step 5 - speed
Time each query cold (ClearCache) and warm. Warn > 1 s, fail > 5 s; name the DAX pattern (see dax-best-practices.md) and give the rewrite.

## Step 6 - gaps and ambiguity
List questions the model answers poorly or ambiguously, and the fix: add a measure, rename, add a description or synonym, or add an AI instruction. Mark `fixable: true` when the fix is a change to the model definition.

## Output style
Evidence: a table `Question | DAX (short) | Result | Time`. Recommendation: plain-language bullets naming the exact measure/table. Keep the question set identical across the section's items (write it once in the first item and reuse it).
