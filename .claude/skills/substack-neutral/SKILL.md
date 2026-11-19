---
name: substack-neutral
description: Substack in the NEUTRAL tone - sober research-note Note and Article, sell-side conventions, no emoji. Sandbox ledgerlens.substack.com. Load to write or judge a neutral Substack Note or Article.
---

# Substack, neutral tone

The sell-side research note: the view and why now first, then the evidence and risks (https://www.marketscreener.com/news/investor-education-how-to-read-an-equity-research-note-ce7e51d9db8bff2c, https://www.idealsvdr.com/blog/sell-side-report/). Every house rule stays (skill `content-matrix`).

## Note
- **Signal post (BUY or SELL)**: the 3 spaced lines of skill `angle-signal` instead (line 2 is exactly one headline printed on the picture, with the values it prints and no other), at most 400 characters, no emoji, never one sentence plus Source.
- **Length** (a post with no BUY or SELL): one paragraph of 2 to 4 sentences, 200 to 450 characters, no line breaks.
- **Hook**: the company and the finding. No emoji, no exclamation mark, no CAPS, no alarm word.
- **Structure**: fact with number and period, what it implies for the market's story, what to watch next. Every fact carries its figure (« Q3 sales $73.4M, down 4% from Q2 »), never « the shares fell » with no number.
- **Visual**: see Image below.
- Example:
```
CareCloud reported Q3 profit attributable to common shareholders of $4.7M, four times the prior year. The share price still discounts most of it as owed to preferred holders. The next dividend decision on the Series A will test that view.
```
- Don't: judging adjectives, a question hook, a call to buy or sell.

## Article
- **Length**: 1000 to 1500 words, counted before sending: each of the 5 sections at least 240 words.
- **Title**: descriptive, ONE measure only, plain words (« CareCloud: Q3 Profit for Shareholders Rose Fourfold »); never a price gap plus a one-day fall in one title. Subtitle: the view in one line.
- **Structure** (`##` headings): `## Summary` (3 bullets: view, catalyst, risk), `## Background`, `## The evidence` (reported figures, each with both values), `## Risks`; no valuation section, never a fair value or price target. The 3 signal lines (line 2 = a printed picture headline when a frame is drawn; the title and Summary lead with that figure) are told as flowing sentences inside these sections, never pasted as a block of lines and never above the Summary.
- **Visual**: see Image below. The cover's note prints the title's number.
- Do: every figure with its period and source, in plain words (operating profit, « a year earlier »), every change (a %, « a third », « doubled ») with both values (« $7.5M, up 21% from $6.2M »), never EBITDA, enterprise value, discounted cash flow, micro-cap or « year over year »; count beliefs once (never « four beliefs » then « two of the four »).
- Don't: emoji, hype, an unsourced figure, a sentence about our own method (« we rate », « the three lines of the signal », « our analysis marks »).

## Image
- **style**: `breaking`, ONE chart; a BUY or SELL post (Note or Article) follows content-matrix « The picture » (the chart of the line-2 figure, `from` = the compared period).
- **note**: the fact with its number, no adjective.
- **chartLabel**: the exact measure, unit and period.
