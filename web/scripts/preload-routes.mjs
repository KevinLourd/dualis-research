// Run after `opennextjs-cloudflare build`. Makes every route module of the Next server bundle load while the Worker
// isolate STARTS, instead of inside the first request each isolate serves for that route.
//
// Why (2026-11-06, ~1 console request in 3 answered a blank 503 "Worker exceeded CPU time limit"): on the Workers free
// plan a request's CPU is capped; OpenNext requires a page's module tree (React, Kumo, Clerk, the page) lazily, so the
// first hit of each route on a fresh isolate paid ~100-300 ms of module evaluation and got killed. Startup work runs
// under the separate startup limit (measured by `wrangler versions upload` / deploy: "Worker Startup Time").
//
// How: OpenNext inlines Next's `requirePage` as a list of `if (pagePath.endsWith("<file>")) return require_xxx()`.
// We read that list from the bundle and append one call per route at the end of the module, with the same runtime
// type Next sets around it. Fails the build if the list is missing (an OpenNext upgrade changed the shape).
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../.open-next/server-functions/default/handler.mjs", import.meta.url);
const src = readFileSync(file, "utf8");
const MARK = "/* dualis: preload routes */";
if (src.includes(MARK)) process.exit(0);

const start = src.indexOf("function requirePage(page,distDir,isAppPath)");
if (start < 0) throw new Error("preload-routes: requirePage not found in handler.mjs");
const body = src.slice(start, src.indexOf("finally{", start));
const routes = [...body.matchAll(/endsWith\("((?:app|pages)\/[^"]+)"\)\)return (require_[A-Za-z0-9_$]+)\(\)/g)].map(
  ([, path, fn]) => ({ path, fn, type: path.startsWith("app/") ? "app" : "pages" }),
);
if (!routes.some((r) => r.type === "app")) throw new Error("preload-routes: no app route found in requirePage");

const calls = routes
  .map((r) => `process.env.__NEXT_PRIVATE_RUNTIME_TYPE=${JSON.stringify(r.type)};${r.fn}();`)
  .join("");
writeFileSync(file, `${src}\n${MARK}\ntry{${calls}}finally{process.env.__NEXT_PRIVATE_RUNTIME_TYPE=""}\n`);
console.log(`preload-routes: ${routes.length} route modules load at isolate startup`);
