import type { FetchOutcome, SourceContext } from "./types";

/**
 * GET a URL and turn the answer into a bronze-ready outcome. `url` may carry a secret; `request` is what gets
 * stored and must not. A non-2xx answer is a failed fetch whose body is still kept.
 */
export async function getJson(
  ctx: SourceContext,
  url: string,
  request: Record<string, unknown>,
  init?: RequestInit,
): Promise<FetchOutcome> {
  const res = await ctx.fetch(url, init);
  const text = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = undefined;
  }
  const base = {
    request,
    httpStatus: res.status,
    ...(payload === undefined ? { payloadText: text } : { payload }),
  };
  if (!res.ok) return { ...base, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  if (payload === undefined) return { ...base, error: "answer is not JSON" };
  return base;
}

/** True for symbols listed in the US (no exchange suffix), the only ones FMP and Finnhub free tiers answer. */
export function isUsSymbol(symbol: string): boolean {
  return !symbol.includes(".");
}

/** GET a URL whose answer is text (RSS, HTML). A non-2xx answer is a failed fetch whose body is still kept. */
export async function getText(
  ctx: SourceContext,
  url: string,
  request: Record<string, unknown>,
  init?: RequestInit,
): Promise<FetchOutcome> {
  const res = await ctx.fetch(url, init);
  const payloadText = await res.text();
  const base = { request, httpStatus: res.status, payloadText };
  if (!res.ok) return { ...base, error: `HTTP ${res.status}: ${payloadText.slice(0, 200)}` };
  return base;
}
