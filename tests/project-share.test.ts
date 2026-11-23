import { describe, it, expect, afterAll } from "vitest";
import { tmpDataDir } from "./helpers";
import { closeDb, makeCtx, all, get } from "@/lib/db";
import { createToken } from "@/lib/mcp-auth";
import { importText } from "@/lib/evidence";
import { createProject, applyProjectUpdate } from "@/lib/projects";
import { projectSharePlan, shareProject, unshareProject } from "@/lib/share";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";

async function connect(token: string) {
  const { POST } = await import("@/app/mcp/route");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const f: typeof fetch = async (url, init) => { const h = new Headers(init?.headers); h.set("host", "127.0.0.1:3000"); return POST(new Request(String(url), { ...init, headers: h })); };
  const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3000/mcp"), { fetch: f, requestInit: { headers: { authorization: `Bearer ${token}` } } });
  const client = new Client({ name: "claude-emulator", version: "1" }); await client.connect(transport);
  const call = async (name: string, args: any) => { const r: any = await client.callTool({ name, arguments: args }); return { isError: !!r.isError, text: r.content[0].text as string, json: r.isError ? null : JSON.parse(r.content[0].text) }; };
  return { client, call };
}
const fresh = () => { closeDb("demo"); closeDb("personal"); tmpDataDir(); delete process.env.JARVIS_MCP_TOKEN; process.env.JARVIS_INAPP_RUNNER = "0"; return makeCtx("personal"); };
afterAll(() => { closeDb("demo"); closeDb("personal"); });
const denied = (r: { isError: boolean; json: any }) => r.isError || !!r.json?.error;
const work = async (ctx: any) => { let t = 1_000_000; await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(t), leaseMs: 1000 }); };

const SYNC = ["[00:00:41] Dana Reyes: Thanks for joining. Let's follow up with the sponsors soon, because they asked for the revised budget before demo day.", "[00:01:12] Yonathan: I'll draft the follow-up and send it to Dana for review.", "[00:01:30] Dana Reyes: How about Monday for the sponsor follow-up?"].join("\n");
const MAIL = "Hi Yonathan,\nConfirming Wednesday for the sponsor follow-up. We moved it from Monday since Priya is out.\nThanks, Dana";

/** An invented private workspace: TAMID notes in one source, a private note about TAMID in another, and a look-alike note in a different project. */
function world() {
  const ctx = fresh(); const tamid = createProject(ctx, { name: "TAMID", kind: "club", aliases: ["sponsor pitch"] }); const alumni = createProject(ctx, { name: "TAMID Alumni", kind: "club" });
  const sync = importText(ctx, { kind: "transcript", title: "TAMID sponsor pitch sync", text: SYNC, at: "2026-11-10T15:00:00.000Z", author: "Dana Reyes", participants: ["Dana Reyes", "Yonathan"], projectId: tamid.id, label: "TAMID meeting notes" });
  const mail = importText(ctx, { kind: "email", title: "Re: TAMID sponsor pitch follow-up", text: MAIL, at: "2026-11-13T21:20:00.000Z", author: "Dana Reyes", participants: ["Dana Reyes", "Yonathan"], projectId: tamid.id, label: "TAMID meeting notes" });
  const secret = importText(ctx, { kind: "note", title: "TAMID pitch: private worries", text: "I am worried the sponsors will compare us to last year. This is for me only.", at: "2026-11-12T10:00:00.000Z", projectId: tamid.id, label: "My private journal", localOnly: true });
  const lookalike = importText(ctx, { kind: "email", title: "TAMID sponsor pitch follow-up", text: "Confirming Friday for the sponsor follow-up. Budget is $50,000.", at: "2026-11-13T10:00:00.000Z", author: "Sam Ortiz", projectId: alumni.id, label: "Alumni mailbox", localOnly: true });
  applyProjectUpdate(ctx, { project: tamid.id, eventId: "pj-evt-0001", origin: "import", sourceRef: "TAMID sponsor pitch sync", changes: [{ op: "decide", key: "sponsor-follow-up", text: "Monday", at: "2026-11-10T15:00:00.000Z" }] });
  applyProjectUpdate(ctx, { project: tamid.id, eventId: "pj-evt-0002", origin: "import", sourceRef: "Re: TAMID sponsor pitch follow-up", changes: [{ op: "decide", key: "sponsor-follow-up", text: "Wednesday, moved from Monday because Priya is out", at: "2026-11-13T21:20:00.000Z" }] });
  applyProjectUpdate(ctx, { project: alumni.id, eventId: "pj-evt-0003", origin: "import", changes: [{ op: "decide", key: "gala-date", text: "Friday, March 5", at: "2026-11-13T10:00:00.000Z" }] });
  return { ctx, tamid, alumni, sync, mail, secret, lookalike };
}

describe("one project, shared on purpose: choose, preview, share, reopen elsewhere, take it all back", () => {
  it("the preview lists exactly what Claude would see, and the same things are what it can then read; nothing else leaks", async () => {
    const { ctx, tamid, alumni } = world(); const t = createToken(ctx, { label: "Claude" });
    // before sharing: a fresh client sees nothing of this project
    const c0 = await connect(t.token);
    expect(denied(await c0.call("get_project_context", { project: "TAMID" }))).toBe(true);
    expect((await c0.call("search_evidence", { query: "TAMID sponsor pitch follow-up" })).json.hits).toHaveLength(0);

    const plan = projectSharePlan(ctx, tamid.id);
    expect(plan.project).toMatchObject({ name: "TAMID", shared: false });
    expect(plan.decisions.map((d) => d.text)).toEqual(["Wednesday, moved from Monday because Priya is out"]);
    expect(plan.sources.map((s) => s.label).sort()).toEqual(["My private journal", "TAMID meeting notes", "TAMID meeting notes"]);   // the transcript and the email are separate sources
    expect(plan.kept.localOnlyNotes).toBe(3); expect(plan.kept.otherProjectsNotes).toBeGreaterThanOrEqual(1);       // before choosing: the meeting notes (2) and the journal note (1) are all local; the look-alike belongs to another project

    const meetings = plan.sources.filter((s) => s.label === "TAMID meeting notes"); expect(meetings.every((m) => !m.shared)).toBe(true);
    const after = shareProject(ctx, tamid.id, { sources: meetings.map((m) => m.id) });
    expect(after.project.shared).toBe(true); expect(meetings.every((m) => after.sources.find((s) => s.id === m.id)!.shared)).toBe(true); expect(after.sources.find((s) => s.label === "My private journal")!.shared).toBe(false); expect(after.kept.localOnlyNotes).toBe(1);   // after: only the private journal note stays local

    // a brand new Claude client reads exactly what the preview said
    const c1 = await connect(t.token);
    expect((await c1.call("get_project_context", { project: "TAMID" })).json.current.map((x: any) => x.text)).toEqual(plan.decisions.map((d) => d.text));
    const hits = (await c1.call("search_evidence", { query: "sponsor pitch follow-up" })).json.hits as any[];
    expect(hits.map((h) => h.title).sort()).toEqual(meetings.flatMap((m) => m.notes.map((n) => n.title)).sort());
    const everything = JSON.stringify([hits, (await c1.call("search_evidence", { query: "worried sponsors compare last year" })).json, (await c1.call("search_evidence", { query: "Confirming Friday $50,000" })).json]);
    expect(everything).not.toMatch(/private worries|only|worried|Sam Ortiz|50,000|Friday/);                          // the local-only note and the look-alike never appear
    // the other project is not reachable by name or by a similar one
    expect(denied(await c1.call("get_project_context", { project: "TAMID Alumni" }))).toBe(true);
    expect((await c1.call("get_project_context", {})).json.projects.map((p: any) => p.name)).toEqual(["TAMID"]);
    expect(get(ctx.db, "SELECT COUNT(*) n FROM share_log WHERE event='project_share_confirmed'")!.n).toBe(1); void alumni;
  });

  it("a pitch request from Claude produces a cited draft with one next action; a correction makes version 2; revoking takes back every version at once", async () => {
    const { ctx, tamid, secret, lookalike } = world(); const t = createToken(ctx, { label: "Claude" });
    shareProject(ctx, tamid.id, { sources: projectSharePlan(ctx, tamid.id).sources.filter((s) => s.label === "TAMID meeting notes").map((s) => s.id) });
    const s = await connect(t.token);
    const rc = (await s.call("submit_goal", { text: "Pick up where we left off on the TAMID pitch and draft my follow-up.", project: "TAMID", dedupKey: "pitch-1" })).json; await work(ctx);
    const v1 = (await (await connect(t.token)).call("get_result", { id: rc.resultId })).json;
    expect(v1).toMatchObject({ kind: "draft", version: 1, ready: true }); expect(v1.body).toMatch(/Wednesday/);
    expect(v1.sources.length).toBeGreaterThanOrEqual(2); expect(v1.sources.every((x: any) => /TAMID sponsor pitch sync|Re: TAMID sponsor pitch follow-up/.test(x.title))).toBe(true);
    expect(JSON.stringify(v1)).not.toMatch(/private worries|50,000|Sam Ortiz/);
    // the same result, as the owner sees it, carries exactly one next action
    const { resultView } = await import("@/lib/assistant"); const own: any = resultView(ctx, rc.resultId); expect(own.nextAction.text).toMatch(/send (it|the draft) yourself\. Jarvis sent nothing/);
    // a correction from the owner's side of the conversation: version 2 on the same result
    const rev = (await s.call("revise_goal", { requestId: rc.requestId, instruction: "Use the Wednesday decision and keep it to three sentences.", dedupKey: "pitch-2" })).json; expect(rev.revision).toBe(2); await work(ctx);
    const v2 = (await (await connect(t.token)).call("get_result", { id: rc.resultId })).json; expect(v2).toMatchObject({ version: 2, latestVersion: 2 });
    expect((await (await connect(t.token)).call("get_result", { id: rc.resultId, version: 1 })).json.version).toBe(1);   // the earlier version is still readable while shared
    // approve it explicitly too, then take the whole project back with one action
    const plan = projectSharePlan(ctx, tamid.id); const draft = plan.results.find((r) => r.id === rc.resultId)!; expect(draft.canShare).toBe(true);
    shareProject(ctx, tamid.id, { results: [draft.id] }); expect(projectSharePlan(ctx, tamid.id).results.find((r) => r.id === rc.resultId)!.shared).toBe(true);
    const back = unshareProject(ctx, tamid.id);
    expect(back.project.shared).toBe(false); expect(back.sources.every((x) => !x.shared)).toBe(true); expect(back.results.every((r) => !r.shared)).toBe(true);
    const c2 = await connect(t.token);
    for (const args of [{ id: rc.resultId }, { id: rc.resultId, version: 1 }, { id: rc.resultId, version: 2 }, { id: rc.requestId }]) expect(denied(await c2.call("get_result", args))).toBe(true);   // every version, by result or request id
    expect(denied(await c2.call("get_project_context", { project: "TAMID" }))).toBe(true);
    expect((await c2.call("search_evidence", { query: "sponsor pitch follow-up" })).json.hits).toHaveLength(0);
    expect((await c2.call("get_result", {})).json.results).toHaveLength(0);
    expect(get(ctx.db, "SELECT COUNT(*) n FROM evidence_items WHERE id IN (?,?) AND tombstone=0", secret.id, lookalike.id)!.n).toBe(2);   // nothing was deleted: it is still yours
    void all;
  });

  it("a result that cites local-only notes cannot be approved, and the plan names the notes that stop it", async () => {
    const { ctx, tamid } = world();
    const { handleUtterance } = await import("@/lib/study-guide"); handleUtterance(ctx, { text: "Pick up where we left off on the TAMID pitch and draft my follow-up.", via: "voice" }); await work(ctx);
    const row = projectSharePlan(ctx, tamid.id).results.find((x) => x.kind === "draft")!; expect(row).toBeTruthy();
    expect(row.canShare).toBe(false); expect(row.blockedBy.join(" ")).toMatch(/TAMID sponsor pitch sync|Re: TAMID sponsor pitch follow-up/);
    expect(() => shareProject(ctx, tamid.id, { results: [row.id] })).toThrow(/local-only/);
    // sharing the source those notes live in is what makes the draft approvable
    shareProject(ctx, tamid.id, { sources: projectSharePlan(ctx, tamid.id).sources.filter((x) => x.label === "TAMID meeting notes").map((x) => x.id), results: [row.id] });
    expect(projectSharePlan(ctx, tamid.id).results.find((x) => x.id === row.id)!.shared).toBe(true);
  });
});
