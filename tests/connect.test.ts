import { describe, it, expect, afterAll } from "vitest";
import { tmpDataDir } from "./helpers";
import { closeDb, makeCtx, all } from "@/lib/db";
import { createToken, listTokens, revokeToken, rotateToken, verifyToken, startProbe, probeState, editProbe } from "@/lib/mcp-auth";

async function connect(token: string | null, host = "127.0.0.1:3000", clientName = "ordinary-claude-emulator") {
  const { POST } = await import("@/app/mcp/route");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const f: typeof fetch = async (url, init) => { const h = new Headers(init?.headers); h.set("host", host); return POST(new Request(String(url), { ...init, headers: h })); };
  const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3000/mcp"), { fetch: f, requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined });
  const client = new Client({ name: clientName, version: "1" }); await client.connect(transport);
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
    const w = await connect(rw.token); expect((await w.call("apply_project_update", { project: "Maple Court project", createIfMissing: { kind: "trip" }, eventId: "evt-aaaa-0001", changes: [{ op: "decide", key: "dates", text: "June 14 to 21" }] })).json.saved).toBe(true);
    const r = await connect(ro.token);
    expect((await r.call("get_project_context", { project: "Maple Court project" })).json.current[0].text).toBe("June 14 to 21");
    expect((await r.call("apply_project_update", { project: "Maple Court project", eventId: "evt-aaaa-0002", changes: [{ op: "fact", key: "x", text: "y" }] })).isError).toBe(true);
    expect((await r.call("save_to_jarvis", { text: "Remember for Jarvis: should not save" })).isError).toBe(true);
    revokeToken(ctx, ro.id); await expect(r.call("get_project_context", {})).rejects.toThrow();
  });
  it("the golden Maple conversation survives a new session, a replay and a Jarvis-side edit", async () => {
    const ctx = fresh(); const t = createToken(ctx, { label: "Claude" });
    let s = await connect(t.token);
    const first = (await s.call("apply_project_update", { project: "Maple Court project", createIfMissing: { name: "Maple Court project", kind: "trip" }, eventId: "evt-golden-01", dedupKey: "chat-1:msg-4", changes: [{ op: "option", key: "vendor", text: "Oak contractor" }, { op: "option", key: "vendor", text: "Pine contractor" }, { op: "decide", key: "dates", text: "June 14 to 21" }] })).json;
    expect(first).toMatchObject({ saved: true, revision: 1, origin: "claude" }); expect(first.workspace.mode).toBe("personal");
    expect((await s.call("apply_project_update", { project: "Maple Court project", eventId: "evt-golden-02", dedupKey: "chat-1:msg-4", changes: [{ op: "fact", key: "z", text: "z" }] })).json).toMatchObject({ replay: true, revision: 1 });
    await s.client.close(); s = await connect(t.token);                                           // a brand new Claude conversation
    const ctxNow = (await s.call("get_project_context", { project: "Maple Court project" })).json;
    expect(ctxNow.current.map((f: any) => f.text)).toEqual(["June 14 to 21"]); expect(ctxNow.options.map((f: any) => f.text).sort()).toEqual(["Oak contractor", "Pine contractor"]);
    const { projectContext, editFact } = await import("@/lib/projects");
    editFact(ctx, projectContext(ctx, "Maple Court project").current[0].id, "June 15 to 22", 1);          // you fix the date in Jarvis
    const stale = (await s.call("apply_project_update", { project: "Maple Court project", expectedRevision: 1, eventId: "evt-golden-03", changes: [{ op: "decide", key: "dates", text: "June 20 to 27" }] })).json;
    expect(stale).toMatchObject({ saved: false, conflict: true }); expect(stale.current.current[0].text).toBe("June 15 to 22");
    expect((await s.call("get_project_context", { project: "Maple Court project" })).json.answer).toMatch(/June 15 to 22/);
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


import { startRoundTrip, roundTripState, editRoundTrip } from "@/lib/roundtrip";
describe("round trip with Claude: write, change in Jarvis, fresh read", () => {
  const trip = async (clientName: string) => {
    const ctx = fresh(); const t = createToken(ctx, { label: "Claude" }); const rt = startRoundTrip(ctx, { project: "Garden co-op" });
    expect(rt.say.write).toContain(rt.valueA); expect(rt.say.write).toContain("apply_project_update"); expect(rt.say.read).toContain("get_project_context");
    const early = await connect(t.token, "127.0.0.1:3000", clientName); expect(() => editRoundTrip(ctx, rt.id)).toThrow(/Do step 1 first/);
    await early.call("get_project_context", { project: "Garden co-op" }); expect(roundTripState(ctx)!.read).toBeNull();                         // a read before the change is not step 3
    expect((await early.call("apply_project_update", { project: "Garden co-op", eventId: `${rt.code}-1`, changes: [{ op: "decide", key: "roundtrip-check", text: rt.valueA }] })).json.saved).toBe(true);
    expect(roundTripState(ctx)!.written).toMatchObject({ client: expect.stringContaining(clientName) }); expect(roundTripState(ctx)!.complete).toBe(false);
    await early.client.close();
    const edited = editRoundTrip(ctx, rt.id); expect(edited.edited).not.toBeNull(); expect(edited.complete).toBe(false);
    const fresh2 = await connect(t.token, "127.0.0.1:3000", clientName);                                                                            // a fresh chat
    const got = (await fresh2.call("get_project_context", { project: "Garden co-op" })).json; expect(got.current.find((f: any) => f.key === "roundtrip-check")).toMatchObject({ text: rt.valueB, origin: "jarvis-ui" });
    return roundTripState(ctx)!;
  };
  it("completes only after write, edit and a read that sees the edit, and says whether it was a Claude client or a test client", async () => {
    const test = await trip("ordinary-claude-emulator"); expect(test.complete).toBe(true); expect(test.written!.kind).toBe("test"); expect(test.verdict).toMatch(/local test client.*does not prove your Claude account/);
    const claude = await trip("claude-ai"); expect(claude.complete).toBe(true); expect(claude.read).toMatchObject({ kind: "claude", sawChange: true, origin: "jarvis-ui" }); expect(claude.verdict).toMatch(/reported themselves as Claude.*cannot verify an account/);
    expect(claude.written!.at <= claude.read!.at).toBe(true);
  });
  it("the token list shows which client last used it, as reported", async () => {
    const ctx = fresh(); const t = createToken(ctx, { label: "Claude" }); const c = await connect(t.token, "127.0.0.1:3000", "claude-ai"); await c.call("get_goal", {});
    expect(listTokens(ctx)[0].lastClient).toBe("claude-ai 1");
  });
});

// The field-test request from ordinary Claude's local test path: a calculation AND a draft, retrieved in a fresh chat with the draft and the per-part status.
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
describe("a calculation plus a draft, from ordinary Claude (local test client, not a real account)", () => {
  it("submit_goal returns at once; a fresh chat's get_result carries the verified answer, the draft to Jo, and a status for each requested part", async () => {
    const ctx = fresh(); const t = createToken(ctx, { label: "Claude" });
    const proj = createProject(ctx, { name: "Archive shuttle", kind: "project" });
    const n1 = importText(ctx, { kind: "note", title: "Archive shuttle", text: "Archive shuttle on December 4: 23 volunteers must arrive by 10:30. One van has eight passenger seats. It takes 20 minutes to drive from campus to the archive and 20 minutes to drive back. There is no loading time. Jo originally offered an 08:40 departure from campus.", at: "2026-11-10T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
    importText(ctx, { kind: "note", title: "Archive shuttle update", text: "Update for the December 4 archive shuttle: the earliest departure from campus is now 09:00. This replaces the 08:40 departure. The capacity, travel times and arrival deadline are unchanged.", at: "2026-11-14T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
    const s = await connect(t.token);
    const rc = (await s.call("submit_goal", { text: "Can one van get everyone to the archive by 10:30? Show when the last group arrives and draft a short reply to Jo.", project: "Archive shuttle" })).json;
    expect(rc).toMatchObject({ status: "queued", ready: false });
    let tick = 1_000_000; await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(tick), leaseMs: 1000 });
    await s.client.close(); const chat2 = await connect(t.token);
    const res = (await chat2.call("get_result", { id: rc.resultId })).json;
    expect(res.ready).toBe(true); expect(res.body).toMatch(/misses 10:30 by 10 minutes/); expect(res.body).toMatch(/09:20, 10:00, 10:40/);
    expect(res.draft).toMatchObject({ to: "Jo", note: expect.stringMatching(/Nothing was sent/) }); expect(res.draft.body).toMatch(/last 7 would arrive at 10:40/);
    expect(res.completion).toBe("complete"); expect(res.requestedParts.map((p: any) => `${p.kind}:${p.status}`)).toEqual(["answer:done", "report:done", "draft:done"]);
    expect(res.sources.map((x: any) => x.title)).toEqual(expect.arrayContaining(["Archive shuttle", "Archive shuttle update"]));
    expect(all(ctx.db, "SELECT model_calls FROM jobs").every((j: any) => j.model_calls === 0)).toBe(true);
  });
});

// Field test 3 from ordinary Claude's local test path: the handoff table, in a fresh chat, in two projects with the same words.
describe("a handoff table from ordinary Claude (local test client, not a real account)", () => {
  it("the same request text in two projects returns two different results, each with its own table, per-row sources and requested-part status", async () => {
    const ctx = fresh(); const t = createToken(ctx, { label: "Claude" });
    const mk = (name: string, a: string, b: string, titles: [string, string]) => { const proj = createProject(ctx, { name, kind: "project" }); const n1 = importText(ctx, { kind: "note", title: titles[0], text: a, at: "2026-11-10T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true }); importText(ctx, { kind: "note", title: titles[1], text: b, at: "2026-11-14T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id }); };
    mk("Lantern exhibit", "Lantern exhibit handoff. Mara owns caption proofing and needs the final photo credits before she can send the proof. Theo was assigned to book the label printer. The wall measurements are finished.", "Update for the Lantern exhibit: Inez has taken over the printer booking from Theo and can book it now. Mara is still waiting for the final photo credits. The wall measurements are complete.", ["Lantern team handoff", "Lantern crew update"]);
    mk("Maple exhibit", "Maple exhibit handoff. Suri owns the venue agreement and needs the insurance certificate before she can sign it. Bo was assigned to book the projector. The floor plan is finished.", "Update for the Maple exhibit: Ravi has taken over the projector booking from Bo and can book it now. Suri is still waiting for the insurance certificate. The floor plan is complete.", ["Maple team handoff", "Maple crew update"]);
    const ASK = "Turn these notes into a handoff table I can paste into our shared doc. Give each open task one row with the owner, next action, and blocker. Leave completed work out.";
    const s = await connect(t.token);
    const a = (await s.call("submit_goal", { text: ASK, project: "Lantern exhibit" })).json; const b = (await s.call("submit_goal", { text: ASK, project: "Maple exhibit" })).json;
    expect(a.resultId).not.toBe(b.resultId); expect((await s.call("submit_goal", { text: ASK, project: "No such project" })).isError).toBe(true);
    let tick = 1_000_000; await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(tick), leaseMs: 1000 });
    await s.client.close(); const chat2 = await connect(t.token);
    const ra = (await chat2.call("get_result", { id: a.resultId })).json, rb = (await chat2.call("get_result", { id: b.resultId })).json;
    expect(ra.table.rows.map((r: any) => r.cells.join(" | "))).toEqual(["Mara | Send the proof | Waiting for the final photo credits", "Inez | Book the label printer | None reported"]);
    expect(rb.table.rows.map((r: any) => r.cells.join(" | "))).toEqual(["Suri | Sign the venue agreement | Waiting for the insurance certificate", "Ravi | Book the projector | None reported"]);
    expect(ra.table.rows[1].sources).toEqual(expect.arrayContaining(["Lantern team handoff", "Lantern crew update"])); expect(JSON.stringify(rb)).not.toMatch(/Lantern/);
    expect(ra.completion).toBe("complete"); expect(ra.requestedParts).toEqual([expect.objectContaining({ kind: "table", status: "done" })]); expect(ra.table.markdown).toMatch(/^\| Owner \| Next action \| Blocker \|/);
  });
});

// The Claude reader over the authenticated connector (a LOCAL TEST CLIENT, not a real Claude account): the shareable test project the app creates, the exact prompt,
// a rejected reading that saves nothing, then an accepted one, retrieved in a fresh chat as the same result.
import { createReaderTestProject, readerTestState } from "@/lib/reader";
describe("Claude reads the notes over the connector (local test client)", () => {
  it("submit_goal -> get_reader_task -> a bad then a good submit_reader_result -> a fresh chat reads the same saved result", async () => {
    const ctx = fresh(); const t = createToken(ctx, { label: "Claude" }); const tp = createReaderTestProject(ctx);
    expect(readerTestState(ctx)).toMatchObject({ exists: true, shareableNotes: 2, toolAccepted: null, userConfirmed: null, reading: null }); expect(tp.prompt).toMatch(/get_reader_task/);
    const s = await connect(t.token); const g = (await s.call("submit_goal", { text: "What does my team still owe? One row per open item with Owner, Next action and Blocker. Leave closed items out.", project: tp.project })).json;
    expect(g.readerAvailable).toBe(true); const task = (await s.call("get_reader_task", { requestId: g.requestId })).json; expect(task.eligible).toBe(true); expect(task.spans.length).toBeGreaterThan(5);
    const sid = (snip: string) => task.spans.find((x: any) => x.text.includes(snip)).spanId;
    const mk = (extra: any = {}) => ({ requestId: g.requestId, revision: task.revision, snapshot: task.snapshot, updates: [
      { ref: "u1", owner: "Ilse Brandt", action: "Set up the sound desk", status: "open", blocker: extra.blocker ?? null, effective: "unblocked", confidence: "stated", quotes: [{ spanId: sid("sound desk is in Ilse Brandt's hands"), quote: "The sound desk is in Ilse Brandt's hands" }, { spanId: sid("power plan has arrived"), quote: "Ilse Brandt can set up the sound desk" }] },
      { ref: "u2", owner: "Mateus Oliveira", action: "Print the programmes", status: "open", blocker: null, effective: "new", confidence: "stated", quotes: [{ spanId: sid("Mateus Oliveira volunteered"), quote: "Mateus Oliveira volunteered to print the programmes" }] },
      { ref: "u3", owner: "Tobias Quist", action: "Book the stage lights", status: "done", blocker: null, effective: "completed", confidence: "stated", quotes: [{ spanId: sid("Tobias Quist booked"), quote: "Tobias Quist booked the stage lights this morning" }] },
      { ref: "u4", owner: null, action: "Sign off the stage barriers", status: "done", blocker: null, effective: "unchanged", confidence: "stated", quotes: [{ spanId: sid("stage barriers are already"), quote: "The stage barriers are already signed off" }] },
    ], coverage: task.spans.map((x: any) => { const ref = /sound desk|power plan|waiting for the venue/.test(x.text) ? "u1" : /Mateus/.test(x.text) ? "u2" : /Tobias/.test(x.text) ? "u3" : /barriers/.test(x.text) ? "u4" : null; return { spanId: x.spanId, role: ref ? "contributes" : "unrelated", refs: ref ? [ref] : [], reason: ref ? "accounts for an item" : "heading" }; }) });
    const bad = (await s.call("submit_reader_result", mk({ blocker: "Waiting for the venue's power plan" }))).json; expect(bad.accepted).toBe(false); expect(bad.reasons.join(" ")).toMatch(/was cleared by a later passage/);
    const good = (await s.call("submit_reader_result", mk())).json; expect(good).toMatchObject({ accepted: true, completion: "complete" });
    await s.client.close(); const chat2 = await connect(t.token); const res = (await chat2.call("get_result", { id: g.resultId })).json;
    expect(res.table.rows.map((r: any) => r.cells.join(" | "))).toEqual(["Ilse Brandt | Set up the sound desk | None reported", "Mateus Oliveira | Print the programmes | None reported"]); expect(res.ready).toBe(true);
    expect(readerTestState(ctx)).toMatchObject({ toolAccepted: expect.objectContaining({ origin: "connector", transport: "http", client: expect.stringContaining("ordinary-claude-emulator"), label: expect.stringMatching(/Reading accepted through the HTTP connector\..*self-reported.*looks like a test client/) }), userConfirmed: null, rejectedAttempts: 1, reading: expect.objectContaining({ completion: "complete" }) });
    expect(all(ctx.db, "SELECT model_calls FROM jobs").every((j: any) => j.model_calls === 0)).toBe(true);
  });
});
