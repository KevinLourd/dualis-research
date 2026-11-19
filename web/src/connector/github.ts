import { REPO } from "@/content/dispatch";

/**
 * GitHub side of the Claude connector: reads main through the API (fresh, unlike raw.githubusercontent.com's 5-minute
 * CDN, so Claude reads back what it just changed), starts desktop-edit.yml and follows its run. Every call uses the
 * console's DRAFT_DISPATCH_TOKEN (fine-grained, this repo: Actions read/write; the public repo's contents are
 * readable by any token). The console never writes git itself.
 */
export const EDIT_WORKFLOW = "desktop-edit.yml";
export const SITE_URL = "https://dualisresearch.com";
const API = `https://api.github.com/repos/${REPO}`;

type Env = Record<string, string | undefined>;

async function gh(path: string, env: Env, f: typeof fetch, init: RequestInit & { raw?: boolean } = {}): Promise<Response> {
  const token = env.DRAFT_DISPATCH_TOKEN;
  if (!token) throw new Error("DRAFT_DISPATCH_TOKEN is not set on the console: it cannot reach GitHub");
  const res = await f(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      accept: init.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "dualis-console",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function json<T>(path: string, env: Env, f: typeof fetch): Promise<T> {
  const res = await gh(path, env, f);
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** A file of main as text. Throws on a missing file. */
export async function readFile(path: string, env: Env = process.env, f: typeof fetch = fetch): Promise<string> {
  const res = await gh(`/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=main`, env, f, { raw: true });
  if (res.status === 404) throw new Error(`No file ${path} on main`);
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
  return res.text();
}

type TreeEntry = { path: string; type: string; sha: string };
const blobCache = new Map<string, string>();

/** Every text file of main under `prefix` matching `test`, read once per blob (a file that did not change is not refetched). */
export async function readTree(prefix: string, test: (path: string) => boolean, env: Env = process.env, f: typeof fetch = fetch): Promise<{ path: string; text: string }[]> {
  const tree = await json<{ tree: TreeEntry[] }>(`/git/trees/main?recursive=1`, env, f);
  const entries = tree.tree.filter((e) => e.type === "blob" && e.path.startsWith(prefix) && test(e.path));
  return Promise.all(
    entries.map(async (e) => {
      if (!blobCache.has(e.sha)) {
        const blob = await json<{ content: string; encoding: string }>(`/git/blobs/${e.sha}`, env, f);
        blobCache.set(e.sha, Buffer.from(blob.content, blob.encoding === "base64" ? "base64" : "utf8").toString("utf8"));
      }
      return { path: e.path, text: blobCache.get(e.sha)! };
    }),
  );
}

export type Match = { path: string; line: number; text: string };

/** Where `query` appears in `files`, case and whitespace aside (JSX often wraps a sentence over several lines). */
export function findText(files: { path: string; text: string }[], query: string, limit = 30): Match[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "gi");
  const out: Match[] = [];
  for (const file of files) {
    const lines = file.text.split("\n");
    for (const m of file.text.matchAll(pattern)) {
      const start = file.text.slice(0, m.index).split("\n").length;
      const end = start + m[0].split("\n").length - 1;
      out.push({ path: file.path, line: start, text: lines.slice(start - 1, end).map((l) => l.trim()).join(" ") });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Starts desktop-edit.yml for one change. */
export async function startChange(changeId: string, change: unknown, author: string, env: Env = process.env, f: typeof fetch = fetch): Promise<void> {
  const res = await gh(`/actions/workflows/${EDIT_WORKFLOW}/dispatches`, env, f, {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { change_id: changeId, change: JSON.stringify(change), author } }),
  });
  if (res.status !== 204) throw new Error(`GitHub refused to start ${EDIT_WORKFLOW}: ${res.status} ${await res.text()}`);
}

type Run = { id: number; display_title: string; status: string; conclusion: string | null; html_url: string; created_at: string };
type Job = { id: number; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] };

export type ChangeStatus =
  | { state: "starting" }
  | { state: "running"; run: string }
  | { state: "live"; commit: string; commitUrl: string; run: string; siteDeploy: string; site: string }
  | { state: "failed"; run: string; errors: string[] };

/** The run of one change, and once it finished, the commit on main or why it was refused. */
export async function changeStatus(changeId: string, env: Env = process.env, f: typeof fetch = fetch): Promise<ChangeStatus> {
  const runs = await json<{ workflow_runs: Run[] }>(`/actions/workflows/${EDIT_WORKFLOW}/runs?event=workflow_dispatch&per_page=30`, env, f);
  const run = runs.workflow_runs.find((r) => r.display_title === `Desktop edit ${changeId}`);
  if (!run) return { state: "starting" };
  if (run.status !== "completed") return { state: "running", run: run.html_url };
  if (run.conclusion === "success") {
    const commits = await json<{ sha: string; html_url: string; commit: { message: string } }[]>(`/commits?sha=main&per_page=50`, env, f);
    const commit = commits.find((c) => c.commit.message.includes(`[change ${changeId}]`));
    if (!commit) return { state: "failed", run: run.html_url, errors: ["The run finished but its commit is not on main: ask Kevin to look at the run"] };
    const deploys = await json<{ workflow_runs: Run[] }>(`/actions/workflows/deploy-site.yml/runs?per_page=5`, env, f);
    const deploy = deploys.workflow_runs.find((r) => r.created_at >= run.created_at);
    const siteDeploy = !deploy ? "starting" : deploy.status !== "completed" ? "running (about 3 minutes)" : deploy.conclusion === "success" ? "done" : `failed (${deploy.html_url})`;
    return { state: "live", commit: commit.sha.slice(0, 7), commitUrl: commit.html_url, run: run.html_url, siteDeploy, site: SITE_URL };
  }
  const jobs = await json<{ jobs: Job[] }>(`/actions/runs/${run.id}/jobs`, env, f);
  const errors: string[] = [];
  for (const job of jobs.jobs.filter((j) => j.conclusion === "failure")) {
    const log = await gh(`/actions/jobs/${job.id}/logs`, env, f);
    if (log.ok) errors.push(...errorLines(await log.text()));
    if (!errors.length) errors.push(`Step failed: ${job.steps?.find((s) => s.conclusion === "failure")?.name ?? "unknown"}`);
  }
  return { state: "failed", run: run.html_url, errors: errors.length ? errors : [`The run ended ${run.conclusion}`] };
}

/** The `::error::` lines of a job log (GitHub prints them as `##[error]`), deduplicated, without timestamps. */
export function errorLines(log: string): string[] {
  const out = log
    .split("\n")
    // eslint-disable-next-line no-control-regex
    .map((l) => /##\[error\](.*)$/.exec(l.replace(/\x1b\[[0-9;]*m/g, ""))?.[1]?.trim())
    .filter((l): l is string => !!l && !/^Process completed with exit code/.test(l) && !l.startsWith("::error file="));
  return [...new Set(out)].slice(0, 20);
}
