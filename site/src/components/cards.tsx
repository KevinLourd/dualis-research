/**
 * Playing cards, the site's thread (Kevin 2026-11-11, after Thierry's « something like this but with a deck of cards »).
 * Thierry 2026-11-17: no Dualis logo on a card, a suit in two corners, nothing in the middle but an icon that fits the
 * title, the title and its text. One place only: What we look for on Company, as a carousel (`card-carousel.tsx`).
 * Static: no transition, no animation.
 */

export type Suit = "spade" | "heart" | "club" | "diamond";
export type CardIcon = "small-caps" | "cycle" | "globe" | "themes" | "inflection" | "quality";
export type Card = { suit: Suit; icon: CardIcon; title: string; line: string };

const SUIT_PATHS: Record<Suit, string> = {
  spade: "M12 2C8 7 3 10 3 14.5A4.2 4.2 0 0 0 10.6 17L9.4 22h5.2l-1.2-5A4.2 4.2 0 0 0 21 14.5C21 10 16 7 12 2Z",
  heart: "M12 21.5C6.5 16.5 2.5 13 2.5 8.6A4.9 4.9 0 0 1 12 6.4a4.9 4.9 0 0 1 9.5 2.2c0 4.4-4 7.9-9.5 12.9Z",
  club: "M12 2.5a4.2 4.2 0 0 0-3.6 6.4 4.2 4.2 0 1 0 2.5 7.2L9.6 22h4.8l-1.3-5.9a4.2 4.2 0 1 0 2.5-7.2A4.2 4.2 0 0 0 12 2.5Z",
  diamond: "M12 2 20 12 12 22 4 12Z",
};

function SuitGlyph({ suit }: { suit: Suit }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={SUIT_PATHS[suit]} fill="currentColor" />
    </svg>
  );
}

/** Line icons, one per card title; also beside the Primary Setups titles (Kevin 2026-11-18). */
export function Icon({ name, className = "pc-icon" }: { name: CardIcon; className?: string }) {
  const common = { viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (name === "small-caps")
    return (
      <svg {...common} className={className} aria-hidden="true">
        <path d="M6 42h36M10 42V30h7v12M20.5 42V22h7v20M31 42V10h7v32" />
      </svg>
    );
  if (name === "cycle")
    return (
      <svg {...common} className={className} aria-hidden="true">
        <path d="M4 24c5-16 11-16 16 0s11 16 16 0 6-9 8-9M4 40h40" />
      </svg>
    );
  if (name === "globe")
    return (
      <svg {...common} className={className} aria-hidden="true">
        <circle cx="24" cy="24" r="18" />
        <path d="M6 24h36M24 6c-6 5-9 11-9 18s3 13 9 18c6-5 9-11 9-18s-3-13-9-18Z" />
      </svg>
    );
  if (name === "inflection")
    return (
      <svg {...common} className={className} aria-hidden="true">
        <path d="M4 10c6 4 10 14 14 22 2 4 4 6 6 6s4-2 6-6c3-7 7-14 14-18M6 44h36" />
        <circle cx="24" cy="38" r="2.5" fill="currentColor" />
      </svg>
    );
  if (name === "quality")
    return (
      <svg {...common} className={className} aria-hidden="true">
        <path d="M14 8h20l8 10-18 22L6 18Z M6 18h36 M20 18l4-10 4 10 M20 18l4 22 4-22" />
      </svg>
    );
  return (
    <svg {...common} className={className} aria-hidden="true">
      <circle cx="24" cy="9" r="4" />
      <circle cx="10" cy="26" r="4" />
      <circle cx="38" cy="26" r="4" />
      <circle cx="17" cy="41" r="3" />
      <circle cx="31" cy="41" r="3" />
      <path d="M21 12 13 23M27 12l8 11M11.5 30l4 8M36.5 30l-4 8" />
    </svg>
  );
}

/** One card: its suit in two corners, an icon, the title and its text. */
export function PlayingCard({ card }: { card: Card }) {
  // Hearts and diamonds are red, as on a real deck (Kevin 2026-11-18).
  const red = card.suit === "heart" || card.suit === "diamond";
  return (
    <div className="pcard">
      <div className="pc-frame">
        <span className={`pc-idx tl${red ? " red" : ""}`}>
          <SuitGlyph suit={card.suit} />
        </span>
        <span className={`pc-idx br${red ? " red" : ""}`}>
          <SuitGlyph suit={card.suit} />
        </span>
        <div className="pc-face">
          <Icon name={card.icon} />
          <h3>{card.title}</h3>
          <p>{card.line}</p>
        </div>
      </div>
    </div>
  );
}
