import { findQuote } from "@/collectors/dimensions/filing-documents/text";

/**
 * The `doc:` item (level C): one page of a company document as printed, the passage a claim quotes highlighted.
 * Item id `doc:<document id>:<page>` or `doc:<document id>:<page>:<quote>` (the quote may hold colons).
 */
export type DocItem = { documentId: string; page: number; quote: string | null };

export function parseDocItem(key: string): DocItem | null {
  const [documentId, page, ...quote] = key.split(":");
  const n = Number(page);
  if (!/^[0-9a-f-]{36}$/i.test(documentId ?? "") || !Number.isInteger(n) || n < 1) return null;
  return { documentId, page: n, quote: quote.length ? quote.join(":") : null };
}

export const docItemId = (documentId: string, page: number, quote?: string | null) => `doc:${documentId}:${page}${quote ? `:${quote}` : ""}`;

/** « Open document ↗ » target: a PDF opens at the page; an HTML or registry viewer page opens at its top. */
export const openAt = (viewUrl: string, format: string, page: number) => (format === "pdf" ? `${viewUrl.replace(/#.*$/, "")}#page=${page}` : viewUrl);

/** The page text, line breaks kept, the quoted passage marked when it is printed there. */
export function DocumentPageText({ text, quote }: { text: string; quote: string | null }) {
  const at = quote ? findQuote(text, quote) : null;
  return (
    <div className="flex flex-col gap-3">
      {quote && !at && <p className="text-sm text-kumo-subtle">The quoted passage is not printed on this page: “{quote}”</p>}
      <div className="whitespace-pre-wrap rounded-lg px-5 py-4 text-sm leading-relaxed text-kumo-default ring-1 ring-kumo-hairline">
        {at ? (
          <>
            {text.slice(0, at[0])}
            <mark className="rounded-sm bg-kumo-warning-tint px-0.5 text-kumo-strong">{text.slice(at[0], at[1])}</mark>
            {text.slice(at[1])}
          </>
        ) : (
          text
        )}
      </div>
    </div>
  );
}
