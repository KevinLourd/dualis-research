/**
 * Terms of Use and Privacy Policy (Kevin 2026-11-06: "en checkant online les templates et best practices pour une equity
 * research firm"). Drafted from: Lowe v. SEC (publisher's exclusion: general, regular, impersonal research), Citrini
 * Research and Seeking Alpha terms, short-seller disclosure practice after the 2024 Andrew Left case (long AND short
 * positions, may trade without notice), Substack and Cloudflare privacy policies, EDPB guidance on GDPR for non-EU
 * publishers. Never a fund: Thierry is the founder and lead analyst of Dualis Research.
 */
export type LegalPage = { title: string; lastUpdated: string; sections: { heading: string; paragraphs: string[] }[] };

const LAST_UPDATED = "Last updated: November 6, 2026";
const CONTACT = { heading: "Contact", paragraphs: ["You can reach us through the Contact page, by Substack message, on X or on LinkedIn."] };

export const TERMS: LegalPage = {
  title: "Terms of Use",
  lastUpdated: LAST_UPDATED,
  sections: [
    {
      heading: "Acceptance of these terms",
      paragraphs: [
        "These Terms of Use apply to this website and to all research published by Dualis Research.",
        "By using this website or reading our research, you agree to these terms.",
        "If you do not agree, please do not use the website or the research.",
        "Paid subscriptions are sold on Substack. Substack's own terms also apply to your subscription.",
      ],
    },
    {
      heading: "Who we are",
      paragraphs: [
        "Dualis Research is an independent equity research publisher based in Astana, Kazakhstan.",
        "We publish research on listed small and mid cap companies, including long and short ideas.",
        "Thierry Matin is the Founder and Lead Analyst.",
      ],
    },
    {
      heading: "Nature of the research",
      paragraphs: [
        "Our research is a general publication. It is written once and offered on the same terms to every reader.",
        "It is published on a regular basis to free and paid subscribers.",
        "It is impersonal. It does not consider your financial situation, goals, tax position or risk tolerance.",
        "We do not give personal advice to any reader, by message or in any other way.",
        "Comment on a specific security does not make the research advice tailored to you.",
      ],
    },
    {
      heading: "No investment advice and no solicitation",
      paragraphs: [
        "Our research is for information only. It is not investment, financial, legal, tax or accounting advice.",
        "Dualis Research is not a registered investment adviser, broker dealer or financial adviser in any country.",
        "We owe no fiduciary duty to any reader.",
        "Nothing we publish is an offer, a recommendation or a solicitation to buy, sell or hold any security.",
        "Investing in listed securities, and small caps in particular, can lead to the loss of your entire investment. Short selling can lead to losses greater than the amount invested.",
        "You make your own investment decisions and you are solely responsible for them. Please do your own research and speak to a licensed professional before you act.",
      ],
    },
    {
      heading: "Positions and conflicts of interest",
      paragraphs: [
        "The author may hold long or short positions in the securities discussed in our research.",
        "The author may buy or sell those securities at any time, before or after publication, without notice to readers.",
        "A position may change after a report is published, including in a direction that differs from the view in the report.",
        "You should assume that the author stands to gain if the price moves in the direction the research describes.",
        "Please weigh this possible bias when you read our research.",
      ],
    },
    {
      heading: "Accuracy and sources",
      paragraphs: [
        "We base our research on public information and on sources we believe to be reliable, such as company filings, market data and news.",
        "We do not guarantee that any information is accurate, complete or current.",
        "All content is provided as is and as of its publication date.",
        "Our opinions may change without notice. We have no duty to update a report after it is published.",
      ],
    },
    {
      heading: "Forward-looking statements",
      paragraphs: [
        "Our research contains opinions, estimates and forecasts about future events.",
        "Fair values, scenarios and expectations are views, not facts or promises.",
        "Actual results may differ materially from any forward-looking statement.",
      ],
    },
    {
      heading: "Performance figures",
      paragraphs: [
        "Any performance figures we show are as reported by the author.",
        "They are gross of fees and have not been audited or independently verified.",
        "Past performance does not guarantee future results.",
      ],
    },
    {
      heading: "Intellectual property",
      paragraphs: [
        "All research, text, charts, images and logos on this website and in our reports belong to Dualis Research or its licensors.",
        "You may read our research and keep a copy for your own personal, non-commercial use.",
        "You may quote a short extract from a free report if you credit Dualis Research and link to the source.",
      ],
    },
    {
      heading: "No redistribution of paid research",
      paragraphs: [
        "A paid subscription is for one person.",
        "You may not forward, share, copy, republish, resell or post paid reports, in whole or in part, without our written permission.",
        "This includes sharing your login, sharing PDFs or screenshots, and posting content in chats, forums or social media.",
        "You may not use our research to train or feed any artificial intelligence system without our written permission.",
        "We may cancel the access of anyone who breaks these rules.",
      ],
    },
    {
      heading: "Third-party platforms and links",
      paragraphs: [
        "Our reports are published and sold on Substack.",
        "Substack handles subscriptions, payments, emails and cancellations under its own terms and privacy policy.",
        "This website links to Substack, X and LinkedIn. We do not control those services and are not responsible for their content or practices.",
      ],
    },
    {
      heading: "Limitation of liability",
      paragraphs: [
        "To the fullest extent the law allows, Dualis Research and its founder are not liable for any loss or damage arising from your use of this website or our research.",
        "This includes trading or investment losses, lost profits and indirect or consequential damages.",
        "This applies even if we were told such a loss was possible.",
        "If any liability cannot be excluded, our total liability is limited to the subscription fees you paid us in the 12 months before the claim.",
        "Nothing in these terms limits liability that cannot be limited under applicable law.",
      ],
    },
    {
      heading: "Indemnity",
      paragraphs: [
        "You agree to compensate Dualis Research and its founder for any claim, loss or cost, including reasonable legal fees, that arises from your breach of these terms or your misuse of our research.",
      ],
    },
    {
      heading: "Governing law",
      paragraphs: [
        "These terms are governed by the laws of the Republic of Kazakhstan.",
        "Any dispute will be handled by the competent courts of the Republic of Kazakhstan, unless mandatory law where you live says otherwise.",
        "If a court finds one part of these terms invalid, the rest stays in force.",
      ],
    },
    {
      heading: "Changes to these terms",
      paragraphs: [
        "We may update these terms from time to time.",
        "The date at the top of this page shows the latest version.",
        "If you keep using the website or our research after a change, you accept the updated terms.",
      ],
    },
    CONTACT,
  ],
};

export const PRIVACY: LegalPage = {
  title: "Privacy Policy",
  lastUpdated: LAST_UPDATED,
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        "Dualis Research is an independent equity research publisher based in Astana, Kazakhstan.",
        "Thierry Matin is the Founder and Lead Analyst.",
        "This policy explains what personal data this website handles and what rights you have.",
        "For this website, Dualis Research is the data controller.",
      ],
    },
    {
      heading: "The short version",
      paragraphs: [
        "This website shows our published reports and links to Substack, X and LinkedIn.",
        "It has no accounts, no login and no forms that store your data.",
        "It has no mailing list of its own.",
        "We set no advertising cookies and no analytics cookies.",
        "Your subscriber data lives with Substack, not with us on this website.",
      ],
    },
    {
      heading: "What this website collects",
      paragraphs: [
        "This website is hosted on Cloudflare.",
        "Like any web host, Cloudflare receives technical data when you visit. This includes your IP address, browser type, the pages you request and the time of the request.",
        "Cloudflare processes this data to deliver the website and to protect it from attacks and abuse.",
        "We do not use this data for marketing or to build profiles of visitors.",
        "We do not combine it with any other data about you.",
      ],
    },
    {
      heading: "Email field on this website",
      paragraphs: [
        "The email field on this website does not store your address.",
        "When you use it, you are sent to Substack's subscribe page.",
        "If you subscribe, Substack collects your email address under its own privacy policy.",
      ],
    },
    {
      heading: "Substack and your subscription",
      paragraphs: [
        "Our reports are published, sold and emailed through Substack.",
        "Substack handles sign up, payments, emails and cancellations.",
        "Substack is a separate company. It processes your data under its own terms and privacy policy.",
        "As the publisher, we can see the data Substack shows publishers about subscribers, such as your email address and subscription status. We use it only to run our publication.",
        "We never sell subscriber data.",
        "Please read Substack's privacy policy to learn what Substack collects and how to manage your account.",
      ],
    },
    {
      heading: "Cookies",
      paragraphs: [
        "We do not set advertising or analytics cookies on this website.",
        "Cloudflare may set strictly necessary security cookies, for example to detect bots. These cookies do not track you across websites.",
        "Substack, X and LinkedIn may set their own cookies when you visit their sites. Their policies apply there.",
        "If we ever add analytics, we will update this policy first.",
      ],
    },
    {
      heading: "Third-party links",
      paragraphs: [
        "This website links to Substack, X and LinkedIn.",
        "When you follow a link, you leave this website. The other service's privacy policy then applies.",
        "We are not responsible for how those services handle your data.",
      ],
    },
    {
      heading: "Legal basis",
      paragraphs: [
        "If data protection laws such as the EU or UK GDPR apply to you, we rely on our legitimate interest to process technical data.",
        "That interest is to deliver the website safely and to keep it secure.",
        "We process no other personal data through this website.",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "Depending on where you live, you may have the right to access, correct, delete or restrict your personal data, to object to its use, and to receive a copy of it.",
        "For subscription data, the fastest way is through your Substack account settings.",
        "You can unsubscribe at any time from the link in any email, or in your Substack account.",
        "You can also ask us directly through the Contact page. We will answer within one month.",
        "You also have the right to complain to the data protection authority where you live.",
      ],
    },
    {
      heading: "International transfers",
      paragraphs: [
        "We are based in Kazakhstan. Cloudflare and Substack operate globally.",
        "Your data may be processed in countries other than your own, including the United States.",
        "Those providers apply their own safeguards to such transfers, as described in their policies.",
      ],
    },
    {
      heading: "Retention",
      paragraphs: [
        "Cloudflare keeps request logs for a limited period under its own policies.",
        "Substack keeps subscriber data for as long as your account exists, and as its policy describes.",
        "If you ask us to delete data we hold, we will delete it unless the law requires us to keep it.",
      ],
    },
    {
      heading: "Security",
      paragraphs: [
        "This website is served over an encrypted connection.",
        "Cloudflare protects it against attacks and abuse.",
        "No online service is perfectly secure, but we keep the data we handle to a minimum.",
      ],
    },
    {
      heading: "Children",
      paragraphs: [
        "Our research is meant for adults.",
        "We do not knowingly collect data from anyone under 18.",
        "If you think a child has shared data with us, please contact us and we will delete it.",
      ],
    },
    {
      heading: "Changes to this policy",
      paragraphs: ["We may update this policy, for example if we add analytics.", "The date at the top of this page shows the latest version."],
    },
    CONTACT,
  ],
};
