import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { submitGoal, resultView, receipt } from "@/lib/assistant";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";

// Independent QA round 3 (black box, after two repairs): new people (non-English names, surnames with particles), passive voice, cancellations,
// moved deadlines, "also agreed to", two people on one task, and new request shapes. Notes and requests are the tester's own.
// First observed results, kept: 11 of 12 did not build the requested artifact. Wrong, not merely missing: a cancellation ("will not build the stall frame anymore")
// shown as a live task; a deadline stated as "by 1 May" reported as "Not stated"; "No open tasks / Finished" while a sentence was silently dropped; a table
// invented for "Who is responsible for the printing?"; first names replaced by surnames ("Lambert:") in promises; stale promises shown as live.
const go = async (project: string, a: string, b: string | null, req: string, c?: string) => {
  const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = createProject(ctx, { name: project, kind: "project" });
  const n1 = importText(ctx, { kind: "note", title: `${project} notes`, text: a, at: "2026-11-10T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  if (b) importText(ctx, { kind: "note", title: `${project} update`, text: b, at: "2026-11-14T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
  if (c) importText(ctx, { kind: "note", title: `${project} extra`, text: c, at: "2026-11-16T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  const g = submitGoal(ctx, { text: req, origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
  const v: any = resultView(ctx, g.resultId); return { v, ctx, rows: (v.analysis?.rows ?? []).map((r: any) => r.cells.join(" | ")) as string[], text: String(v.body ?? "") };
};

describe("independent QA round 3", () => {
  it("C9 cancellation and changed deadlines (active voice): stroopwafels 4 May, price signs 5 May (not 3), paper bags 1 May, the cancelled frame is not a live row", async () => {
    const { rows, v } = await go("Tulip Market Stall", "Hanneke de Vries will bake the stroopwafels by 4 May. Mateusz Zieliński will build the stall frame by 2 May. Fatou Diop will make the price signs by 3 May.", "Mateusz will not build the stall frame anymore because we are renting one instead. Hanneke must also order the paper bags by 1 May. The price signs are now due on 5 May.", "Put it in a table I can paste into a spreadsheet: task, person, deadline.");
    expect(v.analysis.columns).toEqual(["Task", "Person", "Deadline"].map((x) => x === "Person" ? "Owner" : x)); const t = rows.join("\n");
    expect(t).toMatch(/stroopwafels \| Hanneke de Vries \| 4 May/i); expect(t).toMatch(/price signs \| Fatou Diop \| 5 May/i); expect(t).toMatch(/paper bags \| Hanneke de Vries \| 1 May/i); expect(t).not.toMatch(/stall frame/i); expect(v.analysis.leftOut.some((l: any) => l.reason === "cancelled")).toBe(true);
  });
  it("C1 passive voice, moved deadline, passive reassignment: flyers 27th, hall to Priya, sound check unchanged, snacks 22nd", async () => {
    const { rows, v } = await go("Lantern Festival", "The flyers will be printed by Marta Kowalczyk before the 20th of December. Søren Bjørnsen is responsible for booking the community hall, and the sound check is to be arranged by Aiko Tanaka. Lemonade and snacks will be bought by Marta on the 22nd.", "Update from the planning call: the flyer printing has been pushed back to the 27th, and the hall booking is being taken care of by Priya Raman instead of Søren. The sound check stays with Aiko.", "Put it in a table I can paste into a spreadsheet: task, person, deadline.");
    const t = rows.join("\n"); expect(t).toMatch(/print.*flyers \| Marta Kowalczyk \| (?:the )?27th/i); expect(t).toMatch(/hall.*\| Priya Raman \| Not stated/i); expect(t).not.toMatch(/Søren/); expect(t).toMatch(/sound check \| Aiko Tanaka/i); expect(t).toMatch(/snacks.*\| Marta Kowalczyk \| (?:the )?22nd/i);
    expect(v.analysis.rows.every((r: any) => r.cites.length > 0)).toBe(true);
  });
  it("C2 a task only in the correction and a cancelled one: numbered by deadline, the painting is not a to-do", async () => {
    const { v, text } = await go("Rzeszow Bakery Opening", "Zoë Lambert will order the two deck ovens from the supplier. Bartosz Wójcik is going to paint the shopfront, and the counter delivery is expected to be signed for by Pia Nyström on 3 March. Chairs and tables are Bartosz's job as well, due by 10 March.", "The shopfront painting is cancelled because the landlord is doing it himself. We also forgot that the business has to be registered with the city office by Zoë, no later than 15 February.", "Give me a numbered list by deadline.");
    const list = text.split("**Left out")[0]; expect(list).not.toMatch(/paint/i); expect(list).toMatch(/1\. .*regist.*15 February.*Zoë Lambert/i); expect(list).toMatch(/2\. .*counter delivery.*3 March.*Pia Nyström/i); expect(v.outcomes[0].kind).toBe("table");
  });
  it("C3 two people on one task, one-line summary per person: Tomasz is not left on the sorting, Kofi's pickup moved", async () => {
    const { text, v } = await go("Harbour Clean-up", "Ingrid Haugen and Tomasz Nowak will jointly sort the recycling at the harbour. Kofi Mensah picks up the gloves and bags on Friday, and Ingrid is also going to write the thank-you email to the volunteers.", "Kofi's pickup has been moved to Saturday morning. Tomasz is away that weekend, so the sorting will be done by Ingrid alone.", "A one-line summary per person.");
    expect(v.analysis.rows.map((r: any) => r.owner).sort()).toEqual(["Ingrid Haugen", "Kofi Mensah"]); const ing = v.analysis.rows.find((r: any) => r.owner === "Ingrid Haugen"); expect(ing.cells.join(" ")).toMatch(/sort the recycling/i); expect(ing.cells.join(" ")).toMatch(/thank-you email/i); expect(text).not.toMatch(/Tomasz.*recycling/);
  });
  it("C4 partly supported: the list is built, the hours-per-task half is reported as missing and the job says partly done", async () => {
    const { v, ctx } = await go("Solstice Retreat", "Sven Lindqvist is booking the minibus for the retreat, and Amara Okafor handles the vegetarian catering order. Nuria Castells will print the name badges by 5 June.", "The minibus booking has to be done by 1 June. Amara's catering order is confirmed with the kitchen.", "Give me a numbered list by deadline and also say how many hours each task will take.");
    expect(v.outcomes.some((o: any) => o.kind === "table")).toBe(true); expect(v.outcomes.length).toBeGreaterThanOrEqual(2); expect(v.completion).not.toBe("complete"); expect(receipt(ctx, v.request.id).plain).toMatch(/only partly done|none of the requested/);
  });
  it("C5 cannot be produced: no tasks or owners, so no table is built and nothing is invented", async () => {
    const { v, rows } = await go("Gdansk Venue Search", "We looked at three venues in Gdańsk this week. The Hanseatic hall is too small, and the shipyard loft is too loud for a conference. Nobody has agreed on anything yet.", "Ola thinks the shipyard loft is still the best option, but she would like to see a quote before anyone commits.", "Make me a simple status table.");
    expect(rows).toEqual([]); expect(v.outcomes[0].status).toBe("missing"); expect(v.body).not.toMatch(/In progress|Open \|/);
  });
  it("C6 'what does Léa still have to do': only Léa's open task, the ordered panels are done, no false 'no open tasks'", async () => {
    const { v, text } = await go("Greenhouse Build", "Léa Dubois, Hamid Al-Sayed and Wanjiru Kamau have split the greenhouse build so that Léa orders the glass panels, the timber frame is cut by Hamid, and the irrigation pipes are laid by Wanjiru, all before the end of the month.", "The glass panels have been ordered. Léa also agreed to book the soil delivery for the 9th.", "So what does Léa still have to do?");
    const list = text.split("**Left out")[0]; expect(list).toMatch(/\*\*Léa Dubois\*\*\n- \[ \] Book the soil delivery/i); expect(list).not.toMatch(/Hamid|Wanjiru|glass panels/i); expect(v.body).not.toMatch(/No open tasks/);
  });
  it("C7 'who is responsible for the printing': Chiara Bellini prints the booklets now, Dragan only the cables, no invented table of unrelated work", async () => {
    const { v, text } = await go("Museum Night", "The programme booklets will be printed by Dragan Petrović, with Yuki Sato proofreading them first. Guided-tour signs are going to be laminated by Yuki after that.", "Dragan's printer broke down, so the booklets will be printed by Chiara Bellini's workshop instead.", "Who is responsible for the printing?", "Dragan will bring the extension cables on Saturday.");
    expect(text).toMatch(/Chiara Bellini/); expect(text).not.toMatch(/extension cables/); expect(text).not.toMatch(/Dragan[^\n]*\| (?:Print|Bring)/); expect(v.analysis.rows).toHaveLength(1);
  });
  it("C8 'a simple status table', cancelled task and moved deadline: cable inspection 19 April, diversion cancelled", async () => {
    const { rows, v } = await go("Bridge Inspection Rotterdam", "Joost van der Berg will inspect the north pier cables by 12 April. Fatima Zahra El Idrissi is to submit the safety report to the municipality, and the traffic diversion signs will be put out by Joost and Fatima together on 20 April.", "The traffic diversion is cancelled since the road stays closed anyway. The cable inspection has been moved to 19 April.", "a simple status table");
    const t = rows.join("\n"); expect(t).toMatch(/inspect the north pier cables.*Joost van der Berg/i); expect(t).toMatch(/diversion signs \| .* \| Cancelled/i); expect(rows.join()).not.toMatch(/In progress/); expect(t).toMatch(/Fatima Zahra El Idrissi/);
  });
  it("C10 shared task and a task only in the correction: numbered by deadline, kiln cleaning on 15 June", async () => {
    const { text } = await go("Pottery Studio", "Gustavo Ribeiro and Mei Lin will clean the kiln together by 12 June. Gustavo will write the safety checklist by 9 June. Elif Yıldız will email the glaze supplier by 8 June.", "The kiln cleaning is moved to 15 June. Elif will also phone the electrician by 10 June.", "Give me a numbered list by deadline.");
    const list = text.split("**Left out")[0]; expect(list).toMatch(/1\. .*email the glaze supplier.*8 June.*Elif/i); expect(list).toMatch(/2\. .*safety checklist.*9 June.*Gustavo/i); expect(list).toMatch(/3\. .*phone the electrician.*10 June/i); expect(list).toMatch(/4\. .*clean the kiln.*15 June.*Gustavo Ribeiro and Mei Lin/i);
  });
  it("C11 status table plus an unsupported manager column: the table is built, the gap is named, signatures are done", async () => {
    const { rows, v } = await go("Grant Application", "Rasmus Eriksen will draft the grant application by 3 July. Bilal Haddad will collect the signatures by 1 July.", "Bilal collected the signatures yesterday.", "A simple status table, plus the name of each person's manager.");
    expect(rows.join("\n")).toMatch(/draft the grant application.*Rasmus Eriksen.*Open/i); expect(rows.join("\n")).toMatch(/collect the signatures \| Bilal Haddad \| Done/i); expect(v.outcomes[0].status).not.toBe("done");
  });
  it("C12 one-line summary per person with a cancelled task and an addition: Pedro does not hang the gate", async () => {
    const { v, text } = await go("Fence Repaint", "Nikolai Orlov will order the paint, Ayesha Rahman will sand the doors and Pedro Álvarez will hang the new gate. Pedro will also buy the hinges.", "Ayesha will sand the windows as well. The gate is cancelled.", "A one-line summary per person.");
    const who = (n: string) => v.analysis.rows.find((r: any) => r.owner === n)?.cells.join(" ") ?? ""; expect(who("Pedro Álvarez")).toMatch(/hinges/i); expect(who("Pedro Álvarez")).not.toMatch(/gate/i); expect(who("Ayesha Rahman")).toMatch(/doors/i); expect(who("Nikolai Orlov")).toMatch(/paint/i); expect(text).toBeTruthy();
  });
  it("a corrected note's promises are labelled as possibly stale instead of shown as live", async () => {
    const { text } = await go("Stale promises", "Zoë Lambert will order the ovens. Tomasz Nowak will bring the chairs.", "Tomasz is away, so Ingrid brings the chairs.", "What changed?");
    expect(text).toMatch(/Zoë Lambert: .*\(from a note you later corrected/); expect(text).not.toMatch(/^- Lambert:/m);
  });
});
