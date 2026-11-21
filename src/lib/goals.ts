// Goals: actual progress, target-to-date and deadline side by side. Observations are separate from commitments.
import { z } from "zod";
import { Ctx, all, get, run, uid, stableId } from "./db";
import { diffDays, localDate } from "./time";
import { HttpError } from "./decisions";

export const GoalInput = z.object({
  name: z.string().min(1).max(120), unit: z.string().max(40).default("items"), kind: z.enum(["count", "milestone", "outcome"]).default("count"),
  completed: z.number().min(0).default(0), targetTotal: z.number().positive(), startDate: z.string(), deadline: z.string(),
  milestones: z.array(z.object({ on: z.string(), target: z.number(), label: z.string().optional() })).default([]),
});

export function upsertGoal(ctx: Ctx, raw: z.input<typeof GoalInput>): string {
  const g = GoalInput.parse(raw);
  const id = stableId("goal", ctx.owner, g.name);
  run(ctx.db, `INSERT OR IGNORE INTO goals(id,owner_id,name,unit,kind,completed,target_total,start_date,deadline,milestones,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    id, ctx.owner, g.name, g.unit, g.kind, g.completed, g.targetTotal, g.startDate, g.deadline, JSON.stringify(g.milestones), ctx.now().toISOString());
  return id;
}

export interface GoalView {
  id: string; name: string; unit: string; kind: string; completed: number; targetTotal: number; plannedByToday: number;
  paceModel: "milestones" | "linear"; paceLabel: string; weeksLeft: number; daysLeft: number; status: "ahead" | "on_pace" | "behind" | "done";
  line: string; observations: { at: string; value: number; note: string | null }[]; deadline: string;
}

export function plannedBy(g: { start_date: string; deadline: string; target_total: number; milestones: string }, today: string): { value: number; model: "milestones" | "linear" } {
  const ms = (JSON.parse(g.milestones) as { on: string; target: number }[]).sort((a, b) => a.on.localeCompare(b.on));
  if (ms.length) {
    const pts = [{ on: g.start_date, target: 0 }, ...ms];
    if (today <= pts[0].on) return { value: 0, model: "milestones" };
    for (let i = 1; i < pts.length; i++) {
      if (today <= pts[i].on) {
        const span = diffDays(pts[i - 1].on, pts[i].on) || 1;
        return { value: Math.round((pts[i - 1].target + ((pts[i].target - pts[i - 1].target) * diffDays(pts[i - 1].on, today)) / span) * 10) / 10, model: "milestones" };
      }
    }
    return { value: pts[pts.length - 1].target, model: "milestones" };
  }
  const total = diffDays(g.start_date, g.deadline) || 1;
  const el = Math.min(Math.max(diffDays(g.start_date, today), 0), total);
  return { value: Math.round((g.target_total * el / total) * 10) / 10, model: "linear" };
}

export function listGoals(ctx: Ctx): GoalView[] {
  const today = localDate(ctx.now());
  return all(ctx.db, "SELECT * FROM goals WHERE owner_id=? AND status='active' ORDER BY deadline", ctx.owner).map((g) => {
    const p = plannedBy(g as any, today);
    const daysLeft = Math.max(0, diffDays(today, g.deadline as string));
    const weeksLeft = Math.ceil(daysLeft / 7);
    const done = (g.completed as number) >= (g.target_total as number);
    const status = done ? "done" : (g.completed as number) > p.value + 0.5 ? "ahead" : (g.completed as number) >= p.value - 0.5 ? "on_pace" : "behind";
    const pl = Number.isInteger(p.value) ? p.value : Math.round(p.value);
    return {
      id: g.id as string, name: g.name as string, unit: g.unit as string, kind: g.kind as string, completed: g.completed as number, targetTotal: g.target_total as number,
      plannedByToday: pl, paceModel: p.model, paceLabel: p.model === "milestones" ? "Pace from your milestones" : "Linear estimate. Add milestones for a real pace.",
      weeksLeft, daysLeft, status, deadline: g.deadline as string,
      line: `${g.completed}/${g.target_total} ${g.unit} · ${pl} planned by today · ${weeksLeft} week${weeksLeft === 1 ? "" : "s"} left`,
      observations: all(ctx.db, "SELECT at,value,note FROM goal_observations WHERE goal_id=? ORDER BY at", g.id) as any,
    };
  });
}

export function observeGoal(ctx: Ctx, id: string, value: number, note?: string) {
  const g = get(ctx.db, "SELECT * FROM goals WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!g) throw new HttpError(404, "Goal not found");
  if (!(value >= 0)) throw new HttpError(422, "Value must be zero or more");
  run(ctx.db, "INSERT INTO goal_observations(id,goal_id,at,value,note) VALUES(?,?,?,?,?)", uid("obs"), id, ctx.now().toISOString(), value, note ?? null);
  run(ctx.db, "UPDATE goals SET completed=? WHERE id=?", value, id);
  return { ok: true };
}
