// Outcomes: one list answering "where did the output go?" Each row ties a goal to its result and the receipt that proves it.
// It is derived from saved records only (jobs, project events, completed tasks). Nothing here is generated or inferred.
import { Ctx, all, get } from "./db";

export interface Outcome { id: string; at: string; source: "agent" | "claude" | "you" | "task"; status: "verified" | "waiting" | "done" | "failed" | "cancelled"; goal: string; result: string; receipt: string | null; href: string }

const PHRASE: Record<string, string> = { decide: "decided", option: "option for", fact: "noted", action: "to do:", question: "open question:", retract: "withdrew" };
export function outcomes(ctx: Ctx, limit = 20): Outcome[] {
  const out: Outcome[] = [];
  for (const j of all(ctx.db, "SELECT * FROM jobs WHERE owner_id=? AND parent_id IS NULL AND status IN ('done','failed','cancelled','blocked') ORDER BY COALESCE(finished_at, created_at) DESC LIMIT ?", ctx.owner, limit)) {
    const res = j.result ? JSON.parse(j.result as string) : {}; const at = new Date((j.finished_at ?? j.created_at) as number).toISOString();
    const rev = get(ctx.db, "SELECT result FROM jobs WHERE parent_id=? AND kind='capture_reviewer' AND status='done' ORDER BY rowid DESC LIMIT 1", j.id);
    const checks: { ok: boolean }[] = rev ? JSON.parse(rev.result as string).checks ?? [] : [];
    const dec = res.decisionId ? get(ctx.db, "SELECT state, resolution, title FROM decisions WHERE id=? AND owner_id=?", res.decisionId, ctx.owner) : null;
    const goal = String(j.title).replace(/^Handle: /, "");
    if (j.status === "failed") out.push({ id: j.id as string, at, source: "agent", status: "failed", goal, result: `Stopped: ${String(j.error ?? "an error")}`.slice(0, 160), receipt: null, href: "/office" });
    else if (j.status === "cancelled") out.push({ id: j.id as string, at, source: "agent", status: "cancelled", goal, result: "You cancelled it. Nothing further was done.", receipt: null, href: "/office" });
    else if (j.status === "blocked") out.push({ id: j.id as string, at, source: "agent", status: "waiting", goal, result: "Waiting for your answer.", receipt: null, href: "/office" });
    else if (dec) {
      const pending = dec.state === "pending";
      out.push({ id: j.id as string, at, source: "agent", status: pending ? "waiting" : "verified", goal, result: pending ? "A plan is ready and one decision is waiting for you." : `You answered: ${dec.state}${dec.resolution ? ` (${String(dec.resolution).slice(0, 60)})` : ""}.`,
        receipt: checks.length ? `${checks.filter((c) => c.ok).length} of ${checks.length} checks passed by the Reviewer` : null, href: pending ? `/?decision=${res.decisionId}` : "/tasks" });
    } else if (res.docId) out.push({ id: j.id as string, at, source: "agent", status: "verified", goal, result: `Saved study guide version ${res.version} with ${res.questionCount} questions.`, receipt: res.keyCheck ? `Answer key checked: ${res.keyCheck.supported} of ${res.keyCheck.checked} supported` : null, href: `/guides/${res.docId}` });
    else out.push({ id: j.id as string, at, source: "agent", status: "done", goal, result: "Finished.", receipt: null, href: "/office" });
  }
  for (const e of all(ctx.db, "SELECT e.event_id, e.origin, e.at, e.resulting_revision rev, e.receipt, p.name, p.id pid FROM project_events e JOIN projects p ON p.id=e.project_id WHERE e.owner_id=? AND e.undone_at IS NULL ORDER BY e.at DESC LIMIT ?", ctx.owner, limit)) {
    const r = JSON.parse(e.receipt as string); const n = (r.changes ?? []).filter((c: any) => c.status !== "retracted").length;
    out.push({ id: e.event_id as string, at: e.at as string, source: e.origin === "claude" ? "claude" : "you", status: "done", goal: `${e.name}`, result: `${e.origin === "claude" ? "" : "Edited in Jarvis: "}${r.changes.map((c: any) => `${PHRASE[c.op] ?? c.op} ${String(c.key).replace(/-/g, " ")}`).join(", ")}.`.replace(/^./, (c: string) => c.toUpperCase()), receipt: `Revision ${e.rev}, ${n} change${n === 1 ? "" : "s"}`, href: `/projects/${e.pid}` });
  }
  for (const t of all(ctx.db, "SELECT id,title,completed_at FROM tasks WHERE owner_id=? AND status='done' AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT ?", ctx.owner, limit))
    out.push({ id: t.id as string, at: t.completed_at as string, source: "task", status: "done", goal: String(t.title), result: "Marked done.", receipt: null, href: `/completed` });
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
