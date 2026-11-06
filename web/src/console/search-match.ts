/**
 * Table search: a row matches when every word of the query appears somewhere in its text, whatever the case or
 * accents ("sk hynix" finds "SK Hynix Inc.", "nikkei" finds "Nikkéi"). Pure so it is tested without a browser.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function queryWords(query: string): string[] {
  return normalize(query).split(" ").filter(Boolean);
}

export function rowMatches(rowText: string, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = normalize(rowText);
  return words.every((w) => text.includes(w));
}
