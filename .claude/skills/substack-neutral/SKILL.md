---
name: substack-neutral
description: Substack in the NEUTRAL tone - sober research-note Note and Article, sell-side conventions, no emoji. Sandbox ledgerlens.substack.com. Load to write or judge a neutral Substack Note or Article.
---

# Substack, neutral tone

The sell-side research note: the view and why now first, then the evidence, valuation and risks (https://www.marketscreener.com/news/investor-education-how-to-read-an-equity-research-note-ce7e51d9db8bff2c, https://www.idealsvdr.com/blog/sell-side-report/). Every house rule stays (skill `content-matrix`).

## Note
- **Signal post (BUY or SELL)**: the 5 lines of skill `angle-signal` instead, spaced, at most 250 characters on X, 600 on a Note.
- **Length**: one paragraph of 2 to 4 sentences, 200 to 450 characters, no line breaks.
- **Hook**: the company and the finding. No emoji, no exclamation mark, no CAPS, no alarm word.
- **Structure**: fact with number and period, what it implies for the valuation, what to watch next. Every fact carries its figure (« Q3 sales $73.4M, down 4% from Q2 »), never « the shares fell » or « pushed the turn out » with no number.
- **Visual**: see Image below.
- Example:
```
CareCloud reported Q3 profit attributable to common shareholders of $4.7M, four times the prior year. The share price still discounts most of it as owed to preferred holders. The next dividend decision on the Series A will test that view.
```
- Don't: judging adjectives, a question hook, a call to buy or sell.

## Article
- **Length**: 1000 to 1500 words (count them: under 1000 fails; one cover chart whose note prints the title's number).
- **Title**: descriptive (« CareCloud: Q3 Profit for Common Shareholders Rose Fourfold »). Subtitle: the view in one line.
- **Structure** (`##` headings; the 5 signal lines go inside these sections, never pasted above the Summary): `## Summary` (3 bullets: view, catalyst, risk), `## Background`, `## The evidence`, `## Valuation` (the fair value given in the inputs and its method), `## Risks`.
- **Visual**: see Image below. The cover is ONE single-measure chart through `image`, never the three-block frame, and its note prints the title's number (Lifeway failed 2026-11-13).
- Do: every figure with its period and source, in plain words (say operating profit, a profit multiple, cash flow forecast), never EBITDA, enterprise value to earnings, discounted cash flow or micro-cap.
- Don't: emoji, hype, an unsourced figure.

## Image
- **style**: `pro`.
- **chart**: ONE chart of the first driver line's number (a quarterly or yearly fundamentals Exhibit), never a multi-block frame, never the price for a result; its note prints that number.
- **note**: the fact with its number, no adjective.
- **chartLabel**: the exact measure, unit and period.
