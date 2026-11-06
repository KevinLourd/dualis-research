import type { LegalPage } from "@/lib/legal";
import { PageBand } from "./page-band";

export function Legal({ page }: { page: LegalPage }) {
  return (
    <>
      <PageBand label={page.title} />
      <section className="section">
        <div className="wrap narrow legal">
          <p className="updated">{page.lastUpdated}</p>
          {page.sections.map((s) => (
            <div key={s.heading}>
              <h2>{s.heading}</h2>
              {s.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
