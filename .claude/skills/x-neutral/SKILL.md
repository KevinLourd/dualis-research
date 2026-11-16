---
name: x-neutral
description: X in the NEUTRAL tone - sober research-note X post and X Article, sell-side conventions, no emoji. Sandbox account @ledgerlens. Load to write or judge a neutral X post or X Article.
---

# X, neutral tone

A research note in miniature. The sell-side note opens with the view and why the note is written now, then the evidence, then the risks (https://www.marketscreener.com/news/investor-education-how-to-read-an-equity-research-note-ce7e51d9db8bff2c). Credibility first: measured words, every figure sourced. Every house rule stays (skill `content-matrix`).

## X post
- **Signal post (BUY or SELL)**: the 5 lines of skill `angle-signal` instead, spaced, at most 250 characters on X, 600 on a Note. Line 1 is "Company $TICKER: BUY, inflection." (or SELL, crack); a text that opens "Company $TICKER closed at" or holds one or two sentences fails (RCM and Monro 2026-11-16, Monro again in round 2: write the 5 spaced lines opening "Monro $MNRO: BUY, inflection.", never "closed at"); the last line is "Source: Dualis Research".
- **Length**: at most 260 characters.
- **Hook**: the company name and the fact with its number. No emoji, no exclamation mark, no CAPS, no alarm word.
- **Structure**: fact with number, then what it implies for the valuation. `$TICKER` once.
- **Visual**: see Image below.
- Example:
```
CareCloud ($CCLD) reported Q3 profit attributable to common shareholders of $4.7M, four times the prior year. The share price still discounts most of it as owed to preferred holders.
```
- Do: name the period and the source in plain words (« Q3 filing », « per Reuters »), never a form name such as 10-Q.
- Don't: adjectives that judge (« massive », « incredible »), a question hook, a call to buy or sell.

## X Article
- **Length**: 600 to 1000 words.
- **Title**: descriptive, the company and the finding (« CareCloud: Q3 Profit for Common Shareholders Rose Fourfold »).
- **Subtitle**: the view in one line.
- **Structure** (`##` headings): `## Summary` (3 bullets: view, catalyst, risk), `## Background`, `## The evidence`, `## Valuation` (fair value as given in the inputs, its method in a few words; never "price to earnings ratio" or "200-day average": write "profit multiple" and "average price of the last 200 days"), `## Risks`.
- **Visual**: see Image below.
- Do: one figure per sentence with its period.
- Don't: emoji, hype, an unsourced figure, or jargon in the Article body: write "new shares sold" not dilution, "profit multiple" not price to earnings, "operating profit" not operating profit before depreciation, and never "ratio of enterprise value to operating profit before depreciation": write "the profit multiple" and never "operating profit before depreciation" or "profit multiple of earnings" (SuperCom Article 2026-11-15 round 6 and 2026-11-16 rounds 1 to 5).

## Image
- **style**: the answer is `{"image":{...},"text":"..."}` and you type `{"image":{"style":"breaking","chart":"price"` BEFORE any text for EVERY BUY or SELL post, the Article included (SuperCom, CareCloud and Enviri were drawn as 2-3 card frames again in round 5 of 2026-11-16); `breaking`, ONE chart in ONE `image` object; the answer's first 20 characters are `{"image":{"style":"breaking"` (SuperCom, CareCloud and Enviri were drawn as multi-card frames again 2026-11-16 and in round 2: copy `{"image":{"style":"breaking","chart":"price","title":"SuperCom trades 24% under fair value","note":"24% under fair value"` with the post's own company and gap, so the title's number is on the picture), never several cards, never an EPS or net income title; a BUY or SELL post uses chart `price` with the step-2 gap as its note ("24% under fair value"); SuperCom, CareCloud and Enviri were still drawn as 2-3 card frames in round 4 of 2026-11-16: the answer's first characters are the `image` object with chart `price` and the post's own gap (24%, 36%, 24%), never the text first; a picture with cards fails all three checks.
- **chart**: the Exhibit of the measure in the text's first sentence (profit before loan losses, half-year profit, revenue, margin, debt); `price` only when that first sentence is about the share price. Never the price chart under a profit text.
- **note**: the fact with its number, no adjective (« $4.7M in Q3 »).
- **chartLabel**: the exact measure and period (« Profit for shareholders per quarter, $ millions »).
- **priceSays**: the belief in neutral words (« profit stays flat »).
