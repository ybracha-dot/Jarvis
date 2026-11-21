// Decisions: emit (deduplicated), inspect, and act on (idempotent).
import { z } from "zod";
import { Ctx, all, get, run, tx, uid, logActivity, getSetting } from "./db";
import { createStudyPlan } from "./study";
import { classify, enqueue } from "./notify";
import { planWork, collides, Plan, Chunk } from "./planner";
import { fmtDateTime, minutesBetween } from "./time";
import { createTask } from "./ingest";
import { createCommitment } from "./commitments";

export interface DecisionSpec {
  dedupKey: string; taskId?: string; kind: string; title: string; summary: string; evidence: unknown;
  options: { id: string; label: string }[]; expiresAt: string | null; supersedeKind?: string;
}

export function emitDecision(ctx: Ctx, s: DecisionSpec): { id: string; created: boolean } {
  const existing = get(ctx.db, "SELECT id FROM decisions WHERE owner_id=? AND dedup_key=?", ctx.owner, s.dedupKey);
  if (existing) return { id: existing.id as string, created: false };
  const { level, reason } = classify(ctx, s.expiresAt, s.kind);
  const id = uid("dec");
  run(ctx.db,
    `INSERT INTO decisions(id,owner_id,dedup_key,task_id,kind,title,summary,options,evidence,urgency,urgency_reason,expires_at,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ctx.owner, s.dedupKey, s.taskId ?? null, s.kind, s.title, s.summary, JSON.stringify(s.options), JSON.stringify(s.evidence),
    level, reason, s.expiresAt, ctx.now().toISOString());
  if (s.supersedeKind && s.taskId) {
    run(ctx.db, "UPDATE decisions SET state='superseded', resolved_at=? WHERE task_id=? AND kind=? AND state='pending' AND id!=?",
      ctx.now().toISOString(), s.taskId, s.supersedeKind, id);
  }
  enqueue(ctx, { eventKey: `decision:${id}`, level, title: s.title, body: s.summary, decisionId: id });
  logActivity(ctx, "decision", id, s.title);
  return { id, created: true };
}

const parse = (d: any) => ({
  ...d, options: JSON.parse(d.options), evidence: JSON.parse(d.evidence), resolution: d.resolution ? JSON.parse(d.resolution) : null,
});

export function listDecisions(ctx: Ctx, states: string[] = ["pending"]) {
  const q = states.map(() => "?").join(",");
  return all(ctx.db, `SELECT * FROM decisions WHERE owner_id=? AND state IN (${q}) ORDER BY
    CASE urgency WHEN 'interrupt' THEN 0 WHEN 'brief' THEN 1 ELSE 2 END, created_at DESC`, ctx.owner, ...states).map(parse);
}

export interface Recommendation { best: Plan; alternative: Plan; impact: string[]; displaced: { id: string; start: string; title: string }[] }

export function recommendationFor(ctx: Ctx, decision: any): Recommendation | null {
  if (!["deadline_moved", "commitment_plan"].includes(decision.kind) || !decision.task_id) return null;
  const task = get(ctx.db, "SELECT * FROM tasks WHERE id=? AND owner_id=?", decision.task_id, ctx.owner);
  if (!task || !task.due_at) return null;
  const now = ctx.now();
  const o = { effort: task.effort_minutes as number, from: now, due: new Date(task.due_at as string), excludeDecisionId: decision.id as string };
  const best = planWork(ctx, { ...o, strategy: "early" });
  const alternative = planWork(ctx, { ...o, strategy: "late" });
  const dueMs = new Date(task.due_at as string).getTime();
  const displaced = all(ctx.db,
    "SELECT id,start_at,title FROM blocks WHERE owner_id=? AND task_id=? AND state='active' AND kind IN ('proposed','booked') AND start_at>=?",
    ctx.owner, task.id, new Date(dueMs).toISOString()).map((b) => ({ id: b.id as string, start: b.start_at as string, title: b.title as string }));
  const existing = all(ctx.db, "SELECT start_at,end_at,kind FROM blocks WHERE owner_id=? AND task_id=? AND state='active' AND kind IN ('proposed','booked')", ctx.owner, task.id);
  const impact: string[] = [];
  if (displaced.length) impact.push(`${displaced.length} existing planned block${displaced.length > 1 ? "s" : ""} fall after the new due date.`);
  else if (existing.length) impact.push(`${existing.length} existing planned block${existing.length > 1 ? "s" : ""} still fit before the new due date.`);
  else impact.push("No work blocks were planned for this task yet.");
  if (best.shortfall > 0) impact.push(`Shortfall: ${best.shortfall} of ${task.effort_minutes} minutes do not fit before the due date.`);
  else if (best.latestSafeStart) impact.push(`Latest safe start: ${fmtDateTime(best.latestSafeStart)}.`);
  return { best, alternative, impact, displaced };
}

export function decisionDetail(ctx: Ctx, id: string) {
  const d = get(ctx.db, "SELECT * FROM decisions WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!d) return null;
  const dec = parse(d);
  const task = d.task_id ? get(ctx.db, "SELECT * FROM tasks WHERE id=?", d.task_id) : null;
  const blocks = all(ctx.db, "SELECT * FROM blocks WHERE decision_id=? AND state='active' ORDER BY start_at", id);
  const trail = d.task_id ? all(ctx.db, "SELECT at,kind,summary FROM task_events WHERE task_id=? ORDER BY at, rowid", d.task_id) : [];
  const rec = dec.state === "pending" ? recommendationFor(ctx, dec) : null;
  return { decision: dec, task, recommendation: rec, blocks, trail };
}

export class ConflictError extends Error {
  constructor(public conflictWith: string, public fresh: Recommendation | null) { super(`That time is no longer free (${conflictWith}). Choose another slot.`); }
}

export const ReserveInput = z.object({
  mode: z.enum(["proposed", "confirmed"]).default("proposed"),
  plan: z.enum(["best", "alternative"]).default("best"),
  chunks: z.array(z.object({ start: z.string(), end: z.string() })).max(12).optional(),
});

/** Create local work blocks. Idempotent per decision: repeated calls return the same blocks. */
export function reserve(ctx: Ctx, decisionId: string, raw: z.input<typeof ReserveInput>) {
  const input = ReserveInput.parse(raw);
  return tx(ctx.db, () => {
    const d = get(ctx.db, "SELECT * FROM decisions WHERE id=? AND owner_id=?", decisionId, ctx.owner);
    if (!d) throw new HttpError(404, "Decision not found");
    const existing = all(ctx.db, "SELECT * FROM blocks WHERE decision_id=? AND state='active' ORDER BY start_at", decisionId);
    if (d.state === "accepted" && existing.length) return { blocks: existing, already: true };
    if (d.state !== "pending") throw new HttpError(409, `Decision is ${d.state}`);
    const task = get(ctx.db, "SELECT * FROM tasks WHERE id=?", d.task_id);
    if (!task || !task.due_at) throw new HttpError(422, "Decision has no schedulable task");
    const dec = parse(d);
    const rec = recommendationFor(ctx, dec)!;
    const chunks: Chunk[] = (input.chunks as Chunk[] | undefined) ?? (input.plan === "alternative" ? rec.alternative.chunks : rec.best.chunks);
    if (!chunks.length) throw new HttpError(422, "No feasible block. Defer or change the plan.");
    const dueMs = new Date(task.due_at as string).getTime();
    for (const c of chunks) {
      const s = new Date(c.start).getTime(), e = new Date(c.end).getTime();
      if (!(e > s) || e > dueMs) throw new HttpError(422, "A block ends after the due date");
      if (s < ctx.now().getTime() - 60000) throw new HttpError(422, "A block starts in the past");
      // Check again just before writing.
      const hit = collides(ctx, c.start, c.end, { excludeDecisionId: decisionId });
      if (hit) throw new ConflictError(hit.label ?? "another commitment", recommendationFor(ctx, dec));
    }
    const kind = input.mode === "confirmed" ? "booked" : "proposed";
    const ids: string[] = [];
    chunks.forEach((c, i) => {
      const id = uid("blk");
      const r = run(ctx.db,
        `INSERT OR IGNORE INTO blocks(id,owner_id,start_at,end_at,tz,kind,title,task_id,decision_id,source,revision_id,idempotency_key,sync,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, ctx.owner, new Date(c.start).toISOString(), new Date(c.end).toISOString(), "America/New_York", kind, `Work: ${task.title}`,
        task.id, decisionId, "jarvis", dec.evidence?.revisionId ?? null, `reserve:${decisionId}:${i}`, "local-only", ctx.now().toISOString());
      if (Number(r.changes) > 0) ids.push(id);
    });
    const total = chunks.reduce((n, c) => n + minutesBetween(c.start, c.end), 0);
    run(ctx.db, "UPDATE decisions SET state='accepted', resolution=?, resolved_at=? WHERE id=?",
      JSON.stringify({ action: "reserve", mode: kind, blocks: ids, minutes: total }), ctx.now().toISOString(), decisionId);
    run(ctx.db, "UPDATE tasks SET next_step=COALESCE(next_step, ?) WHERE id=?", "Start the first reserved block", task.id);
    addEvent(ctx, task.id as string, "work_reserved", `Reserved ${total} min in ${ids.length} local ${kind} block${ids.length > 1 ? "s" : ""} (not on Google Calendar)`, { decisionId, blocks: ids });
    logActivity(ctx, "reserve", decisionId, `${kind} ${ids.length} blocks`);
    return { blocks: all(ctx.db, "SELECT * FROM blocks WHERE decision_id=? AND state='active' ORDER BY start_at", decisionId), already: false };
  });
}

function addEvent(ctx: Ctx, taskId: string, kind: string, summary: string, ref: unknown) {
  run(ctx.db, "INSERT INTO task_events(id,task_id,at,kind,summary,ref) VALUES(?,?,?,?,?,?)", uid("evt"), taskId, ctx.now().toISOString(), kind, summary, JSON.stringify(ref));
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export const DeferInput = z.object({ until: z.string().refine((s) => !Number.isNaN(Date.parse(s))), reason: z.string().max(300).optional() });
export function defer(ctx: Ctx, id: string, raw: z.input<typeof DeferInput>) {
  const input = DeferInput.parse(raw);
  return tx(ctx.db, () => {
    const d = get(ctx.db, "SELECT * FROM decisions WHERE id=? AND owner_id=?", id, ctx.owner);
    if (!d) throw new HttpError(404, "Decision not found");
    if (d.state === "deferred") return { ok: true, already: true };
    if (d.state !== "pending") throw new HttpError(409, `Decision is ${d.state}`);
    run(ctx.db, "UPDATE decisions SET state='deferred', resolution=?, resolved_at=? WHERE id=?",
      JSON.stringify({ action: "defer", until: new Date(input.until).toISOString(), reason: input.reason ?? null }), ctx.now().toISOString(), id);
    if (d.task_id) addEvent(ctx, d.task_id as string, "decision_deferred", `Deferred until ${fmtDateTime(input.until)}. The original due date still stands.`, { decisionId: id });
    return { ok: true, already: false };
  });
}

export function markHandled(ctx: Ctx, id: string, note?: string) {
  return tx(ctx.db, () => {
    const d = get(ctx.db, "SELECT * FROM decisions WHERE id=? AND owner_id=?", id, ctx.owner);
    if (!d) throw new HttpError(404, "Decision not found");
    if (d.state === "handled") return { ok: true, already: true };
    if (d.state !== "pending") throw new HttpError(409, `Decision is ${d.state}`);
    run(ctx.db, "UPDATE decisions SET state='handled', resolution=?, resolved_at=? WHERE id=?",
      JSON.stringify({ action: "handled", note: note ?? null }), ctx.now().toISOString(), id);
    if (d.task_id) addEvent(ctx, d.task_id as string, "decision_handled", "Marked already handled. Evidence trail kept.", { decisionId: id });
    return { ok: true, already: false };
  });
}

/** Pick one side of a date conflict. Both sources stay visible in history. */
export function resolveConflict(ctx: Ctx, id: string, side: "a" | "b") {
  return tx(ctx.db, () => {
    const d = get(ctx.db, "SELECT * FROM decisions WHERE id=? AND owner_id=?", id, ctx.owner);
    if (!d || d.kind !== "date_conflict") throw new HttpError(404, "Conflict not found");
    if (d.state !== "pending") return { ok: true, already: true };
    const ev = JSON.parse(d.evidence as string);
    const chosen = ev[side];
    run(ctx.db, "UPDATE tasks SET due_at=? WHERE id=?", chosen.due, d.task_id);
    run(ctx.db, "INSERT INTO task_due_history(id,task_id,due_at,revision_id,recorded_at,kind,note) VALUES(?,?,?,?,?,?,?)",
      uid("dh"), d.task_id, chosen.due, chosen.revisionId, ctx.now().toISOString(), "user_resolved", `You chose ${chosen.sourceTitle}`);
    run(ctx.db, "UPDATE decisions SET state='accepted', resolution=?, resolved_at=? WHERE id=?", JSON.stringify({ action: "choose_" + side }), ctx.now().toISOString(), id);
    addEvent(ctx, d.task_id as string, "conflict_resolved", `You chose ${fmtDateTime(chosen.due)} (${chosen.sourceTitle})`, { decisionId: id });
    return { ok: true, already: false };
  });
}

export function acceptNewTask(ctx: Ctx, id: string) {
  const d = get(ctx.db, "SELECT * FROM decisions WHERE id=? AND owner_id=? AND kind='new_task'", id, ctx.owner);
  if (!d) throw new HttpError(404, "Not found");
  return tx(ctx.db, () => {
    if (d.state !== "pending") return { ok: true, already: true };
    const p = JSON.parse(d.evidence as string).proposed;
    const isExam = /midterm|exam|quiz|final/i.test(p.externalId);
    const taskId = createTask(ctx, { courseExternalId: p.courseExternalId, externalId: p.externalId, title: p.title, dueAt: p.dueAt, kind: isExam ? "exam" : "assignment", effortMinutes: isExam ? 480 : 90 });
    let plan: unknown = null;
    if (isExam) {
      const weak = getSetting<Record<string, string[]>>(ctx.db, "weak_areas", {})[p.courseExternalId] ?? [];
      plan = createStudyPlan(ctx, taskId, weak);
    }
    run(ctx.db, "UPDATE decisions SET state='accepted', task_id=?, resolution=?, resolved_at=? WHERE id=?", taskId, JSON.stringify({ action: "accept", taskId }), ctx.now().toISOString(), id);
    return { ok: true, already: false, taskId, plan };
  });
}

/** Bring deferred decisions back when their date arrives. */
export function resurfaceDeferred(ctx: Ctx): number {
  const now = ctx.now().toISOString();
  let n = 0;
  for (const d of all(ctx.db, "SELECT id,resolution,title FROM decisions WHERE owner_id=? AND state='deferred'", ctx.owner)) {
    const r = JSON.parse(d.resolution as string);
    if (r.until <= now) {
      run(ctx.db, "UPDATE decisions SET state='pending', resolution=NULL, resolved_at=NULL WHERE id=?", d.id);
      enqueue(ctx, { eventKey: `resurface:${d.id}:${r.until}`, level: "brief", title: `Back from deferral: ${d.title}`, body: "You asked to see this again.", decisionId: d.id as string });
      n++;
    }
  }
  return n;
}

export function acceptPromise(ctx: Ctx, id: string) {
  const d = get(ctx.db, "SELECT * FROM decisions WHERE id=? AND owner_id=? AND kind='promise_found'", id, ctx.owner);
  if (!d) throw new HttpError(404, "Not found");
  return tx(ctx.db, () => {
    if (d.state !== "pending") return { ok: true, already: true };
    const p = JSON.parse(d.evidence as string).proposed;
    const cid = createCommitment(ctx, { who: p.who, owedTo: p.owedTo, action: p.action, dueDate: p.dueDate, agreement: JSON.parse(d.evidence as string).quote, dedupe: true });
    run(ctx.db, "UPDATE decisions SET state='accepted', resolution=?, resolved_at=? WHERE id=?", JSON.stringify({ action: "accept", commitmentId: cid }), ctx.now().toISOString(), id);
    return { ok: true, already: false, commitmentId: cid };
  });
}
