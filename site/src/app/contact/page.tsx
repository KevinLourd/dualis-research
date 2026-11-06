import type { Metadata } from "next";
import Link from "next/link";
import { PageBand } from "@/components/page-band";
import { LINKEDIN_URL, SUBSTACK_PROFILE_URL, X_HANDLE, X_URL } from "@/lib/model";
import { getSubstackUrl } from "@/lib/queries";

export const metadata: Metadata = { title: "Contact" };

const TOPICS = [
  { title: "Readers and subscribers", body: "Questions on a report, a plan or your subscription." },
  { title: "Collaborations", body: "Write-up collabs, Substack recommendations, guest pieces." },
  { title: "Media and other", body: "Press inquiries, or anything else. Feel free to reach out." },
];

export default async function Contact() {
  const substackUrl = await getSubstackUrl();
  return (
    <>
      <PageBand label="Contact" />
      {substackUrl && (
        <div className="strip">
          <div className="wrap strip-inner">
            <p>Looking for our research? Access the subscription platform directly.</p>
            <a target="_blank" rel="noopener noreferrer" className="btn btn-outline" href={substackUrl}>
              Research Platform
            </a>
          </div>
        </div>
      )}
      <section className="section">
        <div className="wrap">
          <h1 className="contact-title">Get in touch with us</h1>
          <div className="contact-grid">
            <div className="contact-side">
              {TOPICS.map((t) => (
                <div key={t.title} className="topic">
                  <h3>{t.title}</h3>
                  <p>{t.body}</p>
                </div>
              ))}
              <div className="topic">
                <h3>FAQ</h3>
                <p>
                  Common questions are answered on our <Link href="/subscribe#faq">plans page</Link>.
                </p>
              </div>
            </div>
            <div className="contact-main">
              <p className="lead">Write to Thierry directly, wherever you read us.</p>
              <ul className="channels">
                <li>
                  <span>Substack</span>
                  <a target="_blank" rel="noopener noreferrer" href={SUBSTACK_PROFILE_URL}>Send a message on Substack</a>
                </li>
                <li>
                  <span>X</span>
                  <a target="_blank" rel="noopener noreferrer" href={X_URL}>Message {X_HANDLE}</a>
                </li>
                <li>
                  <span>LinkedIn</span>
                  <a target="_blank" rel="noopener noreferrer" href={LINKEDIN_URL}>Message Thierry Matin</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
