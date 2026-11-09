import { Badge, Button } from "@cloudflare/kumo";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import Link from "@/console/link";
import { SlideOver } from "@/console/slide-over";
import { TableSearch } from "@/console/table-search";
import { Card, PageHeader } from "@/console/ui";
import { ChartSample } from "@/design/chart-sample";
import { ColorForm } from "@/design/color-form";
import { DESIGN_ON_GITHUB, type DesignSystem, getDesignSystem, SKILL_ZIP } from "@/design/queries";

export const metadata = { title: "Design system" };
export const dynamic = "force-dynamic";

const SAMPLE = {
  serif: "Monro is a cheap call on Icahn's next move",
  sans: "Margins are back at the 2019 level as pricing sticks.",
  mono: "MNRO  23.41  +4.2%",
};

/** Type specimens drawn with the published fonts (the console itself uses Kumo's system stack). */
function typeDoc(ds: DesignSystem): string {
  const rows = ds.tokens.type.groups
    .flatMap((g) =>
      g.styles.map(
        (s) =>
          `<div style="display:grid;grid-template-columns:120px 1fr;gap:16px;align-items:baseline;padding:12px 0;border-bottom:1px solid var(--rule)">` +
          `<span class="dr-label">${s.name} · ${s.fontSize}/${s.lineHeight}</span>` +
          `<span style="font-family:var(--font-${g.family});font-size:${s.fontSize};line-height:${s.lineHeight};font-weight:${s.fontWeight};color:var(--ink)${s.name === "label" ? ";text-transform:uppercase;letter-spacing:.06em" : ""}">${SAMPLE[g.family]}</span></div>`,
      ),
    )
    .join("");
  return `<!doctype html><html><head><style>${ds.previewCss}</style></head><body style="background:var(--surface);padding:8px 16px">${rows}</body></html>`;
}

function Swatch({ value }: { value: string }) {
  return <span className="inline-block size-7 rounded-md ring-1 ring-kumo-line align-middle" style={{ background: value }} aria-hidden />;
}

export default async function DesignPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const [{ edit }, ds] = await Promise.all([searchParams, getDesignSystem()]);
  const { tokens } = ds;
  const editing = edit ? tokens.color.tokens.find((c) => c.name === edit) : undefined;
  const typeHeight = tokens.type.groups.reduce((n, g) => n + g.styles.length, 0) * 66 + 24;

  return (
    <>
      <PageHeader
        title="Design system"
        description="One source for the website, this console and every chart Claude draws. Read live from GitHub, so a change shows here within 5 minutes."
        actions={
          <>
            <Badge variant="outline">Version {tokens.version}</Badge>
            <a href={DESIGN_ON_GITHUB} target="_blank" rel="noreferrer">
              <Button variant="secondary" tabIndex={-1}>
                Open on GitHub
              </Button>
            </a>
          </>
        }
      />

      <Card title="Colours">
        <div className="p-4">
          <TableSearch placeholder="Search colours by name or use">
            <KTable>
              <KTableHeader>
                <KTableRow>
                  <KTableHead>Light</KTableHead>
                  <KTableHead>Dark</KTableHead>
                  <KTableHead>Name</KTableHead>
                  <KTableHead>Use</KTableHead>
                  <KTableHead />
                </KTableRow>
              </KTableHeader>
              <KTableBody>
                {tokens.color.tokens.map((c) => (
                  <KTableRow key={c.name}>
                    <KTableCell>
                      <span className="flex items-center gap-2">
                        <Swatch value={c.value.light} />
                        <span className="font-mono text-xs text-kumo-subtle">{c.value.light}</span>
                      </span>
                    </KTableCell>
                    <KTableCell>
                      <span className="flex items-center gap-2">
                        <Swatch value={c.value.dark} />
                        <span className="font-mono text-xs text-kumo-subtle">{c.value.dark}</span>
                      </span>
                    </KTableCell>
                    <KTableCell className="font-mono">{c.name}</KTableCell>
                    <KTableCell className="max-w-md text-sm text-kumo-default">{c.usage}</KTableCell>
                    <KTableCell className="text-right whitespace-nowrap">
                      <Link href={`/design?edit=${c.name}`} scroll={false} className="text-kumo-link hover:underline">
                        Edit ›
                      </Link>
                    </KTableCell>
                  </KTableRow>
                ))}
              </KTableBody>
            </KTable>
          </TableSearch>
        </div>
      </Card>

      <Card title="Type">
        <iframe title="Type specimens" srcDoc={typeDoc(ds)} sandbox="" className="block w-full border-0" style={{ height: typeHeight }} />
      </Card>

      <Card title="Charts">
        <div className="flex flex-col gap-6 p-4">
          <p className="max-w-prose text-base text-kumo-default">{tokens.chart.usage}</p>
          <div className="grid gap-6 xl:grid-cols-2">
            <ChartSample tokens={tokens} theme="dark" />
            <ChartSample tokens={tokens} theme="light" />
          </div>
          <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5 text-base text-kumo-default">
            {tokens.chart.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </Card>

      <Card title="Logo">
        <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-5">
          {ds.logos.map((l) => (
            <figure key={l.file} className="flex flex-col gap-2">
              <div className={`flex h-32 items-center justify-center rounded-lg ring-1 ring-kumo-line ${l.file.includes("white") ? "bg-[var(--dualis-deep)]" : "bg-white"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.dataUri} alt={l.file.split("/").pop()} className="h-20 w-20 object-contain" />
              </div>
              <figcaption className="text-sm text-kumo-subtle">{l.usage}</figcaption>
            </figure>
          ))}
        </div>
      </Card>

      <Card title="Components">
        <div className="flex flex-col gap-6 p-4">
          {ds.components.map((c) => (
            <section key={c.name} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-kumo-strong">{c.name}</h3>
              <iframe title={c.name} srcDoc={c.srcDoc} sandbox="" className="block w-full rounded-lg border-0 ring-1 ring-kumo-line" style={{ height: c.height }} />
            </section>
          ))}
        </div>
      </Card>

      <Card title="Charts with Claude">
        <div className="flex max-w-prose flex-col gap-4 p-4 text-base text-kumo-default">
          <p>
            The Dualis chart skill redraws any chart in this style from its numbers. Give Claude the data (a CSV, a table or the
            filing) and say what the chart should show.
          </p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li>Download the skill with the button below.</li>
            <li>In Claude Desktop, open Settings, then Capabilities, and turn on code execution.</li>
            <li>In Settings, then Capabilities, then Skills, choose Upload skill and pick the file.</li>
            <li>In any chat or stock project, ask: &quot;Chart this in the Dualis style&quot; with the data attached.</li>
          </ol>
          <p>
            To change a colour, use Edit on the table above. Claude Code changes the same file through a pull request. Both
            land in design/tokens.json, so the site, the console and the skill always agree.
          </p>
          <a href={SKILL_ZIP} className="self-start">
            <Button variant="primary" tabIndex={-1}>
              Download the chart skill
            </Button>
          </a>
        </div>
      </Card>

      {editing && (
        <SlideOver title={`Edit ${editing.name}`} subtitle={editing.usage} closeHref="/design">
          <ColorForm name={editing.name} light={editing.value.light} dark={editing.value.dark} />
        </SlideOver>
      )}
    </>
  );
}
