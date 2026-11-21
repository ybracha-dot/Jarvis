import { describe, it, expect } from "vitest";
import { memCtx, count } from "./helpers";
import { seedDemo } from "@/lib/demo";
import { captureToJarvis, undoCapture, parseCapture, recallFromJarvis, captureReceipt } from "@/lib/capture";
import { processQueue, claimNext, runClaimed, recoverStale, cancelJob, enqueueJob, officeState, LIMITS, LimitError, getJob } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { listDecisions, reserve } from "@/lib/decisions";
import { listCommitments } from "@/lib/commitments";
import { all, get } from "@/lib/db";

const TAMID = "Remember for Jarvis: I owe the TAMID team three pitch angles by Thursday.";
const base = (ctx: any, clock: () => Date, extra: any = {}) => ({ workerId: "w1", handlers: HANDLERS, clock, leaseMs: 1000, ...extra });
const fresh = () => { const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); (ctx as any).setNow("2026-11-16T10:00:00-05:00"); let t = 1_000_000; const clock = () => new Date(t); return { ctx, clock, tick: (ms: number) => { t += ms; } }; };

describe("capture parsing", () => {
  it("reads the TAMID promise", () => {
    const p = parseCapture(TAMID, "2026-11-16T15:00:00Z");
    expect(p).toMatchObject({ kind: "commitment", who: "Yonathan", owedTo: "TAMID team", action: "three pitch angles", dueDate: "2026-11-19", effortMinutes: 90 });
  });
  it("handles 'X owes me' and falls back to a note", () => {
    expect(parseCapture("Remember for Jarvis: Dana owes me the deck by Friday.", "2026-11-16T15:00:00Z")).toMatchObject({ kind: "commitment", who: "Dana", owedTo: "Yonathan", action: "the deck", dueDate: "2026-11-20" });
    expect(parseCapture("Remember for Jarvis: pitch ideas run long on Tuesdays", "2026-11-16T15:00:00Z").kind).toBe("note");
  });
});

describe("capture through the Live Office", () => {
  it("one commitment, one helper, one decision; replay changes nothing", async () => {
    const { ctx, clock } = fresh();
    const r = captureToJarvis(ctx, { text: TAMID, sourceKind: "claude-chat", synthetic: true, via: "test" });
    expect(r.created).toBe(true);
    expect(r.deepLink).toMatch(/\/tasks\?tab=followups&focus=cmt_/);
    expect(count(ctx, "commitments", "action='three pitch angles'")).toBe(1);   // saved immediately
    await processQueue(ctx, base(ctx, clock));
    const jobs = all(ctx.db, "SELECT * FROM jobs ORDER BY depth");
    expect(jobs.map((j) => [j.kind, j.status, j.depth])).toEqual([["supervise_capture", "done", 0], ["capture_planner", "done", 1]]);
    expect(jobs[1].parent_id).toBe(jobs[0].id);
    expect(jobs[1].delegated_by).toMatch(/Handle:/);
    expect(JSON.parse(jobs[1].evidence_ids as string)).toEqual([r.id]);
    expect(jobs.every((j) => j.model_calls === 0 && j.synthetic === 1)).toBe(true);
    const decs = listDecisions(ctx).filter((d) => d.kind === "commitment_plan");
    expect(decs).toHaveLength(1);
    expect(decs[0].evidence.synthetic).toBe(true);
    expect(decs[0].title).toContain("TAMID team");
    // replay the same message, then again through another route with the same text
    const again = captureToJarvis(ctx, { text: TAMID, sourceKind: "claude-chat", synthetic: true, via: "test" });
    expect(again.duplicate).toBe(true); expect(again.id).toBe(r.id);
    await processQueue(ctx, base(ctx, clock));
    const snap = ["commitments", "captures", "jobs", "decisions", "tasks"].map((t) => count(ctx, t));
    expect(count(ctx, "decisions", "kind='commitment_plan'")).toBe(1);
    expect(snap[0]).toBe(2);  // the demo promise plus ours
    expect(count(ctx, "commitments", "action='three pitch angles'")).toBe(1);
    // the decision's recommendation works and Reserve creates blocks once
    const rec = reserve(ctx, decs[0].id, {});
    expect(rec.blocks.length).toBeGreaterThan(0);
    expect(reserve(ctx, decs[0].id, {}).already).toBe(true);
  });

  it("a worker that dies mid-job is replaced and nothing is duplicated", async () => {
    const { ctx, clock, tick } = fresh();
    captureToJarvis(ctx, { text: TAMID, sourceKind: "claude-chat", synthetic: true });
    // worker A crashes right after creating the task (before the decision)
    await processQueue(ctx, base(ctx, clock, { workerId: "A", crashAfterStep: "task" }));
    const mid = all(ctx.db, "SELECT kind,status,lease_owner FROM jobs ORDER BY depth");
    expect(mid[1]).toMatchObject({ kind: "capture_planner", status: "running", lease_owner: "A" });
    expect(count(ctx, "decisions", "kind='commitment_plan'")).toBe(0);
    // before the lease expires, nobody else can take it
    expect(claimNext(ctx, "B", 1000, clock)?.kind).not.toBe("capture_planner");
    tick(2000);   // lease expires
    expect(recoverStale(ctx, clock)).toBeGreaterThanOrEqual(0);
    await processQueue(ctx, base(ctx, clock, { workerId: "B" }));
    const end = all(ctx.db, "SELECT kind,status,attempts FROM jobs ORDER BY depth");
    expect(end.map((j) => j.status)).toEqual(["done", "done"]);
    expect(end[1].attempts).toBe(2);
    expect(count(ctx, "decisions", "kind='commitment_plan'")).toBe(1);
    expect(count(ctx, "commitments", "action='three pitch angles'")).toBe(1);
    expect(count(ctx, "tasks", "external_id LIKE 'capture-%'")).toBe(1);
    expect(all(ctx.db, "SELECT kind FROM job_events WHERE kind IN ('recovered','recovering')").length).toBeGreaterThan(0);
  });

  it("a crash before a step is recorded repeats the step safely (side effects are idempotent)", async () => {
    const { ctx, clock, tick } = fresh();
    captureToJarvis(ctx, { text: TAMID, sourceKind: "claude-chat" });
    await processQueue(ctx, base(ctx, clock, { workerId: "A", crashBeforeStep: "decision" }));
    tick(2000);
    await processQueue(ctx, base(ctx, clock, { workerId: "B" }));
    expect(count(ctx, "decisions", "kind='commitment_plan'")).toBe(1);
    expect(count(ctx, "commitments", "action='three pitch angles'")).toBe(1);
  });

  it("undo removes what the capture made and a replay does not bring it back", async () => {
    const { ctx, clock } = fresh();
    const r = captureToJarvis(ctx, { text: TAMID, sourceKind: "claude-chat" });
    await processQueue(ctx, base(ctx, clock));
    expect(undoCapture(ctx, r.id).already).toBe(false);
    expect(count(ctx, "commitments", "action='three pitch angles'")).toBe(0);
    expect(listDecisions(ctx).filter((d) => d.kind === "commitment_plan")).toHaveLength(0);
    const again = captureToJarvis(ctx, { text: TAMID, sourceKind: "claude-chat" });
    expect(again.duplicate).toBe(true); expect(again.message).toMatch(/undid/);
    expect(count(ctx, "commitments", "action='three pitch angles'")).toBe(0);
    expect(undoCapture(ctx, r.id).already).toBe(true);
  });

  it("delegation is bounded: depth, helpers per supervisor, inherited tools and budget, cancellation cascades", async () => {
    const { ctx, clock } = fresh();
    const root = enqueueJob(ctx, { dedupKey: "r", kind: "x", role: "Supervisor", area: "supervisor", title: "root", tools: ["read_tasks"], budget: { modelCalls: 2 } }, clock);
    const kid = enqueueJob(ctx, { dedupKey: "k", kind: "x", role: "Helper", area: "research", title: "kid", parentId: root.id, tools: ["read_tasks", "send_email"], budget: { modelCalls: 9 } }, clock);
    const k = getJob(ctx, kid.id)!;
    expect(k.tools).toEqual(["read_tasks"]);                // cannot hold a tool the parent lacks
    expect(k.budget.modelCalls).toBe(2);                    // cannot out-spend the parent
    const grand = enqueueJob(ctx, { dedupKey: "g", kind: "x", role: "H", area: "research", title: "g", parentId: kid.id }, clock);
    expect(() => enqueueJob(ctx, { dedupKey: "gg", kind: "x", role: "H", area: "research", title: "gg", parentId: grand.id }, clock)).toThrow(LimitError);
    for (let i = 0; i < LIMITS.maxChildrenPerParent - 1; i++) enqueueJob(ctx, { dedupKey: `c${i}`, kind: "x", role: "H", area: "research", title: "c", parentId: root.id }, clock);
    expect(() => enqueueJob(ctx, { dedupKey: "over", kind: "x", role: "H", area: "research", title: "over", parentId: root.id }, clock)).toThrow(/active helpers/);
    expect(enqueueJob(ctx, { dedupKey: "k", kind: "x", role: "Helper", area: "research", title: "kid", parentId: root.id }, clock).created).toBe(false);
    const n = cancelJob(ctx, root.id, clock);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(all(ctx.db, "SELECT status FROM jobs").every((j) => j.status === "cancelled")).toBe(true);
  });

  it("a running job stops at its next step after cancellation; idle desks make zero model calls", async () => {
    const { ctx, clock } = fresh();
    expect(officeState(ctx, clock).idle).toBe(true);
    const r = captureToJarvis(ctx, { text: TAMID, sourceKind: "claude-chat" });
    const sup = claimNext(ctx, "w", 5000, clock)!;
    cancelJob(ctx, sup.id, clock);                 // requested while running
    const out = await runClaimed(ctx, sup, base(ctx, clock));
    expect(out).toBe("cancelled");
    expect(count(ctx, "jobs", "kind='capture_planner'")).toBe(0);
    expect(officeState(ctx, clock).modelCalls).toBe(0);
    void r;
  });

  it("recall searches saved records only and says exactly what to attach when nothing matches", async () => {
    const { ctx, clock } = fresh();
    captureToJarvis(ctx, { text: TAMID, sourceKind: "claude-chat" });
    const hit = recallFromJarvis(ctx, "pitch angles");
    expect(hit.items.map((i) => i.type)).toEqual(expect.arrayContaining(["capture", "commitment"]));
    expect(hit.items[0].deepLink).toMatch(/^http:\/\/127\.0\.0\.1:3000\//);
    const miss = recallFromJarvis(ctx, "old study guide for chemistry");
    expect(miss.count).toBe(0);
    expect(miss.missing).toMatch(/share that conversation|attach/);
    expect(miss.scope).toMatch(/not a feed of your Claude chats/);
    void clock;
  });
});

import { tmpDataDir } from "./helpers";
import { closeDb } from "@/lib/db";
describe("authenticated MCP connector (real SDK client over Streamable HTTP, in process)", () => {
  async function connect(token: string | null, env: Record<string, string | undefined> = {}) {
    const { POST } = await import("@/app/mcp/route");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const f: typeof fetch = async (url, init) => { const h = new Headers(init?.headers); if (!h.has("host")) h.set("host", "127.0.0.1:3000"); return POST(new Request(String(url), { ...init, headers: h })); };
    const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3000/mcp"), { fetch: f, requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined });
    const client = new Client({ name: "smoke", version: "1" });
    await client.connect(transport);
    return client;
  }
  it("is off without a token, rejects wrong tokens, and saves, recalls and deduplicates with one", async () => {
    closeDb("demo"); closeDb("personal"); tmpDataDir();
    process.env.JARVIS_INAPP_RUNNER = "0"; delete process.env.JARVIS_MCP_TOKEN;
    await expect(connect("x".repeat(20))).rejects.toThrow();
    process.env.JARVIS_MCP_TOKEN = "correct-horse-battery-staple";
    await expect(connect("wrong-token-wrong-token")).rejects.toThrow();
    await expect(connect(null)).rejects.toThrow();
    const client = await connect("correct-horse-battery-staple");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["save_to_jarvis", "recall_from_jarvis"]));
    const call = async (name: string, args: any) => JSON.parse(((await client.callTool({ name, arguments: args })) as any).content[0].text);
    const saved = await call("save_to_jarvis", { text: TAMID, synthetic: true });
    expect(saved).toMatchObject({ created: true, kind: "commitment" });
    expect(saved.deepLink).toMatch(/focus=cmt_/);
    const replay = await call("save_to_jarvis", { text: TAMID, synthetic: true });
    expect(replay).toMatchObject({ created: false, duplicate: true, id: saved.id });
    const rec = await call("recall_from_jarvis", { query: "TAMID" });
    expect(rec.items.some((i: any) => i.type === "commitment")).toBe(true);
    const none = await call("recall_from_jarvis", { query: "unknown topic xyz" });
    expect(none.missing).toMatch(/attach|share/);
    const bad: any = await client.callTool({ name: "save_to_jarvis", arguments: { text: "x" } });
    expect(bad.isError).toBe(true);
    await client.close();
    delete process.env.JARVIS_MCP_TOKEN;
  });
});
