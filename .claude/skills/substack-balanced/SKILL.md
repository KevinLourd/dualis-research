---
name: substack-balanced
description: Substack in the BALANCED tone (today's Dualis house style) - Note and Article. One small paragraph + one chart for a Note; the research-note anatomy for an Article. Load to write or judge a balanced Substack Note or Article (Sandbox narrativegap.substack.com, and the real drafts).
---

# Substack, balanced tone (house style)

The house style (skills `daily-content`, `breaking-chart`, `research-note`, `content-drafts/format.ts`). The analyst with conviction: urgent, direct, certain, sober words.

## Note
- **Signal post (BUY or SELL)**: the 5 lines of skill `angle-signal` instead, spaced, at most 250 characters on X, 600 on a Note.
- **Length**: one paragraph of 2 or 3 short sentences, 150 to 300 characters, no line breaks. Short Notes break out most often; 600-1,199 characters is a dead zone (Eden, 473k Notes: https://eden.so/blog/how-to-grow-on-substack-notes/).
- **Hook**: `🚨 <short name>: ` then the alarm with its number and period (« Q3 profit $4.7M »), ONLY for an Idea with no BUY or SELL; an Idea with a BUY or SELL (RCM and Monro 2026-11-16 rounds 1 to 4 were 🚨 plus one sentence plus Source, with a second figure such as 11.7% or 1.8% the picture lacks: the text's first character is 📈 or 📉, never 🚨, and its only figures are the close, the fair value and the gap: a text that opens 🚨 on a BUY or has fewer than 5 spaced lines fails) opens 📈 or 📉 on its own line and writes the 5 spaced lines of `angle-signal` (RCM: "📈 RCM Technologies: BUY, inflection.", then "🔎 $31.54 vs $33.18 fair value: 5% under.", a ⚡ trigger line with its date, a 📉 belief line, a ✅ conclusion, then the Source line). Never a label or question (« Trade alert », « Here Is What Happened Next »); every claim carries a number.
- **Structure**: 1 the alarm + number, 2 why the market has it wrong, 3 (optional) what to watch.
- **Visual**: see Image below.
- Example:
```
🚨 CareCloud: profit for shareholders jumped 4x in Q3, to $4.7M. The price still bets it leaks to preferred holders. Watch the next quarter's payout.
```
- Do: one claim; no Substack link or CTA in the text.
- Don't: hedge, describe the chart point by point, a hashtag, any emoji but the siren, a claim with no figure ("China and Europe still lose money"), a second measure or figure in a Note (sales or cash next to the margin, a Q4 forecast next to Q3 sales: say 'the company forecasts', never 'guides'), a history claim the chart does not show ("five years of shrinking sales" on a 2-year chart).

## Article
Anatomy of skill `research-note`; title formula of Multibagger Ideas (the claim with its figures).
- **Length**: 900 to 1400 words.
- **Title**: a claim with its figures (« 4x Profit for Shareholders, a Price Still Pricing the Preferred »). Subtitle: one line; it becomes the SEO description (https://on.substack.com/p/substack-seo-guide).
- **Structure** (`##` headings): `## Key takeaways` (3 bullets), `## What the market believes`, `## What changed`, `## Bull vs bear`, `## What would prove us wrong`.
- **Visual**: see Image below.
- Do: numbers with date and source; the paywall would sit before « Bull vs bear » (Substack's examples put it before the payoff: https://on.substack.com/p/free-vs-paid).
- Don't: a topic title (« CareCloud update »), a guessed figure: write what we would need to know, a valuation method name (« enterprise value to operating profit », « price to earnings »): say « built on profit multiples ».

## Image
- **style**: ALWAYS `breaking` (skill `breaking-chart`) with ONE chart of the text's lead number, never the NARRATIVE/REALITY multi-block frame (SuperCom, CareCloud and Enviri 2026-11-16 rounds 2 and 3 were still frames (headers "+25-77% opportunity", "+17-136%", "+1-75%"): type {"image":{ as the first characters; the answer's first characters are `{"image":{"style":"breaking","chart":"price"` and the title and note print the text's 24% or 36% gap, so a header "+25-77% opportunity" or an "EPS" title never appears). The answer's first key is `image`, written before `text` (SuperCom, CareCloud and Enviri 2026-11-16 round 1 were still drawn as 2-3 block frames with "+25-77% opportunity" headers and EPS titles because `image` was missing); for a BUY or SELL post it starts `{"image":{"style":"breaking","chart":"price"` and its title and note print the text's step-2 gap ("24% under fair value") (SuperCom Article, CareCloud, Lifeway and Enviri still arrived as multi-block frames in round 5 on 2026-11-13), never another style: news card when a news item is listed, else the big title (any other style prints the chartLabel as the heading, a label with no claim).
- **title**: ALWAYS set, the claim with its number and period, never a label and never the chartLabel (« Musashi profit rose to 2.9B yen in the Sep quarter »); a picture heading with no claim fails.
- **note**: the proof with its number on the point. An Article cover is ONE chart, never the three-block frame; its note prints the title's number with its unit, and the Article text uses that same number (Lifeway: title 7.6% margin, never "1.1M vs 6.3M" against $3.8M in the text).
