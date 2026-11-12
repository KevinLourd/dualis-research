---
name: image-correction
description: Corrects each Dualis post picture after it is drawn - looks at the PNG, lists every defect a reader would hit (cut or hidden word, unclear label, a point that does not prove the post, a chart off the post's claim) and rewrites the picture's spec (chart, point, style, every word) so the redraw is clean. Up to 3 passes per picture. Load to correct pictures (dimension sandbox-image-fix) or to change the picture bar.
---

# Image correction (Kevin 2026-11-12)

Kevin: « c'est surtout une skill de correction d'image que je voulais ». Every picture is LOOKED AT once drawn and corrected until it reads clean, before the post review. The writer wrote the picture's spec; this skill fixes that spec when the drawn result fails, and the code draws it again.

## Look at the picture as the reader does
Read every word and number to its last character: the title, the label under it, the axis values, the arrow's note and its « VS price narrative » line, the value at the line's end, and the small inset cards (the news card, the price card top right with its pill and « opportunity » line). Then answer: in five seconds, do I know which company, what is measured (unit, period), and the post's conclusion?

## Defects (each one = the picture fails)
- A word or number cut (« … », a missing first digit), hidden behind a box, or overlapping another text.
- The note's number is not the point the arrow hits, or the note does not say what the number is (« 44M » alone).
- The chart does not show the post's claim (text about margin, chart of sales; text about debt, chart of the price).
- The title or label is a bare label with no claim when the style shows it, or repeats what another line says.
- Jargon a retail reader must decode (EPS, YoY, net income, guide, 8-K).
- The picture contradicts the text (other number, other side, other period).

## Levers (change only the spec)
- **Shorter words**: title 4 to 9 words, chartLabel 3 to 8 words with its unit, note 3 to 7 words with its number, priceSays 3 to 8 words.
- **Another point**: the one whose value IS the post's number (or `latest`).
- **Another chart**: from the charts listed for that post, the one that shows the post's claim.
- **Another style**: `pro` when the news or price card crowds the picture or the news card says nothing new.
Keep the tone skill's Image section and `content-matrix` « The picture »: a correction never breaks them.

## The opportunity frame
A picture headed by the price against its fair value and « The market believes » is drawn from the analysis (narrative + reversing drivers), never from the spec: only « Drawing: » defects apply to it, image null.

## A defect no spec change can fix
The drawing code itself is wrong (a card cut whatever the words, a box over the line on every point): say it in one line starting « Drawing: », give no new spec, and the run reports it so the code gets fixed.

## Answer
Per post: `ok` true when no defect; else `defects` (each one line, what the reader sees) and the corrected `image` (or null for a « Drawing: » defect only).
