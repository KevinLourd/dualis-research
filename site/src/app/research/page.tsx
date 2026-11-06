import type { Metadata } from "next";
import { CoverStrip, CtaBand, Faq, LatestResearch, Proof } from "@/components/blocks";
import { PageBand } from "@/components/page-band";
import { Portal } from "@/components/portal";
import { DISCLAIMER, subscribeHref } from "@/lib/model";
import { getPublications, getSubstackUrl } from "@/lib/queries";

export const metadata: Metadata = { title: "Research" };

/**
 * Research: every report on black, the newest three as rows, the published record, the portal, then questions.
 * Blocks taken from the competitors' best (Altas's list, Pernas's proof and FAQ), never Aurelion's sequence
 * (Kevin 2026-11-06).
 */
export default async function Research() {
  const [substackUrl, posts] = await Promise.all([getSubstackUrl(), getPublications()]);
  const subscribe = subscribeHref(substackUrl);
  return (
    <>
      <PageBand label="Research" line="Long and short calls on the small caps the market misreads." />

      {posts.length > 0 && (
        <section className="cover-band">
          <div className="wrap cover-band-head">
            <h2>Every report</h2>
            <p>Point at a cover. Click to read it on Substack.</p>
          </div>
          <div className="wrap">
            <CoverStrip posts={posts} />
          </div>
        </section>
      )}

      {posts.length > 0 && (
        <section className="section">
          <div className="wrap">
            <div className="head-row">
              <h2 className="h-light">Latest research</h2>
              <a href="#portal" className="btn btn-outline">
                All reports
              </a>
            </div>
            <LatestResearch posts={posts} />
          </div>
        </section>
      )}

      <Proof />

      <section className="section" id="portal">
        <div className="wrap">
          <h2 className="h-light">The research portal</h2>
          <p className="sub">Everything published, newest first. Point at a report to see it.</p>
          <Portal posts={posts} />
          <p className="disclaimer">{DISCLAIMER}</p>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="wrap narrow">
          <h2 className="h-light">Frequently asked questions</h2>
          <Faq />
        </div>
      </section>

      {subscribe && <CtaBand title="Get every report by email" body="New research lands in your inbox the day it is published. Start free." href={subscribe} cta="Subscribe free" />}
    </>
  );
}
