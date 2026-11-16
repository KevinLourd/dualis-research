---
name: substack-neutral
description: Substack in the NEUTRAL tone - sober research-note Note and Article, sell-side conventions, no emoji. Sandbox ledgerlens.substack.com. Load to write or judge a neutral Substack Note or Article.
---

# Substack, neutral tone

The sell-side research note: the view and why now first, then the evidence, valuation and risks (https://www.marketscreener.com/news/investor-education-how-to-read-an-equity-research-note-ce7e51d9db8bff2c, https://www.idealsvdr.com/blog/sell-side-report/). Every house rule stays (skill `content-matrix`).

## Note
- **Signal post (BUY or SELL)**: the 5 lines of skill `angle-signal` instead, spaced, at most 250 characters on X, 600 on a Note.
- **Length** (never a BUY or SELL Note): one paragraph of 2 to 4 sentences, 200 to 450 characters, no line breaks. A BUY or SELL Note is ALWAYS the 5 spaced lines of angle-signal starting "BUY, inflection." (Monro Note 2026-11-16 was again one sentence plus Source: lines 1 to 5 are type, close vs fair value gap, dated trigger with figure, belief, conclusion). Under a `price` picture the Note prints only the gap and the price's own dated move, never a sales figure or a % fall the picture lacks; line 3 is a dated fact that went UP, else the dated price move with one figure, and 'fell', 'down from' or 'net loss' never appear in a BUY Note (RCM 'Q3 sales $73.4M, down from $93.8M' and Monro 'Q2 sales fell 1.8%, net loss' failed 2026-11-16 round 3).
- **Hook**: the company and the finding. No emoji, no exclamation mark, no CAPS, no alarm word.
- **Structure**: fact with number and period, what it implies for the valuation, what to watch next. Every fact carries its figure (« Q3 sales $73.4M, down 4% from Q2 »), never « the shares fell » or « pushed the turn out » with no number.
- **Visual**: see Image below.
- Example:
```
CareCloud reported Q3 profit attributable to common shareholders of $4.7M, four times the prior year. The share price still discounts most of it as owed to preferred holders. The next dividend decision on the Series A will test that view.
```
- Don't: judging adjectives, a question hook, a call to buy or sell.

## Article
- **Length**: 1000 to 1500 words (count them: under 1000 fails, SuperCom 2026-11-15 had about 950: give each of the 5 sections at least 240 words (aim for 1200 in total); one cover chart whose note prints the title's number).
- **Title**: descriptive, ONE measure only, plain words (« CareCloud: Q3 Profit for Shareholders Rose Fourfold »); never a price gap plus a one day fall in one title. Subtitle: the view in one line.
- **Structure** (`##` headings; the 5 signal steps are written as flowing sentences inside these sections, never as a pasted block of lines (SuperCom 2026-11-16 pasted "BUY, inflection." and 4 lines in the middle of The evidence) and never above the Summary; never write "we have found no confirmed business cause" or "our analysis marks"): `## Summary` (3 bullets: view, catalyst, risk), `## Background`, `## The evidence`, `## Valuation` (the fair value given in the inputs and its method), `## Risks`.
- **Visual**: see Image below. The cover is ONE single-measure chart through `image`, never the three-block frame, and its note prints the title's number (Lifeway failed 2026-11-13).
- Do: every figure with its period and source, in plain words (say operating profit, a profit multiple, cash flow forecast), never EBITDA, enterprise value to earnings, discounted cash flow or micro-cap, never « earnings before interest, tax, depreciation and amortization » or « year over year » (SuperCom 2026-11-15: say operating profit before depreciation, « a year earlier »); count beliefs once (never « four beliefs » then « two of the four »); never write « we rate », « the five steps of the signal » or any sentence about our own method (SuperCom 2026-11-16).
- Don't: emoji, hype, an unsourced figure.

## Image
- **style**: `breaking` (a BUY or SELL post is drawn through `image` as the first key of the answer).
- **chart**: THE ANSWER'S FIRST CHARACTERS ARE `{"image":{"style":"breaking","chart":"price"`, for the Article too (SuperCom, CareCloud, Enviri were drawn as 2-3 card frames in every round of 2026-11-16: a 30.2M debt chart, 'Net debt' or EPS cards under a 24% or 36% text; the picture's only number is the step-2 gap). For a BUY or SELL post (Note or Article) the answer begins `{"image":{"style":"breaking","chart":"price","title":"<Company> trades N% under fair value","note":"N% under fair value"` (N = the step-2 gap, "above" for a SELL), then `"text"`; never a multi-block frame, never an EPS title: a picture with several cards, "Net debt", "Analyst mean EPS" or a STRONG/WEAK INFLECTION tag means `image` was missing (SuperCom, CareCloud, Enviri 2026-11-16); one price chart, note "N% under fair value".
- **note**: the fact with its number, no adjective. For a BUY or SELL post it is the step-2 gap ("24% under fair value") and the answer starts with `image`: CareCloud, Enviri and SuperCom 2026-11-16 round 2 were again drawn as the 2-3 block frame with EPS and net income titles.
- **chartLabel**: the exact measure, unit and period.
