import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/polymarket",
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
