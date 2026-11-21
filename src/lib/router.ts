// One server-side model router. Roles map to models and effort. Deterministic work never reaches this file.
// Claude is the only generative provider. Budget is reserved before dispatch and reconciled afterward.
import { Ctx, all, get, run, uid, getSetting, sha } from "./db";
import { localDate } from "./time";

export type Role = "extract_small" | "brief" | "study_plan" | "advisor" | "skill_candidate" | "essay_review" | "council_editor" | "deep_review";
export interface RoleConfig { model: string; effort: "low" | "medium" | "high"; premium: boolean; maxTokens: number }

export const ROLE_DEFAULTS: Record<Role, RoleConfig> = {
  extract_small: { model: "claude-haiku-5-5", effort: "low", premium: false, maxTokens: 600 },
  brief: { model: "claude-sonnet-5-5", effort: "medium", premium: false, maxTokens: 1200 },
  study_plan: { model: "claude-sonnet-5-5", effort: "medium", premium: false, maxTokens: 1600 },
  advisor: { model: "claude-sonnet-5-5", effort: "medium", premium: false, maxTokens: 1200 },
  skill_candidate: { model: "claude-sonnet-5-5", effort: "medium", premium: false, maxTokens: 1200 },
  essay_review: { model: "claude-sonnet-5-5", effort: "medium", premium: false, maxTokens: 1400 },
  council_editor: { model: "claude-sonnet-5-5", effort: "high", premium: false, maxTokens: 1800 },
  deep_review: { model: "claude-fable-5-2", effort: "high", premium: true, maxTokens: 2400 },
};

/** Placeholder per-million-token rates. These are configuration, not published prices. Override with JARVIS_PRICES_JSON. */
const DEFAULT_PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-5-5": { in: 1, out: 5 }, "claude-sonnet-5-5": { in: 3, out: 15 }, "claude-fable-5-2": { in: 15, out: 75 },
};
const prices = (): Record<string, { in: number; out: number }> => {
  try { return { ...DEFAULT_PRICES, ...(process.env.JARVIS_PRICES_JSON ? JSON.parse(process.env.JARVIS_PRICES_JSON) : {}) }; } catch { return DEFAULT_PRICES; }
};
export const estimateCostUsd = (model: string, inTok: number, outTok: number) => {
  const p = prices()[model] ?? { in: 3, out: 15 };
  return (inTok * p.in + outTok * p.out) / 1e6;
};
export const roughTokens = (s: string) => Math.ceil(s.length / 4);

export interface CompleteReq { model: string; effort: string; system: string; user: string; maxTokens: number; signal?: AbortSignal }
export interface CompleteRes { text: string; usage: { input: number; output: number } | null }
export type Transport = (r: CompleteReq) => Promise<CompleteRes>;

export class RouterError extends Error {
  constructor(public code: "no_provider" | "budget_off" | "budget_exhausted" | "premium_blocked" | "unavailable" | "cancelled" | "failed", message: string) { super(message); }
}

export function anthropicTransport(apiKey: string, baseUrl = "https://api.anthropic.com"): Transport {
  return async (r) => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST", signal: r.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: r.model, max_tokens: r.maxTokens, system: r.system, messages: [{ role: "user", content: r.user }] }),
    });
    if (!res.ok) { const e: any = new Error(`Claude API ${res.status}`); e.status = res.status; e.retryAfter = Number(res.headers.get("retry-after") ?? 0); throw e; }
    const j: any = await res.json();
    const text = (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return { text, usage: j.usage ? { input: j.usage.input_tokens ?? 0, output: j.usage.output_tokens ?? 0 } : null };
  };
}

export interface Resolution { role: Role; status: "ready" | "no_provider" | "budget_off" | "budget_exhausted" | "premium_blocked"; model: string; effort: string; message: string; premium: boolean }

export function roleConfig(role: Role): RoleConfig {
  const env = process.env[`JARVIS_MODEL_${role.toUpperCase()}`];
  return env ? { ...ROLE_DEFAULTS[role], model: env } : ROLE_DEFAULTS[role];
}
export const premiumEnabled = (ctx: Ctx) => process.env.JARVIS_ALLOW_PREMIUM === "1" && getSetting(ctx.db, "premium_opt_in", false);
export const dailyBudget = (ctx: Ctx) => Number(getSetting<number>(ctx.db, "daily_budget_usd", Number(process.env.JARVIS_DAILY_BUDGET_USD ?? 0)));

export function spentToday(ctx: Ctx): number {
  const day = localDate(ctx.now());
  const rows = all(ctx.db, "SELECT started_at, cost_estimate_usd FROM runs WHERE owner_id=? AND status IN ('running','ok') AND cost_estimate_usd IS NOT NULL", ctx.owner);
  return rows.filter((r) => localDate(r.started_at as string) === day).reduce((n, r) => n + (r.cost_estimate_usd as number), 0);
}

export class Router {
  constructor(private ctx: Ctx, private transport: Transport | null = defaultTransport(), private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  resolve(role: Role, o: { premiumOptIn?: boolean; estimateUsd?: number } = {}): Resolution {
    const c = roleConfig(role);
    const base = { role, model: c.model, effort: c.effort, premium: c.premium };
    if (!this.transport) return { ...base, status: "no_provider", message: "No Claude provider. Set ANTHROPIC_API_KEY in .env and restart. Deterministic features keep working." };
    if (c.premium && !(premiumEnabled(this.ctx) && o.premiumOptIn)) return { ...base, status: "premium_blocked", message: "Premium review is off. It needs JARVIS_ALLOW_PREMIUM=1, the Settings opt-in, and a confirmation on this request." };
    const budget = dailyBudget(this.ctx);
    if (!(budget > 0)) return { ...base, status: "budget_off", message: "Paid AI is off. Set a daily budget above 0 in Settings to enable it." };
    if (spentToday(this.ctx) + (o.estimateUsd ?? 0) > budget) return { ...base, status: "budget_exhausted", message: `Daily budget of $${budget.toFixed(2)} would be exceeded. This work is deferred. Deterministic features still work.` };
    return { ...base, status: "ready", message: `Ready: ${c.model} at ${c.effort} effort.` };
  }

  /** Reserve estimated cost, call with timeout and bounded retry, then reconcile with measured usage. */
  async call(role: Role, req: { system: string; user: string; initiator: string; retryKey?: string; premiumOptIn?: boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<{ text: string; runId: string; model: string; effort: string; usage: CompleteRes["usage"]; costEstimateUsd: number }> {
    const c = roleConfig(role);
    const est = estimateCostUsd(c.model, roughTokens(req.system + req.user), c.maxTokens);
    const r = this.resolve(role, { premiumOptIn: req.premiumOptIn, estimateUsd: est });
    if (r.status !== "ready") throw new RouterError(r.status === "no_provider" ? "no_provider" : r.status === "premium_blocked" ? "premium_blocked" : r.status === "budget_off" ? "budget_off" : "budget_exhausted", r.message);
    const runId = uid("run");
    const key = req.retryKey ?? null;
    if (key) {
      const prior = get(this.ctx.db, "SELECT * FROM runs WHERE retry_key=?", key);
      if (prior && prior.status === "ok") throw new RouterError("failed", "This exact request already completed. Reuse its result instead of paying twice.");
    }
    run(this.ctx.db, "INSERT INTO runs(id,owner_id,role,initiator,input_hash,provider_mode,model,effort,started_at,status,cost_estimate_usd,retry_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      runId, this.ctx.owner, role, req.initiator, sha(req.system + req.user).slice(0, 16), "claude", c.model, c.effort, this.ctx.now().toISOString(), "running", est, key);
    const t0 = Date.now();
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (req.signal?.aborted) break;
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), req.timeoutMs ?? 60_000);
        const onAbort = () => ac.abort(); req.signal?.addEventListener("abort", onAbort);
        let res: CompleteRes;
        try { res = await this.transport!({ model: c.model, effort: c.effort, system: req.system, user: req.user, maxTokens: c.maxTokens, signal: ac.signal }); }
        finally { clearTimeout(timer); req.signal?.removeEventListener("abort", onAbort); }
        const cost = res.usage ? estimateCostUsd(c.model, res.usage.input, res.usage.output) : est;
        run(this.ctx.db, "UPDATE runs SET status='ok', finished_at=?, usage=?, cost_estimate_usd=? WHERE id=?", this.ctx.now().toISOString(), JSON.stringify({ ...(res.usage ?? {}), elapsedMs: Date.now() - t0, costIsEstimate: true }), cost, runId);
        return { text: res.text, runId, model: c.model, effort: c.effort, usage: res.usage, costEstimateUsd: cost };
      } catch (e: any) {
        lastErr = e;
        if (req.signal?.aborted) break;
        const retryable = !e.status || e.status === 429 || e.status >= 500;
        if (!retryable || attempt === 2) break;
        const wait = (e.retryAfter ? e.retryAfter * 1000 : 400 * 2 ** attempt) + Math.floor(Math.random() * 200);
        await this.sleep(wait);
      }
    }
    const cancelled = req.signal?.aborted;
    run(this.ctx.db, "UPDATE runs SET status=?, finished_at=?, failure=?, cost_estimate_usd=0 WHERE id=?", cancelled ? "cancelled" : "failed", this.ctx.now().toISOString(), String(lastErr?.message ?? "cancelled").slice(0, 200), runId);
    throw new RouterError(cancelled ? "cancelled" : "failed", cancelled ? "Cancelled" : `Claude call failed: ${lastErr?.message ?? "unknown"}`);
  }
}

export function defaultTransport(): Transport | null {
  const k = process.env.ANTHROPIC_API_KEY;
  return k ? anthropicTransport(k, process.env.ANTHROPIC_BASE_URL) : null;
}

export function routerStatus(ctx: Ctx) {
  const router = new Router(ctx);
  return {
    provider: defaultTransport() ? "configured (not verified until you run a health check)" : "not configured",
    dailyBudgetUsd: dailyBudget(ctx), spentTodayUsd: Math.round(spentToday(ctx) * 10000) / 10000, costIsEstimate: true,
    premium: premiumEnabled(ctx) ? "enabled" : "off",
    roles: (Object.keys(ROLE_DEFAULTS) as Role[]).map((r) => router.resolve(r)),
    deterministic: ["timers", "source hashes", "deduplication", "calendar math", "quiet hours", "unchanged scans"],
  };
}
