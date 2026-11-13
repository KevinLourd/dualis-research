import Link from "next/link";
import { WINNABLE } from "@/lib/winnable";

/**
 * Home: one full-bleed hero on one screen, no scroll (Kevin 2026-11-05). Background = a 27 s loop of the industries
 * Thierry invests in (Thierry 2026-11-09: « I really like the manufacturing, the data center. I don't like the planes
 * and the rockets »): robotic arms, semiconductors, data centers, power, the grid, oil and gas, ports, mining,
 * agriculture (Mixkit free licence). No plane, rocket, space or defense clip. Never a caption in the footage. Muted;
 * reduced motion = poster.
 */
export default function Home() {
  return (
    <section className="hero">
      <video className="hero-video" autoPlay muted loop playsInline preload="auto" poster="/video/hero-poster.jpg" aria-hidden="true">
        <source src="/video/hero.mp4" type="video/mp4" />
      </video>
      <div className="hero-veil" />
      <div className="wrap hero-inner">
        {/* Thierry 2026-11-06: buy-side, on the investor's side, unlike sell-side analysts paid by the companies. */}
        <h1>
          Independent Research
          <br />
          for Buy-Side Opportunities
        </h1>
        <p className="hero-sub">Long and short ideas in small and mid caps.</p>
        <p className="band-thread">
          {WINNABLE.home}
        </p>
        <Link href="/research" className="hero-link">
          Read the research
        </Link>
      </div>
    </section>
  );
}
