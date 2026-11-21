import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, makeCtx, Ctx } from "@/lib/db";

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
