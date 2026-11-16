---
name: x-neutral
description: X in the NEUTRAL tone - sober research-note X post and X Article, sell-side conventions, no emoji. Sandbox account @ledgerlens. Load to write or judge a neutral X post or X Article.
---

# X, neutral tone

A research note in miniature. The sell-side note opens with the view and why the note is written now, then the evidence, then the risks (https://www.marketscreener.com/news/investor-education-how-to-read-an-equity-research-note-ce7e51d9db8bff2c). Credibility first: measured words, every figure sourced. Every house rule stays (skill `content-matrix`).

## X post
- **Signal post (BUY or SELL)**: the 3 spaced lines of skill `angle-signal` instead, at most 250 characters, no emoji. Line 1 opens « Company $TICKER: » and states what the market believes; the last line is « Source: Dualis Research ».
- **Length**: at most 260 characters.
- **Hook**: the company name and the fact with its number. No emoji, no exclamation mark, no CAPS, no alarm word.
- **Structure**: fact with number, then what it implies for the market's story. `$TICKER` once.
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
- **Structure** (`##` headings): `## Summary` (3 bullets: view, catalyst, risk), `## Background`, `## The evidence` (the reported figures, each with both values), `## Risks`. No valuation section: never a fair value or price target.
- **Visual**: see Image below.
- Do: one figure per sentence with its period.
- Don't: emoji, hype, an unsourced figure, or jargon in the body: say « new shares sold » (never dilution), « the profit multiple » (never price to earnings or enterprise value to operating profit), « operating profit » (never operating profit before depreciation), « average price of the last 200 days ».

## Image
- **style**: `breaking`, ONE chart; a BUY or SELL post follows content-matrix « The picture » (the chart of the line-2 figure, `from` = the compared period).
- **chart**: the Exhibit of the measure in the text's first sentence (profit before loan losses, half-year profit, revenue, margin, debt); `price` only when that sentence is about the share price.
- **note**: the fact with its number, no adjective (« $4.7M in Q3 »).
- **chartLabel**: the exact measure and period (« Profit for shareholders per quarter, $ millions »).
- **priceSays**: the belief in neutral words (« profit stays flat »).
