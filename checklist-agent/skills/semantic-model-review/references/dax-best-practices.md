# DAX best practices and performance review (procedure)

Sources: Microsoft Learn (DAX best practices: https://learn.microsoft.com/en-us/dax/best-practices/dax-divide-function-operator , /dax-selectedvalue , /dax-variables , /dax-column-measure-references ; Power BI optimization guidance https://learn.microsoft.com/en-us/power-bi/guidance/power-bi-optimization ; star schema https://learn.microsoft.com/en-us/power-bi/guidance/star-schema) and the `powerbi-modeling` skill (references MEASURES-DAX.md and PERFORMANCE.md).

## Step 1 - collect every measure and its expression (execute, do not guess)
Via the powerbi-modeling MCP (`dax_query_operations` Execute): `EVALUATE INFO.VIEW.MEASURES()` (or `INFO.MEASURES()`), and `EVALUATE INFO.CALCDEPENDENCY()` for dependencies. Keep the list in mind for all DAX items. Also list calculated columns (`INFO.VIEW.COLUMNS()` where type is calculated) and relationships (`INFO.VIEW.RELATIONSHIPS()`).

## Step 2 - static analysis of expressions (regex on the expression text)
| Anti-pattern | Detect | Fix |
|---|---|---|
| FILTER over entire table | `FILTER\s*\(\s*(ALL\s*\()?'?\w+'?\s*,` inside CALCULATE | Column predicate `Table[Col] > x`, `REMOVEFILTERS(Col)`, `KEEPFILTERS(...)`; for running totals use `FILTER(ALL('Date'[Date]), ...)` or time-intelligence functions |
| "/" division | `\]\s*/\s*\[` or `\)\s*/\s*\(` | `DIVIDE(num, den)` |
| IFERROR / ISERROR | `IFERROR|ISERROR` | DIVIDE / COALESCE / IF with explicit check |
| Repeated sub-expression | same `[Measure]` or `CALCULATE(` text 2+ times in one measure and no VAR | Introduce `VAR` |
| Nested iterators | `(SUMX|AVERAGEX|COUNTX|MAXX|MINX|RANKX|ADDCOLUMNS|FILTER)` inside another iterator argument | Pre-aggregate, use a measure per grain, or a calculated table/column in the source |
| Qualified measure refs | `'?\w+'?\[(measure name)\]` where the name is a measure | Use `[Measure]` |
| Unqualified column refs | `[Name]` where Name is a column, not a measure | `Table[Name]` |
| HASONEVALUE + VALUES | `HASONEVALUE` with `VALUES(` | `SELECTEDVALUE(Col, alternate)` |
| Volatile functions in calculated columns | `NOW\(\)|TODAY\(\)|UTCNOW\(\)` in a calculated column | Move to a measure or a relative-date filter; columns freeze at refresh |
| Hard-coded literals | dates/ids/numbers such as `DATE(2020,...)`, `"2021"`, `= 12345` | Parameter table or Date table column |
| Zero/empty text for no data | `, 0)` / `, "")` as the else branch of IF | Return BLANK() |
| Time intelligence | `TOTALYTD|SAMEPERIODLASTYEAR|DATEADD|DATESYTD` | Requires a marked, continuous Date table; check `isKey`/`dataCategory: Time` on the Date table and no gaps |

## Step 3 - measure correctness (this finds real bugs)
For each key measure (top ~8 by importance: totals, ratios, YoY/YTD, cumulative, rank):
1. `EVALUATE ROW("v", [Measure])` and `EVALUATE TOPN(20, SUMMARIZECOLUMNS('Date'[Year], "v", [Measure]))` (or another key dimension).
2. Flag: error, BLANK for every row, identical value for every row, negative where impossible, ratios > 100%, YoY that is always BLANK/0, and logic that reads inverted (e.g. `1 - DIVIDE(prior, current)` for growth). Cross-check with a simple recomputation (e.g. compare a ratio to its numerator/denominator measures).

## Step 4 - performance (execute)
For the same measures: run the queries above twice (after ClearCache = cold, then warm) and record duration; also a query with a high-cardinality dimension (`TOPN(100, SUMMARIZECOLUMNS(Dim[Key], "v", [Measure]))`). Flag > 1 s (warn) and > 5 s (fail). For slow measures name the cause from Step 2 and give the rewritten DAX.

## Output style
Evidence: a markdown table `Measure | Finding | Time (cold/warm) | Pattern`. Recommendation: actions that name the measure and give the corrected DAX in one short fenced block when the fix is a formula. Mark `fixable: true` when the fix is a change to measure expressions / properties.
