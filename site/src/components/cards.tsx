/**
 * Playing cards, the site's thread (Kevin 2026-11-11, after Thierry's « something like this but with a deck of cards »,
 * 2026-11-09): engraved indigo line art on white, the knot as the suit, never animated. Three places only: the hand of
 * winnable games on Research, the What we look for cards on Company, and a small card before each page's poker line.
 */

export type Card = { rank: string; title: string; line: string; ace?: boolean };

/** One engraved card: rank and knot in two corners, the knot as the pip, the title and one line on its face. */
export function PlayingCard({ card, style }: { card: Card; style?: React.CSSProperties }) {
  const mark = card.ace ? "/brand/mark-white.svg" : "/brand/mark.svg";
  return (
    <div className={`pcard${card.ace ? " ace" : ""}`} style={style}>
      <div className="pc-frame">
        <span className="pc-idx tl" aria-hidden="true">
          {card.rank}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} alt="" />
        </span>
        <span className="pc-idx br" aria-hidden="true">
          {card.rank}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} alt="" />
        </span>
        <div className="pc-face">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pc-pip" src={card.ace ? "/brand/seal-white.svg" : "/brand/seal.svg"} alt="" aria-hidden="true" />
          <h3>{card.title}</h3>
          <p>{card.line}</p>
        </div>
      </div>
    </div>
  );
}

/** Cards held as a fanned hand, the ace in the middle and on top; the knot faint behind. Flat grid on phones. */
export function Hand({ cards, caption }: { cards: readonly Card[]; caption: string }) {
  const mid = (cards.length - 1) / 2;
  return (
    <div className="hand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="hand-knot" src="/brand/seal.svg" alt="" aria-hidden="true" />
      <div className="hand-cards">
        {cards.map((c, i) => (
          <PlayingCard
            key={c.title}
            card={c}
            style={{ "--angle": `${(i - mid) * 14}deg`, zIndex: 10 - Math.abs(i - mid) * 3 } as React.CSSProperties}
          />
        ))}
      </div>
      <p className="hand-caption">{caption}</p>
    </div>
  );
}
