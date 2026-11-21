// Spaced practice for exams. Deterministic. Milestones are demonstrable and update after each practice result.
import { Ctx, all, get, run, tx, uid } from "./db";
import { HttpError } from "./decisions";
import { createTask, addTaskEvent } from "./ingest";
import { freeWindows } from "./planner";
import { addDays, diffDays, localDate, parseLocal, fmtDateTime } from "./time";

export interface Milestone { key: string; offsetDays: number; minutes: number; title: string; milestone: string; area: string | null }

export function milestoneTemplate(weak: string[], daysAvailable: number): Milestone[] {
  const [a, b] = [weak[0] ?? "weak area 1", weak[1] ?? weak[0] ?? "weak area 2"];
  const all: Milestone[] = [
    { key: "diag", offsetDays: 17, minutes: 45, title: "Diagnostic set", milestone: "Solve 5 mixed problems unaided and record the score per topic", area: null },
    { key: "t1", offsetDays: 15, minutes: 45, title: `Targeted: ${a}`, milestone: `Solve 5 ${a} unaided, at least 4 correct`, area: a },
    { key: "t2", offsetDays: 12, minutes: 45, title: `Targeted: ${b}`, milestone: `Solve 5 ${b} unaided, at least 4 correct`, area: b },
    { key: "r1", offsetDays: 9, minutes: 20, title: "Retrieval check", milestone: "Without notes, write the method for each weak area in 3 minutes each", area: null },
    { key: "t3", offsetDays: 7, minutes: 45, title: `Targeted: ${a} and ${b}`, milestone: `Solve 3 ${a} and 3 ${b} unaided, at least 5 of 6 correct`, area: a },
    { key: "mix", offsetDays: 4, minutes: 75, title: "Timed mixed set", milestone: "Complete 12 mixed problems in 60 minutes, at least 10 correct", area: null },
    { key: "r2", offsetDays: 2, minutes: 20, title: "Retrieval check", milestone: "Recall each formula and cross diagram from memory, then verify", area: null },
    { key: "fin", offsetDays: 1, minutes: 45, title: "Last review", milestone: "Re-do every problem you missed, with no new material", area: null },
  ];
  return all.filter((m) => m.offsetDays <= daysAvailable);
}

function findSlot(ctx: Ctx, target: string, minutes: number, notBefore: Date, lastDay: string): { start: string; end: string } | null {
  for (const delta of [0, -1, 1, -2, 2]) {
    const day = addDays(target, delta);
    if (day > lastDay) continue;
    const from = new Date(Math.max(parseLocal(day, "00:00").getTime(), notBefore.getTime()));
    const to = parseLocal(addDays(day, 1), "00:00");
    const w = freeWindows(ctx, from, to).find((x) => x.end - x.start >= minutes * 60000);
    if (w) return { start: new Date(w.start).toISOString(), end: new Date(w.start + minutes * 60000).toISOString() };
  }
  return null;
}

export function createStudyPlan(ctx: Ctx, examTaskId: string, weakAreas: string[]) {
  return tx(ctx.db, () => {
    const exam = get(ctx.db, "SELECT t.*, c.external_id course_ext FROM tasks t JOIN courses c ON c.id=t.course_id WHERE t.id=? AND t.owner_id=?", examTaskId, ctx.owner);
    if (!exam || !exam.due_at) throw new HttpError(404, "Exam task not found");
    const examDay = localDate(exam.due_at as string);
    const days = diffDays(localDate(ctx.now()), examDay);
    const tmpl = milestoneTemplate(weakAreas, days);
    const meta = { ...JSON.parse(exam.meta as string), weakAreas, mastery: Object.fromEntries(weakAreas.map((a) => [a, null])) };
    run(ctx.db, "UPDATE tasks SET meta=? WHERE id=?", JSON.stringify(meta), examTaskId);
    const created: any[] = [];
    for (const m of tmpl) {
      const day = addDays(examDay, -m.offsetDays);
      const due = parseLocal(addDays(day, 1), "00:00").toISOString();
      const id = createTask(ctx, { courseExternalId: exam.course_ext as string, externalId: `${exam.external_id}-${m.key}`, title: m.title, kind: "practice", effortMinutes: m.minutes, dueAt: due, parentId: examTaskId, milestone: m.milestone, meta: { area: m.area, offsetDays: m.offsetDays } });
      const slot = findSlot(ctx, day, m.minutes, ctx.now(), examDay);
      if (slot) {
        run(ctx.db, `INSERT OR IGNORE INTO blocks(id,owner_id,start_at,end_at,tz,kind,title,task_id,source,idempotency_key,sync,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          uid("blk"), ctx.owner, slot.start, slot.end, "America/New_York", "proposed", `${m.title}`, id, "jarvis", `study:${id}`, "local-only", ctx.now().toISOString());
      }
      created.push({ id, ...m, slot });
    }
    addTaskEvent(ctx, examTaskId, "study_plan", `Study plan: ${created.length} sessions over ${days} days, ${created.filter((c) => c.slot).length} scheduled as local proposed blocks`, { weakAreas });
    return { daysAvailable: days, milestones: created };
  });
}

export function applyPractice(ctx: Ctx, examTaskId: string, area: string, correct: number, total: number, note?: string) {
  if (!(total > 0) || correct < 0 || correct > total) throw new HttpError(422, "Score must be between 0 and total");
  return tx(ctx.db, () => {
    const exam = get(ctx.db, "SELECT t.*, c.external_id course_ext FROM tasks t JOIN courses c ON c.id=t.course_id WHERE t.id=? AND t.owner_id=?", examTaskId, ctx.owner);
    if (!exam) throw new HttpError(404, "Exam task not found");
    run(ctx.db, "INSERT INTO practice_results(id,task_id,area,correct,total,at,note) VALUES(?,?,?,?,?,?,?)", uid("pr"), examTaskId, area, correct, total, ctx.now().toISOString(), note ?? null);
    const meta = JSON.parse(exam.meta as string);
    const mastery = correct / total;
    meta.mastery = { ...(meta.mastery ?? {}), [area]: mastery };
    run(ctx.db, "UPDATE tasks SET meta=? WHERE id=?", JSON.stringify(meta), examTaskId);
    const next = all(ctx.db, "SELECT * FROM tasks WHERE parent_id=? AND status!='done' AND due_at>? ORDER BY due_at", examTaskId, ctx.now().toISOString())
      .find((t) => JSON.parse(t.meta as string).area === area || /Targeted|Timed/.test(t.title as string));
    let effect: string;
    if (mastery < 0.8) {
      const extraId = createTask(ctx, {
        courseExternalId: exam.course_ext as string, externalId: `${exam.external_id}-retry-${area.replace(/\W+/g, "-")}-${correct}of${total}-${Date.now() % 100000}`,
        title: `Retry: ${area}`, kind: "practice", effortMinutes: 30, dueAt: parseLocal(addDays(localDate(ctx.now()), 3), "00:00").toISOString(), parentId: examTaskId,
        milestone: `Solve 5 more ${area} problems unaided. Last result: ${correct}/${total}. Target: 4 of 5.`, meta: { area, retry: true },
      });
      const slot = findSlot(ctx, addDays(localDate(ctx.now()), 2), 30, ctx.now(), localDate(exam.due_at as string));
      if (slot) run(ctx.db, `INSERT OR IGNORE INTO blocks(id,owner_id,start_at,end_at,tz,kind,title,task_id,source,idempotency_key,sync,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        uid("blk"), ctx.owner, slot.start, slot.end, "America/New_York", "proposed", `Retry: ${area}`, extraId, "jarvis", `study:${extraId}`, "local-only", ctx.now().toISOString());
      effect = `${area} is at ${correct}/${total}. Added a 30 min retry${slot ? ` on ${fmtDateTime(slot.start)}` : ""}${next ? ` and kept "${next.title}" unchanged` : ""}.`;
    } else {
      if (next) run(ctx.db, "UPDATE tasks SET milestone=?, effort_minutes=MAX(20, effort_minutes-15) WHERE id=?", `Maintenance: solve 3 ${area} problems unaided. Last result: ${correct}/${total}.`, next.id);
      effect = `${area} is at ${correct}/${total}. ${next ? `"${next.title}" is now a shorter maintenance session.` : "No later session to shorten."}`;
    }
    addTaskEvent(ctx, examTaskId, "practice_result", `${area}: ${correct}/${total}. ${effect}`, { area, correct, total });
    return { mastery, effect };
  });
}
