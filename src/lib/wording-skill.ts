// A narrowly scoped, repeatable rule learned from ONE correction: "when a sentence says <this exact phrase>, treat it as a requirement".
// It reuses the skills table, the candidate -> evaluate -> promote -> rollback life cycle and the capability check of src/lib/skills.ts.
// It is deterministic (no model), it can only add the phrase it was shown, and it never adds a tool: a candidate with a different
// capability list is quarantined, exactly as for the pre-class brief skill. Nothing is promoted until the user says so.
import { Ctx, all, get, run, uid, logActivity } from "./db";
import { HttpError } from "./decisions";
import type { SkillVersion, CaseGrade, EvalResult } from "./skills";

export const WORDING_SKILL = "brief-requirement-wording";
export const WORDING_CAPABILITIES = ["read_sources"] as const;
const BASE_INSTRUCTIONS = "Use the fixed rules to find requirements in the notes. Sentences they do not recognise are shown to the user for review.";
const PHRASE = (p: string) => `phrase:${p}`;

const baseVersion = (): SkillVersion => ({ name: WORDING_SKILL, version: 1, features: [], capabilities: [...WORDING_CAPABILITIES], trigger: "A note or announcement in the private workspace is read for the morning brief.", instructions: BASE_INSTRUCTIONS, exclusions: ["Questions", "Optional wording", "A later waiver", "Anything outside the exact phrase"] });
const rowToVersion = (r: any): SkillVersion => ({ name: r.name, version: r.version, features: JSON.parse(r.features), capabilities: JSON.parse(r.capabilities), trigger: r.trigger_text, instructions: r.instructions, exclusions: JSON.parse(r.exclusions) });
export const phrasesOf = (v: Pick<SkillVersion, "features">) => v.features.filter((f) => f.startsWith("phrase:")).map((f) => f.slice(7));

const QUESTION = /\?\s*$/;
const OPTIONAL = /\b(optional|if you (?:like|wish|want|prefer)|consider|may (?:want|choose|wish)|you can|suggest(?:ed)?|recommended|helpful to)\b/i;
const WAIVER = /\b(no longer (?:need(?:ed)?|required|have|necessary)|do(?:es)? not need|don'?t need|waive[sd]?|not (?:be )?required|no need|is (?:cancell?ed|dropped)|no (?:paper|printed|hard)[ -]?copies|no printing|online[- ]only)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The one thing a rule may do: this exact phrase, as whole words, in a sentence that is not a question, not optional and not a waiver. */
export function matchesPhrase(sentence: string, phrases: string[]): string | null {
  if (QUESTION.test(sentence) || OPTIONAL.test(sentence) || WAIVER.test(sentence)) return null;
  for (const p of phrases) if (new RegExp(`(?:^|[^\\w])${esc(p).replace(/\s+/g, "\\s+")}(?:[^\\w]|$)`, "i").test(sentence)) return p;
  return null;
}

/** The narrow phrase a requirement sentence is taught by: the cue plus up to two following words ("expected on paper"). Never a single common word. */
export function phraseFor(sentence: string, cue: RegExp): string | null {
  const m = new RegExp(cue.source, "i").exec(sentence); if (!m) return null;
  const words = sentence.slice(m.index).split(/\s+/).map((w) => w.replace(/^[^\w']+|[^\w']+$/g, "")).filter(Boolean);
  const n = m[0].trim().split(/\s+/).length; const phrase = words.slice(0, Math.max(n, 1) + 2).join(" ").toLowerCase();
  return phrase.split(" ").length >= 2 && phrase.length >= 8 ? phrase : null;
}

// ---- the fixed cases a candidate is judged on ----
interface WCase { id: string; name: string; sentence: string; expect: "requirement" | "none"; isNew?: boolean }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function casesFor(phrase: string, sentence: string, projectName: string | null): WCase[] {
  return [
    { id: "a", name: `Your correction${projectName ? ` (project ${projectName})` : ""}`, sentence, expect: "requirement", isNew: true },
    { id: "b", name: "A different project (Maple Court, a synthetic example)", sentence: `Note for the Maple Court project. ${cap(phrase)} for every handout.`, expect: "requirement" },
    { id: "c", name: "The same words as a suggestion: stays optional", sentence: `You may want to know that ${phrase} is only a suggestion.`, expect: "none" },
    { id: "d", name: "The same words in a question", sentence: `Is it ${phrase}?`, expect: "none" },
    { id: "e", name: "The same words after a later waiver", sentence: `No longer needed: ${phrase}.`, expect: "none" },
    { id: "f", name: "A near miss that shares one word", sentence: "Attendance is expected to be about 40 members.", expect: "none" },
    { id: "g", name: "A requirement the fixed rules already catch", sentence: "Please bring a printed alphanumeric outline to class.", expect: "requirement" },
    { id: "h", name: "An unrelated sentence", sentence: "The cafeteria opens at 8:00 AM.", expect: "none" },
  ];
}
export type BaseDetect = (sentence: string) => boolean;
const grade = (v: SkillVersion, c: WCase, base: BaseDetect): CaseGrade => {
  const found = base(c.sentence) || !!matchesPhrase(c.sentence, phrasesOf(v)); const statusCorrect = (c.expect === "requirement") === found; const falsePositive = c.expect === "none" && found;
  return { id: c.id, name: c.name, exactQuote: null, pointerCorrect: null, statusCorrect, falsePositive, pass: statusCorrect, output: { triggered: true, materials: found ? [{ text: c.sentence, mandatory: true, quote: c.sentence, sourceId: "case" }] : [] } };
};
export function evaluateWording(baseline: SkillVersion, candidate: SkillVersion, cases: WCase[], base: BaseDetect): EvalResult {
  const rows = cases.map((c) => ({ id: c.id, name: c.name, baseline: grade(baseline, c, base), candidate: grade(candidate, c, base) }));
  const sameCaps = JSON.stringify([...baseline.capabilities].sort()) === JSON.stringify([...candidate.capabilities].sort());
  const newCasePass = rows.find((r) => r.id === "a")?.candidate.pass ?? false; const regressions = rows.filter((r) => r.baseline.pass && !r.candidate.pass).map((r) => r.id);
  const falsePositives = rows.filter((r) => r.candidate.falsePositive).map((r) => r.id); const improved = rows.filter((r) => !r.baseline.pass && r.candidate.pass).map((r) => r.id);
  const scores = { baseline: rows.filter((r) => r.baseline.pass).length / rows.length, candidate: rows.filter((r) => r.candidate.pass).length / rows.length };
  let verdict: EvalResult["verdict"], reason: string;
  if (!sameCaps) { verdict = "quarantine"; reason = "The candidate changes the capability list. That needs separate review."; }
  else if (newCasePass && !regressions.length && !falsePositives.length) { verdict = "promote"; reason = `Fixes your case and a different project's, no regressions, no false positives (${Math.round(scores.candidate * 100)}% vs ${Math.round(scores.baseline * 100)}% on ${rows.length} cases). Recommended; waiting for you.`; }
  else { verdict = "candidate"; reason = `${newCasePass ? "" : "Does not fix your case. "}${falsePositives.length ? `False positives on ${falsePositives.join(", ")}. ` : ""}${regressions.length ? `Regressions on ${regressions.join(", ")}. ` : ""}Kept as a candidate.`.trim(); }
  return { cases: rows, newCasePass, regressions, falsePositives, improved, scores, verdict, reason };
}

// ---- persistence ----
function ensureBase(ctx: Ctx) {
  if (get(ctx.db, "SELECT 1 x FROM skills WHERE owner_id=? AND name=?", ctx.owner, WORDING_SKILL)) return;
  const b = baseVersion();
  run(ctx.db, "INSERT INTO skills(id,owner_id,name,version,status,trigger_text,capabilities,instructions,features,exclusions,parent_version,origin,eval,created_at,promoted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", uid("skl"), ctx.owner, WORDING_SKILL, 1, "active", b.trigger, JSON.stringify(b.capabilities), b.instructions, "[]", JSON.stringify(b.exclusions), null, "built in", null, ctx.now().toISOString(), ctx.now().toISOString());
}
export function activeWording(ctx: Ctx): SkillVersion { const r = get(ctx.db, "SELECT * FROM skills WHERE owner_id=? AND name=? AND status='active' ORDER BY version DESC LIMIT 1", ctx.owner, WORDING_SKILL); return r ? rowToVersion(r) : baseVersion(); }
/** The phrases an approved rule currently adds. Read on every brief; with no approved rule this is empty and the fixed rules apply alone. */
export const activeWordingPhrases = (ctx: Ctx): string[] => phrasesOf(activeWording(ctx));

export interface WordingProposal { version: number; status: string; phrase: string; sentence: string; project: string | null; sourceTitle: string | null; capabilities: string[]; sameCapabilities: boolean; eval: EvalResult; beforeAfter: { label: string; sentence: string; before: string; after: string }[]; matchesElsewhere: { title: string; project: string | null }[] }

/** Propose one rule from a requirement the user confirmed. Returns the existing proposal if this phrase is already proposed or approved. */
export function proposeFromCorrection(ctx: Ctx, o: { sentence: string; phrase: string | null; project: string | null; sourceTitle: string | null; base: BaseDetect }): WordingProposal | null {
  if (!o.phrase) return null; ensureBase(ctx);
  const have = all(ctx.db, "SELECT * FROM skills WHERE owner_id=? AND name=? AND status IN ('candidate','active') ORDER BY version", ctx.owner, WORDING_SKILL).find((r) => phrasesOf(rowToVersion(r)).includes(o.phrase!));
  if (have) return describe(ctx, have, o.base);
  const active = activeWording(ctx); const next = ((get(ctx.db, "SELECT MAX(version) v FROM skills WHERE owner_id=? AND name=?", ctx.owner, WORDING_SKILL)?.v as number) ?? 1) + 1;
  const cand: SkillVersion = { ...active, version: next, features: [...active.features, PHRASE(o.phrase)], instructions: `${active.instructions}\nTreat a sentence containing “${o.phrase}” as a requirement (not a question, not optional, not a waiver).` };
  const ev = evaluateWording(active, cand, casesFor(o.phrase, o.sentence, o.project), o.base);
  const cid = uid("cor"); run(ctx.db, "INSERT OR IGNORE INTO skill_corrections(id,skill_name,version,task_id,text,at,classification,outcome) VALUES(?,?,?,?,?,?,?,?)", cid, WORDING_SKILL, active.version, null, o.sentence.slice(0, 500), ctx.now().toISOString(), "procedure", ev.verdict);
  const status = ev.verdict === "quarantine" ? "quarantined" : "candidate";
  run(ctx.db, "INSERT INTO skills(id,owner_id,name,version,status,trigger_text,capabilities,instructions,features,exclusions,parent_version,origin,correction_id,eval,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", uid("skl"), ctx.owner, WORDING_SKILL, next, status, cand.trigger, JSON.stringify(cand.capabilities), cand.instructions, JSON.stringify(cand.features), JSON.stringify(cand.exclusions), active.version, "your correction (local rules)", cid, JSON.stringify(ev), ctx.now().toISOString());
  logActivity(ctx, "skill_version", `${WORDING_SKILL}@${next}`, `proposed from your correction: “${o.phrase}” (${ev.verdict})`);
  return describe(ctx, get(ctx.db, "SELECT * FROM skills WHERE owner_id=? AND name=? AND version=?", ctx.owner, WORDING_SKILL, next)!, o.base);
}

function describe(ctx: Ctx, r: any, base: BaseDetect): WordingProposal {
  const v = rowToVersion(r); const phrase = phrasesOf(v).slice(-1)[0] ?? ""; const prev = get(ctx.db, "SELECT * FROM skills WHERE owner_id=? AND name=? AND version=?", ctx.owner, WORDING_SKILL, r.parent_version ?? 1); const pv = prev ? rowToVersion(prev) : baseVersion();
  const ev: EvalResult = r.eval ? JSON.parse(r.eval) : { cases: [] } as any;
  const cor = r.correction_id ? get(ctx.db, "SELECT text FROM skill_corrections WHERE id=?", r.correction_id) : null; const sentence = String(cor?.text ?? "");
  const row = (id: string, label: string, s: string) => ({ label, sentence: s, before: grade(pv, { id, name: label, sentence: s, expect: "requirement" }, base).output.materials.length ? "counted as a requirement" : "listed for your review, not counted", after: grade(v, { id, name: label, sentence: s, expect: "requirement" }, base).output.materials.length ? "counted as a requirement" : "listed for your review, not counted" });
  const cs = casesFor(phrase, sentence, null);
  const like = `%${phrase.replace(/[%_]/g, "")}%`;
  const elsewhere = all(ctx.db, "SELECT i.title, p.name pname FROM evidence_items i LEFT JOIN projects p ON p.id=i.project_id WHERE i.owner_id=? AND i.tombstone=0 AND lower(i.body) LIKE lower(?) ORDER BY i.at DESC LIMIT 6", ctx.owner, like).map((x) => ({ title: String(x.title), project: (x.pname as string | null) ?? null }));
  return { version: v.version, status: String(r.status), phrase, sentence, project: null, sourceTitle: null, capabilities: v.capabilities, sameCapabilities: JSON.stringify([...pv.capabilities].sort()) === JSON.stringify([...v.capabilities].sort()), eval: ev,
    beforeAfter: [row("a", "Your case", sentence), row("b", "A different project (a synthetic example)", cs[1].sentence)], matchesElsewhere: elsewhere };
}

/** For Today: what is waiting for your decision, what is in force, and whether it can be rolled back. */
export function wordingState(ctx: Ctx, base: BaseDetect) {
  const rows = all(ctx.db, "SELECT * FROM skills WHERE owner_id=? AND name=? ORDER BY version", ctx.owner, WORDING_SKILL);
  const proposals = rows.filter((r) => r.status === "candidate").map((r) => describe(ctx, r, base));
  const act = rows.filter((r) => r.status === "active").slice(-1)[0];
  return { proposals, active: act && Number(act.version) > 1 ? { version: Number(act.version), rules: phrasesOf(rowToVersion(act)), canRollback: act.parent_version != null } : null };
}

export function approveWording(ctx: Ctx, version: number) {
  const c = get(ctx.db, "SELECT * FROM skills WHERE owner_id=? AND name=? AND version=? AND status='candidate'", ctx.owner, WORDING_SKILL, version); if (!c) throw new HttpError(404, "No proposal with that version");
  const active = activeWording(ctx); if (JSON.stringify([...rowToVersion(c).capabilities].sort()) !== JSON.stringify([...active.capabilities].sort())) throw new HttpError(409, "That proposal changes what the skill may use. It cannot be approved here.");
  run(ctx.db, "UPDATE skills SET status='superseded' WHERE owner_id=? AND name=? AND status='active'", ctx.owner, WORDING_SKILL);
  run(ctx.db, "UPDATE skills SET status='active', promoted_at=? WHERE id=?", ctx.now().toISOString(), c.id);
  logActivity(ctx, "skill_promoted", `${WORDING_SKILL}@${version}`, `You approved the rule “${phrasesOf(rowToVersion(c)).slice(-1)[0]}”`);
  return { active: version };
}
export function declineWording(ctx: Ctx, version: number) {
  const n = run(ctx.db, "UPDATE skills SET status='declined' WHERE owner_id=? AND name=? AND version=? AND status='candidate'", ctx.owner, WORDING_SKILL, version);
  if (!Number(n.changes)) throw new HttpError(404, "No proposal with that version"); return { declined: version };
}
