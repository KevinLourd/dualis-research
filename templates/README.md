# Substack article template

One look for every Dualis Research article on Substack. Substack has no custom CSS, so the text uses its editor and everything it cannot style ships as an image in the Dualis design system (`design/`).

| File | What it is |
|---|---|
| `substack-article.md` | Article skeleton, in the note order of `design/README.md`, paywall after "The business". |
| `render.mjs` | Turns a spec JSON into 1456px PNGs with headless Chrome. No npm install. |
| `images.css` | Layout of the images, built only from the design tokens. |
| `example/` | A full EXAMPLE article (made-up company), its spec and its rendered images. |

## Image types

| `type` | Shows | Goes in |
|---|---|---|
| `header` | Company, one-line thesis, ticker, price, market cap, LONG/SHORT, target, upside, horizon, date | Top of the article |
| `bullbear` | Bull and bear columns side by side, value of each side, our view | Section 3 |
| `scenarios` | Bear, base and bull table with the math, probability-weighted value | Section 6 |
| `chart` | Line chart from numbers in the spec, or your own chart image framed the Dualis way (`"image": "my-chart.png"`) | Wherever a chart helps |

Every image ends with the Dualis footer (mark, name, ticker, date). Long green and short red mark data only.

## Write an article in 10 steps

1. Copy `example/` to `articles/<ticker>-<yyyy-mm-dd>/`.
2. In `spec.json`, fill `article` (ticker, price, target...) and set `"example": false`.
3. Fill the Bull vs Bear points, the scenario rows and the chart numbers in `images`.
4. Run `node templates/render.mjs articles/<folder>/spec.json`. The PNGs land in `articles/<folder>/images/`.
5. Open each PNG and check the figures.
6. Write the text in `article.md`, starting from `substack-article.md`. Keep its order and headings.
7. In Substack, start a new post. Paste the title and subtitle into their own fields.
8. Paste the text section by section. Insert each image where `[IMAGE: ...]` sits, at normal width, no caption.
9. Insert the Subscribe buttons (Button > Subscribe) and the paywall (More `...` > Paywall) where marked.
10. Check the disclaimer is the last line, preview on phone, then publish.

## Spec format (short)

```json
{
  "outDir": "images",
  "logo": "split-disc",
  "article": { "company": "", "thesis": "", "ticker": "", "exchange": "", "price": "", "marketCap": "",
               "position": "LONG", "target": "", "upside": "+37%", "horizon": "18 months", "date": "YYYY-MM-DD", "example": false },
  "images": [
    { "type": "header", "file": "01-header.png" },
    { "type": "bullbear", "file": "02-bull-vs-bear.png", "title": "", "bull": [""], "bear": [""], "bullValue": "", "bearValue": "", "verdict": "" },
    { "type": "scenarios", "file": "03-scenarios.png", "title": "",
      "rows": [{ "label": "", "bear": "", "base": "", "bull": "", "emphasis": false, "signed": false }],
      "weighted": { "value": "", "upside": "" } },
    { "type": "chart", "file": "04-chart.png", "title": "", "subtitle": "", "x": [""], "ySuffix": "%",
      "series": [{ "name": "", "values": [0], "color": "brand", "dashed": false }],
      "refs": [{ "label": "", "value": 0 }] }
  ]
}
```

- `signed: true` colours `+` values green and `-` values red (upside rows).
- `emphasis: true` makes a row bold (value per share).
- Chart colours: `brand` (default), `muted`, `long`, `short`. A gap in a series is `null`.
- `logo` is one of `split-disc`, `mirrored-d`, `crossed-ticks` (from `design/assets/Logos/`) until Thierry picks one.
- Em and en dashes in the spec are replaced by commas.

Rendering needs Google Chrome in `/Applications` (or `CHROME_PATH`) and internet for the Google Fonts. If Chrome fails, the script falls back to macOS `qlmanage`.

## Substack publication settings (once)

Dashboard > Settings. Substack shows the exact upload size in each dialog.

| Setting | Value |
|---|---|
| Accent / theme colour | `#0B2A5B` (Dualis navy) |
| Background | White |
| Heading font | Closest serif offered (Newsreader is not offered: pick a book serif, never a display or slab serif) |
| Body font | Closest clean sans offered (IBM Plex Sans is not offered) |
| Publication logo (square, avatar) | The chosen mark from `design/assets/Logos/`, navy on white, exported to PNG |
| Wordmark (wide, header) | Mark + "DUALIS RESEARCH" in Newsreader caps, navy on transparent |
| Cover / social image | `design/components/Cover/preview.html` rendered to PNG |
| Email header | Wordmark on white |
| Footer / About | Ends with the disclaimer below |

Disclaimer, last line of every article:

*Not investment advice. For information only. The author may hold positions in the securities discussed.*
