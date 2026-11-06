/**
 * Starts the draft writer now (GitHub Actions `draft.yml`) instead of waiting for the next daily collect: the console
 * runs on Workers, Claude and the collectors run in Actions. Needs `DRAFT_DISPATCH_TOKEN` (fine-grained token, this
 * repo only, Actions: read and write) on the Worker; without it the request waits for the next collect.
 */
export const DRAFT_WORKFLOW = "draft.yml";
export const REPO = "KevinLourd/dualis-research";

export function canDispatch(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.DRAFT_DISPATCH_TOKEN;
}

export async function dispatchDraftWriter(env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch): Promise<boolean> {
  const token = env.DRAFT_DISPATCH_TOKEN;
  if (!token) return false;
  const res = await f(`https://api.github.com/repos/${REPO}/actions/workflows/${DRAFT_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "dualis-console" },
    body: JSON.stringify({ ref: "main" }),
  });
  if (res.status !== 204) throw new Error(`GitHub refused to start the draft writer: ${res.status} ${await res.text()}`);
  return true;
}
