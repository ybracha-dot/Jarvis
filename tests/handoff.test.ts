import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { submitGoal, resultView, receipt } from "@/lib/assistant";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { all } from "@/lib/db";
import { parseOutcomes } from "@/lib/requested-parts";

// Field test 3 (independent tester, baseline 4a3a7a4). Synthetic. First observed result, kept as the regression:
//   the result quoted only the ORIGINAL note about Mara, omitted the later reassignment to Inez, delivered a paragraph, read log listed the original note only,
//   the saved result had an empty list of requested parts, and the receipt said "Finished".
export const ORIGINAL = "Lantern exhibit handoff. Mara owns caption proofing and needs the final photo credits before she can send the proof. Theo was assigned to book the label printer. The wall measurements are finished.";
export const UPDATE = "Update for the Lantern exhibit: Inez has taken over the printer booking from Theo and can book it now. Mara is still waiting for the final photo credits. The wall measurements are complete.";
export const ASK = "Turn these notes into a handoff table I can paste into our shared doc. Give each open task one row with the owner, next action, and blocker. Leave completed work out.";
export function seed(ctx: any, name = "Lantern exhibit", o: { original?: string; update?: string; titles?: [string, string] } = {}) {
  const proj = createProject(ctx, { name, kind: "project" });
  const n1 = importText(ctx, { kind: "note", title: o.titles?.[0] ?? "Lantern team handoff", text: o.original ?? ORIGINAL, at: "2026-11-10T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  importText(ctx, { kind: "note", title: o.titles?.[1] ?? "Lantern crew update", text: o.update ?? UPDATE, at: "2026-11-14T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
  return proj;
}
const run = async (ctx: any, proj: any, text = ASK) => { const g = submitGoal(ctx, { text, origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 }); return { v: resultView(ctx, g.resultId) as any, g }; };
const table = (v: any) => v.analysis.rows.map((r: any) => r.cells.join(" | "));

describe("requested artifact: a handoff table", () => {
  it("the whole request is one table outcome with its columns, row unit and exclusion; the row and exclusion sentences are not separate requests", () => {
    const o = parseOutcomes(ASK); expect(o).toHaveLength(1); expect(o[0]).toMatchObject({ kind: "table", table: { columns: ["owner", "next action", "blocker"], rowUnit: "open task", excludeDone: true } });
  });
  it("the failure repaired: Mara's open row, Inez's reassigned row, nothing for Theo or the finished wall work, each row cited, and the receipt only says Finished because the table was checked", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = seed(ctx); const { v } = await run(ctx, proj);
    expect(table(v)).toEqual(["Mara | Send the proof | Waiting for the final photo credits", "Inez | Book the label printer | None reported"]);
    expect(v.analysis.columns).toEqual(["Owner", "Next action", "Blocker"]); expect(v.analysis.markdown).toMatch(/^\| Owner \| Next action \| Blocker \|\n\|---\|---\|---\|\n\| Mara \| Send the proof/);
    expect(v.analysis.markdown).not.toMatch(/Theo|wall/i); expect(v.body).toMatch(/Wall measurements: complete, so it has no row/); expect(v.body).toMatch(/Reassigned from Theo to Inez/);
    const inez = v.analysis.rows[1].cites.map((c: any) => `${c.role}:${c.title}`); expect(inez).toEqual(expect.arrayContaining(["task and owner:Lantern team handoff", "reassigned:Lantern crew update"]));
    expect(v.analysis.rows[0].cites.map((c: any) => c.title)).toEqual(expect.arrayContaining(["Lantern team handoff", "Lantern crew update"]));
    expect(v.sources.map((s: any) => s.title)).toEqual(expect.arrayContaining(["Lantern team handoff", "Lantern crew update"])); expect(v.sources.every((s: any) => s.live && s.quote)).toBe(true);
    expect(v.outcomes).toHaveLength(1); expect(v.outcomes[0]).toMatchObject({ kind: "table", status: "done", detail: expect.stringMatching(/Table with 2 rows \(Owner, Next action, Blocker\), every row cited; 1 completed item left out/) });
    expect(v.completion).toBe("complete"); expect(receipt(ctx, v.request.id).plain).toBe("Finished");
    expect(all(ctx.db, "SELECT model_calls FROM jobs").every((j: any) => j.model_calls === 0)).toBe(true);
  });
  it("the read log lists BOTH notes, the correction as added by its link even though it shares almost no words with the question", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = seed(ctx); const { v } = await run(ctx, proj, "Who owns caption proofing?");
    const labels = v.reads.map((r: any) => r.label); expect(labels.some((l: string) => /Lantern team handoff/.test(l))).toBe(true); expect(labels.some((l: string) => /Lantern crew update.*added: your later correction/.test(l))).toBe(true);
  });
  it("follows the correction link when the question matches only the correction, and the other direction", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = seed(ctx);
    const g = submitGoal(ctx, { text: "What did Inez take over?", origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
    const v: any = resultView(ctx, g.resultId); expect(v.reads.map((r: any) => r.label).join(" ")).toMatch(/Lantern team handoff.*added: the note “Lantern team handoff” that this corrects/);
  });
});

describe("varied people, corrections and formats", () => {
  const go = async (o: Parameters<typeof seed>[2], req = ASK) => { const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = seed(ctx, "Harvest fair", o); return { ctx, ...(await run(ctx, proj, req)) }; };
  it("different people and a 'handed to' correction: the reassignment lands on the right task, the unaffected tasks keep their original owner and source", async () => {
    const { v } = await go({ original: "Harvest fair notes. Kofi owns the banner order and needs the logo file before he can place it. Ana will call the caterer. Dev is responsible for the sound check. The tent permit is approved.", update: "Update on the fair: Kofi has handed the banner order over to Priya. Dev is still waiting on the speaker rental confirmation. The sound check is done.", titles: ["Fair task notes", "Fair update"] });
    expect(table(v)).toEqual(["Priya | Place the banner order | Waiting for the logo file", "Ana | Call the caterer | None reported"]);
    expect(v.analysis.leftOut.filter((l: any) => l.reason === "complete").map((l: any) => l.text).sort()).toEqual(["Sound check", "Tent permit"]);
    expect(v.analysis.rows[1].cites[0].title).toBe("Fair task notes"); expect(v.outcomes[0].status).toBe("done");
  });
  it("a later note that unblocks a task clears only that blocker", async () => {
    const { v } = await go({ original: "Owner notes. Lena owns the grant report and needs the audit letter before she can submit it. Omar owns the booth design and needs the logo before he can print it.", update: "Update: Lena can submit the grant report now. Omar is still waiting on the logo." });
    expect(v.analysis.rows.some((r: any) => r.cells[0] === "Omar" && /Waiting for the logo/.test(r.cells[2]))).toBe(true); expect(v.outcomes[0].status).toMatch(/done|partial/);
  });
  it("a requested column the notes cannot fill is reported, not invented: the table is partial and says which cells are 'Not stated'", async () => {
    const { v, ctx } = await go(undefined, "Turn these notes into a handoff table. Give each open task one row with the owner, next action, blocker and due date. Leave completed work out.");
    expect(v.analysis.columns).toEqual(["Owner", "Next action", "Blocker", "Due date"]); expect(v.analysis.rows.every((r: any) => r.cells[3] === "Not stated")).toBe(true);
    expect(v.outcomes[0]).toMatchObject({ kind: "table", status: "partial", detail: expect.stringMatching(/no source states Due date/) }); expect(v.completion).toBe("partial"); expect(receipt(ctx, v.request.id).plain).toMatch(/only partly done/);
  });
  it("no open task with an owner in the notes: no table is invented, the outcome is not done, and the sources are quoted", async () => {
    const { v, ctx } = await go({ original: "Harvest fair notes. The weather looks good this year.", update: "Update: the fair is still on for Saturday." });
    expect(v.analysis).toBeNull(); expect(v.outcomes[0]).toMatchObject({ kind: "table", status: "missing", detail: expect.stringMatching(/No task could be read from the notes/) }); expect(receipt(ctx, v.request.id).plain).toMatch(/none of the requested parts could be done/); expect(v.body).toMatch(/What the sources say/);
  });
  it("without the instruction to leave completed work out, completed items get their own row marked complete", async () => {
    const { v } = await go(undefined, "Turn these notes into a table with the owner, next action, and blocker for each task.");
    expect(v.analysis.rows.some((r: any) => /None \(complete\)/.test(r.cells[1]))).toBe(true);
  });
  it("revoking the source the table cites shows every citation as no longer available", async () => {
    const { v, ctx } = await go(undefined); const { revokeSource, listSources } = await import("@/lib/evidence"); revokeSource(ctx, listSources(ctx)[0].id);
    const g2: any = resultView(ctx, v.id); expect(g2.sources.length).toBeGreaterThan(0); expect(g2.sources.every((s: any) => !s.live)).toBe(true);
  });
});

describe("the same words in two projects (patch + table)", () => {
  it("each project gets its own request, table, read log and links, before and after reopening", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); const a = seed(ctx);
    const b = seed(ctx, "Maple exhibit", { original: "Maple exhibit handoff. Suri owns the venue agreement and needs the insurance certificate before she can sign it. Bo was assigned to book the projector. The floor plan is finished.", update: "Update for the Maple exhibit: Ravi has taken over the projector booking from Bo and can book it now. Suri is still waiting for the insurance certificate. The floor plan is complete.", titles: ["Maple team handoff", "Maple crew update"] });
    const ra = await run(ctx, a); const rb = await run(ctx, b);
    expect(ra.g.requestId).not.toBe(rb.g.requestId); expect(ra.v.id).not.toBe(rb.v.id);
    expect(table(ra.v).join("\n")).toMatch(/Mara.*\nInez/); expect(table(rb.v)).toEqual(["Suri | Sign the venue agreement | Waiting for the insurance certificate", "Ravi | Book the projector | None reported"]);
    expect(ra.v.projectName).toBe("Lantern exhibit"); expect(rb.v.projectName).toBe("Maple exhibit");
    expect(rb.v.sources.every((s: any) => /Maple/.test(s.title))).toBe(true); expect(ra.v.sources.every((s: any) => /Lantern/.test(s.title))).toBe(true);
    expect(rb.v.reads.every((r: any) => !/Lantern/.test(r.label))).toBe(true); expect(ra.v.reads.every((r: any) => !/Maple/.test(r.label))).toBe(true);
    const again = resultView(ctx, ra.v.id) as any; expect(table(again)).toEqual(table(ra.v));
  });
});
