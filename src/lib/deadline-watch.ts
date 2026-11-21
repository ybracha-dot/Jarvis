// An email that brings a deadline forward for a commitment you already have: update that commitment once, raise one decision.
// Incoming mail never causes anything to be sent. It can only change a date you can see and undo, and ask you.
import { Ctx, all, get, run } from "./db";
import { addEvent } from "./commitments";
import { emitDecision } from "./decisions";
import { addTaskEvent } from "./ingest";
import { findDates, resolveWeekday } from "./extract";
import { fmtDateTime, parseLocal, localDate, DEFAULT_TZ } from "./time";

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "please", "send", "have", "will", "owe", "team", "check"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 -]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));

export function dueFromText(text: string, publishedAt: string): string | null {
  const wd = /\b(?:by|before|due|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(text);
  if (wd) return resolveWeekday(wd[1], publishedAt);
  return findDates(text, publishedAt)[0]?.localDate ?? null;
}

export function watchDeadlines(ctx: Ctx, o: { text: string; publishedAt: string; revisionId: string; sourceTitle: string }) {
  const out: { commitmentId: string; from: string; to: string; decisionId: string | null }[] = [];
  const newDue = dueFromText(o.text, o.publishedAt); if (!newDue) return out;
  const tw = words(o.text);
  for (const c of all(ctx.db, "SELECT * FROM commitments WHERE owner_id=? AND status!='resolved' AND due_date IS NOT NULL", ctx.owner)) {
    const overlap = [...words(`${c.action} ${c.who} ${c.owed_to}`)].filter((w) => tw.has(w));
    if (overlap.length < 2) continue;                                   // needs real overlap, not one shared word
    if (!(newDue < (c.due_date as string))) continue;                  // only a deadline brought forward
    const key = `due:${c.id}:${newDue}`;
    if (get(ctx.db, "SELECT 1 x FROM commitment_events WHERE idempotency_key=?", key)) continue;   // already applied once
    addEvent(ctx, c.id as string, "due_moved", `Email "${o.sourceTitle}" brought this forward: ${c.due_date} to ${newDue}.`, key);
    run(ctx.db, "UPDATE commitments SET due_date=?, next_check_at=? WHERE id=?", newDue, `${newDue}T12:00:00.000Z`, c.id);
    const cap = get(ctx.db, "SELECT * FROM captures WHERE commitment_id=? AND undone_at IS NULL", c.id);
    const task = cap?.task_id ? get(ctx.db, "SELECT * FROM tasks WHERE id=?", cap.task_id) : null;
    let decisionId: string | null = null;
    if (task) {
      const due = parseLocal(newDue, "17:00", DEFAULT_TZ).toISOString();
      run(ctx.db, "UPDATE tasks SET due_at=? WHERE id=?", due, task.id);
      run(ctx.db, "INSERT INTO task_due_history(id,task_id,due_at,revision_id,recorded_at,kind,note) VALUES(?,?,?,?,?,?,?)", `dh_${c.id}_${newDue}`, task.id, due, o.revisionId, ctx.now().toISOString(), "moved", `Email: ${o.sourceTitle}`);
      addTaskEvent(ctx, task.id as string, "due_moved", `Due moved to ${fmtDateTime(due)} by an email`, { revisionId: o.revisionId });
      decisionId = emitDecision(ctx, { dedupKey: key, taskId: task.id as string, kind: "commitment_plan", title: `${c.owed_to}: ${c.action} now by ${newDue}`, summary: `An email moved this up from ${c.due_date} to ${newDue}. Reserve time for it?`,
        evidence: { quote: o.text.slice(0, 240), sourceTitle: o.sourceTitle, publishedAt: o.publishedAt, revisionId: o.revisionId, commitmentId: c.id, requirements: [] },
        options: [{ id: "reserve", label: "Reserve" }, { id: "defer", label: "Defer" }, { id: "handled", label: "Already handled" }], expiresAt: due, supersedeKind: "commitment_plan" }).id;
    } else {
      decisionId = emitDecision(ctx, { dedupKey: key, kind: "commitment_moved", title: `${c.owed_to}: ${c.action} now by ${newDue}`, summary: `An email moved this up from ${c.due_date} to ${newDue}.`,
        evidence: { quote: o.text.slice(0, 240), sourceTitle: o.sourceTitle, publishedAt: o.publishedAt, revisionId: o.revisionId }, options: [{ id: "handled", label: "Got it" }], expiresAt: null }).id;
    }
    out.push({ commitmentId: c.id as string, from: c.due_date as string, to: newDue, decisionId });
  }
  return out;
}
export { localDate };
