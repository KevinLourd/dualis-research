import Link from "next/link";
import { HeroField } from "@/components/hero-field";

/** Home: one full-bleed hero on one screen, no scroll (Kevin 2026-11-05). Everything else lives on the inner pages. */
export default function Home() {
  return (
    <section className="hero">
      <HeroField plain />
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
