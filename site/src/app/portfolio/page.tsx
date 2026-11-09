import type { Metadata } from "next";
import { CtaBand, Proof } from "@/components/blocks";
import { PageBand } from "@/components/page-band";

export const metadata: Metadata = { title: "Portfolio" };

/**
 * Portfolio: the published record only. Never the number of names held as an identity (Kevin 2026-11-06: hidden for
 * now), never a fund (Thierry is the founder and lead analyst of Dualis Research).
 */
export default async function Portfolio() {
  return (
    <>
      <PageBand label="Portfolio" line="Live positions, year to date." scene="portfolio" />

      <Proof />

      <section className="section">
        <div className="wrap narrow prose">
          <h2 className="h-bold">How positions are taken</h2>
          <p className="lead">Thierry Matin takes a position when price and value drift apart.</p>
          <p>Ideas go long when a bad story starts to turn, and short when a hyped one starts to crack. Winners and losers are both reported.</p>
        </div>
      </section>

      <CtaBand title="Read the research" body="Long and short ideas in small and mid caps." href="/research" cta="Open the research" />
    </>
  );
}
