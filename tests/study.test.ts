import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { memCtx, count, tmpDataDir } from "./helpers";
import { makeCtx, closeDb, get, all, setSetting, getSetting } from "@/lib/db";
import { seedDemo } from "@/lib/demo";
import { analyzeQuality, makeFixtureImage, FIXTURE_PHOTOS, sniff, claudeReader, fixtureReader, sha256 } from "@/lib/images";
import { ensureBi107, findPreviousGuide, extractCoverage, checkKey, BANK, getDocument, editGuide, renderPdf, startQuiz, quizState, answerQuestion, missedQuestions, resolveCourse, parseGuideMarkdown, saveVersion, GuideContent, fixtureWriter, keywordMatch } from "@/lib/guides";
import { saveAttachment, requestStudyGuide, handleUtterance, answerJob, factories, messages, getConversation } from "@/lib/study-guide";
import { processQueue, cancelJob, claimNext, runClaimed, getJob, officeState } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { Router, Transport } from "@/lib/router";
import { extractText, getDocumentProxy } from "unpdf";

const fast = (ctx: any, extra: any = {}) => ({ workerId: "w", handlers: HANDLERS, leaseMs: 5000, ...extra });
const world = () => { const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(ctx); (ctx as any).setNow("2026-11-16T10:00:00-05:00"); ensureBi107(ctx); return ctx; };
const photos = (ctx: any) => FIXTURE_PHOTOS().map((p) => saveAttachmentSafe(ctx, p.name, p.bytes));
let dirs: string[] = [];
function saveAttachmentSafe(ctx: any, name: string, bytes: Buffer) { return saveAttachment(ctx, { course: "BI107", name, bytes }); }
afterEach(() => { factories.router = (c) => new Router(c); });
const pdfText = async (buf: Buffer) => { const pdf = await getDocumentProxy(new Uint8Array(buf)); const t = await extractText(pdf, { mergePages: true }); return { text: t.text as string, pages: t.totalPages as number }; };

describe("photo checks (real pixels, no model)", () => {
  it("a sharp photo is ok; a partly blurred one flags exactly the blurred corner; noise-free blank is unreadable", () => {
    const [clear, partial] = FIXTURE_PHOTOS();
    expect(analyzeQuality(clear.bytes)).toMatchObject({ overall: "ok", issues: [] });
    const q = analyzeQuality(partial.bytes);
    expect(q.overall).toBe("partial");
    expect(q.issues).toEqual([{ region: "bottom right", kind: "blurry" }]);
    expect(q.note).toMatch(/bottom right/);
    const blank = (() => { const { PNG } = require("pngjs"); const p = new PNG({ width: 600, height: 600 }); p.data.fill(255); return PNG.sync.write(p); })();
    expect(analyzeQuality(blank).overall).toBe("unreadable");
  });
  it("rejects non-images, HEIC and oversized files, and deduplicates the same photo", () => {
    const ctx = world();
    expect(() => saveAttachment(ctx, { course: "BI107", name: "x.txt", bytes: Buffer.from("hello world") })).toThrow(/PNG and JPEG/);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(32)]);
    expect(() => saveAttachment(ctx, { course: "BI107", name: "x.heic", bytes: heic })).toThrow(/HEIC/);
    expect(() => saveAttachment(ctx, { course: "BI107", name: "big.png", bytes: Buffer.concat([FIXTURE_PHOTOS()[0].bytes, Buffer.alloc(3 * 1024 * 1024)]) })).toThrow(/3 MB/);
    expect(() => saveAttachment(ctx, { course: "NOPE1", name: "a.png", bytes: FIXTURE_PHOTOS()[0].bytes })).toThrow(/Unknown course/);
    const a = saveAttachmentSafe(ctx, "a.png", FIXTURE_PHOTOS()[0].bytes), b = saveAttachmentSafe(ctx, "again.png", FIXTURE_PHOTOS()[0].bytes);
    expect(b).toMatchObject({ id: a.id, duplicate: true });
    expect(count(ctx, "attachments")).toBe(1);
  });
});

describe("guides: previous guide, coverage, key check", () => {
  it("finds the previous guide by course and type; asks only for competing matches; says what is missing", () => {
    const ctx = world();
    expect(findPreviousGuide(ctx, "BI107")).toMatchObject({ ambiguous: false, selected: { title: "BI107 Midterm study guide" } });
    expect(findPreviousGuide(ctx, "BI107").reason).toMatch(/only earlier guide/);
    expect(findPreviousGuide(ctx, "CH101")).toMatchObject({ selected: null, ambiguous: false });
    const g = getDocument(ctx, findPreviousGuide(ctx, "BI107").selected!.id)!.content;
    saveVersion(ctx, { course: "BI107", folder: "Study Guides/Quiz 3", kind: "study_guide", title: "BI107 Quiz 3 guide", content: { ...g, title: "BI107 Quiz 3 guide", kind: "quiz" } });
    const f = findPreviousGuide(ctx, "BI107");
    expect(f).toMatchObject({ ambiguous: true, selected: null }); expect(f.candidates).toHaveLength(2);
    expect(findPreviousGuide(ctx, "BI107", f.candidates[1].id).selected!.id).toBe(f.candidates[1].id);
  });
  it("resolves 'bio' to the course that has a guide, and asks when two courses compete", () => {
    const ctx = world();
    expect(resolveCourse(ctx, "a guide like the last one for bio").code).toBe("BI107");
    ctx.db.prepare("INSERT INTO courses(id,owner_id,external_id,code,name) VALUES('c2','local','example-bi108','BI108','Example Biology 108')").run();
    expect(resolveCourse(ctx, "for bio").code).toBe("BI107");                                 // only BI107 has a guide
    saveVersion(ctx, { course: "BI108", folder: "Study Guides/Midterm", kind: "study_guide", title: "BI108 guide", content: getDocument(ctx, findPreviousGuide(ctx, "BI107").selected!.id)!.content });
    expect(resolveCourse(ctx, "for bio")).toMatchObject({ code: null, ambiguous: expect.arrayContaining(["BI107", "BI108"]) });
    expect(resolveCourse(ctx, "for BI108 please").code).toBe("BI108");
  });
  it("coverage comes from the final announcement; without it, it is labeled provisional", () => {
    const ctx = world();
    const c = extractCoverage(ctx, "BI107");
    expect(c.provisional).toBe(false); expect(c.topics).toEqual(["mendelian genetics", "hardy-weinberg", "population genetics", "x-linked inheritance", "dna replication", "gene expression", "natural selection"]);
    ctx.db.prepare("DELETE FROM source_revisions WHERE text LIKE '%final exam%'").run();
    const p = extractCoverage(ctx, "BI107"); expect(p.provisional).toBe(true); expect(p.basis).toMatch(/Provisional.*syllabus/);
    ctx.db.exec("PRAGMA foreign_keys=OFF"); ctx.db.prepare("DELETE FROM source_revisions").run();
    expect(extractCoverage(ctx, "BI107")).toMatchObject({ provisional: true, topics: [] });
  });
  it("the key check catches wrong computed answers, duplicate choices and unsupported facts", () => {
    const base = BANK.find((q) => q.id === "g3")!;
    const wrong = { ...base, choices: base.choices.map((c) => ({ ...c, text: c.key === base.answer ? "16 percent" : c.text === "16 percent" ? "32 percent" : c.text })) };
    const dup = { ...BANK[0], id: "d1", choices: [{ key: "A", text: "same" }, { key: "B", text: "same" }], answer: "A" };
    const unsup = { ...BANK[1], id: "u1", sourceFact: "a sentence that is nowhere in the notes" };
    const notes = BANK.map((q) => q.sourceFact).join("\n");
    const r = checkKey([base, wrong, dup, unsup], notes);
    expect(r.issues.map((i) => [i.id, i.severity])).toEqual(expect.arrayContaining([["g3", "error"], ["d1", "error"], ["u1", "unverified"]]));
    expect(r.issues.find((i) => i.id === "g3")!.problem).toMatch(/computed value 32/);
    expect(checkKey([base], notes).issues).toEqual([]);
    for (const q of BANK) expect(checkKey([q], q.sourceFact).issues, q.id).toEqual([]);   // every bank question verifies, including the Hardy-Weinberg arithmetic
  });
  it("the guide import format reads numbered questions and refuses nonsense", () => {
    const g = parseGuideMarkdown("1. Which organelle makes most ATP?\nA) Nucleus\nB) Mitochondrion\nAnswer: B\nWhy: mitochondria make ATP\n\n2. Where is DNA held in the cell?\nA) Nucleus\nB) Ribosome\nAnswer: A", "BI107", "Imported");
    expect(g.questions.map((q) => q.answer)).toEqual(["B", "A"]);
    expect(() => parseGuideMarkdown("just some text", "BI107", "x")).toThrow(/Could not read/);
  });
});

describe("the spoken study-guide job", () => {
  it("builds a versioned guide from the last guide, two photos (one partly unreadable) and the final scope, with zero model calls", async () => {
    const ctx = world(); const ph = photos(ctx);
    const conv = getConversation(ctx, null, "BI107").id as string;
    const out = handleUtterance(ctx, { text: "Make me a study guide like the last one you did for bio. The final is all multiple choice.", conversationId: conv, attachmentIds: ph.map((p) => p.id), via: "voice" });
    expect(out.reply.text).toMatch(/Got it\. I'm building your BI107 study guide to match your last one and your 2 photos/);
    expect(out.reply.text.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
    await processQueue(ctx, fast(ctx));
    const jobs = all(ctx.db, "SELECT kind,status,area FROM jobs ORDER BY depth, created_at");
    expect(jobs.map((j) => j.kind)).toEqual(["supervise_study", "study_intake", "study_research", "study_writer"]);
    expect(jobs.every((j) => j.status === "done")).toBe(true);
    expect(all(ctx.db, "SELECT model_calls FROM jobs").every((j) => j.model_calls === 0)).toBe(true);
    const doc = get(ctx.db, "SELECT * FROM documents WHERE title='BI107 Final study guide'")!;
    expect(doc).toMatchObject({ folder: "Study Guides/Final", current_version: 1, course: "BI107" });
    const g = getDocument(ctx, doc.id as string)!;
    expect(g.content.questions).toHaveLength(8);
    expect(g.content.format).toMatchObject({ choicesPerQuestion: 4, source: "BI107 Midterm study guide" });
    expect(g.content.sources.format).toMatch(/BI107 Midterm study guide \(v1\)/);
    expect(g.content.coverage.provisional).toBe(false);
    expect(new Set(g.content.questions.map((q) => q.topic)).size).toBeGreaterThanOrEqual(6);                // every covered topic is represented
    expect(g.content.keyCheck).toMatchObject({ checked: 8, supported: 8, removed: [] });
    expect(g.content.generator).toMatchObject({ name: "fixture-bank", live: false });
    expect(g.content.sources.photos.map((p) => p.status)).toEqual(["read", expect.stringMatching(/partly unclear.*bottom right/)]);
    for (const q of g.content.questions) expect(q.choices.filter((c) => c.key === q.answer)).toHaveLength(1);
    const m = messages(ctx, conv).filter((x) => x.role === "jarvis");
    expect(m.map((x) => x.kind)).toEqual(["ack", "result"]);
    expect(m[1].data.links).toEqual({ open: `/guides/${doc.id}`, quiz: `/guides/${doc.id}?quiz=all`, pdf: `/api/documents/${doc.id}/pdf` });
    expect(m[1].text).toMatch(/open it, or shall I ask the first question/);
    expect(count(ctx, "inbox", "title LIKE '%final study guide is ready%'")).toBe(1);
    expect(get(ctx.db, "SELECT progress_done d, progress_total t FROM jobs WHERE kind='study_research'")).toMatchObject({ d: 2, t: 2 });
    expect(all(ctx.db, "SELECT summary FROM job_events WHERE summary LIKE '%photo%'").map((e) => e.summary)).toEqual(expect.arrayContaining(["Checking photo 1 of 2", "Checking photo 2 of 2", "Reading photo 1 of 2", "Reading photo 2 of 2"]));
    expect(get(ctx.db, "SELECT quality FROM attachments WHERE name LIKE '%blurred%'")!.quality).toMatch(/bottom right/);
  });

  it("a duplicate request, a refresh and a replayed job make no second guide", async () => {
    const ctx = world(); const ph = photos(ctx); const conv = getConversation(ctx, null, "BI107").id as string;
    const say = () => handleUtterance(ctx, { text: "Make me a study guide like the last one for bio", conversationId: conv, attachmentIds: ph.map((p) => p.id) });
    const a = say(), b = say();
    expect(b.reply.text).toMatch(/already on that/); expect(b.jobId).toBe(a.jobId);
    await processQueue(ctx, fast(ctx));
    const c = say();                                     // asked again after it finished, same words, same photos
    expect(c.jobId).toBe(a.jobId);
    await processQueue(ctx, fast(ctx));
    expect(count(ctx, "documents", "title='BI107 Final study guide'")).toBe(1);
    expect(count(ctx, "document_versions", "document_id IN (SELECT id FROM documents WHERE title='BI107 Final study guide')")).toBe(1);
    expect(count(ctx, "jobs")).toBe(4);
    expect(count(ctx, "inbox", "title LIKE '%final study guide is ready%'")).toBe(1);
  });

  it("cancel stops the job: no guide is saved and helpers are cancelled", async () => {
    const ctx = world(); const ph = photos(ctx); const conv = getConversation(ctx, null, "BI107").id as string;
    const r = handleUtterance(ctx, { text: "make me a study guide for BI107", conversationId: conv, attachmentIds: ph.map((p) => p.id) });
    await processQueue(ctx, fast(ctx, { max: 2 }));      // supervisor and intake only
    cancelJob(ctx, r.jobId!);
    await processQueue(ctx, fast(ctx));
    expect(all(ctx.db, "SELECT status FROM jobs").every((j) => ["cancelled", "done"].includes(j.status as string))).toBe(true);
    expect(get(ctx.db, "SELECT status FROM jobs WHERE kind='supervise_study'")!.status).toBe("cancelled");
    expect(count(ctx, "documents", "title='BI107 Final study guide'")).toBe(0);
    expect(messages(ctx, conv).filter((m) => m.kind === "result")).toHaveLength(0);
  });

  it("a worker that dies mid-job leaves one guide and one version", async () => {
    const ctx = world(); const ph = photos(ctx); const conv = getConversation(ctx, null, "BI107").id as string;
    handleUtterance(ctx, { text: "make me a study guide for BI107", conversationId: conv, attachmentIds: ph.map((p) => p.id) });
    let t = Date.now(); const clock = () => new Date(t);
    await processQueue(ctx, fast(ctx, { workerId: "A", clock, leaseMs: 1000, crashAfterStep: "save" }));
    expect(count(ctx, "documents", "title='BI107 Final study guide'")).toBe(1);   // saved, then the worker died before announcing
    expect(messages(ctx, conv).filter((m) => m.kind === "result")).toHaveLength(0);
    t += 3000;
    await processQueue(ctx, fast(ctx, { workerId: "B", clock, leaseMs: 1000 }));
    expect(count(ctx, "document_versions", "document_id IN (SELECT id FROM documents WHERE title='BI107 Final study guide')")).toBe(1);
    expect(messages(ctx, conv).filter((m) => m.kind === "result")).toHaveLength(1);
    expect(count(ctx, "inbox", "title LIKE '%final study guide is ready%'")).toBe(1);
  });

  it("competing earlier guides make the intake helper ask; an answer resumes it", async () => {
    const ctx = world(); const conv = getConversation(ctx, null, "BI107").id as string;
    const g = getDocument(ctx, findPreviousGuide(ctx, "BI107").selected!.id)!.content;
    saveVersion(ctx, { course: "BI107", folder: "Study Guides/Quiz 3", kind: "study_guide", title: "BI107 Quiz 3 guide", content: { ...g, title: "BI107 Quiz 3 guide" } });
    handleUtterance(ctx, { text: "make me a study guide for BI107", conversationId: conv });
    await processQueue(ctx, fast(ctx));
    const blocked = get(ctx.db, "SELECT * FROM jobs WHERE status='blocked'")!;
    expect(blocked.kind).toBe("study_intake");
    const ask = JSON.parse(blocked.result as string).ask; expect(ask.choices).toHaveLength(2);
    expect(get(ctx.db, "SELECT status FROM jobs WHERE kind='supervise_study'")!.status).toBe("waiting");
    answerJob(ctx, blocked.id as string, { guideId: ask.choices[0].guideId });
    await processQueue(ctx, fast(ctx));
    expect(all(ctx.db, "SELECT status FROM jobs").every((j) => j.status === "done")).toBe(true);
    expect(() => answerJob(ctx, blocked.id as string, { guideId: "x" })).toThrow(/not waiting/);
  });

  it("with no earlier guide it asks you to paste one once, then uses it", async () => {
    const ctx = world(); ctx.db.prepare("DELETE FROM documents").run();
    const conv = getConversation(ctx, null, "BI107").id as string;
    handleUtterance(ctx, { text: "make me a study guide for BI107", conversationId: conv });
    await processQueue(ctx, fast(ctx));
    const j = get(ctx.db, "SELECT * FROM jobs WHERE status='blocked'")!;
    expect(JSON.parse(j.result as string).ask.importText).toBe(true);
    answerJob(ctx, j.id as string, { importText: "1. Which organelle makes most of the cell's ATP?\nA) Nucleus\nB) Mitochondrion\nC) Ribosome\nD) Golgi\nAnswer: B\nWhy: mitochondria make ATP\n\n2. Where is DNA held in the cell?\nA) Nucleus\nB) Ribosome\nC) Vacuole\nD) Wall\nAnswer: A\nWhy: the nucleus holds DNA", importTitle: "BI107 pasted guide" });
    await processQueue(ctx, fast(ctx));
    const g = getDocument(ctx, get(ctx.db, "SELECT id FROM documents WHERE title='BI107 Final study guide'")!.id as string)!;
    expect(g.content.format.source).toBe("BI107 pasted guide");
    expect(g.content.questions.length).toBeGreaterThanOrEqual(6);
  });

  it("a missing final announcement makes coverage provisional and says so in the guide", async () => {
    const ctx = world(); ctx.db.prepare("DELETE FROM source_revisions WHERE text LIKE '%final exam%'").run();
    handleUtterance(ctx, { text: "make me a study guide for BI107", conversationId: getConversation(ctx, null, "BI107").id as string });
    await processQueue(ctx, fast(ctx));
    const g = getDocument(ctx, get(ctx.db, "SELECT id FROM documents WHERE title='BI107 Final study guide'")!.id as string)!;
    expect(g.content.coverage).toMatchObject({ provisional: true });
    expect((await pdfText(await renderPdf(g.content, { version: 1, answers: false }))).text).toMatch(/Coverage is provisional/);
  });

  it("an unrecognised photo with no Claude provider is kept but honestly not read, and the guide still finishes", async () => {
    const ctx = world(); const other = makeFixtureImage("clear", 99); expect(sha256(other)).not.toBe(sha256(FIXTURE_PHOTOS()[0].bytes));
    const a = saveAttachmentSafe(ctx, "my-real-test.png", other);
    handleUtterance(ctx, { text: "make me a study guide for BI107", conversationId: getConversation(ctx, null, "BI107").id as string, attachmentIds: [a.id] });
    await processQueue(ctx, fast(ctx));
    const g = getDocument(ctx, get(ctx.db, "SELECT id FROM documents WHERE title='BI107 Final study guide'")!.id as string)!;
    expect(g.content.sources.photos[0].status).toMatch(/not read \(needs a Claude provider\)/);
    expect(get(ctx.db, "SELECT reading FROM attachments WHERE id=?", a.id)!.reading).toBeNull();
    expect(JSON.stringify(officeState(ctx))).toMatch(/needs a Claude provider/);
  });

  it("with a Claude provider: the photo is sent as an image block, the writer gets style notes and course materials, bad questions are dropped", async () => {
    const ctx = world(); setSetting(ctx.db, "daily_budget_usd", 5); const ph = photos(ctx).slice(0, 1);
    const reqs: any[] = [];
    const reading = { readable: true, summary: "x", regions: [], questions: [{ stem: "Which enzyme unwinds DNA at the fork?", choices: ["Helicase", "Ligase", "Primase", "Polymerase"], hasDiagram: false }], style: { choiceCount: 4, distractorPatterns: ["names a neighbouring enzyme"], stemStyle: "short direct question", diagramStyles: [] } };
    const good = { ...BANK[7], id: "c1" }; const bad = { ...BANK[0], id: "c2", answer: "Z" };
    const t: Transport = async (r) => { reqs.push(r); const text = r.images?.length ? JSON.stringify(reading) : JSON.stringify({ questions: [good, bad].map((q) => (q.id === "c2" ? { ...q, answer: "D", choices: q.choices.slice(0, 2) } : q)) }); return { text, usage: { input: 100, output: 50 } }; };
    factories.router = (c) => new Router(c, t, async () => {});
    handleUtterance(ctx, { text: "make me a study guide for BI107", conversationId: getConversation(ctx, null, "BI107").id as string, attachmentIds: ph.map((p) => p.id) });
    await processQueue(ctx, fast(ctx));
    const vis = reqs.find((r) => r.images?.length)!;
    expect(vis.images[0]).toMatchObject({ mediaType: "image/png" }); expect(vis.images[0].data.length).toBeGreaterThan(100);
    expect(vis.model).toBe("claude-sonnet-5-5");
    const wr = reqs.find((r) => !r.images?.length)!;
    expect(wr.user).toMatch(/short direct question/); expect(wr.user).toMatch(/Mendelian genetics|mendelian genetics/); expect(wr.user).toMatch(/<untrusted kind="course-materials">/);
    const g = getDocument(ctx, get(ctx.db, "SELECT id FROM documents WHERE title='BI107 Final study guide'")!.id as string)!;
    expect(g.content.questions.map((q) => q.id)).toEqual(["c1"]);
    expect(g.content.keyCheck!.removed.map((r) => r.id)).toEqual(["c2"]);
    expect(g.content.generator).toMatchObject({ name: "claude", live: true });
    expect(all(ctx.db, "SELECT SUM(model_calls) n FROM jobs")[0].n).toBe(2);
  });
});

describe("the guide: edit, versions, PDF, quiz", () => {
  async function finished() { const ctx = world(); const ph = photos(ctx); handleUtterance(ctx, { text: "make me a study guide like the last for bio", conversationId: getConversation(ctx, null, "BI107").id as string, attachmentIds: ph.map((p) => p.id) }); await processQueue(ctx, fast(ctx)); return { ctx, id: get(ctx.db, "SELECT id FROM documents WHERE title='BI107 Final study guide'")!.id as string }; }
  it("editing saves a new version, keeps the old one, refuses stale edits and bad keys", async () => {
    const { ctx, id } = await finished(); const g = getDocument(ctx, id)!;
    const edited = { ...g.content, questions: g.content.questions.map((q, i) => (i === 0 ? { ...q, stem: "EDITED: " + q.stem } : q)) };
    expect(editGuide(ctx, id, edited, 1)).toMatchObject({ version: 2 });
    expect(getDocument(ctx, id, 1)!.content.questions[0].stem).not.toMatch(/EDITED/);
    expect(getDocument(ctx, id)!.content.questions[0].stem).toMatch(/EDITED/);
    expect(() => editGuide(ctx, id, edited, 1)).toThrow(/changed since you opened it/);
    const broken = { ...edited, questions: edited.questions.map((q, i) => (i === 0 ? { ...q, answer: "F" } : q)) };
    expect(() => editGuide(ctx, id, broken, 2)).toThrow(/must be one of its choices/);
    const dup = { ...edited, questions: edited.questions.map((q, i) => (i === 0 ? { ...q, choices: q.choices.map((c) => ({ ...c, text: "same" })) } : q)) };
    expect(() => editGuide(ctx, id, dup, 2)).toThrow(/Fix before saving/);
  });
  it("exports a practice PDF without answers and a key PDF with them", async () => {
    const { ctx, id } = await finished(); const g = getDocument(ctx, id)!;
    const practice = await pdfText(await renderPdf(g.content, { version: 1, answers: false }));
    const key = await pdfText(await renderPdf(g.content, { version: 1, answers: true }));
    expect(practice.text).toMatch(/BI107 Final study guide/); expect(practice.text).toContain(g.content.questions[0].stem.slice(0, 40)); expect(practice.text).not.toMatch(/Answer key/);
    expect(practice.text).toMatch(/page 1 of \d/);
    expect(key.text).toMatch(/Answer key/); expect(key.text).toContain(g.content.questions[0].rationale.slice(0, 30)); expect(key.pages).toBeGreaterThan(practice.pages);
  });
  it("quiz: answers stay hidden until you answer; the attempt is pinned to the guide version; missed items come back", async () => {
    const { ctx, id } = await finished(); const g = getDocument(ctx, id)!;
    const { attemptId } = startQuiz(ctx, { docId: id, mode: "all" });
    const st = quizState(ctx, attemptId);
    expect(JSON.stringify(st)).not.toContain(g.content.questions[0].rationale); expect(st.question).not.toHaveProperty("answer"); expect(st.version).toBe(1);
    // edit the guide to v2 mid-quiz: the attempt still uses v1
    editGuide(ctx, id, { ...g.content, questions: g.content.questions.map((q, i) => (i === 1 ? { ...q, stem: "CHANGED " + q.stem } : q)) }, 1);
    expect(quizState(ctx, attemptId).version).toBe(1);
    const wrongOf = (q: any) => q.choices.find((c: any) => c.key !== q.answer).key;
    let cur: any = quizState(ctx, attemptId); let n = 0;
    while (cur.question) { const q = g.content.questions.find((x) => x.id === cur.question.id)!; const pick = n < 3 ? wrongOf(q) : q.answer; const r = answerQuestion(ctx, attemptId, q.id, pick); expect(r.correct).toBe(n >= 3); expect(r.rationale).toBe(q.rationale); n++; cur = quizState(ctx, attemptId); }
    expect(cur).toMatchObject({ finished: true, total: 8, score: 5 }); expect(cur.missed).toHaveLength(3);
    expect(answerQuestion(ctx, attemptId, g.content.questions[0].id, g.content.questions[0].answer)).toMatchObject({ repeated: true, correct: false });   // the first answer stands
    const missed = missedQuestions(ctx, "BI107"); expect(missed).toHaveLength(3);
    const out = handleUtterance(ctx, { text: "Quiz me on what I missed", conversationId: getConversation(ctx, null, "BI107").id as string, course: "BI107" });
    expect(out.reply.text).toMatch(/Starting a quiz on the 3 questions you missed/);
    const m = startQuiz(ctx, { docId: id, mode: "missed" }); expect(m.total).toBe(3); expect(m.version).toBe(2);
    // answer one of the missed items correctly: it leaves the missed list
    const first = quizState(ctx, m.attemptId).question!; const q2 = getDocument(ctx, id)!.content.questions.find((x) => x.id === first.id)!;
    answerQuestion(ctx, m.attemptId, q2.id, q2.answer);
    expect(missedQuestions(ctx, "BI107")).toHaveLength(2);
  });
  it("missed questions survive a restart (database reopened from disk)", async () => {
    const dir = tmpDataDir(); closeDb("demo");
    let ctx = makeCtx("demo"); seedDemo(ctx); ensureBi107(ctx);
    const ph = FIXTURE_PHOTOS().map((p) => saveAttachment(ctx, { course: "BI107", name: p.name, bytes: p.bytes }));
    handleUtterance(ctx, { text: "make me a study guide for BI107", conversationId: getConversation(ctx, null, "BI107").id as string, attachmentIds: ph.map((p) => p.id) });
    await processQueue(ctx, fast(ctx));
    const id = get(ctx.db, "SELECT id FROM documents WHERE title='BI107 Final study guide'")!.id as string; const g = getDocument(ctx, id)!;
    const { attemptId } = startQuiz(ctx, { docId: id, mode: "all" }); const q = g.content.questions[2];
    answerQuestion(ctx, attemptId, q.id, q.choices.find((c) => c.key !== q.answer)!.key);
    closeDb("demo");                                   // the server restarts
    ctx = makeCtx("demo");
    expect(missedQuestions(ctx, "BI107").map((m) => m.questionId)).toEqual([q.id]);
    const again = handleUtterance(ctx, { text: "quiz me on what I missed", course: "BI107" });
    expect(again.reply.text).toMatch(/1 question you missed/);
    expect(fs.existsSync(path.join(dir, "demo", "attachments"))).toBe(true);
    closeDb("demo");
  });
});

describe("one front door", () => {
  it("routes capture, quiz and study requests; says so when there is nothing to quiz", async () => {
    const ctx = world(); const conv = getConversation(ctx, null).id as string;
    const empty = memCtx("2026-11-16T10:00:00-05:00"); seedDemo(empty);
    expect(handleUtterance(empty, { text: "quiz me" }).reply.text).toMatch(/no study guide to quiz you on/);
    const cap = handleUtterance(ctx, { text: "Remember for Jarvis: I owe the TAMID team three pitch angles by Thursday.", conversationId: conv });
    expect(cap.reply.text).toMatch(/^Saved\./); expect(count(ctx, "commitments", "action='three pitch angles'")).toBe(1);
    expect(handleUtterance(ctx, { text: "what changed", conversationId: conv }).reply.text).toBeTruthy();
    expect(() => handleUtterance(ctx, { text: "   " })).toThrow(/Say or type/);
    expect(handleUtterance(ctx, { text: "make me a study guide", conversationId: conv }).reply.text).toMatch(/Which course/);
  });
});
