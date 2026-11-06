import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // The repo holds several lockfiles (web/, site/, inspiration/): trace from this app only.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
