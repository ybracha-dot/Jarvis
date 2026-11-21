// The spoken BI107 workflow: an utterance becomes a background job that finds the last guide, reads the photos and course materials,
// writes original multiple-choice questions, checks the key, saves a versioned guide, and tells the conversation where it is.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Ctx, all, get, run, tx, uid, sha, modeDir } from "./db";
import { HttpError } from "./decisions";
import { submitGoal, looksLikeGoal } from "./assistant";
import { Handler, JobApi, enqueueJob, getJob, jobEvent } from "./jobs";
import { Router, RouterError } from "./router";
import { enqueue } from "./notify";
import { analyzeQuality, sniff, sha256, claudeReader, fixtureReader, fixtureKind, NeedsProvider, VisionReader, PhotoInput, Reading } from "./images";
import { GuideContent, Question, courseMaterials, courseRow, resolveCourse, findPreviousGuide, extractFormat, extractCoverage, getDocument, saveVersion, parseGuideMarkdown, checkKey, claudeWriter, fixtureWriter, NeedsWriter, ensureBi107, startQuiz, missedQuestions, listDocuments } from "./guides";
import { captureToJarvis } from "./capture";
import { runCommand } from "./commands";

export const factories = {
  router: (ctx: Ctx) => new Router(ctx),
};

// ---------- attachments (private to this user) ----------
const MAX_BYTES = 3 * 1024 * 1024;
export function saveAttachment(ctx: Ctx, o: { course: string; name: string; bytes: Buffer; role?: "style" | "format" | "coverage"; conversationId?: string }) {
  if (!courseRow(ctx, o.course)) throw new HttpError(404, `Unknown course ${o.course}`);
  if (o.bytes.length > MAX_BYTES) throw new HttpError(413, `That photo is ${(o.bytes.length / 1048576).toFixed(1)} MB. The limit is 3 MB. Photos are shrunk before upload in the app.`);
  const mime = sniff(o.bytes);
  if (!mime) throw new HttpError(415, /ftypheic|ftypmif1|ftyphevc/.test(o.bytes.subarray(4, 16).toString("latin1")) ? "HEIC photos are not supported yet. Share it as a JPEG or take a screenshot." : "Only PNG and JPEG photos are supported.");
  const hash = sha256(o.bytes);
  const ex = get(ctx.db, "SELECT * FROM attachments WHERE owner_id=? AND course=? AND sha=?", ctx.owner, o.course, hash);
  if (ex) return { id: ex.id as string, duplicate: true, name: ex.name as string, quality: JSON.parse(ex.quality as string) };
  let quality; try { quality = analyzeQuality(o.bytes); } catch (e: any) { throw new HttpError(422, `That image could not be decoded: ${e.message}`); }
  const id = uid("att"); const dir = path.join(/*turbopackIgnore: true*/ modeDir(ctx.mode), "attachments"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(/*turbopackIgnore: true*/ dir, `${id}.${mime === "image/png" ? "png" : "jpg"}`); fs.writeFileSync(file, o.bytes);
  const name = o.name.replace(/[^\w.\- ]/g, "_").slice(0, 80) || "photo";
  run(ctx.db, "INSERT INTO attachments(id,owner_id,course,conversation_id,name,mime,size,sha,path,role,quality,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, ctx.owner, o.course, o.conversationId ?? null, name, mime, o.bytes.length, hash, file, o.role ?? "style", JSON.stringify(quality), ctx.now().toISOString());
  return { id, duplicate: false, name, quality };
}
export function readAttachment(ctx: Ctx, id: string) {
  const a = get(ctx.db, "SELECT * FROM attachments WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!a) throw new HttpError(404, "Attachment not found");
  return { bytes: fs.readFileSync(a.path as string), mime: a.mime as string, name: a.name as string, row: a };
}
export const listAttachments = (ctx: Ctx, course: string) => all(ctx.db, "SELECT id,name,mime,size,role,quality,reading,created_at FROM attachments WHERE owner_id=? AND course=? ORDER BY created_at DESC", ctx.owner, course)
  .map((a) => ({ ...a, quality: JSON.parse(a.quality as string), reading: a.reading ? JSON.parse(a.reading as string) : null }));

// ---------- conversations ----------
export function getConversation(ctx: Ctx, id?: string | null, course?: string | null) {
  if (id) { const c = get(ctx.db, "SELECT * FROM conversations WHERE id=? AND owner_id=?", id, ctx.owner); if (c) return c; }
  const ex = course ? get(ctx.db, "SELECT * FROM conversations WHERE owner_id=? AND course=? ORDER BY created_at DESC LIMIT 1", ctx.owner, course) : get(ctx.db, "SELECT * FROM conversations WHERE owner_id=? AND course IS NULL ORDER BY created_at DESC LIMIT 1", ctx.owner);
  if (ex) return ex;
  const nid = uid("conv"); run(ctx.db, "INSERT INTO conversations(id,owner_id,course,title,created_at) VALUES(?,?,?,?,?)", nid, ctx.owner, course ?? null, course ? `${course} workspace` : "Jarvis", ctx.now().toISOString());
  return get(ctx.db, "SELECT * FROM conversations WHERE id=?", nid)!;
}
export function addMessage(ctx: Ctx, convId: string, m: { role: "user" | "jarvis"; text: string; kind?: string; data?: unknown; jobId?: string }) {
  const id = uid("msg"); run(ctx.db, "INSERT INTO messages(id,conversation_id,role,kind,text,at,data,job_id) VALUES(?,?,?,?,?,?,?,?)", id, convId, m.role, m.kind ?? "text", m.text, ctx.now().toISOString(), JSON.stringify(m.data ?? {}), m.jobId ?? null); return id;
}
export const messages = (ctx: Ctx, convId: string): Record<string, any>[] => all(ctx.db, "SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.conversation_id=? AND c.owner_id=? ORDER BY m.at, m.rowid", convId, ctx.owner).map((m) => ({ ...m, data: JSON.parse(m.data as string) }));

// ---------- the request ----------
export const StudyRequest = z.object({ conversationId: z.string(), course: z.string(), text: z.string().max(1000), attachmentIds: z.array(z.string()).max(8).default([]) });
export function requestStudyGuide(ctx: Ctx, raw: z.input<typeof StudyRequest>) {
  const r = StudyRequest.parse(raw);
  const shas = r.attachmentIds.map((id) => { const a = get(ctx.db, "SELECT sha FROM attachments WHERE id=? AND owner_id=? AND course=?", id, ctx.owner, r.course); if (!a) throw new HttpError(404, "An attachment is missing or belongs to a different course"); return a.sha as string; }).sort();
  const key = `study:${sha([r.course, r.text.toLowerCase().replace(/\s+/g, " ").trim(), shas.join(",")].join("|")).slice(0, 24)}`;
  const j = enqueueJob(ctx, { dedupKey: key, kind: "supervise_study", role: "Supervisor", area: "supervisor", title: `${r.course} final study guide`, input: r, evidenceIds: r.attachmentIds,
    tools: ["read_documents", "read_attachments", "read_sources", "write_document"], budget: { modelCalls: 8, maxMinutes: 15 }, criteria: ["A previous guide was found or you were asked", "Every photo checked", "Answer key checked against course materials", "A versioned guide saved"], synthetic: false });
  return { jobId: j.id, duplicate: !j.created, photos: r.attachmentIds.length };
}

/** Answer a question a blocked helper asked (which guide to use, or an imported earlier guide). Re-queues that helper. */
export function answerJob(ctx: Ctx, jobId: string, answer: { guideId?: string; choice?: string; importText?: string; importTitle?: string }) {
  const j = getJob(ctx, jobId); if (!j) throw new HttpError(404, "Job not found");
  if (j.status !== "blocked") throw new HttpError(409, `That job is ${j.status}, not waiting for an answer.`);
  tx(ctx.db, () => { run(ctx.db, "UPDATE messages SET data=json_set(data,'$.answered',1) WHERE job_id=? AND kind='question'", jobId); run(ctx.db, "UPDATE jobs SET input=?, status='queued', error=NULL WHERE id=?", JSON.stringify({ ...j.input, answers: { ...(j.input.answers ?? {}), ...answer } }), jobId); jobEvent(ctx, jobId, "answered", "You answered. Resuming."); });
  return { ok: true };
}
export function retryJob(ctx: Ctx, jobId: string) {
  const j = getJob(ctx, jobId); if (!j) throw new HttpError(404, "Job not found");
  if (j.status !== "blocked") throw new HttpError(409, `That job is ${j.status}.`);
  run(ctx.db, "UPDATE jobs SET status='queued', error=NULL WHERE id=?", jobId); jobEvent(ctx, jobId, "retry", "Retrying after you changed something."); return { ok: true };
}
const block = (api: JobApi, message: string, ask?: unknown) => {
  run(api.ctx.db, "UPDATE jobs SET result=? WHERE id=?", JSON.stringify({ ask: ask ?? null }), api.job.id);
  // Put the question in the conversation too, so it can be answered (and heard) without opening the Office. Once per blocked job.
  const conv = (api.input as any).conversationId as string | undefined;
  if (conv && !get(api.ctx.db, "SELECT 1 x FROM messages WHERE job_id=? AND kind='question' AND json_extract(data,'$.answered') IS NULL", api.job.id))
    addMessage(api.ctx, conv, { role: "jarvis", kind: "question", jobId: api.job.id, text: ((ask as any)?.question as string) ?? message, data: { ask, spoken: ((ask as any)?.question as string) ?? message, jobId: api.job.id } });
  throw Object.assign(new Error(message), { blocked: true });
};

// ---------- handlers ----------
const supervise_study: Handler = async (api) => {
  const inp = api.input as z.infer<typeof StudyRequest>;
  await api.step("plan", "Planning the work", () => true);
  const share = { ...inp };
  const intake = api.spawn("intake", { kind: "study_intake", role: "Intake specialist", area: "intake", title: `Find your last ${inp.course} guide and read its format`, input: share, evidenceIds: inp.attachmentIds, tools: ["read_documents", "read_attachments"], budget: { modelCalls: 0 }, criteria: ["Name which guide was chosen and why", "List the format", "Confirm each photo is yours and for this course"] });
  api.waitFor([intake]);
  const ik = api.child(intake); if (ik.status !== "done") throw new Error(`The intake helper ${ik.status}`);
  const research = api.spawn("research", { kind: "study_research", role: "Research specialist", area: "research", title: "Check each photo and read the final scope", input: { ...share, guide: ik.result.guide, format: ik.result.format }, evidenceIds: inp.attachmentIds, tools: ["read_attachments", "read_sources"], budget: { modelCalls: 6 }, criteria: ["Every photo checked separately", "Unclear parts flagged", "Coverage marked provisional if no final scope"] });
  api.waitFor([research]);
  const rk = api.child(research); if (rk.status !== "done") throw new Error(`The research helper ${rk.status}`);
  const writer = api.spawn("writer", { kind: "study_writer", role: "Planning specialist", area: "planning", title: "Write the questions, check the key, save the guide", input: { ...share, guide: ik.result.guide, format: ik.result.format, photos: rk.result.photos, styleNotes: rk.result.styleNotes, coverage: rk.result.coverage }, evidenceIds: inp.attachmentIds, tools: ["write_document", "read_sources"], budget: { modelCalls: 2 }, criteria: ["One defensible answer per question", "Key checked against course materials", "Saved as a new version"] });
  api.waitFor([writer]);
  const wk = api.child(writer); if (wk.status !== "done") throw new Error(`The writer ${wk.status}`);
  return wk.result;
};

const study_intake: Handler = async (api) => {
  const { course, attachmentIds } = api.input as z.infer<typeof StudyRequest>; const ctx = api.ctx; const answers = api.input.answers ?? {};
  let imported: string | null = null;
  if (answers.importText) imported = await api.step("import", "Importing the guide you gave me", () => { const g = parseGuideMarkdown(answers.importText, course, answers.importTitle || `${course} imported study guide`); return saveVersion(ctx, { course, folder: "Study Guides/Imported", kind: "study_guide", title: g.title, content: g, jobId: api.job.id, note: "Imported once" }).docId; });
  const f = findPreviousGuide(ctx, course, answers.guideId ?? (imported as string | null));
  if (f.ambiguous) block(api, `Which ${course} guide should I match?`, { question: `Which ${course} guide should I match?`, choices: f.candidates.map((c) => ({ guideId: c.id, label: `${c.title} (v${c.version})` })) });
  if (!f.selected) block(api, `No earlier ${course} guide is saved. Attach or paste it once.`, { question: `I could not find an earlier ${course} study guide. Paste its text once (numbered questions, lettered choices, "Answer: X") and I will match its format.`, importText: true });
  const sel = f.selected!;
  const g = await api.step("select", `Using "${sel.title}" (v${sel.version}) for format`, () => ({ id: sel.id, title: sel.title, version: sel.version, reason: f.reason }));
  const format = await api.step("format", "Reading its format", () => { const d = getDocument(ctx, g.id)!; return extractFormat(d.content); });
  const att = await api.step("attachments", "Confirming your photos are yours and for this course", () => attachmentIds.map((id) => { const a = get(ctx.db, "SELECT id,name,sha FROM attachments WHERE id=? AND owner_id=? AND course=?", id, ctx.owner, course); if (!a) throw new Error("A photo is not available"); return { id: a.id as string, name: a.name as string, sha: a.sha as string }; }));
  return { guide: g, format, attachments: att };
};

const readerFor = (router: Router, sha: string): VisionReader | null => router.resolve("vision").status === "ready" ? claudeReader(router) : fixtureKind(sha) ? fixtureReader : null;

const study_research: Handler = async (api) => {
  const { course, attachmentIds } = api.input as z.infer<typeof StudyRequest>; const ctx = api.ctx; const router = factories.router(ctx);
  const n = attachmentIds.length; const photos: { id: string; name: string; status: string; detail: string; reading?: Reading | null }[] = [];
  const quals: Record<string, any> = {};
  for (const [i, id] of attachmentIds.entries()) {
    api.progress(i, n, `Checking photo ${i + 1} of ${n}`);
    quals[id] = await api.step(`quality:${id}`, `Checking photo ${i + 1} of ${n}`, () => { const a = readAttachmentRow(ctx, id); const q = analyzeQuality(fs.readFileSync(a.path as string)); run(ctx.db, "UPDATE attachments SET quality=? WHERE id=?", JSON.stringify(q), id); return q; });
  }
  if (n) api.progress(n, n, `Checked ${n} of ${n} photos`);
  for (const [i, id] of attachmentIds.entries()) {
    api.progress(i, n, `Reading photo ${i + 1} of ${n}`);
    const a = readAttachmentRow(ctx, id); const q = quals[id];
    const out = await api.step(`read:${id}`, `Reading photo ${i + 1} of ${n}`, async () => {
      if (q.overall === "unreadable") return { status: "unreadable", detail: q.note, reading: null };
      const reader = readerFor(router, a.sha as string);
      if (!reader) return { status: "not_read", detail: "Not read. Reading a photo needs a Claude provider (set ANTHROPIC_API_KEY and a daily budget). The photo is kept for when it is.", reading: null };
      try {
        const p: PhotoInput = { id, name: a.name as string, mime: a.mime as any, bytes: fs.readFileSync(a.path as string), sha: a.sha as string, quality: q };
        const reading = await reader.read(p); if (reader.live) api.modelCall();
        run(ctx.db, "UPDATE attachments SET reading=? WHERE id=?", JSON.stringify(reading), id);
        const unclear = [...q.issues.map((x: any) => `${x.region} (${x.kind})`), ...reading.regions.filter((r) => r.status !== "ok").map((r) => `${r.area} (${r.status})`)];
        return { status: unclear.length ? "partial" : "read", detail: unclear.length ? `Partly unclear: ${[...new Set(unclear)].join(", ")}. ${reading.questions.filter((x) => x.partial).length ? "Some choices could not be read." : ""}`.trim() : reader.live ? "Read." : "Read with a fixture reading (not a live image read).", reading };
      } catch (e: any) {
        if (e instanceof RouterError || e instanceof NeedsProvider) return { status: "not_read", detail: `Not read: ${e.message}`, reading: null };
        throw e;
      }
    });
    photos.push({ id, name: a.name as string, ...out });
  }
  if (n) api.progress(n, n, `Read ${photos.filter((p) => p.reading).length} of ${n} photos`);
  const styleNotes = photos.flatMap((p, i) => p.reading ? [`Photo ${i + 1}: ${p.reading.style.stemStyle}`, ...p.reading.style.distractorPatterns.map((d) => `Photo ${i + 1} distractors: ${d}`), ...p.reading.style.diagramStyles.map((d) => `Photo ${i + 1} diagram: ${d}`), ...p.reading.questions.slice(0, 2).map((q) => `Photo ${i + 1} sample stem: ${q.stem}`)] : []);
  const coverage = await api.step("coverage", "Reading the final scope from your course materials", () => extractCoverage(ctx, course));
  return { photos: photos.map(({ reading: _r, ...p }) => p), styleNotes, coverage };
};
const readAttachmentRow = (ctx: Ctx, id: string) => { const a = get(ctx.db, "SELECT * FROM attachments WHERE id=? AND owner_id=?", id, ctx.owner); if (!a) throw new Error("A photo is not available"); return a; };

const study_writer: Handler = async (api) => {
  const inp = api.input as z.infer<typeof StudyRequest> & { guide: any; format: any; photos: any[]; styleNotes: string[]; coverage: any }; const ctx = api.ctx; const router = factories.router(ctx);
  const live = router.resolve("guide_writer").status === "ready";
  const writer = live ? claudeWriter(router, () => api.modelCall()) : fixtureWriter;
  const count = Math.min(20, Math.max(6, inp.format.questionCount || 12));
  const topics = inp.coverage.topics.length ? inp.coverage.topics : ["mendelian genetics"];
  const written = await api.step("write", live ? "Writing original questions with Claude" : "Choosing questions from the fixture bank", async () => {
    try { return await writer.write({ topics, count, format: inp.format, styleNotes: inp.styleNotes, materials: courseMaterials(ctx, inp.course) }); }
    catch (e: any) { if (e instanceof NeedsWriter || e?.blocked) block(api, e.message); if (e instanceof RouterError) block(api, e.message); throw e; }
  });
  const check = await api.step("check", "Checking the answer key against your course materials", () => {
    const qs = z.array(Question).parse(written); const res = checkKey(qs, courseMaterials(ctx, inp.course));
    const removed = res.issues.filter((i) => i.severity === "error").map((i) => ({ id: i.id, problem: i.problem })); const gone = new Set(removed.map((r) => r.id));
    const flagged = new Map(res.issues.filter((i) => i.severity === "unverified").map((i) => [i.id, i.problem]));
    return { questions: qs.filter((q) => !gone.has(q.id)).map((q) => ({ ...q, flag: flagged.get(q.id) })), removed, checked: res.checked, supported: res.supported, unverified: [...flagged.keys()] };
  });
  api.assertNotCancelled();
  const saved = await api.step("save", "Saving the guide as a new version", () => {
    const photoStatus = inp.photos.map((p: any) => ({ name: p.name, status: p.status === "read" ? "read" : p.status === "partial" ? p.detail.replace(/^Partly unclear:\s*/i, "partly unclear: ") : p.status === "unreadable" ? "unreadable, retake" : "not read (needs a Claude provider)" }));
    const content: GuideContent = { title: `${inp.course} Final study guide`, course: inp.course, kind: "final", format: { ...inp.format, source: inp.guide.title }, coverage: { topics, provisional: inp.coverage.provisional, basis: inp.coverage.basis },
      sources: { format: `${inp.guide.title} (v${inp.guide.version})`, photos: photoStatus, coverage: [inp.coverage.basis] }, keyCheck: { checked: check.checked, supported: check.supported, removed: check.removed, unverified: check.unverified },
      generator: { name: writer.name, live: writer.live, note: writer.note }, questions: check.questions };
    return saveVersion(ctx, { course: inp.course, folder: "Study Guides/Final", kind: "study_guide", title: content.title, content, jobId: api.job.root_id ?? api.job.id, note: `Generated from ${inp.guide.title}` });
  });
  api.assertNotCancelled();
  await api.step("announce", "Telling you it is ready", () => {
    const links = { open: `/guides/${saved.docId}`, quiz: `/guides/${saved.docId}?quiz=all`, pdf: `/api/documents/${saved.docId}/pdf` };
    const prov = inp.coverage.provisional ? " Coverage is provisional." : ""; const n = check.questions.length;
    const spoken = `Your ${inp.course} final study guide is ready, with ${n} questions.${prov} Want me to open it, or shall I ask the first question?`;
    const root = api.job.root_id ?? api.job.id;
    if (!get(ctx.db, "SELECT 1 x FROM messages WHERE job_id=? AND kind='result'", root)) addMessage(ctx, inp.conversationId, { role: "jarvis", kind: "result", jobId: root, text: `${spoken}${check.removed.length ? ` I dropped ${check.removed.length} question${check.removed.length > 1 ? "s" : ""} that failed the key check.` : ""}`, data: { docId: saved.docId, version: saved.version, links, spoken, generator: writer.name, live: writer.live, keyCheck: { checked: check.checked, supported: check.supported } } });
    enqueue(ctx, { eventKey: `guide:${root}`, level: "brief", title: `${inp.course} final study guide is ready`, body: `Version ${saved.version}, ${n} questions. Open the guide, quiz yourself, or export a PDF.` });
    return true;
  });
  return { docId: saved.docId, version: saved.version, questionCount: check.questions.length, keyCheck: { checked: check.checked, supported: check.supported, removed: check.removed.length } };
};

export const studyHandlers: Record<string, Handler> = { supervise_study, study_intake, study_research, study_writer };

// ---------- one front door for speech and text ----------
export function handleUtterance(ctx: Ctx, o: { text: string; conversationId?: string | null; course?: string | null; attachmentIds?: string[]; via?: string }) {
  const text = o.text.trim(); if (!text) throw new HttpError(422, "Say or type something first.");
  let courseHint = o.course ?? null;
  if (ctx.mode === "demo" && (/\b(bio|biology|bi107)\b/i.test(text) || courseHint === "BI107")) ensureBi107(ctx);
  const resolved = resolveCourse(ctx, text, courseHint);
  const course = resolved.code;
  const conv = getConversation(ctx, o.conversationId, courseHint ?? course); const convId = conv.id as string;
  const userMsg = addMessage(ctx, convId, { role: "user", text, data: { via: o.via ?? "text", attachmentIds: o.attachmentIds ?? [] } });
  const reply = (text: string, data: unknown = {}, jobId?: string, kind = "text") => ({ conversationId: convId, userMessageId: userMsg, jobId: jobId ?? null, reply: { id: addMessage(ctx, convId, { role: "jarvis", text, data, jobId, kind }), text, spoken: text, data } });
  if (/\bremember\b.*\bjarvis\b|^\s*remember[:,]/i.test(text)) {
    const cap = captureToJarvis(ctx, { text, sourceKind: "paste", via: o.via ?? "voice", course: course ?? undefined });
    return reply(cap.duplicate ? "That is already saved." : `Saved. ${cap.message}`, { capture: cap.id, path: cap.path }, undefined, "capture");
  }
  if (/\bquiz\b|\bask me (a |the first )?question/i.test(text)) {
    const code = course ?? (all(ctx.db, "SELECT DISTINCT course FROM documents WHERE owner_id=? AND kind='study_guide'", ctx.owner)[0]?.course as string | undefined);
    const docs = code ? listDocuments(ctx, code).filter((d) => d.kind === "study_guide") : [];
    if (!docs.length) return reply("There is no study guide to quiz you on yet. Ask me to make one.");
    const wantMissed = /missed|wrong|got wrong|struggl/i.test(text);
    const finals = docs.find((d) => /final/i.test(d.folder as string)) ?? docs[0];
    try {
      const q = startQuiz(ctx, { docId: finals.id as string, mode: wantMissed ? "missed" : "all" });
      return reply(wantMissed ? `Starting a quiz on the ${q.total} question${q.total === 1 ? "" : "s"} you missed.` : `Starting a quiz with ${q.total} questions.`, { attemptId: q.attemptId, docId: finals.id, path: `/guides/${finals.id}?attempt=${q.attemptId}` }, undefined, "quiz");
    } catch (e: any) { if (e instanceof HttpError && e.status === 409) return reply(`${e.message} Want a full quiz instead?`, { docId: finals.id, path: `/guides/${finals.id}?quiz=all` }, undefined, "quiz"); throw e; }
  }
  if (/\b(study guide|practice (test|exam|questions)|guide like|make me a (guide|quiz|test))\b/i.test(text)) {
    if (!course) return reply(resolved.ambiguous.length ? `Which course? I see ${resolved.ambiguous.join(" and ")}.` : "Which course is this for? Open the course page, or say its code.", { ask: "course", choices: resolved.ambiguous });
    const r = requestStudyGuide(ctx, { conversationId: convId, course, text, attachmentIds: o.attachmentIds ?? [] });
    const photos = r.photos ? `${r.photos} photo${r.photos > 1 ? "s" : ""}` : null;
    const msg = r.duplicate ? "I'm already on that. Nothing was started twice." : `Got it. I'm building your ${course} study guide to match your last one${photos ? ` and your ${photos}` : ""}. I'll tell you when it's ready.`;
    return reply(msg, { jobId: r.jobId, duplicate: r.duplicate, office: "/office" }, r.jobId, "ack");
  }
  if (looksLikeGoal(text)) {
    const g = submitGoal(ctx, { text, origin: o.via === "voice" ? "ask-voice" : "ask-text", conversationId: convId, projectHint: null });
    const msg = g.duplicate ? "I'm already on that. Nothing was started twice." : g.refreshed ? "Got it. I'll refresh it from what is saved now, and keep the earlier version." : "Got it. I'll find what applies, write it up, check it against the sources, and tell you when it's ready.";
    return reply(msg, { requestId: g.requestId, resultId: g.resultId, jobId: g.jobId, path: g.links.result, office: g.links.status }, g.jobId ?? undefined, "goal");
  }
  const cmd = runCommand(ctx, text);
  return reply(cmd.reply, { intent: cmd.intent, mode: cmd.mode, navigate: cmd.navigate ?? null });
}
export { sha, tx };
