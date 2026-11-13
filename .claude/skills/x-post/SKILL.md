---
name: x-post
description: An X post of Dualis Research (for @quantum_macro), text AND chart. The BREAKING spirit lives in the text; the chart is professional, sell-side quality, with one highlighted point and its arrow, no news card and no price card. Load before drafting an X post, its image, or changing either. Substack Notes use skill breaking-chart.
---

# X post (Kevin 2026-11-10)

« Moins EMERGENCY et click bait, more a professional graph, while keeping the highlight and the arrow on the graph; the two white callouts are removed. We keep the BREAKING spirit but in the text of the X posts. »

## The text = the breaking news
- Opens `🚨 <short name>: ` (« CareCloud », never « CareCloud Inc. »), then the fact with its number, `$TICKER` once after the opening.
- **Signal post (BUY or SELL)**: the 5 lines of skill `angle-signal` instead, spaced, at most 250 characters on X, 600 on a Note.
- 1 or 2 sentences, at most 160 characters: the fact, then why the price has it wrong. Nothing else.
- Plain words, no hedge, no hashtag, no other emoji, no em/en dash, no link (the bio carries it). Never a figure absent from the inputs.
- What the image no longer says, the text says: the news (with its source when it is a big name: « per Reuters ») and the signal when one is live (« Shares 28% under fair value »).
```
🚨 CareCloud $CCLD: profit for shareholders jumped 4x in Q3, to $4.7M. Shares still price it as leaking to preferred holders.
```

## The image = a professional chart
What a sell-side exhibit looks like: calm, exact, readable in two seconds on a phone.
- **Kept from the BREAKING chart** (skill `breaking-chart`): the chart choice (the most striking Exhibit of the driver the post cites, price vs fair value only when the post is about price), white data on deep indigo (`chart.themes.dark`), ONE point in colour (green = a long driver's inflection, red = a short driver's crack) with its **arrow and note box** (the fact with its number = the value of the point it hits; « VS price narrative: "..." » line kept), the note never hides the data, month axis « Sep-25 », source bottom left, Dualis mark small bottom right.
- **Removed**: the white BREAKING news card and the white pasted price card. Nothing tilted, no stamp, no shadowed cut-out.
- **Title** top left = what the chart shows, factual, sentence case, no alarm word and no prefix (« CareCloud: profit left for shareholders, per quarter »); one small grey subtitle (period, unit; on price charts the gap and fair value: « Last 12 months · 28% below fair value 3.21 USD »).
- The chart takes the space the two cards held: full width under the title.
- Words: the same one Claude call as the BREAKING chart writes the title, label and note as one story; the text of the post carries the alarm, the image the proof.

Code: visual kind `x-chart` (`content-visuals`, `style: "pro"` in `render.ts`), sent with the daily X post (`content/post-image.ts`); X text rules in `content-drafts/format.ts` (`drafts-v8`). Every change to this look bumps `VISUALS_VERSION` and is rendered and LOOKED at before merge (`.context/` probe, real data).
