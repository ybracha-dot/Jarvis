import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** A short build identifier so the running version is obvious: the git commit when there is one, else a BUILD-ID file, else the package version. */
function buildId(): string {
  try { const c = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); if (c) { let dirty = ""; try { dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() ? "+" : ""; } catch { /* keep clean */ } return `${c}${dirty}`; } } catch { /* a ZIP has no git */ }
  try { const f = fs.readFileSync("BUILD-ID", "utf8").trim(); if (f) return f.slice(0, 24); } catch { /* none */ }
  // A downloaded ZIP has neither: identify the code itself (paths and sizes under src/), so two different ZIPs never look alike.
  try { const h = crypto.createHash("sha1"); const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { h.update(p); h.update(String(fs.statSync(p).size)); } } }; walk("src"); return `src-${h.digest("hex").slice(0, 7)}`; } catch { return "unknown"; }
}

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pdfkit", "pngjs", "jpeg-js"],
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: { NEXT_PUBLIC_JARVIS_BUILD: buildId(), NEXT_PUBLIC_JARVIS_BUILT_AT: new Date().toISOString() },
};
export default config;
