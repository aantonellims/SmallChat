## DAX Best Practices and Performance
**Added by this tool. Sources: Microsoft Learn DAX best practices, Power BI optimization guidance, and the awesome-copilot powerbi-modeling skill.**
- [ ] ⚠️Measures return correct results: run the key measures and check for errors, unexpected BLANKs, inverted or wrong logic (e.g. growth %, YTD, cumulative)
- [ ] ⚠️Measure query performance: run the key measures (total and sliced by a key dimension) cold and warm and flag slow ones
- [ ] ⚠️Avoid FILTER over entire tables (including FILTER(ALL(table)) inside CALCULATE); use simple column predicates, REMOVEFILTERS or KEEPFILTERS instead
- [ ] Use variables (VAR/RETURN) in complex measures to avoid repeated calculation and improve readability
- [ ] Use DIVIDE instead of the "/" operator when the denominator can be zero or BLANK
- [ ] Avoid IFERROR and ISERROR; handle problems with DIVIDE, COALESCE or explicit IF checks
- [ ] Avoid nested iterators and expensive iterators (SUMX/AVERAGEX/RANKX over large tables); simplify or pre-aggregate
- [ ] Qualify column references with the table name and never qualify measure references
- [ ] Use SELECTEDVALUE instead of IF(HASONEVALUE(...), VALUES(...))
- [ ] Time intelligence is built on a marked, continuous Date table with built-in functions (TOTALYTD, SAMEPERIODLASTYEAR, DATESYTD); no hard-coded dates or NOW()/TODAY() baked into calculated columns
- [ ] Prefer measures, Power Query or source columns over DAX calculated columns; avoid calculated columns on relationship keys and calculated columns that depend on measures
- [ ] Relationships support simple DAX: avoid bidirectional filters, many-to-many and inactive relationships that need USERELATIONSHIP in many measures
- [ ] Return BLANK instead of 0 or empty text for "no data", and avoid hard-coded magic numbers or literals inside measures

