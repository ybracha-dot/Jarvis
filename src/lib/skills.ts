// The skill that writes better skills. Skills are versioned text. Capabilities are immutable across automatic revisions.
// Evaluation structure (fixed cases, baseline vs candidate, per-case grading, history of versions) follows the pinned
// anthropics/skills skill-creator references (Apache-2.0). See UPSTREAM.md. Implementation here is original.
import fs from "node:fs";
import path from "node:path";
import { Ctx, all, get, run, tx, uid, modeDir, logActivity } from "./db";
import { extractFacts } from "./extract";
import { HttpError } from "./decisions";
import { createNote } from "./memory";
import { addTaskEvent } from "./ingest";
import { localHM, fmtDateTime } from "./time";

export const SKILL = "pre-class-brief";
export const CAPABILITIES = ["read_tasks", "read_sources", "read_requirements"] as const;

export interface SkillVersion { name: string; version: number; features: string[]; capabilities: string[]; trigger: string; instructions: string; exclusions: string[] }
export interface Rev { id: string; title: string; publishedAt: string; text: string }
export interface BriefInput { task: { title: string; kind: string }; revisions: Rev[] }
export interface MaterialItem { text: string; mandatory: boolean; quote: string; sourceId: string; articles?: number[] }
export interface BriefOutput { triggered: boolean; materials: MaterialItem[] }

const BASE_INSTRUCTIONS = "Before a class or assignment deadline, list the due date, the next commitments, and the next step. Use only the task and its course sources.";
const MATERIALS_INSTRUCTION = "Check required materials. For every active print or bring requirement, quote the exact sentence, say whether it is mandatory or optional, and point to the source. A later announcement that waives a requirement removes it. Never raise a materials item for tasks outside coursework.";

export const baseV1: SkillVersion = {
  name: SKILL, version: 1, features: [], capabilities: [...CAPABILITIES],
  trigger: "Task is coursework (assignment, exam or practice) due within 7 days or a class today.",
  instructions: BASE_INSTRUCTIONS, exclusions: ["Personal tasks", "Outbound actions"],
};

/** Derive active materials from ordered source revisions. A later waiver removes an earlier requirement. */
export function deriveMaterials(revs: Rev[]): MaterialItem[] {
  let active: MaterialItem[] = [];
  for (const r of [...revs].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
    const f = extractFacts(r.text, r.publishedAt);
    if (f.waivers.length) active = active.filter((m) => !f.waivers.some((w) => w.kind === "bring_print"));
    for (const q of f.requirements) {
      if (q.kind !== "bring_print") continue;
      if (!active.some((m) => m.quote === q.quote)) active.push({ text: q.text, mandatory: q.mandatory, quote: q.quote, sourceId: r.id, articles: q.detail.articles });
    }
  }
  return active;
}

export function runSkill(v: SkillVersion, input: BriefInput): BriefOutput {
  const inScope = /^(assignment|exam|practice)$/.test(input.task.kind);
  if (!inScope) return { triggered: false, materials: [] };
  if (!v.features.includes("materials_check")) return { triggered: true, materials: [] };
  return { triggered: true, materials: deriveMaterials(input.revisions) };
}

// ---- Evaluation fixtures ----
export interface EvalCase { id: string; name: string; isNew?: boolean; input: BriefInput; expect: { print: "mandatory" | "optional" | "none"; quote?: string; sourceId?: string } }
const NY = "-05:00";
const essay = { title: "Essay 2", kind: "assignment" };
export const EVAL_CASES: EvalCase[] = [
  { id: "a", name: "Explicit printed excerpt, four articles", isNew: true, input: { task: essay, revisions: [
    { id: "syl", title: "Syllabus", publishedAt: `2026-11-01T08:00:00${NY}`, text: "Essay 2 is due Friday, November 20 at 5 p.m." },
    { id: "ann17", title: "Announcement 17", publishedAt: `2026-11-16T09:10:00${NY}`, text: "Essay 2 is now due Wednesday, November 18 at 5 p.m. Bring a printed excerpt of articles 4, 13, 16 and 31." }] },
    expect: { print: "mandatory", quote: "Bring a printed excerpt of articles 4, 13, 16 and 31.", sourceId: "ann17" } },
  { id: "b", name: "Upload-only submission", input: { task: essay, revisions: [
    { id: "ann9", title: "Announcement 9", publishedAt: `2026-11-09T09:00:00${NY}`, text: "Essay 2 is due Friday, November 20 at 5 p.m. Submit the PDF through Blackboard only. No paper copies." }] }, expect: { print: "none" } },
  { id: "c", name: "Optional print suggestion", input: { task: essay, revisions: [
    { id: "ann12", title: "Announcement 12", publishedAt: `2026-11-12T09:00:00${NY}`, text: "You may print the primary source excerpt if you like to annotate it." }] },
    expect: { print: "optional", quote: "You may print the primary source excerpt if you like to annotate it.", sourceId: "ann12" } },
  { id: "d", name: "Later announcement waives the print requirement", input: { task: essay, revisions: [
    { id: "ann17", title: "Announcement 17", publishedAt: `2026-11-16T09:10:00${NY}`, text: "Bring a printed excerpt of articles 4, 13, 16 and 31." },
    { id: "ann18", title: "Announcement 18", publishedAt: `2026-11-17T12:00:00${NY}`, text: "The print requirement is waived. Everyone uploads to Blackboard instead." }] }, expect: { print: "none" } },
  { id: "u", name: "Unrelated personal task mentioning printing", input: { task: { title: "Club agenda", kind: "personal" }, revisions: [
    { id: "club", title: "Club note", publishedAt: `2026-11-16T09:10:00${NY}`, text: "Bring a printed agenda to the club meeting." }] }, expect: { print: "none" } },
];

export interface CaseGrade { id: string; name: string; pass: boolean; exactQuote: boolean | null; statusCorrect: boolean; pointerCorrect: boolean | null; falsePositive: boolean; output: BriefOutput }
export function gradeCase(v: SkillVersion, c: EvalCase): CaseGrade {
  const out = runSkill(v, c.input);
  const m = out.materials[0];
  const exp = c.expect;
  const status = !m ? "none" : m.mandatory ? "mandatory" : "optional";
  const falsePositive = exp.print === "none" && out.materials.length > 0;
  const exactQuote = exp.quote ? m?.quote === exp.quote : null;
  const pointerCorrect = exp.sourceId ? m?.sourceId === exp.sourceId : null;
  const statusCorrect = status === exp.print;
  return { id: c.id, name: c.name, exactQuote, pointerCorrect, statusCorrect, falsePositive, output: out,
    pass: statusCorrect && !falsePositive && exactQuote !== false && pointerCorrect !== false };
}

export interface EvalResult {
  cases: { id: string; name: string; baseline: CaseGrade; candidate: CaseGrade }[];
  newCasePass: boolean; regressions: string[]; falsePositives: string[]; improved: string[];
  scores: { baseline: number; candidate: number };
  verdict: "promote" | "candidate" | "quarantine"; reason: string;
}

export function evaluate(baseline: SkillVersion, candidate: SkillVersion, cases = EVAL_CASES): EvalResult {
  const sameCaps = JSON.stringify([...baseline.capabilities].sort()) === JSON.stringify([...candidate.capabilities].sort());
  let rows: EvalResult["cases"];
  try {
    rows = cases.map((c) => ({ id: c.id, name: c.name, baseline: gradeCase(baseline, c), candidate: gradeCase(candidate, c) }));
  } catch (e) {
    return { cases: [], newCasePass: false, regressions: [], falsePositives: [], improved: [], scores: { baseline: 0, candidate: 0 }, verdict: "quarantine", reason: `Candidate faulted during evaluation: ${(e as Error).message}` };
  }
  const newId = cases.find((c) => c.isNew)?.id;
  const newCasePass = rows.find((r) => r.id === newId)?.candidate.pass ?? false;
  const regressions = rows.filter((r) => r.baseline.pass && !r.candidate.pass).map((r) => r.id);
  const falsePositives = rows.filter((r) => r.candidate.falsePositive).map((r) => r.id);
  const improved = rows.filter((r) => !r.baseline.pass && r.candidate.pass).map((r) => r.id);
  const scores = { baseline: rows.filter((r) => r.baseline.pass).length / rows.length, candidate: rows.filter((r) => r.candidate.pass).length / rows.length };
  let verdict: EvalResult["verdict"], reason: string;
  if (!sameCaps) { verdict = "quarantine"; reason = "Candidate changes the capability list. That needs separate review."; }
  else if (newCasePass && !regressions.length && !falsePositives.length) { verdict = "promote"; reason = `Passes the new case, no regressions, no false positives (${Math.round(scores.candidate * 100)}% vs ${Math.round(scores.baseline * 100)}%).`; }
  else if (falsePositives.length && !regressions.length && newCasePass) { verdict = "candidate"; reason = `False positive on ${falsePositives.join(", ")}. Kept as a candidate.`; }
  else if (!newCasePass && !regressions.length) { verdict = "candidate"; reason = "Does not pass the new case. Kept as a candidate."; }
  else { verdict = "candidate"; reason = `Mixed result. Regressions: ${regressions.join(", ") || "none"}. Kept as a candidate.`; }
  return { cases: rows, newCasePass, regressions, falsePositives, improved, scores, verdict, reason };
}

// ---- Persistence ----
const rowToVersion = (r: any): SkillVersion => ({ name: r.name, version: r.version, features: JSON.parse(r.features), capabilities: JSON.parse(r.capabilities), trigger: r.trigger_text, instructions: r.instructions, exclusions: JSON.parse(r.exclusions) });

function skillDir(ctx: Ctx) { return path.join(modeDir(ctx.mode), "skills", SKILL); }
function writeSkillFile(ctx: Ctx, v: SkillVersion, status: string) {
  const dir = skillDir(ctx); fs.mkdirSync(dir, { recursive: true });
  const body = ["---", `name: ${v.name}`, `version: ${v.version}`, `status: ${status}`, `capabilities: [${v.capabilities.join(", ")}]`, `features: [${v.features.join(", ")}]`, "---", "", `Trigger: ${v.trigger}`, "", v.instructions, "", `Exclusions: ${v.exclusions.join("; ")}`, ""].join("\n");
  fs.writeFileSync(path.join(dir, `v${v.version}.md`), body);
}

export function seedSkills(ctx: Ctx) {
  if (get(ctx.db, "SELECT 1 x FROM skills WHERE owner_id=? AND name=?", ctx.owner, SKILL)) return;
  run(ctx.db, `INSERT INTO skills(id,owner_id,name,version,status,trigger_text,capabilities,instructions,features,exclusions,origin,created_at,promoted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    uid("skl"), ctx.owner, SKILL, 1, "active", baseV1.trigger, JSON.stringify(baseV1.capabilities), baseV1.instructions, "[]", JSON.stringify(baseV1.exclusions), "built-in", ctx.now().toISOString(), ctx.now().toISOString());
  writeSkillFile(ctx, baseV1, "active");
}

export function activeSkill(ctx: Ctx, name = SKILL): SkillVersion {
  const r = get(ctx.db, "SELECT * FROM skills WHERE owner_id=? AND name=? AND status='active' ORDER BY version DESC LIMIT 1", ctx.owner, name);
  if (!r) throw new HttpError(404, "Skill not found");
  return rowToVersion(r);
}

/** The normal entry point: build the brief for one task with whatever version is active now. */
export function generateBrief(ctx: Ctx, taskId: string) {
  const t = get(ctx.db, "SELECT t.*, c.code course_code FROM tasks t LEFT JOIN courses c ON c.id=t.course_id WHERE t.id=? AND t.owner_id=?", taskId, ctx.owner);
  if (!t) throw new HttpError(404, "Task not found");
  const v = activeSkill(ctx);
  const revs: Rev[] = all(ctx.db, `SELECT r.id, s.title, r.published_at, r.text FROM source_revisions r JOIN sources s ON s.id=r.source_id WHERE s.course_id=? AND r.duplicate_of IS NULL AND s.kind!='reference' ORDER BY r.published_at`, t.course_id)
    .map((r) => ({ id: r.id as string, title: r.title as string, publishedAt: r.published_at as string, text: r.text as string }));
  const out = runSkill(v, { task: { title: t.title as string, kind: t.kind as string }, revisions: revs });
  const lines: string[] = [];
  lines.push(`${t.title} is due ${t.due_at ? fmtDateTime(t.due_at as string) : "with no date"}.`);
  const next = all(ctx.db, "SELECT title,start_at FROM blocks WHERE owner_id=? AND state='active' AND start_at>=? AND kind IN ('calendar','booked','proposed') ORDER BY start_at LIMIT 3", ctx.owner, ctx.now().toISOString());
  for (const b of next) lines.push(`Next: ${b.title}, ${fmtDateTime(b.start_at as string)}.`);
  if (t.next_step) lines.push(`Next step: ${t.next_step}`);
  const materials = out.materials.map((m) => {
    const rev = revs.find((r) => r.id === m.sourceId);
    return { ...m, sourceTitle: rev?.title ?? "source", mandatoryLabel: m.mandatory ? "Required" : "Optional" };
  });
  if (out.triggered) run(ctx.db, "INSERT INTO skill_uses(id,skill_name,version,task_id,at,reason) VALUES(?,?,?,?,?,?)", uid("use"), v.name, v.version, taskId, ctx.now().toISOString(), `Ran v${v.version} because ${t.kind} is in scope`);
  return { skill: { name: v.name, version: v.version, features: v.features }, task: { id: t.id, title: t.title }, lines, materials, triggered: out.triggered };
}

const PROCEDURE_RE = /\b(you )?(missed|forgot|didn'?t (mention|check|include|flag)|should (have )?(checked|mentioned|included|flagged)|needs? (printing|to be printed)|needs? to be printed)\b|\bprint(ing|ed)?\b/i;
export function classifyCorrection(text: string): "procedure" | "fact" | "one_off" {
  if (PROCEDURE_RE.test(text)) return "procedure";
  if (/\b(actually|it'?s|is) .*\b(due|on|at)\b|\d/.test(text)) return "fact";
  return "one_off";
}

export function teach(ctx: Ctx, o: { text: string; taskId?: string; via?: "text" | "voice" | "task" }) {
  const text = o.text.trim();
  if (text.length < 4 || text.length > 500) throw new HttpError(422, "Correction must be 4 to 500 characters");
  return tx(ctx.db, () => {
    // Reflection is keyed on (task, text) so it can never loop on itself.
    const exists = get(ctx.db, "SELECT * FROM skill_corrections WHERE COALESCE(task_id,'')=COALESCE(?,'') AND text=?", o.taskId ?? null, text);
    if (exists) return { duplicate: true, correctionId: exists.id, classification: exists.classification, outcome: exists.outcome, steps: ["This correction was already handled. Nothing changed."] };
    const active = activeSkill(ctx);
    const cls = classifyCorrection(text);
    const cid = uid("cor");
    run(ctx.db, "INSERT INTO skill_corrections(id,skill_name,version,task_id,text,at,classification) VALUES(?,?,?,?,?,?,?)", cid, SKILL, active.version, o.taskId ?? null, text, ctx.now().toISOString(), cls);
    const steps: string[] = [`Reflection (local rules, no model): classified as ${cls.replace("_", "-")}.`];
    const before = o.taskId ? generateBrief(ctx, o.taskId) : null;
    // 1. Fix the current task first.
    let fixed: string | null = null;
    if (o.taskId) {
      const reqs = all(ctx.db, "SELECT * FROM requirements WHERE task_id=? AND status='active' AND kind='bring_print'", o.taskId);
      const t = get(ctx.db, "SELECT * FROM tasks WHERE id=?", o.taskId)!;
      if (cls === "procedure" && reqs.length) {
        const nid = createNote(ctx, { kind: "project_fact", title: `${t.title}: materials`, body: `Printing required: ${reqs.map((r) => `"${r.quote}"`).join("; ")}\nCorrected by you: "${text}"`, scope: `task:${t.external_id}`, source: "correction", sourceRef: cid, confidence: 1 });
        addTaskEvent(ctx, o.taskId, "correction", `You corrected the brief: "${text}". Pinned ${reqs.length} print requirement${reqs.length > 1 ? "s" : ""}.`, { noteId: nid });
        fixed = `Pinned the printing requirement to ${t.title} (note saved).`;
      } else if (cls === "fact") { createNote(ctx, { kind: "project_fact", title: `Correction: ${text.slice(0, 60)}`, body: text, scope: `task:${t.external_id}`, source: "correction", sourceRef: cid, confidence: 0.9 }); fixed = "Saved as a fact on this task."; }
      else if (cls === "procedure") fixed = "No printing requirement found in this task's sources. Nothing to pin. Add the source if you have it.";
    }
    if (fixed) steps.push(`Fixed this task first: ${fixed}`);
    if (cls !== "procedure") {
      run(ctx.db, "UPDATE skill_corrections SET outcome=? WHERE id=?", cls === "fact" ? "stored_as_memory" : "no_skill_change", cid);
      return { duplicate: false, correctionId: cid, classification: cls, outcome: cls === "fact" ? "stored_as_memory" : "no_skill_change", steps, fixed, before, after: before };
    }
    // 2. Candidate: a new version of the most relevant skill. Deterministic local transformation, labeled as such.
    if (active.features.includes("materials_check")) {
      steps.push(`v${active.version} already checks materials. No new version needed.`);
      run(ctx.db, "UPDATE skill_corrections SET outcome='already_covered' WHERE id=?", cid);
      return { duplicate: false, correctionId: cid, classification: cls, outcome: "already_covered", steps, fixed, before, after: before };
    }
    const nextVersion = ((get(ctx.db, "SELECT MAX(version) v FROM skills WHERE owner_id=? AND name=?", ctx.owner, SKILL)?.v as number) ?? 1) + 1;
    const cand: SkillVersion = { ...active, version: nextVersion, features: [...active.features, "materials_check"], instructions: `${active.instructions}\n${MATERIALS_INSTRUCTION}`, trigger: active.trigger };
    steps.push(`Generated candidate v${nextVersion} with a materials check (local deterministic transformation, not model-written).`);
    const ev = evaluate(active, cand);
    steps.push(`Evaluated baseline v${active.version} and candidate v${nextVersion} on ${ev.cases.length} fixed cases: ${ev.reason}`);
    const status = ev.verdict === "promote" ? "active" : ev.verdict === "quarantine" ? "quarantined" : "candidate";
    run(ctx.db, `INSERT INTO skills(id,owner_id,name,version,status,trigger_text,capabilities,instructions,features,exclusions,parent_version,origin,correction_id,eval,created_at,promoted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid("skl"), ctx.owner, SKILL, nextVersion, status, cand.trigger, JSON.stringify(cand.capabilities), cand.instructions, JSON.stringify(cand.features), JSON.stringify(cand.exclusions), active.version, "correction (local rules)", cid, JSON.stringify(ev), ctx.now().toISOString(), status === "active" ? ctx.now().toISOString() : null);
    if (status === "active") run(ctx.db, "UPDATE skills SET status='superseded' WHERE owner_id=? AND name=? AND status='active' AND version!=?", ctx.owner, SKILL, nextVersion);
    writeSkillFile(ctx, cand, status);
    run(ctx.db, "UPDATE skill_corrections SET outcome=? WHERE id=?", ev.verdict, cid);
    logActivity(ctx, "skill_version", `${SKILL}@${nextVersion}`, `${ev.verdict}: ${ev.reason}`);
    // 3. Repeat the original task on its normal entry point.
    const after = o.taskId ? generateBrief(ctx, o.taskId) : null;
    if (after) steps.push(status === "active" ? `Re-ran the brief with v${nextVersion}: ${after.materials.length} materials item${after.materials.length === 1 ? "" : "s"}.` : "Brief unchanged because the candidate was not promoted.");
    return { duplicate: false, correctionId: cid, classification: cls, outcome: ev.verdict, version: nextVersion, eval: ev, steps, fixed, before, after };
  });
}

export function rollback(ctx: Ctx, name = SKILL) {
  return tx(ctx.db, () => {
    const cur = get(ctx.db, "SELECT * FROM skills WHERE owner_id=? AND name=? AND status='active' ORDER BY version DESC LIMIT 1", ctx.owner, name);
    if (!cur || cur.parent_version == null) throw new HttpError(409, "No earlier version to roll back to");
    run(ctx.db, "UPDATE skills SET status='rolled_back' WHERE id=?", cur.id);
    run(ctx.db, "UPDATE skills SET status='active' WHERE owner_id=? AND name=? AND version=?", ctx.owner, name, cur.parent_version);
    logActivity(ctx, "skill_rollback", `${name}@${cur.version}`, `Rolled back to v${cur.parent_version}`);
    return { active: cur.parent_version };
  });
}

export function promoteCandidate(ctx: Ctx, version: number) {
  // Manual promotion by the user of a held candidate.
  return tx(ctx.db, () => {
    const c = get(ctx.db, "SELECT * FROM skills WHERE owner_id=? AND name=? AND version=? AND status='candidate'", ctx.owner, SKILL, version);
    if (!c) throw new HttpError(404, "No candidate with that version");
    run(ctx.db, "UPDATE skills SET status='superseded' WHERE owner_id=? AND name=? AND status='active'", ctx.owner, SKILL);
    run(ctx.db, "UPDATE skills SET status='active', promoted_at=? WHERE id=?", ctx.now().toISOString(), c.id);
    return { active: version };
  });
}

export function listSkills(ctx: Ctx) {
  const rows = all(ctx.db, "SELECT * FROM skills WHERE owner_id=? ORDER BY name, version", ctx.owner);
  return rows.map((r) => {
    const prev = rows.find((x) => x.name === r.name && x.version === r.parent_version);
    const uses = all(ctx.db, "SELECT at,reason,task_id FROM skill_uses WHERE skill_name=? AND version=? ORDER BY at DESC", r.name, r.version);
    const corrections = all(ctx.db, "SELECT at,text,classification,outcome FROM skill_corrections WHERE skill_name=? AND version=? ORDER BY at DESC", r.name, r.version);
    return {
      id: r.id, name: r.name, version: r.version, status: r.status, trigger: r.trigger_text, capabilities: JSON.parse(r.capabilities as string), features: JSON.parse(r.features as string),
      instructions: r.instructions, origin: r.origin, eval: r.eval ? JSON.parse(r.eval as string) : null, createdAt: r.created_at, promotedAt: r.promoted_at,
      diff: prev ? lineDiff(prev.instructions as string, r.instructions as string) : [], parentVersion: r.parent_version,
      uses: uses.length, lastUsed: uses[0]?.at ?? null, lastReason: uses[0]?.reason ?? null, correctionCount: corrections.length, lastCorrected: corrections[0]?.at ?? null,
      correctionsPerUse: uses.length ? Math.round((corrections.length / uses.length) * 100) / 100 : null,
    };
  });
}
function lineDiff(a: string, b: string): { sign: "+" | "-"; line: string }[] {
  const A = a.split("\n"), B = b.split("\n");
  return [...A.filter((l) => !B.includes(l)).map((line) => ({ sign: "-" as const, line })), ...B.filter((l) => !A.includes(l)).map((line) => ({ sign: "+" as const, line }))];
}
export { localHM };
