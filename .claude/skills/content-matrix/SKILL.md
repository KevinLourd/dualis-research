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
- English. Plain words: subject, verb, object. One idea per sentence.
- Never a figure absent from the inputs. Never a price target, upside % or horizon Claude made up (the fair value is ours and computed: it may be quoted).
- No em or en dash, no hashtag, no link in an X post (the bio carries it).
- No contrast template (« X, not Y », « not X but Y »): state the one fact.
- Never write the disclaimer: « Not investment advice. » is added after the writer.
- Never a person's private data, never Thierry's name or handle on a sandbox account.

## The picture (every post carries one, Kevin 2026-11-11)
The writer writes the picture with the text, in the same answer (`image`), and each tone skill's **Image** section decides its look. The code only draws. A reader who sees ONLY the picture must get, in five seconds: which company, what is measured, over which period, and the post's conclusion.
- **chart**: the listed chart that PROVES the post's claim (an Exhibit when the claim is about the business; `price` only when the claim is about the share price).
- **point**: the one value that proves it; the arrow hits it.
- **note** (on the arrow): the proof with its number, which IS the point's value as listed; 3 to 7 words.
- **chartLabel**: what is measured, its unit and period, in plain words (« Profit per quarter, $ millions »); printed as « Company: chartLabel ».
- **priceSays**: what the share price still assumes, the belief the point contradicts; printed as « VS price narrative: "…" ».
- **title**: the post's conclusion in 4 to 9 words. Printed big ONLY in the `breaking` style without a news card; otherwise the note carries the conclusion.
- **newsLine** + **news**: the news fact in plain words (`breaking` style, when a news item is listed), its most prestigious publisher.
- **One story**: the picture says the SAME conclusion as the text, with the same main number. No number on the picture that the text contradicts, none that the inputs lack.
- **Plain words** a retail investor reads at once: no EPS, net income, common shareholders, YoY; say profit, profit per share, shareholders, a year earlier.
- An Article's picture is its cover: its single strongest proof.
- Each post has its own picture: never repeat the chart, point and words of another post of the day.

## The Sandbox (Business > Sandbox in the console, never published)
6 fake accounts: one X account and one Substack per tone (urgent Siren Small Caps, balanced Narrative Gap, neutral Ledger and Lens). Code: `web/src/collectors/dimensions/sandbox-posts/` reads THESE files at run time; a skill edit changes the next day's posts, never a past day (the skills' hash is stored on each post). Skill `content-review` then reads each day's posts with their pictures; a failing post makes it edit these skills and the day is written again (3 rounds max).

### Daily mix per account (5 posts)
| Slot (Astana) | Angle | Input |
|---|---|---|
| 08:00 | signal | the day's best Idea |
| 11:00 | macro-24h | the top macro headline of the last 24 h |
| 14:00 | signal | the day's second Idea |
| 17:00 | trending-format | a format that performs now, applied to the third Idea |
| 20:00 | competitor | a reference publication's pattern, applied to the fourth Idea |

4 short posts (X post or Note) + 1 Article. The Article's angle rotates by day (signal, macro-24h, trending-format, competitor). Every account of a channel writes the same inputs in the same formats: only the tone differs, so Thierry compares tones with everything else equal.
