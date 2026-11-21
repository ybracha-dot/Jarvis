import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { importText } from "@/lib/evidence";
import { handleUtterance } from "@/lib/study-guide";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { resultView, understand } from "@/lib/assistant";
import { analyzePlan, isPlanRequest } from "@/lib/plan";
import { itemsOf } from "./decision.test";

// Regression data recorded from the first independent QA attempt on a request the assistant had never seen: room and trainer time,
// and kiln firings against a deadline. The first observed results were wrong (see MORNING.md). These tests hold the repaired behaviour.
// The facts live here only. The planner recognises quantities, windows, durations and dates, not these names.
function seed(ctx: any, o: { headcount?: "both" | "old" } = {}) {
  const imp = (kind: string, title: string, text: string, at: string, author?: string) => importText(ctx, { kind, title, text, at: `2026-11-${at}T15:00:00.000Z`, author, label: author ? `Mail from ${author}` : "Notes" });
  imp("email", "Room A is taken", "Room A holds max 8 people and is booked all day Thursday Nov 19 for a different meeting. Ines, Facilities", "06", "Ines Varga");
  imp("email", "Room availability for Thursday", "Room B has a fire limit of 18 people and is free all day Thursday Nov 19. Room C holds 30 people but is booked until 12:30 on Thursday Nov 19. Ines, Facilities", "10", "Ines Varga");
  imp("note", "Safety training setup", "Safety training is Thursday Nov 19, 90 minutes per session. Trainer Hollis is available 10:00 to 16:00 and needs a 30 minute break between sessions. 14 people registered so far.", "11");
  imp("email", "Fire warden training", "Fire warden training is Thursday Nov 26 in Room B, max 12 attendees, 60 minutes per session. Teodor, HR", "12", "Teodor Lang");
  if (o.headcount !== "old") imp("note", "Registration update", "Correction: the warehouse team signed up too, so 20 people are now registered for safety training, not 14.", "14");
  imp("email", "Raku workshop kiln", "For the raku workshop on Saturday Nov 28 the small kiln takes 8 pieces per firing: 4 hours of heat and 6 hours of cooling, load-in of participants at 10:00. Priya", "09", "Priya Nair");
  imp("email", "Kiln rules for members", "Hi, kiln rules for members. The big kiln holds 24 pieces per glaze firing. A glaze firing is 10 hours of heat followed by 14 hours of cooling, and you can only unload after the full 24 hours. Loading and starting a firing is allowed only between 09:00 and 17:00, and unloading is allowed only between 09:00 and 17:00. The big kiln is free from Tuesday Nov 17, either at 09:00 or at 15:00, depending on whether Marcus unloads his previous firing on time. I will confirm which slot on Monday evening. Priya", "11", "Priya Nair");
  imp("note", "Harbor Craft Fair plan", "Harbor Craft Fair: load-in is Saturday Nov 21 at 08:00 sharp. Pottery ready to glaze-fire: 46 pieces (22 mugs, 16 bowls, 8 vases). Everything must be fired and unloaded before load-in.", "12");
  imp("email", "Re: kiln sharing for cups", "For my cups the big kiln takes 30 pieces per firing and cooling is 20 hours. My Winter Market load-in is Saturday Dec 5 at 10:00, so I need the kiln again the week before. Marcus", "13", "Marcus Bell");
  imp("note", "Update to piece count", "Correction: I finished 4 more vases, so I now have 50 pieces to fire, not 46.", "14");
  imp("email", "Harbor Craft Fair schedule change", "Hello vendors, the hall is needed on Saturday, so load-in moves from Saturday 08:00 to Friday Nov 20 at 12:00. Please confirm you can make it. Dana, Harbor Craft Fair organiser", "15", "Dana Okafor");
}
const SAFETY = "Where and when should I run Thursday's safety training so that everyone registered can attend?";
const KILN = "Can I get all my pottery glaze-fired and unloaded before the craft fair load-in, and when do I start each firing?";
const plan = (req: string, o?: any) => { const ctx = memCtx("2026-11-16T10:00:00-05:00"); seed(ctx, o); return analyzePlan(itemsOf(ctx), req)!; };

describe("time and capacity: recognising the request", () => {
  it("treats scheduling questions as answers, not as drafts, even when a draft is also asked for", () => {
    for (const q of [SAFETY, KILN, `${KILN} Draft a short note to Priya booking the kiln slots.`]) { expect(isPlanRequest(q)).toBe(true); expect(understand(memCtx("2026-11-16T10:00:00-05:00"), q).deliverable).toBe("answer"); }
    expect(isPlanRequest("Draft a thank-you note to Priya")).toBe(false);
  });
});

describe("where and when so that everyone fits", () => {
  it("20 registered people, a 90 minute session and a 30 minute break: Room C after 12:30 seats everyone in one session; Room B needs two; Room A is booked", () => {
    const p = plan(SAFETY); const r = p.recommendation;
    expect(r.kind).toBe("recommend"); expect(r.label).toBe("Room C"); expect(r.headline).toMatch(/Room C.*Thu Nov 19.*12:30 to 14:00.*one session seats all 20/);
    const o = (n: string) => p.options.find((x) => x.option === n)!;
    expect(o("Room B").verdict).toBe("works"); expect(o("Room B").summary).toMatch(/2 sessions.*10:00–11:30 and 12:00–13:30/);
    expect(o("Room A").verdict).toBe("fails"); expect(o("Room A").checks.join(" ")).toMatch(/Booked all day/);
    expect(p.computation.join(" ")).toMatch(/20 people ÷ 18 seats = 1\.11, so 2 sessions needed/);
    expect(p.computation.join(" ")).toMatch(/Room C: .*12:30 to 16:00.*2 sessions/);                 // 12:30–14:00, break, 14:30–16:00
  });
  it("the later correction (14 to 20) is what flips the answer, and the earlier number stays visible as replaced", () => {
    const old = plan(SAFETY, { headcount: "old" }); expect(old.recommendation.kind).toBe("recommend"); expect(old.recommendation.label).toBe("Room B"); expect(old.recommendation.headline).toMatch(/10:00 to 11:30.*all 14/);
    const now = plan(SAFETY); expect(now.inputs.find((r) => r.label === "People to seat")!.value).toBe("20"); expect(now.setAside.find((r) => r.label === "Earlier headcount")).toMatchObject({ value: "14" });
  });
  it("another day's limit for the same room is set aside with the reason, not mixed in", () => {
    const p = plan(SAFETY); const sa = p.setAside.find((r) => /Room B/.test(r.label) && /Nov 26/.test(r.note ?? ""))!; expect(sa).toBeTruthy(); expect(sa.note).toMatch(/not Thu Nov 19/);
    expect(p.inputs.find((r) => r.label === "Room B: capacity")!.value).toBe("18");
  });
  it("a missing input is named instead of guessed", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); importText(ctx, { kind: "note", title: "Safety training setup", text: "Safety training is Thursday Nov 19, 90 minutes per session. 20 people registered.", at: "2026-11-11T15:00:00.000Z", label: "Notes" });
    const p = analyzePlan(itemsOf(ctx), SAFETY)!; expect(p.recommendation.kind).toBe("insufficient"); expect(p.recommendation.question).toMatch(/available|room/);
  });
});

describe("how many runs, when each starts, and whether it is done before the deadline", () => {
  it("50 pieces at 24 per run is 3 runs; with the 09:00 slot the last unload is Fri 09:00, with the 15:00 slot it is Fri 15:00 which misses the new 12:00 load-in: the answer depends on the slot, and one question asks which", () => {
    const p = plan(KILN); const r = p.recommendation;
    expect(r.kind).toBe("ask"); expect(p.computation.join(" ")).toMatch(/50 ÷ 24 per run = 2\.08, rounded up to 3 runs \(24 \+ 24 \+ 2\)/);
    expect(r.headline).toMatch(/Yes if you can start at Tue Nov 17 09:00/); expect(r.headline).toMatch(/last unload Fri Nov 20 09:00, 3 hours before Fri Nov 20 12:00/); expect(r.headline).toMatch(/Tue Nov 17 15:00 instead would finish 3 hours too late/);
    expect(r.question).toMatch(/Which start slot.*Tue Nov 17 09:00 or Tue Nov 17 15:00/); expect(r.nextAction).toMatchObject({ kind: "confirm_slot" }); expect(r.nextAction!.text).toMatch(/Priya Nair/);
    const a = p.options.find((o) => /09:00/.test(o.option))!; expect(a.verdict).toBe("works"); expect(a.steps.map((s) => s.when)).toEqual(["Tue Nov 17 09:00", "Wed Nov 18 09:00", "Wed Nov 18 09:00", "Thu Nov 19 09:00", "Thu Nov 19 09:00", "Fri Nov 20 09:00"]);
    expect(p.options.find((o) => /15:00/.test(o.option))!.verdict).toBe("fails");
  });
  it("the correction to 50 pieces is what makes it 3 runs (46 would be 2), and the superseded deadline and count are shown as replaced", () => {
    const p = plan(KILN); expect(p.inputs.find((r) => /Pieces to process/.test(r.label))!.value).toBe("50"); expect(p.setAside.find((r) => r.label === "Earlier count")).toMatchObject({ value: "46" });
    expect(p.inputs.find((r) => r.label === "Must be finished before")!.value).toBe("Fri Nov 20 12:00"); expect(p.setAside.find((r) => r.label === "Earlier deadline")!.value).toBe("Sat Nov 21 08:00");
  });
  it("another person's batch and another process are set aside with the reason, and the different capacity is flagged only because it would change the run count", () => {
    const p = plan(KILN); const labels = p.setAside.map((r) => `${r.label}|${r.note}`).join("\n");
    expect(labels).toMatch(/big kiln: 30 pieces per run\|.*someone else|big kiln: 30 pieces per run\|.*their own batch/); expect(labels).toMatch(/small kiln: 8 pieces per run\|stated for .*raku workshop/);
    expect(p.setAside.some((r) => /Winter Market|Dec 5/.test(r.quote ?? ""))).toBe(true);        // the other person's load-in is not the deadline
    expect(p.notes.join(" ")).toMatch(/30 pieces.*2 runs instead of 3/); expect(p.recommendation.headline).not.toMatch(/Dec 5/);
  });
  it("the organiser's request to confirm the new load-in time is surfaced, not buried", () => { expect(plan(KILN).notes.join(" ")).toMatch(/Dana Okafor asks you to confirm: “Please confirm you can make it/); });
});

describe("the full request path", () => {
  const fresh = () => { const ctx = memCtx("2026-11-16T10:00:00-05:00"); seed(ctx); let t = 1_000_000; return { ctx, clock: () => new Date(t) }; };
  const ask = async (ctx: any, clock: any, text: string) => { const r: any = handleUtterance(ctx, { text, via: "text" }); await processQueue(ctx, { workerId: "w1", handlers: HANDLERS, clock, leaseMs: 1000 }); return r; };
  it("the original failure: a scheduling question that also asks for a draft gives the schedule, the question and a draft to the right person, not a garbled pitch draft", async () => {
    const { ctx, clock } = fresh(); const r = await ask(ctx, clock, `${KILN} Draft a short note to Priya booking the kiln slots.`); const v: any = resultView(ctx, r.reply.data.resultId);
    expect(v.kind).toBe("answer"); expect(v.body).toMatch(/Yes if you can start at Tue Nov 17 09:00/); expect(v.body).not.toMatch(/you mentioned you would/i);
    expect(v.analysis.type).toBe("plan"); expect(v.draft).toMatchObject({ to: "Priya Nair" }); expect(v.draft.body).toMatch(/Tue Nov 17 09:00.*Start run 1 of 3 \(24 pieces\)/s); expect(v.draft.body).toMatch(/Fri Nov 20 09:00/); expect(v.draft.body).not.toMatch(/Following up: our project|^Hi Priya,\n\nPriya, you/);
    expect(v.sources.some((s: any) => /Kiln rules/.test(s.title) && /24 pieces/.test(s.quote))).toBe(true); expect(v.flags.some((f: any) => f.kind === "missing_input")).toBe(true);
    expect(v.verification?.ok ?? true).toBe(true);
  });
  it("the room question reads notes that share no words with it, and says it is a rules answer", async () => {
    const { ctx, clock } = fresh(); const r = await ask(ctx, clock, SAFETY); const v: any = resultView(ctx, r.reply.data.resultId);
    expect(v.body).toMatch(/Use Room C on Thu Nov 19, 12:30 to 14:00/); expect(v.analysis.type).toBe("plan"); expect(v.sources.some((s: any) => /Room availability/.test(s.title))).toBe(true); expect(v.mode).toBe("rules");
  });
});
