import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { submitGoal, resultView, receipt } from "@/lib/assistant";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";

// Independent QA round 2 (black box, after the first repair). Notes and requests are the tester's own, written before it ran anything.
// First observed results, kept: five of six requests (worded "who is doing what", "status board", "action items by owner", "what's left to do")
// were not recognised as an artifact request, so outcomes were empty and the receipt said "Finished" over a quote dump that listed stale owners and blockers;
// progressive tasks ("is ordering"), "is covering for", "is stalled until", "cannot ... until" were not read; a sentence about the FUTURE
// ("Chiara will record it once the edit is finished") was marked as a COMPLETED task; the digest invented a date change by pairing two unrelated dates.
const go = async (project: string, a: string, b: string, req: string, c?: string) => {
  const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = createProject(ctx, { name: project, kind: "project" });
  const n1 = importText(ctx, { kind: "note", title: `${project} notes`, text: a, at: "2026-11-10T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  importText(ctx, { kind: "note", title: `${project} update`, text: b, at: "2026-11-14T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
  if (c) importText(ctx, { kind: "note", title: `${project} reminder`, text: c, at: "2026-11-16T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  const g = submitGoal(ctx, { text: req, origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
  const v: any = resultView(ctx, g.resultId); return { v, ctx, rows: (v.analysis?.rows ?? []).map((r: any) => r.cells.join(" | ")) as string[] };
};

describe("independent QA round 2", () => {
  it("1. 'who is doing what': Gideon has the permit (Tamsin on leave) and is blocked on logos for the booklets; Rafael's quote arrived; the car park is not a task", async () => {
    const { v, rows } = await go("Harbor Lantern Festival", "Lantern festival prep catch-up. Tamsin is booking the harbour permit with the council. Gideon is printing the programme booklets. Rafael is sourcing the paper lanterns and is stuck waiting for the supplier's quote. Separately, the ferry car park is being resurfaced next month.", "Update on the festival. Tamsin has gone on leave, so Gideon is taking over the permit from her. The supplier's quote finally arrived, so Rafael is free to order the lanterns. The programme booklets cannot go to print until the sponsor logo files turn up.", "Who is doing what for the lantern festival?");
    expect(v.outcomes[0].kind).toBe("table"); const text = rows.join("\n");
    expect(text).toMatch(/Gideon \| Book the harbour permit/i); expect(text).not.toMatch(/Tamsin/); expect(text).toMatch(/Gideon \| Print the programme booklets \| Waiting until the sponsor logo files turn up/i); expect(text).toMatch(/Rafael \| Source the paper lanterns \| None reported/i); expect(text).not.toMatch(/supplier/i); expect(text).not.toMatch(/car park/i);
  });
  it("2. checklist grouped by person, 'Priya is covering for Omar', blockers set and cleared, lunch is not a task", async () => {
    const { v } = await go("Kestrel Billing Migration", "Billing migration standup. Odalys writes the cutover runbook. Omar rebuilds the invoice export job. Linus reviews the tax-rate mapping, which is waiting on finance's spreadsheet. Lunch is catered on Thursday.", "Correction from today: Priya is covering for Omar on the invoice export job while he is out. Finance sent the spreadsheet, so the tax-rate review can go ahead. The runbook is stalled until the staging database is restored.", "Give me a checklist grouped by person of what is still open.");
    const b: string = v.body; expect(b).toMatch(/\*\*Odalys\*\*\n- \[ \] .*runbook.*staging database/i); expect(b).toMatch(/\*\*Priya\*\*\n- \[ \] .*invoice export/i); expect(b).toMatch(/\*\*Linus\*\*\n- \[ \] .*tax-rate mapping\n/i);
    expect(b).not.toMatch(/\*\*Omar\*\*/); expect(b).not.toMatch(/lunch/i); expect(b).not.toMatch(/finance's spreadsheet/);
  });
  it("3. status board: the swap lands on the right water test, the calibration blocker clears, the panels are ordered, the birthday is not a task", async () => {
    const { v, rows } = await go("Greenhouse Build", "Greenhouse build sync. Bram will test the water pump. Ines will test the water sensor and needs calibration fluid first. Mei is ordering the glass panels. Mei's birthday cake is on Friday.", "Ines and Bram swapped their water tests, so the pump test is Ines's and the sensor test is Bram's. The calibration fluid has arrived. The pump test is blocked until the replacement hose comes in. Panels are ordered and arriving Monday.", "Status board for the greenhouse: task, owner, status.");
    expect(v.analysis.columns).toEqual(["Task", "Owner", "Status"]); const t = rows.join("\n");
    expect(t).toMatch(/water pump \| Ines \| Blocked\. Waiting until the replacement hose comes in/i); expect(t).toMatch(/water sensor \| Bram \| Open/i); expect(t).not.toMatch(/glass panels \| Mei \| (?:Open|Blocked)/i); expect(t).not.toMatch(/birthday|cake/i);
  });
  it("4. 'owner, the blocker, and the budget': the unfillable column is named, 400 pounds is nobody's budget, 'will record it once the edit is finished' is future work, not done", async () => {
    const { v, rows, ctx } = await go("Podcast Season Two", "Season two planning. Chiara is editing episode three. Dev is recording the intro jingle. Wen is booking the guest for episode five, but the guest has not answered yet. The studio hire last month cost 400 pounds.", "Dev cannot do the jingle after all, so Chiara will record it once the edit is finished. The guest for episode five has replied and confirmed. Episode three's edit is waiting on the raw audio from Wen's laptop.", "Make me a table of what is left with the owner, the blocker, and the budget for each item.");
    const t = rows.join("\n"); expect(v.analysis.columns).toEqual(["Task", "Owner", "Blocker", "Budget"]);
    expect(t).toMatch(/edit.*episode three \| Chiara \| Waiting for the raw audio from Wen's laptop \| Not stated/i); expect(t).toMatch(/record.*\| Chiara \| Waiting until the edit is finished \| Not stated/i); expect(t).not.toMatch(/Dev \|/); expect(t).not.toMatch(/400/);
    expect(v.analysis.leftOut.some((l: any) => l.reason === "complete" && /record|jingle|edit is finished/i.test(l.text))).toBe(false);
    expect(v.outcomes[0].status).toBe("partial"); expect(v.outcomes[0].detail).toMatch(/Budget/); expect(receipt(ctx, v.request.id).plain).toMatch(/only partly done/);
  });
  it("5. 'one row per person': Faye's first-aid supplies, Samuel's rota on hold, Noor's banners; school emails done; coffee machine is not a task", async () => {
    const { v, rows } = await go("Clinic Open Day", "Open day planning. Faye is ordering the banners and the first-aid stand supplies. Samuel is confirming the volunteer rota. Noor is emailing the local schools. The break-room coffee machine is broken again.", "Faye is overloaded, so Noor is picking up the banners. Samuel's rota is on hold until the council confirms the date. Noor already sent the school emails yesterday.", "Action items by owner, one row per person.");
    expect(v.analysis.rows).toHaveLength(3); const by = Object.fromEntries(rows.map((r) => [r.split(" | ")[0], r])); expect(by.Faye).toMatch(/first-aid/i); expect(by.Faye).not.toMatch(/banners/i); expect(by.Samuel).toMatch(/rota.*council confirms the date/i); expect(by.Noor).toMatch(/banners/i); expect(by.Noor).not.toMatch(/schools/i); expect(rows.join()).not.toMatch(/coffee/i);
  });
  it("6. 'What's left to do? Just bullets.': the menu is Lucía's, the door is blocked by rain, the machine is fixed, a reminder with no owner is a task", async () => {
    const { v } = await go("Dockside Cafe Reopening", "Cafe reopening. Hana is designing the new menu. Pavel is fixing the espresso machine, needs a part from the supplier. Lucía is painting the front door. The street festival is on the 30th.", "Pavel got the part and the espresso machine is fixed. Hana's menu is now Lucía's job as Hana is travelling. The front door is blocked by rain; painting can't start.", "What's left to do? Just bullets.", "Reminder to self: book the health inspection with the council, I will do that.");
    const b: string = v.body; expect(v.analysis.form).toBe("checklist"); expect(b).toMatch(/\*\*Lucía\*\*\n- \[ \] .*menu/i); expect(b).toMatch(/front door.*rain|rain.*door/i); expect(b).toMatch(/health inspection/i); expect(b).not.toMatch(/\*\*Hana\*\*/); expect(b).not.toMatch(/festival/i); expect(b.split("**Left out")[0]).not.toMatch(/espresso/i);
  });
  it("the digest no longer invents a date change from two unrelated dates in a corrected note pair", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = createProject(ctx, { name: "Cake and panels", kind: "project" });
    const n1 = importText(ctx, { kind: "note", title: "Sync", text: "Greenhouse sync. Mei's birthday cake is on Friday Nov 13. Bram will test the pump.", at: "2026-11-10T12:00:00.000Z", projectId: proj.id, label: "N", localOnly: true });
    importText(ctx, { kind: "note", title: "Update", text: "Panels are arriving Monday Nov 16. The pump test moved to Ines.", at: "2026-11-14T12:00:00.000Z", projectId: proj.id, label: "N", localOnly: true, corrects: n1.id });
    const g = submitGoal(ctx, { text: "What changed for the greenhouse?", origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
    expect((resultView(ctx, g.resultId) as any).body).not.toMatch(/was replaced by/);
  });
});
