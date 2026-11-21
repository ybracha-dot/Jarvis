// Tasks, accountability and completion evidence.
import { z } from "zod";
import { Ctx, all, get, run, tx, uid } from "./db";
import { HttpError } from "./decisions";
import { addTaskEvent } from "./ingest";
import { fmtDateTime, localDate } from "./time";

export function listTasks(ctx: Ctx, f: { status?: string; course?: string; kind?: string } = {}) {
  const where = ["t.owner_id=?"]; const p: any[] = [ctx.owner];
  if (f.status === "open") where.push("t.status!='done'"); else if (f.status) { where.push("t.status=?"); p.push(f.status); }
  if (f.course) { where.push("c.external_id=?"); p.push(f.course); }
  if (f.kind) { where.push("t.kind=?"); p.push(f.kind); }
  const rows = all(ctx.db,
    `SELECT t.*, c.code course_code, c.name course_name, c.external_id course_ext FROM tasks t LEFT JOIN courses c ON c.id=t.course_id
     WHERE ${where.join(" AND ")} ORDER BY COALESCE(t.due_at,'9999')`, ...p);
  return rows.map((t) => {
    const reqs = all(ctx.db, "SELECT kind,text,mandatory,status FROM requirements WHERE task_id=? AND status='active'", t.id);
    const logged = get(ctx.db, "SELECT COALESCE(SUM(actual_minutes),0) m FROM time_logs WHERE task_id=?", t.id)!.m as number;
    return { ...t, meta: JSON.parse(t.meta as string), requirements: reqs, loggedMinutes: logged };
  });
}

export function taskDetail(ctx: Ctx, id: string) {
  const t = get(ctx.db, "SELECT t.*, c.code course_code, c.name course_name FROM tasks t LEFT JOIN courses c ON c.id=t.course_id WHERE t.id=? AND t.owner_id=?", id, ctx.owner);
  if (!t) return null;
  return {
    task: { ...t, meta: JSON.parse(t.meta as string) },
    dueHistory: all(ctx.db, `SELECT h.*, r.text rev_text, r.published_at rev_published, s.title source_title, s.provider FROM task_due_history h
      LEFT JOIN source_revisions r ON r.id=h.revision_id LEFT JOIN sources s ON s.id=r.source_id WHERE h.task_id=? ORDER BY h.recorded_at, h.rowid`, id),
    requirements: all(ctx.db, `SELECT q.*, s.title source_title FROM requirements q LEFT JOIN source_revisions r ON r.id=q.revision_id LEFT JOIN sources s ON s.id=r.source_id WHERE q.task_id=? ORDER BY q.created_at`, id)
      .map((q) => ({ ...q, detail: JSON.parse(q.detail as string) })),
    events: all(ctx.db, "SELECT * FROM task_events WHERE task_id=? ORDER BY at, rowid", id).map((e) => ({ ...e, ref: JSON.parse(e.ref as string) })),
    blocks: all(ctx.db, "SELECT * FROM blocks WHERE task_id=? AND state='active' ORDER BY start_at", id),
    children: all(ctx.db, "SELECT id,title,milestone,due_at,status,effort_minutes FROM tasks WHERE parent_id=? ORDER BY due_at", id),
    checkpoints: all(ctx.db, "SELECT * FROM checkpoints WHERE task_id=? ORDER BY at DESC", id),
    timeLogs: all(ctx.db, "SELECT * FROM time_logs WHERE task_id=? ORDER BY at", id),
    practice: all(ctx.db, "SELECT * FROM practice_results WHERE task_id=? ORDER BY at", id),
    sources: all(ctx.db, `SELECT s.id, s.title, s.provider, s.kind, r.id revision_id, r.published_at, r.duplicate_of, r.stale, substr(r.text,1,400) excerpt FROM sources s
      JOIN source_revisions r ON r.source_id=s.id WHERE s.course_id=? ORDER BY r.published_at`, t.course_id),
  };
}

export const StatusInput = z.object({
  status: z.enum(["open", "blocked", "deferred"]), reason: z.string().max(300).optional(), until: z.string().optional(),
  flag: z.enum(["estimate_low", "blocked", "deferred"]).optional(),
});
export function setStatus(ctx: Ctx, id: string, raw: z.input<typeof StatusInput>) {
  const i = StatusInput.parse(raw);
  return tx(ctx.db, () => {
    const t = get(ctx.db, "SELECT * FROM tasks WHERE id=? AND owner_id=?", id, ctx.owner);
    if (!t) throw new HttpError(404, "Task not found");
    if (t.status === "done") throw new HttpError(409, "Task is done. Reopen it first.");
    if (i.status === "deferred" && !i.until) throw new HttpError(422, "Deferring needs a date.");
    // The original promise (original_due_at and due history) is never rewritten by a defer.
    run(ctx.db, "UPDATE tasks SET status=?, status_reason=?, deferred_until=? WHERE id=?", i.status, i.reason ?? null, i.status === "deferred" ? new Date(i.until!).toISOString() : null, id);
    const msg = i.status === "deferred" ? `Deferred until ${fmtDateTime(i.until!)}. The original due date ${t.original_due_at ? fmtDateTime(t.original_due_at as string) : ""} still stands.`
      : i.status === "blocked" ? `Blocked${i.reason ? `: ${i.reason}` : ""}` : "Back to open";
    addTaskEvent(ctx, id, `status_${i.status}`, msg, { reason: i.reason ?? null });
    return { ok: true };
  });
}

export const CompleteInput = z.object({
  kind: z.enum(["draft_saved", "user_completed", "submission_receipt"]),
  revisionId: z.string().optional(), note: z.string().max(500).optional(),
});
/** A draft, your own completion and a submission receipt are three different events. */
export function recordCompletion(ctx: Ctx, id: string, raw: z.input<typeof CompleteInput>) {
  const i = CompleteInput.parse(raw);
  return tx(ctx.db, () => {
    const t = get(ctx.db, "SELECT * FROM tasks WHERE id=? AND owner_id=?", id, ctx.owner);
    if (!t) throw new HttpError(404, "Task not found");
    const now = ctx.now().toISOString();
    if (i.kind === "draft_saved") {
      addTaskEvent(ctx, id, "draft_saved", i.note ? `Draft saved: ${i.note}` : "Draft saved. This is not a submission.", {});
      return { ok: true, status: t.status, receipt: false };
    }
    if (i.kind === "submission_receipt") {
      const rev = i.revisionId && get(ctx.db,
        "SELECT r.id, r.text, s.kind, s.title, s.course_id FROM source_revisions r JOIN sources s ON s.id=r.source_id WHERE r.id=?", i.revisionId);
      if (!rev || rev.kind !== "receipt" || rev.course_id !== t.course_id) {
        throw new HttpError(422, "A submission receipt must come from an imported receipt source for this course. A saved draft is not a receipt.");
      }
      run(ctx.db, "UPDATE tasks SET status='done', completed_at=? WHERE id=?", now, id);
      addTaskEvent(ctx, id, "submission_receipt", `Submission receipt: ${rev.title}`, { revisionId: rev.id });
      return { ok: true, status: "done", receipt: true };
    }
    run(ctx.db, "UPDATE tasks SET status='done', completed_at=? WHERE id=?", now, id);
    addTaskEvent(ctx, id, "user_completed", i.note ? `You marked this done: ${i.note}` : "You marked this done. No submission receipt on file.", {});
    return { ok: true, status: "done", receipt: false };
  });
}

export function reopenTask(ctx: Ctx, id: string) {
  const t = get(ctx.db, "SELECT * FROM tasks WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!t) throw new HttpError(404, "Task not found");
  run(ctx.db, "UPDATE tasks SET status='open', completed_at=NULL, status_reason=NULL WHERE id=?", id);
  addTaskEvent(ctx, id, "reopened", "Reopened");
  return { ok: true };
}

export const TimeLogInput = z.object({
  plannedMinutes: z.number().int().min(0).max(2000).optional(), actualMinutes: z.number().int().min(0).max(2000),
  reason: z.string().max(300).optional(), flag: z.enum(["estimate_low", "blocked", "deferred"]).optional(),
});
export function logTime(ctx: Ctx, id: string, raw: z.input<typeof TimeLogInput>) {
  const i = TimeLogInput.parse(raw);
  const t = get(ctx.db, "SELECT * FROM tasks WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!t) throw new HttpError(404, "Task not found");
  run(ctx.db, "INSERT INTO time_logs(id,task_id,planned_minutes,actual_minutes,reason,flag,at) VALUES(?,?,?,?,?,?,?)",
    uid("tl"), id, i.plannedMinutes ?? null, i.actualMinutes, i.reason ?? null, i.flag ?? null, ctx.now().toISOString());
  addTaskEvent(ctx, id, "time_logged", `Logged ${i.actualMinutes} min${i.plannedMinutes ? ` (planned ${i.plannedMinutes})` : ""}${i.flag ? ` · ${i.flag.replace("_", " ")}` : ""}${i.reason ? ` · ${i.reason}` : ""}`, {});
  return { ok: true };
}

export function completedTasks(ctx: Ctx, course?: string) {
  const rows = all(ctx.db,
    `SELECT t.*, c.code course_code, c.external_id course_ext FROM tasks t LEFT JOIN courses c ON c.id=t.course_id WHERE t.owner_id=? AND t.status='done' ${course ? "AND c.external_id=?" : ""} ORDER BY t.completed_at DESC`,
    ...(course ? [ctx.owner, course] : [ctx.owner]));
  return rows.map((t) => ({
    ...t, day: localDate(t.completed_at as string),
    evidence: all(ctx.db, "SELECT at,kind,summary FROM task_events WHERE task_id=? AND kind IN ('draft_saved','user_completed','submission_receipt') ORDER BY at", t.id),
  }));
}

export function weeklyReview(ctx: Ctx) {
  const logs = all(ctx.db, "SELECT l.*, t.title FROM time_logs l JOIN tasks t ON t.id=l.task_id WHERE t.owner_id=? AND l.planned_minutes IS NOT NULL AND l.planned_minutes>0", ctx.owner);
  if (!logs.length) return { adjustment: null, evidence: [], note: "No planned-vs-actual logs yet. Jarvis does not guess effort from calendar blocks." };
  const over = logs.filter((l) => (l.actual_minutes as number) > (l.planned_minutes as number) * 1.25);
  if (!over.length) return { adjustment: null, evidence: logs.map((l) => `${l.title}: ${l.actual_minutes}/${l.planned_minutes} min`), note: "Estimates held within 25%." };
  const ratio = over.reduce((n, l) => n + (l.actual_minutes as number) / (l.planned_minutes as number), 0) / over.length;
  return { adjustment: `Raise estimates for similar work by about ${Math.round((ratio - 1) * 100)}%.`, evidence: over.map((l) => `${l.title}: ${l.actual_minutes} actual vs ${l.planned_minutes} planned`), note: "Based on your logged time only." };
}
