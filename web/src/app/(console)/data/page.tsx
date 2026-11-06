import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import Link from "@/console/link";
import { DIMENSIONS } from "@/collectors/registry";
import { duration, relativeTime, utc } from "@/console/format";
import { ConsensusCoverageCard } from "@/console/consensus";
import { getRun, listConsensusCoverage, listRuns, sourcesOfRuns } from "@/console/queries";
import { SlideOver } from "@/console/slide-over";
import { Card, PageHeader, RunStatus } from "@/console/ui";

export const metadata = { title: "Data" };

export default async function DataPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run: runId } = await searchParams;
  const [runs, selected, consensusCoverage] = await Promise.all([listRuns(50), runId ? getRun(runId) : null, listConsensusCoverage()]);
  const sources = await sourcesOfRuns(runs.map((r) => r.id));
  const latest = DIMENSIONS.map((d) => ({ dimension: d, run: runs.find((r) => r.dimension === d.name) ?? null }));

  return (
    <>
      <PageHeader title="Data" description="Collectors run every morning from GitHub Actions. A missed day shows here." />

      <div className="grid gap-6 lg:grid-cols-2">
        {latest.map(({ dimension, run }) => (
          <Card
            key={dimension.name}
            title={dimension.name}
            action={run ? <RunStatus status={run.status} /> : <span className="text-sm text-kumo-subtle">Never ran</span>}
          >
            <p className="px-4 pt-3 pb-2 text-sm text-kumo-subtle">{dimension.description}</p>
            <KTable>
              <KTableHeader>
                <KTableRow>
                  <KTableHead>Source</KTableHead>
                  <KTableHead>Status</KTableHead>
                  <KTableHead className="text-right">OK</KTableHead>
                  <KTableHead className="text-right">Failed</KTableHead>
                  <KTableHead className="text-right">Not covered</KTableHead>
                </KTableRow>
              </KTableHeader>
              <KTableBody>
                {dimension.sources.map((s) => {
                  const row = run ? sources.find((x) => x.runId === run.id && x.source === s.name) : undefined;
                  return (
                    <KTableRow key={s.name}>
                      <KTableCell className="font-mono">{s.name}</KTableCell>
                      <KTableCell>{row ? <RunStatus status={row.status} /> : <span className="text-kumo-subtle">–</span>}</KTableCell>
                      <KTableCell className="text-right font-mono tabular">{row?.succeeded ?? "–"}</KTableCell>
                      <KTableCell className="text-right font-mono tabular">{row?.failed ?? "–"}</KTableCell>
                      <KTableCell className="text-right font-mono tabular">{row?.skipped ?? "–"}</KTableCell>
                    </KTableRow>
                  );
                })}
              </KTableBody>
            </KTable>
            {run && (
              <p className="border-t border-kumo-hairline px-4 py-3 text-sm text-kumo-subtle">
                Last run {relativeTime(run.startedAt)} ({utc(run.startedAt)}).{" "}
                <Link href={`/data?run=${run.id}`} scroll={false} className="text-kumo-link hover:underline">
                  Details
                </Link>
              </p>
            )}
          </Card>
        ))}
      </div>

      <ConsensusCoverageCard rows={consensusCoverage} />

      <Card title="Runs">
        {runs.length === 0 ? (
          <p className="p-4 text-base text-kumo-subtle">No run yet. Start the Collect workflow in GitHub Actions.</p>
        ) : (
          <KTable>
            <KTableHeader>
              <KTableRow>
                <KTableHead>Started</KTableHead>
                <KTableHead>Dimension</KTableHead>
                <KTableHead>Status</KTableHead>
                <KTableHead>Trigger</KTableHead>
                <KTableHead>Sources (ok / asked)</KTableHead>
                <KTableHead className="text-right">Took</KTableHead>
              </KTableRow>
            </KTableHeader>
            <KTableBody>
              {runs.map((r) => {
                const own = sources.filter((s) => s.runId === r.id);
                return (
                  <KTableRow key={r.id} variant={runId === r.id ? "selected" : "default"}>
                    <KTableCell>
                      <Link href={`/data?run=${r.id}`} scroll={false} title={utc(r.startedAt)} className="text-kumo-link hover:underline">
                        {relativeTime(r.startedAt)}
                      </Link>
                    </KTableCell>
                    <KTableCell>{r.dimension}</KTableCell>
                    <KTableCell><RunStatus status={r.status} /></KTableCell>
                    <KTableCell className="text-kumo-subtle">{r.trigger}</KTableCell>
                    <KTableCell className="font-mono text-sm text-kumo-subtle">
                      {own.map((s) => `${s.source} ${s.succeeded}/${s.requested}`).join(" · ")}
                    </KTableCell>
                    <KTableCell className="text-right font-mono tabular">
                      {r.finishedAt ? duration(r.finishedAt.getTime() - r.startedAt.getTime()) : "–"}
                    </KTableCell>
                  </KTableRow>
                );
              })}
            </KTableBody>
          </KTable>
        )}
      </Card>

      {selected && (
        <SlideOver
          closeHref="/data"
          title={selected.run.dimension}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <RunStatus status={selected.run.status} /> {utc(selected.run.startedAt)} · {selected.run.trigger}
            </span>
          }
        >
          {selected.run.ciUrl && (
            <a href={selected.run.ciUrl} target="_blank" rel="noreferrer" className="text-kumo-link hover:underline">
              Open the GitHub Actions log
            </a>
          )}
          {selected.run.error && (
            <pre className="overflow-x-auto rounded-lg bg-dualis-short-soft p-3 text-xs whitespace-pre-wrap text-dualis-short">
              {selected.run.error}
            </pre>
          )}
          {selected.sources.map((s) => (
            <section key={s.id} className="rounded-lg ring-1 ring-kumo-hairline">
              <header className="flex items-center justify-between border-b border-kumo-hairline px-4 py-3">
                <span className="font-mono text-sm font-semibold">{s.source}</span>
                <RunStatus status={s.status} />
              </header>
              <dl className="grid grid-cols-4 gap-3 px-4 py-3">
                {[
                  ["Asked", s.requested],
                  ["OK", s.succeeded],
                  ["Failed", s.failed],
                  ["Not covered", s.skipped],
                  ["Raw rows", s.bronzeRows],
                  ["Promoted", s.silverRows],
                  ["Took", duration(s.durationMs)],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-xs text-kumo-subtle">{label}</dt>
                    <dd className="font-mono text-base tabular">{value}</dd>
                  </div>
                ))}
              </dl>
              {s.errors.length > 0 && (
                <ul className="flex flex-col gap-2 border-t border-kumo-hairline px-4 py-3 text-sm text-dualis-short">
                  {s.errors.map((e, i) => (
                    <li key={i} className="break-words">
                      <span className="mr-2 font-mono text-kumo-default">{e.subject}</span>
                      {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </SlideOver>
      )}
    </>
  );
}
