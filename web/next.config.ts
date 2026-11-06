import path from "node:path";
import type { NextConfig } from "next";

// `next dev` only: render the signed-in console for screenshots without a Clerk secret. Never set in CI or deploy.
const stubAuth = process.env.SCREENSHOT_AUTH_STUB === "1" && process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
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
