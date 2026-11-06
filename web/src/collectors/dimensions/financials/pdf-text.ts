import { extractText, getDocumentProxy } from "unpdf";

/** Text of every page of a PDF. Node only: loaded by URL from sources.ts so no bundler ever pulls pdf.js in. */
export async function pdfPages(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return text as string[];
}
