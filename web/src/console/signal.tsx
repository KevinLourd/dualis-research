/** A titled section of the ticker page (server component). */

/** A titled block of the ticker page: a quiet label, then the content, lots of air around it. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium tracking-wide text-kumo-subtle uppercase">{title}</h2>
      {children}
    </section>
  );
}
