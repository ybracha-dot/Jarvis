// Durable job queue behind the Live Office. A job is a persisted unit of work with a lease.
// Handlers are re-entrant: each step is memoized in job_steps, children are spawned idempotently, and a job waiting on a child is woken
// when the child finishes. So a worker that dies mid-job can be replaced and the job finishes without repeating side effects.
// Timing columns use the real wall clock (a job's elapsed time and heartbeat are real), event content never contains raw private text.
import { Ctx, all, get, run, tx, uid } from "./db";

export type JobStatus = "queued" | "running" | "waiting" | "blocked" | "done" | "failed" | "cancelled";
export const TERMINAL: JobStatus[] = ["done", "failed", "cancelled"];
export type Area = "supervisor" | "intake" | "research" | "planning" | "decisions";

export const LIMITS = { maxDepth: 2, maxChildrenPerParent: 4, maxRunning: 4 };

export interface JobSpec {
  dedupKey: string; kind: string; role: string; area: Area; title: string; parentId?: string | null; input?: unknown;
  evidenceIds?: string[]; tools?: string[]; budget?: { modelCalls?: number; maxMinutes?: number }; criteria?: string[]; synthetic?: boolean; delegatedBy?: string | null;
}
export interface JobRow {
  id: string; dedup_key: string; kind: string; role: string; area: Area; title: string; parent_id: string | null; root_id: string | null; depth: number;
  status: JobStatus; input: any; evidence_ids: string[]; tools: string[]; budget: any; criteria: string[]; stage: string | null;
  progress_done: number | null; progress_total: number | null; waiting_on: string[]; lease_owner: string | null; lease_until: number | null; heartbeat_at: number | null;
  attempts: number; cancel_requested: number; result: any; error: string | null; model_calls: number; synthetic: number; delegated_by: string | null;
  created_at: number; started_at: number | null; finished_at: number | null;
}
type Clock = () => Date;
const real: Clock = () => new Date();
const J = (v: unknown) => JSON.stringify(v ?? null);
const P = (s: unknown, d: any = null) => { try { return s == null ? d : JSON.parse(s as string); } catch { return d; } };

export const parseJob = (r: any): JobRow => ({ ...r, input: P(r.input, {}), evidence_ids: P(r.evidence_ids, []), tools: P(r.tools, []), budget: P(r.budget, {}), criteria: P(r.criteria, []), waiting_on: P(r.waiting_on, []), result: P(r.result, null) });
export const getJob = (ctx: Ctx, id: string): JobRow | null => { const r = get(ctx.db, "SELECT * FROM jobs WHERE id=? AND owner_id=?", id, ctx.owner); return r ? parseJob(r) : null; };

export function jobEvent(ctx: Ctx, jobId: string, kind: string, summary: string, data: unknown = {}, clock: Clock = real) {
  run(ctx.db, "INSERT INTO job_events(job_id,at,kind,summary,data) VALUES(?,?,?,?,?)", jobId, clock().getTime(), kind, summary, J(data));
}

export class LimitError extends Error {}

/** Idempotent: the same dedup key returns the existing job. Children obey depth and concurrency bounds and inherit a subset of the parent's authority. */
export function enqueueJob(ctx: Ctx, spec: JobSpec, clock: Clock = real): { id: string; created: boolean } {
  return tx(ctx.db, () => {
    const ex = get(ctx.db, "SELECT id FROM jobs WHERE owner_id=? AND dedup_key=?", ctx.owner, spec.dedupKey);
    if (ex) return { id: ex.id as string, created: false };
    let depth = 0, root: string | null = null, tools = spec.tools ?? [], budget = spec.budget ?? {};
    if (spec.parentId) {
      const par = getJob(ctx, spec.parentId);
      if (!par) throw new LimitError("Parent job not found");
      if (TERMINAL.includes(par.status)) throw new LimitError(`Parent is ${par.status}. Not delegating.`);
      depth = par.depth + 1;
      if (depth > LIMITS.maxDepth) throw new LimitError(`Delegation depth limit (${LIMITS.maxDepth}) reached`);
      const kids = (get(ctx.db, "SELECT COUNT(*) n FROM jobs WHERE parent_id=? AND status NOT IN ('done','failed','cancelled')", par.id)!.n as number);
      if (kids >= LIMITS.maxChildrenPerParent) throw new LimitError(`At most ${LIMITS.maxChildrenPerParent} active helpers per supervisor`);
      root = par.root_id ?? par.id;
      // A child may only hold tools its parent holds, and cannot spend more than the parent allows.
      if (par.tools.length) tools = tools.filter((t) => par.tools.includes(t));
      if (par.budget.modelCalls != null) budget = { ...budget, modelCalls: Math.min(budget.modelCalls ?? par.budget.modelCalls, par.budget.modelCalls) };
    }
    const id = uid("job"); const now = clock().getTime();
    run(ctx.db, `INSERT INTO jobs(id,owner_id,dedup_key,kind,role,area,title,parent_id,root_id,depth,status,input,evidence_ids,tools,budget,criteria,synthetic,delegated_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, ctx.owner, spec.dedupKey, spec.kind, spec.role, spec.area, spec.title, spec.parentId ?? null, root ?? id, depth, "queued",
      J(spec.input ?? {}), J(spec.evidenceIds ?? []), J(tools), J(budget), J(spec.criteria ?? []), spec.synthetic ? 1 : 0, spec.delegatedBy ?? null, now);
    jobEvent(ctx, id, "arrived", spec.parentId ? `Assigned by ${spec.delegatedBy ?? "supervisor"}` : "Arrived", { parentId: spec.parentId ?? null }, clock);
    return { id, created: true };
  });
}

/** Atomically take the next job: queued, or running with an expired lease (its worker died). */
export function claimNext(ctx: Ctx, workerId: string, leaseMs: number, clock: Clock = real): JobRow | null {
  const now = clock().getTime();
  return tx(ctx.db, () => {
    const running = (get(ctx.db, "SELECT COUNT(*) n FROM jobs WHERE status='running' AND lease_until>=? AND kind NOT LIKE 'supervise%'", now)!.n as number);
    const cands = all(ctx.db, `SELECT id, kind, status FROM jobs WHERE owner_id=? AND (status='queued' OR (status='running' AND lease_until<?)) ORDER BY depth DESC, created_at LIMIT 8`, ctx.owner, now);
    const pick = cands.find((c) => String(c.kind).startsWith("supervise") || running < LIMITS.maxRunning);
    if (!pick) return null;
    const recovered = pick.status === "running";
    run(ctx.db, "UPDATE jobs SET status='running', lease_owner=?, lease_until=?, heartbeat_at=?, attempts=attempts+1, started_at=COALESCE(started_at,?) WHERE id=?", workerId, now + leaseMs, now, now, pick.id);
    jobEvent(ctx, pick.id as string, recovered ? "recovered" : "started", recovered ? `Picked up after the previous worker stopped (${workerId})` : `Started by ${workerId}`, {}, clock);
    return getJob(ctx, pick.id as string);
  });
}

/** Jobs left running by a dead worker go back to the queue once the lease has expired. */
export function recoverStale(ctx: Ctx, clock: Clock = real): number {
  const now = clock().getTime(); let n = 0;
  for (const r of all(ctx.db, "SELECT id, lease_owner FROM jobs WHERE owner_id=? AND status='running' AND lease_until<?", ctx.owner, now)) {
    run(ctx.db, "UPDATE jobs SET status='queued', lease_owner=NULL, lease_until=NULL WHERE id=? AND status='running'", r.id);
    jobEvent(ctx, r.id as string, "recovering", `Worker ${r.lease_owner} stopped. Job re-queued.`, {}, clock); n++;
  }
  return n;
}

export class WaitSignal extends Error { constructor(public ids: string[]) { super("waiting"); } }
export class CancelSignal extends Error {}
export class CrashSignal extends Error {}   // test hook: simulates the worker process dying

export interface JobApi {
  job: JobRow; ctx: Ctx; input: any;
  step<T>(name: string, label: string, fn: () => T | Promise<T>): Promise<T>;
  spawn(childKey: string, spec: Omit<JobSpec, "dedupKey" | "parentId" | "delegatedBy">): string;
  child(id: string): JobRow;
  waitFor(ids: string[]): void;
  progress(done: number, total: number, stage?: string): void;
  event(kind: string, summary: string, data?: unknown): void;
  modelCall(): void;
  assertNotCancelled(): void;
}
export type Handler = (api: JobApi) => Promise<unknown>;
export interface RunOpts { workerId: string; leaseMs?: number; paceMs?: number; clock?: Clock; crashAfterStep?: string; crashBeforeStep?: string; handlers: Record<string, Handler> }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function terminal(ctx: Ctx, id: string, status: JobStatus, patch: { result?: unknown; error?: string }, clock: Clock) {
  const now = clock().getTime();
  run(ctx.db, "UPDATE jobs SET status=?, result=?, error=?, finished_at=?, lease_owner=NULL, lease_until=NULL, stage=CASE WHEN ?='done' THEN 'Finished' ELSE stage END WHERE id=? AND status NOT IN ('done','failed','cancelled')",
    status, patch.result === undefined ? null : J(patch.result), patch.error ?? null, now, status, id);
  jobEvent(ctx, id, status === "done" ? "departed" : status, status === "done" ? "Finished" : status === "failed" ? `Failed: ${patch.error}` : "Cancelled", {}, clock);
  const j = getJob(ctx, id);
  // Wake a parent that is waiting on this job.
  if (j?.parent_id) {
    const par = getJob(ctx, j.parent_id);
    if (par && par.status === "waiting" && par.waiting_on.every((w) => { const x = getJob(ctx, w); return !x || TERMINAL.includes(x.status); })) {
      run(ctx.db, "UPDATE jobs SET status='queued', waiting_on='[]' WHERE id=? AND status='waiting'", par.id);
      jobEvent(ctx, par.id, "woken", `${j.title} finished`, {}, clock);
    }
  }
}

export async function runClaimed(ctx: Ctx, job0: JobRow, o: RunOpts): Promise<"done" | "waiting" | "failed" | "cancelled" | "crashed" | "blocked"> {
  const clock = o.clock ?? real; const leaseMs = o.leaseMs ?? 15000;
  let job = job0;
  const hb = () => { const n = clock().getTime(); run(ctx.db, "UPDATE jobs SET heartbeat_at=?, lease_until=? WHERE id=? AND lease_owner=?", n, n + leaseMs, job.id, o.workerId); };
  const timer = setInterval(hb, Math.max(250, Math.floor(leaseMs / 3)));
  const refresh = () => { job = getJob(ctx, job.id)!; return job; };
  const api: JobApi = {
    get job() { return job; }, ctx, input: job.input,
    async step(name, label, fn) {
      const done = get(ctx.db, "SELECT result FROM job_steps WHERE job_id=? AND step=?", job.id, name);
      if (done) return P(done.result) as never;
      api.assertNotCancelled();
      if (o.crashBeforeStep === name) throw new CrashSignal(`crash before ${name}`);
      run(ctx.db, "UPDATE jobs SET stage=? WHERE id=?", label, job.id); hb();
      jobEvent(ctx, job.id, "step", label, { step: name }, clock);
      if (o.paceMs) await sleep(o.paceMs);
      const out = await fn();
      run(ctx.db, "INSERT OR IGNORE INTO job_steps(job_id,step,label,result,done_at) VALUES(?,?,?,?,?)", job.id, name, label, J(out), clock().getTime());
      if (o.crashAfterStep === name) throw new CrashSignal(`crash after ${name}`);
      return out as never;
    },
    spawn(childKey, spec) {
      const kid = enqueueJob(ctx, { ...spec, dedupKey: `${job.id}:${childKey}`, parentId: job.id, delegatedBy: job.title, synthetic: spec.synthetic ?? !!job.synthetic }, clock);
      if (kid.created) jobEvent(ctx, job.id, "delegated", `Assigned: ${spec.title}`, { childId: kid.id }, clock);
      return kid.id;
    },
    child: (id) => getJob(ctx, id)!,
    waitFor(ids) { const open = ids.filter((i) => { const c = getJob(ctx, i); return c && !TERMINAL.includes(c.status); }); if (open.length) throw new WaitSignal(open); },
    progress(done, total, stage) { run(ctx.db, "UPDATE jobs SET progress_done=?, progress_total=?, stage=COALESCE(?,stage) WHERE id=?", done, total, stage ?? null, job.id); hb(); },
    event: (kind, summary, data) => jobEvent(ctx, job.id, kind, summary, data, clock),
    modelCall() { run(ctx.db, "UPDATE jobs SET model_calls=model_calls+1 WHERE id=?", job.id); },
    assertNotCancelled() { if (refresh().cancel_requested) throw new CancelSignal(); },
  };
  try {
    const h = o.handlers[job.kind];
    if (!h) throw new Error(`No handler for ${job.kind}`);
    const result = await h(api);
    terminal(ctx, job.id, "done", { result }, clock);
    return "done";
  } catch (e: any) {
    if (e instanceof CrashSignal) return "crashed";           // lease stays held; a later worker recovers it
    if (e instanceof WaitSignal) {
      run(ctx.db, "UPDATE jobs SET status='waiting', waiting_on=?, lease_owner=NULL, lease_until=NULL WHERE id=?", J(e.ids), job.id);
      jobEvent(ctx, job.id, "waiting", `Waiting on ${e.ids.length} helper${e.ids.length > 1 ? "s" : ""}`, {}, clock);
      // A child may have finished between the check and now.
      const par = getJob(ctx, job.id)!;
      if (par.waiting_on.every((w) => { const x = getJob(ctx, w); return !x || TERMINAL.includes(x.status); })) run(ctx.db, "UPDATE jobs SET status='queued', waiting_on='[]' WHERE id=? AND status='waiting'", job.id);
      return "waiting";
    }
    if (e instanceof CancelSignal) { terminal(ctx, job.id, "cancelled", {}, clock); return "cancelled"; }
    if (e?.blocked) { run(ctx.db, "UPDATE jobs SET status='blocked', stage=?, error=?, lease_owner=NULL, lease_until=NULL WHERE id=?", e.message, e.message, job.id); jobEvent(ctx, job.id, "blocked", e.message, {}, clock); return "blocked"; }
    terminal(ctx, job.id, "failed", { error: String(e?.message ?? e).slice(0, 300) }, clock);
    return "failed";
  } finally { clearInterval(timer); }
}

/** Run claimed jobs until none are ready. Returns how many ran. */
export async function processQueue(ctx: Ctx, o: RunOpts & { max?: number }): Promise<number> {
  let n = 0;
  while (n < (o.max ?? 50)) {
    const j = claimNext(ctx, o.workerId, o.leaseMs ?? 15000, o.clock);
    if (!j) break;
    const r = await runClaimed(ctx, j, o);
    n++;
    if (r === "crashed") break;
  }
  return n;
}

/** Cancel a job and everything it delegated. Running jobs stop at their next step. */
export function cancelJob(ctx: Ctx, id: string, clock: Clock = real): number {
  let n = 0;
  const walk = (jid: string) => {
    const j = getJob(ctx, jid); if (!j || TERMINAL.includes(j.status)) return;
    for (const c of all(ctx.db, "SELECT id FROM jobs WHERE parent_id=?", jid)) walk(c.id as string);
    if (j.status === "running") run(ctx.db, "UPDATE jobs SET cancel_requested=1 WHERE id=?", jid);
    else { run(ctx.db, "UPDATE jobs SET cancel_requested=1, status='cancelled', finished_at=?, lease_owner=NULL, lease_until=NULL WHERE id=?", clock().getTime(), jid); jobEvent(ctx, jid, "cancelled", "Cancelled", {}, clock); }
    n++;
  };
  tx(ctx.db, () => walk(id));
  return n;
}

export const jobEvents = (ctx: Ctx, jobId: string, limit = 12) =>
  all(ctx.db, "SELECT at,kind,summary FROM job_events WHERE job_id=? ORDER BY id DESC LIMIT ?", jobId, limit).reverse();

export function officeState(ctx: Ctx, clock: Clock = real) {
  const now = clock().getTime();
  const rows = all(ctx.db, "SELECT * FROM jobs WHERE owner_id=? AND (finished_at IS NULL OR finished_at>?) ORDER BY created_at", ctx.owner, now - 6 * 3600_000).map(parseJob);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const jobs = rows.map((j) => ({
    id: j.id, title: j.title, role: j.role, area: j.area, kind: j.kind, status: j.status, stage: j.stage, depth: j.depth,
    progress: j.progress_total ? { done: j.progress_done ?? 0, total: j.progress_total } : null,
    parentId: j.parent_id, delegatedBy: j.delegated_by, evidenceIds: j.evidence_ids, tools: j.tools, budget: j.budget, criteria: j.criteria,
    elapsedMs: (j.finished_at ?? now) - (j.started_at ?? j.created_at), queuedMs: j.started_at ? 0 : now - j.created_at,
    heartbeatAgeMs: j.heartbeat_at ? now - j.heartbeat_at : null, leaseOwner: j.lease_owner, attempts: j.attempts, modelCalls: j.model_calls,
    synthetic: !!j.synthetic, result: j.result, error: j.error, finishedAgoMs: j.finished_at ? now - j.finished_at : null,
    steps: all(ctx.db, "SELECT step,label FROM job_steps WHERE job_id=? ORDER BY done_at", j.id).map((s) => s.label),
    events: jobEvents(ctx, j.id, 10),
  }));
  void byId;
  const active = jobs.filter((j) => !TERMINAL.includes(j.status as JobStatus));
  return { now, jobs, activeCount: active.length, idle: active.length === 0, modelCalls: jobs.reduce((n, j) => n + j.modelCalls, 0) };
}
