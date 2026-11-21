import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["node:sqlite"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};
export default config;
