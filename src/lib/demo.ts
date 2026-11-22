// Demo workspace: a clearly labeled fictional term week with a controllable clock. All fixtures go through normal ingestion.
import fs from "node:fs";
import path from "node:path";
import { Ctx, get, run, setSetting, getSetting, tx, logActivity, modeDir } from "./db";
import { importBundle, upsertCalendar } from "./bundle";
import { ingestRevision } from "./ingest";
import { createNote } from "./memory";
import { seedSkills } from "./skills";
import { parseLocal, addDays } from "./time";
import { saveCheckpoint } from "./resume";
import { createCommitment } from "./commitments";
import { upsertGoal } from "./goals";

export const DEMO_START = "2026-11-16T08:00:00-05:00";
export const BUNDLE = {
  schemaVersion: 1, mode: "example", timezone: "America/New_York", clock: "2026-11-16T10:00:00-05:00",
  assignment: { courseId: "example-ss201", courseCode: "SS201", courseName: "Example Social Science 201", externalId: "essay-2", title: "Argument and primary sources", originalDue: "2026-11-20T17:00:00-05:00", effortMinutes: 120 },
  revisions: [
    { id: "syllabus-v1", publishedAt: "2026-11-01T08:00:00-05:00", text: "Essay 2 is due Friday, November 20 at 5 p.m." },
    { id: "announcement-17", publishedAt: "2026-11-16T09:10:00-05:00", text: "Essay 2 is now due Wednesday, November 18 at 5 p.m. Bring a printed excerpt of articles 4, 13, 16 and 31." },
  ],
  calendar: [
    { title: "Spanish class", start: "2026-11-17T09:00:00-05:00", end: "2026-11-17T10:00:00-05:00" },
    { title: "Science class", start: "2026-11-17T10:45:00-05:00", end: "2026-11-17T12:00:00-05:00" },
    { title: "SM team meeting", start: "2026-11-18T15:00:00-05:00", end: "2026-11-18T16:00:00-05:00" },
  ],
  promise: { who: "Example advisor", owedTo: "Yonathan", action: "Check transfer credit", dueDate: "2026-11-20" },
  goal: { name: "Networking conversations", completed: 4, targetToday: 5, targetTotal: 10 },
} as const;

export const FIXTURES = {
  bulletin: { label: "Instructor bulletin moves Essay 2", detail: "Announcement 17, a duplicate email copy and a bibliography source" },
  exam: { label: "Biology exam announced 18 days out", detail: "Adds a New item decision. Accept it to get a spaced practice plan" },
  registrar: { label: "Registrar email promises an answer by Friday", detail: "Adds a promise to track" },
  conflict: { label: "Conflicting date, no change language", detail: "Two records disagree. You pick" },
  obsolete: { label: "Obsolete course schedule resurfaces", detail: "Older source is kept but ignored" },
  waiver: { label: "Later announcement waives printing", detail: "Removes the print requirement" },
} as const;
export type FixtureName = keyof typeof FIXTURES;

export function isSeeded(ctx: Ctx): boolean { return getSetting(ctx.db, "seeded", false); }

export function seedDemo(ctx: Ctx): { seeded: boolean } {
  if (isSeeded(ctx)) return { seeded: false };
  tx(ctx.db, () => {
    setSetting(ctx.db, "demo_clock", new Date(DEMO_START).toISOString());
    setSetting(ctx.db, "tz", "America/New_York");
    setSetting(ctx.db, "protected_daily", [{ start: "18:30", end: "20:00", label: "Dinner and evening prayer" }]);
    const shab = (fri: string) => ({ start: parseLocal(fri, "15:30").toISOString(), end: parseLocal(addDays(fri, 1), "20:30").toISOString(), label: "Shabbat (times entered by you)", source: "user-entered" });
    setSetting(ctx.db, "protected_intervals", ["2026-11-20", "2026-11-27", "2026-12-04"].map(shab));
    setSetting(ctx.db, "quiet_daily", [{ start: "22:00", end: "07:30" }]);
    setSetting(ctx.db, "check_times", ["08:00", "16:00"]);
    setSetting(ctx.db, "channels", { inbox: true, capture: false, push: false, sms: false });
    setSetting(ctx.db, "weak_areas", { "example-bi108": ["carrier-frequency problems", "X-linked crosses"] });
    setSetting(ctx.db, "daily_budget_usd", 0);
    // Fixture 1, before the update: the syllabus is the only revision. Everything goes through the normal bundle import.
    importBundle(ctx, { ...BUNDLE, revisions: [BUNDLE.revisions[0]] });
    upsertGoal(ctx, { name: "Networking conversations", unit: "conversations", completed: 4, targetTotal: 10, startDate: "2026-11-02", deadline: "2026-12-28", milestones: [{ on: "2026-11-16", target: 5 }, { on: "2026-12-28", target: 10 }] });
    upsertCalendar(ctx, "example-calendar", [], "Calendar (example)");
    run(ctx.db, "INSERT OR IGNORE INTO source_status(owner_id,provider,label,state,last_attempt_at,last_success_at,message) VALUES(?,?,?,?,?,?,?)", ctx.owner, "example-blackboard", "Blackboard (example)", "ok", ctx.now().toISOString(), ctx.now().toISOString(), "Fixture data, not a live check");
    run(ctx.db, "INSERT OR IGNORE INTO source_status(owner_id,provider,label,state,last_attempt_at,last_success_at,message) VALUES(?,?,?,?,?,?,?)", ctx.owner, "example-email", "Email (example)", "ok", ctx.now().toISOString(), ctx.now().toISOString(), "Fixture data, not a live check");
    const task = get(ctx.db, "SELECT id FROM tasks WHERE external_id='essay-2'")!.id as string;
    saveCheckpoint(ctx, { taskId: task, doc: "Essay 2 draft", section: "Thesis paragraph", question: "Does article 13 support the claim, or only the context?", nextStep: "Write a one-sentence thesis that ties article 13 to your claim", estMinutes: 20 });
    createNote(ctx, { kind: "preference", title: "Protect Shabbat", body: "No work blocks from Friday afternoon to Saturday night. Times are entered by Yonathan. Jarvis does not compute religious times.\nSee [[Scheduling rules]].", scope: "global", source: "user" });
    createNote(ctx, { kind: "preference", title: "Scheduling rules", body: "Keep one protected evening block. Prefer one uninterrupted block over several short ones. Related: [[Protect Shabbat]].", scope: "global", source: "user" });
    createNote(ctx, { kind: "preference", title: "Leaning Sydney", body: "Leaning toward Sydney for the spring exchange. Revisit by Dec 15.", scope: "global", source: "user", effectiveTo: "2026-12-15T00:00:00.000Z" });
    createNote(ctx, { kind: "preference", title: "One sentence per outline point", body: "For Essay 2 outlines, write one sentence per point. See [[SS201]].", scope: "task:essay-2", source: "user" });
    createNote(ctx, { kind: "course", title: "SS201", body: "Example Social Science 201. Essay 2 uses primary sources. Instructor posts changes as announcements. See [[One sentence per outline point]].", scope: "course:example-ss201", source: "user" });
    createNote(ctx, { kind: "person", title: "Example advisor", body: "Owes a transfer credit check by Nov 20. Related: [[Scheduling rules]].", scope: "global", source: "user" });
    createNote(ctx, { kind: "habit", title: "Works best before noon", body: "Observed: most finished blocks start before 12:00.", scope: "global", source: "jarvis-observed", confidence: 0.7 });
    createNote(ctx, { kind: "inference", title: "May prefer shorter blocks on Tuesdays", body: "Inference from two sessions. Not confirmed.", scope: "global", source: "jarvis-inferred", confidence: 0.4 });
    seedSkills(ctx);
    setSetting(ctx.db, "seeded", true);
    logActivity(ctx, "seed", null, "Demo workspace seeded");
  });
  return { seeded: true };
}

export function setClock(ctx: Ctx, iso: string) {
  if (ctx.mode !== "demo") throw new Error("The demo clock only exists in the demo workspace");
  setSetting(ctx.db, "demo_clock", new Date(iso).toISOString());
}

export function replay(ctx: Ctx, name: FixtureName) {
  if (ctx.mode !== "demo") throw new Error("Replay is available in the demo workspace only");
  const adv = (iso: string) => { const cur = ctx.now(); if (new Date(iso) > cur) setClock(ctx, iso); };
  const course = { courseExternalId: "example-ss201", courseCode: "SS201", courseName: "Example Social Science 201" };
  const out: any[] = [];
  switch (name) {
    case "bulletin": {
      // Reference material first, so the requirement can point at it.
      out.push(ingestRevision(ctx, { provider: "example-library", externalId: "bibliography-ss201", title: "Synthetic bibliography", ...course, kind: "reference", publishedAt: "2026-11-02T08:00:00-05:00", text: "Synthetic bibliography. Example Constitutional Reader, excerpt pp. 12-19 covers articles 4, 13, 16 and 31." }));
      const r = importBundle(ctx, { ...BUNDLE, calendar: [], promise: undefined, goal: undefined, revisions: [BUNDLE.revisions[1]] });
      out.push(...r.results);
      // The same notification arrives again by email.
      out.push(ingestRevision(ctx, { provider: "example-email", externalId: "msg-announcement-17-copy", title: "Email copy of Announcement 17", ...course, kind: "email", publishedAt: "2026-11-16T09:11:00-05:00", text: BUNDLE.revisions[1].text }));
      adv(BUNDLE.clock);
      break;
    }
    case "exam":
      out.push(ingestRevision(ctx, { provider: "example-blackboard", externalId: "bi108-exam-announcement", title: "BI108 exam announcement", courseExternalId: "example-bi108", courseCode: "BI108", courseName: "Example Biology 108", kind: "announcement", publishedAt: "2026-11-16T10:30:00-05:00", text: "BI108 Midterm 2 is on Friday, December 4 at 9 a.m. It covers chapters 12 to 15." }));
      adv("2026-11-16T10:30:00-05:00");
      break;
    case "registrar":
      out.push(ingestRevision(ctx, { provider: "example-email", externalId: "msg-registrar-1", title: "Email from Registrar's office", courseExternalId: "example-admin", courseCode: "ADMIN", courseName: "Administrative", kind: "email", publishedAt: "2026-11-16T10:45:00-05:00", text: "Hello Yonathan. We received your transfer credit petition. We will respond by Friday." }));
      adv("2026-11-16T10:45:00-05:00");
      break;
    case "conflict":
      out.push(ingestRevision(ctx, { provider: "example-blackboard", externalId: "gradebook-note-3", title: "Gradebook note", ...course, kind: "announcement", publishedAt: "2026-11-16T11:00:00-05:00", text: "Essay 2 is due Thursday, November 19 at 5 p.m." }));
      adv("2026-11-16T11:00:00-05:00");
      break;
    case "obsolete":
      out.push(ingestRevision(ctx, { provider: "example-blackboard", externalId: "old-schedule", title: "Old course schedule (PDF text)", ...course, kind: "syllabus", publishedAt: "2026-10-20T08:00:00-05:00", text: "Essay 2 is due Friday, November 27 at 5 p.m." }));
      break;
    case "waiver":
      out.push(ingestRevision(ctx, { provider: "example-blackboard", externalId: "announcement-18", title: "Announcement 18", ...course, kind: "announcement", publishedAt: "2026-11-17T12:00:00-05:00", text: "Essay 2: the print requirement is waived. Everyone uploads to Blackboard instead." }));
      adv("2026-11-17T12:00:00-05:00");
      break;
  }
  return out;
}

// Children before parents. Notes, projects, results, what Claude may read and every brief are erased with the workspace, not left behind.
const EVIDENCE_TABLES = ["brief_runs", "brief_feedback", "claude_grants", "share_log", "reader_submissions", "reader_tasks", "result_drafts", "result_versions", "results", "request_reads", "request_revisions", "requests", "evidence_facts", "evidence_revisions", "evidence_items", "feed_state", "evidence_sources", "roundtrips", "connection_probes", "project_events", "project_facts", "projects"];
const TABLES = ["quiz_answers", "quiz_attempts", "document_versions", "documents", "messages", "conversations", "attachments", "job_events", "job_steps", "jobs", "specialist_templates", "captures", "skill_uses", "skill_corrections", "skills", "council_sessions", "goal_observations", "goals", "checkpoints", "practice_results", "time_logs", "advisor_sources", "commitment_events", "commitments", "student_record", "deliveries", "inbox", "decisions", "requirements", "task_events", "task_due_history", "blocks", "tasks", "source_revisions", "source_status", "sources", "courses", "notes", "runs", "activity", "schedule_runs", "import_previews", "settings"];

/** Erase this workspace's data (not its watched inbox files). Demo reset and personal erase share this and each only touches its own directory. */
export function wipe(ctx: Ctx) {
  for (const d of ["vault", "skills", "attachments"]) fs.rmSync(path.join(/*turbopackIgnore: true*/ modeDir(ctx.mode), d), { recursive: true, force: true });
  // Erasing the private workspace removes everything in it. The example workspace's reset keeps its replayable evidence, as it always did.
  tx(ctx.db, () => { ctx.db.exec("DELETE FROM notes_fts"); if (ctx.mode === "personal") ctx.db.exec("DELETE FROM evidence_fts"); for (const t of [...(ctx.mode === "personal" ? EVIDENCE_TABLES : []), ...TABLES]) ctx.db.exec(`DELETE FROM ${t}`); });
}

export function resetDemo(ctx: Ctx) {
  if (ctx.mode !== "demo") throw new Error("Reset only touches the demo workspace");
  wipe(ctx);
}
export { createCommitment };
