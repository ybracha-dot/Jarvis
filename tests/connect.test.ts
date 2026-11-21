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
