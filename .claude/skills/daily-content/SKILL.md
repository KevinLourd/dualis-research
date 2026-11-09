---
name: daily-content
description: The daily distribution loop for Dualis Research - 2 posts/day on Substack Notes + X, proposed to Thierry each morning, and the house style of a post (text tone + the Note/X chart image). Load when drafting daily posts, the morning suggestion message, changing the cadence, or touching the post text or its chart.
---

# Daily content loop

**Cadence**: 2 posts/day, each published on Substack Notes AND X (adapted per platform).

**Morning message to Thierry** (WhatsApp or equivalent): 2-4 drafts, each with source link + which watchlist ticker/driver it comes from. He approves, edits or skips. Nothing publishes without his OK.

**Where drafts come from** (priority order):
1. A signal (Thierry 2026-11-04): an indicator that a narrative is cracking / inflecting, as its chart + why, ready as a Note. Never post or comment in his name with generic AI text (he hates AI comments).
2. A chart or figure from a recent note.
3. A market-wide take tied to a thesis.

**Post shape = Multibagger Ideas** (@multibaggerideas: 42K readers, 515 paid, ~$1M/yr; Thierry 2026-11-09 « copy aspects of his posting »; Note TYPES below; the paragraph + chart shape is Thierry's)
- Substack Note = **one small paragraph + one chart** (Thierry 2026-11-06: « A note should be like a small paragraph with a chart »). The chart = the image below; an X post gets the 16:9 card.
- Four Note types he rotates: **maths fact** made visual (emoji bars « Lose 50% → need +100% », a table by decade) + one famous case (Buffett, Amazon -90%); **teaser** of a new post = a restack of it, company unnamed + 3 figures (« record revenue / stock down 56% »); **closed call** with its % (« Thesis Closed at +81% in 15 Months »); **milestone** as plain facts (views, readers, paid).
- X: « much smaller »: one or two sentences, at most 160 characters, the number first, the chart attached.
- An Idea can be a plain company update, not only an inflection (Thierry). The weekly article is HIS (« one a week, high quality »): drafts are Notes and posts, articles leave the proposals.
- **No Substack link or CTA in the text**: the bio carries the link (Kevin 2026-11-04); a teaser restacks the post, its card is the link.
- Every post grows the funnel: follower → free subscriber → paid subscriber.

## Text tone (Kevin 2026-11-09: « trop confus, pas assez straight to the point, pas assez alarmist »; `content-drafts/format.ts`)
- Breaking news: `🚨 <short name>: ` (« CareCloud », never « CareCloud Inc. » nor the ticker) then the alarm with its number.
- ONE claim: what just happened and why the price is wrong now; the single strongest fact, the rest dropped.
- Note = 2 or 3 short sentences, 150-300 characters: 1 the alarm + number, 2 why the market has it wrong, 3 (optional) what to watch. X = 1-2 sentences, ≤ 160 characters, `$TICKER` once after the opening.
- Plain words, subject verb object: « profit for shareholders », never « income available to common », EPS, preferred dividends.
- No hedge: never « in my view », « not proven yet », « it remains to be seen », a « but » walking the claim back. No em/en dash, no hashtag, no other emoji. Never a figure absent from the inputs.
```
🚨 CareCloud: profit for shareholders jumped 4x in Q3, to $4.7M. The price still bets it leaks to preferred holders. Watch the next quarter's payout.
```

## The Note / X chart image (`content-visuals`, Kevin 2026-11-09, round by round)
Read top to bottom it tells ONE story; one Claude call writes every word of it (`writeCallout`), never a headline, driver, exhibit or narrative title copied, no jargon, a number on one line only.
1. **BREAKING card** (when the post cites news): top left, big. Red stamp « BREAKING » with the time ago under it (« 2h ago »); the most prestigious source's logo + name (Reuters over a blog; Google favicon, $0); the news line REWRITTEN as the one fact that matters (34 px, up to 3 lines).
2. **Price card** pasted top right (white, turned 2°, shadow): 12-month price, fair value range as a green band, an arrow toward it saying the ticker's real Signal (« BUY signal », « SELL signal »; none = the gap), and in green « +N-M% opportunity » (whole % to the range's low and high, N < M, both > 0; above fair value « N-M% downside »). Never « Fair value X to Y ».
3. **Chart label**, small grey, just above the chart (« CareCloud: Profit left for shareholders, per quarter »). No headline when the BREAKING card is there (it repeated the news); without news the claim heads the chart, never prefixed « Look: » / « Signal: ».
4. **The chart**: the most striking Exhibit of the driver the post cites (price vs fair value only when the post is about price), white data on deep indigo. The price vs fair value chart keeps the same layout, with « SELL signal » + « 15-40% downside » top right instead of the pasted card (it would repeat the chart) and the fair value range shaded. ONE point in colour (green = a long driver's inflection, red = a short driver's crack), the others muted; room left above the bars.
5. **Arrow + note box** on that point: line 1 the fact with its number (« Four times last quarter »), line 2 « VS price narrative: "<what the price still assumes>" ». No « Driver broken » line.
6. Source line bottom left, Dualis mark bottom right.

Every change to this look bumps `VISUALS_VERSION` (all charts redraw) and is rendered and LOOKED at before merge (`.context/` probe on the render functions, real Claude output when the words change).

**Other references**: Kobeissi Letter, Unusual_Whales (speed), Citrini, Aurelion (depth). See `docs/references.md` (private).

Log every published post in `docs/daily-log.md` (date, platform, link, ticker).
