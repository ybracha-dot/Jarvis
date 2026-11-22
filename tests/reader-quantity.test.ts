import { describe, it, expect } from "vitest";
import { memCtx, concertReading } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { resultView, submitGoal } from "@/lib/assistant";
import { issueReaderTask, submitReaderResult, confirmReader, createReaderTestProject, readerTestState, originLabel } from "@/lib/reader";

// Field check: a real quote could accompany an invented number ("Print 400 programmes" was accepted and Finished with no count anywhere in the project).
// The fix is independent of the item and of names: a number in an action or blocker must be stated by a passage the update cites, for the same unit, about the same owner,
// and not replaced by a later passage. These notes are NOT the fixtures from the report.
const ASK = "What does my team still owe? One row per open item with Owner, Next action and Blocker. Leave closed items out.";
async function project(original: string, correction?: string) {
  const ctx = memCtx("2026-11-21T12:00:00-05:00", "personal"); const proj = createProject(ctx, { name: "Summit prep" });
  const a = importText(ctx, { kind: "note", projectId: proj.id, shareable: true, title: "Summit plan", text: original, at: "2026-11-20T12:00:00.000Z" });
  if (correction) importText(ctx, { kind: "note", projectId: proj.id, shareable: true, title: "Summit update", text: correction, at: "2026-11-21T09:00:00.000Z", corrects: a.id });
  const goal = submitGoal(ctx, { text: ASK, projectHint: proj.id, origin: "claude" });
  const t: any = issueReaderTask(ctx, goal.requestId); return { ctx, goal, t };
}
/** One open update, cited to the given passages; every passage is covered so only the quantity rule is under test. */
function reading(t: any, owner: string, action: string, cite: string[], blocker: string | null = null) {
  const sp = (snip: string) => t.spans.find((x: any) => x.text.includes(snip));
  return { requestId: t.requestId, revision: t.revision, snapshot: t.snapshot, updates: [{ ref: "u1", owner, action, status: "open", blocker, effective: "new", confidence: "stated", quotes: cite.map((c) => ({ spanId: sp(c).spanId, quote: c })) }],
    coverage: t.spans.map((x: any) => ({ spanId: x.spanId, role: "contributes", refs: ["u1"], reason: "about the order" })) };
}
const submit = (ctx: any, r: any) => submitReaderResult(ctx, r, { client: "test", origin: "simulation" });
const rows = (ctx: any, goal: any) => (resultView(ctx, goal.resultId) as any).analysis?.rows?.map((r: any) => r.cells.join(" | "));

describe("quantities need evidence about the same item (paired)", () => {
  it("OMITTED: a supported action with no quantity is accepted", async () => {
    const { ctx, goal, t } = await project("Sandra Koval will order name badges for the summit.");
    expect(submit(ctx, reading(t, "Sandra Koval", "Order the name badges", ["Sandra Koval will order name badges for the summit."]))).toMatchObject({ accepted: true, completion: "complete" }); expect(rows(ctx, goal)).toEqual(["Sandra Koval | Order the name badges | None reported"]);
  });
  it("SUPPORTED: the same quantity in digits, in words, and as a paraphrase of the unit is accepted", async () => {
    for (const [note, action] of [["Sandra Koval will order 250 name badges for the summit.", "Order 250 name badges"], ["Sandra Koval will order two hundred and fifty name badges for the summit.", "Order 250 name badges"], ["Sandra Koval will order 250 name badges for the summit.", "Order two hundred fifty badges"], ["Sandra Koval will order 1,200 name badges for the summit.", "Order 1200 name badges"], ["Sandra Koval will order a dozen name badges for the summit.", "Order 12 name badges"]]) {
      const { ctx, t } = await project(note); const r = submit(ctx, reading(t, "Sandra Koval", action, [note])); expect(r.accepted, `${note} / ${action}: ${r.reasons.join(" ")}`).toBe(true);
    }
  });
  it("INVENTED: a number no passage states is rejected, with a specific reason, and nothing invented is saved", async () => {
    const { ctx, goal, t } = await project("Sandra Koval will order name badges for the summit.");
    const r = submit(ctx, reading(t, "Sandra Koval", "Order 250 name badges", ["Sandra Koval will order name badges for the summit."]));
    expect(r.accepted).toBe(false); expect(r.reasons.join(" ")).toMatch(/“Order 250 name badges” says 250, but none of the passages you cited states 250 name badges for Sandra Koval/); expect(r.reasons.join(" ")).toMatch(/Remove the number from the action, or cite the passage that states it/);
    expect(JSON.stringify(resultView(ctx, goal.resultId))).not.toMatch(/250/);
  });
  it("DIFFERENT ITEM: a number the project gives to something else, or to someone else, does not support it", async () => {
    const a = await project("Sandra Koval will order name badges for the summit. Rafael Dumont is sending 250 invitations.");
    const r1 = submit(a.ctx, reading(a.t, "Sandra Koval", "Order 250 name badges", ["Sandra Koval will order name badges for the summit.", "Rafael Dumont is sending 250 invitations."]));
    expect(r1.accepted).toBe(false); expect(r1.reasons.join(" ")).toMatch(/none of the passages you cited states 250/);
    const b = await project("Sandra Koval will order name badges. Rafael Dumont will order 250 name badges.");
    const r2 = submit(b.ctx, reading(b.t, "Sandra Koval", "Order 250 name badges", ["Sandra Koval will order name badges.", "Rafael Dumont will order 250 name badges."]));
    expect(r2.accepted).toBe(false); expect(r2.reasons.join(" ")).toMatch(/for Sandra Koval/);
    const c = await project("Sandra Koval will order name badges. A separate note says 250 name badges are in stock."); const r3 = submit(c.ctx, reading(c.t, "Sandra Koval", "Order 250 name badges", ["Sandra Koval will order name badges."])); expect(r3.reasons.join(" ")).toMatch(/elsewhere in the project has that number for something else/);
  });
  it("LATER CORRECTION: the earlier quantity is rejected once a later passage replaces it; the new one is accepted", async () => {
    const { ctx, goal, t } = await project("Sandra Koval will order 250 name badges for the summit.", "Sandra Koval's badge order is now 300 name badges.");
    const stale = submit(ctx, reading(t, "Sandra Koval", "Order 250 name badges", ["Sandra Koval will order 250 name badges for the summit.", "Sandra Koval's badge order is now 300 name badges."]));
    expect(stale.accepted).toBe(false); expect(stale.reasons.join(" ")).toMatch(/a later passage .* gives 300 instead/);
    const ok = submit(ctx, reading(t, "Sandra Koval", "Order 300 name badges", ["Sandra Koval's badge order is now 300 name badges."])); expect(ok).toMatchObject({ accepted: true }); expect(rows(ctx, goal)).toEqual(["Sandra Koval | Order 300 name badges | None reported"]);
  });
  it("dates, times and years are not quantities, and numbers in a blocker are checked too", async () => {
    const a = await project("Sandra Koval will order name badges by 12 December. She is waiting for the 3 proofs from the printer.");
    const ra: any = submit(a.ctx, reading(a.t, "Sandra Koval", "Order the name badges at 9:30 on 12 December 2026", ["Sandra Koval will order name badges by 12 December."], null)); expect(ra).toMatchObject({ accepted: true });
    const b = await project("Sandra Koval will order name badges. She is waiting for the proofs from the printer.");
    const r = submit(b.ctx, reading(b.t, "Sandra Koval", "Order the name badges", ["Sandra Koval will order name badges.", "She is waiting for the proofs from the printer."], "Waiting for 3 proofs from the printer")); expect(r.accepted).toBe(false); expect(r.reasons.join(" ")).toMatch(/says 3/);
  });
  it("an accepted reading is preserved when a later submission fails", async () => {
    const { ctx, goal, t } = await project("Sandra Koval will order name badges for the summit.");
    const first = submit(ctx, reading(t, "Sandra Koval", "Order the name badges", ["Sandra Koval will order name badges for the summit."])); expect(first.accepted).toBe(true);
    const bad = submit(ctx, reading(t, "Sandra Koval", "Order 250 name badges", ["Sandra Koval will order name badges for the summit."])); expect(bad.accepted).toBe(false);
    expect(rows(ctx, goal)).toEqual(["Sandra Koval | Order the name badges | None reported"]); expect((resultView(ctx, goal.resultId) as any).latestVersion).toBe(first.version);
  });
});

describe("who submitted a reading: what was observed, what the user confirmed, how good the reading is", () => {
  it("labels each origin separately and treats a client name as self-reported metadata", () => {
    expect(originLabel("connector", "stdio", "local-sdk-client 1")).toMatch(/^Reading accepted through the local connector\. The client reports itself as “local-sdk-client 1” \(self-reported\)\. That name looks like a test client\.$/);
    expect(originLabel("connector", "stdio", null)).toBe("Reading accepted through the local connector. The client reported no name.");
    expect(originLabel("connector", "http", "Claude 1.2")).toBe("Reading accepted through the HTTP connector. The client reports itself as “Claude 1.2” (self-reported).");
    expect(originLabel("app-test", null, "Jarvis app test endpoint")).toMatch(/app's test endpoint \(a simulation, not the connector\)/);
    expect(originLabel("simulation", null, "mock-claude")).toMatch(/automated test \(a simulation\)/); expect(originLabel(null, null, null)).toMatch(/origin not recorded/);
  });
  it("a reading from a test or the app endpoint can never be confirmed as the user's own Claude round trip; a connector reading can, and the confirmation stays separate", async () => {
    const ctx = memCtx("2026-11-21T12:00:00-05:00", "personal"); const tp = createReaderTestProject(ctx);
    expect(() => confirmReader(ctx)).toThrow(/nothing to confirm/);
    const g = submitGoal(ctx, { text: ASK, projectHint: tp.projectId, origin: "claude" }); const t: any = issueReaderTask(ctx, g.requestId);
    const rd = concertReading(t);
    expect(submitReaderResult(ctx, rd, { client: "Jarvis app test endpoint", origin: "app-test" }).accepted).toBe(true);
    let st: any = readerTestState(ctx); expect(st.toolAccepted).toMatchObject({ origin: "app-test", viaConnector: false, label: expect.stringMatching(/test endpoint \(a simulation/) }); expect(st.userConfirmed).toBeNull(); expect(() => confirmReader(ctx)).toThrow(/Only a reading that arrived through the connector/);
    // a connector reading on a new revision of the same project
    const g2 = submitGoal(ctx, { text: ASK + " Keep it short.", projectHint: tp.projectId, origin: "claude" }); const t2: any = issueReaderTask(ctx, g2.requestId);
    const rd2 = concertReading(t2);
    expect(submitReaderResult(ctx, rd2, { client: null, origin: "connector", transport: "stdio" }).accepted).toBe(true);
    st = readerTestState(ctx); expect(st.toolAccepted).toMatchObject({ origin: "connector", transport: "stdio", client: null, viaConnector: true, label: "Reading accepted through the local connector. The client reported no name." }); expect(st.userConfirmed).toBeNull();
    st = confirmReader(ctx, "ran it in Claude Desktop on my Mac"); expect(st.userConfirmed).toMatchObject({ note: "ran it in Claude Desktop on my Mac" }); expect(st.reading).toMatchObject({ completion: expect.any(String) }); expect(st.toolAccepted.label).not.toMatch(/Claude account|confirmed/);
  });
  it("a reading saved before origin tracking keeps an honest 'origin not recorded' label", async () => {
    const ctx = memCtx("2026-11-21T12:00:00-05:00", "personal"); const tp = createReaderTestProject(ctx); const g = submitGoal(ctx, { text: ASK, projectHint: tp.projectId, origin: "claude" }); const t: any = issueReaderTask(ctx, g.requestId);
    submitReaderResult(ctx, concertReading(t));
    expect((readerTestState(ctx) as any).toolAccepted.label).toMatch(/origin not recorded/);
  });
});
