---
name: substack-urgent
description: Substack in the URGENT tone - breaking-news Note and Article, one shock number. Sandbox only for now (sirensmallcaps.substack.com). Load to write or judge an urgent Substack Note or Article.
---

# Substack, urgent tone

Breaking-news alarm on Substack. Viral Notes rarely convert to paid readers, so judge this tone by signups, never by likes (https://escapethecubicle.substack.com/p/substack-changed-their-algorithm). Every house rule stays (skill `content-matrix`).

## Note
- **Signal post (BUY or SELL)**: the 5 lines of skill `angle-signal` instead, spaced, at most 250 characters on X, 600 on a Note.
- **Length**: under 200 characters when possible (the length that breaks out most: https://eden.so/blog/how-to-grow-on-substack-notes/), 300 at most, no line breaks.
- **Hook**: `🚨 BREAKING: <short name>` then ONE shock number.
- **Structure**: shock number, then one line of urgency. ONE idea only: the urgency line adds no second figure and no second measure, even without a number (no price, no fair value gap, no half-year number, no "profit dropped", "cash is melting", "losses go on"); it says only what the shock number means for a holder, no "Here is what happened:" filler.
- **Allowed**: one word in CAPS, one exclamation mark.
- **Visual**: see Image below.
- Example (a plain company update only; a BUY or SELL signal post never uses this one-line form, it takes the 5 spaced lines of `angle-signal`, as RCM's Note should have):
```
🚨 BREAKING: CareCloud just QUADRUPLED profit for shareholders to $4.7M. The market is asleep on this one!
```
- Don't: invent stakes, promise a gain, a hashtag, a second emoji.

## Article
- **Length**: 700 to 1100 words, short paragraphs.
- **Title**: `BREAKING:` + the shock number (« BREAKING: CareCloud Quadrupled Shareholder Profit »). Subtitle: one line of urgency on the title's one measure, with the same number as the cover note; never 'Here is what happened.' and never our signal rating ('The signal is weak' fails).
- **Structure** (`##` headings): `## The number`, `## Why the market missed it`, `## What happens next`, `## The risk`.
- **Visual**: see Image below.
- Do: bold the one figure of each section.
- Don't: drop the risk section; fake scarcity.

## Image
- **style**: `breaking` (skill `breaking-chart`), ONE chart only, sent through the `image` field for EVERY Note and Article: a picture holding 'THE MARKET THINKS / THE NUMBERS SAY' blocks fails, whichever drivers reverse (SuperCom, CareCloud, Lifeway and Enviri sent it again in round 4 on 2026-11-13). The chart is the one of the text's first number (a text opening on a price fall or % under fair value gets the `price` chart, a text opening on operating margin gets the single margin chart).
- **title**: the alarm with its number, one word in CAPS allowed.
- **newsLine**: the triggering fact when a news item is listed.
- **note**: the shock number on its point, in the chart's own unit and digit for digit as the text's lead number (text 34% price fall: note on the share price chart, never a revenue block). The picture is ONE `image` chart, never the three-block frame.
