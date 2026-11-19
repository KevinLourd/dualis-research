import { randomBytes } from "node:crypto";
import { COLOR_VALUE } from "@/design/color";
import { changeStatus, findText, readFile, readTree, startChange, type ChangeStatus } from "./github";

/**
 * The tools Thierry's Claude (Claude Desktop) calls through the connector. Reads come from GitHub main; every write
 * starts desktop-edit.yml, which applies it, regenerates, runs the site's tests, commits to main and redeploys the
 * site. The same rules as the workflow's script (.github/scripts/desktop-edit.mjs) are checked here first, so a
 * wrong edit is refused in the chat, before any run.
 */
type Env = Record<string, string | undefined>;
export type ToolContext = { author: string; env?: Env; fetch?: typeof fetch; waitMs?: number };
type Result = { text: string; isError?: boolean };

/** Same as editablePath in .github/scripts/desktop-edit.mjs (a test keeps them equal). */
export function editablePath(path: unknown): boolean {
  if (typeof path !== "string" || path.includes("..") || path.startsWith("/")) return false;
  if (path === "design/tokens.json") return true;
  if (/^\.claude\/skills\/[a-z0-9-]+\/[^/]+\.(md|py)$/.test(path)) return true;
  if (!/^site\/src\/.+\.(tsx|ts|css)$/.test(path)) return false;
  return path !== "site/src/app/tokens.css" && !path.endsWith(".test.ts");
}

/** Served by the connector itself (read_skill): Thierry uploads nothing (Kevin 2026-11-18). */
export const SKILLS = ["dualis-charts", "site-wording"] as const;

const SUMMARY = { type: "string", description: "One line in English saying what changed, for the commit (e.g. \"Home: new line under the title\")." };

export const TOOLS = [
  {
    name: "read_skill",
    description:
      "Read a Dualis skill from GitHub main, always the latest: dualis-charts (how to draw any Dualis chart; also returns dualis_charts.py, save it next to your script and import it) or site-wording (how to change the website's words). Read it before drawing a chart or changing site text. No skill upload needed.",
    inputSchema: { type: "object", properties: { name: { type: "string", enum: ["dualis-charts", "site-wording"] } }, required: ["name"], additionalProperties: false },
  },
  {
    name: "read_design_system",
    description:
      "Read the Dualis design system as it is on GitHub main now: design/tokens.json (colours light and dark, type, spacing, radius, chart themes and rules, logos). Call it before changing a token, to see the exact current text and token names.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "set_colours",
    description:
      "Change one or more colour tokens of the design system (design/tokens.json) and publish it: the files the site and console read are regenerated, committed to GitHub main, and the website redeploys (about 3 minutes). Use it right after Thierry approves a colour. Values: #RRGGBB or rgba(r, g, b, a). Give light and/or dark.",
    inputSchema: {
      type: "object",
      properties: {
        summary: SUMMARY,
        colours: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: { name: { type: "string", description: "Token name, e.g. chart-line" }, light: { type: "string" }, dark: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "colours"],
      additionalProperties: false,
    },
  },
  {
    name: "find_site_text",
    description:
      "Find where words appear in the website's source (site/src) or the design tokens, on GitHub main. Returns file, line and the line's text. Use it to locate a sentence Thierry wants to change, then read_file for the exact text.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "A few words of the text, as shown on the site." } }, required: ["text"], additionalProperties: false },
  },
  {
    name: "read_file",
    description: "Read one file of the website's source (site/src/...), a skill (.claude/skills/<name>/SKILL.md) or design/tokens.json, exactly as it is on GitHub main now.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "e.g. site/src/app/page.tsx" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "edit_files",
    description:
      "Publish a change to the website's words, to design/tokens.json (chart style, type, any token) or to a skill (.claude/skills/<name>/SKILL.md, dualis_charts.py; it applies at once to every Claude and writer that reads it): each edit replaces one exact piece of text (copied from read_file, appearing once in the file) with the new text. It is committed to GitHub main after the site's copy tests and type check pass, and the website redeploys (about 3 minutes). Use it right after Thierry approves the change. Change only the words, keep code and quotes intact.",
    inputSchema: {
      type: "object",
      properties: {
        summary: SUMMARY,
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "site/src/... or design/tokens.json" },
              find: { type: "string", description: "Exact current text, copied from read_file, appearing once." },
              replace: { type: "string", description: "The new text." },
            },
            required: ["path", "find", "replace"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "edits"],
      additionalProperties: false,
    },
  },
  {
    name: "change_status",
    description:
      "Follow a change started by set_colours or edit_files: waits up to about 45 seconds, then says running, live (with the GitHub commit link and the site deploy state) or refused (with why). Call it again while it is running.",
    inputSchema: { type: "object", properties: { change_id: { type: "string" } }, required: ["change_id"], additionalProperties: false },
  },
] as const;

function needSummary(summary: unknown): string {
  if (typeof summary !== "string" || !summary.trim()) throw new Error("Give a one-line summary of the change");
  if (summary.length > 120 || summary.includes("\n")) throw new Error("The summary must be one line of at most 120 characters");
  return summary.trim();
}

function countOf(text: string, find: string): number {
  let n = 0;
  for (let i = text.indexOf(find); i >= 0; i = text.indexOf(find, i + 1)) n++;
  return n;
}

async function start(change: object, ctx: ToolContext): Promise<Result> {
  const id = randomBytes(5).toString("hex");
  await startChange(id, change, ctx.author, ctx.env, ctx.fetch);
  return {
    text: `Change ${id} started: GitHub applies it, runs the site's checks and commits it to main (about 1-2 minutes), then the site redeploys (about 3 minutes). Call change_status with change_id "${id}" now and tell Thierry the result with the commit link.`,
  };
}

function describe(s: ChangeStatus): Result {
  if (s.state === "starting") return { text: "Starting: GitHub has not picked the change up yet. Call change_status again." };
  if (s.state === "running") return { text: `Running the checks and the commit (${s.run}). Call change_status again.` };
  if (s.state === "failed") return { text: `Refused, nothing was published.\n${s.errors.map((e) => `- ${e}`).join("\n")}\nRun: ${s.run}`, isError: true };
  const deploy = s.siteDeploy === "done" ? `The website is live with it: ${s.site}` : `Website deploy: ${s.siteDeploy}; it shows on ${s.site} once done.`;
  return { text: `Committed to GitHub main: ${s.commitUrl}\n${deploy}` };
}

export async function callTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<Result> {
  const { env, fetch: f } = ctx;
  switch (name) {
    case "read_skill": {
      const skill = String(args.name);
      if (!(SKILLS as readonly string[]).includes(skill)) throw new Error(`Skills: ${SKILLS.join(", ")}`);
      const body = await readFile(`.claude/skills/${skill}/SKILL.md`, env, f);
      if (skill !== "dualis-charts") return { text: body };
      const helper = await readFile(".claude/skills/dualis-charts/dualis_charts.py", env, f);
      return { text: `${body}\n\n--- dualis_charts.py (save it as dualis_charts.py; it reads design/tokens.json live from GitHub) ---\n${helper}` };
    }

    case "read_design_system":
      return { text: await readFile("design/tokens.json", env, f) };

    case "read_file": {
      if (!editablePath(args.path)) throw new Error(`Readable files: design/tokens.json, the skills under .claude/skills/ and the site's source under site/src/ (pages, components, styles, model). Not: ${String(args.path)}`);
      return { text: await readFile(String(args.path), env, f) };
    }

    case "find_site_text": {
      const text = String(args.text ?? "");
      const files = await readTree("", (p) => editablePath(p), env, f);
      const matches = findText(files, text);
      if (!matches.length) return { text: `"${text}" is not in the site's source or the design tokens on main. Try fewer words.` };
      return { text: matches.map((m) => `${m.path}:${m.line}  ${m.text}`).join("\n") };
    }

    case "set_colours": {
      const summary = needSummary(args.summary);
      const colours = (Array.isArray(args.colours) ? args.colours : []) as { name: string; light?: string; dark?: string }[];
      if (!colours.length) throw new Error("Give at least one colour");
      const tokens = JSON.parse(await readFile("design/tokens.json", env, f)) as { color: { tokens: { name: string }[] } };
      const names = tokens.color.tokens.map((t) => t.name);
      for (const c of colours) {
        if (!names.includes(c.name)) throw new Error(`Unknown colour token "${c.name}". Known: ${names.join(", ")}`);
        if (c.light === undefined && c.dark === undefined) throw new Error(`${c.name}: give a light and/or a dark value`);
        for (const v of [c.light, c.dark]) if (v !== undefined && !COLOR_VALUE.test(v)) throw new Error(`"${v}" is not a colour: use #RRGGBB or rgba(r, g, b, a)`);
      }
      return start({ summary, colours }, ctx);
    }

    case "edit_files": {
      const summary = needSummary(args.summary);
      const edits = (Array.isArray(args.edits) ? args.edits : []) as { path: string; find: string; replace: string }[];
      if (!edits.length) throw new Error("Give at least one edit");
      const byPath = new Map<string, string>();
      for (const e of edits) {
        if (!editablePath(e.path)) throw new Error(`Not editable from Claude Desktop: ${e.path}. Allowed: design/tokens.json, .claude/skills/<skill>/*.md|py and the site's source under site/src/.`);
        if (typeof e.find !== "string" || !e.find || typeof e.replace !== "string") throw new Error(`${e.path}: each edit needs find and replace texts`);
        if (!byPath.has(e.path)) byPath.set(e.path, await readFile(e.path, env, f));
        const n = countOf(byPath.get(e.path)!, e.find);
        if (n === 0) throw new Error(`${e.path}: text not found on main: ${JSON.stringify(e.find.slice(0, 120))}. Read the file again with read_file and copy the exact text.`);
        if (n > 1) throw new Error(`${e.path}: the text appears ${n} times: include more of the line around it.`);
        byPath.set(e.path, byPath.get(e.path)!.replace(e.find, () => e.replace));
      }
      if (byPath.has("design/tokens.json")) {
        try {
          JSON.parse(byPath.get("design/tokens.json")!);
        } catch (err) {
          throw new Error(`design/tokens.json would no longer be valid JSON: ${(err as Error).message}`);
        }
      }
      return start({ summary, edits }, ctx);
    }

    case "change_status": {
      const id = String(args.change_id ?? "");
      if (!/^[0-9a-f]{10}$/.test(id)) throw new Error("change_id is the 10-character id set_colours or edit_files returned");
      const deadline = Date.now() + (ctx.waitMs ?? 45_000);
      for (;;) {
        const s = await changeStatus(id, env, f);
        const settled = s.state === "failed" || (s.state === "live" && s.siteDeploy !== "starting");
        if (settled || Date.now() >= deadline) return describe(s);
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

