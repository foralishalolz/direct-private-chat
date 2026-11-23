import type { NextConfig } from "next";
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // Fewer, narrower chunks mean the first paint of the inbox arrives sooner on
  // a phone; the call engine is already split out behind a dynamic import.
  experimental: { optimizeCss: false, webpackBuildWorker: true },
  compiler: { removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error"] } : false },
};
export default config;

