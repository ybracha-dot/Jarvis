import { describe, it, expect } from "vitest";
import { memCtx, count } from "./helpers";
import { loadWorkspaceFixtures, setCalendar } from "@/lib/workspace-fixtures";
import { handleUtterance } from "@/lib/study-guide";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { resultView, reviseRequest, submitGoal, saveResult, cancelRequest, receipt, understand, looksLikeGoal } from "@/lib/assistant";
import { revokeSource, listSources, importText } from "@/lib/evidence";
import { all, get, makeCtx } from "@/lib/db";

const PITCH = "Pick up where we left off on the pitch and draft my follow-up.";
const READY = "Get me ready for tomorrow";
const base = (clock: () => Date, extra: any = {}) => ({ workerId: "w1", handlers: HANDLERS, clock, leaseMs: 1000, ...extra });
const fresh = () => { const ctx = memCtx("2026-11-16T10:00:00-05:00"); (ctx as any).setNow?.("2026-11-16T10:00:00-05:00"); const fx = loadWorkspaceFixtures(ctx); let t = 1_000_000; const clock = () => new Date(t); return { ctx, clock, fx, tick: (ms: number) => { t += ms; } }; };
const ask = async (ctx: any, clock: any, text: string, extra: any = {}) => { const r: any = handleUtterance(ctx, { text, via: "text", ...extra }); await processQueue(ctx, base(clock)); return r; };

describe("Ask Jarvis: the pitch follow-up, end to end", () => {
  it("creates a durable job from free text, finds the latest decision, checks it against the thread and saves a draft with source links", async () => {
    const { ctx, clock } = fresh();
    const r = await ask(ctx, clock, PITCH);
    expect(get(ctx.db, "SELECT kind FROM messages WHERE role='jarvis' ORDER BY rowid LIMIT 1")!.kind).toBe("goal"); expect(r.jobId).toMatch(/^job_/); expect(r.reply.data.path).toMatch(/^\/results\/res_/);
    const v = resultView(ctx, r.reply.data.resultId);
    expect(v).toMatchObject({ kind: "draft", version: 1, projectName: "Lantern Club" });
    expect(v.body).toMatch(/Wednesday, Nov 18/); expect(v.body).not.toMatch(/Confirming Friday|50,000|Sam Ortiz|\$12,000/);
    expect(v.body).toMatch(/“Let's follow up with the sponsors soon, because they asked for the revised budget before demo day\.”/);   // the reason, quoted from the transcript
    const roles = v.sources.map((s: any) => `${s.title}|${s.role}`);
    expect(roles).toEqual(expect.arrayContaining(["Re: Lantern Club sponsor pitch follow-up|confirms the date", expect.stringMatching(/sync\|states the reason/)]));
    expect(v.sources.every((s: any) => s.link.startsWith("/evidence/ev_") && s.live)).toBe(true);
    expect(v.flags.find((f: any) => f.kind === "older_proposal")!.text).toMatch(/Monday.*earlier proposal.*replaced by Wednesday/);
    expect(v.flags.find((f: any) => f.kind === "unsupported_figure")!.text).toMatch(/\$12,000.*only once.*left it out/);
    expect(v.sources.some((s: any) => /Design Memo|advising/i.test(s.title))).toBe(false);                       // unrelated school sources stay out
    expect(v.reads.some((x: any) => x.kind === "search" && /Re: Lantern/.test(x.label))).toBe(true);
    expect(all(ctx.db, "SELECT model_calls FROM jobs").every((j) => j.model_calls === 0)).toBe(true);
    expect(all(ctx.db, "SELECT role, area FROM jobs ORDER BY rowid").map((j) => j.area)).toEqual(expect.arrayContaining(["supervisor", "research", "planning", "review"]));
    expect(get(ctx.db, "SELECT COUNT(*) n FROM messages WHERE kind='result'")!.n).toBe(1);                       // one spoken completion in the conversation
  });
  it("is replay-safe: the same words while running or the same connector key never create a second request", async () => {
    const { ctx, clock } = fresh();
    const a = submitGoal(ctx, { text: PITCH, origin: "claude", dedupKey: "msg-1" }); const b = submitGoal(ctx, { text: PITCH, origin: "claude", dedupKey: "msg-1" });
    expect(b).toMatchObject({ duplicate: true, requestId: a.requestId }); expect(submitGoal(ctx, { text: PITCH, origin: "api" }).requestId).not.toBe(a.requestId);
    await processQueue(ctx, base(clock));
    expect(count(ctx, "requests")).toBe(2);
    const again = submitGoal(ctx, { text: PITCH, origin: "claude", dedupKey: "msg-1" }); expect(again.duplicate).toBe(true); expect(count(ctx, "result_versions", `result_id='${a.resultId}'`)).toBe(1);
  });
  it("a worker killed after saving but before returning its receipt does not make a second version or a second message", async () => {
    const { ctx, clock, tick } = fresh();
    const r: any = handleUtterance(ctx, { text: PITCH, via: "voice" });
    await processQueue(ctx, base(clock, { workerId: "A", crashAfterStep: "save" })); tick(2000);
    await processQueue(ctx, base(clock, { workerId: "B" }));
    expect(count(ctx, "result_versions")).toBe(1); expect(count(ctx, "messages", "kind='result'")).toBe(1); expect(receipt(ctx, r.reply.data.requestId)).toMatchObject({ status: "done", ready: true });
  });
});

describe("changing the request mid-flight", () => {
  it("'Use the Wednesday decision and keep it to three sentences' makes one new version, reuses the reads, and a late old result cannot overwrite it", async () => {
    const { ctx, clock } = fresh();
    const r: any = await ask(ctx, clock, PITCH); const rid = r.reply.data.requestId;
    const v1 = resultView(ctx, rid); const sentences = (b: string) => b.split("\n").filter((l) => l && !l.startsWith("**") && !/^(Hi|Best|Yonathan$)/.test(l)).join(" ").split(/(?<=[.!?”])\s+/).length;
    const rev = reviseRequest(ctx, { requestId: rid, text: "Use the Wednesday decision and keep it to three sentences.", origin: "claude", dedupKey: "m2" });
    expect(rev.revision).toBe(2); await processQueue(ctx, base(clock));
    const v2 = resultView(ctx, rid);
    expect(v2.version).toBe(2); expect(count(ctx, "results")).toBe(1); expect(v2.applied!.applied).toEqual(["Keep it to 3 sentences", "Use the wednesday decision"]);
    expect(sentences(v2.body!)).toBeLessThanOrEqual(3); expect(sentences(v1.body!)).toBeGreaterThan(3);
    expect(all(ctx.db, "SELECT kind FROM job_events WHERE kind='reuse'").length).toBeGreaterThan(0);                // research was not repeated
    expect(reviseRequest(ctx, { requestId: rid, text: "x again", origin: "claude", dedupKey: "m2" })).toMatchObject({ replay: true });
    // A helper from the old instruction finishes late.
    const late = saveResult(ctx, { requestId: rid, revision: 1, title: "OLD", body: "OLD BODY", summary: "old", sources: [], flags: [], unavailable: [], kind: "draft", projectId: null });
    expect(late).toMatchObject({ discarded: true }); expect(resultView(ctx, rid).body).not.toMatch(/OLD BODY/); expect(resultView(ctx, rid).version).toBe(2);
    expect(count(ctx, "messages", "kind='result'")).toBe(2);                                         // one announcement per real version, none for the discarded late result
  });
  it("cancel stops it, and nothing is ever sent", async () => {
    const { ctx, clock } = fresh(); const g = submitGoal(ctx, { text: PITCH, origin: "api" }); cancelRequest(ctx, g.requestId); await processQueue(ctx, base(clock));
    expect(receipt(ctx, g.requestId).status).toBe("cancelled"); expect(count(ctx, "result_versions")).toBe(0);
  });
});

describe("authorization follows the evidence", () => {
  it("a revoked source is not read, an existing result that cited it is flagged, and a new run says what is missing", async () => {
    const { ctx, clock } = fresh();
    const r: any = await ask(ctx, clock, PITCH); const rid = r.reply.data.resultId;
    revokeSource(ctx, listSources(ctx).find((s) => s.kind === "email")!.id);
    expect(resultView(ctx, rid)).toMatchObject({ state: "stale" }); expect(resultView(ctx, rid).stale).toMatch(/revoked/);
    expect(resultView(ctx, rid).sources.some((s: any) => !s.live)).toBe(true);
    const r2: any = await ask(ctx, clock, PITCH); const v = resultView(ctx, r2.reply.data.resultId);
    expect(v.version).toBe(2); expect(v.body).not.toMatch(/Wednesday/); expect(v.flags.some((f: any) => f.kind === "no_decision")).toBe(true);
    expect(v.sources.every((s: any) => !/Re: Lantern/.test(s.title))).toBe(true);
  });
  it("another owner's records never appear in results, reads or searches", async () => {
    const { ctx, clock } = fresh(); const r: any = await ask(ctx, clock, PITCH);
    const dump = JSON.stringify(resultView(ctx, r.reply.data.resultId));
    expect(dump).not.toMatch(/Confirming Friday|Sam Ortiz|50,000|other-owner/);
    const other = makeCtx(ctx.mode, { db: ctx.db, owner: "other-owner", now: ctx.now });
    expect(() => resultView(other, r.reply.data.resultId)).toThrow(/No such result/);
  });
});

describe("Get me ready for tomorrow: a different request through the same executor", () => {
  it("reads the calendar, the changed notice and the prior outline, ranks what matters, and names what it could not read", async () => {
    const { ctx, clock } = fresh(); const r: any = await ask(ctx, clock, READY); const v = resultView(ctx, r.reply.data.resultId);
    expect(v.kind).toBe("brief"); expect(v.body).toMatch(/Advising check-in/); expect(v.body).toMatch(/Studio critique/);
    expect(v.body).toMatch(/Design Memo.*due date now Thursday, Nov 19/); expect(v.body).toMatch(/outline for Advising check-in/i);
    expect(v.flags.find((f: any) => f.kind === "unverified_requirement")!.text).toMatch(/rubric.*unverified/i);
    expect(v.unavailable.map((u: any) => u.label)).toContain("Blackboard portal"); expect(v.unavailable[0].message).toMatch(/sign-in/i);
    expect(v.sources.map((s: any) => s.role)).toEqual(expect.arrayContaining(["changed date", "prior outline"]));
    expect(v.body.match(/^\d\. /gm)!.length).toBeLessThanOrEqual(3);
    expect(v.body).not.toMatch(/Hi Dana|Following up/);                                                         // a brief, not the follow-up draft
    expect(v.reads.some((x: any) => x.kind === "calendar")).toBe(true); expect(v.reads.find((x: any) => x.kind === "source" && /Blackboard/.test(x.label))!.used).toBe(false);
  });
  it("changing the calendar changes the brief, and asking again refreshes the same result", async () => {
    const { ctx, clock } = fresh(); const r: any = await ask(ctx, clock, READY); const id = r.reply.data.resultId;
    setCalendar(ctx, [{ title: "Dentist", start: "08:30", end: "09:15", dayOffset: 1 }]);
    const r2: any = await ask(ctx, clock, READY); expect(r2.reply.data.resultId).toBe(id);
    const v = resultView(ctx, id); expect(v.version).toBe(2); expect(v.body).toMatch(/Dentist/); expect(v.body).not.toMatch(/Studio critique/);
    expect(v.versions.map((x: any) => x.version)).toEqual([2, 1]); expect(resultView(ctx, id, 1).body).toMatch(/Studio critique/);
  });
  it("with an empty calendar and no sources it still answers plainly", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); let t = 1_000_000; const clock = () => new Date(t);
    const r: any = await ask(ctx, clock, READY); const v = resultView(ctx, r.reply.data.resultId);
    expect(v.body).toMatch(/Nothing on the calendar/); expect(v.summary).toMatch(/Nothing needs you/);
  });
});

describe("What did I promise after that meeting: ambiguity and ownership", () => {
  it("asks one question when two meetings fit, then separates your promises from a teammate's", async () => {
    const { ctx, clock } = fresh();
    importText(ctx, { kind: "transcript", title: "Lantern Club sponsor pitch sync (second)", label: "Meeting transcripts (fixture)", text: "[00:00:10] Priya Nair: I'll send the venue quote tomorrow.\n[00:00:50] Yonathan: I'll update the sponsor list by Thursday.", at: new Date(ctx.now().getTime() - 86400_000).toISOString(), author: "Priya Nair", participants: ["Priya Nair", "Yonathan"] });
    const r: any = await ask(ctx, clock, "What did I promise after that meeting?"); const rid = r.reply.data.requestId;
    expect(receipt(ctx, rid)).toMatchObject({ status: "blocked", ready: false }); expect(receipt(ctx, rid).blockers[0]).toMatch(/Which one/);
    const q = get(ctx.db, "SELECT * FROM jobs WHERE status='blocked'")!; const ask_ = JSON.parse(q.result as string).ask; expect(ask_.choices.length).toBeGreaterThanOrEqual(2);
    const pick = ask_.choices.find((c: any) => /second/.test(c.label)); const { answerJob } = await import("@/lib/study-guide");
    answerJob(ctx, q.id as string, { choice: pick.id }); await processQueue(ctx, base(clock));
    const v = resultView(ctx, rid); expect(v.kind).toBe("answer");
    expect(v.body.split("**What others promised**")[0]).toMatch(/update the sponsor list/); expect(v.body.split("**What others promised**")[0]).not.toMatch(/venue quote/);
    expect(v.body.split("**What others promised**")[1]).toMatch(/Priya.*venue quote/);
    expect(v.sources.map((s: any) => s.role)).toEqual(expect.arrayContaining(["your promise", "Priya's promise"]));
  });
});

describe("routing is by meaning, not by example names", () => {
  it("looksLikeGoal separates outcomes from quick commands", () => {
    expect(looksLikeGoal(PITCH)).toBe(true); expect(looksLikeGoal(READY)).toBe(true); expect(looksLikeGoal("What did I promise after that meeting?")).toBe(true);
    expect(looksLikeGoal("what changed")).toBe(false); expect(looksLikeGoal("I have 20 minutes")).toBe(false); expect(looksLikeGoal("who owes me")).toBe(false);
  });
  it("understands the same request about a different, invented project without any code change", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00");
    ctx.db.exec(`INSERT INTO projects(id,owner_id,slug,name,kind,aliases,created_at,updated_at) VALUES('p9','local','kestrel-lab','Kestrel Lab','project','[]','x','x')`);
    expect(understand(ctx, "Draft my follow-up to the Kestrel Lab investors")).toMatchObject({ deliverable: "draft", projectId: "p9" });
    expect(understand(ctx, "Brief me on what's coming up tomorrow").deliverable).toBe("brief");
  });
});

import { tick } from "@/lib/scheduler";
import { setSetting } from "@/lib/db";
describe("the morning brief is a scheduled goal on the same executor", () => {
  it("runs once per occurrence, saves a brief, and a day with nothing to say stays quiet", async () => {
    const { ctx, clock } = fresh(); setSetting(ctx.db, "scheduler_cursor", "2026-11-15T12:00:00.000Z");
    await tick(ctx); await tick(ctx);
    expect(all(ctx.db, "SELECT origin FROM requests")).toEqual([{ origin: "schedule" }]);                            // one request, not two
    await processQueue(ctx, base(clock)); const rq = get(ctx.db, "SELECT result_id FROM requests")!;
    expect(resultView(ctx, rq.result_id as string)).toMatchObject({ kind: "brief", request: { origin: "schedule" } });
    const q = memCtx("2026-11-16T10:00:00-05:00"); setSetting(q.db, "scheduler_cursor", "2026-11-15T12:00:00.000Z"); await tick(q);
    expect(count(q, "requests")).toBe(0);                                                                             // nothing connected: no job, no cost
  });
});


// Regression: an independent QA agent chose these two requests after implementation. Both FAILED on the first attempt
// ("No meeting transcript is saved yet": the answer path was a meeting-promises pipeline). They are kept verbatim.
import { importText as imp } from "@/lib/evidence";
describe("QA regression: unseen requests over emails and notes (first attempt failed)", () => {
  const seedTrip = (ctx: any) => {
    const at = (d: string) => `2026-11-${d}T14:00:00.000Z`;
    imp(ctx, { kind: "email", title: "TAP booking XK7Q2L", text: "Your outbound flight to Lisbon departs Thursday December 3 at 9:40 pm and arrives December 4. Return flight not booked.", at: at("10"), author: "TAP" });
    imp(ctx, { kind: "email", title: "Hotel Alfama reservation", text: "Hotel Alfama reservation for Lisbon: December 4 to 8, 4 nights at EUR 140 per night.", at: at("12"), author: "Hotel Alfama" });
    imp(ctx, { kind: "email", title: "Hotel Alfama reservation changed", text: "Hotel Alfama has changed your Lisbon reservation: December 4 to 7, 3 nights at EUR 150 per night. This replaces the earlier booking.", at: at("14"), author: "Hotel Alfama" });
    imp(ctx, { kind: "note", title: "Lisbon trip to do", text: "Web Summit registration paid, EUR 490, December 5 to 6. TODO: airport transfer and travel insurance are not sorted yet.", at: at("13") });
    imp(ctx, { kind: "email", title: "Lisbon Falls Dental appointment", text: "Reminder: your cleaning at Lisbon Falls Dental in Maine is December 4 at 2 pm.", at: at("11"), author: "Lisbon Falls Dental" });
  };
  it("what is confirmed and what is still unbooked for a trip, from emails and a note", async () => {
    const { ctx, clock } = fresh(); seedTrip(ctx);
    const r: any = await ask(ctx, clock, "What's confirmed and what's still unbooked for my Lisbon trip in December?");
    expect(r.jobId).toBeTruthy();                                                                       // it became a job (before the fix: "I did not recognize that")
    const v = resultView(ctx, r.reply.data.resultId);
    expect(v.body).not.toMatch(/No meeting transcript/); expect(v.sources.length).toBeGreaterThanOrEqual(3);
    expect(v.body).toMatch(/EUR 150/); expect(v.body).toMatch(/EUR 140[^.]*replaced|replaced[^.]*EUR 140/i);                // the later hotel change wins and the old figure is marked replaced
    expect(v.body).toMatch(/airport transfer and travel insurance are not sorted/i); expect(v.body).toMatch(/Return flight not booked/i);
    expect(v.sources.some((s: any) => /Dental/.test(s.title))).toBe(false);                             // the same-word distractor is not part of the trip
    expect(v.reads.some((x: any) => /Dental/.test(x.label) && !x.used)).toBe(true);                     // and the read log says it was set aside
  });
  it("where did we land and what is left to do, with a revised figure and a same-name coworker", async () => {
    const { ctx, clock } = fresh();
    imp(ctx, { kind: "email", title: "Lease renewal offer", text: "Maple Court offers a 12 month renewal at $2,400 per month. Sign by November 30.", at: "2026-11-09T15:00:00.000Z", author: "Dana Whitfield" });
    imp(ctx, { kind: "email", title: "Lease renewal revised", text: "Maple Court revised the lease renewal rent to $2,350 per month. A renter-insurance certificate is needed before signing.", at: "2026-11-12T15:00:00.000Z", author: "Dana Whitfield" });
    imp(ctx, { kind: "note", title: "Lease decision", text: "Decided to renew the lease. Still to do: the insurance certificate and the signature. Parking price not asked yet.", at: "2026-11-13T15:00:00.000Z" });
    imp(ctx, { kind: "email", title: "Lunch and budget deck", text: "Dana Whitfield from Acme: lunch Thursday, and the budget deck is due November 20.", at: "2026-11-12T16:00:00.000Z", author: "Dana Whitfield" });
    const r: any = await ask(ctx, clock, "Where did we land on the apartment lease renewal and what do I still have to do?");
    const v = resultView(ctx, r.reply.data.resultId);
    expect(v.body).toMatch(/\$2,350/); expect(v.body).toMatch(/\$2,400[^.]*replaced|replaced[^.]*\$2,400/i);
    expect(v.body).toMatch(/insurance certificate and the signature/i); expect(v.body).toMatch(/Parking price not asked/i);
    expect(v.sources.some((s: any) => /Lunch/.test(s.title))).toBe(false);
  });
  it("a question about what someone said is answered from the email, not turned into 'promises after a meeting'", async () => {
    const { ctx, clock } = fresh();
    imp(ctx, { kind: "email", title: "Q4 estimated tax", text: "Hi Alex, your Q4 estimated tax payment is $3,200, due January 15. Priya", at: "2026-11-12T15:00:00.000Z", author: "Priya Shah" });
    imp(ctx, { kind: "transcript", title: "Call with Priya (accountant)", text: "[00:00:10] Priya Shah: I will send you the 1099 by Friday.\n[00:00:40] Alex: I will pay it from the savings account.", at: "2026-11-13T15:00:00.000Z", author: "Priya Shah", participants: ["Priya Shah", "Alex"] });
    const r: any = await ask(ctx, clock, "What did my accountant say about my Q4 estimated tax payment?");
    const v = resultView(ctx, r.reply.data.resultId);
    expect(v.title).not.toMatch(/^Promises after/); expect(v.body).toMatch(/\$3,200/); expect(v.body).toMatch(/January 15/);
  });
  it("with no matching material it says what is missing, naming what was asked about", async () => {
    const { ctx, clock } = fresh();
    const r: any = await ask(ctx, clock, "What did my accountant say about my Q4 estimated tax payment?"); const v = resultView(ctx, r.reply.data.resultId);
    expect(v.body).toMatch(/Nothing saved matches/); expect(v.body).toMatch(/accountant|estimated|payment/i); expect(v.body).not.toMatch(/meeting transcript/i);
  });
  it("does not assume whose promises are 'yours' when the speaker names do not include the owner", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); const clock = () => new Date(1_000_000);
    imp(ctx, { kind: "transcript", title: "Call with Priya", text: "[00:00:10] Priya Shah: I will send you the 1099 by Friday.\n[00:00:40] Alex: I will pay it from the savings account.", at: "2026-11-13T15:00:00.000Z", participants: ["Priya Shah", "Alex"] });
    const r: any = await ask(ctx, clock, "What did I promise after that call?"); const v = resultView(ctx, r.reply.data.resultId);
    expect(v.body).toMatch(/Alex: I will pay it/); expect(v.body).toMatch(/Priya Shah: I will send you the 1099/); expect(v.flags.some((f: any) => f.kind === "owner_unknown")).toBe(true);
  });
});
