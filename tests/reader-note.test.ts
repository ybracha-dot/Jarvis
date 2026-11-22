import { describe, it, expect } from "vitest";
import { memCtx, concertReading } from "./helpers";
import { createReaderTestProject } from "@/lib/reader";
import { resultView, submitGoal, receipt } from "@/lib/assistant";
import { issueReaderTask, submitReaderResult } from "@/lib/reader";

// Pilot finding (res_71d35f383dbb, kept as a historical record): a correct two-row reading came back "partly done" because a row carried an explanatory note.
// A note is commentary on the evidence; only a genuine doubt (inferred/uncertain confidence, an unplaced passage, an unsupported claim) makes a reading partial.
const ASK = "What does my team still owe? One row per open item with Owner, Next action and Blocker. Leave closed items out.";
function setup() { const ctx = memCtx("2026-11-21T12:00:00-05:00", "personal"); const tp = createReaderTestProject(ctx); const g = submitGoal(ctx, { text: ASK, projectHint: tp.projectId, origin: "claude" }); const t: any = issueReaderTask(ctx, g.requestId); return { ctx, g, t }; }
const sub = (ctx: any, r: any) => submitReaderResult(ctx, r, { client: "test", origin: "simulation" });
function withNote(t: any, note: string | null, confidence: "stated" | "inferred" | "uncertain" = "stated") { const r: any = concertReading(t); r.updates[1] = { ...r.updates[1], note, confidence }; return r; }

describe("a note on a supported row is commentary, not doubt", () => {
  it("REPRODUCED: a stated, fully supported row with a neutral note is complete and Finished, and the note stays visible as commentary", () => {
    const { ctx, g, t } = setup(); const r = sub(ctx, withNote(t, "Mateus volunteered in the Friday update; the Thursday note had left printing unassigned."));
    expect(r).toMatchObject({ accepted: true, completion: "complete" }); expect(receipt(ctx, g.requestId).plain).toBe("Finished");
    const v: any = resultView(ctx, g.resultId); expect(JSON.stringify(v)).toMatch(/Mateus volunteered in the Friday update/); expect(JSON.stringify(v.flags)).not.toMatch(/reader_uncertain|less than certain/);
  });
  it("a note that voices a genuine doubt still produces a partial, with the specific reason", () => {
    const { ctx, g, t } = setup(); const r = sub(ctx, withNote(t, "Not sure whether Mateus or Tobias owns the printing."));
    expect(r.accepted).toBe(true); expect(r.completion).toBe("partial"); expect(receipt(ctx, g.requestId).plain).toMatch(/only partly/); expect(JSON.stringify(resultView(ctx, g.resultId))).toMatch(/Not sure whether Mateus or Tobias/);
  });
  it("inferred or uncertain confidence still produces a partial, with or without a note", () => {
    for (const c of ["inferred", "uncertain"] as const) { const { ctx, t } = setup(); expect(sub(ctx, withNote(t, null, c)).completion, c).toBe("partial"); }
  });
  it("an unplaced passage or an unsupported claim is still a partial or a rejection, whatever the note says", () => {
    const a = setup(); const r: any = withNote(a.t, "Commentary only."); const idx = r.coverage.findIndex((c: any) => /Mateus/.test(a.t.spans.find((s: any) => s.spanId === c.spanId).text)); r.coverage[idx] = { ...r.coverage[idx], role: "unresolved", refs: [] };
    r.updates = r.updates.filter((u: any) => u.ref !== "u2"); expect(sub(a.ctx, r).completion).toBe("partial");
    const b = setup(); const bad: any = withNote(b.t, "Commentary only."); bad.updates[1] = { ...bad.updates[1], action: "Print 400 programmes" }; const rj = sub(b.ctx, bad); expect(rj.accepted).toBe(false); expect(rj.reasons.join(" ")).toMatch(/says 400/);
  });
});
