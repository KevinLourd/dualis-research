---
name: angle-macro-24h
description: The MACRO-24H angle of a Dualis post - a macro or market headline of the last 24 hours, tied to one of our covered tickers. Load to write or judge a post reacting to macro news.
---

# Angle: macro-24h (newsjacking)

React while the story breaks: add our angle in the first hours, the window closes around 24 h (David Meerman Scott's newsjacking, https://openviewpartners.com/blog/newsjacking-dos-and-donts/, https://www.buzzstream.com/blog/newsjacking/). Scheduled events (CPI, central bank meetings, earnings) are known ahead: be ready for them (https://www.contentgrip.com/newsjacking/).

## Where the input comes from
- `gold.macro_news` (dimension `macro-news`): Google News RSS searches on markets, rates, inflation, central banks, oil, tariffs, small caps, Japan, Korea; one item per article with every query that found it, last 24 h. Free, no key.
- Our tickers' own headlines of the last 24 h (`gold.news_items`, dimension `news`) and their narratives, so the post ties the macro story to a name we cover.
- Sandbox: slot 11:00; the input = the headline found by the most searches, newest first.

## How to write it
- Open on the headline's fact (with its source when it is a big name: « per Reuters »).
- Then the tie: which covered company it moves and how (rates and a leveraged balance sheet, oil and a shipper's costs, yen and an exporter).
- Always tie it to ONE covered company, the most exposed one (the writer names its ticker), and state the exposure with a listed number (debt, interest cost, share of sales); FIRST check that this exposure has a listed chart (none = another company), because title, text and cover all sit on that chart and a price chart never covers a macro Article; the chart is the listed chart of that exposure itself (debt, interest cost, cash), never the share price (a post whose picture is the price chart fails, and so does a title or picture heading that pairs the headline's yield with a share price fall or a fair value gap (« 10-Year Yield Tops 5%. CareCloud Trades 32% Under Fair Value » over a price chart failed 2026-11-12): it carries the one exposure number, e.g. « 10-Year Yield Tops 5%. CareCloud Net Debt Hit $38.2M »), an Article cover included: the exposure number in its title (net debt) gets that exposure's chart, and if none is listed, pick another company, the text leads with the exposure number ($38.2M net debt) and not the macro figure, the note prints that one number with its unit ("Debt $38.2M, up from $1.2M"), and the text leads with that same number; priceSays is the belief about that exposure ("Debt costs will stay low"), never a profit claim. HARD STOP: if the exposure number has no listed chart, or the only picture you could draw is `price`, do not write a macro Article on that company: pick another covered company whose exposure (debt, interest cost, cash) has a listed chart BEFORE writing the title, give the exposure a figure with its unit in the text ("net debt $38.2M", never "debt has risen"), and never write "searches" or "profit per share" in the Article; a macro Article's cover is NEVER the price chart, so its title never says 'Trades X% Under Fair Value' and its text never mentions our searches; and before answering read the cover's chartLabel: if it says "Share price", the Article is not done, change company and rewrite title, text and note on the exposure chart; if the cover's chartLabel would read "Share price", the title, the text's lead number and priceSays cannot be about debt or a rate (a net debt title over a "Share price" cover failed 2026-11-12, again in round 2). A title or text naming debt over a price chart fails, and so does an Article title about a share price jump (« CareCloud Shares Jumped 51% ») over a yield and debt text: the title carries the exposure number and the cover is that exposure's chart, and an Article keeps ONE measure (the exposure and the rate), never margin, share count or forecasts too.

## Never
- Invent the tie: name a company only when the narrative or the inputs support the link.
- Newsjack a tragedy (war deaths, disasters).
- A figure the headline or the inputs do not give.
