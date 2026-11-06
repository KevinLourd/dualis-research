import type { Metadata } from "next";
import { PageBand } from "@/components/page-band";
import { DISCLAIMER } from "@/lib/model";

export const metadata: Metadata = { title: "Disclaimer" };

export default async function Disclaimer() {
  return (
    <>
      <PageBand label="Disclaimer" />
      <section className="section">
        <div className="wrap narrow prose">
          <p className="lead">{DISCLAIMER}</p>
          <p>Dualis Research publishes independent research for information and education. Nothing on this site or in our reports is a recommendation to buy or sell any security, or advice suited to your situation.</p>
          <p>Thierry Matin may hold long or short positions in the securities discussed, and may trade them at any time without notice.</p>
          <p>Performance figures are as reported by the author, gross of fees and not audited. Past performance does not guarantee future results. Investing involves risk, including the loss of capital.</p>
          <p>Dualis Research is not a registered investment adviser or broker-dealer. Do your own research and consult a licensed professional before making any investment decision.</p>
        </div>
      </section>
    </>
  );
}
