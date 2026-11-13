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
4. **Rationale, point by point**: the price trades under (or above) fair value because the market believes <the drivers, a few words each>; then one line per driver that turned: « Nov 10: <driver> turned, <its number> ».
5. **Conclusion**: one sentence, what the price still has wrong.
- **Layout (Kevin 2026-11-13: « max spacing or emoji »)**: one step per line, a blank line between steps; urgent and balanced open a line with one emoji (📈 📉 ⚡ 🔎 ✅), neutral uses spacing only. This skeleton overrides the tone skill's length, « one measure » and « no line breaks » rules for a signal post; the tone only changes the words.
- **Length**: X post at most 250 characters (the disclaimer follows, X stops at 280): each step in a few words, the driver lines kept to the 1-2 that turned; Note at most 600 characters; an Article gives each step its section.
- The inputs give each step: `Signal: BUY (strong inflection), since <date>`, `Fair value: … quote …, N% vs fair value`, each driver's `Now: <tag> since <date>, <headline>`. Only those dates and figures; a step with no input is left out.
- The first driver line carries the picture's number digit for digit (skill `content-matrix`, « The picture »). Every % change comes from two dated figures in the inputs; say « profit for shareholders », never « net income ».
- An Idea with no BUY or SELL (a plain company update): one claim, what is new and why a holder cares today.

## Never
- A figure absent from the Idea's inputs.
- A price target, upside % or horizon beyond the fair value we give.
- Our internal words (« driver », « evidence », « thesis state », « gold ») in the post.
