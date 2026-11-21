// HTTP boundary: mode cookie, origin and host checks, Zod validation, error mapping. All logic lives in the domain modules.
import { z, ZodError } from "zod";
import { makeCtx, Ctx, Mode, getDb, all, get, run, getSetting, setSetting, modeDir } from "./db";
import { HttpError, ConflictError, ReserveInput, DeferInput, listDecisions, decisionDetail, reserve, defer, markHandled, resolveConflict, acceptNewTask, acceptPromise } from "./decisions";
import { seedDemo, replay, resetDemo, setClock, wipe, FIXTURES, FixtureName, isSeeded } from "./demo";
import { today, sourceHealth } from "./today";
import { listTasks, taskDetail, setStatus, StatusInput, recordCompletion, CompleteInput, reopenTask, logTime, TimeLogInput, completedTasks, weeklyReview } from "./tasks";
import { listGoals, observeGoal, upsertGoal, GoalInput } from "./goals";
import { listCommitments, createCommitment, prepareFollowUp, simulateEvent, resolveCommitment, reopenCommitment, studentRecord } from "./commitments";
import { forMinutes, saveCheckpoint, CheckpointInput, latestCheckpoint } from "./resume";
import * as mem from "./memory";
import { listSkills, teach, rollback, promoteCandidate, generateBrief } from "./skills";
import { startCouncil, getCouncil, cancelCouncil, listCouncil, PRESETS, SAMPLE_DRAFT, SAMPLE_SOURCES, SAMPLE_RUBRIC } from "./council";
import { Router, routerStatus, RouterError } from "./router";
import { previewImport, commitImport, ImportRequest } from "./imports";
import { connections } from "./adapters";
import { runNow, tick, schedulerStatus, scanInbox, inboxDir, weeklyFindings } from "./scheduler";
import { inbox as inboxList } from "./notify";
import { addAdvisorSource, AdvisorSourceInput, listAdvisorSources, deleteAdvisorSource, LENSES, advise } from "./advisors";
import { applyPractice } from "./study";
import { runCommand } from "./commands";
import { ingestRevision } from "./ingest";
import { captureToJarvis, CaptureInput, undoCapture, captureReceipt, recallFromJarvis } from "./capture";
import { createProject, listProjects, projectContext, projectEvents, applyProjectUpdate, editFact, undoEvent, forgetFact, pinFact, resolveSuggestion, ProjectUpdate } from "./projects";
import { createToken, listTokens, revokeToken, rotateToken, NewToken, startProbe, probeState, editProbe } from "./mcp-auth";
import { officeState, cancelJob, getJob, TERMINAL } from "./jobs";
import { kick, runnerStatus } from "./runner";
import { saveAttachment, readAttachment, listAttachments, getConversation, messages, handleUtterance, answerJob, retryJob } from "./study-guide";
import { getDocument, listDocuments, editGuide, renderPdf, startQuiz, quizState, answerQuestion, missedQuestions, quizHistory, ensureBi107, courseRow, findPreviousGuide, extractCoverage } from "./guides";

export const MODE_COOKIE = "jarvis_mode";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export class Req {
  constructor(public method: string, public path: string, public query: URLSearchParams, public headers: Headers, public bodyText: string, public params: Record<string, string> = {}) {}
  get mode(): Mode { return /(?:^|;\s*)jarvis_mode=personal/.test(this.headers.get("cookie") ?? "") ? "personal" : "demo"; }
  json<S extends z.ZodType>(schema: S): z.output<S> {
    let raw: unknown = {};
    if (this.bodyText) { try { raw = JSON.parse(this.bodyText); } catch { throw new HttpError(400, "Request body is not valid JSON"); } }
    return schema.parse(raw) as z.output<S>;
  }
}
export interface Res { status?: number; body: unknown; headers?: Record<string, string>; binary?: { data: Buffer; contentType: string; filename?: string } }

/** Reject foreign origins on mutations and non-loopback hosts everywhere (DNS rebinding). */
export function guard(req: Req, opts: { allowedHosts?: Set<string> } = {}) {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!(opts.allowedHosts ?? LOOPBACK).has(host)) throw new HttpError(403, `Host "${host}" is not allowed. Jarvis binds to loopback only.`);
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin) {
      let oh: string; try { oh = new URL(origin).host; } catch { throw new HttpError(403, "Bad origin"); }
      if (oh !== req.headers.get("host")) throw new HttpError(403, "Cross-origin request rejected");
    } else if (req.headers.get("sec-fetch-site") && !["same-origin", "none"].includes(req.headers.get("sec-fetch-site")!)) throw new HttpError(403, "Cross-site request rejected");
    const ct = req.headers.get("content-type") ?? "";
    if (req.bodyText && !/application\/json/i.test(ct)) throw new HttpError(415, "Send JSON");
  }
}

type Handler = (c: Ctx, r: Req) => unknown | Promise<unknown>;
const routes: { method: string; pattern: RegExp; keys: string[]; h: Handler; raw?: boolean }[] = [];
function on(method: string, path: string, h: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, pattern, keys, h });
}
const idBody = z.object({}).passthrough();
const demoOnly = (c: Ctx) => { if (c.mode !== "demo") throw new HttpError(403, "Only available in the demo workspace"); };

on("GET", "/health", () => ({ ok: true }));

// ---- Talk to Jarvis, study guides, quizzes ----
on("POST", "/assistant/message", (c, r) => {
  const b = r.json(z.object({ text: z.string().min(1).max(2000), conversationId: z.string().nullish(), course: z.string().max(60).nullish(), attachmentIds: z.array(z.string()).max(8).optional(), via: z.enum(["voice", "text"]).optional() }));
  const out = handleUtterance(c, b); kick(c.mode); return out;
});
on("GET", "/assistant/conversation", (c, r) => { const course = r.query.get("course"); const conv = getConversation(c, r.query.get("id"), course); return { conversation: conv, messages: messages(c, conv.id as string) }; });
on("POST", "/attachments", (c, r) => {
  const b = r.json(z.object({ course: z.string().min(1).max(60), name: z.string().min(1).max(120), dataBase64: z.string().max(4_300_000), conversationId: z.string().optional() }));
  return saveAttachment(c, { course: b.course, name: b.name, bytes: Buffer.from(b.dataBase64, "base64"), conversationId: b.conversationId });
});
on("GET", "/attachments/:id/raw", (c, r) => { const a = readAttachment(c, r.params.id); (r as any).binary = { data: a.bytes, contentType: a.mime }; return null; });
on("GET", "/courses", (c) => { if (c.mode === "demo") ensureBi107(c); return { courses: all(c.db, "SELECT code,name,external_id FROM courses WHERE owner_id=? ORDER BY code", c.owner) }; });
on("GET", "/courses/:code", (c, r) => {
  if (c.mode === "demo" && /^bi107$/i.test(r.params.code)) ensureBi107(c);
  const course = courseRow(c, r.params.code); if (!course) throw new HttpError(404, "Course not found");
  const code = course.code as string;
  return { course: { code, name: course.name, externalId: course.external_id }, documents: listDocuments(c, code), attachments: listAttachments(c, code), coverage: extractCoverage(c, code), previousGuide: findPreviousGuide(c, code),
    materials: all(c.db, `SELECT s.title, s.kind, MAX(r.published_at) latest FROM sources s JOIN source_revisions r ON r.source_id=s.id WHERE s.course_id=? GROUP BY s.id ORDER BY latest DESC`, course.id), synthetic: c.mode === "demo" };
});
on("GET", "/documents/:id", (c, r) => { const v = r.query.get("version"); const d = getDocument(c, r.params.id, v ? Number(v) : undefined); if (!d) throw new HttpError(404, "Guide not found"); return { ...d, history: quizHistory(c, r.params.id), missed: missedQuestions(c, d.doc.course as string) }; });
on("PUT", "/documents/:id", (c, r) => { const b = r.json(z.object({ content: z.unknown(), baseVersion: z.number().int() })); return editGuide(c, r.params.id, b.content, b.baseVersion); });
on("GET", "/documents/:id/pdf", async (c, r) => {
  const v = r.query.get("version"); const d = getDocument(c, r.params.id, v ? Number(v) : undefined); if (!d) throw new HttpError(404, "Guide not found");
  const answers = r.query.get("answers") === "1";
  const data = await renderPdf(d.content, { version: d.version, answers });
  (r as any).binary = { data, contentType: "application/pdf", filename: `${String(d.content.title).replace(/[^\w]+/g, "-")}-v${d.version}${answers ? "-answer-key" : ""}.pdf` }; return null;
});
on("POST", "/quiz/start", (c, r) => startQuiz(c, r.json(z.object({ docId: z.string(), mode: z.enum(["all", "missed"]).default("all"), version: z.number().int().optional() }))));
on("GET", "/quiz/missed", (c, r) => ({ missed: missedQuestions(c, r.query.get("course") ?? "") }));
on("GET", "/quiz/:id", (c, r) => quizState(c, r.params.id));
on("POST", "/quiz/:id/answer", (c, r) => { const b = r.json(z.object({ questionId: z.string(), chosen: z.string().regex(/^[A-F]$/) })); return answerQuestion(c, r.params.id, b.questionId, b.chosen); });
on("POST", "/office/jobs/:id/answer", (c, r) => { const out = answerJob(c, r.params.id, r.json(z.object({ guideId: z.string().optional(), importText: z.string().max(60000).optional(), importTitle: z.string().max(120).optional() }))); kick(c.mode); return out; });
on("POST", "/office/jobs/:id/retry", (c, r) => { const out = retryJob(c, r.params.id); kick(c.mode); return out; });

// ---- Capture and the Live Office ----
on("POST", "/captures", (c, r) => { const rec = captureToJarvis(c, { ...r.json(CaptureInput), via: "app" }); kick(c.mode); return rec; });
on("GET", "/captures", (c) => ({ captures: all(c.db, "SELECT id FROM captures WHERE owner_id=? ORDER BY created_at DESC LIMIT 20", c.owner).map((x) => captureReceipt(c, x.id as string)) }));
on("GET", "/captures/:id", (c, r) => { const x = captureReceipt(c, r.params.id); if (!x) throw new HttpError(404, "Capture not found"); return x; });
on("POST", "/captures/:id/undo", (c, r) => undoCapture(c, r.params.id));
on("GET", "/recall", (c, r) => recallFromJarvis(c, r.query.get("q") ?? ""));
on("GET", "/projects", (c) => ({ projects: listProjects(c) }));
on("POST", "/projects", (c, r) => createProject(c, r.json(z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(["trip", "course", "club", "project", "other"]).default("project"), aliases: z.array(z.string().max(80)).max(8).optional() }).strict())));
on("GET", "/projects/:id", (c, r) => ({ ...projectContext(c, r.params.id), events: projectEvents(c, r.params.id) }));
on("POST", "/projects/:id/update", (c, r) => { const b = r.json(z.record(z.string(), z.unknown())); return applyProjectUpdate(c, { ...(b as any), project: r.params.id, origin: "jarvis-ui" }); });
on("POST", "/projects/facts/:id/edit", (c, r) => { const b = r.json(z.object({ text: z.string().trim().min(1).max(1000), expectedRevision: z.number().int().min(0) }).strict()); return editFact(c, r.params.id, b.text, b.expectedRevision); });
on("POST", "/projects/facts/:id/forget", (c, r) => { r.json(z.object({ confirm: z.literal(true) })); return forgetFact(c, r.params.id); });
on("POST", "/projects/facts/:id/pin", (c, r) => pinFact(c, r.params.id, r.json(z.object({ pinned: z.boolean() })).pinned));
on("POST", "/projects/facts/:id/resolve", (c, r) => resolveSuggestion(c, r.params.id, r.json(z.object({ accept: z.boolean() })).accept));
on("POST", "/projects/events/:id/undo", (c, r) => undoEvent(c, r.params.id));
on("GET", "/connections", (c) => ({ tokens: listTokens(c), probe: probeState(c), envToken: !!process.env.JARVIS_MCP_TOKEN, publicUrl: process.env.JARVIS_PUBLIC_URL ?? null, ingress: process.env.JARVIS_PUBLIC_MODE === "mcp-only" ? "mcp-only" : "full", mode: c.mode }));
on("POST", "/connections/tokens", (c, r) => createToken(c, r.json(NewToken)));
on("POST", "/connections/tokens/:id/revoke", (c, r) => revokeToken(c, r.params.id));
on("POST", "/connections/tokens/:id/rotate", (c, r) => rotateToken(c, r.params.id));
on("POST", "/connections/probe", (c) => startProbe(c));
on("POST", "/connections/probe/:id/edit", (c, r) => editProbe(c, r.params.id));
on("GET", "/office", (c) => ({ ...officeState(c), runner: runnerStatus(c.mode), decisions: listDecisions(c).filter((d) => ["commitment_plan"].includes(d.kind)).map((d) => ({ id: d.id, title: d.title, urgency: d.urgency })),
  captures: all(c.db, "SELECT id FROM captures WHERE owner_id=? ORDER BY created_at DESC LIMIT 5", c.owner).map((x) => captureReceipt(c, x.id as string)), templates: all(c.db, "SELECT id,name,role,status,tools FROM specialist_templates WHERE owner_id=?", c.owner) }));
on("POST", "/office/run", (c) => { kick(c.mode); return { ok: true }; });
on("POST", "/office/jobs/:id/cancel", (c, r) => { if (!getJob(c, r.params.id)) throw new HttpError(404, "Job not found"); return { cancelled: cancelJob(c, r.params.id) }; });
on("POST", "/office/jobs/:id/template", (c, r) => {
  const j = getJob(c, r.params.id); if (!j) throw new HttpError(404, "Job not found");
  if (j.status !== "done") throw new HttpError(409, "A specialist becomes a template only after a successful run.");
  const name = r.json(z.object({ name: z.string().min(2).max(60) })).name;
  const id = `tpl_${j.id.slice(4)}`;
  run(c.db, "INSERT OR IGNORE INTO specialist_templates(id,owner_id,name,role,tools,status,source_job_id,created_at) VALUES(?,?,?,?,?,'proposed',?,?)", id, c.owner, name, j.role, JSON.stringify(j.tools), j.id, c.now().toISOString());
  return { id, status: "proposed", note: "Proposed only. It gets no permanent access and no schedule until you approve it." };
});
on("POST", "/office/templates/:id/approve", (c, r) => {
  r.json(z.object({ confirm: z.literal(true) }));
  const t = get(c.db, "SELECT * FROM specialist_templates WHERE id=? AND owner_id=?", r.params.id, c.owner); if (!t) throw new HttpError(404, "Template not found");
  run(c.db, "UPDATE specialist_templates SET status='approved', approved_at=? WHERE id=?", c.now().toISOString(), r.params.id);
  return { ok: true, note: "Approved as a named template. It keeps only the tools it already had. A recurring schedule still needs a separate approval." };
});
on("GET", "/session", (c) => ({ mode: c.mode, now: c.now().toISOString(), seeded: isSeeded(c), fixtures: c.mode === "demo" ? FIXTURES : null, scheduler: schedulerStatus(c), dataDir: modeDir(c.mode), label: c.mode === "demo" ? "Example workspace. Fictional data. Demo clock." : "Private workspace. Your data. Real clock." }));
on("POST", "/demo/seed", (c) => { demoOnly(c); return seedDemo(c); });
on("POST", "/demo/reset", (c, r) => { demoOnly(c); r.json(z.object({ confirm: z.literal("RESET DEMO") })); resetDemo(c); return seedDemo(c); });
on("POST", "/demo/replay", (c, r) => { demoOnly(c); const { name } = r.json(z.object({ name: z.enum(Object.keys(FIXTURES) as [FixtureName, ...FixtureName[]]) })); const out = replay(c, name); return { name, results: out.map((x: any) => ({ newRevision: x.newRevision, duplicateOf: x.duplicateOf, stale: x.stale, changes: x.changes })) }; });
on("POST", "/demo/clock", (c, r) => { demoOnly(c); const { iso } = r.json(z.object({ iso: z.string().refine((s) => !Number.isNaN(Date.parse(s))) })); setClock(c, iso); return { now: c.now().toISOString() }; });
on("POST", "/erase", (c, r) => { if (c.mode !== "personal") throw new HttpError(403, "Erase only applies to the private workspace. Use Reset in the demo."); r.json(z.object({ confirm: z.literal("ERASE PERSONAL") })); wipe(c); return { ok: true }; });
on("GET", "/export", (c) => {
  const tables = ["courses", "sources", "source_revisions", "source_status", "tasks", "task_due_history", "task_events", "requirements", "blocks", "decisions", "commitments", "commitment_events", "student_record", "notes", "skills", "skill_uses", "skill_corrections", "council_sessions", "goals", "goal_observations", "checkpoints", "practice_results", "time_logs", "advisor_sources", "runs", "inbox", "settings"];
  const out: Record<string, unknown> = { exportedAt: c.now().toISOString(), mode: c.mode, schema: 1 };
  for (const t of tables) out[t] = all(c.db, `SELECT * FROM ${t}`).filter((r: any) => !(t === "notes" && (r.sensitivity === "private" || r.tombstone)));
  return out;
});

on("GET", "/today", (c) => today(c));
on("GET", "/decisions", (c, r) => ({ decisions: listDecisions(c, (r.query.get("state") ?? "pending").split(",")) }));
on("GET", "/decisions/:id", (c, r) => { const d = decisionDetail(c, r.params.id); if (!d) throw new HttpError(404, "Decision not found"); return { ...d, memory: d.task ? mem.notesUsedFor(c, { external_id: d.task.external_id as string, course_ext: (get(c.db, "SELECT external_id e FROM courses WHERE id=?", d.task.course_id)?.e as string) }) : mem.notesUsedFor(c, null) }; });
on("POST", "/decisions/:id/reserve", (c, r) => reserve(c, r.params.id, r.json(ReserveInput)));
on("POST", "/decisions/:id/defer", (c, r) => defer(c, r.params.id, r.json(DeferInput)));
on("POST", "/decisions/:id/handled", (c, r) => markHandled(c, r.params.id, r.json(z.object({ note: z.string().max(300).optional() })).note));
on("POST", "/decisions/:id/resolve", (c, r) => resolveConflict(c, r.params.id, r.json(z.object({ side: z.enum(["a", "b"]) })).side));
on("POST", "/decisions/:id/accept", (c, r) => { const d = get(c.db, "SELECT kind FROM decisions WHERE id=? AND owner_id=?", r.params.id, c.owner); if (!d) throw new HttpError(404, "Decision not found"); return d.kind === "promise_found" ? acceptPromise(c, r.params.id) : acceptNewTask(c, r.params.id); });
on("POST", "/decisions/:id/waited", (c, r) => {
  const d = get(c.db, "SELECT kind,title FROM decisions WHERE id=? AND owner_id=?", r.params.id, c.owner);
  if (!d) throw new HttpError(404, "Decision not found");
  const key = `waited:${d.kind}`; const n = getSetting<number>(c.db, key, 0) + 1; setSetting(c.db, key, n);
  // Narrow learning: only this kind of update, provisional until it happens twice.
  mem.createNote(c, { kind: "inference", title: `"${d.kind}" updates can wait`, body: `You said "That could have waited" for a ${d.kind} update (${n} time${n > 1 ? "s" : ""}).`, scope: `kind:${d.kind}`, source: "jarvis-learned", confidence: n >= 2 ? 0.85 : 0.5 });
  return { ok: true, count: n, note: n >= 2 ? "Updates of this kind will now go in the brief or update silently." : "Noted. Jarvis will wait for one more before changing anything." };
});

on("GET", "/tasks", (c, r) => ({ tasks: listTasks(c, { status: r.query.get("status") ?? undefined, course: r.query.get("course") ?? undefined, kind: r.query.get("kind") ?? undefined }) }));
on("GET", "/tasks/:id", (c, r) => { const d = taskDetail(c, r.params.id); if (!d) throw new HttpError(404, "Task not found"); return d; });
on("POST", "/tasks/:id/status", (c, r) => setStatus(c, r.params.id, r.json(StatusInput)));
on("POST", "/tasks/:id/complete", (c, r) => recordCompletion(c, r.params.id, r.json(CompleteInput)));
on("POST", "/tasks/:id/reopen", (c, r) => reopenTask(c, r.params.id));
on("POST", "/tasks/:id/time", (c, r) => logTime(c, r.params.id, r.json(TimeLogInput)));
on("POST", "/tasks/:id/practice", (c, r) => { const b = r.json(z.object({ area: z.string().min(1).max(120), correct: z.number().int().min(0), total: z.number().int().min(1).max(100), note: z.string().max(200).optional() })); return applyPractice(c, r.params.id, b.area, b.correct, b.total, b.note); });
on("GET", "/tasks/:id/brief", (c, r) => generateBrief(c, r.params.id));
on("POST", "/tasks/:id/receipt-fixture", (c, r) => {
  demoOnly(c); const t = get(c.db, "SELECT t.title, t.id, co.external_id ce FROM tasks t JOIN courses co ON co.id=t.course_id WHERE t.id=? AND t.owner_id=?", r.params.id, c.owner);
  if (!t) throw new HttpError(404, "Task not found");
  const x = ingestRevision(c, { provider: "example-email", externalId: `receipt-${t.id}`, title: `Submission receipt for ${t.title} (fixture)`, courseExternalId: t.ce as string, kind: "receipt", text: `Fixture receipt: your submission for ${t.title} was received.`, publishedAt: c.now().toISOString() });
  return { revisionId: x.revisionId };
});
on("GET", "/completed", (c, r) => ({ tasks: completedTasks(c, r.query.get("course") ?? undefined), courses: all(c.db, "SELECT external_id,code FROM courses WHERE owner_id=? ORDER BY code", c.owner) }));
on("GET", "/review/weekly", (c) => ({ review: weeklyReview(c), blindSpots: weeklyFindings(c) }));

on("GET", "/goals", (c) => ({ goals: listGoals(c) }));
on("POST", "/goals", (c, r) => ({ id: upsertGoal(c, r.json(GoalInput)) }));
on("POST", "/goals/:id/observe", (c, r) => { const b = r.json(z.object({ value: z.number().min(0), note: z.string().max(200).optional() })); return observeGoal(c, r.params.id, b.value, b.note); });

on("GET", "/commitments", (c) => ({ commitments: listCommitments(c), record: studentRecord(c) }));
on("POST", "/commitments", (c, r) => ({ id: createCommitment(c, r.json(z.object({ who: z.string().min(1).max(120), owedTo: z.string().min(1).max(120), action: z.string().min(1).max(300), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), agreement: z.string().max(300).optional() }))) }));
on("POST", "/commitments/:id/followup", (c, r) => prepareFollowUp(c, r.params.id));
on("POST", "/commitments/:id/simulate", (c, r) => { demoOnly(c); return simulateEvent(c, r.params.id, r.json(z.object({ event: z.enum(["send_ack", "reply", "correction"]) })).event); });
on("POST", "/commitments/:id/resolve", (c, r) => resolveCommitment(c, r.params.id, r.json(z.object({ evidence: z.string().max(400) })).evidence));
on("POST", "/commitments/:id/reopen", (c, r) => { reopenCommitment(c, r.params.id); return { ok: true }; });

on("GET", "/resume", (c, r) => ({ suggestion: forMinutes(c, Math.min(240, Math.max(5, Number(r.query.get("minutes") ?? 20)))), latest: latestCheckpoint(c) }));
on("POST", "/checkpoints", (c, r) => saveCheckpoint(c, r.json(CheckpointInput)));

on("GET", "/memory/notes", (c, r) => ({ notes: mem.listNotes(c, { includeSuperseded: r.query.get("all") === "1" }) }));
on("GET", "/memory/notes/:id", (c, r) => { const n = mem.getNote(c, r.params.id); if (!n) throw new HttpError(404, "Note not found"); return n; });
on("GET", "/memory/search", (c, r) => ({ results: mem.searchNotes(c, r.query.get("q") ?? "") }));
on("GET", "/memory/graph/:id", (c, r) => mem.graph(c, r.params.id));
on("GET", "/memory/learned", (c) => ({ notes: mem.learned(c) }));
on("GET", "/memory/timeline", (c) => ({ notes: mem.timeline(c) }));
on("POST", "/memory/notes", (c, r) => ({ id: mem.createNote(c, r.json(mem.NoteInput)) }));
on("PATCH", "/memory/notes/:id", (c, r) => mem.updateNote(c, r.params.id, r.json(mem.NotePatch)));
on("POST", "/memory/notes/:id/supersede", (c, r) => mem.supersedeNote(c, r.params.id, r.json(mem.NoteInput.partial().extend({ body: z.string().max(50000) })) as any));
on("DELETE", "/memory/notes/:id", (c, r) => mem.deleteNote(c, r.params.id));
on("POST", "/memory/export", (c) => mem.exportVault(c));
on("POST", "/memory/import", (c) => mem.importVault(c));
on("POST", "/memory/conflict", (c, r) => { const b = r.json(z.object({ id: z.string(), keep: z.enum(["app", "file"]) })); return mem.resolveNoteConflict(c, b.id, b.keep); });
on("POST", "/reflect", (c, r) => { const b = r.json(z.object({ message: z.string().min(1).max(2000), perspective: z.enum(["A", "B"]) })); return { transient: true, reply: mem.reflect(b.message, b.perspective), stored: false }; });
on("POST", "/reflect/save", (c, r) => { const b = r.json(z.object({ takeaway: z.string().min(3).max(300) })); return { id: mem.createNote(c, { kind: "inbox", title: "Reflection takeaway", body: b.takeaway, source: "reflection-room (you chose to save this)", sensitivity: "private" }) }; });

on("GET", "/skills", (c) => ({ skills: listSkills(c) }));
on("POST", "/skills/teach", (c, r) => teach(c, r.json(z.object({ text: z.string().min(4).max(500), taskId: z.string().optional(), via: z.enum(["text", "voice", "task"]).optional() }))));
on("POST", "/skills/rollback", (c) => rollback(c));
on("POST", "/skills/promote", (c, r) => promoteCandidate(c, r.json(z.object({ version: z.number().int() })).version));

const routerFor = (c: Ctx) => new Router(c);
on("GET", "/council", (c) => ({ sessions: listCouncil(c), presets: PRESETS, sample: { draft: SAMPLE_DRAFT, sources: SAMPLE_SOURCES, rubric: SAMPLE_RUBRIC }, router: routerFor(c).resolve("essay_review") }));
on("GET", "/council/:id", (c, r) => { const s = getCouncil(c, r.params.id); if (!s) throw new HttpError(404, "Session not found"); return s; });
on("POST", "/council/start", (c, r) => {
  const b = r.json(z.object({ preset: z.enum(["essay", "pitch", "founder"]), question: z.string().min(3).max(500), draft: z.string().max(60000), sources: z.array(z.object({ id: z.string(), title: z.string(), text: z.string().max(40000) })).max(8).default([]), rubric: z.array(z.string().max(300)).max(12).default([]), taskId: z.string().optional(), requiredArticles: z.array(z.number().int()).max(20).optional(), force: z.boolean().optional() }));
  const { id, reused } = startCouncil(c, routerFor(c), b, { background: true, force: b.force });
  return { id, reused };
});
on("POST", "/council/:id/cancel", (c, r) => cancelCouncil(c, r.params.id));

on("GET", "/advisors", (c) => ({ sources: listAdvisorSources(c), lenses: LENSES }));
on("POST", "/advisors/sources", (c, r) => addAdvisorSource(c, r.json(AdvisorSourceInput)));
on("DELETE", "/advisors/sources/:id", (c, r) => deleteAdvisorSource(c, r.params.id));
on("POST", "/advisors/turn", (c, r) => { const b = r.json(z.object({ lens: z.string(), question: z.string().min(2).max(500) })); return advise(c, b.lens, b.question); });

on("POST", "/import/preview", (c, r) => previewImport(c, r.json(ImportRequest)));
on("POST", "/import/commit", (c, r) => { const b = r.json(z.object({ token: z.string(), courseExternalId: z.string().optional() })); return commitImport(c, b.token, { courseExternalId: b.courseExternalId }); });
on("GET", "/sources", (c) => ({ sources: all(c.db, `SELECT s.id,s.provider,s.title,s.kind,co.code course, (SELECT COUNT(*) FROM source_revisions r WHERE r.source_id=s.id) revisions, (SELECT MAX(published_at) FROM source_revisions r WHERE r.source_id=s.id) latest FROM sources s LEFT JOIN courses co ON co.id=s.course_id WHERE s.owner_id=? ORDER BY latest DESC`, c.owner) }));
on("GET", "/sources/:id", (c, r) => ({ source: get(c.db, "SELECT * FROM sources WHERE id=? AND owner_id=?", r.params.id, c.owner), revisions: all(c.db, "SELECT id,published_at,observed_at,duplicate_of,stale,substr(text,1,600) text FROM source_revisions WHERE source_id=? ORDER BY published_at", r.params.id) }));
on("GET", "/sources-health", (c) => {
  const sch = schedulerStatus(c);
  const sources = sourceHealth(c).map((s) => {
    const polled = ["inbox-folder", "ics-feed"].includes(s.provider);
    if (polled) return { ...s, nextCheckAt: sch.active && sch.nextRun ? sch.nextRun.at : null, gapReason: s.gapReason ?? (sch.active ? null : "No worker is running, so this is only checked when you click Run now.") };
    if (s.provider.startsWith("capture:")) return { ...s, nextCheckAt: null, gapReason: s.gapReason ?? "Event-driven. It only changes when you save something. There is no polling." };
    return s;
  });
  return { sources, disabled: getSetting<string[]>(c.db, "disabled_sources", []) };
});
on("POST", "/sources-health/disconnect", (c, r) => {
  const b = r.json(z.object({ provider: z.string().min(1).max(60), disconnected: z.boolean() }));
  const row = get(c.db, "SELECT * FROM source_status WHERE owner_id=? AND provider=?", c.owner, b.provider);
  if (!row) throw new HttpError(404, "Unknown source");
  const cur = getSetting<string[]>(c.db, "disabled_sources", []).filter((x) => x !== b.provider);
  setSetting(c.db, "disabled_sources", b.disconnected ? [...cur, b.provider] : cur);
  // The last successful verification time is kept either way. Data already imported stays.
  run(c.db, "UPDATE source_status SET state=?, message=? WHERE owner_id=? AND provider=?", b.disconnected ? "disconnected" : "unverified",
    b.disconnected ? "Disconnected by you. Nothing is read. Imported data and the last verified time are kept." : "Reconnected. Run a check to verify it again.", c.owner, b.provider);
  return { ok: true };
});
on("GET", "/connections", (c) => connections(c).then((list) => ({ connections: list })));
on("POST", "/connections/check", (c) => connections(c, { check: true }).then((list) => ({ connections: list, checkedAt: c.now().toISOString(), note: "Local checks only. Nothing here verifies a live account." })));
on("POST", "/connections/claude-test", async (c) => {
  const router = routerFor(c); const res = router.resolve("extract_small");
  if (res.status !== "ready") return { ok: false, ...res };
  try { const out = await router.call("extract_small", { system: "Reply with the single word OK.", user: "ping", initiator: "health-check" }); return { ok: true, model: out.model, effort: out.effort, costEstimateUsd: out.costEstimateUsd, costIsEstimate: true }; }
  catch (e: any) { return { ok: false, message: e.message }; }
});
on("GET", "/router", (c) => routerStatus(c));
on("GET", "/inbox", (c) => ({ items: inboxList(c) }));
on("POST", "/inbox/read", (c) => { run(c.db, "UPDATE inbox SET read=1"); return { ok: true }; });

on("GET", "/scheduler", (c) => schedulerStatus(c));
on("POST", "/scheduler/run-now", async (c) => runNow(c));
on("POST", "/scheduler/pause", (c, r) => { setSetting(c.db, "scheduler_paused", r.json(z.object({ paused: z.boolean() })).paused); return schedulerStatus(c); });
on("POST", "/scheduler/tick", async (c, r) => { demoOnly(c); const { advanceTo } = r.json(z.object({ advanceTo: z.string() })); setClock(c, advanceTo); return tick(c); });
on("GET", "/settings", (c) => ({
  tz: getSetting(c.db, "tz", "America/New_York"), checkTimes: getSetting(c.db, "check_times", ["08:00", "16:00"]), weeklyTime: getSetting(c.db, "weekly_time", "15:00"),
  quietDaily: getSetting(c.db, "quiet_daily", []), protectedDaily: getSetting(c.db, "protected_daily", []), protectedIntervals: getSetting(c.db, "protected_intervals", []),
  dayStart: getSetting(c.db, "day_start", "08:00"), dayEnd: getSetting(c.db, "day_end", "22:00"),
  channels: getSetting(c.db, "channels", { inbox: true, capture: false, push: false, sms: false }), dailyBudgetUsd: getSetting(c.db, "daily_budget_usd", 0),
  premiumOptIn: getSetting(c.db, "premium_opt_in", false), schedulerEnabled: getSetting(c.db, "scheduler_enabled", c.mode === "demo"), inboxDir: inboxDir(c),
}));
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
on("POST", "/settings", (c, r) => {
  const b = r.json(z.object({
    checkTimes: z.tuple([hhmm, hhmm]).optional(), weeklyTime: hhmm.optional(), quietDaily: z.array(z.object({ start: hhmm, end: hhmm })).max(4).optional(),
    protectedDaily: z.array(z.object({ start: hhmm, end: hhmm, label: z.string().max(60) })).max(6).optional(),
    protectedIntervals: z.array(z.object({ start: z.string(), end: z.string(), label: z.string().max(60), source: z.string().default("user-entered") })).max(60).optional(),
    dayStart: hhmm.optional(), dayEnd: hhmm.optional(), dailyBudgetUsd: z.number().min(0).max(1000).optional(), premiumOptIn: z.boolean().optional(),
    schedulerEnabled: z.boolean().optional(), capture: z.boolean().optional(),
  }));
  const set = (k: string, v: unknown) => v !== undefined && setSetting(c.db, k, v);
  set("check_times", b.checkTimes); set("weekly_time", b.weeklyTime); set("quiet_daily", b.quietDaily); set("protected_daily", b.protectedDaily); set("protected_intervals", b.protectedIntervals);
  set("day_start", b.dayStart); set("day_end", b.dayEnd); set("daily_budget_usd", b.dailyBudgetUsd); set("premium_opt_in", b.premiumOptIn); set("scheduler_enabled", b.schedulerEnabled);
  if (b.capture !== undefined) setSetting(c.db, "channels", { ...getSetting(c.db, "channels", { inbox: true, capture: false, push: false, sms: false }), capture: b.capture });
  return { ok: true };
});
on("POST", "/command", (c, r) => runCommand(c, r.json(z.object({ text: z.string().max(500) })).text));
on("POST", "/capture", (c, r) => { const b = r.json(z.object({ text: z.string().min(2).max(500) })); return { id: mem.createNote(c, { kind: "inbox", title: b.text.slice(0, 60), body: b.text, source: "capture" }) }; });

export async function handle(method: string, pathname: string, query: URLSearchParams, headers: Headers, bodyText: string): Promise<Res> {
  try {
    const req = new Req(method, pathname, query, headers, bodyText);
    guard(req);
    for (const rt of routes) {
      if (rt.method !== method) continue;
      const m = rt.pattern.exec(pathname);
      if (!m) continue;
      req.params = Object.fromEntries(rt.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      if (pathname === "/mode") break;
      const ctx = makeCtx(req.mode);
      if (ctx.mode === "demo" && !isSeeded(ctx) && pathname !== "/demo/reset") seedDemo(ctx);   // first open of the example workspace
      const out = await rt.h(ctx, req);
      if ((req as any).binary) return { body: null, binary: (req as any).binary };
      return { body: out };
    }
    if (method === "POST" && pathname === "/mode") {
      const { mode } = req.json(z.object({ mode: z.enum(["demo", "personal"]) }));
      return { body: { mode }, headers: { "set-cookie": `${MODE_COOKIE}=${mode}; Path=/; SameSite=Strict; HttpOnly; Max-Age=31536000` } };
    }
    throw new HttpError(404, `No route for ${method} ${pathname}`);
  } catch (e: any) {
    if (e instanceof ConflictError) return { status: 409, body: { error: e.message, conflict: true, fresh: e.fresh } };
    if (e instanceof RouterError) return { status: e.code === "no_provider" || e.code === "budget_off" ? 424 : 429, body: { error: e.message, code: e.code } };
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    if (e instanceof ZodError) return { status: 422, body: { error: e.issues.slice(0, 3).map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") } };
    if (/UNIQUE constraint/.test(String(e?.message))) return { status: 409, body: { error: "That already exists." } };
    console.error("[api]", e?.stack ?? e);
    return { status: 500, body: { error: "Something went wrong on the server. Nothing was changed." } };
  }
}
export { getDb, seedDemo, scanInbox };
