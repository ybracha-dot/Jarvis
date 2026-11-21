// Source reconciliation. One atomic transaction per revision: store source + revision, update tasks, emit decisions.
import { z } from "zod";
import { Ctx, all, get, run, tx, uid, stableId, sha, logActivity, getSetting } from "./db";
import { extractFacts, Facts, DateMention } from "./extract";
import { diffDays, localDate, localHM, fmtDateTime, zonedToUtc } from "./time";
import { emitDecision } from "./decisions";
import { planWork } from "./planner";
import { findPromises } from "./commitments";
import { resolveWeekday } from "./extract";
import { watchDeadlines } from "./deadline-watch";

export const SOURCE_KINDS = ["syllabus", "announcement", "email", "assignment", "calendar", "reference", "receipt", "other"] as const;
export const IngestInput = z.object({
  provider: z.string().min(1).max(60),
  externalId: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  uri: z.string().max(1000).optional(),
  courseExternalId: z.string().min(1).max(100),
  courseCode: z.string().max(40).optional(),
  courseName: z.string().max(200).optional(),
  kind: z.enum(SOURCE_KINDS),
  text: z.string().min(1).max(200_000),
  publishedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "publishedAt must be an ISO timestamp"),
});
export type IngestInput = z.infer<typeof IngestInput>;

export interface Change { type: string; taskId?: string; summary: string; decisionId?: string }
export interface IngestResult {
  sourceId: string; revisionId: string | null; newRevision: boolean; duplicateOf: string | null; stale: boolean;
  changes: Change[]; decisionIds: string[];
}

export function upsertCourse(ctx: Ctx, externalId: string, code?: string, name?: string): string {
  const id = stableId("crs", ctx.owner, externalId);
  run(ctx.db, "INSERT OR IGNORE INTO courses(id,owner_id,external_id,code,name) VALUES(?,?,?,?,?)",
    id, ctx.owner, externalId, code ?? externalId.replace(/^example-/, "").toUpperCase(), name ?? code ?? externalId);
  return id;
}

export function addTaskEvent(ctx: Ctx, taskId: string, kind: string, summary: string, ref: unknown = {}): void {
  run(ctx.db, "INSERT INTO task_events(id,task_id,at,kind,summary,ref) VALUES(?,?,?,?,?,?)",
    uid("evt"), taskId, ctx.now().toISOString(), kind, summary, JSON.stringify(ref));
}

export function createTask(ctx: Ctx, o: {
  courseExternalId: string; externalId: string; title: string; dueAt?: string | null; effortMinutes?: number; kind?: string;
  courseCode?: string; courseName?: string; parentId?: string; milestone?: string; meta?: unknown; nextStep?: string;
}): string {
  const courseId = upsertCourse(ctx, o.courseExternalId, o.courseCode, o.courseName);
  const id = stableId("task", ctx.owner, courseId, o.externalId);
  const res = run(ctx.db,
    `INSERT OR IGNORE INTO tasks(id,owner_id,course_id,external_id,title,kind,effort_minutes,due_at,original_due_at,parent_id,milestone,meta,next_step,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ctx.owner, courseId, o.externalId, o.title, o.kind ?? "assignment", o.effortMinutes ?? 60, o.dueAt ?? null, o.dueAt ?? null,
    o.parentId ?? null, o.milestone ?? null, JSON.stringify(o.meta ?? {}), o.nextStep ?? null, ctx.now().toISOString());
  if (Number(res.changes) > 0 && o.dueAt) {
    run(ctx.db, "INSERT INTO task_due_history(id,task_id,due_at,revision_id,recorded_at,kind,note) VALUES(?,?,?,?,?,?,?)",
      uid("dh"), id, o.dueAt, null, ctx.now().toISOString(), "established", "Assignment record");
    addTaskEvent(ctx, id, "created", `Task created, due ${fmtDateTime(o.dueAt)}`);
  }
  return id;
}

export function recordSourceStatus(ctx: Ctx, provider: string, label: string, ok: boolean, message?: string, state?: string): void {
  const now = ctx.now().toISOString();
  run(ctx.db,
    `INSERT INTO source_status(owner_id,provider,label,state,last_attempt_at,last_success_at,message) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(owner_id,provider) DO UPDATE SET label=excluded.label, state=excluded.state, last_attempt_at=excluded.last_attempt_at,
       last_success_at=CASE WHEN ? THEN excluded.last_attempt_at ELSE source_status.last_success_at END, message=excluded.message`,
    ctx.owner, provider, label, state ?? (ok ? "ok" : "failed"), now, ok ? now : null, message ?? null, ok ? 1 : 0);
}

const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();

export function ingestRevision(ctx: Ctx, raw: IngestInput): IngestResult {
  const input = IngestInput.parse(raw);
  return tx(ctx.db, () => {
    const courseId = upsertCourse(ctx, input.courseExternalId, input.courseCode, input.courseName);
    const sourceId = stableId("src", ctx.owner, input.provider, input.externalId);
    run(ctx.db,
      "INSERT OR IGNORE INTO sources(id,owner_id,provider,external_id,uri,title,course_id,kind,first_seen_at) VALUES(?,?,?,?,?,?,?,?,?)",
      sourceId, ctx.owner, input.provider, input.externalId, input.uri ?? null, input.title, courseId, input.kind, ctx.now().toISOString());
    recordSourceStatus(ctx, input.provider, providerLabel(input.provider), true);

    const hash = sha(input.text);
    if (get(ctx.db, "SELECT 1 x FROM source_revisions WHERE source_id=? AND hash=?", sourceId, hash)) {
      return { sourceId, revisionId: null, newRevision: false, duplicateOf: null, stale: false, changes: [], decisionIds: [] };
    }
    const contentHash = sha(normalize(input.text));
    const dup = get(ctx.db, "SELECT id FROM source_revisions WHERE content_hash=? ORDER BY observed_at LIMIT 1", contentHash);
    const revisionId = uid("rev");
    run(ctx.db,
      "INSERT INTO source_revisions(id,source_id,hash,content_hash,text,published_at,observed_at,duplicate_of) VALUES(?,?,?,?,?,?,?,?)",
      revisionId, sourceId, hash, contentHash, input.text, new Date(input.publishedAt).toISOString(), ctx.now().toISOString(), dup?.id ?? null);
    logActivity(ctx, "source_revision", revisionId, `${input.provider}: ${input.title}`);

    if (dup) {
      return { sourceId, revisionId, newRevision: true, duplicateOf: dup.id as string, stale: false, changes: [], decisionIds: [] };
    }
    if (input.kind === "reference" || input.kind === "calendar") {
      return { sourceId, revisionId, newRevision: true, duplicateOf: null, stale: false, changes: [], decisionIds: [] };
    }
    const res = applyFacts(ctx, { courseId, courseExternalId: input.courseExternalId, sourceId, revisionId, input });
    return { sourceId, revisionId, newRevision: true, duplicateOf: null, ...res };
  });
}

function providerLabel(p: string): string {
  return ({ "example-blackboard": "Blackboard (example)", "example-email": "Email (example)", "example-calendar": "Calendar (example)",
    "example-library": "Library (example)", "import": "File import", "paste": "Pasted text", "inbox-folder": "Watched folder", "ics": "Calendar file", "eml": "Email file", "json-bundle": "JSON bundle" } as Record<string, string>)[p] ?? p;
}

function applyFacts(ctx: Ctx, a: { courseId: string; courseExternalId: string; sourceId: string; revisionId: string; input: IngestInput }) {
  const { input, revisionId, courseId, sourceId } = a;
  const changes: Change[] = [];
  const decisionIds: string[] = [];
  const facts: Facts = extractFacts(input.text, input.publishedAt, "America/New_York", null);
  const published = new Date(input.publishedAt).toISOString();
  let stale = false;

  if (input.kind === "email") {
    for (const pr of findPromises(input.text)) {
      const due = pr.due ? resolveWeekday(pr.due, input.publishedAt) : null;
      const d = emitDecision(ctx, {
        dedupKey: `promise:${sourceId}:${pr.quote.slice(0, 80)}`, kind: "promise_found", title: `Promise found: ${pr.action}`,
        summary: `${input.title}: "${pr.quote}"${due ? ` Due ${due}.` : ""} Track it?`,
        evidence: { quote: pr.quote, revisionId, sourceId, sourceTitle: input.title, publishedAt: new Date(input.publishedAt).toISOString(), proposed: { who: input.title.replace(/^.*from /i, "") || "Sender", owedTo: "Yonathan", action: pr.action, dueDate: due } },
        options: [{ id: "accept", label: "Track it" }, { id: "handled", label: "Dismiss" }], expiresAt: null,
      });
      if (d.created) { decisionIds.push(d.id); changes.push({ type: "promise_found", summary: `Promise found: ${pr.action}`, decisionId: d.id }); }
    }
  }

  if (input.kind === "email") for (const m of watchDeadlines(ctx, { text: input.text, publishedAt: input.publishedAt, revisionId, sourceTitle: input.title })) { if (m.decisionId) decisionIds.push(m.decisionId); changes.push({ type: "commitment_moved", summary: `Commitment moved up: ${m.from} to ${m.to}`, decisionId: m.decisionId ?? undefined }); }
  const tasks = all(ctx.db, "SELECT * FROM tasks WHERE owner_id=? AND course_id=?", ctx.owner, courseId);
  const matched = facts.taskRefs.map((r) => tasks.find((t) => t.external_id === r.externalId)).filter(Boolean) as typeof tasks;
  const unmatchedRefs = facts.taskRefs.filter((r) => !tasks.find((t) => t.external_id === r.externalId));

  if (!matched.length) {
    if (facts.dueMention && unmatchedRefs.length) {
      const ref = unmatchedRefs[0];
      const d = emitDecision(ctx, {
        dedupKey: `new_task:${courseId}:${ref.externalId}:${facts.dueMention.iso}`, kind: "new_task",
        title: `New item found: ${ref.label}`, summary: `${input.title} mentions ${ref.label} due ${fmtDateTime(facts.dueMention.iso)}. Add it as a task?`,
        evidence: { quote: facts.dueMention.sentence, revisionId, sourceId, sourceTitle: input.title, publishedAt: published,
          proposed: { externalId: ref.externalId, title: ref.label, dueAt: facts.dueMention.iso, courseExternalId: a.courseExternalId } },
        options: [{ id: "accept", label: "Add task" }, { id: "handled", label: "Dismiss" }], expiresAt: null,
      });
      if (d.created) { decisionIds.push(d.id); changes.push({ type: "new_task", summary: `New item: ${ref.label}`, decisionId: d.id }); }
    } else if (facts.ambiguous) {
      const d = emitDecision(ctx, {
        dedupKey: `needs_read:${revisionId}`, kind: "needs_read", title: `Read this: ${input.title}`,
        summary: "This update mentions a due date Jarvis could not read with certainty. Open the source and tell Jarvis what changed.",
        evidence: { quote: input.text.slice(0, 240), revisionId, sourceId, sourceTitle: input.title, publishedAt: published },
        options: [{ id: "handled", label: "Already handled" }], expiresAt: null,
      });
      if (d.created) { decisionIds.push(d.id); changes.push({ type: "needs_read", summary: `Needs a human read: ${input.title}`, decisionId: d.id }); }
    }
    return { stale, changes, decisionIds };
  }

  for (const task of matched) {
    let decisionForTask: { id: string; created: boolean; title: string } | null = null;
    const mention: DateMention | null = facts.dueMention;

    if (mention) {
      const newDue = mention.timeAssumed && task.due_at ? keepTime(task.due_at, mention) : mention.iso;
      if (!task.due_at) {
        run(ctx.db, "UPDATE tasks SET due_at=?, original_due_at=? WHERE id=?", newDue, newDue, task.id);
        run(ctx.db, "INSERT INTO task_due_history(id,task_id,due_at,revision_id,recorded_at,kind,note) VALUES(?,?,?,?,?,?,?)",
          uid("dh"), task.id, newDue, revisionId, ctx.now().toISOString(), "established", input.title);
        addTaskEvent(ctx, task.id, "due_established", `Due date ${fmtDateTime(newDue)} from ${input.title}`, { revisionId });
        changes.push({ type: "due_established", taskId: task.id, summary: `${task.title} due ${fmtDateTime(newDue)}` });
      } else if (new Date(newDue).getTime() === new Date(task.due_at).getTime()) {
        const h = get(ctx.db, "SELECT id FROM task_due_history WHERE task_id=? AND revision_id IS NULL AND due_at=?", task.id, newDue);
        if (h) run(ctx.db, "UPDATE task_due_history SET revision_id=? WHERE id=?", revisionId, h.id);
      } else {
        const basis = get(ctx.db,
          `SELECT h.id, r.published_at pub FROM task_due_history h LEFT JOIN source_revisions r ON r.id=h.revision_id
           WHERE h.task_id=? ORDER BY h.recorded_at DESC, h.rowid DESC LIMIT 1`, task.id);
        const basisPub = (basis?.pub as string | null) ?? null;
        if (basisPub && published <= basisPub) {
          stale = true;
          run(ctx.db, "UPDATE source_revisions SET stale=1 WHERE id=?", revisionId);
          addTaskEvent(ctx, task.id, "stale_source", `Older source ignored: ${input.title} says ${fmtDateTime(newDue)}`, { revisionId });
          changes.push({ type: "stale", taskId: task.id, summary: `${input.title} is older than the current due date source. Kept for history.` });
        } else if (facts.changeLanguage) {
          decisionForTask = moveDue(ctx, task, newDue, mention, revisionId, sourceId, input, facts);
          changes.push({ type: "due_moved", taskId: task.id, summary: decisionForTask.title, decisionId: decisionForTask.id });
          if (decisionForTask.created) decisionIds.push(decisionForTask.id);
        } else {
          const d = conflictDecision(ctx, task, newDue, mention, revisionId, sourceId, input, basis?.id as string | undefined);
          changes.push({ type: "conflict", taskId: task.id, summary: `Two sources disagree about ${task.title}`, decisionId: d.id });
          if (d.created) decisionIds.push(d.id);
        }
      }
    }

    // Requirements and waivers.
    const addedReqs: string[] = [];
    for (const r of facts.requirements) {
      const ins = run(ctx.db,
        "INSERT OR IGNORE INTO requirements(id,task_id,revision_id,kind,text,quote,mandatory,detail,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        uid("req"), task.id, revisionId, r.kind, r.text, r.quote, r.mandatory ? 1 : 0, JSON.stringify(withBibliography(ctx, courseId, r.detail)), ctx.now().toISOString());
      if (Number(ins.changes) > 0) {
        addedReqs.push(r.text);
        addTaskEvent(ctx, task.id, "requirement_added", `${r.text} (${input.title})`, { revisionId, quote: r.quote });
      }
    }
    for (const w of facts.waivers) {
      const upd = run(ctx.db,
        "UPDATE requirements SET status='waived', waived_by=? WHERE task_id=? AND kind=? AND status='active' AND revision_id IN (SELECT id FROM source_revisions WHERE published_at<=?)",
        revisionId, task.id, w.kind, published);
      if (Number(upd.changes) > 0) {
        addTaskEvent(ctx, task.id, "requirement_waived", `Print requirement waived: "${w.quote}"`, { revisionId, quote: w.quote });
        const d = emitDecision(ctx, {
          dedupKey: `waive:${task.id}:${revisionId}`, taskId: task.id as string, kind: "requirement_waived",
          title: `${task.title}: print requirement waived`, summary: w.quote,
          evidence: { quote: w.quote, revisionId, sourceId, sourceTitle: input.title, publishedAt: published },
          options: [{ id: "handled", label: "Got it" }], expiresAt: null,
        });
        changes.push({ type: "requirement_waived", taskId: task.id, summary: `Print requirement waived for ${task.title}`, decisionId: d.id });
        if (d.created) decisionIds.push(d.id);
      }
    }
    if (addedReqs.length) {
      if (decisionForTask) {
        // Requirements ride on the deadline decision. One decision per source event.
        const cur = get(ctx.db, "SELECT evidence FROM decisions WHERE id=?", decisionForTask.id)!;
        const ev = JSON.parse(cur.evidence as string);
        ev.requirements = facts.requirements.map((r) => ({ kind: r.kind, text: r.text, quote: r.quote, mandatory: r.mandatory, detail: r.detail }));
        run(ctx.db, "UPDATE decisions SET evidence=? WHERE id=?", JSON.stringify(ev), decisionForTask.id);
      } else {
        const d = emitDecision(ctx, {
          dedupKey: `req:${task.id}:${revisionId}`, taskId: task.id as string, kind: "requirement_added",
          title: `${task.title}: new requirement`, summary: addedReqs.join(". "),
          evidence: { quote: facts.requirements[0].quote, revisionId, sourceId, sourceTitle: input.title, publishedAt: published },
          options: [{ id: "handled", label: "Got it" }], expiresAt: task.due_at as string | null,
        });
        changes.push({ type: "requirement_added", taskId: task.id, summary: addedReqs[0], decisionId: d.id });
        if (d.created) decisionIds.push(d.id);
      }
    }
  }
  return { stale, changes, decisionIds };
}

function withBibliography(ctx: Ctx, courseId: string, detail: { articles?: number[] }) {
  if (!detail.articles?.length) return detail;
  const refs = all(ctx.db,
    `SELECT s.id, s.title, r.id rev FROM sources s JOIN source_revisions r ON r.source_id=s.id WHERE s.course_id=? AND s.kind='reference'`, courseId);
  const hits = refs.filter((s) => {
    const t = get(ctx.db, "SELECT text FROM source_revisions WHERE id=?", s.rev)!.text as string;
    return detail.articles!.every((n) => new RegExp(`\\b${n}\\b`).test(t));
  });
  return hits.length ? { ...detail, bibliography: hits.map((h) => ({ sourceId: h.id, title: h.title })) } : detail;
}

type Row2 = Record<string, any>;

function keepTime(existingIso: string, m: DateMention): string {
  // Date mention with no time: keep the task's existing local time of day.
  const hm = localHM(existingIso).split(":").map(Number);
  const [y, mo, d] = m.localDate.split("-").map(Number);
  return zoned(y, mo, d, hm[0], hm[1]);
}
const zoned = (y: number, mo: number, d: number, h: number, mi: number) => zonedToUtc(y, mo, d, h, mi).toISOString();

function moveDue(ctx: Ctx, task: Row2, newDue: string, mention: DateMention, revisionId: string, sourceId: string, input: IngestInput, facts: Facts) {
  const oldDue = task.due_at as string;
  const days = diffDays(localDate(oldDue), localDate(newDue));
  const label = days < 0 ? `Moved up ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}` : days > 0 ? `Pushed back ${days} day${days === 1 ? "" : "s"}` : "Time changed";
  run(ctx.db, "UPDATE tasks SET due_at=? WHERE id=?", newDue, task.id);
  run(ctx.db, "INSERT INTO task_due_history(id,task_id,due_at,revision_id,recorded_at,kind,note) VALUES(?,?,?,?,?,?,?)",
    uid("dh"), task.id, newDue, revisionId, ctx.now().toISOString(), "moved", label);
  addTaskEvent(ctx, task.id, "due_moved", `${label}: ${fmtDateTime(oldDue)} to ${fmtDateTime(newDue)}`, { revisionId, from: oldDue, to: newDue });
  const now = ctx.now();
  const plan = planWork(ctx, { effort: task.effort_minutes as number, from: now, due: new Date(newDue), excludeTaskId: task.id as string });
  const expires = plan.shortfall > 0 ? now.toISOString() : plan.latestSafeStart;
  const title = `${task.title}: ${label}`;
  const d = emitDecision(ctx, {
    dedupKey: `due:${task.id}:${newDue}`, taskId: task.id as string, kind: "deadline_moved", title,
    summary: `Now due ${fmtDateTime(newDue)}. Was ${fmtDateTime(oldDue)}.`,
    evidence: {
      quote: mention.sentence, revisionId, sourceId, sourceTitle: input.title, publishedAt: new Date(input.publishedAt).toISOString(),
      oldDue, newDue, daysMoved: days, label,
      requirements: facts.requirements.map((r) => ({ kind: r.kind, text: r.text, quote: r.quote, mandatory: r.mandatory, detail: r.detail })),
    },
    options: [{ id: "reserve", label: "Reserve" }, { id: "defer", label: "Defer" }, { id: "handled", label: "Already handled" }],
    expiresAt: expires,
    supersedeKind: "deadline_moved",
  });
  return { ...d, title };
}

function conflictDecision(ctx: Ctx, task: Row2, otherDue: string, mention: DateMention, revisionId: string, sourceId: string, input: IngestInput, basisHistoryId?: string) {
  const cur = get(ctx.db,
    `SELECT h.due_at, h.revision_id, r.text, r.published_at, s.title FROM task_due_history h
     LEFT JOIN source_revisions r ON r.id=h.revision_id LEFT JOIN sources s ON s.id=r.source_id
     WHERE h.task_id=? ORDER BY h.recorded_at DESC, h.rowid DESC LIMIT 1`, task.id);
  const key = [task.due_at as string, otherDue].sort().join("|");
  addTaskEvent(ctx, task.id, "conflict", `Two sources disagree: ${fmtDateTime(task.due_at)} vs ${fmtDateTime(otherDue)}`, { revisionId });
  return emitDecision(ctx, {
    dedupKey: `conflict:${task.id}:${key}`, taskId: task.id as string, kind: "date_conflict",
    title: `${task.title}: two sources disagree`,
    summary: `One record says ${fmtDateTime(task.due_at)}. ${input.title} says ${fmtDateTime(otherDue)}. Neither says it replaces the other. Pick one.`,
    evidence: {
      a: { due: task.due_at, revisionId: cur?.revision_id ?? null, sourceTitle: cur?.title ?? "Assignment record", publishedAt: cur?.published_at ?? null, quote: cur ? String(cur.text).slice(0, 200) : null },
      b: { due: otherDue, revisionId, sourceTitle: input.title, publishedAt: new Date(input.publishedAt).toISOString(), quote: mention.sentence },
    },
    options: [{ id: "choose_a", label: "Keep current" }, { id: "choose_b", label: "Use new date" }, { id: "handled", label: "Already handled" }],
    expiresAt: null,
  });
}

export function recentChanges(ctx: Ctx, limit = 8) {
  const since = new Date(ctx.now().getTime() - 7 * 86400000).toISOString();
  return all(ctx.db,
    `SELECT e.id, e.task_id, e.at, e.kind, e.summary, e.ref, t.title task_title FROM task_events e JOIN tasks t ON t.id=e.task_id
     WHERE e.kind IN ('due_moved','requirement_added','requirement_waived','conflict','stale_source','due_established') AND e.at>=? AND t.owner_id=?
     ORDER BY e.at DESC, e.rowid DESC LIMIT ?`, since, ctx.owner, limit);
}

export { getSetting };
