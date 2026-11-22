import { describe, it, expect } from "vitest";
import path from "node:path";
import { memCtx, tmpDataDir, writeReport } from "./helpers";
import { closeDb, makeCtx } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { resultView, submitGoal, receipt } from "@/lib/assistant";
import { issueReaderTask, submitReaderResult } from "@/lib/reader";

// "Finished" on a team handoff means every open assignment in the shared notes is accounted for. Counting passage IDs cannot show that: an incomplete reading is schema-valid
// and every coverage reference points at a real update. These tests use correct, incomplete and ambiguous readings of notes that are NOT the garden-party / concert fixtures.
const ASK = "What does my team still owe? One row per open item with Owner, Next action and Blocker.";
const PRINT = "Rina Patel will print the invitations. Omar Reyes will collect the badges. June Park will reserve the projector.";
function setup(notes: { title: string; text: string; at: string; corrects?: number }[]) {
  const ctx = memCtx("2026-11-21T12:00:00-05:00", "personal"); const proj = createProject(ctx, { name: "Print night" }); const ids: string[] = [];
  for (const n of notes) ids.push(importText(ctx, { kind: "note", projectId: proj.id, shareable: true, title: n.title, text: n.text, at: n.at, ...(n.corrects !== undefined ? { corrects: ids[n.corrects] } : {}) }).id);
  const goal = submitGoal(ctx, { text: ASK, projectHint: proj.id, origin: "claude" }); const t: any = issueReaderTask(ctx, goal.requestId);
  return { ctx, goal, t };
}
type U = { owner: string | null; action: string; cite: string[]; status?: "open" | "done" | "cancelled"; effective?: string; blocker?: string | null };
/** Builds a reading from updates plus an explicit coverage plan: [passage snippet, role, update index | null]. */
function reading(t: any, updates: U[], plan: [string, string, number | null][]) {
  const sp = (s: string) => { const x = t.spans.find((y: any) => y.text.includes(s)); if (!x) throw new Error("no passage: " + s); return x; };
  return { requestId: t.requestId, revision: t.revision, snapshot: t.snapshot,
    updates: updates.map((u, i) => ({ ref: `u${i}`, owner: u.owner, action: u.action, status: u.status ?? "open", blocker: u.blocker ?? null, effective: u.effective ?? "new", confidence: "stated", quotes: u.cite.map((c) => ({ spanId: sp(c).spanId, quote: c })) })),
    coverage: plan.map(([s, role, i]) => ({ spanId: sp(s).spanId, role, refs: i === null ? [] : [`u${i}`], reason: "Assignment listed for this event." })) };
}
const sub = (ctx: any, r: any) => submitReaderResult(ctx, r, { client: "test", origin: "simulation" });
const rows = (ctx: any, goal: any) => (resultView(ctx, goal.resultId) as any).analysis?.rows?.map((r: any) => r.cells.join(" | "));
const status = (ctx: any, goal: any) => receipt(ctx, goal.requestId);
const RINA = { owner: "Rina Patel", action: "Print the invitations", cite: ["Rina Patel will print the invitations."] };
const OMAR = { owner: "Omar Reyes", action: "Collect the badges", cite: ["Omar Reyes will collect the badges."] };
const JUNE = { owner: "June Park", action: "Reserve the projector", cite: ["June Park will reserve the projector."] };
const P3: [string, string, number | null][] = [["Rina Patel will", "contributes", 0], ["Omar Reyes will", "contributes", 1], ["June Park will", "contributes", 2]];

describe("a table is Finished only when it accounts for the open work", () => {
  it("CORRECT: three owners, three rows, each with its own quote and coverage", () => {
    const { ctx, goal, t } = setup([{ title: "Three assigned jobs", text: PRINT, at: "2026-11-20T12:00:00.000Z" }]);
    expect(sub(ctx, reading(t, [RINA, OMAR, JUNE], P3))).toMatchObject({ accepted: true, completion: "complete" });
    expect(rows(ctx, goal)).toEqual(["Rina Patel | Print the invitations | None reported", "Omar Reyes | Collect the badges | None reported", "June Park | Reserve the projector | None reported"]);
    expect(status(ctx, goal).plain).toBe("Finished");
  });
  it("INCOMPLETE, coverage claims every passage contributes to Rina's update: rejected, names the passages and the claim to repair, nothing saved", () => {
    const { ctx, goal, t } = setup([{ title: "Three assigned jobs", text: PRINT, at: "2026-11-20T12:00:00.000Z" }]);
    const r = sub(ctx, reading(t, [RINA], [["Rina Patel will", "contributes", 0], ["Omar Reyes will", "contributes", 0], ["June Park will", "contributes", 0]]));
    expect(r.accepted).toBe(false); const why = r.reasons.join(" ");
    expect(why).toMatch(/“Omar Reyes will collect the badges\.” \) ?is marked contributes u0|“Omar Reyes will collect the badges\.”\) is marked contributes u0, but it does not name Rina Patel/);
    expect(why).toMatch(/“June Park will reserve the projector\.”\) is marked contributes u0/);
    expect(why).toMatch(/2 open assignments are not accounted for/); expect(why).toMatch(/assigns work to Omar Reyes/); expect(why).toMatch(/assigns work to June Park/);
    expect(rows(ctx, goal)).toBeUndefined(); expect(status(ctx, goal).plain).not.toBe("Finished");
  });
  it("INCOMPLETE and honest about it: unresolved passages give an explicit partial that names the missing assignments", () => {
    const { ctx, goal, t } = setup([{ title: "Three assigned jobs", text: PRINT, at: "2026-11-20T12:00:00.000Z" }]);
    const r = sub(ctx, reading(t, [RINA], [["Rina Patel will", "contributes", 0], ["Omar Reyes will", "unresolved", null], ["June Park will", "unresolved", null]]));
    expect(r.accepted).toBe(true); expect(r.completion).not.toBe("complete"); expect(rows(ctx, goal)).toEqual(["Rina Patel | Print the invitations | None reported"]);
    const v: any = resultView(ctx, goal.resultId); const text = JSON.stringify(v);
    expect(text).toMatch(/Omar Reyes will collect the badges/); expect(text).toMatch(/June Park will reserve the projector/); expect(status(ctx, goal).plain).not.toBe("Finished");
    expect(v.analysis.unparsed.map((u: any) => u.text)).toEqual(["Omar Reyes will collect the badges.", "June Park will reserve the projector."]);
  });
  it("SET ASIDE as unrelated is not an escape: a passage that gives someone work cannot be dropped", () => {
    const { ctx, t } = setup([{ title: "Three assigned jobs", text: PRINT, at: "2026-11-20T12:00:00.000Z" }]);
    const r = sub(ctx, reading(t, [RINA], [["Rina Patel will", "contributes", 0], ["Omar Reyes will", "unrelated", null], ["June Park will", "unrelated", null]]));
    expect(r.accepted).toBe(false); expect(r.reasons.join(" ")).toMatch(/cannot be set aside/); expect(r.reasons.join(" ")).toMatch(/June Park/);
  });
  it("SAME OWNER, TWO TASKS: both matter; one row alone is rejected, two rows are accepted", () => {
    const text = "Rina Patel will print the invitations. Rina Patel will book the van. Omar Reyes will collect the badges.";
    const a = setup([{ title: "Jobs", text, at: "2026-11-20T12:00:00.000Z" }]);
    const one = sub(a.ctx, reading(a.t, [RINA, OMAR], [["print the invitations", "contributes", 0], ["book the van", "contributes", 0], ["Omar Reyes will", "contributes", 1]]));
    expect(one.accepted).toBe(false); expect(one.reasons.join(" ")).toMatch(/Rina Patel will book the van/);
    const b = setup([{ title: "Jobs", text, at: "2026-11-20T12:00:00.000Z" }]);
    const two = sub(b.ctx, reading(b.t, [RINA, { owner: "Rina Patel", action: "Book the van", cite: ["Rina Patel will book the van."] }, OMAR], [["print the invitations", "contributes", 0], ["book the van", "contributes", 1], ["Omar Reyes will", "contributes", 2]]));
    expect(two).toMatchObject({ accepted: true, completion: "complete" }); expect(rows(b.ctx, b.goal)).toEqual(["Rina Patel | Print the invitations | None reported", "Rina Patel | Book the van | None reported", "Omar Reyes | Collect the badges | None reported"]);
  });
  it("LINKED CORRECTION in different words: two passages about one revised task give one row", () => {
    const { ctx, goal, t } = setup([{ title: "Jobs", text: PRINT, at: "2026-11-20T12:00:00.000Z" }, { title: "Friday update", text: "Rina Patel will now get the invitations produced at the print shop. The projector has been booked already.", at: "2026-11-21T09:00:00.000Z", corrects: 0 }]);
    const r = sub(ctx, reading(t, [{ owner: "Rina Patel", action: "Get the invitations produced at the print shop", effective: "updated", cite: ["Rina Patel will print the invitations.", "Rina Patel will now get the invitations produced at the print shop."] }, OMAR, { ...JUNE, status: "done", effective: "completed", cite: ["June Park will reserve the projector.", "The projector has been booked already."] }],
      [["Rina Patel will print", "updates_earlier", 0], ["Omar Reyes will", "contributes", 1], ["June Park will", "closed", 2], ["Rina Patel will now", "contributes", 0], ["projector has been booked", "closed", 2]]));
    expect(r, r.reasons.join(" ")).toMatchObject({ accepted: true }); expect(rows(ctx, goal)).toEqual(["Rina Patel | Get the invitations produced at the print shop | None reported", "Omar Reyes | Collect the badges | None reported"]);
    expect(status(ctx, goal).plain).toBe("Finished");
  });
  it("a correction that revises a task but is dropped from the claim is caught; a passage cannot be attached to a claim it does not support", () => {
    const { ctx, t } = setup([{ title: "Jobs", text: PRINT, at: "2026-11-20T12:00:00.000Z" }, { title: "Friday update", text: "Omar Reyes cannot collect the badges, so Rina Patel will collect the badges.", at: "2026-11-21T09:00:00.000Z", corrects: 0 }]);
    const r = sub(ctx, reading(t, [RINA, OMAR, JUNE], [["Rina Patel will print", "contributes", 0], ["Omar Reyes will collect", "contributes", 1], ["June Park will", "contributes", 2], ["Omar Reyes cannot", "updates_earlier", 2]]));
    expect(r.accepted).toBe(false); expect(r.reasons.join(" ")).toMatch(/Omar Reyes cannot collect the badges/);
  });
  it("A COLLEAGUE IN BACKGROUND PROSE is not an assignee; closed and cancelled work stays out of the open list", () => {
    const text = "Rina Patel will print the invitations. The invitations were designed by Tomas Vega last month. Omar Reyes collected the badges yesterday. June Park will no longer reserve the projector because the event was cancelled.";
    const { ctx, goal, t } = setup([{ title: "Notes", text, at: "2026-11-20T12:00:00.000Z" }]);
    const r = sub(ctx, reading(t, [RINA, { ...OMAR, status: "done", effective: "completed", cite: ["Omar Reyes collected the badges yesterday."], action: "Collect the badges" }, { ...JUNE, status: "cancelled", effective: "cancelled", cite: ["June Park will no longer reserve the projector"] }],
      [["Rina Patel will", "contributes", 0], ["designed by Tomas Vega", "unrelated", null], ["Omar Reyes collected", "closed", 1], ["June Park will no longer", "closed", 2]]));
    expect(r, r.reasons.join(" ")).toMatchObject({ accepted: true, completion: "complete" }); expect(rows(ctx, goal)).toEqual(["Rina Patel | Print the invitations | None reported"]);
  });
  it("UNFAMILIAR WORDING: an assignment the rule-based ledger cannot parse (“has volunteered to…”) still has to be accounted for", () => {
    const text = "Priya Nair is confirming the caterer, but she is waiting for the final headcount from Dana Whitfield. Marcus Webb will send the floor plan to the venue. Dana Whitfield has volunteered to write the run sheet. Lena Ortiz owns the signage and has it in hand.";
    const PRIYA: U = { owner: "Priya Nair", action: "Confirm the caterer", blocker: "Waiting for the final headcount from Dana Whitfield", cite: ["Priya Nair is confirming the caterer, but she is waiting for the final headcount from Dana Whitfield."] };
    const LENA: U = { owner: "Lena Ortiz", action: "Handle the signage", cite: ["Lena Ortiz owns the signage and has it in hand."] };
    const MARCUS: U = { owner: "Marcus Webb", action: "Send the floor plan to the venue", cite: ["Marcus Webb will send the floor plan to the venue."] };
    const DANA: U = { owner: "Dana Whitfield", action: "Write the run sheet", cite: ["Dana Whitfield has volunteered to write the run sheet."] };
    const a = setup([{ title: "Gala owners", text, at: "2026-11-20T12:00:00.000Z" }]);
    const bad = sub(a.ctx, reading(a.t, [PRIYA, LENA], [["Priya Nair is", "contributes", 0], ["Marcus Webb will", "contributes", 0], ["Dana Whitfield has", "contributes", 0], ["Lena Ortiz owns", "contributes", 1]]));
    expect(bad.accepted).toBe(false); expect(bad.reasons.join(" ")).toMatch(/Marcus Webb will send the floor plan/); expect(bad.reasons.join(" ")).toMatch(/Dana Whitfield has volunteered to write the run sheet/); expect(bad.reasons.join(" ")).toMatch(/2 open assignments are not accounted for/);
    const b = setup([{ title: "Gala owners", text, at: "2026-11-20T12:00:00.000Z" }]);
    const ok = sub(b.ctx, reading(b.t, [PRIYA, MARCUS, DANA, LENA], [["Priya Nair is", "contributes", 0], ["Marcus Webb will", "contributes", 1], ["Dana Whitfield has", "contributes", 2], ["Lena Ortiz owns", "contributes", 3]]));
    expect(ok, ok.reasons.join(" ")).toMatchObject({ accepted: true, completion: "complete" }); expect(rows(b.ctx, b.goal)).toHaveLength(4);
    const c = setup([{ title: "Gala owners", text, at: "2026-11-20T12:00:00.000Z" }]);
    const honest = sub(c.ctx, reading(c.t, [PRIYA, MARCUS, LENA], [["Priya Nair is", "contributes", 0], ["Marcus Webb will", "contributes", 1], ["Dana Whitfield has", "unresolved", null], ["Lena Ortiz owns", "contributes", 2]]));
    expect(honest.accepted).toBe(true); expect(honest.completion).not.toBe("complete"); expect(JSON.stringify(resultView(c.ctx, c.goal.resultId))).toMatch(/Dana Whitfield has volunteered to write the run sheet/);
  });
  it("PRESERVED: an accepted complete reading survives a later incomplete submission", () => {
    const { ctx, goal, t } = setup([{ title: "Three assigned jobs", text: PRINT, at: "2026-11-20T12:00:00.000Z" }]);
    const ok = sub(ctx, reading(t, [RINA, OMAR, JUNE], P3)); expect(ok.accepted).toBe(true);
    const bad = sub(ctx, reading(t, [RINA], [["Rina Patel will", "contributes", 0], ["Omar Reyes will", "contributes", 0], ["June Park will", "contributes", 0]]));
    expect(bad.accepted).toBe(false); expect(rows(ctx, goal)).toHaveLength(3); expect((resultView(ctx, goal.resultId) as any).latestVersion).toBe(ok.version); expect(status(ctx, goal).plain).toBe("Finished");
  });
  it("INVENTED: a row with no passage behind it is still rejected (no gap is filled with a made-up row)", () => {
    const { ctx, t } = setup([{ title: "Three assigned jobs", text: PRINT, at: "2026-11-20T12:00:00.000Z" }]);
    const r = sub(ctx, reading(t, [RINA, OMAR, JUNE, { owner: "Tomas Vega", action: "Order the cake", cite: ["Rina Patel will print the invitations."] }], [...P3]));
    expect(r.accepted).toBe(false); expect(r.reasons.join(" ")).toMatch(/none of the quotes names Tomas Vega/);
  });
});

// The same incomplete reading through a real stdio connector, then reopened by a second, fresh client. Evidence reports are opt-in (JARVIS_TEST_REPORT=1) and go to a per-run temp dir.
describe("connector: the saved result is the one the user sees", () => {
  it("rejects the one-row reading, keeps the three-row result, and a fresh client reopens exactly what the app shows", async () => {
    closeDb("demo"); closeDb("personal"); const dir = tmpDataDir(); const ctx0 = makeCtx("demo"); const proj = createProject(ctx0, { name: "Print night" });
    importText(ctx0, { kind: "note", projectId: proj.id, shareable: true, title: "Three assigned jobs", text: PRINT, at: "2026-11-20T12:00:00.000Z" }); closeDb("demo");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js"); const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const open = async (name: string) => { const c = new Client({ name, version: "1" }); await c.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", path.resolve("scripts/mcp-server.ts")], env: { ...(process.env as any), JARVIS_DATA_DIR: dir, JARVIS_MCP_MODE: "demo" } })); return c; };
    const call = async (c: any, name: string, args: any) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
    const c1 = await open("local-sdk-client"); const g = await call(c1, "submit_goal", { text: ASK, project: "Print night" }); const t = await call(c1, "get_reader_task", { requestId: g.requestId });
    const one = await call(c1, "submit_reader_result", reading(t, [RINA], [["Rina Patel will", "contributes", 0], ["Omar Reyes will", "contributes", 0], ["June Park will", "contributes", 0]]));
    expect(one.accepted).toBe(false); expect(one.reasons.join(" ")).toMatch(/2 open assignments are not accounted for/);
    const c2 = await open("second-sdk-client"); const afterReject = await call(c2, "get_result", { id: g.resultId }); expect(afterReject.status).not.toBe("Finished"); expect(afterReject.table?.rows ?? []).toHaveLength(0); await c2.close();
    const three = await call(c1, "submit_reader_result", reading(t, [RINA, OMAR, JUNE], P3)); expect(three).toMatchObject({ accepted: true, completion: "complete" }); await c1.close();
    const bad = await open("late-client"); const later = await call(bad, "submit_reader_result", reading(t, [RINA], [["Rina Patel will", "contributes", 0], ["Omar Reyes will", "contributes", 0], ["June Park will", "contributes", 0]])); await bad.close(); expect(later.accepted).toBe(false);
    const c3 = await open("fresh-sdk-client"); const res = await call(c3, "get_result", { id: g.resultId }); await c3.close();
    expect(res.status).toBe("Finished"); expect(res.table.rows.map((r: any) => r.cells.join(" | "))).toEqual(["Rina Patel | Print the invitations | None reported", "Omar Reyes | Collect the badges | None reported", "June Park | Reserve the projector | None reported"]);
    const ctx = makeCtx("demo"); expect(rows(ctx, g)).toEqual(res.table.rows.map((r: any) => r.cells.join(" | "))); closeDb("demo");
    writeReport("completeness-connector", { rejected: one.reasons, accepted: three.completion, freshClientRows: res.table.rows.map((r: any) => r.cells) });
  }, 240000);
});
