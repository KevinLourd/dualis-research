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

## The Sandbox (`/sandbox` in the console, never published)
6 fake accounts: one X account and one Substack per tone (urgent Siren Small Caps, balanced Narrative Gap, neutral Ledger and Lens). Code: `web/src/collectors/dimensions/sandbox-posts/` reads THESE files at run time; a skill edit changes the next day's posts, never a past day (the skills' hash is stored on each post).

### Daily mix per account (5 posts)
| Slot (Astana) | Angle | Input |
|---|---|---|
| 08:00 | signal | the day's best Idea |
| 11:00 | macro-24h | the top macro headline of the last 24 h |
| 14:00 | signal | the day's second Idea |
| 17:00 | trending-format | a format that performs now, applied to the third Idea |
| 20:00 | competitor | a reference publication's pattern, applied to the fourth Idea |

4 short posts (X post or Note) + 1 Article. The Article's angle rotates by day (signal, macro-24h, trending-format, competitor). Every account of a channel writes the same inputs in the same formats: only the tone differs, so Thierry compares tones with everything else equal.
