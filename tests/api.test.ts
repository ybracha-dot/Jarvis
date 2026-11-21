import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpDataDir, memCtx, count } from "./helpers";
import { handle } from "@/lib/server";
import { closeDb } from "@/lib/db";
import { Router, Transport } from "@/lib/router";
import { runAgent, TOOLS, ROLE_TOOLS } from "@/lib/agent";
import { seedDemo, replay } from "@/lib/demo";
import { setSetting } from "@/lib/db";

const H = (extra: Record<string, string> = {}) => new Headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json", ...extra });
const call = async (method: string, p: string, body?: unknown, headers = H()) => {
  const [pathname, q] = p.split("?");
  const r = await handle(method, pathname, new URLSearchParams(q ?? ""), headers, body === undefined ? "" : JSON.stringify(body));
  return { status: r.status ?? 200, body: r.body as any, headers: r.headers };
};
beforeEach(() => { closeDb("demo"); closeDb("personal"); tmpDataDir(); });

describe("HTTP boundary", () => {
  it("rejects foreign hosts, foreign origins, non-JSON bodies and malformed payloads", async () => {
    expect((await call("GET", "/session", undefined, H({ host: "evil.example" }))).status).toBe(403);
    expect((await call("POST", "/demo/replay", { name: "bulletin" }, H({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await call("POST", "/demo/replay", { name: "bulletin" }, H({ "sec-fetch-site": "cross-site", origin: "" }))).status).toBe(403);
    const r = await handle("POST", "/demo/replay", new URLSearchParams(), H({ "content-type": "text/plain" }), "x");
    expect(r.status).toBe(415);
    expect((await call("POST", "/demo/replay", { name: "nope" })).status).toBe(422);
    const bad = await handle("POST", "/demo/replay", new URLSearchParams(), H(), "{bad");
    expect(bad.status).toBe(400);
    expect((await call("GET", "/nothing")).status).toBe(404);
    expect((await call("POST", "/decisions/xyz/reserve", {})).status).toBe(404);
  });

  it("first open seeds the example week; replay is idempotent through the API", async () => {
    const t0 = await call("GET", "/today");
    expect(t0.status).toBe(200); expect(t0.body.decisionsPending).toBe(0);
    await call("POST", "/demo/replay", { name: "bulletin" });
    const a = (await call("GET", "/decisions")).body.decisions;
    await call("POST", "/demo/replay", { name: "bulletin" });
    const b = (await call("GET", "/decisions")).body.decisions;
    expect(a).toHaveLength(1); expect(b).toHaveLength(1);
    const r1 = await call("POST", `/decisions/${a[0].id}/reserve`, {});
    const r2 = await call("POST", `/decisions/${a[0].id}/reserve`, {});
    expect(r1.body.blocks.length).toBe(r2.body.blocks.length);
    expect(r2.body.already).toBe(true);
  });

  it("a stale chunk list returns 409 with a fresh recommendation", async () => {
    await call("GET", "/today");
    await call("POST", "/demo/replay", { name: "bulletin" });
    const d = (await call("GET", "/decisions")).body.decisions[0];
    const det = (await call("GET", `/decisions/${d.id}`)).body;
    const chunks = det.recommendation.best.chunks;
    // book the first chunk with a calendar import
    await call("POST", "/import/preview", { filename: "x.ics", content: `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:z1\nSUMMARY:Surprise\nDTSTART:${chunks[0].start.replace(/[-:]/g, "").slice(0, 15)}Z\nDTEND:${chunks[0].end.replace(/[-:]/g, "").slice(0, 15)}Z\nEND:VEVENT\nEND:VCALENDAR` }).then(async (p) => call("POST", "/import/commit", { token: p.body.token }));
    const res = await call("POST", `/decisions/${d.id}/reserve`, { chunks: chunks.map((c: any) => ({ start: c.start, end: c.end })) });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
    expect(res.body.fresh.best.chunks.length).toBeGreaterThan(0);
  });

  it("example and private workspaces use separate files; reset and erase cannot cross over", async () => {
    const dir = process.env.JARVIS_DATA_DIR!;
    await call("GET", "/today");
    const priv = H({ cookie: "jarvis_mode=personal" });
    const s = await call("GET", "/session", undefined, priv);
    expect(s.body.mode).toBe("personal"); expect(s.body.seeded).toBe(false);
    expect((await call("GET", "/tasks", undefined, priv)).body.tasks).toHaveLength(0);
    expect((await call("POST", "/demo/replay", { name: "bulletin" }, undefined as any)).status).toBe(200);
    expect((await call("POST", "/demo/replay", { name: "bulletin" }, priv)).status).toBe(403);
    // personal data: add a note, then reset the demo. The note must survive.
    await call("POST", "/memory/notes", { kind: "inbox", title: "Mine", body: "private" }, priv);
    expect((await call("POST", "/demo/reset", { confirm: "RESET DEMO" })).status).toBe(200);
    expect((await call("GET", "/memory/notes", undefined, priv)).body.notes.map((n: any) => n.title)).toEqual(["Mine"]);
    expect((await call("POST", "/demo/reset", { confirm: "RESET DEMO" }, priv)).status).toBe(403);
    expect((await call("POST", "/erase", { confirm: "ERASE PERSONAL" })).status).toBe(403);
    expect((await call("POST", "/erase", { confirm: "nope" }, priv)).status).toBe(422);
    expect((await call("POST", "/erase", { confirm: "ERASE PERSONAL" }, priv)).status).toBe(200);
    expect((await call("GET", "/memory/notes", undefined, priv)).body.notes).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "demo", "jarvis.db"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "personal", "jarvis.db"))).toBe(true);
    expect((await call("GET", "/tasks")).body.tasks.length).toBeGreaterThan(0);
    // mode cookie
    const sw = await call("POST", "/mode", { mode: "personal" });
    expect(sw.headers!["set-cookie"]).toMatch(/jarvis_mode=personal/); expect(sw.headers!["set-cookie"]).toMatch(/HttpOnly/); expect(sw.headers!["set-cookie"]).toMatch(/SameSite=Strict/);
  });

  it("export omits private notes; settings refuse unsafe values; schedules default off for private", async () => {
    await call("GET", "/today");
    await call("POST", "/reflect/save", { takeaway: "one takeaway I chose" });
    const exp = (await call("GET", "/export")).body;
    expect(JSON.stringify(exp)).not.toContain("one takeaway I chose");
    expect((await call("POST", "/settings", { dailyBudgetUsd: -1 })).status).toBe(422);
    expect((await call("POST", "/settings", { checkTimes: ["8am", "4pm"] })).status).toBe(422);
    const priv = H({ cookie: "jarvis_mode=personal" });
    expect((await call("GET", "/settings", undefined, priv)).body.schedulerEnabled).toBe(false);
    expect((await call("POST", "/connections/claude-test", {})).body.ok).toBe(false);   // no key, no budget: no paid call
  });

  it("the command matcher is labeled and a forget needs a confirmation", async () => {
    await call("GET", "/today");
    const r = await call("POST", "/command", { text: "forget Leaning Sydney" });
    expect(r.body.mode).toMatch(/no model/);
    expect(r.body.confirm.action).toBe("delete-note");
    expect((await call("GET", "/memory/search?q=sydney")).body.results).toHaveLength(1);
  });
});

describe("agent adapter and MCP tools", () => {
  const scripted = (steps: string[]) => { let i = 0; const calls: any[] = []; const t: Transport = async (r) => { calls.push(r); return { text: steps[Math.min(i++, steps.length - 1)], usage: { input: 10, output: 5 } }; }; return { t, calls }; };
  it("the Blackboard monitor only has scoped read tools; disallowed and invalid calls are refused; turns are bounded", async () => {
    expect(ROLE_TOOLS.blackboard_monitor.some((n) => TOOLS.find((t) => t.name === n)!.mutating)).toBe(false);
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); setSetting(ctx.db, "daily_budget_usd", 5);
    const s = scripted([JSON.stringify({ tool: "propose_decision", args: { title: "Hack", summary: "no" } }), JSON.stringify({ tool: "get_evidence", args: { decisionId: 5 } }), JSON.stringify({ tool: "source_status", args: {} }), JSON.stringify({ final: "Blackboard verified Mon 8:00 (fixture). Email too." })]);
    const out = await runAgent(ctx, new Router(ctx, s.t), { role: "blackboard_monitor", task: "What is fresh?" });
    expect(out.final).toMatch(/Blackboard/);
    expect(out.calls).toEqual([{ tool: "propose_decision", ok: false }, { tool: "get_evidence", ok: false }, { tool: "source_status", ok: true }]);
    expect(count(ctx, "decisions", "kind='agent_proposal'")).toBe(0);
    const loop = scripted([JSON.stringify({ tool: "source_status", args: {} })]);
    const o2 = await runAgent(ctx, new Router(ctx, loop.t), { role: "blackboard_monitor", task: "loop", maxTurns: 3 });
    expect(o2.stopped).toBe("Turn limit reached"); expect(loop.calls).toHaveLength(3);
    const bad = scripted(["not json"]);
    expect((await runAgent(ctx, new Router(ctx, bad.t), { role: "blackboard_monitor", task: "x" })).stopped).toMatch(/not valid/);
  });
  it("propose_decision is bounded to three per day and never acts", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx);
    const tool = TOOLS.find((t) => t.name === "propose_decision")!;
    const r = [1, 2, 3, 4].map((i) => tool.run(ctx, { title: `Idea ${i}`, summary: `Summary ${i}` } as never) as any);
    expect(r.filter((x) => x.created).length).toBe(3);
    expect(r[3].error).toMatch(/limit/);
    expect(tool.schema.safeParse({ title: "x", summary: "y" }).success).toBe(false);
  });
  it("the MCP server answers over stdio to a real SDK client", async () => {
    const dir = tmpDataDir();
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const transport = new StdioClientTransport({ command: "npx", args: ["tsx", path.resolve("scripts/mcp-server.ts")], env: { ...process.env as any, JARVIS_DATA_DIR: dir } });
    const client = new Client({ name: "smoke", version: "1" });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["apply_project_update", "cancel_goal", "changed_tasks", "get_evidence", "get_goal", "get_project_context", "get_result", "propose_decision", "recall_from_jarvis", "resume_goal", "revise_goal", "save_to_jarvis", "search_evidence", "share_excerpt", "source_status", "submit_goal", "today"]);
      const res: any = await client.callTool({ name: "today", arguments: {} });
      expect(JSON.parse(res.content[0].text).timeline).toBeDefined();
      const bad: any = await client.callTool({ name: "get_evidence", arguments: { decisionId: "nope" } });
      expect(JSON.parse(bad.content[0].text).error).toBe("not found");
    } finally { await client.close(); }
  }, 60000);
});
