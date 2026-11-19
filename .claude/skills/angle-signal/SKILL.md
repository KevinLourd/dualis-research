---
name: angle-signal
description: The SIGNAL angle of a Dualis post - the idea comes from our own analysis (the day's Ideas, Signal Changes, Narrative Drivers, Evidence). Load to write or judge a post built on our signals.
---

# Angle: signal

Our own edge: a narrative cracking or inflecting, read by our analysis. It is the angle that grows paid readers, because nobody else has it.

**Never a fair value** (Thierry 2026-11-16: « not confident in our fair values »): a post proves the narrative break with a REPORTED figure and the shortest convincing why.

## Where the input comes from
- `gold.content_ideas` (the day's Ideas, scored per format; content-ideas), each citing its sources: Signal (`gold.signals`), Signal Changes (`gold.signal_changes`), Evidence (`gold.evidence`), Narrative Drivers (`gold.narrative_drivers`).
- The writer gets, per Idea: the title, why now, the narrative, the signal side, the cited evidence, the drivers with their `Now:` line, and **Reported figures** (each driver Exhibit's values with their period) (`content-drafts/format.ts` `draftPrompt`). It never gets a fair value, so it never prints one.

## How to write it: 3 lines
**Every signal post, X and Substack, every tone, is these 3 lines in order, a blank line between them:**
1. **What the market believes**: the story the price tells, in plain words (never cash floor, EPS, guide), with the company and `$TICKER`, no figure in it (« SuperCom $SPCB: the market still prices a shrinking business. »).
2. **The real figure that contradicts it**: ONE reported figure with its period (named as the picture labels it: Sep-26 is Q3, never Q2) and both values, a « record » included (the earlier value it beats) (« Q3 revenue $7.5M, up 21% from $6.2M a year earlier. »). Copied digit for digit from one reversing driver's `Now:` line (with a frame drawn, from a headline the picture prints; a figure no headline prints fails): its measure, period as the picture boxes it, both values, its rounding, the words naming the second value's period or kind (« a year earlier », « in the June quarter », « expected »; « earlier », « before » or « record » alone fails); with a frame drawn, line 2 is ONE printed headline of a reversing block, copied as printed: its measure, its numbers and its comparison word (« Q3 sales 5.0M misses 6.0M » gives « Q3 sales $5.0M, against $6.0M expected »). A headline with one value stays one value (no « up from », no second period or %); a measure no block prints never leads; line 1 is the belief of the same block, and the picture's side decides SELL (crack) or BUY (inflection). Line 1, line 3 and the emoji follow that block's side (inflection 📈, crack 📉). With no driver, from Reported figures or Evidence, of the measure the picture charts (a gross margin text needs the gross margin chart); the % comes from those two values.
3. **Why it breaks the story: one sentence naming one concrete event the company did or lost (a new contract, a lost customer, a price rise, a new product), no number; « grew its sales », « kept costs in check », « missed its forecast » and « reported sales below estimates » are results, never a cause: name an action (signed, lost, raised, bought, launched)** (« New contracts now make up most of sales. »; Thierry 2026-11-17: « it can't just tell me profit's rising »).
- Then « Source: Dualis Research » on its own line.
- **Layout**: urgent and balanced may open line 1 with 📈 (a story turning up, BUY side) or 📉 (a loved story cracking, SELL side); neutral uses spacing only. The tone changes the words, never the 3 lines.
- **Length**: X post at most 250 characters (the disclaimer follows, X stops at 280); Note at most 400 characters; an Article opens with the 3 lines as its first section, then gives the evidence.
- **No frame, driver or reported figure at all**: line 2 states the dated fact in words, with no number; when a frame is drawn, line 2 is one printed headline copied as is, never a share price or any figure the picture does not print (one value stays one value, no « up from »), line 1 is that block's Market view and line 3 an action behind it; never a figure made up, never the share price standing in for it.
- The picture: skill `content-matrix`, « The picture » (the chart of the line-2 figure, both periods boxed).
- Say « profit for shareholders », never « net income ». One measure across the 3 lines.

## A post with no BUY or SELL (a weak signal)
Still the 3 lines above and the Source line, on ONE measure: the line-2 figure with its period and both values, the same measure in every line, no second result, its own chart. The last line is « Source: Dualis Research ».

## Never
- A fair value, a gap to it (« 24% under fair value »), a range, an upside or downside %, a price target, a horizon or the word « opportunity ».
- A figure absent from the inputs, or a % change without both of its values.
- Our internal words (« driver », « evidence », « thesis state », « signal strength », « gold ») in the post.
