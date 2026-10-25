import path from "node:path";
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@muse/accounts"],
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(__dirname, "../.."),
};
export default config;
