---
name: audience
description: Who Dualis Research writes for, the November goal (1K followers), the top 3 borrowed acquisition channels and the tools to find the top accounts in each. Load before writing any post, note, outreach message or growth plan.
---

# Audience and acquisition

## Goal (Kevin 2026-11-04)
**+1K Substack subscribers by 2026-11-30 on top of the current count** (Kevin 2026-11-04: Substack subs, not X followers; free subs feed paid = the MRR metric). Start 153 on Thierry's Analysis Paralysis (Kevin 2026-11-04; public API said 151, it lags the dashboard) → target **1,153**, ~40 net new per day. Lever: borrow audiences that already exist (other writers cite, recommend or host us).

## Target audience (derived from Thierry's coverage, `data/watchlist.json`)
His 37 tickers: micro and small caps (mostly under US$2B, many under US$300M), special situations and deep value (Icahn read-through on MNRO, turnarounds, holding companies), 8 markets: US ~60 %, then Canada, Japan, Korea, UK, Hong Kong, Australia, France, Germany.

**Primary reader (buys the paid tier)**: self-directed, experienced small-cap investor.
- Ex-finance or professional who manages his own money (roughly US$250K to US$5M), reads 10-Ks and filings, holds 10-30 names.
- Hunts ideas the big funds cannot buy: illiquid, under-covered, outside the US.
- Already pays US$200-2,000/yr for idea newsletters; reads Value Investors Club, MicroCapClub, Substack value writers; listens to Yet Another Value Podcast; on FinTwit.
- Mostly US, UK, Canada, plus Asia-based English readers. Ages 30-60.

**Secondary (pays the most per seat)**: small fund PMs, family-office and emerging-manager analysts who need idea flow.

**Our edge for them**: Thierry's "play winnable games" (2026-11-04): English coverage of Japan, Korea, Canada and Europe small caps with filings read at source (TDnet, DART, EDINET...), and the narrative-vs-fundamental read (long when a beaten-down story inflects, short when a hyped one cracks). Few writers cover this; it is the hook. **Aligned incentives** (Thierry 2026-11-09): he invests his own capital in every call and publishes his own record, research for buy-side investors, never written for the companies.

**Proof the model pays**: Multibagger Ideas (@multibaggerideas), small caps nobody covers, 0 to 42K readers and 515 paid in 20 months (~$1M/yr, Thierry 2026-11-09); copy his posting (`daily-content`), too big to ask for a swap now.

**Not our reader**: beginners, options/crypto/day traders, macro-headline followers. Kobeissi / Unusual_Whales style reach brings followers who never pay; use their format, not their audience.

## Top 3 borrowed channels (ranked by paid-subscriber yield)
1. **Substack network**: recommendations, restacks, guest posts and cross-posts from small-cap / special-situation / Japan-Korea value Substacks. Substack says its network drives ~40 % of new subscriptions; recommendations are the biggest part.
2. **Value-investing podcasts**: Thierry as a guest pitching one idea from the watchlist (each guest spot ends with "find me on Substack").
3. **FinTwit small-cap amplifiers on X**: accounts that quote or repost a chart-first thread on a ticker they already follow.

**How to ask (give first, never "please cite us")**: a new Substack has nothing to trade, so we bring finished work they can publish.
1. Before any ask: Dualis Substack live with 2-3 strong notes (one Japan/Korea name), Thierry comments and restacks the target's posts for a few days.
2. Easiest yes first: formats built on outside contributions (idea submissions, curated roundups, interviews, podcast guests). Then guest posts (Substack co-byline: their readers can subscribe to Thierry). Mutual recommendations last, once we have a few hundred subscribers.
3. The ask = one short DM or email from Thierry, his voice: one line on who he is, the specific piece (ticker, why their readers care), ready to send. One follow-up after 4 days, then stop.
4. **Every sentence is TRUE and sourced from his posts or the target's public page. Never invent that Thierry read, liked, follows or uses something** (Kevin 2026-11-04, caps: « on n'a pas besoin de mentir pour avoir de la distribution »; the first Substack drafts opened on « Glad to see you back », « I read your roundups », « Big fan »). Open on who he is and why THIS audience, never on flattery; Thierry adds a personal line himself if he has one.
5. **Short and organic** (Thierry 2026-11-04): who he is in one line, his two best calls (Miraial long, Quantum Corp short, both above 40%), one specific ask, done. No pitch paragraph.
7. **Only Substacks UNDER 1,000 subscribers for now** (Thierry 2026-11-05: « I ment 1k », his 11-04 « under 10000 » was a typo; « The big ones won't accept any exchange of value », « if I reach out to 100 small guys its way higher value »); bigger ones once he has 1K. The ask = **sub for sub + recommendation for recommendation**, maybe a write-up collab. The idea he offers = his one open trade, **Water Oasis** (« an overlooked Asian name »). The ask = a swap: share a piece of each other's content, Substack recommendations, or a write-up collab (`docs/thierry-whatsapp.md`).
8. **Batches of 100, sent by his Claude Desktop** (Kevin 2026-11-07: list 2 gave ~+10 subs in 3 days, x10 needed): one email with a CSV (message prefilled per writer) + the `substack-dm-outreach` skill (checks DM history first, 10-15 s between sends; Substack publishes no DM cap, never invent one); his Claude replies with a report CSV → append to `data/growth/outreach-log.json`. Files: private `docs/dm-list-3/`.
6. A message Thierry sends = exact text to paste + the one link to click (DM compose with text prefilled when the platform allows) + which account (his personal one).

## Tools to find the top 10 accounts per channel ($0 first)
| Channel | Find candidates | Rank / qualify |
|---|---|---|
| Substack | Recommendations graph crawled from seeds (done 2026-11-04, result in `docs/acquisition-targets.md`). Free, keyless, unofficial JSON, verified: seed id = `https://<host>/api/v1/archive?limit=1` → `publication_id`; full list = `substack.com/api/v1/recommendations/from/<id>`; audience = `substack.com/api/v1/user/<author handle>/public_profile` → `subscriberCountNumber`; Substack search (`substack.com/search`) for each watchlist ticker; directories sidestack.io, reletter.com, Substack Finance leaderboard | Subscriber badge ("X+ subscribers") shown on profiles and directories; number of our tickers they wrote about; posting in the last 30 days. Apify Substack actors (recommendations mode) if scripting, free credit only |
| Podcasts | Podcast Index API (free, open), iTunes Search API (free, no key), Listen Notes API (free tier) | Listen Notes score, episode cadence, guests similar to Thierry (independent small-cap writers) |
| X | X advanced search on our cashtags (`$NVRI min_faves:20`), FinTwit lists of the seed accounts | Followers, replies per post, share of small-cap posts. X API free tier cannot search; paid scrapers (SocialData, Apify) break the $0 rule, ask Kevin first |

Store each candidate with: channel, handle/URL, audience size, tickers in common, last post date, contact route, status (to contact / contacted / replied / cited).
