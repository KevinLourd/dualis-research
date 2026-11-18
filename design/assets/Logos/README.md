# Logos

The Dualis mark (Kevin 2026-11-06, round 2 option 03): **Solomon's knot**, two loops that cannot be pulled apart, laid in Roman floors for 2,000 years: price and value, long and short. Two versions drawn as a pair: `dualis-seal.svg` (engraved, large uses and the Research framework drawn on it, like Citrini's framework on its own logo) and `dualis-mark.svg` (simplified: header, footer, covers, 16 px icons). Never a watermark over a chart. How we got there: `proposals/process.md` (studio method, competitor audit, 2 rounds), `proposals/round-2.png`, construction `proposals/r2-03-solomon-knot-construction.svg`.

- `dualis-mark.svg`: master, `brand` indigo `#2B2463`, drawn on a 256 grid; its viewBox is cropped to the knot (no margin).
- `dualis-mark-black.svg`, `-white.svg` (on indigo or dark), `dualis-seal.svg`: same, cropped to the artwork, transparent.
- `dualis-avatar.svg`: Substack, X, GitHub, LinkedIn profile picture (white mark on indigo, padded to survive the round crop).
- Web icons (favicon.ico, favicon.svg, apple-touch-icon, icon-192/512) live in `site/public/`.

**Downloads (PNG and SVG) = the console's Design system page** (`/design`, Kevin 2026-11-18: GitHub only takes PNG, GIF or JPG). Each file is made from these SVGs at request time (`web/src/design/logo-export.ts`, route `/api/design/logos/<name>.png|svg`), cropped to the drawn pixels, transparent where nothing is drawn: never commit a PNG copy here, it drifts. A new logo = its SVG here (viewBox tight, a test checks) + one entry in `design/tokens.json` `logos` (`pngSizes` for the sizes offered).

Rules: one colour at a time (indigo, white, or black), never outlined text beside it in another colour, clear space = the outline's thickness on every side (add it in the layout, never in the file), minimum 16 px.
