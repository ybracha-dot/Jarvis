import { describe, expect, it } from "vitest";
import { receipt, submitGoal } from "@/lib/assistant";
import { makeCtx, migrate, openDb } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { memCtx } from "./helpers";

const text = "What are the open work items?";
const options = { handlers: HANDLERS, workerId: "project-scope-test", leaseMs: 15000, paceMs: 0 };

describe("project-scoped request replay", () => {
  it.each([undefined, "shared-message-key"])("keeps projects separate before and after completion (key %s)", async (dedupKey) => {
    const ctx = memCtx();
    const a = createProject(ctx, { name: "Lantern exhibit", aliases: ["Lantern crew"] });
    const b = createProject(ctx, { name: "Maple exhibit" });
    const ask = (projectHint?: string) => submitGoal(ctx, { text, origin: "api", projectHint, dedupKey });
    const first = ask(a.id);
    const second = ask(b.name);
    const global = ask();
    expect(new Set([first.resultId, second.resultId, global.resultId]).size).toBe(3);
    expect(ask("Lantern crew")).toMatchObject({ requestId: first.requestId, duplicate: true });
    await processQueue(ctx, options);
    expect(ask(b.id)).toMatchObject({ requestId: second.requestId, refreshed: !dedupKey });
    expect(receipt(ctx, first.requestId).revision).toBe(1);
  });

  it("refuses an unknown explicit project before creating an unscoped request", () => {
    const ctx = memCtx();
    expect(() => submitGoal(ctx, { text, projectHint: "Unknown project" })).toThrow(/project/i);
    expect(ctx.db.prepare("SELECT count(*) AS n FROM requests").get()).toMatchObject({ n: 0 });
  });

  it("preserves old links and replay scope when a result gained a project after intake", async () => {
    const db = openDb(":memory:", 7);
    try {
      const ctx = makeCtx("personal", { db });
      const named = createProject(ctx, { name: "Lantern exhibit" });
      const original = submitGoal(ctx, { text, origin: "claude", dedupKey: "unscoped" });
      // Recreate version 7 replay keys. The first job has a saved intake step.
      db.prepare("UPDATE requests SET dedup_key=? WHERE id=?").run("k:unscoped", original.requestId);
      await processQueue(ctx, options);
      const queued = submitGoal(ctx, { text, projectHint: named.id, dedupKey: "selected" });
      db.prepare("UPDATE requests SET dedup_key=? WHERE id=?").run("k:selected", queued.requestId);
      db.prepare("UPDATE requests SET project_id=? WHERE id=?").run(named.id, original.requestId);
      migrate(db);
      const replay = submitGoal(ctx, { text, origin: "claude", dedupKey: "unscoped" });
      expect(replay).toMatchObject({ requestId: original.requestId, resultId: original.resultId, duplicate: true });
      expect(submitGoal(ctx, { text, projectHint: named.id, dedupKey: "selected" }).resultId).toBe(queued.resultId);
      expect(submitGoal(ctx, { text, projectHint: named.id, dedupKey: "unscoped" }).resultId).not.toBe(original.resultId);
    } finally {
      db.close();
    }
  });
});
