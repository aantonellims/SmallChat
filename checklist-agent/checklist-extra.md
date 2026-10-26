## DAX Best Practices
**Added by this tool. Sources: Microsoft Learn DAX best practices, Power BI optimization guidance, and the awesome-copilot powerbi-modeling skill. Query timing is measured in "Use Performance Analyzer" above; model structure rules (relationships, data types, naming) are in the other sections.**
- [ ] ⚠️Measures return correct results: run the key measures and check for errors, unexpected BLANKs, inverted or wrong logic (e.g. growth %, YTD, cumulative)
- [ ] ⚠️Avoid FILTER over entire tables (including FILTER(ALL(table)) inside CALCULATE); use simple column predicates, REMOVEFILTERS or KEEPFILTERS instead
- [ ] Use variables (VAR/RETURN) in complex measures to avoid repeated calculation and improve readability
- [ ] Use DIVIDE instead of the "/" operator when the denominator can be zero or BLANK
- [ ] Avoid IFERROR and ISERROR; handle problems with DIVIDE, COALESCE or explicit IF checks
- [ ] Avoid expensive iterator patterns: nested iterators, measures called inside iterators over large tables (context transition), EARLIER, and DISTINCTCOUNT on very high-cardinality columns
- [ ] Qualify column references with the table name and never qualify measure references
- [ ] Use SELECTEDVALUE instead of IF(HASONEVALUE(...), VALUES(...))
- [ ] Time intelligence is built on a marked, continuous Date table with built-in functions (TOTALYTD, SAMEPERIODLASTYEAR, DATESYTD); no hard-coded dates or NOW()/TODAY() baked into calculated columns
- [ ] Prefer measures, Power Query or source columns over DAX calculated columns; avoid calculated columns on relationship keys and calculated columns that depend on measures
- [ ] Return BLANK instead of 0 or empty text for "no data", and avoid hard-coded magic numbers or literals inside measures
- [ ] Use the right query patterns: SUMMARIZECOLUMNS or ADDCOLUMNS instead of SUMMARIZE with extension columns, TREATAS instead of FILTER/CONTAINS/INTERSECT for virtual relationships, and RELATED/relationships instead of LOOKUPVALUE where a relationship exists
- [ ] Measures are robust to filters: totals and subtotals are correct (not a sum of ratios), percent-of-total and ALL/ALLSELECTED/REMOVEFILTERS behave correctly when sliced

## Question-to-DAX Validation (run by the agent)
**The agent plays the role of a Data Agent without needing one: it writes realistic business questions, writes the DAX for each, runs it against the model and validates the results.**
- [ ] ⚠️Write 8-10 realistic business questions answerable from this model (totals, comparisons over time, top N, filtered, ambiguous wording) and the DAX for each
- [ ] ⚠️Every generated DAX query executes without error and returns plausible, non-empty values
- [ ] The generated DAX reuses the existing explicit measures (no re-implemented logic) and picks the right date field and relationship
- [ ] Cross-check at least 3 answers with an independent calculation (a different path through the model) and flag mismatches
- [ ] Generated queries run fast (under 1 second cold) and without timeouts; flag slow patterns
- [ ] List questions the model cannot answer well or that map to several measures, and recommend the fix (measure, synonym, description or instruction)

