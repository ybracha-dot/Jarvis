// Job handlers for the Live Office. Every handler is re-entrant: steps are memoized and side effects are idempotent.
import { Ctx, get, run, getSetting } from "./db";
import { Handler, JobApi } from "./jobs";
import { createCommitment } from "./commitments";
import { createTask } from "./ingest";
import { emitDecision } from "./decisions";
import { planWork } from "./planner";
import { parseLocal, fmtDateTime, DEFAULT_TZ } from "./time";
import { studyHandlers } from "./study-guide";

const row = (ctx: Ctx, id: string) => get(ctx.db, "SELECT * FROM captures WHERE id=?", id)!;

const supervise_capture: Handler = async (api: JobApi) => {
  const { captureId } = api.input as { captureId: string };
  const cap = await api.step("read", "Reading the captured message", () => { const c = row(api.ctx, captureId); return { kind: c.kind, parsed: JSON.parse(c.parsed as string), source: c.source_label, synthetic: !!c.synthetic }; });
  const kid = api.spawn("planner", {
    kind: "capture_planner", role: "Capacity specialist", area: "planning", title: `Plan: ${cap.parsed.owedTo} ${cap.parsed.action}`.slice(0, 80), input: { captureId },
    evidenceIds: [captureId], tools: ["read_calendar", "read_tasks", "propose_decision"], budget: { modelCalls: 0 },
    criteria: ["Commitment exists exactly once", "Feasible work blocks checked against the calendar", "One decision raised"], synthetic: cap.synthetic,
  });
  api.waitFor([kid]);
  const res = api.child(kid);
  if (res.status !== "done") throw new Error(`Specialist ${res.status}`);
  await api.step("close", "Checking the specialist's work", () => ({ ok: true }));
  return { delegatedTo: kid, ...res.result };
};

const capture_planner: Handler = async (api: JobApi) => {
  const { captureId } = api.input as { captureId: string };
  const ctx = api.ctx;
  const c0 = row(ctx, captureId); const p = JSON.parse(c0.parsed as string);
  const commitmentId = await api.step("commitment", "Confirming the commitment is saved once", () => {
    const id = createCommitment(ctx, { who: p.who, owedTo: p.owedTo, action: p.action, dueDate: p.dueDate, agreement: `Captured from ${c0.source_label}`, dedupe: true });
    run(ctx.db, "UPDATE captures SET commitment_id=? WHERE id=?", id, captureId);
    return id;
  });
  const task = await api.step("task", "Creating a work item for it", () => {
    const tz = getSetting(ctx.db, "tz", DEFAULT_TZ);
    const due = p.dueDate ? parseLocal(p.dueDate, "17:00", tz).toISOString() : null;
    const id = createTask(ctx, { courseExternalId: "captured", courseCode: "CAPTURED", courseName: "Captured promises", externalId: `capture-${captureId}`, title: `${p.owedTo}: ${p.action}`.slice(0, 120), dueAt: due, effortMinutes: p.effortMinutes ?? 60, kind: "promise", nextStep: "Start the first reserved block" });
    run(ctx.db, "UPDATE captures SET task_id=? WHERE id=?", id, captureId);
    return { id, due };
  });
  const plan = await api.step("capacity", "Checking free time against your calendar", () => {
    if (!task.due) return { shortfall: 0, latest: null, chunks: 0, noDate: true };
    const pl = planWork(ctx, { effort: p.effortMinutes ?? 60, from: ctx.now(), due: new Date(task.due), excludeTaskId: task.id });
    return { shortfall: pl.shortfall, latest: pl.latestSafeStart, chunks: pl.chunks.length, noDate: false };
  });
  const decisionId = await api.step("decision", "Raising one decision for you", () => {
    const d = emitDecision(ctx, {
      dedupKey: `capture:${captureId}`, taskId: task.id, kind: "commitment_plan", title: `${p.owedTo}: ${p.action}${p.dueText ? ` by ${p.dueText}` : ""}`.slice(0, 120),
      summary: plan.noDate ? `You owe ${p.owedTo} ${p.action}. No due date was given. Add one or reserve time.` : plan.shortfall > 0 ? `About ${p.effortMinutes} min of work and only part of it fits before ${fmtDateTime(task.due!)}.` : `About ${p.effortMinutes} min of work. Latest safe start ${plan.latest ? fmtDateTime(plan.latest) : "now"}. Reserve it?`,
      evidence: { quote: c0.text, sourceTitle: c0.source_label, publishedAt: c0.created_at, synthetic: !!c0.synthetic, captureId, commitmentId, requirements: [] },
      options: [{ id: "reserve", label: "Reserve" }, { id: "defer", label: "Defer" }, { id: "handled", label: "Already handled" }],
      expiresAt: plan.shortfall > 0 ? ctx.now().toISOString() : plan.latest, supersedeKind: "commitment_plan",
    });
    run(ctx.db, "UPDATE captures SET decision_id=? WHERE id=?", d.id, captureId);
    return d.id;
  });
  api.event("decision", "A decision is on your desk", { decisionId });
  return { commitmentId, taskId: task.id, decisionId };
};

export const HANDLERS: Record<string, Handler> = { supervise_capture, capture_planner, ...studyHandlers };
