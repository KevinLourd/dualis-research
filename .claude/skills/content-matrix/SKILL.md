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
| Angle | signal, macro-24h, trending-format, competitor | `angle-signal`, `angle-macro-24h`, `angle-trending-format`, `angle-competitor` |

One post = the channel x tone skill (its format section) + the angle skill of that post. Balanced = today's house style (skills `x-post`, `daily-content`, `research-note`, `breaking-chart`); the urgent and neutral skills move ONLY the tone and keep every other rule.

## Rules every post keeps, whatever the tone
- English. Plain words: subject, verb, object. One idea per sentence. Never mention our internal notes, our searches (« three of our searches found the story » fails), our signal rating ("weak buy") or earlier gaps, and no sentence the reader must read twice.
- Never a figure absent from the inputs. Never a price target, upside % or horizon Claude made up (the fair value is ours and computed: it may be quoted).
- No em or en dash, no hashtag, no link in an X post (the bio carries it).
- No contrast template (« X, not Y », « not X but Y »): state the one fact.
- Never write the disclaimer: « Not investment advice. » is added after the writer.
- Never a person's private data, never Thierry's name or handle on a sandbox account.

## The picture (every post carries one, Kevin 2026-11-11)
**The frame of every account, urgent or not (Kevin 2026-11-12):** when the post's company has drivers reversing NOW, the picture is drawn from the analysis, never from `image`: the share price against its fair value and the opportunity, then ONE block per reversing driver (1-3, strongest first): « NARRATIVE: A » (what the market believes, struck through) against « REALITY: not A » (what is happening, with its number), its strength (« STRONG INFLECTION ») and its chart with the two compared periods boxed and an arrow carrying the change. The TEXT tells the same story in the account's tone: the narrative, then the driver(s) turning, with the number on its chart. The `image` below is drawn only when no driver of the company reverses.
The writer writes that fallback picture with the text, in the same answer (`image`), and each tone skill's **Image** section decides its look. The code only draws. A reader who sees ONLY the picture must get, in five seconds: which company, what is measured, over which period, and the post's conclusion.
- **chart**: the listed chart of the SAME measure and period as the text's lead number, for an Article the one in its title (a title on Q3 profit before loan losses gets the quarterly chart of that measure, never the yearly profit chart, never `price` under a title about profit; one title carries one measure, not a price fall plus a profit drop); a margin text gets the single-line chart of that ONE margin (never a two-line chart such as gross and operating margin: the reader cannot decode the colours), a profit text the profit chart; a two-line chart is never used for a margin text, even with its series named in chartLabel ("White gross, orange operating" and "Gross margin white, operating orange" both failed 2026-11-12): if the only chart listed for the margin holds two lines, lead the text with another number that has a single-line chart (profit, sales); if the margin has only a two-line chart listed, lead the text with a number that has a single-line chart; `price` only when the claim is about the share price itself, never as a stand-in for a rate, margin, debt or profit claim. If no chart is listed for the lead number (net debt, one-off gain), lead the text with a number that has a chart.
- **point**: the one value that proves it; the arrow hits it.
- **note** (on the arrow): the proof with its number, which IS the point's value as listed and the number the text leads with; always a figure with its unit ("Sales $44.0M, down 4.3% in a year": the period is the comparison, never just "in Q3"): a % change names its period ("Close $15.80, down 13% since Oct 30"); ONE measure, the chart's own, in the axis unit and rounding ("2.9B yen", not "2,947M yen"); 3 to 5 words, so the box stays narrow and covers neither line, bars nor the last value label. A text about a one-off or a mix must show it on the picture (title or note), or lead with the number the picture proves.
- **chartLabel**: what is measured, its unit and period, in plain words (« Profit per quarter, $ millions »); printed as « Company: chartLabel ». Keep it under 40 characters: only measure and unit, never the period words of a price chart ("last 12 months": the picture adds them, and a repeat gets cut with "..."), no fair value, no % above fair value. The note sits in the empty half of the chart, never over the line or its last value (last point high: note low; last point low: note high; a line crossing the whole chart: note in the corner away from it), and the arrow with the end value is always visible. A label that prints "..." was too long: shorten it.
- **priceSays**: what the share price still assumes, the belief the point contradicts; printed as « VS price narrative: "…" ».
- **title**: the post's conclusion in 4 to 9 words, with its period (« Solera fell 21% in a week »). Printed big ONLY in the `breaking` style without a news card; otherwise the note carries the conclusion.
- **newsLine** + **news**: the news fact in plain words WITH the figure of the chart's measure (« CareCloud operating margin hits 19.5%, its best quarter ever »), `breaking` style, when a news item is listed, its most prestigious publisher. A superlative or a gain with no figure fails.
- **One story**: the picture says the SAME conclusion as the text, with the same main number: the figure in the text's first sentence is printed on the picture (title, note or news line). No number on the picture that the text contradicts, none that the inputs lack.
- **Plain words** a retail investor reads at once, in the text AND on the picture (news card included): no EPS, adjusted EBITDA, EV/EBITDA, DCF, forward P/E, micro-cap, micro-company, net income, pre-provision income, price to book, book value, guide, cash floor, net cash floor, common shareholders, YoY, 8-K or other filing form names, 'below estimate' without the estimate's figure; say profit, profit before loan losses, profit per share, shareholders, a year earlier, the company's forecast. Every claim carries its figure ("most profitable quarter ever" needs the profit in $).
- An Article's picture is its cover: its single strongest proof.
- Each post has its own picture: never repeat the chart, point and words of another post of the day.

## The Sandbox (Business > Sandbox in the console, never published)
6 fake accounts: one X account and one Substack per tone (urgent Siren Small Caps, balanced Narrative Gap, neutral Ledger and Lens). Code: `web/src/collectors/dimensions/sandbox-posts/` reads THESE files at run time; a skill edit changes the next day's posts, never a past day (the skills' hash is stored on each post). Skill `image-correction` looks at each drawn picture and corrects its spec until clean (3 passes); skill `content-review` then reads each day's posts with their pictures; a failing post makes it edit these skills and the day is written again (3 rounds max).

### Daily mix per account (5 posts)
| Slot (Astana) | Angle | Input |
|---|---|---|
| 08:00 | signal | the day's best Idea |
| 11:00 | macro-24h | the top macro headline of the last 24 h |
| 14:00 | signal | the day's second Idea |
| 17:00 | trending-format | a format that performs now, applied to the third Idea |
| 20:00 | competitor | a reference publication's pattern, applied to the fourth Idea |

4 short posts (X post or Note) + 1 Article. The Article's angle rotates by day (signal, macro-24h, trending-format, competitor). Every account of a channel writes the same inputs in the same formats: only the tone differs, so Thierry compares tones with everything else equal.
