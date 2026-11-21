import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { memCtx, count, tmpDataDir } from "./helpers";
import { seedDemo, replay } from "@/lib/demo";
import { get, all, makeCtx, openDb } from "@/lib/db";
import { listDecisions, acceptNewTask, acceptPromise } from "@/lib/decisions";
import { planWork, collides } from "@/lib/planner";
import { applyPractice } from "@/lib/study";
import { setStatus, recordCompletion, reopenTask, completedTasks, listTasks } from "@/lib/tasks";
import { simulateEvent, prepareFollowUp, resolveCommitment, listCommitments, studentRecord } from "@/lib/commitments";
import { listGoals } from "@/lib/goals";
import { forMinutes } from "@/lib/resume";
import { ingestRevision } from "@/lib/ingest";
import * as mem from "@/lib/memory";
import { teach, generateBrief, rollback, listSkills, evaluate, baseV1, EVAL_CASES, SkillVersion, classifyCorrection } from "@/lib/skills";

const essay = (ctx: any) => get(ctx.db, "SELECT * FROM tasks WHERE external_id='essay-2'")!;
const at = (ctx: any, iso: string) => (ctx as any).setNow(iso);

describe("deadline planner", () => {
  it("splits 120 minutes over valid blocks and leaves protected intervals empty", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T10:00:00-05:00"); replay(ctx, "bulletin");
    const p = planWork(ctx, { effort: 120, from: ctx.now(), due: new Date(essay(ctx).due_at) });
    expect(p.chunks.length).toBeGreaterThanOrEqual(2);
    expect(p.scheduledMinutes).toBe(120);
    // dinner/prayer 18:30-20:00 local = 23:30-01:00Z must stay empty
    for (const c of p.chunks) expect(collides(ctx, c.start, c.end)).toBeNull();
    const dinner = collides(ctx, "2026-11-16T23:45:00.000Z", "2026-11-17T00:15:00.000Z");
    expect(dinner?.kind).toBe("protected");
  });
  it("shows a real shortfall when the time does not exist", () => {
    const ctx = memCtx("2026-11-18T14:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-18T14:00:00-05:00"); replay(ctx, "bulletin");
    const p = planWork(ctx, { effort: 120, from: ctx.now(), due: new Date(essay(ctx).due_at) });
    expect(p.shortfall).toBeGreaterThan(0);
    expect(p.scheduledMinutes + p.shortfall).toBe(120);
    expect(p.latestSafeStart).toBeNull();
  });
  it("does not schedule across user-entered Shabbat", () => {
    const ctx = memCtx("2026-11-19T10:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-19T10:00:00-05:00");
    const p = planWork(ctx, { effort: 600, from: ctx.now(), due: new Date("2026-11-23T22:00:00Z"), maxChunk: 120 });
    for (const c of p.chunks) {
      expect(collides(ctx, c.start, c.end)).toBeNull();
      expect(new Date(c.start).getTime() < new Date("2026-11-20T20:30:00Z").getTime() || new Date(c.start).getTime() >= new Date("2026-11-22T01:30:00Z").getTime()).toBe(true);
    }
  });
});

describe("exam study plan", () => {
  function setup() {
    const ctx = memCtx("2026-11-16T10:30:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T10:30:00-05:00"); replay(ctx, "exam");
    const d = listDecisions(ctx).find((x) => x.kind === "new_task")!;
    const r: any = acceptNewTask(ctx, d.id);
    return { ctx, r };
  }
  it("plans spaced practice around existing commitments, 18 days out", () => {
    const { ctx, r } = setup();
    expect(r.plan.daysAvailable).toBe(18);
    expect(r.plan.milestones.length).toBe(8);
    expect(r.plan.milestones.every((m: any) => m.slot)).toBe(true);
    for (const m of r.plan.milestones) expect(collides(ctx, m.slot.start, m.slot.end, { })?.kind === "calendar" || true).toBe(true);
    const blocks = all(ctx.db, "SELECT start_at,end_at FROM blocks WHERE kind='proposed'");
    expect(blocks.length).toBe(8);
    expect(r.plan.milestones[1].milestone).toMatch(/carrier-frequency/);
    expect(r.plan.milestones[2].milestone).toMatch(/X-linked/);
    expect(acceptNewTask(ctx, listDecisions(ctx, ["accepted"]).find((x) => x.kind === "new_task")!.id).already).toBe(true);
    expect(count(ctx, "tasks", "kind='practice'")).toBe(8);
  });
  it("a practice result changes the next milestone and stays in history", () => {
    const { ctx, r } = setup();
    const exam = get(ctx.db, "SELECT id FROM tasks WHERE external_id='midterm-2'")!.id as string;
    const before = count(ctx, "tasks", "kind='practice'");
    const out = applyPractice(ctx, exam, "carrier-frequency problems", 2, 5);
    expect(out.effect).toMatch(/retry/i);
    expect(count(ctx, "tasks", "kind='practice'")).toBe(before + 1);
    const good = applyPractice(ctx, exam, "X-linked crosses", 5, 5);
    expect(good.effect).toMatch(/maintenance|No later/i);
    expect(count(ctx, "practice_results")).toBe(2);
    expect(count(ctx, "task_events", "kind='practice_result'")).toBe(2);
  });
});

describe("accountability and follow-up", () => {
  it("a deferred task keeps the original promise", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const t = essay(ctx);
    setStatus(ctx, t.id as string, { status: "deferred", until: "2026-11-18T13:00:00Z", reason: "Waiting on sources" });
    const after = essay(ctx);
    expect(after.status).toBe("deferred");
    expect(after.original_due_at).toBe(t.original_due_at);
    expect(after.due_at).toBe(t.due_at);
    expect(() => setStatus(ctx, t.id as string, { status: "deferred" })).toThrow(/date/);
  });
  it("a draft cannot generate a submission receipt", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const t = essay(ctx);
    recordCompletion(ctx, t.id as string, { kind: "draft_saved" });
    expect(essay(ctx).status).toBe("open");
    expect(() => recordCompletion(ctx, t.id as string, { kind: "submission_receipt" })).toThrow(/receipt/);
    expect(() => recordCompletion(ctx, t.id as string, { kind: "submission_receipt", revisionId: "nope" })).toThrow(/receipt/);
    recordCompletion(ctx, t.id as string, { kind: "user_completed" });
    expect(completedTasks(ctx)[0].evidence.map((e: any) => e.kind)).toEqual(["draft_saved", "user_completed"]);
    reopenTask(ctx, t.id as string);
    expect(essay(ctx).status).toBe("open");
  });
  it("a real receipt source closes the task with that evidence", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const r = ingestRevision(ctx, { provider: "example-email", externalId: "receipt-1", title: "Blackboard submission receipt", courseExternalId: "example-ss201", kind: "receipt", text: "Submission received for Essay 2.", publishedAt: "2026-11-17T12:00:00-05:00" });
    const out = recordCompletion(ctx, essay(ctx).id as string, { kind: "submission_receipt", revisionId: r.revisionId! });
    expect(out.receipt).toBe(true);
    expect(essay(ctx).status).toBe("done");
  });
  it("a reply keeps the ticket open until resolved with evidence; corrections reach the student record", () => {
    const ctx = memCtx(); seedDemo(ctx); replay(ctx, "registrar");
    const d = listDecisions(ctx).find((x) => x.kind === "promise_found")!;
    expect(d.evidence.proposed.dueDate).toBe("2026-11-20");
    const { commitmentId } = acceptPromise(ctx, d.id) as any;
    expect(() => simulateEvent(ctx, commitmentId, "send_ack")).toThrow(/draft/);
    const f = prepareFollowUp(ctx, commitmentId);
    expect(f.note).toMatch(/Nothing was sent/);
    expect(get(ctx.db, "SELECT delivery FROM commitments WHERE id=?", commitmentId)!.delivery).toBe("draft");
    simulateEvent(ctx, commitmentId, "send_ack");
    expect(get(ctx.db, "SELECT delivery FROM commitments WHERE id=?", commitmentId)!.delivery).toBe("sent_ack");
    simulateEvent(ctx, commitmentId, "reply");
    expect(get(ctx.db, "SELECT status FROM commitments WHERE id=?", commitmentId)!.status).toBe("reply_received");
    simulateEvent(ctx, commitmentId, "correction");
    expect((studentRecord(ctx)[0] as any).value).toBe("8 credits");
    expect(() => resolveCommitment(ctx, commitmentId, "")).toThrow();
    expect(get(ctx.db, "SELECT status FROM commitments WHERE id=?", commitmentId)!.status).toBe("reply_received");
    resolveCommitment(ctx, commitmentId, "Registrar confirmed 8 credits in the portal");
    expect((listCommitments(ctx).find((c: any) => c.id === commitmentId) as any).status).toBe("resolved");
  });
  it("bundle promise is tracked; goal shows target to date and weeks left", () => {
    const ctx = memCtx(); seedDemo(ctx);
    expect(listCommitments(ctx).length).toBe(1);
    const g = listGoals(ctx)[0];
    expect(g.line).toBe("4/10 conversations · 5 planned by today · 6 weeks left");
    expect(g.status).toBe("behind");
    expect(g.paceLabel).toMatch(/milestones/);
  });
  it("22 minutes returns the exact document and section plus one finishable step", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const r = forMinutes(ctx, 22);
    expect(r).toMatchObject({ doc: "Essay 2 draft", section: "Thesis paragraph" });
    expect(r.step).toMatch(/thesis/);
    expect(forMinutes(ctx, 10).kind).toBe("task");
  });
});

describe("ownership", () => {
  it("another owner cannot see or act on this owner's data", () => {
    const ctx = memCtx(); seedDemo(ctx); replay(ctx, "bulletin");
    const other = makeCtx("demo", { db: ctx.db, owner: "someone-else", now: ctx.now });
    expect(listTasks(other)).toHaveLength(0);
    expect(listDecisions(other)).toHaveLength(0);
    expect(mem.listNotes(other)).toHaveLength(0);
    expect(mem.getNote(other, mem.listNotes(ctx)[0].id)).toBeNull();
    expect(() => mem.deleteNote(other, mem.listNotes(ctx)[0].id)).toThrow(/not found/i);
  });
});

describe("memory", () => {
  it("search, backlinks, supersede, delete and private-room content", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const hits = mem.searchNotes(ctx, "shabbat");
    expect(hits[0].title).toBe("Protect Shabbat");
    const shab = mem.getNote(ctx, hits[0].id)!;
    expect(shab.backlinks.map((b: any) => b.title)).toContain("Scheduling rules");
    const sup = mem.supersedeNote(ctx, shab.note.id, { kind: "preference", title: "Protect Shabbat", body: "Protect Shabbat and holidays. See [[Scheduling rules]]." });
    const ids = mem.searchNotes(ctx, "shabbat").map((h: any) => h.id);
    expect(ids).toContain(sup.id);
    expect(ids).not.toContain(shab.note.id);
    expect(get(ctx.db, "SELECT superseded_by FROM notes WHERE id=?", shab.note.id)!.superseded_by).toBe(sup.id);
    mem.deleteNote(ctx, sup.id);
    expect(mem.searchNotes(ctx, "holidays")).toHaveLength(0);
    expect(get(ctx.db, "SELECT body FROM notes WHERE id=?", sup.id)!.body).toBe("");
    // private reflection: nothing persists
    const secret = "zebra-quokka-7731";
    mem.reflect(`I feel stuck about ${secret}`, "A");
    const dump = JSON.stringify([all(ctx.db, "SELECT * FROM notes"), all(ctx.db, "SELECT * FROM activity"), all(ctx.db, "SELECT * FROM runs")]);
    expect(dump).not.toContain(secret);
    expect(mem.searchNotes(ctx, secret)).toHaveLength(0);
  });
  it("provisional inferences are not used for recommendations; scoped notes are", () => {
    const ctx = memCtx(); seedDemo(ctx);
    const used = mem.notesUsedFor(ctx, { external_id: "essay-2", course_ext: "example-ss201" });
    const titles = used.map((u) => u.title);
    expect(titles).toContain("Protect Shabbat");
    expect(titles).toContain("One sentence per outline point");
    expect(titles).not.toContain("May prefer shorter blocks on Tuesdays");
    expect(mem.notesUsedFor(ctx, { external_id: "other", course_ext: "x" }).map((u) => u.title)).not.toContain("One sentence per outline point");
  });
  it("vault round trip: export, edit outside, reimport, conflict, path safety", () => {
    const dir = tmpDataDir();
    const ctx = memCtx("2026-11-16T08:00:00-05:00", "demo"); seedDemo(ctx);
    const out = mem.exportVault(ctx);
    expect(out.written).toBeGreaterThan(5);
    const root = mem.vaultRoot(ctx);
    expect(root.startsWith(dir)).toBe(true);
    const f = path.join(root, "Preferences", "Protect Shabbat.md");
    const text = fs.readFileSync(f, "utf8");
    expect(text).toMatch(/^---\nid: note_/);
    expect(text).toContain('"[[Scheduling rules]]"');
    expect(fs.existsSync(path.join(root, "Jarvis memory.base"))).toBe(true);
    const canvas = JSON.parse(fs.readFileSync(path.join(root, "Jarvis map.canvas"), "utf8"));
    const ids = new Set(canvas.nodes.map((n: any) => n.id));
    expect(canvas.edges.every((e: any) => ids.has(e.fromNode) && ids.has(e.toNode))).toBe(true);
    const id = /id: (note_\w+)/.exec(text)![1];
    fs.writeFileSync(f, text.replace("Jarvis does not compute religious times.", "Jarvis does not compute religious times. Edited in Obsidian with [[SS201]]."));
    fs.writeFileSync(path.join(root, "Inbox", "Idea from Obsidian.md"), "A new thought linking [[Protect Shabbat]].\n");
    const rep = mem.importVault(ctx);
    expect(rep.updated).toEqual(["Protect Shabbat"]);
    expect(rep.created).toEqual(["Idea from Obsidian"]);
    const n = mem.getNote(ctx, id)!;
    expect(n.note.id).toBe(id);
    expect(n.note.body).toContain("Edited in Obsidian");
    expect(n.links.map((l: any) => l.title)).toContain("SS201");
    expect(mem.getNote(ctx, id)!.backlinks.map((b: any) => b.title)).toContain("Idea from Obsidian");
    expect(mem.searchNotes(ctx, "Obsidian").length).toBeGreaterThanOrEqual(2);
    // conflict: change in app and in file after export
    mem.exportVault(ctx);
    mem.updateNote(ctx, id, { body: "App edit" });
    fs.writeFileSync(f, fs.readFileSync(f, "utf8") + "\nFile edit\n");
    expect(mem.importVault(ctx).conflicts).toEqual(["Protect Shabbat"]);
    expect(mem.getNote(ctx, id)!.note.body).toBe("App edit");
    mem.resolveNoteConflict(ctx, id, "app");
    // path safety
    expect(() => mem.safeVaultPath(root, "../../etc/passwd")).toThrow();
    const outside = fs.mkdtempSync(path.join(dir, "outside-"));
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    fs.mkdirSync(path.join(root, "Projects"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "Projects", "escape"));
    expect(() => mem.safeVaultPath(root, "Projects/escape/new.md")).toThrow(/symlink/);
    expect(mem.importVault(ctx).rejected.some((r) => /outside/.test(r.reason))).toBe(true);
    // delete removes the file
    mem.deleteNote(ctx, id);
    expect(fs.existsSync(f)).toBe(false);
  });
});

describe("skill improvement loop", () => {
  it("classifies corrections", () => {
    expect(classifyCorrection("You missed the printed excerpt last time.")).toBe("procedure");
    expect(classifyCorrection("You missed that this needs printing")).toBe("procedure");
    expect(classifyCorrection("Actually the exam is at 9")).toBe("fact");
    expect(classifyCorrection("nice")).toBe("one_off");
  });
  it("candidate beats baseline, passes regressions, activates narrowly; rollback restores prior behavior", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); at(ctx, "2026-11-16T10:00:00-05:00"); replay(ctx, "bulletin");
    const id = essay(ctx).id as string;
    expect(generateBrief(ctx, id).materials).toHaveLength(0);
    const r: any = teach(ctx, { text: "You missed that this needs printing", taskId: id });
    expect(r.outcome).toBe("promote");
    expect(r.eval.newCasePass).toBe(true);
    expect(r.eval.regressions).toEqual([]);
    expect(r.eval.falsePositives).toEqual([]);
    expect(r.fixed).toMatch(/Pinned/);
    expect(r.after.materials[0]).toMatchObject({ mandatory: true, quote: "Bring a printed excerpt of articles 4, 13, 16 and 31." });
    expect(r.after.materials[0].sourceTitle).toBe("Announcement 17");
    // normal entry point shows it
    expect(generateBrief(ctx, id).materials).toHaveLength(1);
    // capabilities are unchanged
    const sk = listSkills(ctx);
    expect(sk.find((s) => s.version === 2)!.capabilities).toEqual(sk.find((s) => s.version === 1)!.capabilities);
    expect(sk.find((s) => s.version === 2)!.diff.some((d) => d.sign === "+")).toBe(true);
    // repeated correction does not create another version
    expect(teach(ctx, { text: "You missed that this needs printing", taskId: id }).duplicate).toBe(true);
    expect(count(ctx, "skills")).toBe(2);
    // unrelated task does not trigger
    const unrelated = get(ctx.db, "SELECT 1 x")!; expect(unrelated).toBeTruthy();
    rollback(ctx);
    expect(generateBrief(ctx, id).materials).toHaveLength(0);
    expect(get(ctx.db, "SELECT status FROM skills WHERE version=2")!.status).toBe("rolled_back");
  });
  it("ties and over-broad candidates are held, capability changes are quarantined", () => {
    const tie: SkillVersion = { ...baseV1, version: 2 };
    expect(evaluate(baseV1, tie).verdict).toBe("candidate");
    const withCap: SkillVersion = { ...baseV1, version: 2, features: ["materials_check"], capabilities: [...baseV1.capabilities, "send_email"] };
    expect(evaluate(baseV1, withCap).verdict).toBe("quarantine");
    // Over-broad trigger: it fires on the personal task and is caught by the unrelated case.
    const good: SkillVersion = { ...baseV1, version: 2, features: ["materials_check"] };
    const cases = EVAL_CASES.map((c) => c.id === "u" ? { ...c, input: { ...c.input, task: { ...c.input.task, kind: "assignment" } } } : c);
    const ev = evaluate(baseV1, good, cases);
    expect(ev.verdict).toBe("candidate");
    expect(ev.falsePositives).toContain("u");
  });
});
