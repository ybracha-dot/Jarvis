import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** A short build identifier so the running version is obvious: the git commit when there is one, else a BUILD-ID file, else the package version. */
function buildId(): string {
  try { const c = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); if (c) { let dirty = ""; try { dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() ? "+" : ""; } catch { /* keep clean */ } return `${c}${dirty}`; } } catch { /* a ZIP has no git */ }
  try { const f = fs.readFileSync("BUILD-ID", "utf8").trim(); if (f) return f.slice(0, 24); } catch { /* none */ }
  try { return `v${JSON.parse(fs.readFileSync("package.json", "utf8")).version}`; } catch { return "unknown"; }
}

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pdfkit", "pngjs", "jpeg-js"],
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: { NEXT_PUBLIC_JARVIS_BUILD: buildId(), NEXT_PUBLIC_JARVIS_BUILT_AT: new Date().toISOString() },
};
export default config;
