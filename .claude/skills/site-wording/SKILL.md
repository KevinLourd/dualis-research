---
name: site-wording
description: Change the words on the Dualis Research website (dualisresearch.com) for Thierry - page titles, lines, cards, his bio, FAQ, plans, footer, legal. Load whenever Thierry asks to edit, rewrite, shorten or fix any text on the site.
---

# Editing the website's words

Thierry owns the site's wording since 2026-11-09. You change TEXT only: the words inside quotes or between tags. Layout, colours, images, new sections or removed blocks are Kevin's job: tell Thierry to ask Kevin.

## Where each text lives (all under `site/src/`)
| Page | File | What |
|---|---|---|
| Home | `app/page.tsx` | title, line under it, link |
| Company | `app/company/page.tsx` | hero title + line, statement, `PILLARS` (3 columns), `LOOK_FOR` (4 cards), the quote, closing band |
| Research | `app/research/page.tsx` | page line, section titles, closing band |
| Research, winnable games | `components/blocks.tsx` `FRAMEWORK` | the 5 games on the knot (the 3rd sits on its centre) |
| Research, FAQ | `components/blocks.tsx` `FAQ` | questions and answers |
| About | `app/about/page.tsx` | his name, role, bio paragraphs |
| About, career | `components/blocks.tsx` `CAREER` | dates, firms, roles |
| Contact | `app/contact/page.tsx` | `TOPICS`, lines, link labels |
| Poker line of each page | `lib/winnable.ts` `WINNABLE` | one short line per page |
| Plans and prices | `lib/model.ts` `PLANS`, `app/subscribe/page.tsx` | |
| Track record figures | `lib/model.ts` `TRACK_RECORD`, `BEST_CALLS` | only figures he published |
| Footer | `components/chrome.tsx` | brand line, link labels |
| Legal | `lib/legal.ts`, `app/disclaimer/page.tsx` | Terms, Privacy, Disclaimer |

Not found in this table: search the words he quotes (`grep -rn "<his words>" site/src`).

## Rules (a test fails the change otherwise)
- English. Short sentences. No em dash or en dash.
- His name (Thierry, Matin) appears on About and the legal pages only; everywhere else the site speaks as « we » / Dualis Research.
- Never: Duality, fund manager, « own capital », where he lives, the number of names he holds, « X, never Y » sentences, « coming soon ».
- Change only what he asked. Show him each line before → after.

## How to ship (about 5 minutes)
1. Branch from `main`.
2. Edit the text.
3. Check: `cd site && pnpm install && pnpm test && pnpm typecheck`. Fix any failure before going on.
4. Open a pull request to `main`, titled with what changed, body = each line before → after.
5. Once its checks are green, merge it (squash).
6. The site redeploys by itself in about 3 minutes: https://dualisresearch.com (preview login: user `dualis`, the password Kevin gave him).
7. Tell Thierry it is live and paste the before → after lines.
