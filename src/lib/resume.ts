import { z } from "zod";
import { Ctx, all, get, run, uid } from "./db";
import { HttpError } from "./decisions";
import { addTaskEvent } from "./ingest";

export const CheckpointInput = z.object({
  taskId: z.string().optional(), doc: z.string().min(1).max(200), section: z.string().min(1).max(200),
  question: z.string().max(400).optional(), nextStep: z.string().min(1).max(300), estMinutes: z.number().int().min(5).max(240).default(20),
});
export function saveCheckpoint(ctx: Ctx, raw: z.input<typeof CheckpointInput>) {
  const i = CheckpointInput.parse(raw);
  if (i.taskId && !get(ctx.db, "SELECT 1 x FROM tasks WHERE id=? AND owner_id=?", i.taskId, ctx.owner)) throw new HttpError(404, "Task not found");
  const id = uid("ckp");
  run(ctx.db, "INSERT INTO checkpoints(id,task_id,doc,section,question,next_step,est_minutes,at) VALUES(?,?,?,?,?,?,?,?)", id, i.taskId ?? null, i.doc, i.section, i.question ?? null, i.nextStep, i.estMinutes, ctx.now().toISOString());
  if (i.taskId) {
    run(ctx.db, "UPDATE tasks SET next_step=? WHERE id=?", i.nextStep, i.taskId);
    addTaskEvent(ctx, i.taskId, "checkpoint", `Paused at ${i.doc}, ${i.section}. Next: ${i.nextStep}`, { checkpointId: id });
  }
  return { id };
}

export function latestCheckpoint(ctx: Ctx) {
  return get(ctx.db, `SELECT k.*, t.title task_title FROM checkpoints k LEFT JOIN tasks t ON t.id=k.task_id ORDER BY k.at DESC, k.rowid DESC LIMIT 1`) ?? null;
}

/** "I have N minutes": one finishable step, with the exact document and section when a checkpoint exists. */
export function forMinutes(ctx: Ctx, minutes: number) {
  const cps = all(ctx.db, `SELECT k.*, t.title task_title, t.due_at, t.status FROM checkpoints k LEFT JOIN tasks t ON t.id=k.task_id
    WHERE (t.id IS NULL OR t.status!='done') ORDER BY COALESCE(t.due_at,'9999'), k.at DESC`);
  const fit = cps.find((c) => (c.est_minutes as number) <= minutes);
  if (fit) return { kind: "checkpoint", minutes, task: fit.task_title, taskId: fit.task_id, doc: fit.doc, section: fit.section, question: fit.question, step: fit.next_step, estMinutes: fit.est_minutes };
  const t = all(ctx.db, "SELECT * FROM tasks WHERE owner_id=? AND status='open' AND next_step IS NOT NULL ORDER BY COALESCE(due_at,'9999') LIMIT 1", ctx.owner)[0];
  if (t) return { kind: "task", minutes, task: t.title, taskId: t.id, doc: null, section: null, question: null, step: t.next_step, estMinutes: Math.min(minutes, t.effort_minutes) };
  const any = all(ctx.db, "SELECT * FROM tasks WHERE owner_id=? AND status='open' ORDER BY COALESCE(due_at,'9999') LIMIT 1", ctx.owner)[0];
  if (any) return { kind: "task", minutes, task: any.title, taskId: any.id, doc: null, section: null, question: null, step: `Spend ${Math.min(minutes, 25)} minutes on the first step of ${any.title}`, estMinutes: Math.min(minutes, 25) };
  return { kind: "none", minutes, task: null, taskId: null, doc: null, section: null, question: null, step: "Nothing open. Capture something or take the time.", estMinutes: 0 };
}
