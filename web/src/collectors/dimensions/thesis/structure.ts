/** No em or en dash in anything we show (house style); a deterministic cleanup after the writer. */
export function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, (m) => (/\s/.test(m) ? ", " : "-"));
}
