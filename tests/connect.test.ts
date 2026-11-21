import { describe, it, expect, afterAll } from "vitest";
import { tmpDataDir } from "./helpers";
import { closeDb, makeCtx, all } from "@/lib/db";
import { createToken, listTokens, revokeToken, rotateToken, verifyToken, startProbe, probeState, editProbe } from "@/lib/mcp-auth";

async function connect(token: string | null, host = "127.0.0.1:3000") {
  const { POST } = await import("@/app/mcp/route");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const f: typeof fetch = async (url, init) => { const h = new Headers(init?.headers); h.set("host", host); return POST(new Request(String(url), { ...init, headers: h })); };
  const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3000/mcp"), { fetch: f, requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined });
  const client = new Client({ name: "ordinary-claude-emulator", version: "1" }); await client.connect(transport);
  const call = async (name: string, args: any) => { const r: any = await client.callTool({ name, arguments: args }); return { isError: !!r.isError, json: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) }; };
  return { client, call };
}
const fresh = () => { closeDb("demo"); closeDb("personal"); tmpDataDir(); delete process.env.JARVIS_MCP_TOKEN; process.env.JARVIS_INAPP_RUNNER = "0"; return makeCtx("personal"); };
afterAll(() => { closeDb("demo"); closeDb("personal"); });

describe("connector tokens", () => {
  it("shows the secret once, stores only a hash, and never logs it", () => {
    const ctx = fresh(); const t = createToken(ctx, { label: "Claude on my Mac" });
    expect(t.token).toMatch(/^jvs_p_[A-Za-z0-9_-]{43}$/);
    const dump = JSON.stringify([all(ctx.db, "SELECT * FROM mcp_tokens"), all(ctx.db, "SELECT * FROM activity"), listTokens(ctx)]);
    expect(dump).not.toContain(t.token); expect(dump).not.toContain(t.token.slice(6, 30));
    expect(listTokens(ctx)[0]).toMatchObject({ label: "Claude on my Mac", scopes: ["read", "write"], status: "active", lastUsedAt: null });
    expect(verifyToken(t.token)).toMatchObject({ mode: "personal", scopes: ["read", "write"] });
    expect(verifyToken(t.token + "x")).toBeNull(); expect(verifyToken("jvs_p_" + "A".repeat(43))).toBeNull();
  });
  it("revoke stops it at once; rotate issues a new one and revokes the old; expiry is enforced", () => {
    const ctx = fresh(); const a = createToken(ctx, { label: "A" });
    const b = rotateToken(ctx, a.id); expect(verifyToken(a.token)).toBeNull(); expect(verifyToken(b.token)).not.toBeNull();
    revokeToken(ctx, b.id); expect(verifyToken(b.token)).toBeNull();
    const e = createToken(ctx, { label: "short", expiresInDays: 1 });
    ctx.db.exec(`UPDATE mcp_tokens SET expires_at='2020-01-01T00:00:00Z' WHERE id='${e.id}'`); expect(verifyToken(e.token)).toBeNull();
    expect(listTokens(ctx).find((t) => t.id === e.id)!.status).toBe("expired");
  });
});

describe("ordinary-Claude emulation over the authenticated route", () => {
  it("an unauthenticated caller reads nothing; the wrong host is refused", async () => {
    const ctx = fresh(); const t = createToken(ctx, { label: "x" });
    await expect(connect(null)).rejects.toThrow(); await expect(connect("jvs_p_" + "B".repeat(43))).rejects.toThrow();
    await expect(connect(t.token, "evil.example.com")).rejects.toThrow();
  });
  it("a read-only token can read but not write; a revoked token stops working mid-session", async () => {
    const ctx = fresh(); const ro = createToken(ctx, { label: "ro", scopes: ["read"] }); const rw = createToken(ctx, { label: "rw" });
    const w = await connect(rw.token); expect((await w.call("apply_project_update", { project: "Iceland trip", createIfMissing: { kind: "trip" }, eventId: "evt-aaaa-0001", changes: [{ op: "decide", key: "dates", text: "June 14 to 21" }] })).json.saved).toBe(true);
    const r = await connect(ro.token);
    expect((await r.call("get_project_context", { project: "Iceland trip" })).json.current[0].text).toBe("June 14 to 21");
    expect((await r.call("apply_project_update", { project: "Iceland trip", eventId: "evt-aaaa-0002", changes: [{ op: "fact", key: "x", text: "y" }] })).isError).toBe(true);
    expect((await r.call("save_to_jarvis", { text: "Remember for Jarvis: should not save" })).isError).toBe(true);
    revokeToken(ctx, ro.id); await expect(r.call("get_project_context", {})).rejects.toThrow();
  });
  it("the golden Iceland conversation survives a new session, a replay and a Jarvis-side edit", async () => {
    const ctx = fresh(); const t = createToken(ctx, { label: "Claude" });
    let s = await connect(t.token);
    const first = (await s.call("apply_project_update", { project: "Iceland trip", createIfMissing: { name: "Iceland trip", kind: "trip" }, eventId: "evt-golden-01", dedupKey: "chat-1:msg-4", changes: [{ op: "option", key: "lodging", text: "Reykjavik apartment" }, { op: "option", key: "lodging", text: "Vik guesthouse" }, { op: "decide", key: "dates", text: "June 14 to 21" }] })).json;
    expect(first).toMatchObject({ saved: true, revision: 1, origin: "claude" }); expect(first.workspace.mode).toBe("personal");
    expect((await s.call("apply_project_update", { project: "Iceland trip", eventId: "evt-golden-02", dedupKey: "chat-1:msg-4", changes: [{ op: "fact", key: "z", text: "z" }] })).json).toMatchObject({ replay: true, revision: 1 });
    await s.client.close(); s = await connect(t.token);                                           // a brand new Claude conversation
    const ctxNow = (await s.call("get_project_context", { project: "Iceland trip" })).json;
    expect(ctxNow.current.map((f: any) => f.text)).toEqual(["June 14 to 21"]); expect(ctxNow.options.map((f: any) => f.text).sort()).toEqual(["Reykjavik apartment", "Vik guesthouse"]);
    const { projectContext, editFact } = await import("@/lib/projects");
    editFact(ctx, projectContext(ctx, "Iceland trip").current[0].id, "June 15 to 22", 1);          // you fix the date in Jarvis
    const stale = (await s.call("apply_project_update", { project: "Iceland trip", expectedRevision: 1, eventId: "evt-golden-03", changes: [{ op: "decide", key: "dates", text: "June 20 to 27" }] })).json;
    expect(stale).toMatchObject({ saved: false, conflict: true }); expect(stale.current.current[0].text).toBe("June 15 to 22");
    expect((await s.call("get_project_context", { project: "Iceland trip" })).json.answer).toMatch(/June 15 to 22/);
    expect(JSON.stringify(all(ctx.db, "SELECT * FROM activity"))).not.toContain(t.token);
  });
  it("the two-way connection check completes only when Claude writes, Jarvis edits, and Claude reads the edit back", async () => {
    const ctx = fresh(); const t = createToken(ctx, { label: "Claude" }); const s = await connect(t.token);
    const p = startProbe(ctx); expect(p.complete).toBe(false);
    await s.call("recall_from_jarvis", { query: p.code }); expect(probeState(ctx)!.read).toBeNull();       // nothing to read yet
    expect(() => editProbe(ctx, p.id)).toThrow(/step 1/);
    const saved = (await s.call("save_to_jarvis", { text: `Remember for Jarvis: connection check ${p.code}` })).json; expect(saved.created).toBe(true);
    expect(probeState(ctx)!.written).not.toBeNull();
    const early = (await s.call("recall_from_jarvis", { query: p.code })).json; expect(probeState(ctx)!.read).toBeNull(); expect(early.items[0].detail).not.toContain(p.say.read);
    const e = editProbe(ctx, p.id); expect(e.edited!.marker).toMatch(/-\d\d$/);
    const back = (await s.call("recall_from_jarvis", { query: `connection check ${p.code}` })).json;
    expect(back.items[0].type).toBe("connection_check"); expect(back.items[0].detail).toContain(e.edited!.marker);
    expect(probeState(ctx)).toMatchObject({ complete: true, read: { sawMarker: true } });
  });
});

import { loadWorkspaceFixtures } from "@/lib/workspace-fixtures";
import { handleUtterance } from "@/lib/study-guide";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
describe("the same work from ordinary Claude (official MCP client over the authenticated route, simulated Claude)", () => {
  const work = async (ctx: any) => { let t = 1_000_000; await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(t), leaseMs: 1000 }); };
  const PITCH = "Pick up where we left off on the pitch and draft my follow-up.";
  it("submit from Claude, return a receipt at once, retrieve the finished result in a fresh chat, with links that open the same records", async () => {
    const ctx = fresh(); loadWorkspaceFixtures(ctx); const t = createToken(ctx, { label: "Claude" });
    const s = await connect(t.token);
    const rc = (await s.call("submit_goal", { text: PITCH, dedupKey: "chat-9:msg-1" })).json;
    expect(rc).toMatchObject({ status: "queued", ready: false, duplicate: false }); expect(rc.links.result).toMatch(/^\/results\/res_/);
    expect((await s.call("get_goal", { requestId: rc.requestId })).json).toMatchObject({ ready: false, plain: expect.stringMatching(/Waiting|Working/) });   // the receipt returned before any work ran
    expect((await s.call("submit_goal", { text: PITCH, dedupKey: "chat-9:msg-1" })).json).toMatchObject({ duplicate: true, requestId: rc.requestId });
    await work(ctx);
    await s.client.close(); const fresh2 = await connect(t.token);                                                    // a brand new Claude chat
    const res = (await fresh2.call("get_result", { id: rc.resultId })).json;
    expect(res).toMatchObject({ kind: "draft", version: 1, requestRevision: 1, ready: true }); expect(res.body).toMatch(/Wednesday, [A-Z][a-z]{2} \d{1,2}/); expect(res.body).not.toMatch(/Confirming Friday|50,000/);
    expect(res.sources.find((x: any) => x.role === "confirms the date")).toMatchObject({ stillAvailable: true, url: expect.stringMatching(/\/evidence\/ev_/) });
    expect(res.flags.map((f: any) => f.kind)).toEqual(expect.arrayContaining(["older_proposal", "unsupported_figure"]));
    const hits = (await fresh2.call("search_evidence", { query: "Confirming Wednesday sponsor follow-up" })).json.hits; expect(hits.map((h: any) => h.title)).toContain("Re: Lantern Club sponsor pitch follow-up"); expect(JSON.stringify(hits)).not.toMatch(/Sam Ortiz|50,000/);
  });
  it("start by voice, close the tab, then change it from Claude: one request, one current draft, the instruction applied, a late old result refused", async () => {
    const ctx = fresh(); loadWorkspaceFixtures(ctx); const t = createToken(ctx, { label: "Claude" });
    const voice: any = handleUtterance(ctx, { text: PITCH, via: "voice" }); await work(ctx);                           // simulated microphone: the page is then closed
    const s = await connect(t.token);
    const listed = (await s.call("get_goal", {})).json.goals; expect(listed).toHaveLength(1); const rid = listed[0].requestId; expect(rid).toBe(voice.reply.data.requestId);
    const rev = (await s.call("revise_goal", { requestId: rid, instruction: "Use the Wednesday decision and keep it to three sentences.", dedupKey: "m-2" })).json; expect(rev.revision).toBe(2);
    expect((await s.call("revise_goal", { requestId: rid, instruction: "Use the Wednesday decision and keep it to three sentences.", dedupKey: "m-2" })).json.replay).toBe(true);
    await work(ctx);
    const res = (await s.call("get_result", { id: rid })).json;
    expect(res).toMatchObject({ version: 2, requestRevision: 2, applied: ["Keep it to 3 sentences", "Use the wednesday decision"] });
    expect(all(ctx.db, "SELECT COUNT(*) n FROM results")[0].n).toBe(1);
    const { saveResult } = await import("@/lib/assistant");
    expect(saveResult(ctx, { requestId: rid, revision: 1, title: "old", body: "OLD", summary: "o", sources: [], flags: [], unavailable: [], kind: "draft", projectId: null })).toMatchObject({ discarded: true });
    expect((await s.call("get_result", { id: rid })).json.body).not.toContain("OLD");
    const tools = (await s.client.listTools()).tools.map((x) => x.name); expect(tools.some((n) => /send|email|post|publish/.test(n))).toBe(false);   // nothing can be sent
  });
  it("a read-only token can retrieve results but cannot submit, revise, cancel or share; share_excerpt becomes a citable, forgettable source", async () => {
    const ctx = fresh(); loadWorkspaceFixtures(ctx); const ro = createToken(ctx, { label: "ro", scopes: ["read"] }); const rw = createToken(ctx, { label: "rw" });
    const r = await connect(ro.token); expect((await r.call("submit_goal", { text: PITCH })).isError).toBe(true); expect((await r.call("share_excerpt", { excerpt: "A".repeat(20), origin: "Chat" })).isError).toBe(true);
    expect((await r.call("get_result", {})).isError).toBe(false);
    const w = await connect(rw.token); const sh = (await w.call("share_excerpt", { excerpt: "We decided the pilot checkpoint is Thursday because the venue is free then.", origin: "Claude chat 'Pilot planning', Nov 10", project: "Lantern Club", dedupKey: "x1" })).json;
    expect(sh).toMatchObject({ saved: true }); expect((await w.call("share_excerpt", { excerpt: "We decided the pilot checkpoint is Thursday because the venue is free then.", origin: "Claude chat 'Pilot planning', Nov 10", project: "Lantern Club", dedupKey: "x1" })).json.unchanged).toBe(true);
    expect((await w.call("search_evidence", { query: "pilot checkpoint venue" })).json.hits[0].source).toMatch(/Shared from Claude/);
  });
});
