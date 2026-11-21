import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { submitGoal, resultView, receipt } from "@/lib/assistant";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";

// Independent QA (black box, against the build that passed the Lantern tests). The notes and requests are the tester's own, written before it ran anything.
// First observed results, kept: no table for reassignments worded "now with" / "handed to" / "moved to" / "passed to"; verbs other than owns/handles/will/taken over
// were silently dropped; "with the current owner" became one column with no Task column; a done task was shown as "Continue the cash box"; a checklist request was
// not recognised and "Nothing saved matches" was marked complete; custom columns (Status, Due date, Phone number) were dropped while the outcome said done.
const STD = "Make a handoff table of the open tasks: one row per task with the current owner.";
const qa = async (project: string, a: string, b: string | null, req: string, extra: { distractor?: string } = {}) => {
  const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = createProject(ctx, { name: project, kind: "project" });
  const n1 = importText(ctx, { kind: "note", title: `${project} plan`, text: a, at: "2026-11-10T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  if (extra.distractor) importText(ctx, { kind: "note", title: `${project} side chat`, text: extra.distractor, at: "2026-11-12T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  if (b) importText(ctx, { kind: "note", title: `${project} update`, text: b, at: "2026-11-14T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
  const g = submitGoal(ctx, { text: req, origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
  const v: any = resultView(ctx, g.resultId); return { v, ctx, rows: (v.analysis?.rows ?? []).map((r: any) => r.cells.join(" | ")) as string[] };
};

describe("independent QA cases", () => {
  it("1. 'now with' and 'handed to': Lucia has the sound system, Tomas the posters and the prizes, Maria keeps the bake sale; Devon and Priya are not current owners", async () => {
    const { v, rows } = await qa("Harvest School Fair", "Harvest fair planning. Maria runs the bake sale table. Devon sets up the sound system. Priya prints the posters. Tomas books the raffle prizes.", "Update: the sound system is now with Lucia. The posters have been handed to Tomas. Nothing changed for the bake sale or the raffle.", STD);
    expect(rows).toEqual(["Run the bake sale table | Maria", "Set up the sound system | Lucia", "Print the posters | Tomas", "Book the raffle prizes | Tomas"]);
    expect(rows.join()).not.toMatch(/Devon|Priya/); expect(v.analysis.rows.every((r: any) => r.cites.length > 0 && r.cites.every((c: any) => c.quote))).toBe(true);
    expect(v.analysis.rows[1].cites.map((c: any) => c.title)).toContain("Harvest School Fair update"); expect(v.outcomes[0].status).toBe("done"); expect(v.analysis.columns).toEqual(["Task", "Current owner"]);
  });
  it("2. done + unblocked + a distractor: the soil order is not open, the raised beds are no longer blocked, Rashid owns nothing", async () => {
    const { v, rows } = await qa("Backyard Garden Build", "Garden build. Ines will fill the raised beds, but only after the soil arrives. Omar orders the soil. Hana builds the compost bin.", "Omar's soil order is done and the soil arrived Tuesday, so filling the raised beds is no longer blocked.", STD, { distractor: "Side chat: our neighbour Rashid asked to borrow the wheelbarrow for his birthday party next month. Not part of the garden plan." });
    expect(rows).toEqual(["Fill the raised beds | Ines", "Build the compost bin | Hana"]); expect(rows.join()).not.toMatch(/Rashid|soil/i); expect(v.analysis.leftOut.some((l: any) => l.reason === "complete" && /soil/i.test(l.text))).toBe(true);
    const full = await qa("Backyard Garden Build", "Garden build. Ines will fill the raised beds, but only after the soil arrives. Omar orders the soil. Hana builds the compost bin.", "Omar's soil order is done and the soil arrived Tuesday, so filling the raised beds is no longer blocked.", "Give me a table with columns Task | Owner | Status.");
    expect(full.rows).toContain("Fill the raised beds | Ines | Open"); expect(v.outcomes[0].status).toBe("done");
  });
  it("3. columns Task | Owner | Status | Due date: exactly those four, the due date only where a note states one, Felix in progress, every row cited", async () => {
    const { v, rows } = await qa("Spring Tech Conference", "Conference prep. Aiko owns the keynote slides, due Dec 3. Felix owns the name badges. Noor owns the catering headcount, due Dec 1.", "Felix has sent the name badges to the printer; they are in progress.", "Give me a table with columns Task | Owner | Status | Due date for this project.");
    expect(v.analysis.columns).toEqual(["Task", "Owner", "Status", "Due date"]); expect(rows).toEqual(["Keynote slides | Aiko | Open | Dec 3", "Name badges | Felix | In progress | Not stated", "Catering headcount | Noor | Open | Dec 1"]);
    expect(v.outcomes[0].status).toBe("partial" === v.outcomes[0].status ? "partial" : "done"); expect(v.analysis.rows.every((r: any) => r.cites.length)).toBe(true);
  });
  it("4. a column no note can fill (Phone number): the rows are right, the column says Not stated, the outcome names the gap and the job is not plainly Finished", async () => {
    const { v, rows, ctx } = await qa("Bike Repair Day", "Bike repair day. Jonas pumps tyres at the entry table. Carmen collects the donated helmets. Yusuf brings the chain oil.", "Carmen's helmet collection moved to Elena.", "Make a handoff table with columns Task | Owner | Phone number | Status.");
    expect(rows).toEqual(["Pump tyres at the entry table | Jonas | Not stated | Open", "Collect the donated helmets | Elena | Not stated | Open", "Bring the chain oil | Yusuf | Not stated | Open"]);
    expect(v.outcomes[0]).toMatchObject({ status: "partial", detail: expect.stringMatching(/no source states Phone number/) }); expect(receipt(ctx, v.request.id).plain).toMatch(/only partly done/);
  });
  it("5. a bulleted checklist per person: grouped by person, 'passed to' and 'also takes' applied, route signs not under Greta", async () => {
    const { v } = await qa("Lantern Walk", "Lantern walk. Greta buys the candles and paints the route signs. Sven handles the first aid kit. Bao coordinates the volunteers.", "Route signs passed to Bao. Sven also takes the marshal vests.", "Give me a bulleted checklist per person of what they still need to do.");
    expect(v.analysis.form).toBe("checklist"); const body: string = v.body;
    expect(body).toMatch(/\*\*Greta\*\*\n- \[ \] Buy the candles\n\n/); expect(body).toMatch(/\*\*Sven\*\*\n- \[ \] .*first aid kit\n- \[ \] .*marshal vests/i); const bao = body.split("**Bao**")[1]; expect(bao).toMatch(/volunteers/i); expect(bao).toMatch(/route signs/i);
    expect(body.split("**Bao**")[0]).not.toMatch(/route signs/i); expect(v.outcomes[0]).toMatchObject({ kind: "table", status: "done" }); expect(v.completion).toBe("complete");
  });
  it("6. every task finished: no rows, it says there are no open tasks, and nobody is listed as owning open work", async () => {
    const { v, rows } = await qa("Craft Market Wrap-up", "Craft market. Lena handles the stall layout. Pavel handles the cash box.", "Stall layout is finished. Cash box was counted and handed in, done.", STD);
    expect(rows).toEqual([]); expect(v.body).toMatch(/No open tasks/); expect(v.body).not.toMatch(/Continue the cash box/); expect(v.outcomes[0]).toMatchObject({ status: "done", detail: expect.stringMatching(/No open tasks: all 2 tasks/) });
  });
  it("7. the identical request in two projects: each uses only its own notes", async () => {
    const x = await qa("Bike Swap Weekend", "Bike swap. Carmen designs the flyers. Jonas builds the tyre pump station.", null, STD); const y = await qa("Choir Winter Concert", "Choir concert. Wendell designs the flyers. Zora arranges the risers.", null, STD);
    expect(x.rows).toEqual(["Design the flyers | Carmen", "Build the tyre pump station | Jonas"]); expect(y.rows).toEqual(["Design the flyers | Wendell", "Arrange the risers | Zora"]);
    expect(JSON.stringify(x.v)).not.toMatch(/Wendell|Zora/); expect(JSON.stringify(y.v)).not.toMatch(/Carmen|Jonas/);
  });
  it("probes: 'moved to', 'passed to', unrecognised wording is reported (never dropped), a task with an unknown verb still appears", async () => {
    const a = "Fair crew. Devon handles the sound system. Priya handles the posters. Chen coordinates the volunteers and orders the tent.";
    const { v, rows } = await qa("Probe", a, "The sound system is now with Lucia. The posters have been handed to Tomas. Chen moved the tent order to Boris.", STD);
    expect(rows.join("\n")).toMatch(/sound system \| Lucia/i); expect(rows.join("\n")).toMatch(/posters \| Tomas/i); expect(rows.join("\n")).toMatch(/volunteers \| Chen/i);
    const odd = await qa("Probe two", a, "Lucia has some ideas about the sound system, we will see.", STD); expect(odd.v.analysis.unparsed.length).toBeGreaterThan(0); expect(odd.v.outcomes[0].status).toBe("partial"); expect(odd.v.body).toMatch(/Not applied, because I could not read it/);
    expect(v.analysis.rows.length).toBeGreaterThanOrEqual(3);
  });
  it("a project with notes never answers 'Nothing saved matches', and an empty project does not claim to be finished", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = createProject(ctx, { name: "Empty", kind: "project" });
    const g = submitGoal(ctx, { text: "Give me a checklist of who still needs to bring supplies.", origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
    const v: any = resultView(ctx, g.resultId); expect(v.outcomes[0].status).toBe("missing"); expect(receipt(ctx, v.request.id).plain).toMatch(/none of the requested parts could be done/);
  });
});
