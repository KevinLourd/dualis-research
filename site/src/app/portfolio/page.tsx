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
      <PageBand label="Portfolio" line="Every position starts as a published report." />

      <Proof />

      <section className="section">
        <div className="wrap narrow prose">
          <h2 className="h-bold">How positions are taken</h2>
          <p className="lead">Thierry Matin buys what he writes up. Each position traces back to a report with its thesis, and forward to the update that closes it.</p>
          <p>Ideas go long when a bad story starts to turn, and short when a hyped one starts to crack. Winners and losers are both reported.</p>
        </div>
      </section>

      <CtaBand title="Read the reports behind each position" body="From the first idea to the exit." href="/research" cta="Open the research" />
    </>
  );
}
