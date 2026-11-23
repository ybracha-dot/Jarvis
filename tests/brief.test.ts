import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { all, get, getSetting } from "@/lib/db";
import { importText, registerSource, ingestItem, markSource, addCorrection } from "@/lib/evidence";
import { upsertCalendar } from "@/lib/bundle";
import { confirmDay } from "@/lib/calendar-cover";
import { buildBrief, runBrief, briefNow, briefFeedback, reserveBrief, briefToday, agendaFor, sharePreview } from "@/lib/brief";
import { saveBriefConfig } from "@/lib/brief-config";
import { eventBody, SOURCE_LABEL } from "@/lib/blackboard";
import { resultView } from "@/lib/assistant";
import { schedulerStatus } from "@/lib/scheduler";

// The scenario is invented: a class announcement moves a deadline forward and asks for something to bring. Nothing here is the user's own material.
const ORIGINAL = "Essay 2 outline is due Tuesday, November 24 at 11:59 PM. Write a one-page outline.";
const CORRECTION = "Announcement: the Essay 2 outline is now due Thursday, November 19 at 9:00 AM. Please bring a printed alphanumeric outline to class.";
const CAL = [{ title: "Lecture", start: "2026-11-17T15:00:00Z", end: "2026-11-17T16:30:00Z" }, { title: "TAMID meeting", start: "2026-11-18T23:00:00Z", end: "2026-11-19T00:00:00Z" }, { title: "Section", start: "2026-11-19T15:00:00Z", end: "2026-11-19T16:00:00Z" }];
const CLOCK = "2026-11-17T07:30:00-05:00";
function world(o: { calendar?: boolean; correction?: boolean; shareable?: boolean } = {}) {
  const ctx = memCtx(CLOCK, "personal"); const share = o.shareable ? { shareable: true } : {};
  const a = importText(ctx, { kind: "note", title: "Essay 2 outline", text: ORIGINAL, at: "2026-11-10T12:00:00.000Z", label: "My class notes", ...share });
  if (o.correction !== false) importText(ctx, { kind: "note", title: "Class announcement, Nov 16", text: CORRECTION, at: "2026-11-16T23:00:00.000Z", label: "My class notes", corrects: a.id, ...share });
  if (o.calendar !== false) upsertCalendar(ctx, "ics", CAL, "Calendar file");
  return { ctx, a };
}
const feedEvent = (ctx: any, uid: string, summary: string, description: string, start: string, modified = "2026-11-12T10:00:00Z") => {
  const src = registerSource(ctx, { kind: "calendar", label: SOURCE_LABEL, mode: "live", state: "ok" }); markSource(ctx, src.id, { state: "ok", attempt: true, success: true });
  return ingestItem(ctx, { sourceId: src.id, externalId: uid, kind: "calendar", title: summary, author: "Blackboard", at: modified, body: eventBody({ uid, summary, description, start: new Date(start), allDay: false, tz: "America/New_York", lastModified: modified, cancelled: false, sequence: 0 }) });
};

describe("the first brief", () => {
  it("derives the deadline, the requirement and a feasible block from the supplied sources, and says it is a baseline", () => {
    const { ctx } = world(); const { analysis: a } = buildBrief(ctx, { occurrenceKey: "t1", kind: "ondemand" });
    expect(a.baseline).toBe(true); expect(a.leadText).toMatch(/first brief.*baseline/i); const p = a.priorities[0];
    expect(p.title).toBe("Essay 2 outline"); expect(p.next).toBe("Bring a printed alphanumeric outline to class");
    expect(p.due).toMatchObject({ label: "Thu, Nov 19, 9:00 AM", assumedTime: false }); expect(p.deadlineHistory[0].label).toMatch(/Was Tue, Nov 24, 11:59 PM.*Replaced by “Class announcement, Nov 16”/);
    expect(p.estimate).toMatchObject({ minutes: 60, basis: "default" }); expect(p.estimate.label).toMatch(/estimate/i);
    expect(p.blocks.map((b) => b.step)).toEqual(["work", "print"]);
    // the student's blocks are separate from the instructor's deadline, finish before it, and miss every calendar event
    for (const b of p.blocks) { expect(Date.parse(b.end)).toBeLessThanOrEqual(Date.parse("2026-11-19T14:00:00Z")); for (const e of CAL) expect(Date.parse(b.start) < Date.parse(e.end) && Date.parse(b.end) > Date.parse(e.start)).toBe(false); expect(Date.parse(b.start)).toBeGreaterThan(Date.parse(CLOCK)); }
    expect(p.evidence.map((e) => e.role).sort()).toEqual(["deadline", "requirement"]); expect(p.evidence.every((e) => e.href.startsWith("/evidence/ev_"))).toBe(true);
  });
  it("cites the exact sentences: every quote is present in the note it points at", () => {
    const { ctx } = world(); const { sources } = buildBrief(ctx, { occurrenceKey: "t1", kind: "ondemand" });
    for (const s of sources) { const it: any = get(ctx.db, "SELECT body FROM evidence_items WHERE id=?", s.itemId); expect(it.body.includes(s.quote), s.quote).toBe(true); }
    expect(sources.some((s) => s.role === "superseded deadline" && /November 24/.test(s.quote))).toBe(true);
  });
});

describe("what changed since the last brief", () => {
  it("a later correction moves the deadline forward: it leads, cites the announcement, keeps the original, and the requirement appears", () => {
    const { ctx } = world({ correction: false }); const first = runBrief(ctx, { occurrenceKey: "morning:2026-11-16@08:00", kind: "scheduled" }); expect(first.baseline).toBe(true);
    expect(buildBrief(ctx, { occurrenceKey: "x", kind: "ondemand" }).analysis.alsoDue[0].label).toBe("Tue, Nov 24, 11:59 PM");   // due in 7 days: listed, not yet a priority
    const orig: any = get(ctx.db, "SELECT id FROM evidence_items WHERE title='Essay 2 outline'");
    importText(ctx, { kind: "note", title: "Class announcement, Nov 16", text: CORRECTION, at: "2026-11-16T23:00:00.000Z", label: "My class notes", corrects: orig.id });
    const { analysis: a } = buildBrief(ctx, { occurrenceKey: "morning:2026-11-17@08:00", kind: "scheduled" });
    expect(a.baseline).toBe(false); expect(a.lead).toMatchObject({ type: "due_moved", title: "Essay 2 outline", days: -5 }); expect(a.leadText).toMatch(/now due Thu, Nov 19, 9:00 AM.*It was Tue, Nov 24, 11:59 PM \(moved up 5 days\)/);
    expect(a.lead!.source!.title).toBe("Class announcement, Nov 16"); expect(a.changes.map((c) => c.type)).toContain("requirement_added");
    const p = a.priorities[0]; expect(p.due!.at).toBe("2026-11-19T14:00:00.000Z"); expect(p.deadlineHistory).toHaveLength(1); expect(p.evidence.some((e) => /Class announcement/.test(e.label))).toBe(true);
    expect(get(ctx.db, "SELECT COUNT(*) n FROM evidence_items WHERE title='Essay 2 outline' AND tombstone=0")!.n).toBe(1);             // the original is preserved
  });
  it("says so plainly when nothing material changed", () => {
    const { ctx } = world(); runBrief(ctx, { occurrenceKey: "morning:2026-11-16@08:00", kind: "scheduled" });
    const { analysis: a } = buildBrief(ctx, { occurrenceKey: "morning:2026-11-17@08:00", kind: "scheduled" }); expect(a.baseline).toBe(false); expect(a.lead).toBeNull(); expect(a.leadText).toMatch(/^No material change since your last brief/);
  });
});

describe("a correction added later from the note itself", () => {
  it("lives in the same source as the original (same privacy), supersedes the earlier date, and shows up as the next brief's lead", () => {
    const { ctx, a } = world({ correction: false }); runBrief(ctx, { occurrenceKey: "m0", kind: "scheduled" });
    const r = addCorrection(ctx, a.id, "Update: the Essay 2 outline is now due Wednesday, November 18 at 8:00 AM.", "2026-11-17T11:00:00.000Z");
    expect(get(ctx.db, "SELECT source_id FROM evidence_items WHERE id=?", r.id)!.source_id).toBe(get(ctx.db, "SELECT source_id FROM evidence_items WHERE id=?", a.id)!.source_id);
    const { analysis } = buildBrief(ctx, { occurrenceKey: "m1", kind: "scheduled" }); expect(analysis.lead).toMatchObject({ type: "due_moved", days: -6 }); expect(analysis.priorities[0].due!.label).toBe("Wed, Nov 18, 8:00 AM");
    expect(() => addCorrection(ctx, a.id, "  ")).toThrow(/Write what changed/);
  });
});

describe("one brief per occurrence", () => {
  it("a retry, a restart or a second worker saves nothing new for the same occurrence", () => {
    const { ctx } = world(); const a = runBrief(ctx, { occurrenceKey: "morning:2026-11-17@08:00", kind: "scheduled" }); const b = runBrief(ctx, { occurrenceKey: "morning:2026-11-17@08:00", kind: "scheduled" });
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(b.resultId).toBe(a.resultId);
    expect(get(ctx.db, "SELECT COUNT(*) n FROM results WHERE kind='brief'")!.n).toBe(1); expect(get(ctx.db, "SELECT COUNT(*) n FROM inbox WHERE event_key LIKE 'brief-ready:%'")!.n).toBe(1);
    const v: any = resultView(ctx, a.resultId); expect(v.kind).toBe("brief"); expect(v.analysis.type).toBe("brief"); expect(v.receipt.plain).toBe("Finished"); expect(v.body).toMatch(/Bring a printed alphanumeric outline/);
  });
  it("an on-demand request twice in a minute with nothing changed is the same brief; a correction makes a new one", () => {
    const { ctx } = world(); const a = briefNow(ctx); const b = briefNow(ctx); expect(b.resultId).toBe(a.resultId);
    briefFeedback(ctx, { key: briefToday(ctx, schedulerStatus(ctx)).analysis!.priorities[0].key, kind: "estimate", value: 90 }); const c = briefNow(ctx); expect(c.resultId).not.toBe(a.resultId);
  });
});

describe("a time slot is claimed only where a calendar says it is free", () => {
  it("with no calendar, Jarvis proposes no block and says why, and still gives the deadline and next action", () => {
    const { ctx } = world({ calendar: false }); const p = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0];
    expect(p.blocks).toEqual([]); expect(p.blockNote).toMatch(/No calendar has been read.*cannot say when you are free/); expect(p.next).toMatch(/Bring a printed/); expect(p.due!.label).toBe("Thu, Nov 19, 9:00 AM");
  });
  it("days outside the calendar's coverage are unknown, never free", () => {
    const { ctx } = world(); ctx.db.exec("DELETE FROM blocks WHERE source='ics'"); upsertCalendar(ctx, "ics", [{ title: "Section", start: "2026-11-19T15:00:00Z", end: "2026-11-19T16:00:00Z" }], "Calendar file");   // covers only Thursday
    const p = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0];
    for (const b of p.blocks) expect(new Date(b.start).toISOString().slice(0, 10)).toBe("2026-11-19");
    expect(p.blocks.length === 0 ? p.blockNote : "").not.toBe(null);
  });
  it("a calendar that only covers days after the deadline cannot justify a slot", () => {
    const { ctx } = world(); ctx.db.exec("DELETE FROM blocks WHERE source='ics'"); upsertCalendar(ctx, "ics", [{ title: "Later", start: "2026-11-25T15:00:00Z", end: "2026-11-25T16:00:00Z" }], "Calendar file");
    const p = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0]; expect(p.blocks).toEqual([]); expect(p.blockNote).toMatch(/unknown|cannot/i);
  });
  it("classes, prayer and Shabbat the user entered are busy and are not proposed over; Jarvis computes none of them", () => {
    const { ctx } = world(); saveBriefConfig(ctx, { classes: [{ label: "Strategy", days: [2], start: "11:00", end: "17:00" }], prayers: [{ label: "Mincha", days: [2], start: "17:00", end: "18:30" }], enabled: true });
    const p = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0];
    for (const b of p.blocks) { const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(b.start)); const s = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(b.start)); if (day === "2026-11-17") expect(s < "11:00" || s >= "18:30" || b.step === "print").toBe(true); }
    expect(getSetting<any[]>(ctx.db, "weekly_busy", []).map((w) => w.kind).sort()).toEqual(["class", "prayer"]);
  });
  it("too little free time is reported as a shortfall, not hidden", () => {
    const { ctx } = world(); briefFeedback(ctx, { key: buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0].key, kind: "estimate", value: 1100 });
    const p = buildBrief(ctx, { occurrenceKey: "t2", kind: "ondemand" }).analysis.priorities[0]; expect(p.blocks).toEqual([]); expect(p.blockNote).toMatch(/short by|not enough/i); expect(p.estimate.basis).toBe("user");
  });
});

describe("suggestions for different priorities", () => {
  it("never overlap each other: each priority plans around the ones above it", () => {
    const { ctx } = world(); importText(ctx, { kind: "note", title: "Poster deck", text: "The poster deck is due Thursday, November 19 at 3:00 PM. Please bring a printed handout.", at: "2026-11-12T12:00:00.000Z", label: "My class notes" });
    importText(ctx, { kind: "note", title: "Lab report 4", text: "Lab report 4 is due Thursday, November 19 at 11:59 PM. Please upload a PDF to the course site.", at: "2026-11-12T12:00:00.000Z", label: "My class notes" });
    const pr = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities; expect(pr.length).toBe(3);
    const all2 = pr.flatMap((p) => p.blocks).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)); expect(all2.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < all2.length; i++) expect(Date.parse(all2[i].start), `${all2[i - 1].end} vs ${all2[i].start}`).toBeGreaterThanOrEqual(Date.parse(all2[i - 1].end));
  });
});

describe("reserving, dismissing and correcting", () => {
  it("one click reserves the proposed blocks locally, a repeat adds nothing, and the next brief shows them as reserved", () => {
    const { ctx } = world(); const key = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0].key;
    const r1 = reserveBrief(ctx, { key }); expect(r1.reserved).toBe(2); expect(r1.note).toMatch(/this computer only/); const r2 = reserveBrief(ctx, { key }); expect(r2.reserved).toBe(0);
    expect(get(ctx.db, "SELECT COUNT(*) n FROM blocks WHERE source='brief'")!.n).toBe(2); const p = buildBrief(ctx, { occurrenceKey: "t3", kind: "ondemand" }).analysis.priorities[0]; expect(p.blocks).toEqual([]); expect(p.reserved).toHaveLength(2);
    expect(all(ctx.db, "SELECT sync FROM blocks WHERE source='brief'").every((b) => b.sync === "local-only")).toBe(true);
  });
  it("a reservation survives a reload: the reservation is a stored row, not page state", () => {
    const { ctx } = world(); const key = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0].key; reserveBrief(ctx, { key });
    expect(briefToday(ctx, schedulerStatus(ctx)).analysis).toBeNull(); runBrief(ctx, { occurrenceKey: "o1", kind: "ondemand" }); expect(briefToday(ctx, schedulerStatus(ctx)).analysis!.priorities[0].reserved).toHaveLength(2);
  });
  it("a deadline that moves earlier than a reserved block says so", () => {
    const { ctx } = world(); const key = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0].key; reserveBrief(ctx, { key });
    briefFeedback(ctx, { key, kind: "due", value: "2026-11-17T12:00:00.000Z" }); const p = buildBrief(ctx, { occurrenceKey: "t4", kind: "ondemand" }).analysis.priorities[0];
    expect(p.why.join(" ")).toMatch(/reserved.*after the new deadline/i);
  });
  it("dismissing removes it from the next brief, lists it as dismissed, undo restores it, and a deadline that moves earlier resurfaces it", () => {
    const { ctx } = world(); runBrief(ctx, { occurrenceKey: "m0", kind: "scheduled" }); const key = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0].key;
    briefFeedback(ctx, { key, kind: "dismiss" }); const a = buildBrief(ctx, { occurrenceKey: "t5", kind: "ondemand" }).analysis; expect(a.priorities).toHaveLength(0); expect(a.dismissed.map((x) => x.key)).toEqual([key]);
    briefFeedback(ctx, { key, kind: "undismiss" }); expect(buildBrief(ctx, { occurrenceKey: "t6", kind: "ondemand" }).analysis.priorities).toHaveLength(1);
    briefFeedback(ctx, { key, kind: "dismiss" }); const orig: any = get(ctx.db, "SELECT id FROM evidence_items WHERE title='Essay 2 outline'");
    importText(ctx, { kind: "note", title: "Class announcement, Nov 17", text: "Update: the Essay 2 outline is now due Wednesday, November 18 at 9:00 AM.", at: "2026-11-17T11:00:00.000Z", label: "My class notes", corrects: get(ctx.db, "SELECT id FROM evidence_items WHERE title LIKE 'Class announcement, Nov 16'")!.id as string });
    void orig; expect(buildBrief(ctx, { occurrenceKey: "t7", kind: "ondemand" }).analysis.priorities.map((p) => p.due!.label)).toEqual(["Wed, Nov 18, 9:00 AM"]);
  });
  it("a corrected deadline sits above the sources, the old one is kept, and the next brief says you made the correction", () => {
    const { ctx } = world(); runBrief(ctx, { occurrenceKey: "m0", kind: "scheduled" }); const key = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0].key;
    briefFeedback(ctx, { key, kind: "due", value: "2026-11-18T14:00:00.000Z" }); const a = buildBrief(ctx, { occurrenceKey: "t8", kind: "ondemand" }).analysis;
    expect(a.priorities[0].due!.label).toBe("Wed, Nov 18, 9:00 AM"); expect(a.priorities[0].deadlineHistory.some((h) => /Was Thu, Nov 19, 9:00 AM.*your correction/.test(h.label))).toBe(true); expect(a.changes.some((c) => c.type === "you_corrected")).toBe(true);
  });
});

describe("inputs that are down", () => {
  it("an unreachable calendar feed is named, the supported parts are still finished, and the last good read is not advanced", async () => {
    const { ctx } = world({ calendar: false }); feedEvent(ctx, "ev1", "Essay 2 outline", "", "2026-11-19T14:00:00Z");
    const src: any = get(ctx.db, "SELECT id, last_success_at FROM evidence_sources WHERE label=?", SOURCE_LABEL); const before = src.last_success_at;
    markSource(ctx, src.id, { state: "failed", message: "Could not reach Blackboard: offline. Nothing was changed.", attempt: true });
    const a = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis;
    expect(a.inputs.find((i) => i.label === SOURCE_LABEL)).toMatchObject({ state: "unavailable" }); expect(a.gaps.join(" ")).toMatch(/Blackboard calendar feed: unavailable/); expect(a.priorities[0].next).toMatch(/Bring a printed/);
    expect((get(ctx.db, "SELECT last_success_at FROM evidence_sources WHERE id=?", src.id) as any).last_success_at).toBe(before);
  });
  it("a deadline only a calendar feed knows is shown with a request for the original instructions, not an invented requirement", () => {
    const ctx = memCtx(CLOCK, "personal"); feedEvent(ctx, "ev2", "Memo 3 due", "", "2026-11-18T23:59:00Z");
    const p = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0]; expect(p.requirements).toEqual([]); expect(p.asks.join(" ")).toMatch(/original instructions/); expect(p.why.join(" ")).toMatch(/calendar, which does not include the instructions/);
  });
  it("a calendar event and a note that disagree about a deadline are a conflict: both shown, the earlier used, neither silently chosen", () => {
    const ctx = memCtx(CLOCK, "personal"); importText(ctx, { kind: "note", title: "Essay 2 outline", text: "Essay 2 outline is due Friday, November 20 at 5:00 PM.", at: "2026-11-10T12:00:00.000Z", label: "My class notes" });
    feedEvent(ctx, "ev3", "Essay 2 outline due", "", "2026-11-19T23:00:00Z"); const a = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis; const p = a.priorities[0];
    expect(p.conflicts).toHaveLength(1); expect(p.conflicts[0].label).toMatch(/Blackboard calendar feed says Thu, Nov 19/);
  });
  it("a note that assigns work to someone else is left out and said so", () => {
    const ctx = memCtx(CLOCK, "personal"); importText(ctx, { kind: "note", title: "Event prep", text: "Rina Patel will print the invitations by Thursday, November 19. Essay 2 outline is due Friday, November 20.", at: "2026-11-10T12:00:00.000Z", label: "n" });
    const a = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis; expect(a.leftOut.join(" ")).toMatch(/assigned to Rina/);
  });
});

describe("erasing the private workspace", () => {
  it("removes the notes, the briefs, the corrections you made and what Claude was allowed to read, not just the schedule", async () => {
    const { wipe } = await import("@/lib/demo"); const { setSourceSharing, sourcesSharing, logShare } = await import("@/lib/share"); const { searchEvidence } = await import("@/lib/evidence");
    const { ctx } = world(); runBrief(ctx, { occurrenceKey: "m0", kind: "scheduled" }); setSourceSharing(ctx, sourcesSharing(ctx)[0].id, true); logShare(ctx, "disclosed", "result", "x", { tool: "get_result" });
    const key = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.priorities[0].key; briefFeedback(ctx, { key, kind: "dismiss" }); reserveBrief(ctx, { key }).reserved;
    wipe(ctx);
    for (const t of ["evidence_items", "evidence_sources", "evidence_facts", "results", "requests", "brief_runs", "brief_feedback", "claude_grants", "share_log", "projects", "blocks"]) expect(get(ctx.db, `SELECT COUNT(*) n FROM ${t}`)!.n, t).toBe(0);
    expect(searchEvidence(ctx, ["essay", "outline"])).toEqual([]);
  });
});

describe("the agenda beside the brief", () => {
  it("keeps the instructor's deadline, a suggested start, a reservation and real busy time distinct", () => {
    const { ctx } = world(); const a = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis; let ag = agendaFor(ctx, a);
    const kinds = (d: string) => ag.days.find((x) => x.day === d)!.items.map((i) => i.kind);
    expect(kinds("2026-11-17")).toEqual(expect.arrayContaining(["busy", "proposed"])); expect(ag.days.find((x) => x.day === "2026-11-19")!.items.some((i) => i.kind === "deadline" && /Due: Essay 2 outline/.test(i.label))).toBe(true);
    expect(ag.days.flatMap((d) => d.items).filter((i) => i.kind === "proposed").every((i) => /not reserved yet/.test(i.detail ?? ""))).toBe(true);
    reserveBrief(ctx, { key: a.priorities[0].key }); ag = agendaFor(ctx, buildBrief(ctx, { occurrenceKey: "t2", kind: "ondemand" }).analysis);
    expect(ag.days.find((x) => x.day === "2026-11-17")!.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["busy", "reserved"])); expect(ag.days.flatMap((d) => d.items).some((i) => i.kind === "proposed" && /Essay 2/.test(i.label))).toBe(false);
  });
  it("labels a day no calendar covers as unknown, and says coverage is judged from the first and last event; with no calendar nothing is called free", () => {
    const { ctx } = world(); const ag = agendaFor(ctx, null); expect(ag.coverage.join(" ")).toMatch(/lists events on 3 days \(2026-11-17 to 2026-11-19\).*it is a snapshot/); expect(ag.days.every((d) => d.covered === (d.day >= "2026-11-17" && d.day <= "2026-11-19"))).toBe(true);
    const bare = memCtx(CLOCK, "personal"); const g = agendaFor(bare, null); expect(g.days.every((d) => !d.covered && /unknown, not free/.test(d.coverageNote))).toBe(true); expect(g.coverage).toEqual([]);
  });
  it("previews what Claude would receive: titles of shared notes, only a count of what is kept out", () => {
    const { ctx } = world(); importText(ctx, { kind: "note", title: "Shared poster", text: "The poster is due Friday, November 20 at 3:00 PM.", at: "2026-11-12T12:00:00.000Z", label: "Shared notes", shareable: true });
    const p = sharePreview(ctx); expect(p.included.map((x) => x.title)).toEqual(["Shared poster"]); expect(p.withheld).toBe(1); expect(JSON.stringify(p)).not.toMatch(/Essay 2/);
  });
});

describe("a calendar export with events on Monday and Friday and nothing on Wednesday", () => {
  const clockMon = "2026-11-16T08:00:00-05:00";
  const mk = () => { const ctx = memCtx(clockMon, "personal"); importText(ctx, { kind: "note", title: "Poster", text: "The poster is due Friday, November 20 at 5:00 PM. Please bring a printed handout.", at: "2026-11-10T12:00:00.000Z", label: "n" });
    upsertCalendar(ctx, "ics", [{ title: "Lecture", start: "2026-11-16T15:00:00Z", end: "2026-11-16T16:00:00Z" }, { title: "Review", start: "2026-11-20T15:00:00Z", end: "2026-11-20T16:00:00Z" }], "week.ics"); return ctx; };
  it("keeps Wednesday unknown (and Tuesday, Thursday): a quiet day inside the span is not evidence that it is free", () => {
    const ctx = mk(); const ag = agendaFor(ctx, null); const by = (d: string) => ag.days.find((x) => x.day === d); void by;
    const days = agendaFor(ctx, buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis).days; const known = Object.fromEntries(days.map((d) => [d.day, d.covered]));
    expect(known["2026-11-16"]).toBe(true); expect(known["2026-11-20"]).toBe(true);
    const wed = agendaFor(ctx, null).days; void wed;
    const p = buildBrief(ctx, { occurrenceKey: "t2", kind: "ondemand" }).analysis.priorities[0];
    for (const b of p.blocks) expect(["2026-11-16", "2026-11-20"]).toContain(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(b.start)));
    expect(agendaFor(ctx, null).coverage.join(" ")).toMatch(/lists events on 2 days.*Days in between with no events stay unknown until you confirm them/);
  });
  it("Wednesday becomes usable only when you confirm it, is labelled as your statement, and can be taken back", () => {
    const ctx = mk(); const wedKey = "2026-11-18"; const dayOf = (ag: any, d: string) => ag.days.find((x: any) => x.day === d);
    (ctx as any).setNow("2026-11-18T07:00:00-05:00"); let ag = agendaFor(ctx, null); expect(dayOf(ag, wedKey)).toMatchObject({ covered: false, confirmedByYou: false }); expect(dayOf(ag, wedKey).coverageNote).toMatch(/unknown, not free/);
    confirmDay(ctx, wedKey, true); ag = agendaFor(ctx, null); expect(dayOf(ag, wedKey)).toMatchObject({ covered: true, confirmedByYou: true }); expect(dayOf(ag, wedKey).coverageNote).toMatch(/You confirmed.*cannot check/);
    confirmDay(ctx, wedKey, false); expect(dayOf(agendaFor(ctx, null), wedKey)).toMatchObject({ covered: false, confirmedByYou: false });
  });
});
