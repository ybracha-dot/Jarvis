import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, makeCtx, Ctx } from "@/lib/db";
import { sourcesSharing, setSourceSharing } from "@/lib/share";

/** Fresh in-memory demo workspace with a fixed clock. */
export function memCtx(clock = "2026-11-16T08:00:00-05:00", mode: "demo" | "personal" = "demo"): Ctx {
  const db = openDb(":memory:");
  let now = new Date(clock);
  const ctx = makeCtx(mode, { db, now: () => now });
  (ctx as any).setNow = (iso: string) => { now = new Date(iso); };
  return ctx;
}
export function tmpDataDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-test-"));
  process.env.JARVIS_DATA_DIR = d;
  return d;
}
export const count = (ctx: Ctx, table: string, where = "1=1") => (ctx.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get() as any).n as number;

/** Opt-in diagnostics: nothing is written unless JARVIS_TEST_REPORT=1, and then only into a fresh per-run temp directory, so routine runs can never overwrite first-attempt evidence. */
let reportDir: string | null = null;
export function writeReport(name: string, data: unknown): string | null {
  if (process.env.JARVIS_TEST_REPORT !== "1") return null;
  const fs = require("node:fs") as typeof import("node:fs"); const os = require("node:os") as typeof import("node:os"); const path = require("node:path") as typeof import("node:path");
  if (!reportDir) { reportDir = fs.mkdtempSync(path.join(process.env.JARVIS_TEST_REPORT_DIR || os.tmpdir(), "jarvis-report-")); console.log(`[report] ${reportDir}`); }
  const file = path.join(reportDir, `${name}.json`); fs.writeFileSync(file, JSON.stringify(data, null, 2)); return file;
}

/** A full, correctly attributed reading of the built-in Rooftop concert test project (Ilse Brandt, Mateus Oliveira open; Tobias Quist and the barriers closed). */
export function concertReading(t: any, programmes = "Print the programmes") {
  const sid = (s: string) => t.spans.find((x: any) => x.text.includes(s)).spanId;
  return { requestId: t.requestId, revision: t.revision, snapshot: t.snapshot, updates: [
    { ref: "u1", owner: "Ilse Brandt", action: "Set up the sound desk", status: "open", blocker: null, effective: "unblocked", confidence: "stated", quotes: [{ spanId: sid("sound desk is in Ilse Brandt's hands"), quote: "The sound desk is in Ilse Brandt's hands" }, { spanId: sid("power plan has arrived"), quote: "Ilse Brandt can set up the sound desk" }] },
    { ref: "u2", owner: "Mateus Oliveira", action: programmes, status: "open", blocker: null, effective: "new", confidence: "stated", quotes: [{ spanId: sid("Mateus Oliveira volunteered"), quote: "Mateus Oliveira volunteered to print the programmes" }] },
    { ref: "u3", owner: "Tobias Quist", action: "Book the stage lights", status: "done", blocker: null, effective: "completed", confidence: "stated", quotes: [{ spanId: sid("Tobias Quist booked"), quote: "Tobias Quist booked the stage lights this morning" }] },
    { ref: "u4", owner: null, action: "Sign off the stage barriers", status: "done", blocker: null, effective: "unchanged", confidence: "stated", quotes: [{ spanId: sid("stage barriers are already"), quote: "The stage barriers are already signed off" }] }],
    coverage: t.spans.map((x: any) => { const ref = /sound desk|power plan|waiting for the venue/.test(x.text) ? "u1" : /Mateus/.test(x.text) ? "u2" : /Tobias/.test(x.text) ? "u3" : /barriers/.test(x.text) ? "u4" : null; return { spanId: x.spanId, role: ref ? "contributes" : "unrelated", refs: ref ? [ref] : [], reason: "accounts for an item" }; }) };
}

/** The explicit choice, made for the whole workspace: the test models a user who let Claude read every source. Without it the private workspace refuses Claude (see tests/share.test.ts). */
export function shareAll(ctx: Ctx) { for (const s of sourcesSharing(ctx)) if (!s.shared) setSourceSharing(ctx, s.id, true); }
