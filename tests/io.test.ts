import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { memCtx, count, tmpDataDir } from "./helpers";
import { seedDemo, replay, BUNDLE } from "@/lib/demo";
import { previewImport, commitImport, parseIcs, parseEml, htmlToText } from "@/lib/imports";
import { get, all, setSetting, getSetting } from "@/lib/db";
import { listDecisions } from "@/lib/decisions";
import { tick, runNow, scanInbox, inboxDir, occurrencesBetween, schedulerStatus, heartbeat, interpretNeedsRead, weeklyFindings } from "@/lib/scheduler";
import { captureSink, enqueue, drainOutbox, quietUntil, Transport } from "@/lib/notify";
import { Router, Transport as MT } from "@/lib/router";
import { scanCalendarFeed, connections } from "@/lib/adapters";
import { advise, addAdvisorSource } from "@/lib/advisors";
import { today } from "@/lib/today";

const at = (ctx: any, iso: string) => (ctx as any).setNow(iso);
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a1
SUMMARY:Finance lecture
DTSTART;TZID=America/New_York:20261119T100000
DTEND;TZID=America/New_York:20261119T111500
END:VEVENT
BEGIN:VEVENT
UID:a1
SUMMARY:Finance lecture duplicate
DTSTART;TZID=America/New_York:20261119T100000
DTEND;TZID=America/New_York:20261119T111500
END:VEVENT
BEGIN:VEVENT
UID:a2
SUMMARY:Weekly standup
DTSTART:20261120T140000Z
DURATION:PT30M
RRULE:FREQ=WEEKLY
END:VEVENT
BEGIN:VEVENT
UID:a3
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261126
END:VEVENT
BEGIN:VEVENT
UID:a4
SUMMARY:Bad zone
DTSTART;TZID=Eastern Standard Time:20261124T100000
DTEND;TZID=Eastern Standard Time:20261124T110000
END:VEVENT
END:VCALENDAR`;
const EML = `From: Prof Example <prof@example.edu>
Subject: =?UTF-8?B?W1NTMjAxXSBFc3NheSAyIHVwZGF0ZQ==?=
Date: Mon, 16 Nov 2026 09:12:00 -0500
Message-ID: <abc123@example.edu>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="B1"

--B1
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable

Essay 2 is now due Wednesday, November 18 at 5 p.m. Bring a printed excerpt of articles 4, 13, 16 and 31.
--B1
Content-Type: application/pdf; name="rubric.pdf"
Content-Disposition: attachment; filename="rubric.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--B1--
`;

describe("imports", () => {
  it("parses ICS with time zones, durations and explicit unsupported cases", () => {
    const r = parseIcs(ICS);
    expect(r.events.map((e) => e.title)).toEqual(["Finance lecture", "Weekly standup"]);
    expect(r.events[0].start).toBe("2026-11-19T15:00:00.000Z");
    expect(r.events[1].end).toBe("2026-11-20T14:30:00.000Z");
    expect(r.warnings.join()).toMatch(/Duplicate UID/);
    expect(r.unsupported.join("|")).toMatch(/RRULE/);
    expect(r.unsupported.join("|")).toMatch(/All-day/);
    expect(r.unsupported.join("|")).toMatch(/Unsupported time zone/);
  });
  it("parses an .eml with encoded subject, quoted-printable body and an attachment without text", () => {
    const m = parseEml(EML);
    expect(m.subject).toBe("[SS201] Essay 2 update");
    expect(m.text).toMatch(/^Essay 2 is now due Wednesday/);
    expect(m.attachments).toEqual(["rubric.pdf"]);
    expect(m.messageId).toBe("<abc123@example.edu>");
  });
  it("previews before commit; the email path and the source path make one decision and one task change", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T10:00:00-05:00");
    const p = previewImport(ctx, { filename: "update.eml", content: EML });
    expect(p.needs).toEqual([]);                                // course found from "SS201" in the subject
    expect(p.unsupported.join()).toMatch(/rubric\.pdf/);
    expect(count(ctx, "source_revisions")).toBe(1);             // nothing committed yet
    const a = commitImport(ctx, p.token);
    expect(a.decisions).toBe(1);
    replay(ctx, "bulletin");                                    // same announcement from the LMS too
    expect(count(ctx, "decisions", "kind='deadline_moved'")).toBe(1);
    expect(get(ctx.db, "SELECT due_at FROM tasks")!.due_at).toBe("2026-11-18T22:00:00.000Z");
    expect(count(ctx, "tasks")).toBe(1);
  });
  it("handles malformed, oversized, binary, PDF and unsupported files with clear errors", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const e = (req: any) => { try { previewImport(ctx, req); return null; } catch (x: any) { return x; } };
    expect(e({ filename: "x.json", content: "{nope" })).toMatchObject({ status: 422 });
    expect(e({ filename: "x.json", content: JSON.stringify({ schemaVersion: 2 }) })?.message).toMatch(/not a valid/i);
    expect(e({ filename: "x.ics", content: "hello" })).toMatchObject({ status: 422 });
    expect(e({ filename: "x.eml", content: "no headers here" })).toMatchObject({ status: 422 });
    expect(e({ filename: "big.txt", content: "a".repeat(2 * 1024 * 1024 + 10) })).toMatchObject({ status: 413 });
    expect(e({ filename: "a.pdf", content: "%PDF-1.4" })).toMatchObject({ status: 415 });
    expect(e({ filename: "a.docx", content: "x" })).toMatchObject({ status: 415 });
    expect(e({ filename: "bin.txt", content: "ab\u0000cd" })).toMatchObject({ status: 415 });
    expect(e({ filename: "empty.txt", content: "   " })).toMatchObject({ status: 422 });
    expect(count(ctx, "source_revisions")).toBe(1);
  });
  it("a text file needs a course and the commit refuses without one", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const p = previewImport(ctx, { filename: "note.md", content: "Essay 2 is now due Thursday, November 19 at 5 p.m." });
    expect(p.needs).toEqual(["courseExternalId"]);
    expect(() => commitImport(ctx, p.token)).toThrow(/course/);
    const a = commitImport(ctx, p.token, { courseExternalId: "example-ss201" });
    expect(a.decisions).toBe(1);
  });
  it("a JSON bundle round trips through the same pipeline and is idempotent", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T10:00:00-05:00");
    const body = JSON.stringify(BUNDLE);
    const a = commitImport(ctx, previewImport(ctx, { filename: "bundle.json", content: body }).token);
    expect(a.calendarSeen).toBe(3);
    const snap = () => ["tasks", "decisions", "source_revisions", "blocks", "commitments", "goals"].map((t) => count(ctx, t));
    const s1 = snap();
    commitImport(ctx, previewImport(ctx, { filename: "bundle.json", content: body }).token);
    expect(snap()).toEqual(s1);
    expect(count(ctx, "decisions", "kind='deadline_moved'")).toBe(1);
  });
  it("HTML text extraction is inert", () => {
    expect(htmlToText("<p>Hi</p><script>alert(1)</script><style>p{}</style><p>There &amp; back</p>")).toBe("Hi\nThere & back");
  });
});

describe("scheduler and delivery", () => {
  it("fires morning and afternoon checks on local time (DST-safe) and catches up once after downtime", async () => {
    const dir = tmpDataDir();
    const ctx = memCtx("2026-11-16T07:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T07:00:00-05:00");
    const occ = occurrencesBetween(ctx, new Date("2026-11-01T00:00:00Z"), new Date("2026-11-03T12:00:00Z")); // crosses the Nov 1 DST end
    expect(occ.find((o) => o.key === "morning:2026-11-02@08:00")!.at.toISOString()).toBe("2026-11-02T13:00:00.000Z");
    expect(occ.find((o) => o.key === "morning:2026-11-01@08:00")!.at.toISOString()).toBe("2026-11-01T13:00:00.000Z");
    await tick(ctx);                                            // sets the cursor
    at(ctx, "2026-11-16T08:05:00-05:00");
    const r1 = await tick(ctx);
    expect(r1.ran.map((r) => r.key)).toEqual(["morning:2026-11-16@08:00"]);
    expect((await tick(ctx)).ran).toHaveLength(0);              // deduplicated by occurrence
    // three days of downtime
    at(ctx, "2026-11-19T10:00:00-05:00");
    const r2 = await tick(ctx);
    expect(r2.ran.filter((r) => r.kind === "morning")).toHaveLength(1);
    expect(r2.ran.find((r) => r.kind === "morning")!.key).toBe("morning:2026-11-19@08:00");
    expect(r2.missed.length).toBeGreaterThan(0);
    expect(schedulerStatus(ctx).missedCycles).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("afternoon update is delta-only; the weekly review gives one source and one move per finding", async () => {
    tmpDataDir();
    const ctx = memCtx("2026-11-16T07:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T07:00:00-05:00"); await tick(ctx);
    at(ctx, "2026-11-16T16:05:00-05:00");
    const r = await tick(ctx);
    const aft = r.ran.find((x) => x.kind === "afternoon")!;
    expect(aft.briefed).toBe(false);
    expect(aft.message).toMatch(/No update sent/);
    const w = weeklyFindings(ctx);
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((f) => f.next && f.source)).toBe(true);
  });
  it("watched folder: unchanged scan changes nothing and makes zero model calls; a failed file keeps the last success", async () => {
    tmpDataDir();
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T10:00:00-05:00");
    fs.mkdirSync(inboxDir(ctx), { recursive: true });
    fs.writeFileSync(path.join(inboxDir(ctx), "bundle.json"), JSON.stringify(BUNDLE));
    let calls = 0; const spy: MT = async () => { calls++; return { text: "{}", usage: null }; };
    setSetting(ctx.db, "daily_budget_usd", 5);
    const router = new Router(ctx, spy);
    const first = await runNow(ctx);
    expect(first.scan.applied).toBe(1);
    const snap = () => ["tasks", "decisions", "source_revisions", "inbox"].map((t) => count(ctx, t));
    const s1 = snap(); at(ctx, "2026-11-16T10:05:00-05:00");
    const second = await runNow(ctx);
    expect(second.scan.applied).toBe(0); expect(second.scan.unchanged).toBe(1);
    expect(snap()).toEqual(s1);
    expect((await interpretNeedsRead(ctx, router)).calls).toBe(0);
    expect(calls).toBe(0);
    // a broken file: partial status, previous success time retained
    const prev = get(ctx.db, "SELECT last_success_at FROM source_status WHERE provider='inbox-folder'")!.last_success_at;
    at(ctx, "2026-11-16T10:30:00-05:00");
    fs.writeFileSync(path.join(inboxDir(ctx), "broken.json"), "{oops");
    await runNow(ctx);
    const st = get(ctx.db, "SELECT * FROM source_status WHERE provider='inbox-folder'")!;
    expect(st.state).toBe("partial");
    expect(st.last_success_at).toBe(prev);
    expect(st.last_attempt_at).not.toBe(prev);
    expect(String(st.message)).toMatch(/broken\.json/);
  });
  it("a disconnected live source keeps its previous successful verification and events", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T10:00:00-05:00");
    process.env.JARVIS_ICS_URL = "https://example.invalid/cal.ics";
    const ok = await scanCalendarFeed(ctx, { fetchText: async () => ICS });
    expect(ok.ok).toBe(true);
    const before = get(ctx.db, "SELECT last_success_at FROM source_status WHERE provider='ics-feed'")!.last_success_at;
    const events = count(ctx, "blocks", "source='ics-feed'");
    at(ctx, "2026-11-16T12:00:00-05:00");
    const bad = await scanCalendarFeed(ctx, { fetchText: async () => { throw new Error("network down"); } });
    expect(bad.ok).toBe(false);
    const st = get(ctx.db, "SELECT * FROM source_status WHERE provider='ics-feed'")!;
    expect(st.state).toBe("failed"); expect(st.last_success_at).toBe(before);
    expect(count(ctx, "blocks", "source='ics-feed'")).toBe(events);
    const t = today(ctx);
    expect(t.sources.find((s) => s.provider === "ics-feed")!.state).toBe("failed");
    expect(t.sources.find((s) => s.provider === "example-blackboard")!.state).toBe("ok");   // other sources unaffected
    delete process.env.JARVIS_ICS_URL;
  });
  it("quiet hours defer interrupts; retry sends once; failures back off", async () => {
    const ctx = memCtx("2026-11-16T23:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T23:00:00-05:00");
    setSetting(ctx.db, "channels", { inbox: true, capture: true, push: false, sms: false });
    captureSink.length = 0;
    enqueue(ctx, { eventKey: "evt:1", level: "interrupt", title: "Urgent", body: "b" });
    expect(get(ctx.db, "SELECT status FROM deliveries WHERE event_key='evt:1'")!.status).toBe("deferred");
    expect(count(ctx, "inbox", "event_key='evt:1'")).toBe(1);   // inbox always has it
    expect(quietUntil(ctx, ctx.now())!.toISOString()).toBe("2026-11-17T12:30:00.000Z");
    await drainOutbox(ctx); expect(captureSink).toHaveLength(0);
    at(ctx, "2026-11-17T08:00:00-05:00");
    let n = 0; const flaky: Transport = async (p, d) => { n++; if (n === 1) throw new Error("provider down"); captureSink.push({ eventKey: d.eventKey, channel: d.channel, payload: p }); return { receipt: "r1" }; };
    await drainOutbox(ctx, { capture: flaky });
    expect(get(ctx.db, "SELECT status FROM deliveries WHERE event_key='evt:1'")!.status).toBe("pending");
    at(ctx, "2026-11-17T08:05:00-05:00");
    await drainOutbox(ctx, { capture: flaky }); await drainOutbox(ctx, { capture: flaky });
    expect(captureSink).toHaveLength(1);
    expect(get(ctx.db, "SELECT status,receipt FROM deliveries WHERE event_key='evt:1'")).toMatchObject({ status: "sent", receipt: "r1" });
    enqueue(ctx, { eventKey: "evt:1", level: "interrupt", title: "Urgent", body: "b" });           // same event again
    expect(count(ctx, "deliveries")).toBe(1);
  });
  it("scheduler status is honest: active only with a fresh worker heartbeat", () => {
    tmpDataDir();
    const ctx = memCtx(); seedDemo(ctx);
    expect(schedulerStatus(ctx).active).toBe(false);
    expect(schedulerStatus(ctx).message).toMatch(/No worker is running/);
    heartbeat(ctx);
    expect(schedulerStatus(ctx).active).toBe(true);
    setSetting(ctx.db, "scheduler_paused", true);
    expect(schedulerStatus(ctx).active).toBe(false);
    setSetting(ctx.db, "worker_heartbeat", { at: new Date(Date.now() - 5 * 60000).toISOString(), pid: 1 });
    setSetting(ctx.db, "scheduler_paused", false);
    expect(schedulerStatus(ctx).workerActive).toBe(false);
  });
  it("schedules are off by default in a personal workspace", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00", "personal");
    expect((await tick(ctx)).skipped).toMatch(/off/);
  });
});

describe("connections and advisors", () => {
  it("no connection is reported as live verified in this build", async () => {
    tmpDataDir(); const ctx = memCtx(); seedDemo(ctx);
    const c = await connections(ctx);
    expect(c.find((x) => x.id === "blackboard")!.state).toBe("needs_connection");
    expect(c.filter((x) => x.liveVerified).length).toBe(0);
  });
  it("advisor: no verified sources means a labeled gap; imported excerpts are quoted with locators; duplicates are rejected", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const t0 = advise(ctx, "hormozi", "price my tutoring offer");
    expect(t0.segments[0].label).toBe("Missing evidence");
    expect(t0.segments.every((s) => s.label !== "Direct quotation")).toBe(true);
    const add = addAdvisorSource(ctx, { title: "My notes", speaker: "Hormozi", rights: "user-notes", excerpt: "Make the offer so good people feel stupid saying no." });
    expect(add.status).toBe("gap");
    expect(() => addAdvisorSource(ctx, { title: "dup", speaker: "Hormozi", rights: "user-notes", excerpt: "Make the offer so good people feel stupid saying no." })).toThrow(/Duplicate/);
    addAdvisorSource(ctx, { title: "Interview", speaker: "Hormozi", rights: "fair-use-excerpt", excerpt: "Increase the dream outcome and decrease the time delay.", locator: "12:31", url: "https://example.com/i", published: "2024-01-01" });
    const t1 = advise(ctx, "hormozi", "price my tutoring offer");
    const q = t1.segments.filter((s) => s.label === "Direct quotation");
    expect(q).toHaveLength(2);
    expect(q.find((s) => s.source?.locator === "12:31")).toBeTruthy();
    expect(() => addAdvisorSource(ctx, { title: "x", speaker: "y", rights: "licensed", excerpt: "short excerpt here", url: "javascript:alert(1)" } as any)).toThrow();
    expect(advise(ctx, "offer", "q").segments.some((s) => s.label === "Direct quotation")).toBe(false);
  });
});
