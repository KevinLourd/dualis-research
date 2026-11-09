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
  if (!canDispatch(env)) return false;
  await dispatchWorkflow(DRAFT_WORKFLOW, {}, env, f);
  return true;
}

/** Starts a workflow of this repo on main with the console's dispatch token. Throws when GitHub refuses. */
export async function dispatchWorkflow(
  workflow: string,
  inputs: Record<string, string>,
  env: Record<string, string | undefined> = process.env,
  f: typeof fetch = fetch,
): Promise<void> {
  const token = env.DRAFT_DISPATCH_TOKEN;
  if (!token) throw new Error("DRAFT_DISPATCH_TOKEN is not set on the console: it cannot start a GitHub workflow");
  const res = await f(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "dualis-console" },
    body: JSON.stringify({ ref: "main", inputs }),
  });
  if (res.status !== 204) throw new Error(`GitHub refused to start ${workflow}: ${res.status} ${await res.text()}`);
}
