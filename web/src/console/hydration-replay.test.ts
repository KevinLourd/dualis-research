// @vitest-environment happy-dom
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * The console logged React #418 on about 1 load of /growth in 70 (2026-11-17). Cause: Next 15.5.29 bundles a React
 * (19.2 canary) that replays a host element whose children suspended (a client component chunk not loaded yet, or an RSC
 * row still streaming) without rewinding the hydration cursor, so the replay tries to claim the element's own first
 * child and fails. React 19.3 fixed it (`popHydrationStateOnInterruptedWork`); `patches/next@15.5.29.patch` backports it.
 * This test drives exactly that replay on Next's bundled React: delete it with the patch once Next ships React >= 19.3.
 */
const require = createRequire(import.meta.url);
const React = require("next/dist/compiled/react") as typeof import("react");

for (const build of ["production", "development"] as const) {
  describe(`Next's bundled react-dom (${build}) hydrating a host element whose children suspend`, () => {
    it("replays the element without a hydration mismatch", async () => {
      const { hydrateRoot } = require(`next/dist/compiled/react-dom/cjs/react-dom-client.${build}.js`) as typeof import("react-dom/client");
      const container = document.createElement("div");
      container.innerHTML = '<table><tbody id="rows"><tr><td>Writer</td></tr></tbody></table>';
      document.body.appendChild(container);
      const serverRow = container.querySelector("tr");

      // The rows are a pending promise, like an RSC row or a client component chunk: the <tbody> suspends on its children.
      let resolve!: (rows: React.ReactNode) => void;
      const rows = new Promise<React.ReactNode>((r) => (resolve = r));
      const errors: unknown[] = [];
      React.startTransition(() => {
        hydrateRoot(container, React.createElement("table", null, React.createElement("tbody", { id: "rows" }, rows as unknown as React.ReactNode)), {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      // Settled before React reaches it but not yet known to React (a chunk that finished loading): React suspends the
      // <tbody>, sees the data ready on its next slice and replays the <tbody>. That replay is the path that misfired.
      resolve(React.createElement("tr", null, React.createElement("td", null, "Writer")));
      await new Promise((r) => setTimeout(r, 50));

      expect(errors).toEqual([]);
      // Hydrated in place: the server's row is still the one on screen, not a client re-render.
      expect(container.querySelector("tr")).toBe(serverRow);
      container.remove();
    });
  });
}
