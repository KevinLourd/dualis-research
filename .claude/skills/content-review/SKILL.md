---
name: content-review
description: Post-evaluation of Dualis Research content - reads each post WITH its picture, checks the picture stands alone, text and picture tell the same conclusion, and both read at once; on a failure it edits the WRITING skill that let it through, never the post, and the content is generated again. Load to review any Sandbox day (dimension sandbox-review), any draft, or to change the review bar. Grows over time.
---

# Content review (Kevin 2026-11-11)

Kevin: « les images ne sont pas claires, pas autoporteuses, parfois le message n'est pas aligné avec la conclusion ». This skill is the bar every post clears before anyone reads it. The writer is fixed through its skills, never by rewriting its text: a failure is a rule missing or unclear in what the writer read.

## The three checks (per post, each true or false)
1. **imageAlone**: shown ONLY the picture, a retail investor knows in five seconds which company, what is measured (unit, period) and what the picture claims. **Read EVERY word and number on the picture to its last character** (the news card, axis labels, the change between two boxed periods, the end value): one cut, hidden or overlapping word fails it (Kevin 2026-11-12: a pill lost its number and this review passed it). Fails on: an unnamed or cut axis, a unit missing, a note that does not say what the number is, a heading that is a label with no claim anywhere, a picture that could not be drawn, a chart the reader must decode (many series, unlabelled colours).
2. **aligned**: the picture and the text tell ONE conclusion with the same main number. Fails on: the text says profit tripled and the picture shows the share price; the note's number is not in the text or contradicts it; the picture argues the opposite side (an inflection picture under a crack text); the arrow on a point that does not prove the text's claim.
3. **clear**: the post reads in one pass. Fails on: jargon (EPS, YoY, net income, common shareholders), a sentence the reader must read twice, two ideas fighting in one short post, a claim with no reported figure, a change without both of its values, a number with no meaning (« $4.7M » without what it is), any fair value, gap to it, upside or « opportunity » in text or picture (Thierry 2026-11-16), the tone skill's own rules broken (length, hook, structure). Never fail a post for lacking a valuation or a gap number.

A post passes when all three are true. The day passes when every post passes.

## The why
One sentence per post: what the reader sees, and the exact failure (« the picture heads "CareCloud: Share price" while the text is about profit quadrupling »). On a pass, the one thing that makes it work.

## A drawing defect is not a writing defect
Cut or overlapping text, a box over the line, a number lost in a card: the writer did not cause it and no skill edit fixes it. The check still FAILS, its why starts with « Drawing: » and names the exact element (« Drawing: the news card headline is cut »), and no edit is made for it. The run reports every « Drawing: » line so the code gets fixed.
**The story-break frame is drawn by the code, never by the writer**: when the company has drivers reversing now, the picture (the signal's words, then NARRATIVE / REALITY blocks with their reported charts) comes from the analysis whatever `image` the writer sent (content-matrix « The picture »). A failure of that picture is a « Drawing: the frame … » line, never a skill edit: no wording makes the writer avoid it.

## Edits: fix the skill, never the post
On any failure, edit the writing skill whose rule would have prevented it:
- A rule every tone needs (pictures standing alone, alignment, plain words) -> `content-matrix` (its « The picture » or « Rules every post keeps »).
- A rule of one tone's look or words -> that channel x tone skill (its Image section or its format section).
- A rule of one angle -> that angle skill.
Each edit = `old` copied character for character from the file (enough to be unique), `new` = the replacement, `why` = the failure in one line.
**An edit REPLACES the rule, never appends its history.** `new` states the rule once, as a general principle the writer applies to any company on any day: never a date, a round number (« round 3 of … »), the day's companies (« SuperCom, CareCloud and Enviri were drawn… »), what failed before, or a « void / ignore the above » note. A rule the writer keeps breaking needs a SHORTER, clearer statement, never a louder or longer one: rewrite the line whole and cut what it supersedes. Each file stays about the same size: the code refuses (and keeps in the review with its reason) an edit that adds a date or « round N », grows its file by more than 300 characters, or takes it past 10,000 bytes. Name the observable fix (« the note names the measure: "Profit $4.7M in Q3" »), never a vague wish (« be clearer »). Never an edit that makes the writer invent data, drop the risk section, or break a house rule.
When everything passes, edits = [].

## How it runs
Dimension `sandbox-review` (after `sandbox-visuals`): one call per account per day and round, the posts and their PNGs attached. A failing round's edits are written to the skill files, the collect workflow commits them to main, and `sandbox-posts` writes the day again with them, up to 3 rounds. Every review is kept in `silver.sandbox_reviews` (checks, why, edits applied or not and why).

## Growing this skill
Each time Kevin or Thierry flags a post this review let through, add the failure as a « Fails on » example under its check, in their words, with the date.
