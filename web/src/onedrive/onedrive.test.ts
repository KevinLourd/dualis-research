import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onedrive } from "@/collectors/dimensions/onedrive";
import { onedriveFilings } from "@/collectors/dimensions/onedrive-filings";
import { runDimension } from "@/collectors/runner";
import type { SourceContext } from "@/collectors/types";
import * as gold from "@/db/schema/gold";
import { onedriveConnection, onedriveDocuments, onedriveFiles, onedriveFolders } from "@/db/schema/onedrive";
import { filings, tickers } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { accessToken, pollDeviceLogin, setRoot, startDeviceLogin } from "./auth";
import { FILINGS_FOLDER, filingFileName, isCoreFiling, matchFolder } from "./rules";

const env = { AZURE_CLIENT_ID: "client-id", AZURE_TENANT_ID: "tenant-id", ONEDRIVE_TOKEN_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) };

type Node = { id: string; name: string; parentId: string | null; folder: boolean; content?: string; mime?: string };

/** An in-memory Microsoft identity platform + Graph drive, and the registries' filing downloads. */
class FakeMicrosoft {
  nodes = new Map<string, Node>();
  calls: { method: string; path: string; parentId?: string; name?: string }[] = [];
  private seq = 0;
  private pendingPolls = 1;
  issuedRefresh = "";
  private refreshCount = 0;

  constructor() {
    this.add({ id: "root", name: "root", parentId: null, folder: true });
  }

  add(n: Omit<Node, "id"> & { id?: string }): Node {
    const node = { ...n, id: n.id ?? `item-${++this.seq}` };
    this.nodes.set(node.id, node);
    return node;
  }
  folder(parentId: string, name: string) {
    return this.add({ parentId, name, folder: true });
  }
  file(parentId: string, name: string, content: string) {
    return this.add({ parentId, name, folder: false, content, mime: "text/plain" });
  }
  childrenOf(id: string) {
    return [...this.nodes.values()].filter((n) => n.parentId === id);
  }
  find(parentId: string, name: string) {
    return this.childrenOf(parentId).find((n) => n.name.toLowerCase() === name.toLowerCase());
  }
  private item(n: Node) {
    return {
      id: n.id,
      name: n.name,
      size: n.content?.length ?? 0,
      webUrl: `https://duality-my.sharepoint.com/${n.id}`,
      lastModifiedDateTime: "2026-11-01T10:00:00Z",
      ...(n.folder ? { folder: { childCount: this.childrenOf(n.id).length } } : { file: { mimeType: n.mime } }),
      parentReference: { id: n.parentId ?? undefined },
    };
  }

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (url.host === "login.microsoftonline.com") {
      expect(url.pathname.startsWith("/tenant-id/oauth2/v2.0/")).toBe(true);
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("client_id")).toBe("client-id");
      if (url.pathname.endsWith("/devicecode")) {
        expect(form.get("scope")).toBe("openid profile offline_access Files.ReadWrite");
        return json({ device_code: "secret-device-code", user_code: "ABCD-1234", verification_uri: "https://microsoft.com/devicelogin", expires_in: 900, interval: 5 });
      }
      if (form.get("grant_type") === "urn:ietf:params:oauth:grant-type:device_code") {
        expect(form.get("device_code")).toBe("secret-device-code");
        if (this.pendingPolls-- > 0) return json({ error: "authorization_pending", error_description: "pending" }, 400);
        this.issuedRefresh = "rt-0";
        const idToken = `x.${btoa(JSON.stringify({ preferred_username: "thierry@example.com" })).replace(/=+$/, "")}.y`;
        return json({ access_token: "at-0", refresh_token: "rt-0", id_token: idToken, scope: "Files.ReadWrite" });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (form.get("refresh_token") !== this.issuedRefresh) return json({ error: "invalid_grant", error_description: "revoked" }, 400);
        this.issuedRefresh = `rt-${++this.refreshCount}`;
        return json({ access_token: `at-${this.refreshCount}`, refresh_token: this.issuedRefresh });
      }
      throw new Error(`unexpected token call ${String(init?.body)}`);
    }

    if (url.host === "graph.microsoft.com") {
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer at-\d+$/);
      const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ""));
      const upload = path.match(/^\/me\/drive\/items\/([^:]+):\/(.+):\/content$/);
      if (method === "PUT" && upload) {
        const [, parentId, name] = upload;
        this.calls.push({ method, path, parentId, name });
        expect(url.searchParams.get("@microsoft.graph.conflictBehavior")).toBe("fail");
        if (this.find(parentId, name)) return json({ error: { code: "nameAlreadyExists" } }, 409);
        const body = init?.body as Uint8Array;
        return json(this.item(this.add({ parentId, name, folder: false, content: new TextDecoder().decode(body), mime: new Headers(init?.headers).get("content-type") ?? "" })), 201);
      }
      const children = path.match(/^\/me\/drive\/items\/([^/]+)\/children$/);
      if (method === "POST" && children) {
        const body = JSON.parse(String(init?.body));
        this.calls.push({ method, path, parentId: children[1], name: body.name });
        expect(body["@microsoft.graph.conflictBehavior"]).toBe("fail");
        if (this.find(children[1], body.name)) return json({ error: { code: "nameAlreadyExists" } }, 409);
        return json(this.item(this.folder(children[1], body.name)), 201);
      }
      this.calls.push({ method, path });
      if (method !== "GET") return json({ error: "not allowed in this fake" }, 405);
      if (children) {
        // Two items per page, to exercise @odata.nextLink.
        const all = this.childrenOf(children[1]);
        const skip = Number(url.searchParams.get("$skip") ?? 0);
        const next = skip + 2 < all.length ? `https://graph.microsoft.com/v1.0/me/drive/items/${children[1]}/children?$skip=${skip + 2}` : undefined;
        return json({ value: all.slice(skip, skip + 2).map((n) => this.item(n)), ...(next ? { "@odata.nextLink": next } : {}) });
      }
      const content = path.match(/^\/me\/drive\/items\/([^/]+)\/content$/);
      if (content) return new Response(this.nodes.get(content[1])!.content ?? "");
      const item = path.match(/^\/me\/drive\/items\/([^/]+)$/);
      if (item) return json(this.item(this.nodes.get(item[1])!));
      throw new Error(`unexpected graph path ${path}`);
    }

    if (url.host === "www.sec.gov") return new Response(`<html>${url.pathname}</html>`, { headers: { "content-type": "text/html" } });
    if (url.host === "disclosure2dl.edinet-fsa.go.jp") return new Response(`%PDF ${url.pathname}`, { headers: { "content-type": "application/pdf" } });
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
}

let db: Db;
let close: () => Promise<void>;
let ms: FakeMicrosoft;
let research: Node;
let monro: Node;
const ctx = (): SourceContext => ({ env, fetch: ms.fetch });

async function seedWatchlist() {
  const rows = [
    { symbol: "MNRO", market: "US" as const, name: "Monro, Inc.", aliases: [] },
    { symbol: "4238.T", market: "JP" as const, name: "Miraial Co., Ltd.", aliases: [] },
    { symbol: "CNRD", market: "US" as const, name: "Conrad Industries", aliases: ["Conrad Shipyard"] },
  ];
  for (const r of rows) {
    await db.insert(tickers).values({ symbol: r.symbol, market: r.market, aliases: r.aliases, sources: ["watchlist"], bronzeIds: [] });
    await db.insert(gold.tickers).values({ symbol: r.symbol, market: r.market, aliases: r.aliases, inPortfolio: false, position: "watch" });
    await db.insert(gold.companyProfiles).values({ symbol: r.symbol, name: r.name, provenance: {} });
  }
  const filing = (symbol: string, registry: string, key: string, form: string, title: string, filedAt: string, url: string) => ({
    symbol, registry, filingKey: key, form, title, filedAt: new Date(filedAt), url, language: "en", sources: [registry], bronzeIds: [],
  });
  await db.insert(filings).values([
    filing("MNRO", "sec", "0001-25-1", "10-K", "10-K annual report", "2026-05-20T12:00:00Z", "https://www.sec.gov/Archives/edgar/data/1/1/mnro-10k.htm"),
    filing("MNRO", "sec", "0001-25-2", "10-Q", "10-Q quarterly report", "2026-10-30T12:00:00Z", "https://www.sec.gov/Archives/edgar/data/1/2/mnro-10q.htm"),
    filing("MNRO", "sec", "0001-25-3", "8-K", "8-K: results of operations", "2026-10-29T12:00:00Z", "https://www.sec.gov/Archives/edgar/data/1/3/mnro-8k.htm"),
    filing("MNRO", "sec", "0001-15-1", "10-K", "10-K annual report", "2015-05-20T12:00:00Z", "https://www.sec.gov/Archives/edgar/data/1/0/old.htm"),
    filing("4238.T", "edinet", "S100ABC", "120", "有価証券報告書", "2026-06-25T06:00:00Z", "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100ABC.pdf"),
  ]);
}

/** Thierry's drive: a research root with a Monro folder (his model, notes, a transcript) and an unrelated folder. */
function seedDrive() {
  research = ms.folder("root", "Research");
  monro = ms.folder(research.id, "Monro (MNRO)");
  ms.file(monro.id, "MNRO model.xlsx", "xlsx-bytes");
  const notes = ms.folder(monro.id, "Notes");
  ms.file(notes.id, "Thesis.md", "Icahn owns 25%. Watch his other auto holdings.");
  const transcripts = ms.folder(monro.id, "Transcripts");
  ms.file(transcripts.id, "Q2 FY27 call.pdf", "pdf");
  ms.folder(research.id, "Old ideas");
}

async function connect() {
  const start = await startDeviceLogin(db, env, ms.fetch);
  expect(start.userCode).toBe("ABCD-1234");
  expect(await pollDeviceLogin(db, env, ms.fetch)).toEqual({ state: "pending" });
  expect(await pollDeviceLogin(db, env, ms.fetch)).toEqual({ state: "connected", account: "thierry@example.com" });
  await setRoot(db, { itemId: research.id, path: "/Research" });
}

beforeEach(async () => {
  ({ db, close } = await testDb());
  ms = new FakeMicrosoft();
  seedDrive();
  await seedWatchlist();
});
afterEach(async () => close());

describe("OneDrive sign-in", () => {
  it("device-code login stores the account and an encrypted, rotating refresh token", async () => {
    await connect();
    const [row] = await db.select().from(onedriveConnection);
    expect(row.account).toBe("thierry@example.com");
    expect(row.pendingDeviceCode).toBeNull();
    expect(row.refreshToken).toMatch(/^v1:/);
    expect(row.refreshToken).not.toContain("rt-0");
    expect(await accessToken(db, env, ms.fetch)).toBe("at-1");
    // The rotated token was saved: the next refresh presents rt-1, not the revoked rt-0.
    expect(await accessToken(db, env, ms.fetch)).toBe("at-2");
  });

  it("does nothing until Thierry is connected and has picked his folder", async () => {
    const report = await runDimension(db, onedrive, { trigger: "test", ctx: ctx() });
    expect(report.sources).toEqual([]);
    expect(ms.calls).toHaveLength(0);
  });

  it("says plainly when the sign-in was revoked", async () => {
    await connect();
    ms.issuedRefresh = "something-else";
    await expect(accessToken(db, env, ms.fetch)).rejects.toThrow(/Reconnect from Settings > OneDrive/);
  });
});

describe("onedrive dimension (read)", () => {
  it("lists the company folders tied to watchlist tickers into silver and gold", async () => {
    await connect();
    const report = await runDimension(db, onedrive, { trigger: "test", ctx: ctx() });
    expect(report.status).toBe("succeeded");
    const folders = await db.select().from(onedriveFolders);
    expect(folders.find((f) => f.name === "Monro (MNRO)")).toMatchObject({ symbol: "MNRO", matchedBy: "symbol" });
    expect(folders.find((f) => f.name === "Old ideas")?.symbol).toBeNull();
    const docs = await db.select().from(onedriveDocuments).where(eq(onedriveDocuments.symbol, "MNRO"));
    expect(docs.map((d) => [d.path, d.kind]).sort()).toEqual([
      ["MNRO model.xlsx", "model"],
      ["Notes/Thesis.md", "note"],
      ["Transcripts/Q2 FY27 call.pdf", "transcript"],
    ]);
    expect(docs.find((d) => d.kind === "note")?.excerpt).toContain("Icahn owns 25%");
    // Read-only: no write of any kind reached Graph.
    expect(ms.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("drops a file Thierry deleted from gold at the next listing", async () => {
    await connect();
    await runDimension(db, onedrive, { trigger: "test", ctx: ctx() });
    const model = ms.find(monro.id, "MNRO model.xlsx")!;
    ms.nodes.delete(model.id);
    await runDimension(db, onedrive, { trigger: "test", ctx: ctx() });
    const docs = await db.select().from(onedriveDocuments).where(eq(onedriveDocuments.symbol, "MNRO"));
    expect(docs.map((d) => d.name)).not.toContain("MNRO model.xlsx");
  });
});

describe("onedrive-filings dimension (write-back)", () => {
  it("creates the missing company folders, a Filings (Dualis) folder in each, and saves the core filings there", async () => {
    await connect();
    await runDimension(db, onedrive, { trigger: "test", ctx: ctx() });
    const report = await runDimension(db, onedriveFilings, { trigger: "test", ctx: ctx() });
    expect(report.status).toBe("succeeded");

    // MNRO: his folder reused, never a second one.
    expect(ms.childrenOf(research.id).filter((n) => /MNRO/.test(n.name))).toHaveLength(1);
    const mnroFilings = ms.find(monro.id, FILINGS_FOLDER)!;
    expect(ms.childrenOf(mnroFilings.id).map((n) => n.name).sort()).toEqual(["2026-05-20 10-K annual report.htm", "2026-10-30 10-Q quarterly report.htm"]);
    // 4238.T and CNRD had no folder: created with the company name and ticker.
    const miraial = ms.find(research.id, "Miraial Co., Ltd. (4238.T)")!;
    expect(ms.childrenOf(ms.find(miraial.id, FILINGS_FOLDER)!.id).map((n) => n.name)).toEqual(["2026-06-25 有価証券報告書.pdf"]);
    expect(ms.find(ms.find(research.id, "Conrad Industries (CNRD)")!.id, FILINGS_FOLDER)).toBeDefined();

    const saved = await db.select().from(onedriveDocuments).where(eq(onedriveDocuments.savedByDualis, true));
    expect(saved).toHaveLength(3);
    expect((await db.select().from(onedriveFolders).where(eq(onedriveFolders.matchedBy, "created"))).map((f) => f.symbol).sort()).toEqual(["4238.T", "CNRD"]);

    // A second run saves nothing new and creates no folder.
    const before = ms.calls.filter((c) => c.method !== "GET").length;
    await runDimension(db, onedrive, { trigger: "test", ctx: ctx() });
    await runDimension(db, onedriveFilings, { trigger: "test", ctx: ctx() });
    const writes = ms.calls.filter((c) => c.method !== "GET").slice(before);
    expect(writes.every((w) => w.method === "POST" && w.name === FILINGS_FOLDER)).toBe(true);
    expect(await db.select().from(onedriveDocuments).where(eq(onedriveDocuments.savedByDualis, true))).toHaveLength(3);
  });

  it("never overwrites a file already there, never deletes, never writes outside Filings (Dualis)", async () => {
    const mine = ms.folder(monro.id, FILINGS_FOLDER);
    const his = ms.file(mine.id, "2026-05-20 10-K annual report.htm", "THIERRY'S ANNOTATED COPY");
    await connect();
    await runDimension(db, onedrive, { trigger: "test", ctx: ctx() });
    const nodesBefore = new Set(ms.nodes.keys());
    await runDimension(db, onedriveFilings, { trigger: "test", ctx: ctx() });

    expect(ms.nodes.get(his.id)?.content).toBe("THIERRY'S ANNOTATED COPY");
    // Nothing that existed before is gone.
    for (const id of nodesBefore) expect(ms.nodes.has(id)).toBe(true);
    expect(ms.calls.filter((c) => !["GET", "POST", "PUT"].includes(c.method))).toEqual([]);
    // Every upload landed in a Filings (Dualis) folder; every folder creation is a company folder in the root or a Filings (Dualis).
    for (const c of ms.calls.filter((x) => x.method === "PUT")) expect(ms.nodes.get(c.parentId!)?.name).toBe(FILINGS_FOLDER);
    for (const c of ms.calls.filter((x) => x.method === "POST")) expect(c.parentId === research.id || c.name === FILINGS_FOLDER).toBe(true);
    // His copy now stands for the 10-K: recorded as his (source onedrive), never re-tried.
    const [row] = await db.select().from(onedriveFiles).where(eq(onedriveFiles.itemId, his.id));
    expect(row.filingId).not.toBeNull();
    expect(row.sources).toEqual(["onedrive"]);
    const puts = ms.calls.filter((c) => c.method === "PUT").length;
    await runDimension(db, onedriveFilings, { trigger: "test", ctx: ctx() });
    expect(ms.calls.filter((c) => c.method === "PUT").length).toBe(puts);
  });
});

describe("rules", () => {
  const names = [
    { symbol: "MNRO", name: "Monro, Inc.", aliases: [] },
    { symbol: "CNRD", name: "Conrad Industries", aliases: ["Conrad Shipyard"] },
    { symbol: "E.TO", name: "Enterprise Group", aliases: [] },
  ];
  it("ties a folder to one ticker by symbol, name or alias, never on a one-letter symbol", () => {
    expect(matchFolder("Monro (MNRO)", names)).toEqual({ symbol: "MNRO", matchedBy: "symbol" });
    expect(matchFolder("Monro", names)).toEqual({ symbol: "MNRO", matchedBy: "name" });
    expect(matchFolder("conrad shipyard notes", names)).toEqual({ symbol: "CNRD", matchedBy: "alias" });
    expect(matchFolder("E learning", names)).toBeNull();
  });
  it("keeps periodic reports only", () => {
    expect(isCoreFiling({ registry: "sec", form: "10-K/A", title: "" })).toBe(true);
    expect(isCoreFiling({ registry: "sec", form: "8-K", title: "" })).toBe(false);
    expect(isCoreFiling({ registry: "dart", form: null, title: "반기보고서 (2026.06)" })).toBe(true);
    expect(isCoreFiling({ registry: "asx", form: "Annual Report", title: "Annual Report" })).toBe(false);
  });
  it("names files OneDrive accepts", () => {
    expect(filingFileName({ filedAt: new Date("2026-01-02T00:00:00Z"), form: "10-Q", title: 'Q: "report" a/b' }, "htm")).toBe("2026-01-02 10-Q Q report a b.htm");
  });
});
