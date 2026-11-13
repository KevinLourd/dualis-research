import { dispatchFor, REPO } from "./plan.ts";

interface Env {
  /** Fine-grained GitHub token, this repo only, Actions read/write (the console's DRAFT_DISPATCH_TOKEN). */
  DISPATCH_TOKEN: string;
}

export default {
  async scheduled(controller: { cron: string }, env: Env): Promise<void> {
    if (!env.DISPATCH_TOKEN) throw new Error("DISPATCH_TOKEN is not set on dualis-cron: no collect can start");
    const { workflow, body } = dispatchFor(controller.cron);
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.DISPATCH_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "dualis-cron",
      },
      body: JSON.stringify(body),
    });
    if (res.status !== 204) throw new Error(`GitHub refused to start ${workflow} for "${controller.cron}": ${res.status} ${await res.text()}`);
    console.log(`started ${workflow} for "${controller.cron}"`);
  },
};
