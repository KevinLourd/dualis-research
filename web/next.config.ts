import path from "node:path";
import type { NextConfig } from "next";

// `next dev` only: render the signed-in console for screenshots without a Clerk secret. Never set in CI or deploy.
const stubAuth = process.env.SCREENSHOT_AUTH_STUB === "1" && process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // A self-contained Node server (.next/standalone/server.js), run in a container on the Dualis server (web/deploy/README.md).
  output: "standalone",
  // The trace root is web/ itself: a lockfile further up the disk otherwise nests the server under that path.
  outputFileTracingRoot: path.resolve("."),
  images: { unoptimized: true },
  // Native renderer (a .node binary) for the logo PNG downloads: required at run time, never bundled.
  serverExternalPackages: ["@resvg/resvg-js"],
  // A page loaded ahead (console links prefetch in full) or already visited stays in the browser 5 minutes: a click
  // renders at once. Server actions (Thierry's edits) still refresh it right away.
  experimental: { staleTimes: { dynamic: 300, static: 300 } },
  ...(stubAuth && {
    webpack: (config) => {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@clerk/nextjs/server$": path.resolve("scripts/screenshot-auth/clerk-server.ts"),
        "@clerk/nextjs$": path.resolve("scripts/screenshot-auth/clerk-nextjs.tsx"),
      };
      return config;
    },
  }),
};

export default nextConfig;
