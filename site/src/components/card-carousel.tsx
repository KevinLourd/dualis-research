"use client";

import { useState } from "react";
import { type Card, PlayingCard } from "./cards";

/**
 * What we look for as a carousel (Thierry 2026-11-17): one card large in the middle, the next one on the right and the
 * previous one on the left, smaller and blurred, as if further away. Arrows, the side cards and the dots flip through.
 * Kevin 2026-11-18: the cards TURN from one place to the next, as on a ring seen from the front. Every card stays
 * mounted and only its place changes (`data-place`), so the browser animates the move; no motion when the visitor
 * asks for reduced motion.
 */
type Place = "main" | "next" | "prev" | "back";

export function CardCarousel({ cards }: { cards: readonly Card[] }) {
  const [index, setIndex] = useState(0);
  const n = cards.length;
  const go = (i: number) => setIndex(((i % n) + n) % n);
  const placeOf = (i: number): Place => {
    const offset = (((i - index) % n) + n) % n;
    if (offset === 0) return "main";
    if (offset === 1) return "next";
    if (offset === n - 1) return "prev";
    return "back";
  };
  return (
    <div className="carousel" aria-roledescription="carousel" aria-label="What we look for">
      <div className="carousel-stage">
        <button type="button" className="carousel-arrow" aria-label="Previous card" onClick={() => go(index - 1)}>
          ←
        </button>
        <div className="carousel-ring">
          {cards.map((c, i) => {
            const place = placeOf(i);
            return (
              <button
                key={c.title}
                type="button"
                className="carousel-card"
                data-place={place}
                aria-label={place === "main" ? undefined : `Show the card ${c.title}`}
                aria-hidden={place === "back"}
                tabIndex={place === "main" || place === "back" ? -1 : 0}
                onClick={() => go(i)}
              >
                <PlayingCard card={c} />
              </button>
            );
          })}
        </div>
        <button type="button" className="carousel-arrow" aria-label="Next card" onClick={() => go(index + 1)}>
          →
        </button>
      </div>
      <div className="carousel-dots">
        {cards.map((c, i) => (
          <button key={c.title} type="button" aria-label={c.title} aria-current={i === index} onClick={() => go(i)} />
        ))}
      </div>
    </div>
  );
}
