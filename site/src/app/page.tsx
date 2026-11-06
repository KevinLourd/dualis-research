import Link from "next/link";

/**
 * Home: one full-bleed hero on one screen, no scroll (Kevin 2026-11-05). Background = a trading-floor clip (Mixkit
 * free licence, no credit required) under a deep indigo veil (Kevin 2026-11-06, replaces the still constellation).
 * Muted, looped; reduced motion shows the still poster.
 */
export default function Home() {
  return (
    <section className="hero">
      <video className="hero-video" autoPlay muted loop playsInline preload="auto" poster="/video/hero-poster.jpg" aria-hidden="true">
        <source src="/video/hero.mp4" type="video/mp4" />
      </video>
      <div className="hero-veil" />
      <div className="wrap hero-inner">
        <h1>
          Independent research
          <br />
          on the small caps
          <br />
          the market gets wrong
        </h1>
        <Link href="/research" className="hero-link">
          Read the research
        </Link>
      </div>
    </section>
  );
}
