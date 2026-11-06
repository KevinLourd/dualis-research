import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { connectNode } from "../src/db/node";
import type { Db } from "../src/db/types";
import { putPrivateFiles } from "../src/private/files";

/**
 * Pushes Thierry's private input files from a checkout of the private repo (KevinLourd/dualis-private) into
 * app.private_files on DATABASE_URL, keyed on their path from the checkout root: everything under `data/`, plus the
 * targets doc. Usage: `pnpm private:push ../../dualis-private`.
 */
const PUSHED = ["data", "docs/acquisition-targets.md"];

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => (name.startsWith(".") ? [] : walk(join(path, name))));
}

async function main() {
  const folder = process.argv[2];
  if (!folder) throw new Error("usage: pnpm private:push <folder of the dualis-private checkout>");
  const root = resolve(folder);
  const files = Object.fromEntries(PUSHED.flatMap((p) => walk(join(root, p))).map((f) => [relative(root, f), readFileSync(f, "utf8")]));
  const { db, close } = connectNode();
  try {
    await putPrivateFiles(db as unknown as Db, files);
    console.log(`[private:push] ${Object.keys(files).length} files: ${Object.keys(files).sort().join(", ")}`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error("[private:push]", err);
  process.exit(1);
});
