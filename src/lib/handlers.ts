// Job handlers for the Live Office. Every handler is re-entrant: steps are memoized and side effects are idempotent.
import { assistantHandlers } from "./assistant";
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
  // Observe, delegate, verify the artifact, then complete, retry once, or hand it to you. Two rounds at most.
  let verdict: any = null; let plannerResult: any = null;
  for (let round = 1; round <= 2; round++) {
    const kid = api.spawn(`planner${round}`, {
      kind: "capture_planner", role: "Capacity specialist", area: "planning", title: `Plan: ${cap.parsed.owedTo} ${cap.parsed.action}`.slice(0, 80), input: { captureId },
      evidenceIds: [captureId], tools: ["read_calendar", "read_tasks", "create_commitment"], budget: { modelCalls: 0 },
      criteria: ["Commitment exists exactly once", "Feasible work blocks checked against the calendar"], synthetic: cap.synthetic,
    });
    api.waitFor([kid]);
    const res = api.child(kid);
    if (res.status !== "done") throw new Error(`Specialist ${res.status}`);
    plannerResult = res.result;
    const rev = api.spawn(`reviewer${round}`, {
      kind: "capture_reviewer", role: "Reviewer", area: "review", title: `Check: ${cap.parsed.owedTo} ${cap.parsed.action}`.slice(0, 80), input: { captureId, final: round === 2 },
      evidenceIds: [captureId], tools: ["read_tasks", "read_calendar", "propose_decision"], budget: { modelCalls: 0 },
      criteria: ["Commitment exists exactly once", "Work item and due date match", "Plan agrees with the calendar", "One decision raised with the evidence"], synthetic: cap.synthetic,
    });
    api.waitFor([rev]);
    const rr = api.child(rev);
    if (rr.status !== "done") throw new Error(`Reviewer ${rr.status}`);
    verdict = rr.result;
    if (verdict.verdict !== "retry") break;
    await api.step(`retry${round}`, "The reviewer found a gap and sent the work back once", () => { api.event("retry", "The reviewer found a gap and sent the work back once", { problems: verdict.problems }); return true; });
  }
  await api.step("close", "Recording what was verified", () => ({ ok: true }));
  return { ...plannerResult, ...verdict };
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
  return { commitmentId, taskId: task.id, plan };
};

const capture_reviewer: Handler = async (api: JobApi) => {
  const { captureId, final } = api.input as { captureId: string; final: boolean };
  const ctx = api.ctx; const c0 = row(ctx, captureId); const p = JSON.parse(c0.parsed as string);
  type Check = { name: string; ok: boolean; detail: string };
  const checks: Check[] = [];
  await api.step("commitment", "Checking the commitment exists exactly once", () => {
    const n = (get(ctx.db, "SELECT COUNT(*) n FROM commitments WHERE owner_id=? AND who=? AND owed_to=? AND action=? AND COALESCE(due_date,'')=COALESCE(?,'')", ctx.owner, p.who, p.owedTo, p.action, p.dueDate ?? null)!.n as number);
    checks.push({ name: "Commitment saved once", ok: n === 1, detail: n === 1 ? "One matching commitment." : `${n} matching commitments.` }); return n;
  });
  const task = await api.step("task", "Checking the work item and its due date", () => {
    const cap = row(ctx, captureId); const t = cap.task_id ? get(ctx.db, "SELECT id, due_at, title FROM tasks WHERE id=? AND owner_id=?", cap.task_id, ctx.owner) : null;
    const dueOk = !!t && (!p.dueDate || String(t.due_at ?? "").length > 0);
    checks.push({ name: "Work item and due date", ok: !!t && dueOk, detail: t ? `Work item "${String(t.title).slice(0, 60)}"${t.due_at ? ` due ${fmtDateTime(String(t.due_at))}` : " has no due date"}.` : "No work item exists." });
    return t ? { id: t.id as string, due: (t.due_at as string) ?? null } : null;
  });
  const cal = await api.step("calendar", "Checking the plan against the calendar", () => {
    if (!task?.due) return { ok: !!task, shortfall: 0, latest: null as string | null, noDate: true };
    const pl = planWork(ctx, { effort: p.effortMinutes ?? 60, from: ctx.now(), due: new Date(task.due), excludeTaskId: task.id });
    checks.push({ name: "Plan fits the calendar", ok: true, detail: pl.shortfall > 0 ? `Only part of the work fits (${pl.shortfall} min short).` : `Fits. Latest safe start ${pl.latestSafeStart ? fmtDateTime(pl.latestSafeStart) : "now"}.` });
    return { ok: true, shortfall: pl.shortfall, latest: pl.latestSafeStart as string | null, noDate: false };
  });
  const problems = checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
  if (problems.length && !final) return { verdict: "retry", problems, checks };
  const decisionId = await api.step("decision", "Raising one decision for you", () => {
    const d = emitDecision(ctx, {
      dedupKey: `capture:${captureId}`, taskId: task?.id, kind: "commitment_plan", title: `${p.owedTo}: ${p.action}${p.dueText ? ` by ${p.dueText}` : ""}`.slice(0, 120),
      summary: problems.length ? `Checked and found a problem I could not fix: ${problems.join(" ")} Review before reserving.` : cal.noDate ? `You owe ${p.owedTo} ${p.action}. No due date was given. Add one or reserve time.` : cal.shortfall > 0 ? `About ${p.effortMinutes} min of work and only part of it fits before ${fmtDateTime(task!.due!)}.` : `About ${p.effortMinutes} min of work. Latest safe start ${cal.latest ? fmtDateTime(cal.latest) : "now"}. Reserve it?`,
      evidence: { quote: c0.text, sourceTitle: c0.source_label, publishedAt: c0.created_at, synthetic: !!c0.synthetic, captureId, commitmentId: c0.commitment_id, requirements: [], verification: checks },
      options: [{ id: "reserve", label: "Reserve" }, { id: "defer", label: "Defer" }, { id: "handled", label: "Already handled" }],
      expiresAt: cal.shortfall > 0 ? ctx.now().toISOString() : cal.latest, supersedeKind: "commitment_plan",
    });
    run(ctx.db, "UPDATE captures SET decision_id=? WHERE id=?", d.id, captureId);
    return d.id;
  });
  api.event("decision", "A decision is on your desk", { decisionId });
  return { verdict: problems.length ? "needs_decision" : "verified", problems, checks, decisionId };
};

export const HANDLERS: Record<string, Handler> = { supervise_capture, capture_planner, capture_reviewer, ...studyHandlers, ...assistantHandlers };
