/**
 * Minimal ZIP reader (EDINET serves its XBRL-to-CSV as a zip): reads the central directory, inflates each entry.
 * Stored (0) and deflated (8) entries only, which is all EDINET uses. Node only (collectors).
 */
export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  // Lazy: the console bundle lists dimensions and must never pull in node:zlib.
  const spec = "node:zlib";
  const { inflateRawSync } = (await import(/* webpackIgnore: true */ spec)) as typeof import("node:zlib");
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip file (no end of central directory)");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: bad central directory entry");
    const method = b.readUInt16LE(p + 10);
    const compressed = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(dataStart, dataStart + compressed);
    if (method === 0) out.set(name, new Uint8Array(data));
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(data)));
    else throw new Error(`zip: entry ${name} uses unsupported method ${method}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
