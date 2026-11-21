// Today: the next useful block, calendar, changes, source health. Deterministic.
import { Ctx, all, get, getSetting } from "./db";
import { listDecisions } from "./decisions";
import { recentChanges } from "./ingest";
import { nextFreeWindow, plannerSettings, planWork } from "./planner";
import { localDate, parseLocal, addDays, minutesBetween, fmtDateTime, localHM } from "./time";
import { listGoals } from "./goals";
import { listCommitments } from "./commitments";
import { latestCheckpoint } from "./resume";
import { unreadCount, nextBriefAfter } from "./notify";

export interface SourceHealth { provider: string; label: string; state: string; lastSuccessAt: string | null; lastAttemptAt: string | null; lastEventAt: string | null; nextCheckAt: string | null; gapReason: string | null; message: string | null; age: string; stale: boolean }

export function sourceHealth(ctx: Ctx): SourceHealth[] {
  const now = ctx.now().getTime();
  return all(ctx.db, "SELECT * FROM source_status WHERE owner_id=? ORDER BY label", ctx.owner).map((s) => {
    const ageMs = s.last_success_at ? now - new Date(s.last_success_at as string).getTime() : null;
    return {
      provider: s.provider as string, label: s.label as string, state: s.state as string, lastSuccessAt: s.last_success_at as string | null, lastAttemptAt: s.last_attempt_at as string | null, lastEventAt: (s.last_event_at as string | null) ?? null, nextCheckAt: (s.next_check_at as string | null) ?? null, gapReason: (s.gap_reason as string | null) ?? null,
      message: s.message as string | null, age: ageMs == null ? "never verified" : fmtAge(ageMs), stale: ageMs != null && ageMs > 36 * 3600000,
    };
  });
}
export function fmtAge(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function today(ctx: Ctx) {
  const now = ctx.now();
  const s = plannerSettings(ctx);
  const day = localDate(now, s.tz);
  const dayStart = parseLocal(day, "00:00", s.tz), dayEnd = parseLocal(addDays(day, 1), "00:00", s.tz);
  const timeline = all(ctx.db,
    "SELECT id,start_at,end_at,kind,title,task_id,sync FROM blocks WHERE owner_id=? AND state='active' AND end_at>? AND start_at<? ORDER BY start_at",
    ctx.owner, dayStart.toISOString(), dayEnd.toISOString());
  const nextWindow = nextFreeWindow(ctx, now);
  const reserved = all(ctx.db,
    `SELECT b.*, t.title task_title FROM blocks b JOIN tasks t ON t.id=b.task_id WHERE b.owner_id=? AND b.state='active' AND b.kind IN ('proposed','booked') AND b.end_at>? ORDER BY b.start_at LIMIT 1`,
    ctx.owner, now.toISOString())[0] ?? null;
  const open = all(ctx.db, "SELECT t.*, c.code course_code FROM tasks t LEFT JOIN courses c ON c.id=t.course_id WHERE t.owner_id=? AND t.status='open' AND t.kind!='practice' AND t.due_at IS NOT NULL ORDER BY t.due_at", ctx.owner);
  let suggested: any = null;
  for (const t of open) {
    const logged = (get(ctx.db, "SELECT COALESCE(SUM(actual_minutes),0) m FROM time_logs WHERE task_id=?", t.id)?.m as number) ?? 0;
    const remaining = Math.max(15, (t.effort_minutes as number) - logged);
    const plan = planWork(ctx, { effort: remaining, from: now, due: new Date(t.due_at as string), excludeTaskId: t.id as string });
    const urgency = plan.shortfall > 0 ? 0 : plan.latestSafeStart ? new Date(plan.latestSafeStart).getTime() : Infinity;
    if (!suggested || urgency < suggested.urgency) suggested = { urgency, task: t, plan, remaining };
  }
  const decisions = listDecisions(ctx);
  const cp = latestCheckpoint(ctx);
  const commitments = listCommitments(ctx).filter((c: any) => c.status !== "resolved");
  const quiet = getSetting<boolean>(ctx.db, "scheduler_paused", false);
  const primary = reserved && new Date(reserved.start_at as string).getTime() - now.getTime() < 6 * 3600000
    ? { kind: "start_block", label: `Start ${reserved.task_title}`, detail: `${localHM(reserved.start_at as string)} to ${localHM(reserved.end_at as string)}, ${reserved.kind} local block`, taskId: reserved.task_id }
    : decisions.length ? { kind: "review_decision", label: `Review: ${decisions[0].title}`, detail: decisions[0].summary, decisionId: decisions[0].id }
    : suggested ? { kind: "start_task", label: `Start ${suggested.task.title}`, detail: `${suggested.remaining} min left, due ${fmtDateTime(suggested.task.due_at)}`, taskId: suggested.task.id }
    : { kind: "none", label: "Nothing urgent", detail: "All on track." };
  return {
    now: now.toISOString(), mode: ctx.mode, tz: s.tz, day,
    nextBlock: nextWindow, nextBrief: nextBriefAfter(ctx, now).toISOString(),
    reserved, suggestedTask: suggested ? { id: suggested.task.id, title: suggested.task.title, course: suggested.task.course_code, due: suggested.task.due_at, remaining: suggested.remaining, latestSafeStart: suggested.plan.latestSafeStart, shortfall: suggested.plan.shortfall } : null,
    minutesAvailable: nextWindow?.minutes ?? 0, primary, timeline, changes: recentChanges(ctx), sources: sourceHealth(ctx),
    decisionsPending: decisions.length, unread: unreadCount(ctx), goals: listGoals(ctx), commitmentsOpen: commitments.length,
    checkpoint: cp, paused: quiet,
  };
}
export { minutesBetween };
