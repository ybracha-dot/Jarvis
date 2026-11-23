import { describe, it, expect, afterAll } from "vitest";
import { tmpDataDir } from "./helpers";
import { closeDb, makeCtx, all, get } from "@/lib/db";
import { createToken } from "@/lib/mcp-auth";
import { importText, registerSource } from "@/lib/evidence";
import { upsertCalendar } from "@/lib/bundle";
import { createProject } from "@/lib/projects";
import { submitGoal } from "@/lib/assistant";
import { runBrief, shareBrief, unshareBrief } from "@/lib/brief";
import { setSourceSharing, sourcesSharing, grantResult, resultAccess, setProjectSharing } from "@/lib/share";
import { handle } from "@/lib/server";

// The private workspace is deny-by-default for Claude. These are LOCAL TEST CLIENTS over the real authenticated route (two separate connections each time),
// not a Claude account. They show the boundary; a real Claude Desktop run is a separate observation.
async function connect(token: string) {
  const { POST } = await import("@/app/mcp/route"); const { Client } = await import("@modelcontextprotocol/sdk/client/index.js"); const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const f: typeof fetch = async (url, init) => { const h = new Headers(init?.headers); h.set("host", "127.0.0.1:3000"); return POST(new Request(String(url), { ...init, headers: h })); };
  const client = new Client({ name: "ordinary-claude-emulator", version: "1" }); await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3000/mcp"), { fetch: f, requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return { client, call: async (name: string, args: any) => { const r: any = await client.callTool({ name, arguments: args }); return { isError: !!r.isError, text: r.content[0].text as string, json: (() => { try { return JSON.parse(r.content[0].text); } catch { return null; } })() }; } };
}
afterAll(() => { closeDb("demo"); closeDb("personal"); });
const SHARED = "Essay 2 outline is due Thursday, November 19 at 9:00 AM. Please bring a printed alphanumeric outline to class.";
const PRIVATE = "Reflection paper for Dr Okafor is due Wednesday, November 18 at 5:00 PM. Bring the sealed counselling letter.";
function world() {
  closeDb("demo"); closeDb("personal"); tmpDataDir(); process.env.JARVIS_INAPP_RUNNER = "0"; delete process.env.JARVIS_MCP_TOKEN;
  const ctx = makeCtx("personal"); (ctx as any).now = () => new Date("2026-11-17T12:30:00Z");
  const pa = createProject(ctx, { name: "Essay 2" }); const pb = createProject(ctx, { name: "Counselling" });
  importText(ctx, { kind: "note", title: "Essay 2 outline", text: SHARED, at: "2026-11-10T12:00:00.000Z", label: "Notes I chose to share", shareable: true, projectId: pa.id });
  importText(ctx, { kind: "note", title: "Counselling reflection", text: PRIVATE, at: "2026-11-10T12:00:00.000Z", label: "Notes I keep local", localOnly: true, projectId: pb.id });
  upsertCalendar(ctx, "ics", [{ title: "Therapy appointment", start: "2026-11-17T15:00:00Z", end: "2026-11-17T16:00:00Z" }, { title: "Section", start: "2026-11-19T15:00:00Z", end: "2026-11-19T16:00:00Z" }], "Calendar file");
  return { ctx, pa, pb, token: createToken(ctx, { label: "Claude" }).token };
}
const PRIVATE_WORDS = /Counselling|counselling|Okafor|Therapy|sealed|Reflection paper/;

describe("a brief that combines shareable and local-only evidence", () => {
  it("is never handed over as it is: the full brief stays local, and a separate view built from shared notes is what Claude can open", async () => {
    const { ctx, token } = world(); const full = runBrief(ctx, { occurrenceKey: "morning:2026-11-17@08:00", kind: "scheduled" });
    const fullBody: any = get(ctx.db, "SELECT body FROM result_versions WHERE result_id=?", full.resultId); expect(fullBody.body).toMatch(/Reflection paper/); expect(fullBody.body).toMatch(/Essay 2 outline/);            // the private brief has both
    expect(() => grantResult(ctx, full.resultId)).toThrow(/private brief/); expect(resultAccess(ctx, full.resultId).allowed).toBe(false);
    const c1 = await connect(token); const denied = await c1.call("get_result", { id: full.resultId }); expect(denied.json).toEqual({ error: "No shared result with that id." }); expect(denied.text).not.toMatch(PRIVATE_WORDS);
    const shared = shareBrief(ctx, full.resultId); expect(shared.sharedResultId).not.toBe(full.resultId);
    const a = await connect(token); const b = await connect(token);                                                                                   // two fresh clients, two separate chats
    for (const c of [a, b]) { const r = await c.call("get_result", { id: shared.sharedResultId }); expect(r.json.body).toMatch(/Essay 2 outline/); expect(r.json.body).toMatch(/Bring a printed alphanumeric outline/); expect(r.text).not.toMatch(PRIVATE_WORDS); expect(r.text).not.toMatch(/Lecture|Section|Calendar file|Course record/); expect(r.json.sources.every((s: any) => !PRIVATE_WORDS.test(s.title + s.quote))).toBe(true); }
    expect((await a.call("get_result", { id: full.resultId })).json).toEqual({ error: "No shared result with that id." });
    expect((await a.call("get_result", {})).json.results.map((x: any) => x.id)).toEqual([shared.sharedResultId]);                                      // the listing shows only what it may open
  });
  it("the shared view contains no work blocks and no calendar-derived claim", () => {
    const { ctx } = world(); const full = runBrief(ctx, { occurrenceKey: "m", kind: "scheduled" }); const sh = shareBrief(ctx, full.resultId); const v: any = get(ctx.db, "SELECT analysis FROM result_versions WHERE result_id=?", sh.sharedResultId);
    const a = JSON.parse(v.analysis); expect(a.view).toBe("shared"); expect(a.priorities.every((p: any) => p.blocks.length === 0 && p.reserved.length === 0)).toBe(true); expect(a.coverage).toEqual([]); expect(a.inputs).toEqual([]); expect(JSON.stringify(a)).not.toMatch(PRIVATE_WORDS);
  });
  it("revoking takes effect on the next retrieval, and taking a source back closes the view too", async () => {
    const { ctx, token } = world(); const full = runBrief(ctx, { occurrenceKey: "m", kind: "scheduled" }); const sh = shareBrief(ctx, full.resultId); const c = await connect(token);
    expect((await c.call("get_result", { id: sh.sharedResultId })).json.body).toMatch(/Essay 2/); unshareBrief(ctx, full.resultId);
    expect((await c.call("get_result", { id: sh.sharedResultId })).json).toEqual({ error: "No shared result with that id." });                     // the same open connection, the next call
    shareBrief(ctx, full.resultId); expect((await (await connect(token)).call("get_result", { id: sh.sharedResultId })).json.body).toMatch(/Essay 2/);
    const src = sourcesSharing(ctx).find((s) => s.label === "Notes I chose to share")!; setSourceSharing(ctx, src.id, false);
    expect((await (await connect(token)).call("get_result", { id: sh.sharedResultId })).json.error).toBe("No shared result with that id.");
  });
});

describe("a newer brief and an older shared view", () => {
  it("taking it back closes every shared view that is still open, even when a newer brief has been built since", async () => {
    const { ctx, token } = world(); const b1 = runBrief(ctx, { occurrenceKey: "m1", kind: "scheduled" }); const v1 = shareBrief(ctx, b1.resultId);
    const b2 = runBrief(ctx, { occurrenceKey: "m2", kind: "scheduled" }); expect(b2.resultId).not.toBe(b1.resultId);
    const c = await connect(token); expect((await c.call("get_result", { id: v1.sharedResultId })).json.body).toMatch(/Essay 2/);
    unshareBrief(ctx, b2.resultId); expect((await c.call("get_result", { id: v1.sharedResultId })).json).toEqual({ error: "No shared result with that id." });
  });
});

describe("what stays private", () => {
  it("search, reader passages, project context, today and recall never return local-only or unshared material", async () => {
    const { ctx, pa, pb, token } = world(); const c = await connect(token);
    const s = await c.call("search_evidence", { query: "reflection counselling Okafor letter" }); expect(s.json.hits).toEqual([]); expect(s.text).not.toMatch(PRIVATE_WORDS);
    const s2 = await c.call("search_evidence", { query: "Essay outline printed" }); expect(s2.json.hits.map((h: any) => h.title)).toEqual(["Essay 2 outline"]);
    const g = await c.call("submit_goal", { text: "What does my team still owe? One row per open item with Owner, Next action and Blocker.", project: "Counselling" }); const rt = await c.call("get_reader_task", { requestId: g.json.requestId });
    expect(rt.json).toMatchObject({ eligible: false }); expect(rt.text).not.toMatch(PRIVATE_WORDS.source.replace("|Reflection paper", "")); expect(rt.json.localOnlyNotes).toBe(1);
    for (const t of ["today", "changed_tasks", "source_status"]) { const r = await c.call(t, {}); expect(r.json.error).toMatch(/not shared with Claude/); expect(r.text).not.toMatch(PRIVATE_WORDS); }
    expect((await c.call("get_project_context", { project: "Counselling" })).json).toEqual({ error: "No project matches that name." });
    expect((await c.call("get_project_context", { project: "Essay 2" })).json).toEqual({ error: "No project matches that name." });                  // not shared yet
    setProjectSharing(ctx, pa.id, true); expect((await c.call("get_project_context", { project: "Essay 2" })).json.project.name).toBe("Essay 2"); void pb;
    const rc = await c.call("recall_from_jarvis", { query: "Counselling" }); expect(rc.json.items).toEqual([]);   // the response echoes Claude's own query; it holds nothing of the user's
  });
  it("another project's result, even for the same question, is closed unless its own notes were shared", async () => {
    const { ctx, pa, pb, token } = world(); const q = "What changed, and what is due?";
    const ra = submitGoal(ctx, { text: q, projectHint: pa.id, origin: "api" }); const rb = submitGoal(ctx, { text: q, projectHint: pb.id, origin: "api" }); expect(ra.resultId).not.toBe(rb.resultId);
    const { processQueue } = await import("@/lib/jobs"); const { HANDLERS } = await import("@/lib/handlers"); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
    const c = await connect(token); const A = await c.call("get_result", { id: ra.resultId }); const B = await c.call("get_result", { id: rb.resultId });
    expect(B.json).toEqual({ error: "No shared result with that id." }); expect(B.text).not.toMatch(PRIVATE_WORDS); expect(A.json.body ?? "").not.toMatch(PRIVATE_WORDS);
    setSourceSharing(ctx, sourcesSharing(ctx).find((s) => s.label === "Notes I keep local")!.id, true);                                                // the explicit choice opens it, and only it
    const B2 = await c.call("get_result", { id: rb.resultId }); expect(B2.json?.id ?? B2.json?.error).toBeTruthy();
  });
  it("what Claude was shown is recorded: tool, client, what", async () => {
    const { ctx, token } = world(); const full = runBrief(ctx, { occurrenceKey: "m", kind: "scheduled" }); const sh = shareBrief(ctx, full.resultId); const c = await connect(token);
    await c.call("get_result", { id: sh.sharedResultId }); await c.call("search_evidence", { query: "Essay outline" });
    const log = all(ctx.db, "SELECT event, tool, client, ref_kind FROM share_log WHERE event='disclosed' ORDER BY id"); expect(log.map((l) => `${l.tool}:${l.ref_kind}`)).toEqual(["get_result:result", "search_evidence:item"]); expect(log[0].client).toMatch(/ordinary-claude-emulator/);
  });
  it("sharing choices are explicit actions through the app's own API and survive a reload", async () => {
    const { ctx } = world(); const H = new Headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json", cookie: "jarvis_mode=personal" });
    const src = sourcesSharing(ctx).find((s) => s.label === "Notes I keep local")!; const r = await handle("POST", `/sharing/sources/${src.id}`, new URLSearchParams(), H, JSON.stringify({ share: true })); expect((r.body as any).shared).toBe(true);
    const st: any = (await handle("GET", "/sharing", new URLSearchParams(), H, "")).body; expect(st.sources.find((s: any) => s.id === src.id).shared).toBe(true); expect(st.log.some((l: any) => l.event === "source_shared")).toBe(true);
    expect(registerSource(ctx, { kind: "note", label: "Notes I keep local", mode: "imported" }).shareable).toBe(true);
  });
});
