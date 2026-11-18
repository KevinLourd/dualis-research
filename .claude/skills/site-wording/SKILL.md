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
| Investment Process (was Company) | `app/investment-process/page.tsx` | hero title + line, statement, `PILLARS` (3 columns), `LOOK_FOR` (4 carousel cards), `SETUPS` (2 panels), the two lines beside the figures, the quote, closing band |
| Research | `app/research/page.tsx` | page line, section titles, closing band |
| Research, four kinds of research | `lib/model.ts` `CATEGORIES` | title and text of Deep Dives, Primers, Updates, Other (also the portal's tabs) |
| Research, FAQ | `components/blocks.tsx` `FAQ` | questions and answers |
| Team | `app/team/page.tsx` | his name, role, bio paragraphs |
| Team, career | `components/blocks.tsx` `CAREER` | dates, firms, roles |
| Contact | `app/contact/page.tsx` | `TOPICS`, lines, link labels |
| Poker line of Team, Contact, Subscribe | `lib/winnable.ts` `WINNABLE` | one short line per page (none on Home, Research, Company) |
| Plans and prices | `lib/model.ts` `PLANS`, `app/subscribe/page.tsx` | |
| Track record figures | `lib/model.ts` `TRACK_RECORD`, `BEST_CALLS` | only figures he published |
| Footer | `components/chrome.tsx` | brand line, link labels |
| Legal | `lib/legal.ts`, `app/disclaimer/page.tsx` | Terms, Privacy, Disclaimer |

Not found in this table: search the words he quotes (connector `find_site_text`, or `grep -rn "<his words>" site/src` in the repo).

## Rules (a test fails the change otherwise)
- English. Short sentences. No em dash or en dash.
- His name (Thierry, Matin) appears on Team and the legal pages only; everywhere else the site speaks as « we » / Dualis Research.
- Never: Duality, fund manager, « own capital », where he lives, the number of names he holds, « X, never Y » sentences, « coming soon ».
- Change only what he ## Publish each approved change at once
A change Thierry approved is live on the site within minutes. Never leave it in the chat or in a local file: if it is
not on GitHub main, it does not exist.

**Claude Desktop (Thierry), through the Dualis Research connector:**
1. `find_site_text` with a few of his words, then `read_file` on the file it names, to copy the exact current text.
2. Show him each line before -> after.
3. On his OK, call `edit_files` at once: one edit per line (`find` = the exact current text, appearing once in the file;
   `replace` = the new words), a one-line English `summary`. Change only the words, never the code or quotes around them.
4. Call `change_status` with the id it returns until it says live (1-2 minutes for the checks and the commit), then give
   him the commit link: the site redeploys by itself (about 3 more minutes) at https://dualisresearch.com
   (preview login: user `dualis`, the password Kevin gave him).
5. Refused (a rule above, or the text changed on main): read the reason, fix the edit, call `edit_files` again.
Connector missing in this chat: ask him to turn it on (chat "+" menu > Connectors), or to add it once: Settings >
Connectors > Add custom connector, name `Dualis Research`, URL `https://console.dualisresearch.com/mcp`, Connect, sign
in to the console, Allow.

**Claude Code (Kevin, in the repo):** branch from `main`, edit, `cd site && pnpm test && pnpm typecheck`, open a PR to
`main` with each line before -> after, merge once green; the site redeploys by itself.
