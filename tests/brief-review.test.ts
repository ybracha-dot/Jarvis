import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { all, get } from "@/lib/db";
import { importText, registerSource, ingestItem, markSource } from "@/lib/evidence";
import { upsertCalendar } from "@/lib/bundle";
import { buildBrief, runBrief, briefFeedback, collectObligations, agendaFor } from "@/lib/brief";
import { eventBody, SOURCE_LABEL } from "@/lib/blackboard";

// Invented school scenario. Unusual wording must never quietly hide something important: what the rules do not recognise is shown for review.
const CLOCK = "2026-11-17T07:30:00-05:00";
const ORIGINAL = "Essay 2 outline is due Thursday, November 19 at 9:00 AM. Write a one-page outline.";
const ODD = "Update: outlines are expected on paper, stapled, at the start of class. Anything late will not be accepted.";
const mk = (text = ORIGINAL) => { const ctx = memCtx(CLOCK, "personal"); const a = importText(ctx, { kind: "note", title: "Essay 2 outline", text, at: "2026-11-10T12:00:00.000Z", label: "My class notes" }); return { ctx, a }; };
const build = (ctx: any, k = "t") => buildBrief(ctx, { occurrenceKey: k, kind: "ondemand" }).analysis;

describe("sentences the rules did not classify are shown, never dropped", () => {
  it("a requirement in unusual wording appears under review with its source sentence, not as a requirement", () => {
    const { ctx, a } = mk(); importText(ctx, { kind: "note", title: "Class announcement", text: ODD, at: "2026-11-16T23:00:00.000Z", label: "My class notes", corrects: a.id });
    const an = build(ctx);
    const p = an.priorities[0]; expect(p.requirements).toHaveLength(0);                                  // the rules found nothing to bring
    expect(an.review!.map((r) => r.sentence)).toEqual(expect.arrayContaining([expect.stringMatching(/expected on paper, stapled/), expect.stringMatching(/late will not be accepted/)]));
    expect(an.review![0].href).toMatch(/^\/evidence\/.+\?q=/);                                             // opens the exact note
    expect(an.review![0].kind).toBe("requirement");
  });
  it("confirming one makes it a cited requirement and the next brief says a requirement was added; ignoring one removes it; both can be taken back", () => {
    const { ctx, a } = mk(); importText(ctx, { kind: "note", title: "Class announcement", text: ODD, at: "2026-11-16T23:00:00.000Z", label: "My class notes", corrects: a.id });
    runBrief(ctx, { occurrenceKey: "morning:2026-11-17@08:00", kind: "scheduled" });
    const rv = build(ctx).review!; const paper = rv.find((r) => /on paper/.test(r.sentence))!; const late = rv.find((r) => /late will not/.test(r.sentence))!;
    briefFeedback(ctx, { key: paper.key, kind: "req_add", value: paper.id }); briefFeedback(ctx, { key: late.key, kind: "req_ignore", value: late.id });
    const an = build(ctx, "after");
    expect(an.review).toHaveLength(0);
    const p = an.priorities[0]; expect(p.requirements.map((r) => r.text)).toEqual(["Update: outlines are expected on paper, stapled, at the start of class"]);
    expect(p.evidence.some((e) => e.role === "requirement you confirmed" && /stapled/.test(e.quote))).toBe(true);
    expect(an.changes.map((c) => c.type)).toContain("requirement_added");
    briefFeedback(ctx, { key: paper.key, kind: "req_undo", value: paper.id }); briefFeedback(ctx, { key: late.key, kind: "req_undo", value: late.id });
    const back = build(ctx, "undo"); expect(back.review!.length).toBe(2); expect(back.priorities[0].requirements).toHaveLength(0);
  });
  it("a deadline in wording the date reader cannot parse is shown as a date to set, and setting it brings the note into the priorities", () => {
    const { ctx } = mk("Memo draft. The memo is due the 3rd of December, bring two copies."); 
    const an = build(ctx); const d = an.review!.find((r) => r.kind === "date")!; expect(d).toBeTruthy(); expect(d.sentence).toMatch(/3rd of December/);
    expect(an.priorities).toHaveLength(0);                                                                  // no deadline is invented
    briefFeedback(ctx, { key: d.key, kind: "due", value: "2026-12-03T23:59:00-05:00", note: "from the note: the 3rd of December" });
    const after = build(ctx, "set"); expect(after.review!.filter((r) => r.kind === "date")).toHaveLength(0);
    const item = [...after.priorities, ...after.alsoDue.map((x) => ({ key: x.key }))].find((x: any) => x.key === d.key); expect(item).toBeTruthy();
  });
  it("a note whose only content is unusual wording is still surfaced (it has no deadline and no requirement the rules know)", () => {
    const { ctx } = mk("Lab report 3. Reports must be typed and double-spaced, no more than 1200 words.");
    const an = build(ctx); expect(an.review!.some((r) => /typed and double-spaced/.test(r.sentence))).toBe(true);
    expect(collectObligations(ctx).obligations.some((o) => o.due === null && o.review.length > 0)).toBe(true);
  });
  it("optional wording and questions are not turned into reviews", () => {
    const { ctx } = mk("Essay 2 outline is due Thursday, November 19 at 9:00 AM. Consider a stapled copy if you like. Is a font choice required?");
    expect(build(ctx).review).toHaveLength(0);
  });
});

describe("the whole school workflow on invented inputs", () => {
  it("requirement, waiver, conflicting deadline, refresh failure and a missing calendar day, each stated and none invented", () => {
    const { ctx, a } = mk();
    importText(ctx, { kind: "note", title: "Announcement 1", text: "Please bring a printed alphanumeric outline to class.", at: "2026-11-12T12:00:00.000Z", label: "My class notes", corrects: a.id });
    runBrief(ctx, { occurrenceKey: "morning:2026-11-16@08:00", kind: "scheduled" });
    // waiver: a later note removes the printing requirement
    importText(ctx, { kind: "note", title: "Announcement 2", text: "No printed copies are needed any more. Upload it to Blackboard instead.", at: "2026-11-16T22:00:00.000Z", label: "My class notes", corrects: a.id });
        const wa = build(ctx, "w"); expect(wa.priorities[0].requirements.map((r) => r.text).join(" ")).not.toMatch(/printed alphanumeric/);
    expect(wa.changes.map((c) => c.type)).toContain("requirement_removed");
    // conflicting deadline: a calendar feed event says a different time and is not allowed to replace the note silently
    const src = registerSource(ctx, { kind: "calendar", label: SOURCE_LABEL, mode: "live", state: "ok" }); markSource(ctx, src.id, { state: "ok", attempt: true, success: true });
    ingestItem(ctx, { sourceId: src.id, externalId: "uid-1", kind: "calendar", title: "Essay 2 outline due", author: "Blackboard", at: "2026-11-12T10:00:00Z", body: eventBody({ uid: "uid-1", summary: "Essay 2 outline due", description: "", start: new Date("2026-11-21T04:59:00Z"), allDay: false, tz: "America/New_York", lastModified: "2026-11-12T10:00:00Z" } as any) });
    const cf = build(ctx, "c"); expect(cf.priorities[0].conflicts.length).toBe(1);
    // a source that cannot be refreshed is named and the brief says so
    markSource(ctx, src.id, { state: "failed", attempt: true, success: false, message: "Blackboard did not accept the link" } as any);
    const down = build(ctx, "d"); expect(down.gaps.join(" ")).toMatch(/unavailable|Blackboard/i);
    // missing calendar day: no calendar here lists the day, so nothing is called free
    upsertCalendar(ctx, "ics", [{ title: "Lecture", start: "2026-11-16T15:00:00Z", end: "2026-11-16T16:00:00Z" }, { title: "Pickup", start: "2026-11-20T15:00:00Z", end: "2026-11-20T16:00:00Z" }], "Calendar file");
    const ag = agendaFor(ctx, null); expect(ag.days.find((d) => d.day === "2026-11-18")?.covered ?? false).toBe(false);
    expect(get(ctx.db, "SELECT COUNT(*) n FROM brief_runs")!.n).toBeGreaterThanOrEqual(1);
    void all;
  });
});
