import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { analyzePlan, isPlanRequest } from "@/lib/plan";
import { itemsOf } from "./decision.test";

// Field test (independent tester, commit f4f316c): a project the app had never seen, one correction linked to the original, and a
// request that asks for a calculation AND a draft. First observed results, kept as regressions:
//   with the draft request: kind=draft, "To: (recipient not identified)", "Hi there", "the sources do not yet settle a date", 0 sources, no calculation;
//   without it: an extractive digest that quoted 08:40 -> 09:00 but gave no last arrival and no feasibility answer.
export const NOTE = "Archive shuttle on December 4: 23 volunteers must arrive by 10:30. One van has eight passenger seats. It takes 20 minutes to drive from campus to the archive and 20 minutes to drive back. There is no loading time. Jo originally offered an 08:40 departure from campus.";
export const UPDATE = "Update for the December 4 archive shuttle: the earliest departure from campus is now 09:00. This replaces the 08:40 departure. The capacity, travel times and arrival deadline are unchanged.";
export const REQ = "Can one van get everyone to the archive by 10:30? Show when the last group arrives and draft a short reply to Jo.";
export function seedShuttle(ctx: any, o: { note?: string; update?: string } = {}) {
  const proj = createProject(ctx, { name: "Archive shuttle", kind: "project" });
  const n1 = importText(ctx, { kind: "note", title: "Archive shuttle", text: o.note ?? NOTE, at: "2026-11-10T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  importText(ctx, { kind: "note", title: "Archive shuttle update", text: o.update ?? UPDATE, at: "2026-11-14T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
  return proj;
}
const plan = (o?: { note?: string; update?: string }, req = REQ) => { const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedShuttle(ctx, o); return analyzePlan(itemsOf(ctx), req)!; };

describe("trips: a vehicle that goes out, comes back and goes out again", () => {
  it("recognises the request as a calculation", () => { expect(isPlanRequest(REQ)).toBe(true); expect(isPlanRequest("Can one van get everyone to the archive by 10:30?")).toBe(true); expect(isPlanRequest("Draft a thank-you note to Jo")).toBe(false); });
  it("one van misses 10:30 by 10 minutes: groups of 8, 8 and 7 arrive 09:20, 10:00 and 10:40; three outbound legs and two returns; no final return", () => {
    const p = plan(); const r = p.recommendation;
    expect(p.kind).toBe("trips"); expect(r.kind).toBe("none_fits");
    expect(r.headline).toMatch(/No: 1 vehicle leaving 09:00 misses 10:30 by 10 minutes/); expect(r.headline).toMatch(/09:20, 10:00, 10:40 \(8, 8, 7 people\)/); expect(r.headline).toMatch(/last 7 arrive at 10:40/);
    expect(p.computation.join("\n")).toMatch(/23 people ÷ 8 seats = 2\.88, rounded up to 3 trips \(8 \+ 8 \+ 7\)/);
    expect(p.computation.join("\n")).toMatch(/3 outbound legs and 2 returns before the last arrival: 09:00 \+ 3 × 20 \+ 2 × 20 minutes = 10:40\. The vehicle does not need to come back after the last delivery/);
    expect(p.figures!.find((f) => f.label === "Last group arrives")!.value).toMatch(/^10:40 \(10 minutes after the 10:30 deadline\)/);
  });
  it("the correction changes only the departure: 09:00 replaces 08:40, and every other input keeps its original citation", () => {
    const p = plan(); const row = (l: string) => p.inputs.find((r) => r.label === l)!;
    expect(row("Earliest departure")).toMatchObject({ value: "09:00", srcTitle: "Archive shuttle update" });
    expect(row("Seats per vehicle")).toMatchObject({ value: "8", srcTitle: "Archive shuttle" }); expect(row("Drive out")).toMatchObject({ value: "20 minutes", srcTitle: "Archive shuttle" }); expect(row("Drive back")).toMatchObject({ value: "20 minutes", srcTitle: "Archive shuttle" });
    expect(row("People to carry").value).toMatch(/^23/); expect(row("Must arrive by")).toMatchObject({ value: expect.stringContaining("10:30"), srcTitle: "Archive shuttle" }); expect(row("Boarding or loading")).toMatchObject({ value: "0 minutes" });
    expect(p.setAside.find((r) => r.label === "Earlier departure")).toMatchObject({ value: "08:40", note: expect.stringMatching(/replaced by 09:00/) });
    for (const r of p.inputs.filter((x) => x.src)) expect(r.quote).toBeTruthy();
  });
  it("the fixes are computed, not guessed: leave by 08:50, or one more van gets everyone there by 10:00", () => {
    const p = plan(); expect(p.recommendation.headline).toMatch(/leave at 08:50 or earlier/); expect(p.recommendation.headline).toMatch(/add another vehicle \(the last group would arrive 10:00\)/);
    expect(p.options.find((o) => o.option === "leave 08:50")!.verdict).toBe("works"); expect(p.options.find((o) => o.option === "2 vehicles")!.verdict).toBe("works");
    expect(p.draftSketch!.lines.join(" ")).toMatch(/last 7 would arrive at 10:40/); expect(p.draftSketch!.ask.join(" ")).toMatch(/leave at 08:50 or earlier, or arrange another vehicle/);
  });
  it("changing only the departure to 08:50 puts the last group at 10:30, which is on time", () => {
    const p = plan({ update: UPDATE.replace("09:00", "08:50") }); expect(p.recommendation.kind).toBe("recommend"); expect(p.recommendation.headline).toMatch(/Yes: 1 vehicle leaving 08:50 gets everyone there by 10:30\. The last group of 7 arrives 10:30, 0 minutes early/);
    expect(p.figures!.find((f) => f.label === "Last group arrives")!.value).toMatch(/^10:30/);
  });
  it("removing the return duration from every source gives a conditional answer that names the missing input and the break-even", () => {
    const p = plan({ note: NOTE.replace(" and 20 minutes to drive back", "") }); const r = p.recommendation;
    expect(r.kind).toBe("ask"); expect(r.headline).toMatch(/drive back time was not found in the sources/); expect(r.headline).toMatch(/only if the drive back takes 15 minutes or less/); expect(r.question).toMatch(/How long does the drive back take\?/);
    expect(p.computation.join(" ")).toMatch(/Last arrival = 09:00 \+ 3 × 20 minutes out \+ 2 × \(drive back\)/); expect(p.recommendation.qualifiers.join(" ")).toMatch(/Provisional/);
    expect(p.figures!.some((f) => f.label === "Condition")).toBe(true);
  });
  it("removing the departure from every source asks for it and gives the latest departure that would work", () => {
    const p = plan({ note: NOTE.replace(" Jo originally offered an 08:40 departure from campus.", ""), update: "Update for the December 4 archive shuttle: nothing else changed." }); expect(p.recommendation.kind).toBe("ask"); expect(p.recommendation.headline).toMatch(/no departure time was found in the sources/); expect(p.recommendation.headline).toMatch(/leaves at 08:50 or earlier/);
  });
  it("a second van is read from the request, and a number written as a word (\"eight seats\") works the same as 8", () => {
    const p = plan({ note: NOTE.replace("One van", "The van").replace("eight passenger seats", "8 seats") }, "Can two vans get everyone to the archive by 10:30? Show when the last group arrives."); expect(p.inputs.find((r) => r.label === "Vehicles")).toMatchObject({ value: "2", note: "from your request" });
    expect(p.recommendation.kind).toBe("recommend"); expect(p.figures!.find((f) => f.label === "Last group arrives")!.value).toMatch(/^10:00/);
  });
});

// ---------- the whole request path: routing, the verified answer, the draft that uses it, and a status for every requested part ----------
import { submitGoal, resultView, receipt } from "@/lib/assistant";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { all } from "@/lib/db";
import { parseOutcomes } from "@/lib/requested-parts";
const run = async (req: string, o?: { note?: string; update?: string }) => {
  const ctx = memCtx("2026-11-16T10:00:00-05:00"); const clock = () => new Date(1_000_000); const proj = seedShuttle(ctx, o);
  const g = submitGoal(ctx, { text: req, origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock, leaseMs: 1000 });
  return { ctx, v: resultView(ctx, g.resultId) as any, g };
};
describe("the original failures, repaired", () => {
  it("failure 1: 'work out X and draft Y' keeps both outcomes. The calculation comes first and the draft uses it, to Jo, with the cited sources", async () => {
    const { v, ctx, g } = await run(REQ);
    expect(v.kind).toBe("answer"); expect(v.body).toMatch(/No: 1 vehicle leaving 09:00 misses 10:30 by 10 minutes/); expect(v.body).not.toMatch(/sources do not yet settle a date|recipient not identified|Hi there/);
    expect(v.analysis.type).toBe("plan"); expect(v.sources.length).toBeGreaterThanOrEqual(6); expect(v.sources.map((s: any) => s.title)).toEqual(expect.arrayContaining(["Archive shuttle", "Archive shuttle update"]));
    expect(v.draft.to).toBe("Jo"); expect(v.draft.body).toMatch(/^Hi Jo,/); expect(v.draft.body).toMatch(/last 7 would arrive at 10:40/); expect(v.draft.body).toMatch(/leave at 08:50 or earlier, or arrange another vehicle/); expect(v.draft.body).not.toMatch(/Hi there|recipient not identified/);
    expect(v.outcomes.map((o: any) => `${o.kind}:${o.status}`)).toEqual(["answer:done", "report:done", "draft:done"]);
    expect(v.outcomes[1].detail).toMatch(/Last group arrives: 10:40/); expect(v.outcomes[2].detail).toMatch(/to Jo.*10:40.*Nothing was sent/); expect(v.completion).toBe("complete");
    expect(all(ctx.db, "SELECT model_calls FROM jobs").every((j: any) => j.model_calls === 0)).toBe(true);
    expect(receipt(ctx, (v.request as any).id).completion).toBe("complete");
  });
  it("failure 2 (the control): without the draft request, the answer still gives the last arrival and the feasibility decision, not just the quoted change", async () => {
    const { v } = await run("Can one van get everyone to the archive by 10:30? Show when the last group arrives.");
    expect(v.body).toMatch(/misses 10:30 by 10 minutes/); expect(v.body).toMatch(/10:40/); expect(v.draft).toBeNull(); expect(v.analysis.figures.find((f: any) => f.label === "Last group arrives")).toBeTruthy();
    expect(v.outcomes.map((o: any) => o.status)).toEqual(["done", "done"]);
  });
  it("only the departure changes: 08:50 gives an on-time arrival at 10:30 and a draft that says so", async () => {
    const { v } = await run(REQ, { update: UPDATE.replace("09:00", "08:50") });
    expect(v.body).toMatch(/Yes: 1 vehicle leaving 08:50 gets everyone there by 10:30/); expect(v.draft.body).toMatch(/would arrive at 10:30, in time for 10:30/); expect(v.draft.body).not.toMatch(/10:40/); expect(v.completion).toBe("complete");
  });
  it("the return duration removed from every source: the answer is conditional, the draft asks for it, and the job says it is only partly done", async () => {
    const { v, ctx } = await run(REQ, { note: NOTE.replace(" and 20 minutes to drive back", "") });
    expect(v.body).toMatch(/drive back time was not found in the sources/); expect(v.body).toMatch(/only if the drive back takes 15 minutes or less/);
    expect(v.draft.body).toMatch(/How long does the drive back take\?/); expect(v.draft.body).not.toMatch(/would arrive at 10:40/);
    expect(v.outcomes.map((o: any) => `${o.kind}:${o.status}`)).toEqual(["answer:partial", "report:partial", "draft:partial"]);
    expect(v.outcomes[2].detail).toMatch(/asks for the missing input instead of giving the reply you asked for/); expect(v.completion).toBe("partial");
    const r = receipt(ctx, v.request.id); expect(r.plain).toMatch(/only partly done: 0 of 3 requested parts done/); expect(r.completion).toBe("partial");
  });
  it("no usable inputs at all: partial work with exactly what is missing, and no template standing in for the draft", async () => {
    const { v } = await run(REQ, { note: "Archive shuttle on December 4. Jo is organising it.", update: "Update for the archive shuttle: nothing changed." });
    expect(v.outcomes.find((o: any) => o.kind === "draft").status).toBe("missing"); expect(v.draft).toBeNull(); expect(v.body).not.toMatch(/Following up|Hi there/);
    expect(v.completion).not.toBe("complete"); expect(v.outcomes.find((o: any) => o.kind === "draft").detail).toMatch(/Not produced|Not drafted|No draft/);
  });
});
describe("requested parts", () => {
  it("splits a multi-part request into parts and names the recipient; a single draft request stays one part", () => {
    expect(parseOutcomes(REQ).map((o) => `${o.kind}:${o.recipient ?? ""}`)).toEqual(["answer:", "report:", "draft:Jo"]);
    expect(parseOutcomes("Pick up where we left off on the pitch and draft my follow-up.").map((o) => o.kind)).toEqual(["draft"]);
    expect(parseOutcomes("Which plumber should I go with, and what will it really cost? Draft the follow-up.").map((o) => o.kind)).toEqual(["answer", "answer", "draft"]);
  });
});

// ---------- a fresh example, not about transport: an agenda against a room booking, with a later correction, asking for a pasteable list ----------
// First observed result (before any repair, recorded in MORNING.md): the batch solver read "takes 40 minutes" as a kiln-style capacity and answered
// "proposal now: 1 run needed, but how long one run takes ... is not stated"; the request for a pasteable list was silently dropped.
const AGENDA = "Board meeting on March 3 in the library room. The agenda has four items: budget review takes 25 minutes, the garden proposal takes 40 minutes, volunteer awards take 15 minutes and the annual report takes 30 minutes. There is a 10 minute coffee break after the second item. The library room is booked from 14:00 to 16:00. Dev wants to start at 14:00.";
const AGENDA_UPDATE = "Update for the March 3 board meeting: the garden proposal now takes 50 minutes. This replaces the 40 minutes. The other items and the coffee break are unchanged, and the library room booking is unchanged.";
const AGENDA_REQ = "Will the whole agenda fit in the room booking? Show when each item starts and ends, and write the agenda as a list I can paste to the board.";
const runAgenda = async (o: { note?: string; update?: string } = {}) => {
  const ctx = memCtx("2026-11-16T10:00:00-05:00"); const clock = () => new Date(1_000_000); const proj = createProject(ctx, { name: "Board meeting", kind: "project" });
  const n1 = importText(ctx, { kind: "note", title: "Board meeting agenda", text: o.note ?? AGENDA, at: "2026-11-10T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  importText(ctx, { kind: "note", title: "Board meeting update", text: o.update ?? AGENDA_UPDATE, at: "2026-11-14T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
  const g = submitGoal(ctx, { text: AGENDA_REQ, origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock, leaseMs: 1000 });
  return resultView(ctx, g.resultId) as any;
};
describe("a fresh non-transport example: an agenda that must fit a booking", () => {
  it("the corrected 50-minute item pushes the agenda 10 minutes past the booking; each start and end is listed; the pasteable list matches", async () => {
    const v = await runAgenda();
    expect(v.body).toMatch(/No: starting 14:00, the agenda runs until 16:10, 10 minutes past the end of the 14:00 to 16:00 booking/); expect(v.body).toMatch(/extend the booking to 16:10, or start at 13:50/);
    expect(v.analysis.kind).toBe("sequence"); expect(v.analysis.computation.join(" ")).toMatch(/25 \+ 50 \+ 15 \+ 30 \+ 10 break = 130 minutes/);
    expect(v.analysis.computation).toEqual(expect.arrayContaining(["Budget review: 14:00 to 14:25", "Garden proposal: 14:25 to 15:15", "Break: 15:15 to 15:25", "Volunteer awards: 15:25 to 15:40", "Annual report: 15:40 to 16:10"]));
    expect(v.draft.body).toMatch(/14:25–15:15\s+Garden proposal/); expect(v.draft.to).toBeNull();
    expect(v.outcomes.map((o: any) => `${o.kind}:${o.status}`)).toEqual(["answer:done", "report:done", "draft:done"]); expect(v.completion).toBe("complete");
    expect(v.analysis.setAside.find((r: any) => /garden proposal/i.test(r.label))).toMatchObject({ value: "40 minutes" });
  });
  it("without the correction the original 40 minutes fit exactly: the last item ends at 16:00, inside the booking", async () => {
    const v = await runAgenda({ update: "Update for the March 3 board meeting: nothing changed." });
    expect(v.body).toMatch(/Yes: the agenda fits\. Starting 14:00, the last item ends 16:00, 0 minutes before the booking ends at 16:00/);
  });
  it("without the booked window the answer lays the items out and says no window was checked, and the fit question is not marked done", async () => {
    const v = await runAgenda({ note: AGENDA.replace(" The library room is booked from 14:00 to 16:00.", "") });
    expect(v.body).toMatch(/No booked window was found, so none was checked/);
  });
});

// ---------- a second fresh example (a kind of calculation Jarvis does not have): honest partial work, no invented figures ----------
// First observed result, kept: an extractive digest that quoted the correction (96 -> 120 cookies) and nothing else, with the checklist not produced.
describe("an unsupported kind of calculation reports what is missing instead of guessing", () => {
  it("parallel ovens with a one-time preheat: the sources are quoted, nothing is computed, the answer and the checklist are reported as not done", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); const clock = () => new Date(1_000_000); const proj = createProject(ctx, { name: "Bake sale", kind: "project" });
    const n1 = importText(ctx, { kind: "note", title: "Bake sale baking plan", text: "Bake sale on Saturday: we need 96 cookies on the table by 10:00. The oven bakes 24 cookies per tray and one tray takes 12 minutes. The oven needs 8 minutes to preheat, once. Nobody can start before 08:00. Priya is bringing a second oven.", at: "2026-11-10T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
    importText(ctx, { kind: "note", title: "Bake sale update", text: "Update for the bake sale: Priya's oven also bakes 24 cookies per tray but only arrives at 08:45. The first oven is unchanged. We now need 120 cookies, not 96.", at: "2026-11-14T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
    const g = submitGoal(ctx, { text: "Can we have all the cookies baked by 10:00? Give me a checklist of when each tray goes in.", origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock, leaseMs: 1000 });
    const v: any = resultView(ctx, g.resultId); const r = receipt(ctx, v.request.id);
    expect(v.analysis).toBeNull(); expect(v.body).toMatch(/We now need 120 cookies, not 96/); expect(v.body).not.toMatch(/Recommendation|Yes:|No:/);
    expect(v.outcomes.map((o: any) => `${o.kind}:${o.status}`)).toEqual(["answer:missing", "draft:missing"]); expect(v.outcomes[0].detail).toMatch(/no calculation for this kind of question yet/); expect(v.outcomes[1].detail).toMatch(/depends on a calculation that could not be done/);
    expect(v.completion).toBe("incomplete"); expect(r.plain).toMatch(/none of the requested parts could be done \(0 of 2/);
  });
});
