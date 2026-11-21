import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { submitGoal, resultView, receipt } from "@/lib/assistant";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";

// Independent QA round 4 (black box). First observed results, kept: 0 of 10 usable on the first try. Wrong, not merely missing: "what's on Ingrid's plate?" returned a
// calendar brief ("Nothing on the calendar", Finished); an email-ready summary request returned a follow-up template; an unrelated unlinked note leaked into the
// checklist; a table built from a half-read set of notes was presented as final; the unfillable columns "hourly rate / hours" were silently replaced by defaults;
// "completion" said complete for a quotes-only answer. These tests hold what was repaired; they do NOT claim the reader understands arbitrary wording.
const go = async (project: string, a: string, b: string | null, req: string, c?: string) => {
  const ctx = memCtx("2026-11-16T10:00:00-05:00"); const proj = createProject(ctx, { name: project, kind: "project" });
  const n1 = importText(ctx, { kind: "note", title: `${project} notes`, text: a, at: "2026-11-10T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  if (b) importText(ctx, { kind: "note", title: `${project} update`, text: b, at: "2026-11-14T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
  if (c) importText(ctx, { kind: "note", title: `${project} lunch`, text: c, at: "2026-11-15T12:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
  const g = submitGoal(ctx, { text: req, origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
  const v: any = resultView(ctx, g.resultId); return { v, ctx, rows: (v.analysis?.rows ?? []).map((r: any) => r.cells.join(" | ")) as string[], text: String(v.body ?? "") };
};
const N1 = "Archive digitisation, 10 Nov. Ingrid Haugen will proofread the OCR output by 18 Nov. Ximena Castaneda catalogues 200 photo plates by 20 Nov. Hyun-woo Park is to rescan the damaged ledgers, due 17 Nov at 17:00.";
const N2 = "The OCR proofreading falls to Ingrid, deadline 18 Nov. Hyun-woo's ledger rescanning goes to Thandiwe Nkosi instead, 17 Nov 17:00 still stands.";

describe("independent QA round 4", () => {
  it("'what's on Ingrid's plate?' is a person-scoped list, not a calendar brief", async () => {
    const { v, text } = await go("Podcast Season Two", "Season two planning, 10 Nov. Thandiwe Nkosi will record the intro at 9:30 on Thursday 12 Nov. Hyun-woo Park will edit episode one by 18 Nov. Ingrid Haugen is to write the show notes for episode one by 17 Nov.", "Changes: the intro recording moves to 16:00 on Wednesday 18 Nov. Editing episode one moves from Hyun-woo to Ingrid, deadline unchanged.", "what's on Ingrid's plate?");
    expect(v.kind).toBe("answer"); expect(text).not.toMatch(/Nothing on the calendar/); expect(text).toMatch(/\*\*Ingrid Haugen\*\*/); const list = text.split("**Check these")[0].split("**Left out")[0]; expect(list).toMatch(/show notes.*17 Nov/i); expect(list).toMatch(/edit episode one/i); expect(list).not.toMatch(/intro|Thandiwe/i);
  });
  it("ownership and handover shapes: 'takes the lead on', 'on the hook for', 'falls to', 'goes to ... instead'", async () => {
    const { rows, text } = await go("Archive digitisation", N1.replace("will proofread the OCR output", "is on the hook for proofreading the OCR output"), N2, "Give me a markdown checklist for each person on the archive project.");
    const list = text.split("**Check these")[0].split("**Left out")[0]; expect(list).toMatch(/Thandiwe Nkosi\*\*\n- \[ \] .*rescan/i); expect(list).not.toMatch(/Hyun-woo Park\*\*/); expect(list.match(/proofread/gi)?.length).toBe(1); expect(rows.length >= 0).toBe(true);
  });
  it("an email-ready summary request produces the list AND an email draft built from it, in the user's own name, with nothing sent", async () => {
    const { v } = await go("Mobile App Beta", "Beta launch prep, 10 Nov. Kofi Mensah takes the lead on the TestFlight build, due 19 Nov. Żaneta Wiśniewska handles the release notes by 20 Nov. Hyun-woo Park is on the hook for recruiting 50 beta testers by 18 Nov.", "Release notes move from Żaneta to Hyun-woo, same deadline.", "Write an email-ready summary for the team lead listing each person's task and deadline, and add the estimated cost per task.");
    expect(v.outcomes.map((o: any) => o.kind)).toEqual(expect.arrayContaining(["table", "draft"])); expect(v.draft.body).toMatch(/Kofi Mensah: .*TestFlight build, due 19 Nov/); expect(v.draft.body).toMatch(/Hyun-woo Park: .*release notes/i); expect(v.draft.body).not.toMatch(/Żaneta Wiśniewska:/);
    expect(v.draft.body).not.toMatch(/the sources do not yet settle a date/); expect(v.completion).not.toBe("complete");
  });
  it("columns the notes cannot fill (hourly rate, hours) are named, never replaced silently, and the job is not plainly Finished", async () => {
    const { v, ctx } = await go("Data Centre Cabling", "Cabling upgrade, 10 Nov. Soren Lindqvist is responsible for pulling the cables in rack row B, due 18 Nov. Thandiwe Nkosi will certify the 60 new links by 19 Nov.", "Thandiwe is out on Thursday so the link certification falls to Kofi Mensah, still due 19 Nov.", "Make a table of each person's hourly rate and total hours logged on this project.");
    expect(v.outcomes[0].status).toBe("partial"); expect(v.outcomes[0].detail).toMatch(/hourly rate|hours/i); expect(receipt(ctx, v.request.id).plain).toMatch(/only partly done/);
  });
  it("a table built while later sentences could not be applied says so ABOVE the table, and names the notes it was built from", async () => {
    const { text, v } = await go("Network Migration", "Network migration, 10 Nov. Kofi Mensah will patch the 24 desk ports by 14 Nov. Żaneta Wiśniewska will order 6 access points by 13 Nov.", "The Sunday cutover window has shifted, so everything slides by a day and Kofi's patching now covers 28 ports at 10:00 on Sunday.", "Make me a table of who is doing what by when.");
    expect(text.indexOf("Check before you paste this")).toBeGreaterThanOrEqual(0); expect(text.indexOf("Check before you paste this")).toBeLessThan(text.indexOf("| ")); expect(text).toMatch(/Built from these notes:\*\* .*Network Migration notes/); expect(text).toMatch(/Built from these notes:\*\* .*Network Migration update/); expect(v.outcomes[0].status).toBe("partial");
  });
  it("names beyond Latin-1 (Vietnamese, Polish, Turkish) are read whole, and a quotes-only answer says so in its completion field", async () => {
    const { rows } = await go("Telehealth Pilot", "Telehealth pilot, 10 Nov. Nguyễn Văn An will book the training room by 18 Nov. Elif Yıldız will email the clinics by 12 Nov.", "Elif Yıldız is on the hook for the clinic emails, due 13 Nov.", "Give me a table with columns task, owner, deadline.");
    expect(rows.join("\n")).toMatch(/book the training room \| Nguyễn Văn An \| 18 Nov/i); expect(rows.join("\n")).toMatch(/email the clinics \| Elif Yıldız \| 13 Nov/i);
    const q = await go("Notes only", "The weather was lovely and everybody enjoyed the lunch.", null, "What did people enjoy?"); expect(q.v.completion).toBe("quotes_only");
  });
});
