---
name: content-matrix
description: Index of how a Dualis Research post is built - the 4 axes (channel, tone, format, angle), which skill files make one post, the daily mix of the Sandbox, and where it lives. Load before writing, changing or judging any X post, X Article, Substack Note or Substack Article, or the Sandbox writer.
---

# Content matrix (Kevin 2026-11-11)

A post = **channel x tone x format x angle**. Each axis has its skill; the writer reads them as they are written here.

| Axis | Values | Skill |
|---|---|---|
| Channel | X, Substack | the channel x tone skill |
| Tone | urgent, balanced, neutral | `x-urgent`, `x-balanced`, `x-neutral`, `substack-urgent`, `substack-balanced`, `substack-neutral` |
| Format | X post, X Article (X); Note, Article (Substack) | a section of the channel x tone skill |
| Angle | signal only (Kevin 2026-11-13: « on va se focus sur nos signaux ») | `angle-signal` |

One post = the channel x tone skill (its format section) + the angle skill of that post. Balanced = today's house style (skills `x-post`, `daily-content`, `research-note`, `breaking-chart`); the urgent and neutral skills move ONLY the tone and keep every other rule.

## Rules every post keeps, whatever the tone
- A signal post (BUY or SELL) follows the 5-step skeleton of `angle-signal` (type, size, trigger + date, rationale per driver with dates, conclusion), one step per line; it overrides each tone's length and « one measure » rules (Kevin 2026-11-13).
- English. Plain words: subject, verb, object. One idea per sentence. Never mention our internal notes, our searches (« three of our searches found the story » fails), our signal rating ("weak buy") or earlier gaps, and no sentence the reader must read twice.
- Never a figure absent from the inputs. Never a price target, upside % or horizon Claude made up (the fair value is ours and computed: it may be quoted).
- No em or en dash, no hashtag, no link in an X post (the bio carries it).
- No contrast template (« X, not Y », « not X but Y »): state the one fact.
- Never write the disclaimer: « Not investment advice. » is added after the writer.
- Never a person's private data, never Thierry's name or handle on a sandbox account.
- The Sandbox accounts are marketing partners of Dualis Research, never Dualis itself (Thierry 2026-11-12): their bio says « Partnered with Dualis Research. ». A post built on a Dualis signal names its source in its last line, « Source: Dualis Research »; a Substack Note or Article links it to analysisparalysis888.substack.com, an X post carries no link (the bio does).

## The picture (every post carries one, Kevin 2026-11-11)
Every post of the answer carries its `image`, Article included: a post without one is not drawn. Each tone skill's **Image** section decides its look; the code only draws. A reader who sees ONLY the picture gets, in five seconds: which company, what is measured, over which period, and the post's conclusion.
- **A BUY or SELL post**: style `breaking`, chart `price`, title « <Company> trades N% under fair value » (« above » for a SELL), note « N% under fair value », N = the text's step-2 gap digit for digit. Result figures (sales, debt, profit) stay in the text; the picture holds no card, range header (« +25-77% opportunity ») or profit-per-share title.
- **The opportunity frame (Kevin 2026-11-12)**: when the company has drivers reversing now, the code draws the frame from the analysis instead of `image` (price vs fair value and its range, then one NARRATIVE / REALITY block per reversing driver). The writer cannot change that picture and still writes `image`.
- **chart** (a post with no BUY or SELL): the listed chart of the SAME measure and period as the text's lead number, for an Article the number in its title; one title carries one measure. A margin takes the single-line chart of that one margin, never a two-line chart (the reader cannot decode the colours): with only a two-line chart listed, lead with another number that has a single-line chart. `price` only for a claim about the share price itself. No chart listed for the lead number (net debt, a one-off gain): lead with a number that has one.
- **point**: the one value that proves it; the arrow hits it. The chart shows distinct consecutive quarters or years, no gap and no repeated value, every label a period end; else take another chart or lead with another number.
- **note** (on the arrow): the point's value as listed, the number the text leads with, with its unit and its comparison period (« Sales $44.0M, down 4.3% in a year », « Close $15.80, down 13% since Oct 30 »); one measure, in the axis unit and rounding (« 2.9B yen »); 3 to 5 words. It sits in the empty half of the chart, never over the line, the bars or the last value.
- **chartLabel**: measure and unit in plain words, under 40 characters (« Profit per quarter, $ millions »), printed as « Company: chartLabel »; no period words on a price chart, no fair value. A label printed with "..." was too long.
- **priceSays**: the belief the point contradicts, with the figure the text also states; under a `price` chart only the text's gap sentence (close vs fair value). Printed as « VS price narrative: "…" ».
- **title**: the conclusion in 4 to 9 words with its period (« Solera fell 21% in a week »). Printed big only in the `breaking` style without a news card.
- **newsLine** + **news**: when a news item is listed, the fact with the figure of the chart's measure (« CareCloud operating margin hits 19.5%, its best quarter ever »), from its most prestigious publisher. A superlative with no figure fails.
- **One story**: the picture prints only numbers the text states, in the same unit and rounding, and the text's lead number (the step-2 gap for a signal post) is on it. Nothing the inputs lack.
- **Plain words** a retail investor reads at once, in the text AND on the picture (chart titles and news card included): no EPS, free cash flow, dilution, net debt, EBITDA, EV/EBITDA, DCF, forward P/E, micro-cap, net income, net profit, operating profit before depreciation, enterprise value, price to earnings, pre-provision income, price to book, book value, guide, cash floor, common shareholders, YoY, filing form names (8-K). Say profit, profit per share, profit for shareholders, profit before loan losses, operating profit, cash left after investments, borrowings minus cash, more shares sold, a year earlier, the company's forecast. A comparison with analysts prints the estimate's own figure. Every claim carries its figure (« most profitable quarter ever » needs the profit in $).
- An Article's picture is its cover: ONE chart whose note prints the title's number; title, subtitle and cover hold that one measure.
- Each post has its own picture: never the chart, point and words of another post of the day.

## The Sandbox (Business > Sandbox in the console, never published)
6 fake accounts: one X account and one Substack per tone (urgent Siren Small Caps, balanced Narrative Gap, neutral Ledger and Lens). Code: `web/src/collectors/dimensions/sandbox-posts/` reads THESE files at run time; a merged skill edit rewrites today's reviewed posts as the next round (6 max), never a past day (the skills' hash is stored on each post). Skill `image-correction` looks at each drawn picture and corrects its spec until clean (3 passes); skill `content-review` then reads each day's posts with their pictures; a failing post makes it edit these skills (replacing a rule, never appending its history) and the day is written again (3 rounds max).

### Daily mix per account (5 posts)
Every slot (08:00, 11:00, 14:00, 17:00, 20:00 Astana) is a signal post on the next of the day's best Ideas, one Idea per slot (fewer Ideas = fewer posts).

4 short posts (X post or Note) + 1 Article, the Article on the day's best Idea. Every account of a channel writes the same inputs in the same formats: only the tone differs, so Thierry compares tones with everything else equal.
