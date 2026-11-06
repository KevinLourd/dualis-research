# NoteHeader

The strip that opens every research note: ticker, exchange, price, market cap, position, target, upside, date.

- Markup: `.dr-strip` holding one `div` per field, each a `.dr-label` plus a `.dr-fig` (or a `.dr-tag`).
- The consumer provides real values with their date. The example shows a made-up ticker (EXMP).
- Upside uses `.dr-fig.up` (long) or `.dr-fig.down` (short), never another colour.
- A 2px `brand` top rule marks it as Dualis; no other heavy borders.
