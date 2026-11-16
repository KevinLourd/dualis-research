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
1. **Signal type**: inflection (a gloomy story turning, price under fair value: a missed opportunity) or crack (a loved story breaking, price above: a danger), with its strength (« Strong inflection »). The type follows the step-2 gap: under fair value is always an inflection (BUY, 📈), above always a crack (SELL, 📉).
2. **Size**: quote vs fair value, both figures and the gap (« $3.10 vs $4.60 fair value: 33% under »). Any close printed elsewhere in the post is this same close, digit for digit.
3. **Trigger and date**: the dated fact that set it off, with its figure and period from the inputs (« Q3 results, Nov 10: sales +21% to $7.5M »). For a BUY it is a fact that turned UP, never a fall, a loss, a 12-month low or a bare close; with no upturn in the inputs the line is the dated close vs fair value (« Nov 13: close $31.54, fair value $33.18 »). A trigger with no figure (« Q3 results published ») fails. Every money figure says what it is (« released cash $62M »), with its currency and period; every « A vs B » names its period.
4. **Rationale, point by point**: the price trades under (or above) fair value because the market believes <belief>, and the belief carries one dated figure from the inputs (« sales fell 1.8% in Q2 »), else the price's own dated move (« down 34% since Oct 30 »), never a belief with no figure (« as if the recovery is over »). Then one line per driver that turned: « Nov 10: <driver> turned, <its number> », dated by its figure's date, worded to match its number, never a repeat of the trigger line. The trigger, the belief and the driver lines speak of ONE measure (a one-off gain never sits beside a profit-per-share belief).
5. **Conclusion**: one sentence on what the price still has wrong, ending on the gap's number (« Still under fair value by 5% »); a conclusion with no number fails.
- **Layout (Kevin 2026-11-13: « max spacing or emoji »)**: one step per line, a blank line between steps; urgent and balanced open a line with one emoji (📈 📉 ⚡ 🔎 ✅), neutral uses spacing only. This skeleton overrides the tone skill's length, « one measure » and « no line breaks » rules for a signal post; the tone only changes the words.
- **Length**: X post at most 250 characters (the disclaimer follows, X stops at 280): each step in a few words, the driver lines kept to the 1-2 that turned; Note at most 600 characters; an Article gives each step its section.
- The inputs give each step: `Signal: BUY (strong inflection), since <date>`, `Fair value: … quote …, N% vs fair value`, each driver's `Now: <tag> since <date>, <headline>`. Only those dates and figures; a step with no input is left out.
- **A BUY or SELL post is ALWAYS the 5 spaced lines, then « Source: Dualis Research »**, in every format and under any picture: never one sentence, never the one-line 🚨 form, never opened on « $TICKER closed at ». Example: « 📈 RCM Technologies: BUY, inflection. » / « 🔎 $31.54 vs $33.18 fair value: 5% under. » / ⚡ the dated trigger / 📉 the belief with its figure / ✅ the conclusion / Source.
- The picture: skill `content-matrix`, « The picture » (chart `price`, its note the step-2 gap).
- Every % change comes from two dated figures in the inputs, written in full (« rose 21% to $7.5M from $6.2M a year earlier »); say « profit for shareholders », never « net income ».
- An Idea with no BUY or SELL (a plain company update): ONE claim with its figure and period, what is new and why a holder cares today, at most 3 figures: either the close vs fair value (chart `price`, no result figure, no « what to watch » line) or one result (its own chart, never `price`). Never a result that improved beside another that worsened, never a reason with no figure.

## Never
- A figure absent from the Idea's inputs.
- A price target, upside % or horizon beyond the fair value we give.
- Our internal words (« driver », « evidence », « thesis state », « gold », « no source we hold ») in the post.
