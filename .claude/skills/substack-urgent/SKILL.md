---
name: substack-urgent
description: Substack in the URGENT tone - breaking-news Note and Article, one shock number. Sandbox only for now (sirensmallcaps.substack.com). Load to write or judge an urgent Substack Note or Article.
---

# Substack, urgent tone

Breaking-news alarm on Substack. Viral Notes rarely convert to paid readers, so judge this tone by signups, never by likes (https://escapethecubicle.substack.com/p/substack-changed-their-algorithm). Every house rule stays (skill `content-matrix`).

## Note
- **Signal post (BUY or SELL)**: the 3 spaced lines of skill `angle-signal` instead, at most 400 characters, never 🚨. Example: « 📈 SuperCom $SPCB: the market still prices a shrinking business. » / « Q3 revenue $7.5M, up 21% from $6.2M a year earlier. » / « A shrinking business does not grow sales 21%. » / « Source: Dualis Research (analysisparalysis888.substack.com) », a blank line between.
- **Length** (a post with no BUY or SELL): under 200 characters when possible (the length that breaks out most: https://eden.so/blog/how-to-grow-on-substack-notes/), 300 at most, no line breaks.
- **Hook** (a post with no BUY or SELL only): `🚨 BREAKING: <short name>` then ONE shock number.
- **Structure**: shock number, then one line of urgency. ONE idea only: the urgency line adds no second figure or measure, even without a number (no price, no « profit dropped »); it says only what the shock number means for a holder, no « Here is what happened: » filler.
- **Allowed**: one word in CAPS, one exclamation mark.
- **Visual**: see Image below.
- Example (a plain company update only):
```
🚨 BREAKING: CareCloud just QUADRUPLED profit for shareholders to $4.7M. The market is asleep on this one!
```
- Don't: invent stakes, promise a gain, a hashtag, a second emoji.

## Article
- **Length**: 700 to 1100 words, short paragraphs.
- **Title**: `BREAKING:` + the shock number (« BREAKING: CareCloud Quadrupled Shareholder Profit »). Subtitle: one line on the title's one measure with the same number as the cover note; no share price, no second measure, never « Here is what happened. », never our signal rating.
- **Structure** (`##` headings): `## The number`, `## Why the market missed it`, `## What happens next`, `## The risk`.
- **Visual**: see Image below.
- Do: bold the one figure of each section; the whole Article argues the line-2 figure, other measures only in The risk; plain words (never « enterprise value », « operating profit before depreciation », « price to earnings », « dilutes », « cash from operations »: say « cash the business made » or « spent »).
- Don't: drop the risk section; fake scarcity.

## Image
- **style**: `breaking` (skill `breaking-chart`), ONE chart, for every Note and Article: the chart of the text's lead figure (a margin text: the single margin chart); a BUY or SELL post: its line-2 figure, `from` = the compared period (content-matrix « The picture »).
- **title**: the alarm with its number, one word in CAPS allowed.
- **newsLine**: the triggering fact when a news item is listed.
- **note**: the shock number on its point, in the chart's own unit, digit for digit as the text's lead number.
