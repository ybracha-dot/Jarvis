import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { receipt, resultView, reviseRequest, submitGoal } from "@/lib/assistant";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { all } from "@/lib/db";
import { issueReaderTask, submitReaderResult, readerHandoff } from "@/lib/reader";

// The Claude reader: Jarvis issues numbered passages of explicitly shareable notes, a Claude chat returns structured updates, Jarvis validates and renders.
// Expected facts are written HERE from the notes, before any reading is submitted. A candidate below is a mock of what a chat might return; the real Claude is not called.
const ORIGINAL = "For the Signal Hall showcase, the badge proof is in Leila Park's hands. She is waiting for the sponsor artwork before she can release it. Evan Cole is arranging projector pickup. The stage map is already signed off.";
const CORRECTION = "Projector pickup is complete. Evan Cole collected it this morning. The sponsor artwork has arrived, clearing Leila Park to release the badge proof. Amara Chen volunteered to prepare the check-in sheet and can start immediately.";
const ASK = "What does my team still owe? One row per open item with Owner, Next action and Blocker. Leave closed items out.";
// Expected, from the notes: open = Leila Park (release the badge proof, blocker cleared: the artwork arrived) and Amara Chen (prepare the check-in sheet, no blocker).
// Closed = Evan Cole's projector pickup and the stage map. Nothing else.

async function setup(o: { shareable?: boolean; localOnly?: boolean } = {}) {
  const ctx = memCtx("2026-11-21T12:00:00-05:00", "personal"); const project = createProject(ctx, { name: "Signal Hall showcase" });
  const src = { kind: "note", projectId: project.id, ...(o.localOnly ? { localOnly: true, label: "Local notes" } : { shareable: o.shareable !== false }) } as any;
  const a = importText(ctx, { ...src, title: "Crew assignments", text: ORIGINAL, at: "2026-11-20T12:00:00.000Z" });
  const b = importText(ctx, { ...src, title: "Showcase crew update", text: CORRECTION, at: "2026-11-21T12:00:00.000Z", corrects: a.id });
  const goal = submitGoal(ctx, { text: ASK, projectHint: project.id, origin: "claude" });
  return { ctx, project, a, b, goal };
}
const work = (ctx: any) => processQueue(ctx, { workerId: "w", handlers: HANDLERS, leaseMs: 15000, paceMs: 0 });
type Task = Exclude<ReturnType<typeof issueReaderTask>, { eligible: false }>;
const sid = (t: Task, snippet: string) => { const s = t.spans.find((x) => x.text.includes(snippet)); if (!s) throw new Error("no span: " + snippet); return s.spanId; };
const q = (t: Task, snippet: string, quote = snippet) => ({ spanId: sid(t, snippet), quote });

/** A correct reading of the two notes. */
function good(t: Task) {
  const L1 = q(t, "badge proof is in Leila Park's hands", "the badge proof is in Leila Park's hands"), L2 = q(t, "clearing Leila Park to release the badge proof", "clearing Leila Park to release the badge proof");
  return {
    requestId: t.requestId, revision: t.revision, snapshot: t.snapshot, client: "mock-claude",
    updates: [
      { ref: "u1", owner: "Leila Park", action: "Release the badge proof", status: "open", blocker: null, effective: "unblocked", confidence: "stated", quotes: [L1, L2] },
      { ref: "u2", owner: "Amara Chen", action: "Prepare the check-in sheet", status: "open", blocker: null, effective: "new", confidence: "stated", quotes: [q(t, "Amara Chen volunteered", "Amara Chen volunteered to prepare the check-in sheet")] },
      { ref: "u3", owner: "Evan Cole", action: "Arrange projector pickup", status: "done", blocker: null, effective: "completed", confidence: "stated", quotes: [q(t, "Projector pickup is complete"), q(t, "Evan Cole collected it", "Evan Cole collected it this morning")] },
      { ref: "u4", owner: null, action: "Sign off the stage map", status: "done", blocker: null, effective: "unchanged", confidence: "stated", quotes: [q(t, "stage map is already signed off")] },
    ],
    coverage: [
      { spanId: sid(t, "badge proof is in Leila"), role: "contributes", refs: ["u1"], reason: "Leila owns the badge proof" },
      { spanId: sid(t, "She is waiting for the sponsor artwork"), role: "updates_earlier", refs: ["u1"], reason: "The blocker was later cleared" },
      { spanId: sid(t, "Evan Cole is arranging"), role: "contributes", refs: ["u3"], reason: "Pickup task" },
      { spanId: sid(t, "stage map is already"), role: "closed", refs: ["u4"], reason: "Signed off" },
      { spanId: sid(t, "Projector pickup is complete"), role: "closed", refs: ["u3"], reason: "Pickup done" },
      { spanId: sid(t, "Evan Cole collected"), role: "closed", refs: ["u3"], reason: "Pickup done" },
      { spanId: sid(t, "sponsor artwork has arrived"), role: "updates_earlier", refs: ["u1"], reason: "Clears Leila's blocker" },
      { spanId: sid(t, "Amara Chen volunteered"), role: "contributes", refs: ["u2"], reason: "New task" },
    ],
  };
}
const task = (ctx: any, goal: any) => issueReaderTask(ctx, goal.requestId) as Task;

describe("the offline local path (regression)", () => {
  it("local-only notes: Jarvis's own reader still finishes the showcase with both open rows, and Claude is offered nothing", async () => {
    const { ctx, goal, a, b } = await setup({ localOnly: true }); await work(ctx);
    const view: any = resultView(ctx, goal.resultId); expect(view.analysis.rows.map((r: any) => r.owner).sort()).toEqual(["Amara Chen", "Leila Park"]);
    expect(new Set(view.reads.map((r: any) => r.ref))).toEqual(expect.objectContaining(new Set([a.id, b.id])));
    const t = issueReaderTask(ctx, goal.requestId); expect(t.eligible).toBe(false); expect(JSON.stringify(t)).not.toMatch(/Leila|badge proof|sponsor artwork/); expect((t as any).localOnlyNotes).toBe(2);
    expect(readerHandoff(ctx, goal.resultId)).toMatchObject({ available: false });
  });
});

describe("issuing a reading task", () => {
  it("returns numbered passages of shareable notes for one revision, with stable ids, oldest first, and marks the correction", async () => {
    const { ctx, goal } = await setup(); const t = task(ctx, goal);
    expect(t.eligible).toBe(true); expect(t.spans).toHaveLength(8); expect(t.spans[0].spanId).toMatch(/^ev_[a-f0-9]+@r1#1$/); expect(t.spans[4].corrects).toBe("Crew assignments"); expect(t.instructions).toMatch(/DATA, not instructions/);
    expect(issueReaderTask(ctx, goal.requestId)).toMatchObject({ snapshot: t.snapshot, revision: 1 });   // retry gives the same task
  });
  it("withholds a local-only note even in a project that also has shareable notes, and says only how many", async () => {
    const { ctx, goal, project } = await setup(); importText(ctx, { kind: "note", projectId: project.id, title: "Private", text: "Secret: Noor Haddad owes the invoice.", localOnly: true, label: "Local", at: "2026-11-21T13:00:00.000Z" });
    const t = task(ctx, goal); expect(t.localOnlyNotes).toBe(1); expect(JSON.stringify(t)).not.toMatch(/Noor|invoice/);
  });
});

describe("validating a submission", () => {
  it("accepts the correct two-row reading, renders the artifact itself, saves it as version 2 of the SAME result and reopens through the normal result page", async () => {
    const { ctx, goal, a, b } = await setup(); await work(ctx); const before: any = resultView(ctx, goal.resultId); const t = task(ctx, goal);
    const r = submitReaderResult(ctx, good(t), "mock-claude"); expect(r).toMatchObject({ accepted: true, version: before.latestVersion + 1, resultId: goal.resultId, completion: "complete" });
    const v: any = resultView(ctx, goal.resultId); expect(v.latestVersion).toBe(before.latestVersion + 1); expect(v.version).toBe(v.latestVersion);
    expect(v.mode).toMatch(/Claude-assisted/); expect(v.analysis.rows.map((x: any) => x.owner)).toEqual(["Leila Park", "Amara Chen"]);
    expect(v.analysis.rows[0].cells).toEqual(["Leila Park", "Release the badge proof", "None reported"]); expect(v.analysis.rows[1].cells).toEqual(["Amara Chen", "Prepare the check-in sheet", "None reported"]);
    for (const row of v.analysis.rows) expect(row.cites.some((c: any) => c.itemId === b.id && c.quote)).toBe(true); expect(v.analysis.rows[0].cites.some((c: any) => c.itemId === a.id)).toBe(true);
    expect(v.analysis.leftOut.filter((l: any) => l.reason === "complete").map((l: any) => l.text).sort()).toEqual(["Arrange projector pickup", "Sign off the stage map"]);
    expect(v.body).toMatch(/\|[^\n]*Leila Park[^\n]*\|/); expect(v.body).toMatch(/\|[^\n]*Amara Chen[^\n]*\|/); expect(v.outcomes[0]).toMatchObject({ kind: "table", status: "done" }); expect(receipt(ctx, goal.requestId).plain).toBe("Finished");
    expect(v.sources.every((s: any) => s.live && s.quote)).toBe(true); expect(all(ctx.db, "SELECT model_calls FROM jobs").every((j: any) => j.model_calls === 0)).toBe(true);
    expect(resultView(ctx, goal.resultId, before.latestVersion)).toBeTruthy();   // the earlier version is kept
  });
  it("REJECTS a candidate that drops Leila (her passages set aside as unrelated), and saves nothing", async () => {
    const { ctx, goal } = await setup(); await work(ctx); const before: any = resultView(ctx, goal.resultId); const t = task(ctx, goal); const g = good(t);
    const bad = { ...g, updates: g.updates.filter((u) => u.ref !== "u1"), coverage: g.coverage.map((c) => (c.refs.includes("u1") ? { ...c, role: "unrelated", refs: [] } : c)) };
    const r = submitReaderResult(ctx, bad, "mock-claude"); expect(r.accepted).toBe(false); expect(r.reasons.join(" ")).toMatch(/describes work for [^.]*leila[^.]*, who has no update/i);
    const v: any = resultView(ctx, goal.resultId); expect(v.latestVersion).toBe(before.latestVersion); expect(v.analysis.rows.map((x: any) => x.owner).sort()).toEqual(["Amara Chen", "Leila Park"]);   // the local result is untouched
  });
  it("REJECTS a candidate that keeps Leila's old blocker although a later passage says the artwork arrived", async () => {
    const { ctx, goal } = await setup(); const t = task(ctx, goal); const g = good(t);
    const bad = { ...g, updates: g.updates.map((u) => (u.ref === "u1" ? { ...u, blocker: "Waiting for the sponsor artwork", effective: "updated", quotes: [q(t, "badge proof is in Leila Park's hands", "the badge proof is in Leila Park's hands"), q(t, "She is waiting for the sponsor artwork", "She is waiting for the sponsor artwork before she can release it")] } : u)) };
    const r = submitReaderResult(ctx, bad, "mock-claude"); expect(r.accepted).toBe(false); expect(r.reasons.join(" ")).toMatch(/blocker “Waiting for the sponsor artwork” was cleared by a later passage/);
  });
  it("REJECTS a candidate that attaches Amara's exact quote to Leila", async () => {
    const { ctx, goal } = await setup(); const t = task(ctx, goal); const g = good(t);
    const bad = { ...g, updates: g.updates.map((u) => (u.ref === "u1" ? { ...u, quotes: [q(t, "Amara Chen volunteered", "Amara Chen volunteered to prepare the check-in sheet")] } : u)) };
    const r = submitReaderResult(ctx, bad, "mock-claude"); expect(r.accepted).toBe(false); expect(r.reasons.join(" ")).toMatch(/none of the quotes names Leila Park/);
  });
  it("REJECTS invented evidence: a quote that is not in the passage, a passage that was never issued, a missing coverage entry, and a schema violation", async () => {
    const { ctx, goal } = await setup(); const t = task(ctx, goal); const g = good(t);
    const fake = submitReaderResult(ctx, { ...g, updates: g.updates.map((u) => (u.ref === "u2" ? { ...u, quotes: [{ spanId: sid(t, "Amara Chen volunteered"), quote: "Amara Chen is already preparing the check-in sheet" }] } : u)) }); expect(fake.accepted).toBe(false); expect(fake.reasons.join(" ")).toMatch(/is not in passage/);
    const unissued = submitReaderResult(ctx, { ...g, updates: g.updates.map((u) => (u.ref === "u2" ? { ...u, quotes: [{ spanId: "ev_000000000000@r1#1", quote: "Amara Chen volunteered" }] } : u)) }); expect(unissued.reasons.join(" ")).toMatch(/was not issued/);
    const short = submitReaderResult(ctx, { ...g, coverage: g.coverage.slice(1) }); expect(short.accepted).toBe(false); expect(short.reasons.join(" ")).toMatch(/no coverage entry/);
    const schema = submitReaderResult(ctx, { requestId: t.requestId, revision: 1, snapshot: t.snapshot, updates: [{ ref: "u1" }], coverage: [] }); expect(schema.accepted).toBe(false); expect(schema.reasons.join(" ")).toMatch(/does not match the schema/);
    expect(all(ctx.db, "SELECT COUNT(*) n FROM reader_submissions WHERE status='accepted'")[0].n).toBe(0);
  });
  it("REJECTS a reading of a stale revision or stale notes, and a project the request does not belong to", async () => {
    const { ctx, goal, project, a } = await setup(); const t = task(ctx, goal); const g = good(t);
    importText(ctx, { kind: "note", projectId: project.id, shareable: true, title: "Another update", text: "Amara Chen handed the check-in sheet to Dev Rao.", at: "2026-11-21T15:00:00.000Z", corrects: a.id });
    const stale = submitReaderResult(ctx, g); expect(stale.accepted).toBe(false); expect(stale.reasons.join(" ")).toMatch(/a note or correction changed after you read it/);
    const t2 = task(ctx, goal); reviseRequest(ctx, { requestId: goal.requestId, text: "Keep it to three rows.", origin: "claude" });
    const rev = submitReaderResult(ctx, { ...good(t2), snapshot: t2.snapshot }); expect(rev.reasons.join(" ")).toMatch(/Stale: the request is now at revision 2/);
    expect(() => submitReaderResult(ctx, { ...g, requestId: "req_unknown000000" })).toThrow(/No such request/);
  });
  it("is idempotent on replay (same result, no second version) and refuses a different second reading for the same revision", async () => {
    const { ctx, goal } = await setup(); await work(ctx); const t = task(ctx, goal); const g = good(t);
    const first = submitReaderResult(ctx, g, "mock-claude"); const again = submitReaderResult(ctx, g, "mock-claude");
    expect(again).toMatchObject({ accepted: true, replay: true, version: first.version, resultId: first.resultId }); expect((resultView(ctx, goal.resultId) as any).latestVersion).toBe(first.version);
    const other = submitReaderResult(ctx, { ...g, updates: g.updates.map((u) => (u.ref === "u2" ? { ...u, action: "Prepare the check-in sheets" } : u)) }); expect(other.accepted).toBe(false); expect(other.reasons.join(" ")).toMatch(/different reading was already accepted/);
  });
  it("a correct reading that Claude itself marks uncertain is saved but is an honest partial, not a complete result", async () => {
    const { ctx, goal } = await setup(); const t = task(ctx, goal); const g = good(t);
    const r = submitReaderResult(ctx, { ...g, updates: g.updates.map((u) => (u.ref === "u2" ? { ...u, confidence: "uncertain", note: "the note does not say who confirmed it" } : u)) }, "mock-claude");
    expect(r).toMatchObject({ accepted: true, completion: "partial" }); expect(r.parts![0].detail).toMatch(/marked part of it inferred or uncertain/); expect(receipt(ctx, goal.requestId).plain).toMatch(/only partly done/);
  });
  it("a passage Claude marks unresolved stays beside the work as a visible gap, not hidden", async () => {
    const { ctx, goal } = await setup(); const t = task(ctx, goal); const g = good(t);
    const r = submitReaderResult(ctx, { ...g, coverage: g.coverage.map((c) => (c.spanId === sid(t, "Evan Cole collected") ? { ...c, role: "unresolved", refs: [], reason: "I cannot tell which pickup this is" } : c)) });
    expect(r).toMatchObject({ accepted: true, completion: "partial" }); const v: any = resultView(ctx, goal.resultId); expect(v.body).toMatch(/Check before you paste this/); expect(v.analysis.unparsed.length).toBe(1);
  });
  it("never reads a local-only project: a submission for it is rejected because no task could have been issued", async () => {
    const { ctx, goal } = await setup({ localOnly: true });
    const r = submitReaderResult(ctx, { requestId: goal.requestId, revision: 1, snapshot: "0".repeat(16), updates: [], coverage: [] }); expect(r.accepted).toBe(false);
  });
});

// Findings from the frozen evaluation (an LLM playing Claude on fresh notes): Jarvis rejected two correct readings. A passage that merely names someone with no task
// ("Hiroshi Tanaka only attended the kickoff") was refused as an "unrelated" passage, and "delivery confirmed for Monday but nothing has arrived yet" was read as clearing the blocker.
describe("validator false positives found by the frozen evaluation", () => {
  it("a passage that names a person who has no task can be set aside as unrelated; it is accepted with a visible note, not rejected", async () => {
    const { ctx, goal, project } = await setup(); importText(ctx, { kind: "note", projectId: project.id, shareable: true, title: "Kickoff", text: "Hiroshi Tanaka only attended the kickoff.", at: "2026-11-21T09:00:00.000Z" });
    const t = task(ctx, goal); const g = good(t); const extra = t.spans.find((x) => x.text.includes("Hiroshi"))!;
    const r = submitReaderResult(ctx, { ...g, coverage: [...g.coverage, { spanId: extra.spanId, role: "unrelated", refs: [], reason: "attendance only" }] }, "mock-claude");
    expect(r).toMatchObject({ accepted: true }); expect((resultView(ctx, goal.resultId) as any).body).toMatch(/Claude set aside “Hiroshi Tanaka only attended the kickoff\.”/);
  });
  it("a blocker that a later passage says is NOT yet resolved stays valid", async () => {
    const ctx = memCtx("2026-11-21T12:00:00-05:00", "personal"); const project = createProject(ctx, { name: "Device pilot" }); const src = { kind: "note", projectId: project.id, shareable: true } as any;
    const a = importText(ctx, { ...src, title: "Pilot", text: "Kwabena Mensah will test the app on the pilot devices. He is waiting for the test devices to be delivered.", at: "2026-11-20T12:00:00.000Z" });
    importText(ctx, { ...src, title: "Pilot update", text: "The delivery has been confirmed for Monday but nothing has arrived yet.", at: "2026-11-21T12:00:00.000Z", corrects: a.id });
    const goal = submitGoal(ctx, { text: ASK, projectHint: project.id, origin: "claude" }); const t = task(ctx, goal);
    const r = submitReaderResult(ctx, { requestId: t.requestId, revision: t.revision, snapshot: t.snapshot, updates: [{ ref: "u1", owner: "Kwabena Mensah", action: "Test the app on the pilot devices", status: "open", blocker: "Waiting for the test devices (delivery confirmed for Monday, not yet arrived)", effective: "updated", confidence: "stated", quotes: [q(t, "Kwabena Mensah will test", "Kwabena Mensah will test the app on the pilot devices"), q(t, "nothing has arrived yet", "nothing has arrived yet")] }],
      coverage: t.spans.map((x) => ({ spanId: x.spanId, role: "contributes", refs: ["u1"], reason: "about the pilot devices" })) });
    expect(r).toMatchObject({ accepted: true }); expect((resultView(ctx, goal.resultId) as any).analysis.rows[0].cells[2]).toMatch(/delivery confirmed for Monday/);
  });
});

describe("the offer to continue with Claude", () => {
  it("a result the local reader could not finish carries the exact prompt for a shareable project, and none for local-only notes", async () => {
    const { ctx, goal } = await setup(); const h: any = readerHandoff(ctx, goal.resultId); expect(h.available).toBe(true); expect(h.prompt).toContain(goal.requestId); expect(h.prompt).toMatch(/get_reader_task/); expect(h.shareableNotes).toBe(2);
  });
});
