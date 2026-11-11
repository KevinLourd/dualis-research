import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // The repo holds several lockfiles (web/, site/, inspiration/): trace from this app only.
  outputFileTracingRoot: path.resolve(__dirname),
  // Thierry 2026-11-09: the Portfolio page is gone (« redundant with the research portal »); old links land on Research.
  async redirects() {
    return [{ source: "/portfolio", destination: "/research#performance", permanent: false }];
  },
};

export default nextConfig;
