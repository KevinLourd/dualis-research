# Dualis Research

Independent equity research. Every idea is weighed from both sides before we take one.

Version 3, November 2026 (v3: one indigo colour; v2: purple accent, dark charts, Aurelion-style website). Built from the references Thierry picked: Altas (calm institutional restraint), Aurelion Research (navy, serif voice, numbered sections, "What if we're wrong"), Pernas Research (layout of a research firm), Citrini (one iconic mark). Nothing here is final: comment on anything.

**Source of truth: `tokens.json`.** `node design/build.mjs` writes the CSS and TypeScript the site and the console read; the console page Design system shows it live and edits colours; the `dualis-charts` Claude skill draws every chart from it.

## Voice
- The claim first, the evidence after. Titles state a view ("Monro is a cheap call on Icahn's next move"), never a topic ("Monro update").
- Short sentences, one idea each. Numbers carry a date and a source.
- Calm and confident. No hype words, no rocket emojis, no em dashes.
- Both sides, always: every note says what would make us wrong.
- English only. Every published piece ends with the disclaimer.

## Colour
- **One colour: Dualis indigo `#2B2463`** (`brand` = `accent`, Thierry 2026-11-06: "a purple close to a very professional dark blue"; the old navy was too blue, the old purple CTA too light). It carries the logo, headings, page bands, buttons, the closing band and the console brand. Hover `accent-ink` `#1E1947`, deep bands `deep` `#1A1640` (white type), neutral tint `accent-soft` `#EEF0F3`, on black charts the main series is white and the benchmark grey. **No light purple surface or accent on the website** (Kevin 2026-11-06). Never a second accent.
- **`long` green and `short` red are data, never decoration.** They mark a position, an upside or a move.
- Grounds: `paper` for the page, `surface` for the note body. Text in `ink`, captions and sources in `muted`.
- Separate with `rule` hairlines, never shadows.

## Charts (Substack Notes, articles, website)
Thierry's black Note chart (screenshot in the private repo, `docs/screenshots/thierry-note-cpng-2026-11-03.png`): `chart-bg` #161616 ground, faint `chart-grid` lines, legend on top, a value label on every bar or point, "E" after an estimate period (FY26E), source line under the chart. Main series in `chart-bar` indigo (rounded 4px tops), second series as a `chart-line` orange line with dots, benchmark in `chart-bar-muted`. Site component: `site/src/components/dark-chart.tsx`.

## Type
- **Newsreader** (serif, Google Fonts) for titles and headings: the research-house voice.
- **IBM Plex Sans** for body and interface. **IBM Plex Mono** for tickers, prices and tables, with tabular figures.
- Labels (`label`) are uppercase with 0.06em tracking: TICKER, TARGET, UPSIDE.

## Logo
**The split D** (Kevin 2026-11-05): the D of Dualis, split by a price line that dips, then turns up. Long and short in one letter, and the moment a narrative turns. Files and rules: `assets/Logos/README.md`. The wordmark is "DUALIS" over "RESEARCH" in Newsreader caps beside the mark.

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
Pages (Kevin 2026-11-05): Home (one full-bleed hero), Company, Research (with the research portal), Portfolio (year-to-date only), About (Thierry, photo), Contact, Plans, Disclaimer. Rendering of our own (Thierry 2026-11-06, "we copy them too closely"): every inner page opens on a deep indigo band (section name, one serif statement, white) and closes on a deep indigo band (statement left, one action right); between them white sections, with deep indigo for the track record. Blocks come from the competitors' best (Altas's latest-research rows, Pernas's proof block, trust cards and FAQ), never Aurelion's sequence. Section headings in IBM Plex Sans, statements in Newsreader, sentence case. The portal lists only what Thierry published: a black and white list, the row under the pointer shows its report. Covers: a Wikimedia Commons photo of the company or its industry under an indigo veil, with shelf, title, date and mark, never AI images. The reports also run as a black horizontal strip: black and white covers, the one under the pointer grows and turns to colour. Home background: a muted trading-floor clip (Mixkit, free licence) under a deep indigo veil.

## Disclaimer (verbatim)
Not investment advice. For information only. The author may hold positions in the securities discussed.
