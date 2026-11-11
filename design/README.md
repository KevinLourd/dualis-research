# Dualis Research

Independent research for buy-side opportunities: long and short ideas in small and mid caps. Play winnable games.

Version 4, November 2026 (v4: Notes and X charts on deep indigo, a 10-colour series palette; v3: one indigo colour; v2: purple accent, dark charts, Aurelion-style website). Built from the references Thierry picked: Altas (calm institutional restraint), Aurelion Research (navy, serif voice, numbered sections, "What if we're wrong"), Pernas Research (layout of a research firm), Citrini (one iconic mark). Nothing here is final: comment on anything.

**Source of truth: `tokens.json`.** `node design/build.mjs` writes the CSS and TypeScript the site and the console read; the console page Design system shows it live and edits colours; the `dualis-charts` Claude skill draws every chart from it.

## Voice
- The claim first, the evidence after. Titles state a view ("Monro is a cheap call on Icahn's next move"), never a topic ("Monro update").
- Short sentences, one idea each. Numbers carry a date and a source.
- Calm and confident. No hype words, no rocket emojis, no em dashes.
- Every note says what would make us wrong.
- English only. Every published piece ends with the disclaimer.

## Colour
- **One colour: Dualis indigo `#2B2463`** (`brand` = `accent`, Thierry 2026-11-06: "a purple close to a very professional dark blue"; the old navy was too blue, the old purple CTA too light). It carries the logo, headings, page bands, buttons, the closing band and the console brand. Hover `accent-ink` `#1E1947`, deep bands `deep` `#1A1640` (white type), neutral tint `accent-soft` `#EEF0F3`, on black charts the main series is white and the benchmark grey, on the website's white charts indigo and light grey. **No light purple surface or accent on the website** (Kevin 2026-11-06). Never a second accent.
- **`long` green and `short` red are data, never decoration.** They mark a position, an upside or a move.
- Grounds: `paper` for the page, `surface` for the note body. Text in `ink`, captions and sources in `muted`.
- Separate with `rule` hairlines, never shadows.

## Charts (Substack Notes, articles, website)
Two themes (Thierry 2026-11-09, he picked them from rendered options). **Substack Notes and X** (`dark`): white data on the deep indigo `chart-bg` #1A1640 ground (the website's dark bands), faint `chart-grid` lines, legend on top, a value label on every bar or on the last point, "E" after an estimate period (FY26E), source line under the chart, the mark small in the corner. Main series in `chart-bar` white (rounded 4px tops), second series as a `chart-line` orange line, benchmark in `chart-bar-muted`. **The website and reports** (`light`, Thierry 2026-11-06: "a white background with a purple", clean like Aurelion): a white panel, `brand` indigo main series, `chart-light-bench` grey benchmark, `rule` gridlines, `chart-light-base` zero line, source line inside the panel. **Many series** (Thierry: "a few colours in case the chart has like 5-10 different variables"): `chart-series-1` to `-10` in order, light values on white, dark values on deep indigo, every one at least 3:1 against its ground, never green or red (they mean long and short). Site components: `site/src/components/ytd-chart.tsx`, `dark-chart.tsx`.

## Type
- **Newsreader** (serif, Google Fonts) for titles and headings: the research-house voice.
- **IBM Plex Sans** for body and interface. **IBM Plex Mono** for tickers, prices and tables, with tabular figures.
- Labels (`label`) are uppercase with 0.06em tracking: TICKER, TARGET, UPSIDE.

## Logo
**Solomon's knot** (Kevin 2026-11-06): two loops that cannot be pulled apart, price and value, long and short. An engraved seal for large uses and a simplified mark for headers, covers and icons; one colour at a time (indigo, white or black), never a watermark over a chart. Files and rules: `assets/Logos/README.md`. The wordmark is "DUALIS" over "RESEARCH" in caps beside the mark.

## Research note anatomy (Substack and website, same order)
1. **Header strip**: ticker, exchange, price, market cap, LONG/SHORT tag, target, upside, date.
2. **Key takeaways**: 3 bullets (free).
3. One-line position disclosure.
4. Contents.
5. The business.
6. Our view and drivers, numbered.
7. **Bull vs Bear**: two columns side by side. This is the Dualis signature.
8. Catalysts with dates.
9. What if we're wrong (risks and kill criteria).
10. Valuation: bear, base and bull scenarios with the math shown. Charts are captioned "Source: Dualis Research estimates".
11. Thesis scorecard, updated in later notes: On track, Watch or Off track.
12. Disclosures and methodology.

The paywall sits after item 4 or 5.

## Website (Aurelion's pages, our own rendering)
Pages (Kevin 2026-11-05): Home (one full-bleed hero), Company, Research (with the research portal), About (Thierry, photo; his name nowhere else, Thierry 2026-11-09), no Portfolio page (Thierry 2026-11-09), Contact, Subscribe (the plans), Disclaimer. Rendering of our own (Thierry 2026-11-06, "we copy them too closely"): every inner page opens on a deep indigo band (section name, one serif statement, white) and closes on a deep indigo band (statement left, one action right); between them white sections, with deep indigo for the track record. Blocks come from the competitors' best (Altas's latest-research rows, Pernas's proof block, trust cards and FAQ), never Aurelion's sequence. Section headings in IBM Plex Sans, statements in Newsreader, sentence case. The portal lists only what Thierry published: a black and white list, the row under the pointer shows its report. Covers: a Wikimedia Commons photo of the company or its industry under an indigo veil, with shelf, title, date and mark, never AI images. The reports also run as a black horizontal strip: black and white covers, the one under the pointer grows and turns to colour. Home background: a 31 s loop of the newest frontier technology (Artemis II, Starship, AI combat drone, humanoid robot, fusion, AI data center, B-21), under a light veil on the left only.

## Disclaimer (verbatim)
Not investment advice. For information only. The author may hold positions in the securities discussed.
