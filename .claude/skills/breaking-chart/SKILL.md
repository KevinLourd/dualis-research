---
name: breaking-chart
description: The BREAKING chart image of Dualis Research (Substack Notes), the alarm look Kevin approved round by round on 2026-11-09 - BREAKING news card, pasted price card with the Signal and the opportunity, one coloured point with arrow and note. Load before touching that image (content-visuals render, its words, VISUALS_VERSION). X posts use the sober chart of skill x-post instead.
---

# BREAKING chart (Substack Notes)

Kevin 2026-11-10: « c'est excellent, garde ça pour une skill dédiée ». Frozen look; X posts take the professional variant (skill `x-post`).
Read top to bottom it tells ONE story; one Claude call writes every word of it (`writeCallout`), never a headline, driver, exhibit or narrative title copied, no jargon, a number on one line only.
1. **BREAKING card** (when the post cites news): top left, big. Red stamp « BREAKING » with the time ago under it (« 2h ago »); the most prestigious source's logo + name (Reuters over a blog; Google favicon, $0); the news line REWRITTEN as the one fact that matters (34 px, up to 3 lines).
2. **Price card** pasted top right (white, turned 2°, shadow): 12-month price, fair value range as a green band, an arrow toward it saying the ticker's real Signal (« BUY signal », « SELL signal »; none = the gap), and in green « +N-M% opportunity » (whole % to the range's low and high, N < M, both > 0; above fair value « N-M% downside »). Never « Fair value X to Y ».
3. **Chart label**, small grey, just above the chart (« CareCloud: Profit left for shareholders, per quarter »). No headline when the BREAKING card is there (it repeated the news); without news the claim heads the chart, never prefixed « Look: » / « Signal: ».
4. **The chart**: the most striking Exhibit of the driver the post cites (price vs fair value only when the post is about price), white data on deep indigo. **The price vs fair value chart copies this layout exactly, pasted price card included** (Kevin 2026-11-09: « tu ne respectes pas du tout » when the card was swapped for a signal stamp), fair value range shaded; month axis « Sep-25 », one month per tick. **The note's number = the value of the point its arrow hits** (the price line offers its latest close = the end label, 12-month high and low; never a number the line does not show), and the note never hides the line (Kevin 2026-11-09: « la flèche ne pointe pas au bon endroit, le chiffre final ne correspond pas à ton encart »). ONE point in colour (green = a long driver's inflection, red = a short driver's crack), the others muted; room left above the bars.
5. **Arrow + note box** on that point: line 1 the fact with its number (« Four times last quarter »), line 2 « VS price narrative: "<what the price still assumes>" ». No « Driver broken » line.
6. Source line bottom left, Dualis mark bottom right.

Every change to this look bumps `VISUALS_VERSION` (all charts redraw) and is rendered and LOOKED at before merge (`.context/` probe on the render functions, real Claude output when the words change).

