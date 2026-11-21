import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pdfkit", "pngjs", "jpeg-js"],
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};
export default config;
