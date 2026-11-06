/**
 * The only door to Thierry's OneDrive (Microsoft Graph, delegated, his own drive).
 * Safety is structural: this client has NO delete, move, rename or patch method, and its two writes refuse to
 * replace anything (`@microsoft.graph.conflictBehavior=fail`): a name already taken is reported, never overwritten.
 */

export const GRAPH = "https://graph.microsoft.com/v1.0";
/** Graph simple upload limit. */
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const SELECT = "id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference";

export type DriveItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { id?: string; path?: string };
};

/** What a Graph call did, for bronze (never the token). */
export type GraphCall = { method: string; path: string; status: number };

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`Graph HTTP ${status} on ${path}: ${body.slice(0, 300)}`);
  }
}

export class Drive {
  readonly calls: GraphCall[] = [];

  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch,
  ) {}

  private async call(method: "GET" | "POST" | "PUT", path: string, init: { body?: BodyInit; contentType?: string } = {}): Promise<Response> {
    const res = await this.fetchFn(path.startsWith("http") ? path : `${GRAPH}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(init.contentType ? { "content-type": init.contentType } : {}) },
      body: init.body,
    });
    this.calls.push({ method, path: path.replace(GRAPH, ""), status: res.status });
    return res;
  }

  private async json<T>(method: "GET" | "POST" | "PUT", path: string, init?: { body?: BodyInit; contentType?: string }): Promise<T> {
    const res = await this.call(method, path, init);
    const text = await res.text();
    if (!res.ok) throw new GraphError(res.status, path, text);
    return JSON.parse(text) as T;
  }

  /** The signed-in user's drive root. */
  root(): Promise<DriveItem> {
    return this.json("GET", `/me/drive/root?$select=${SELECT}`);
  }

  item(id: string): Promise<DriveItem> {
    return this.json("GET", `/me/drive/items/${encodeURIComponent(id)}?$select=${SELECT}`);
  }

  /** Every child of a folder (all pages). */
  async children(id: string): Promise<DriveItem[]> {
    const out: DriveItem[] = [];
    let next: string | undefined = `/me/drive/items/${encodeURIComponent(id)}/children?$top=200&$select=${SELECT}`;
    while (next) {
      const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await this.json("GET", next);
      out.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return out;
  }

  /** The child named `name` (case-insensitive, as OneDrive), or null. */
  async childNamed(parentId: string, name: string): Promise<DriveItem | null> {
    const lower = name.toLowerCase();
    return (await this.children(parentId)).find((c) => c.name.toLowerCase() === lower) ?? null;
  }

  /** Text of a small file (notes). */
  async text(id: string): Promise<string> {
    const res = await this.call("GET", `/me/drive/items/${encodeURIComponent(id)}/content`);
    const text = await res.text();
    if (!res.ok) throw new GraphError(res.status, `/me/drive/items/${id}/content`, text);
    return text;
  }

  /** A folder named `name` under `parentId`: created, or the existing one (never renamed, never replaced). */
  async ensureFolder(parentId: string, name: string): Promise<{ item: DriveItem; created: boolean }> {
    const path = `/me/drive/items/${encodeURIComponent(parentId)}/children`;
    const res = await this.call("POST", path, {
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      contentType: "application/json",
    });
    const text = await res.text();
    if (res.ok) return { item: JSON.parse(text) as DriveItem, created: true };
    if (res.status !== 409) throw new GraphError(res.status, path, text);
    const existing = await this.childNamed(parentId, name);
    if (!existing?.folder) throw new Error(`"${name}" exists in the folder but is not a folder; left untouched`);
    return { item: existing, created: false };
  }

  /** Uploads a NEW file; when the name is taken, the existing file is returned untouched (`created: false`). */
  async uploadNew(parentId: string, name: string, bytes: Uint8Array, contentType: string): Promise<{ item: DriveItem; created: boolean }> {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`"${name}" is ${bytes.byteLength} bytes, over the 250 MB simple upload limit`);
    const path = `/me/drive/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=fail`;
    const res = await this.call("PUT", path, { body: bytes as BodyInit, contentType });
    const text = await res.text();
    if (res.ok) return { item: JSON.parse(text) as DriveItem, created: true };
    if (res.status !== 409) throw new GraphError(res.status, path, text);
    const existing = await this.childNamed(parentId, name);
    if (!existing) throw new GraphError(409, path, `name taken but not found: ${text}`);
    return { item: existing, created: false };
  }
}
