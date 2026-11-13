---
name: angle-signal
description: The SIGNAL angle of a Dualis post - the idea comes from our own analysis (the day's Ideas, Signal Changes, Narrative Drivers, Evidence). Load to write or judge a post built on our signals.
---

# Angle: signal

Our own edge: a narrative cracking or inflecting, read by our analysis. It is the angle that grows paid readers, because nobody else has it.

## Where the input comes from
- `gold.content_ideas` (the day's Ideas, scored per format; content-ideas), each citing its sources: Signal (`gold.signals`), Signal Changes (`gold.signal_changes`), Evidence (`gold.evidence`), Narrative Drivers (`gold.narrative_drivers`).
- The writer gets, per Idea: the title, why now, the narrative, the signal, the fair value vs quote, the cited evidence and drivers (`content-drafts/format.ts` `draftPrompt`).
- Sandbox: slots 08:00 and 14:00 take the day's best and second Ideas.

## How to write it
**Every signal post, X and Substack, every tone, walks these 5 steps in order (Kevin 2026-11-13: a post that skips one leaves the reader lost):**
1. **Signal type**: inflection (a gloomy story turning, price under fair value: a missed opportunity) or crack (a loved story breaking, price above: a danger), with its strength (« Strong inflection »).
2. **Size**: quote vs fair value, both figures and the gap (« $3.10 vs $4.60 fair value: 33% under »).
3. **Trigger and date**: the fact that set it off and how recent (« Q3 results, Nov 10 »).
4. **Rationale, point by point**: the price trades under (or above) fair value because the market believes <the drivers, a few words each>; then one line per driver that turned: « Nov 10: <driver> turned, <its number> ». The belief and the number are the same measure (belief 'losses last through 2027' pairs with a forecast figure; belief 'share sales weigh' never pairs with an operating margin), and every money figure carries its $ and period.
5. **Conclusion**: one sentence, what the price still has wrong.
- **Layout (Kevin 2026-11-13: « max spacing or emoji »)**: one step per line, a blank line between steps; urgent and balanced open a line with one emoji (📈 📉 ⚡ 🔎 ✅), neutral uses spacing only. This skeleton overrides the tone skill's length, « one measure » and « no line breaks » rules for a signal post; the tone only changes the words.
- **Length**: X post at most 250 characters (the disclaimer follows, X stops at 280): each step in a few words, the driver lines kept to the 1-2 that turned; Note at most 600 characters; an Article gives each step its section.
- The inputs give each step: `Signal: BUY (strong inflection), since <date>`, `Fair value: … quote …, N% vs fair value`, each driver's `Now: <tag> since <date>, <headline>`. Only those dates and figures; a step with no input is left out, but a BUY or SELL post never collapses to one paragraph or the one-line 🚨 form (RCM failed 2026-11-13 and in rounds 5 and 6 (round 6: three lines, no BUY/SELL type, no trigger line, no driver line): it starts « RCM $RCMT: BUY, inflection. » or « SELL, crack. » and needs the 5 lines, opening with 📈 or 📉, a number for the Q3 sales fact, and the Source line), the trigger date is the date printed on the driver line (a Nov 6 trigger over a Nov 5 driver line, CareCloud and Enviri 2026-11-13, fails), and each driver line's wording matches its number ("sales growth is slowing" beside +18.6% fails).
- Before writing the text, output `image` (style breaking, ONE chart, no blocks) as the FIRST key of EVERY post, Article and one-line RCM-type post included (round 6 of 2026-11-13: all 5 posts still got the frame, with 19.6% under a 19.5% text and a crash text over debt and revenue blocks), from the first driver line's number, with a note that prints that number with its unit and period (CareCloud: note "Operating margin 19.5% in Q3"; Enviri: note "Profit $2.5M in Q3"; Lifeway: note "Sales +18.6% in Q3"); the picture is never the NARRATIVE/REALITY frame. The first driver line carries the picture's number digit for digit, and the picture is ONE chart of exactly that measure, drawn through `image` (style `pro`; a NARRATIVE/REALITY frame or an « opportunity » header fails) (skill `content-matrix`, « The picture »); a post leading with revenue never takes the share price chart, and no post ever takes a multi-block picture (SuperCom, CareCloud, Lifeway, Enviri failed round 5 of 2026-11-13 with 2-3 blocks whose headline was not the text's number), and a post with a BUY or SELL always walks the 5 steps and ends with « Source: Dualis Research ». Every % change comes from two dated figures in the inputs; say « profit for shareholders », never « net income ».
- An Idea with no BUY or SELL (a plain company update): ONE claim with ONE number (the price move OR the result, never both) and at most 3 figures in the post: what is new and why a holder cares today. A « what to watch » line names a measured figure (« Q3 revenue of $X »), never a claim with no number such as « a one-off dip », and the picture charts that same claim.

## Never
- A figure absent from the Idea's inputs.
- A price target, upside % or horizon beyond the fair value we give.
- Our internal words (« driver », « evidence », « thesis state », « gold », « no source we hold ») in the post.
