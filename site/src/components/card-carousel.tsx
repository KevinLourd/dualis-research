"use client";

import { useState } from "react";
import { type Card, PlayingCard } from "./cards";

/**
 * What we look for as a carousel (Thierry 2026-11-17): one card large in the middle, the next one on the right and the
 * previous one on the left, smaller and blurred, as if further away. Arrows, the side cards and the dots flip through.
 */
export function CardCarousel({ cards }: { cards: readonly Card[] }) {
  const [index, setIndex] = useState(0);
  const at = (i: number) => cards[(i + cards.length) % cards.length];
  const go = (i: number) => setIndex((i + cards.length) % cards.length);
  return (
    <div className="carousel" aria-roledescription="carousel" aria-label="What we look for">
      <div className="carousel-stage">
        <button type="button" className="carousel-arrow" aria-label="Previous card" onClick={() => go(index - 1)}>
          ←
        </button>
        <button type="button" className="carousel-side" aria-label={`Previous card: ${at(index - 1).title}`} onClick={() => go(index - 1)}>
          <PlayingCard card={at(index - 1)} />
        </button>
        <div className="carousel-main" aria-live="polite">
          <PlayingCard card={at(index)} />
        </div>
        <button type="button" className="carousel-side" aria-label={`Next card: ${at(index + 1).title}`} onClick={() => go(index + 1)}>
          <PlayingCard card={at(index + 1)} />
        </button>
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
