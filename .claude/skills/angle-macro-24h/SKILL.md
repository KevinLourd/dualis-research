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
- Always tie it to ONE covered company, the most exposed one (the writer names its ticker), and state the exposure with a listed number (debt, interest cost, share of sales); the chart is the listed chart of that exposure itself (debt, interest cost, cash), never the share price (a post whose picture is the price chart fails), the text leads with the exposure number ($38.2M net debt) and not the macro figure, the note prints that one number with its unit ("Debt $38.2M, up from $1.2M"), and the text leads with that same number; priceSays is the belief about that exposure ("Debt costs will stay low"), never a profit claim. No listed chart for the exposure number: pick another company.

## Never
- Invent the tie: name a company only when the narrative or the inputs support the link.
- Newsjack a tragedy (war deaths, disasters).
- A figure the headline or the inputs do not give.
