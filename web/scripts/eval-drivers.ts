/**
 * Read-only replay of the driver reasoning on PROD data (INFLECTION-1117 PR-D eval): for each `<symbol>:<side>`, writes
 * the thesis again with the current analysis prompt, then judges every driver and the thesis, keeping the judgments in
 * memory. Nothing is written: the connection is read-only. LLM = the local `claude` CLI on Kevin's login ($0).
 *   DATABASE_URL=... tsx scripts/eval-drivers.ts 000050.KS:long 4238.T:short
 * `--stored` (PR-E): keeps the drivers and charts in gold as they are and judges them again, printing each driver's
 * reading in gold (before) beside the new one (after).
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { analysisSource, driverIdOf, parseThesisId, thesisVersion, type AnalysisPayload } from "@/collectors/dimensions/analysis";
import { driversOf } from "@/collectors/dimensions/evidence";
import { driverExhibits, judgeThesis, memoryStore, type JudgedDriver } from "@/collectors/dimensions/narrative-state";
import { narrativeStates, type Magnitude } from "@/db/schema/analysis";
import type { Db } from "@/db/types";
import { DEFAULT_MODEL } from "@/llm/model";
import type { Complete } from "@/llm/complete";

const cwd = mkdtempSync(join(tmpdir(), "dualis-eval-"));
const complete: Complete = ({ system, prompt, model = DEFAULT_MODEL }) =>
  new Promise((resolve, reject) => {
    const p = spawn("claude", ["-p", "--model", model, "--system-prompt", system, "--tools", "", "--setting-sources", "", "--output-format", "text"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("close", (code) => (code === 0 ? resolve({ text: out, model }) : reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`))));
    p.stdin.end(prompt);
  });

const mag = (m: Magnitude | null | undefined) => (m ? `${m.figure}${m.series ? ` [${m.series}]` : ""}: ${m.from ?? "?"} -> ${m.to ?? "?"} (${m.change ?? "?"}), ${m.size}` : "none");

/** The drivers and charts in gold, judged again: before (gold.narrative_states) and after, side by side. */
async function stored(db: Db, subject: string) {
  const { symbol, side } = parseThesisId(subject);
  const current = await driversOf(db, symbol, side);
  if (!current) throw new Error(`${subject}: no drivers in gold`);
  const charts = await driverExhibits(db, current.drivers.map((x) => x.id));
  const drivers: JudgedDriver[] = current.drivers.map((x) => ({ id: x.id, rank: x.rank, category: x.category, title: x.title, text: x.text, moveIds: x.moveIds ?? [], exhibits: charts.get(x.id) ?? [] }));
  const before = new Map((await db.select().from(narrativeStates).where(inArray(narrativeStates.id, drivers.map((x) => x.id)))).map((s) => [s.id, s]));
  const r = await judgeThesis(db, complete, memoryStore(), symbol, { side, version: current.version, narrative: current.narrative, market: current.market, drivers });
  console.log(`\n=== ${subject}: ${current.narrative}`);
  drivers.forEach((d, i) => {
    const b = before.get(d.id);
    const v = r.drivers[i];
    console.log(`- ${d.id} « ${d.title} » [${d.category}] charts: ${(d.exhibits ?? []).map((e) => e.series.join(",")).join(" | ") || "none"}`);
    const words = (s: string | null | undefined) => (s ? `(${s.split(/\s+/).filter(Boolean).length} words) ${s}` : "");
    console.log(`  BEFORE ${b ? `${b.effect}:${b.strength ?? ""} ${b.durability ?? ""} | ${mag(b.magnitude)} | ${words(b.reason ?? b.why)}` : "none"}`);
    console.log(`  AFTER  ${v.verdict} ${v.durability ?? ""} | ${mag(v.magnitude)} | ${words(v.conclusion ?? v.reason)}`);
  });
  console.log(`Thesis: ${r.thesis.verdict} signal=${r.thesis.signal}. ${r.thesis.reason}`);
}

/** The thesis written again with the current analysis prompt, then judged. */
async function rewritten(db: Db, subject: string) {
  const { symbol, side } = parseThesisId(subject);
  const out = await analysisSource.fetch(subject, { env: {}, fetch, db, complete });
  if (out.error) throw new Error(`${subject}: ${out.error}`);
  const a = (out.payload as AnalysisPayload).analysis;
  const current = await driversOf(db, symbol, side);
  const drivers: JudgedDriver[] = a.drivers.map((d, i) => ({ id: driverIdOf(symbol, side, i + 1), rank: i + 1, category: d.category, title: d.title, text: d.text, moveIds: d.moveIds ?? [], exhibits: d.exhibits.map((e) => ({ title: e.title, series: e.series })) }));
  const r = await judgeThesis(db, complete, memoryStore(), symbol, { side, version: thesisVersion(a), narrative: a.narrative, market: current?.market ?? null, drivers });
  console.log(`\n=== ${subject}: ${a.narrative}`);
  console.log(`Before: ${(current?.drivers ?? []).map((d) => d.title).join(" | ")}`);
  drivers.forEach((d, i) => {
    const v = r.drivers[i];
    console.log(`- ${d.rank}. ${d.title} [${d.category}] moves=${d.moveIds.join(",") || "none"}`);
    console.log(`  tag=${v.verdict} durability=${v.durability} magnitude=${mag(v.magnitude)}`);
    console.log(`  reason: ${v.conclusion}`);
    console.log(`  explanation: ${v.explanation}`);
    console.log(`  citations: ${JSON.stringify((v.citations ?? []).map((c) => ({ title: c.title, page: c.page, quote: c.quote })))}`);
  });
  console.log(`Thesis: ${r.thesis.verdict} signal=${r.thesis.signal}. ${r.thesis.reason}`);
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, fetch_types: false, connection: { default_transaction_read_only: true } });
  const db = drizzle(sql) as unknown as Db;
  const args = process.argv.slice(2);
  const keep = args.includes("--stored");
  for (const subject of args.filter((a) => a !== "--stored")) await (keep ? stored(db, subject) : rewritten(db, subject));
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
