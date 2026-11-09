import type { Metadata } from "next";
import { Faq, Plans } from "@/components/blocks";
import { PageBand } from "@/components/page-band";
import { getSubstackUrl } from "@/lib/queries";

export const metadata: Metadata = { title: "Plans" };

export default async function Subscribe() {
  const substackUrl = await getSubstackUrl();
  return (
    <>
      <PageBand label="Plans" line="Read every report in full." thread="plans" />
      <section className="section">
        <div className="wrap">
          <Plans substackUrl={substackUrl} />
        </div>
      </section>
      <section className="section" id="faq">
        <div className="wrap narrow">
          <h2 className="h-light">Questions</h2>
          <Faq />
        </div>
      </section>
    </>
  );
}
