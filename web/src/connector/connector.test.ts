import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { errorLines, findText } from "./github";
import { handleRpc } from "./mcp";
import { approve, bearerUser, checkAuthorize, exchange, OAuthError, registerClient, seal, unseal } from "./oauth";
import { callTool, editablePath } from "./tools";

const ROOT = join(__dirname, "../../..");
type Script = {
  editablePath: (p: unknown) => boolean;
  parseChange: (raw: unknown) => { summary: string; edits: { path: string; find: string; replace: string }[]; colours: { name: string; light?: string; dark?: string }[] };
  applyChange: (change: unknown, root: string) => Promise<{ design: boolean; site: boolean; paths: string[] }>;
};
// The workflow's script is plain Node with no dependency: the test imports it as is.
const script = (await import(/* @vite-ignore */ join(ROOT, ".github/scripts/desktop-edit.mjs"))) as Script;

beforeAll(() => {
  process.env.MCP_OAUTH_KEY = "test-key-not-a-secret";
});

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const verifier = "a-long-random-verifier-string-of-43-chars-or-more-xxxxxxxx";
const challenge = createHash("sha256").update(verifier).digest("base64url");

function authorize(clientId: string, extra: Record<string, string> = {}) {
  return checkAuthorize(
    new URLSearchParams({ client_id: clientId, redirect_uri: CLAUDE, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1", ...extra }),
  );
}

describe("connector OAuth", () => {
  it("registers Claude, signs Thierry in, trades the code with PKCE and refreshes", () => {
    const client = registerClient({ redirect_uris: [CLAUDE], client_name: "Claude" });
    const back = new URL(approve(authorize(client.client_id), "user_123"));
    expect(back.origin + back.pathname).toBe(CLAUDE);
    expect(back.searchParams.get("state")).toBe("s1");
    const tokens = exchange(
      new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, code_verifier: verifier, client_id: client.client_id, redirect_uri: CLAUDE }),
    );
    expect(bearerUser(`Bearer ${tokens.access_token}`)).toBe("user_123");
    const refreshed = exchange(new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }));
    expect(bearerUser(`Bearer ${refreshed.access_token}`)).toBe("user_123");
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
  });

  it("refuses a wrong verifier, a refresh token used as access token and a foreign callback", () => {
    const client = registerClient({ redirect_uris: [CLAUDE] });
    const code = new URL(approve(authorize(client.client_id), "u")).searchParams.get("code")!;
    expect(() => exchange(new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: "wrong" }))).toThrow(OAuthError);
    const t = exchange(new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier }));
    expect(bearerUser(`Bearer ${t.refresh_token}`)).toBeNull();
    expect(bearerUser("Bearer forged")).toBeNull();
    expect(() => registerClient({ redirect_uris: ["https://evil.example/cb"] })).toThrow(/Claude's callback/);
    expect(() => authorize(client.client_id, { redirect_uri: "https://claude.com/api/mcp/auth_callback" })).toThrow(/not registered/);
  });

  it("accepts Claude Code's loopback on any port", () => {
    const client = registerClient({ redirect_uris: ["http://localhost/callback"] });
    expect(authorize(client.client_id, { redirect_uri: "http://localhost:3118/callback" }).redirectUri).toBe("http://localhost:3118/callback");
  });

  it("refuses an expired token", () => {
    expect(unseal(seal({ k: "access", exp: 1, u: "u" }), "access")).toBeNull();
  });
});

describe("what the connector may edit", () => {
  it.each([
    ["design/tokens.json", true],
    ["site/src/app/page.tsx", true],
    ["site/src/lib/model.ts", true],
    ["site/src/app/globals.css", true],
    ["site/src/app/tokens.css", false],
    ["site/src/lib/copy.test.ts", false],
    ["site/src/../../.github/workflows/deploy.yml", false],
    [".github/workflows/deploy.yml", false],
    ["web/src/app/page.tsx", false],
    ["site/package.json", false],
    [".claude/skills/dualis-charts/SKILL.md", true],
    [".claude/skills/dualis-charts/dualis_charts.py", true],
    [".claude/skills/x/../../web/src/db/client.ts", false],
    [".claude/settings.json", false],
  ])("%s -> %s, same in the console and in the workflow's script", (path, ok) => {
    expect(editablePath(path)).toBe(ok);
    expect(script.editablePath(path)).toBe(ok);
  });
});

describe("the workflow's script", () => {
  function tempRepo() {
    const root = mkdtempSync(join(tmpdir(), "desktop-edit-"));
    for (const dir of ["design", "site/src/app"]) mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(join(ROOT, "design/build.mjs"), join(root, "design/build.mjs"));
    copyFileSync(join(ROOT, "design/tokens.json"), join(root, "design/tokens.json"));
    writeFileSync(join(root, "site/src/app/page.tsx"), "<h1>Old title</h1>\n<p>Old line</p>\n");
    return root;
  }

  it("replaces text and sets a colour", async () => {
    const root = tempRepo();
    const change = script.parseChange(
      JSON.stringify({ summary: "Home: new title", edits: [{ path: "site/src/app/page.tsx", find: "Old title", replace: "New title" }], colours: [{ name: "chart-line", light: "#112233" }] }),
    );
    const touched = await script.applyChange(change, root);
    expect(touched).toMatchObject({ design: true, site: true });
    expect(readFileSync(join(root, "site/src/app/page.tsx"), "utf8")).toContain("New title");
    const tokens = JSON.parse(readFileSync(join(root, "design/tokens.json"), "utf8")) as { color: { tokens: { name: string; value: { light: string } }[] } };
    expect(tokens.color.tokens.find((t) => t.name === "chart-line")?.value.light).toBe("#112233");
  });

  it("refuses text that is missing or appears twice, and files outside the site", async () => {
    const root = tempRepo();
    writeFileSync(join(root, "site/src/app/page.tsx"), "Old Old");
    await expect(script.applyChange(script.parseChange({ summary: "x", edits: [{ path: "site/src/app/page.tsx", find: "Old", replace: "New" }] }), root)).rejects.toThrow(/more than once/);
    await expect(script.applyChange(script.parseChange({ summary: "x", edits: [{ path: "site/src/app/page.tsx", find: "Gone", replace: "New" }] }), root)).rejects.toThrow(/not found/);
    expect(() => script.parseChange({ summary: "x", edits: [{ path: ".github/workflows/ci.yml", find: "a", replace: "b" }] })).toThrow(/Not editable/);
    expect(() => script.parseChange({ summary: "", edits: [] })).toThrow(/summary/);
  });
});

describe("tools", () => {
  const page = "export default function Home() {\n  return <p>\n    Long and short ideas in\n    under-covered global equities\n  </p>;\n}\n";

  function fakeGitHub() {
    const calls: { url: string; body?: string }[] = [];
    const f = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body as string | undefined });
      if (u.endsWith("/dispatches")) return new Response(null, { status: 204 });
      if (u.includes("/contents/site/src/app/page.tsx")) return new Response(page);
      if (u.includes("/contents/design/tokens.json")) return new Response(readFileSync(join(ROOT, "design/tokens.json"), "utf8"));
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    return { f, calls, ctx: { author: "Thierry", env: { DRAFT_DISPATCH_TOKEN: "t" }, fetch: f } };
  }

  it("edit_files checks the text on main, then starts the workflow with the change", async () => {
    const { calls, ctx } = fakeGitHub();
    const r = await callTool("edit_files", { summary: "Home line", edits: [{ path: "site/src/app/page.tsx", find: "under-covered global equities", replace: "global small caps" }] }, ctx);
    expect(r.text).toMatch(/Change [0-9a-f]{10} started/);
    const dispatch = calls.find((c) => c.url.endsWith("/actions/workflows/desktop-edit.yml/dispatches"))!;
    const inputs = JSON.parse(dispatch.body!).inputs as { change: string; author: string };
    expect(inputs.author).toBe("Thierry");
    expect(JSON.parse(inputs.change).edits[0].replace).toBe("global small caps");
  });

  it("edit_files refuses text that is not on main, before any run", async () => {
    const { calls, ctx } = fakeGitHub();
    await expect(callTool("edit_files", { summary: "x", edits: [{ path: "site/src/app/page.tsx", find: "not there", replace: "y" }] }, ctx)).rejects.toThrow(/not found on main/);
    expect(calls.some((c) => c.url.endsWith("/dispatches"))).toBe(false);
  });

  it("set_colours refuses an unknown token or a value that is not a colour", async () => {
    const { ctx } = fakeGitHub();
    await expect(callTool("set_colours", { summary: "x", colours: [{ name: "nope", light: "#000000" }] }, ctx)).rejects.toThrow(/Unknown colour token/);
    await expect(callTool("set_colours", { summary: "x", colours: [{ name: "chart-line", light: "purple" }] }, ctx)).rejects.toThrow(/not a colour/);
    const r = await callTool("set_colours", { summary: "Chart line darker", colours: [{ name: "chart-line", light: "#6D28D9", dark: "#A78BFA" }] }, ctx);
    expect(r.text).toMatch(/started/);
  });

  it("finds a sentence JSX wraps over two lines", () => {
    expect(findText([{ path: "site/src/app/page.tsx", text: page }], "ideas in under-covered")).toEqual([
      { path: "site/src/app/page.tsx", line: 3, text: "Long and short ideas in under-covered global equities" },
    ]);
  });

  it("reads why a run refused the change from its log", () => {
    const log = "2026-11-18T10:00:00Z ##[error]site/src/app/page.tsx: text not found\n2026-11-18T10:00:01Z ##[error]Process completed with exit code 1.\n";
    expect(errorLines(log)).toEqual(["site/src/app/page.tsx: text not found"]);
    expect(errorLines("x ##[error]\x1b[31mAssertionError\x1b[39m: expected a\nx ##[error]::error file=/a.ts,line=1::AssertionError\n")).toEqual(["AssertionError: expected a"]);
  });
});

describe("MCP", () => {
  const ctx = { author: "Kevin", userId: "user_1" };
  it("initializes, lists the tools and ignores notifications", async () => {
    const init = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx)) as { result: { protocolVersion: string; instructions: string } };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.instructions).toMatch(/publish it at once/);
    const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx)) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual([
      "read_skill", "read_design_system", "set_colours", "find_site_text", "read_file", "edit_files", "change_status",
      "list_ideas", "draft_idea", "list_drafts", "set_draft_status", "update_outreach",
    ]);
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx)).toBeNull();
  });

  it("returns a tool's refusal as a tool error Claude can read", async () => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_file", arguments: { path: ".env" } } }, ctx)) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/Readable files/);
  });
});
