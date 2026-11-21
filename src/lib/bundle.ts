// The documented JSON source bundle (schemaVersion 1). Used by fixtures and by the JSON import path.
import { z } from "zod";
import { Ctx, run, tx, uid, sha, get } from "./db";
import { ingestRevision, createTask, recordSourceStatus, upsertCourse, IngestResult } from "./ingest";
import { createCommitment } from "./commitments";
import { upsertGoal } from "./goals";

const Iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO timestamp with offset");
export const Bundle = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["example", "personal"]).optional(),
  timezone: z.string().default("America/New_York"),
  clock: Iso.optional(),
  provider: z.string().max(60).optional(),
  assignment: z.object({
    courseId: z.string().min(1), courseCode: z.string().optional(), courseName: z.string().optional(),
    externalId: z.string().min(1), title: z.string().min(1), originalDue: Iso.optional(), effortMinutes: z.number().int().min(5).max(6000).default(60),
  }).optional(),
  revisions: z.array(z.object({
    id: z.string().min(1), publishedAt: Iso, text: z.string().min(1).max(200_000),
    kind: z.enum(["syllabus", "announcement", "email", "assignment", "reference", "receipt", "other"]).optional(),
    title: z.string().optional(),
  })).default([]),
  calendar: z.array(z.object({ title: z.string().min(1), start: Iso, end: Iso })).default([]),
  promise: z.object({ who: z.string(), owedTo: z.string(), action: z.string(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).optional(),
  goal: z.object({ name: z.string(), completed: z.number(), targetToday: z.number().optional(), targetTotal: z.number(), unit: z.string().optional(), deadline: z.string().optional(), startDate: z.string().optional() }).optional(),
});
export type Bundle = z.infer<typeof Bundle>;

export interface BundleResult { results: IngestResult[]; calendarAdded: number; calendarSeen: number; taskId: string | null; warnings: string[] }

export function upsertCalendar(ctx: Ctx, provider: string, events: { title: string; start: string; end: string; tz?: string }[], label: string): { added: number; seen: number } {
  let added = 0;
  for (const e of events) {
    const key = `cal:${provider}:${sha(`${e.title}|${new Date(e.start).toISOString()}|${new Date(e.end).toISOString()}`).slice(0, 24)}`;
    const r = run(ctx.db,
      "INSERT OR IGNORE INTO blocks(id,owner_id,start_at,end_at,tz,kind,title,source,idempotency_key,sync,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      uid("blk"), ctx.owner, new Date(e.start).toISOString(), new Date(e.end).toISOString(), e.tz ?? "America/New_York", "calendar", e.title, provider, key, "imported", ctx.now().toISOString());
    added += Number(r.changes);
  }
  recordSourceStatus(ctx, provider, label, true);
  return { added, seen: events.length };
}

export function importBundle(ctx: Ctx, raw: unknown, opts: { provider?: string } = {}): BundleResult {
  const b = Bundle.parse(raw);
  const provider = b.provider ?? opts.provider ?? (b.mode === "example" ? "example-blackboard" : "json-bundle");
  const warnings: string[] = [];
  const results: IngestResult[] = [];
  let taskId: string | null = null;
  return tx(ctx.db, () => {
    if (b.assignment) {
      const a = b.assignment;
      taskId = createTask(ctx, { courseExternalId: a.courseId, externalId: a.externalId, title: a.title, dueAt: a.originalDue ? new Date(a.originalDue).toISOString() : null, effortMinutes: a.effortMinutes, courseCode: a.courseCode, courseName: a.courseName });
    }
    const courseExt = b.assignment?.courseId;
    for (const r of [...b.revisions].sort((x, y) => x.publishedAt.localeCompare(y.publishedAt))) {
      if (!courseExt) { warnings.push(`Revision ${r.id} skipped: no assignment.courseId to attach it to.`); continue; }
      const kind = r.kind ?? (/^syllabus/i.test(r.id) ? "syllabus" : "announcement");
      results.push(ingestRevision(ctx, {
        provider, externalId: r.id, title: r.title ?? (kind === "syllabus" ? "Syllabus" : `Announcement ${r.id.replace(/\D+/g, "") || r.id}`),
        courseExternalId: courseExt, courseCode: b.assignment?.courseCode, courseName: b.assignment?.courseName, kind, text: r.text, publishedAt: r.publishedAt,
      }));
    }
    const cal = b.calendar.length ? upsertCalendar(ctx, provider === "example-blackboard" ? "example-calendar" : "ics-bundle", b.calendar.map((c) => ({ ...c, tz: b.timezone })), provider === "example-blackboard" ? "Calendar (example)" : "Calendar (bundle)") : { added: 0, seen: 0 };
    if (b.promise) {
      createCommitment(ctx, { who: b.promise.who, owedTo: b.promise.owedTo, action: b.promise.action, dueDate: b.promise.dueDate, agreement: "From JSON bundle", dedupe: true });
    }
    if (b.goal) {
      upsertGoal(ctx, {
        name: b.goal.name, unit: b.goal.unit ?? "conversations", completed: b.goal.completed, targetTotal: b.goal.targetTotal,
        startDate: b.goal.startDate ?? "2026-11-02", deadline: b.goal.deadline ?? "2026-12-28",
        milestones: b.goal.targetToday != null && b.clock ? [{ on: b.clock.slice(0, 10), target: b.goal.targetToday }, { on: b.goal.deadline ?? "2026-12-28", target: b.goal.targetTotal }] : [],
      });
    }
    return { results, calendarAdded: cal.added, calendarSeen: cal.seen, taskId, warnings };
  });
}
export { get };
