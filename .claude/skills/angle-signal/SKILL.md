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
1. **What the market believes**: the story the price tells, in a few plain words, with the company and `$TICKER` (« SuperCom $SPCB: the market still prices a shrinking business. »).
2. **The real figure that contradicts it**: ONE reported figure with its period and both values, a « record » included (the earlier value it beats) (« Q3 revenue $7.5M, up 21% from $6.2M a year earlier. »). Copied digit for digit from one reversing driver's `Now:` line: its measure, both values, its rounding, the word naming what the second value is (expected, a year earlier; « record » alone fails), and the side of the picture (crack = SELL, inflection = BUY). With a frame drawn, line 2 is the headline figure of one frame block, its digits copied exactly (a cash level, share count or margin the frame does not headline is never line 2), and line 1, line 3 and the emoji follow that block's side (inflection 📈, crack 📉). With no driver, from Reported figures or Evidence; the % comes from those two values.
3. **Why it breaks the story: one sentence, one cause (never two joined by « and »), no number, no claim such as « record » that lacks a figure; the cause is what changed IN THE BUSINESS and lasts (the driver state's reason), never only the figure restated** (« New contracts now make up most of sales. »; Thierry 2026-11-17: « it can't just tell me profit's rising »).
- Then « Source: Dualis Research » on its own line.
- **Layout**: urgent and balanced may open line 1 with 📈 (a story turning up, BUY side) or 📉 (a loved story cracking, SELL side); neutral uses spacing only. The tone changes the words, never the 3 lines.
- **Length**: X post at most 250 characters (the disclaimer follows, X stops at 280); Note at most 400 characters; an Article opens with the 3 lines as its first section, then gives the evidence.
- **No figure that breaks the story in the inputs**: line 2 states the dated fact in words, with no number; never a figure made up, never the share price standing in for it.
- The picture: skill `content-matrix`, « The picture » (the chart of the line-2 figure, both periods boxed).
- Say « profit for shareholders », never « net income ». One measure across the 3 lines.

## A post with no BUY or SELL (a weak signal)
Still the 3 lines above and the Source line, on ONE measure: the line-2 figure with its period and both values, the same measure in every line, no second result, its own chart. The last line is « Source: Dualis Research ».

## Never
- A fair value, a gap to it (« 24% under fair value »), a range, an upside or downside %, a price target, a horizon or the word « opportunity ».
- A figure absent from the inputs, or a % change without both of its values.
- Our internal words (« driver », « evidence », « thesis state », « signal strength », « gold ») in the post.
