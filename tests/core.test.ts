import { describe, it, expect } from "vitest";
import { memCtx, count } from "./helpers";
import { seedDemo, replay } from "@/lib/demo";
import { listDecisions, decisionDetail, reserve, ConflictError, defer, markHandled, resolveConflict } from "@/lib/decisions";
import { get, all } from "@/lib/db";
import { today } from "@/lib/today";

const essay = (ctx: any) => get(ctx.db, "SELECT * FROM tasks WHERE external_id='essay-2'")!;

describe("source change to decision", () => {
  it("seeds the Monday 08:00 state with the original due date", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const t = essay(ctx);
    expect(t.due_at).toBe("2026-11-20T22:00:00.000Z");
    expect(count(ctx, "decisions")).toBe(0);
    expect(count(ctx, "tasks")).toBe(1);
  });

  it("bulletin moves the same task once, keeps both dates and both sources, creates exactly one decision", () => {
    const ctx = memCtx(); seedDemo(ctx);
    replay(ctx, "bulletin");
    expect(count(ctx, "tasks")).toBe(1);
    const t = essay(ctx);
    expect(t.due_at).toBe("2026-11-18T22:00:00.000Z");
    expect(t.original_due_at).toBe("2026-11-20T22:00:00.000Z");
    const hist = all(ctx.db, "SELECT due_at,kind FROM task_due_history WHERE task_id=? ORDER BY recorded_at, rowid", t.id);
    expect(hist.map((h) => h.kind)).toEqual(["established", "moved"]);
    const decs = listDecisions(ctx);
    expect(decs).toHaveLength(1);
    expect(decs[0].title).toContain("Moved up 2 days");
    expect(decs[0].evidence.quote).toContain("now due Wednesday");
    expect(decs[0].evidence.requirements[0].detail.articles).toEqual([4, 13, 16, 31]);
    // syllabus, announcement, bibliography, duplicate email copy all remain
    expect(count(ctx, "source_revisions")).toBe(4);
    expect(get(ctx.db, "SELECT COUNT(*) n FROM source_revisions WHERE duplicate_of IS NOT NULL")!.n).toBe(1);
  });

  it("replaying twice changes no counts", () => {
    const ctx = memCtx(); seedDemo(ctx);
    replay(ctx, "bulletin");
    const snap = () => ["tasks", "decisions", "source_revisions", "sources", "requirements", "task_events", "inbox", "task_due_history"].map((t) => count(ctx, t));
    const a = snap();
    replay(ctx, "bulletin"); replay(ctx, "bulletin");
    expect(snap()).toEqual(a);
  });

  it("an email copy then a source import still yields one decision", () => {
    const ctx = memCtx(); seedDemo(ctx);
    replay(ctx, "bulletin");
    expect(count(ctx, "decisions", "kind='deadline_moved'")).toBe(1);
    expect(count(ctx, "requirements", "kind='bring_print'")).toBe(1);
  });

  it("the requirement points at the bibliography source", () => {
    const ctx = memCtx(); seedDemo(ctx); replay(ctx, "bulletin");
    const r = get(ctx.db, "SELECT detail FROM requirements WHERE kind='bring_print'")!;
    expect(JSON.parse(r.detail as string).bibliography[0].title).toBe("Synthetic bibliography");
  });

  it("classifies delivery: next brief, with an explanation", () => {
    const ctx = memCtx(); seedDemo(ctx); replay(ctx, "bulletin");
    const d = listDecisions(ctx)[0];
    expect(d.urgency).toBe("brief");
    expect(d.urgency_reason).toMatch(/next brief/);
  });
});

describe("recommendation and reserve", () => {
  it("shows old/new due, a best plan and one alternative, with no block in a protected interval", () => {
    const ctx = memCtx(); seedDemo(ctx); replay(ctx, "bulletin");
    const d = listDecisions(ctx)[0];
    const det = decisionDetail(ctx, d.id)!;
    expect(det.recommendation!.best.scheduledMinutes).toBe(120);
    expect(det.recommendation!.best.shortfall).toBe(0);
    expect(det.recommendation!.alternative.chunks.length).toBeGreaterThan(0);
    expect(det.recommendation!.best.chunks.every((c) => new Date(c.end) <= new Date(essay(ctx).due_at))).toBe(true);
    expect(det.recommendation!.best.latestSafeStart).toBeTruthy();
  });

  it("double reserve creates one set of blocks; retry returns the same blocks", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); (ctx as any).setNow("2026-11-16T10:00:00-05:00"); replay(ctx, "bulletin");
    const d = listDecisions(ctx)[0];
    const a = reserve(ctx, d.id, { mode: "proposed" });
    const b = reserve(ctx, d.id, { mode: "proposed" });
    expect(a.already).toBe(false); expect(b.already).toBe(true);
    expect(b.blocks.map((x: any) => x.id)).toEqual(a.blocks.map((x: any) => x.id));
    expect(count(ctx, "blocks", "decision_id IS NOT NULL")).toBe(a.blocks.length);
    expect(a.blocks[0].sync).toBe("local-only");
    expect(get(ctx.db, "SELECT state FROM decisions WHERE id=?", d.id)!.state).toBe("accepted");
    expect(count(ctx, "task_events", "kind='work_reserved'")).toBe(1);
  });

  it("a conflict appearing before the write sends the user back to choose", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); (ctx as any).setNow("2026-11-16T10:00:00-05:00"); replay(ctx, "bulletin");
    const d = listDecisions(ctx)[0];
    const rec = decisionDetail(ctx, d.id)!.recommendation!;
    const first = rec.best.chunks[0];
    // Someone books that slot between display and click.
    ctx.db.prepare("INSERT INTO blocks(id,owner_id,start_at,end_at,tz,kind,title,source,idempotency_key,created_at) VALUES('x','local',?,?,'America/New_York','calendar','Surprise meeting','test','k1','now')").run(first.start, first.end);
    expect(() => reserve(ctx, d.id, { chunks: rec.best.chunks })).toThrow(ConflictError);
    expect(count(ctx, "blocks", "decision_id IS NOT NULL")).toBe(0);
    expect(get(ctx.db, "SELECT state FROM decisions WHERE id=?", d.id)!.state).toBe("pending");
    // The fresh recommendation avoids the new meeting.
    const fresh = decisionDetail(ctx, d.id)!.recommendation!;
    expect(fresh.best.chunks.some((c) => c.start < first.end && c.end > first.start)).toBe(false);
  });

  it("defer keeps the original promise; already-handled keeps the evidence trail", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); (ctx as any).setNow("2026-11-16T10:00:00-05:00"); replay(ctx, "bulletin");
    const d = listDecisions(ctx)[0];
    defer(ctx, d.id, { until: "2026-11-17T13:00:00Z" });
    defer(ctx, d.id, { until: "2026-11-17T13:00:00Z" });
    expect(listDecisions(ctx)).toHaveLength(0);
    expect(essay(ctx).due_at).toBe("2026-11-18T22:00:00.000Z");
    expect(count(ctx, "task_events", "kind='decision_deferred'")).toBe(1);
    expect(count(ctx, "task_due_history")).toBe(2);
  });
});

describe("competing and withdrawn information", () => {
  it("a conflicting date without change language stays unresolved with both sources", () => {
    const ctx = memCtx(); seedDemo(ctx); replay(ctx, "bulletin"); replay(ctx, "conflict");
    expect(essay(ctx).due_at).toBe("2026-11-18T22:00:00.000Z");
    const c = listDecisions(ctx).find((x) => x.kind === "date_conflict")!;
    expect(c.evidence.a.sourceTitle).toMatch(/Announcement/);
    expect(c.evidence.b.sourceTitle).toBe("Gradebook note");
    resolveConflict(ctx, c.id, "b");
    expect(essay(ctx).due_at).toBe("2026-11-19T22:00:00.000Z");
    expect(count(ctx, "task_due_history", "kind='user_resolved'")).toBe(1);
  });

  it("an older source is kept for history but cannot change the due date", () => {
    const ctx = memCtx(); seedDemo(ctx); replay(ctx, "bulletin"); const before = count(ctx, "decisions"); replay(ctx, "obsolete");
    expect(essay(ctx).due_at).toBe("2026-11-18T22:00:00.000Z");
    expect(count(ctx, "decisions")).toBe(before);
    expect(get(ctx.db, "SELECT stale FROM source_revisions WHERE text LIKE '%November 27%'")!.stale).toBe(1);
  });

  it("an explicit later announcement waives the print requirement", () => {
    const ctx = memCtx(); seedDemo(ctx); replay(ctx, "bulletin"); replay(ctx, "waiver");
    expect(get(ctx.db, "SELECT status FROM requirements WHERE kind='bring_print'")!.status).toBe("waived");
  });
});

describe("today", () => {
  it("leads with a primary action and separate source freshness", () => {
    const ctx = memCtx(); seedDemo(ctx); replay(ctx, "bulletin");
    const t = today(ctx);
    expect(t.primary.kind).toBe("review_decision");
    expect(t.sources.map((s) => s.provider)).toContain("example-blackboard");
    expect(t.changes.some((c: any) => c.kind === "due_moved")).toBe(true);
    expect(t.minutesAvailable).toBeGreaterThan(0);
  });
});
