import { describe, it, expect, beforeEach } from "vitest";
import { memCtx, count } from "./helpers";
import { Router, RouterError, ROLE_DEFAULTS, Transport, spentToday } from "@/lib/router";
import { setSetting } from "@/lib/db";
import { startCouncil, getCouncil, cancelCouncil, SAMPLE_DRAFT, SAMPLE_SOURCES, SAMPLE_RUBRIC, checklist, supportCheck } from "@/lib/council";

function mock(handler?: (r: any) => string) {
  const calls: any[] = [];
  const t: Transport = async (r) => {
    calls.push(r);
    return { text: handler ? handler(r) : "{}", usage: { input: 500, output: 200 } };
  };
  return { t, calls };
}
const seatJson = (excerpt: string) => JSON.stringify({ findings: [{ passage: excerpt, finding: "Finding", severity: "medium", evidence: { pointer: "draft", excerpt }, suggestedChange: "Change" }] });
const editorJson = (ids: string[]) => JSON.stringify({ strongestPassage: "x", highestImpactFix: "fix", uncertainty: "u", minutesPlan: [{ minutes: 10, step: "s" }], disagreements: [], resolved: ids.map((i) => ({ findingId: i, decision: "accepted", reason: "r" })) });

beforeEach(() => { delete process.env.JARVIS_ALLOW_PREMIUM; });

describe("router", () => {
  it("ordinary work stays on the standard route; defaults match the brief", () => {
    expect(ROLE_DEFAULTS.extract_small).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
    expect(ROLE_DEFAULTS.brief).toMatchObject({ model: "claude-sonnet-5-5", effort: "medium" });
    expect(ROLE_DEFAULTS.deep_review).toMatchObject({ model: "claude-fable-5-2", premium: true });
    const ctx = memCtx(); setSetting(ctx.db, "daily_budget_usd", 5);
    const r = new Router(ctx, mock().t);
    expect(r.resolve("essay_review")).toMatchObject({ status: "ready", model: "claude-sonnet-5-5", effort: "medium" });
    expect(r.resolve("essay_review").premium).toBe(false);
  });
  it("blocks premium without opt-in, even with budget and key", async () => {
    const ctx = memCtx(); setSetting(ctx.db, "daily_budget_usd", 100);
    const m = mock(); const r = new Router(ctx, m.t);
    expect(r.resolve("deep_review", { premiumOptIn: true }).status).toBe("premium_blocked");
    await expect(r.call("deep_review", { system: "s", user: "u", initiator: "t", premiumOptIn: true })).rejects.toMatchObject({ code: "premium_blocked" });
    process.env.JARVIS_ALLOW_PREMIUM = "1";
    expect(r.resolve("deep_review", { premiumOptIn: true }).status).toBe("premium_blocked"); // settings opt-in still off
    setSetting(ctx.db, "premium_opt_in", true);
    expect(r.resolve("deep_review", { premiumOptIn: false }).status).toBe("premium_blocked"); // per-request confirmation missing
    expect(r.resolve("deep_review", { premiumOptIn: true }).status).toBe("ready");
    expect(m.calls).toHaveLength(0);
  });
  it("paid AI is off by default with an actionable message; no provider is actionable too", () => {
    const ctx = memCtx();
    expect(new Router(ctx, mock().t).resolve("brief")).toMatchObject({ status: "budget_off" });
    expect(new Router(ctx, null).resolve("brief").message).toMatch(/ANTHROPIC_API_KEY/);
  });
  it("reserves budget before dispatch and reconciles afterward; exhausted budget defers", async () => {
    const ctx = memCtx(); setSetting(ctx.db, "daily_budget_usd", 0.001);
    const m = mock(); const r = new Router(ctx, m.t);
    await expect(r.call("essay_review", { system: "s".repeat(4000), user: "u".repeat(4000), initiator: "t" })).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(m.calls).toHaveLength(0);
    setSetting(ctx.db, "daily_budget_usd", 1);
    const out = await r.call("essay_review", { system: "s", user: "u", initiator: "t" });
    expect(out.usage).toEqual({ input: 500, output: 200 });
    expect(spentToday(ctx)).toBeCloseTo(out.costEstimateUsd, 8);
    expect(count(ctx, "runs", "status='ok'")).toBe(1);
  });
  it("retries rate limits with bounded attempts", async () => {
    const ctx = memCtx(); setSetting(ctx.db, "daily_budget_usd", 1);
    let n = 0; const t: Transport = async () => { n++; if (n < 3) { const e: any = new Error("429"); e.status = 429; throw e; } return { text: "ok", usage: null }; };
    const out = await new Router(ctx, t, async () => {}).call("brief", { system: "s", user: "u", initiator: "t" });
    expect(out.text).toBe("ok"); expect(n).toBe(3);
    let m = 0; const bad: Transport = async () => { m++; const e: any = new Error("500"); e.status = 500; throw e; };
    await expect(new Router(ctx, bad, async () => {}).call("brief", { system: "s", user: "u", initiator: "t2" })).rejects.toMatchObject({ code: "failed" });
    expect(m).toBe(3);
  });
});

describe("council", () => {
  it("no provider and arbitrary text: a real rubric checklist, never a canned verdict", async () => {
    const ctx = memCtx(); const r = new Router(ctx, null);
    const { id, promise } = startCouncil(ctx, r, { preset: "essay", question: "Review", draft: "My essay argues that dogs are loyal. Article 4 is cited here. It is short but real text.", sources: [], rubric: [], requiredArticles: [4, 13, 16, 31] });
    await promise;
    const s = getCouncil(ctx, id)!;
    expect(s.mode).toBe("checklist");
    expect(s.notice).toMatch(/not a review/);
    expect(s.seats.every((x: any) => x.findings.length === 0)).toBe(true);
    expect(s.editor).toBeNull();
    const art = s.bundle.checklist.items.find((i: any) => /required articles/.test(i.item));
    expect(art.pass).toBe(false);
    expect(art.evidence).toBe("Not mentioned: 13, 16, 31");
  });
  it("the fixture essay replays a labeled sample with four independent seats and an editor; every claim has support or an uncertainty label", async () => {
    const ctx = memCtx(); const r = new Router(ctx, null);
    const { id, promise } = startCouncil(ctx, r, { preset: "essay", question: "What should I fix?", draft: SAMPLE_DRAFT, sources: SAMPLE_SOURCES, rubric: SAMPLE_RUBRIC }, { replayDelayMs: 1 });
    await promise;
    const s = getCouncil(ctx, id)!;
    expect(s.mode).toBe("replay-sample");
    expect(s.notice).toMatch(/Sample replay/);
    expect(s.status).toBe("done");
    expect(s.seats.map((x: any) => x.seat)).toEqual(["Advocate", "Skeptic", "Rubric Reader", "Evidence Checker"]);
    for (const seat of s.seats) for (const f of seat.findings) expect(f.supported || f.uncertain).toBe(true);
    expect(s.seats.flatMap((x: any) => x.findings).every((f: any) => f.supported)).toBe(true);
    expect(s.editor.highestImpactFix).toMatch(/article 16/);
    expect(Object.keys(s.editor.labelMap)).toHaveLength(4);
    expect(s.editor.disagreements.length).toBe(1);
    // unchanged input does not rerun
    const again = startCouncil(ctx, r, { preset: "essay", question: "What should I fix?", draft: SAMPLE_DRAFT, sources: SAMPLE_SOURCES, rubric: SAMPLE_RUBRIC });
    expect(again.reused).toBe(true); expect(again.id).toBe(id);
  });
  it("Claude mode: four isolated first-pass calls, then an editor that sees anonymized findings", async () => {
    const ctx = memCtx(); setSetting(ctx.db, "daily_budget_usd", 5);
    const m = mock((req) => req.system.includes("the editor") ? editorJson(["F1", "F2", "F3", "F4"]) : seatJson("My essay argues that dogs are loyal"));
    const r = new Router(ctx, m.t);
    const draft = "My essay argues that dogs are loyal. They stay with owners. This is a longer line for the review.";
    const { id, promise } = startCouncil(ctx, r, { preset: "essay", question: "Review", draft, sources: [], rubric: [] });
    await promise;
    const s = getCouncil(ctx, id)!;
    expect(s.mode).toBe("claude");
    expect(m.calls).toHaveLength(5);
    const first = m.calls.filter((c) => !c.system.includes("the editor"));
    expect(first).toHaveLength(4);
    for (const c of first) { expect(c.user).toContain(draft); expect(c.user).not.toContain("Finding"); }   // no seat sees another seat's output
    const editor = m.calls.find((c) => c.system.includes("the editor"))!;
    for (const n of ["Advocate", "Skeptic", "Rubric Reader", "Evidence Checker"]) expect(editor.user).not.toContain(n);
    expect(editor.user).toContain("F1");
    expect(s.status).toBe("done");
    expect(s.editor.resolved).toHaveLength(4);
  });
  it("unsupported evidence is labeled uncertain, not trusted", () => {
    const f = supportCheck({ passage: "x", finding: "y", severity: "low", evidence: { pointer: "p", excerpt: "text that is not in the draft" }, suggestedChange: "z" }, "The draft says other things.", []);
    expect(f).toMatchObject({ supported: false, uncertain: true });
  });
  it("cancellation marks partial results and skips the editor; a failed seat leaves the rest", async () => {
    const ctx = memCtx(); const r = new Router(ctx, null);
    const { id, promise } = startCouncil(ctx, r, { preset: "essay", question: "q", draft: SAMPLE_DRAFT, sources: SAMPLE_SOURCES, rubric: SAMPLE_RUBRIC }, { replayDelayMs: 40 });
    setTimeout(() => cancelCouncil(ctx, id), 60);
    await promise;
    const s = getCouncil(ctx, id)!;
    expect(s.status).toBe("cancelled");
    expect(s.editor).toBeNull();
    expect(s.notice).toMatch(/Partial/);
    expect(s.seats.some((x: any) => x.status === "ok")).toBe(true);
    expect(s.seats.some((x: any) => x.status === "cancelled")).toBe(true);
  });
  it("missing sources: Evidence Checker stays honest; short drafts are rejected", () => {
    const ctx = memCtx(); const r = new Router(ctx, null);
    expect(() => startCouncil(ctx, r, { preset: "essay", question: "q", draft: "short", sources: [], rubric: [] })).toThrow(/paragraph/);
    expect(checklist("Article 4 and article 13 appear. I argue that this works.", [4, 13, 16]).items[1].evidence).toBe("Not mentioned: 16");
  });
});

import http from "node:http";
import { anthropicTransport } from "@/lib/router";
describe("Claude transport request shape (local stub server, not the live API)", () => {
  async function withStub(reply: (body: any) => any, fn: (url: string, seen: any[]) => Promise<void>) {
    const seen: any[] = [];
    const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { const body = JSON.parse(b); seen.push({ headers: req.headers, body }); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(reply(body))); }); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    try { await fn(`http://127.0.0.1:${(srv.address() as any).port}`, seen); } finally { srv.close(); }
  }
  it("sends model, max_tokens and output_config.effort, and nothing the current models reject", async () => {
    await withStub(() => ({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 9, output_tokens: 3 } }), async (url, seen) => {
      const out = await anthropicTransport("test-key", url)({ model: "claude-sonnet-5-5", effort: "medium", system: "s", user: "u", maxTokens: 6000 });
      expect(out).toEqual({ text: "OK", usage: { input: 9, output: 3 } });
      const b = seen[0].body;
      expect(b).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 6000, output_config: { effort: "medium" }, system: "s" });
      for (const k of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) expect(b).not.toHaveProperty(k);
      expect(seen[0].headers["x-api-key"]).toBe("test-key");
      expect(seen[0].headers["anthropic-version"]).toBe("2023-06-01");
    });
  });
  it("a refusal or a truncated answer is a clear, non-retried failure", async () => {
    for (const [reply, re] of [[{ content: [], stop_reason: "refusal", stop_details: { category: "cyber" } }, /declined.*cyber/], [{ content: [{ type: "text", text: "partial" }], stop_reason: "max_tokens" }, /output limit/]] as const) {
      await withStub(() => reply, async (url, seen) => {
        const ctx = memCtx(); setSetting(ctx.db, "daily_budget_usd", 5);
        await expect(new Router(ctx, anthropicTransport("k", url), async () => {}).call("brief", { system: "s", user: "u", initiator: "t" })).rejects.toThrow(re);
        expect(seen).toHaveLength(1);   // not retried, so not paid for three times
      });
    }
  });
});
