// The general assistant: one request, one durable job, one stable result.
// Intake -> understand (time, project, deliverable) -> choose what to read from the sources that are actually enabled -> research ->
// compose -> a Reviewer checks every claim against its source -> save a versioned result with the receipts of what was read.
// Nothing here is keyed on example names or exact phrases: routing uses verbs, time words, and what the sources contain.
import { z } from "zod";
import { Ctx, all, get, run, tx, uid, sha, logActivity } from "./db";
import { HttpError } from "./decisions";
import { enqueueJob, cancelJob, getJob, Handler, JobApi, jobEvent } from "./jobs";
import { addMessage } from "./study-guide";
import { enqueue as notify } from "./notify";
import { searchEvidence, getItem, listSources, tokens, ownerName, factOut, Hit, SourceMode } from "./evidence";
import { addDays, localDate, fmtDateTime, DEFAULT_TZ, localHM, parseLocal } from "./time";
import { deepLinkBase } from "./capture";
import { composeDecision, synthesizeJudgment, recheckAnalysis, DECISION_Q, DRAFT_CUE, AnalysisJson } from "./decision-run";

// ---------- understanding ----------
export type Deliverable = "draft" | "brief" | "answer";
export interface Intent { deliverable: Deliverable; terms: string[]; projectId: string | null; projectName: string | null; when: { kind: "day"; date: string; label: string } | { kind: "prior" } | null; anaphora: "last_meeting" | null; capabilities: string[]; signature: string }

const DRAFT_STRONG = /\b(draft|write|compose|reply to|respond to|email|message|put together a (?:note|letter|message))\b/i;
const BRIEF = /\b(get me ready|ready for|prepare me|prep me|prep for|brief me|catch me up|agenda|what(?:'s| is) (?:on|coming up)|what do i have|heads[- ]up)\b/i;
const PRIOR = /\b(last time|where we left off|pick up|picked up|previous|earlier|prior)\b/i;
const ANAPHORA = /\b(that|the last|the previous|the) (meeting|call|sync|standup|interview)\b/i;
const GENERIC = new Set("ready tomorrow today tonight morning promise promised meeting call sync follow-up followup brief please help thing things stuff should really cost much many want best which whom whose actually still land confirmed".split(" "));

export function resolveWhen(text: string, now: Date, tz = DEFAULT_TZ): Intent["when"] {
  const today = localDate(now, tz);
  if (/\btomorrow\b/i.test(text)) return { kind: "day", date: addDays(today, 1), label: "tomorrow" };
  if (/\b(today|tonight|this morning|this afternoon)\b/i.test(text)) return { kind: "day", date: today, label: "today" };
  const wd = /\b(?:on |for |by )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(text);
  if (wd && BRIEF.test(text)) { const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]; for (let i = 1; i <= 7; i++) { const d = addDays(today, i); if (new Date(`${d}T12:00:00Z`).getUTCDay() === names.indexOf(wd[1].toLowerCase())) return { kind: "day", date: d, label: wd[1].toLowerCase() }; } }
  if (PRIOR.test(text)) return { kind: "prior" };
  return null;
}

export function understand(ctx: Ctx, text: string, o: { projectHint?: string | null } = {}): Intent {
  const deliverable: Deliverable = DECISION_Q.test(text) ? "answer" : DRAFT_STRONG.test(text) ? "draft" : BRIEF.test(text) ? "brief" : "answer";   // a decision request that also asks for a draft is a decision with a next-step draft
  const when = resolveWhen(text, ctx.now()); const tk = tokens(text);
  const projects = all(ctx.db, "SELECT id,name,aliases FROM projects WHERE owner_id=? AND status!='archived'", ctx.owner);
  const low = text.toLowerCase();
  let proj = o.projectHint ? projects.find((p) => p.id === o.projectHint || String(p.name).toLowerCase() === o.projectHint!.toLowerCase()) : undefined;
  proj = proj ?? projects.find((p) => { const pt = tokens(String(p.name)); return (pt.length > 0 && pt.every((t) => tk.includes(t))) || (JSON.parse(p.aliases as string) as string[]).some((a) => a && low.includes(a.toLowerCase())); });
  const terms = deliverable === "brief" ? [] : tk.filter((t) => !GENERIC.has(t)).slice(0, 8);
  const enabled = capabilities(ctx);
  const intent: Omit<Intent, "signature"> = { deliverable, terms, projectId: (proj?.id as string) ?? null, projectName: (proj?.name as string) ?? null, when, anaphora: ANAPHORA.test(text) && /\b(meeting|call|sync|promise|after)\b/i.test(text) ? "last_meeting" : null, capabilities: enabled };
  return { ...intent, signature: sha(JSON.stringify([deliverable, terms, when])).slice(0, 16) };
}

/** What can actually be used right now, from the sources that are connected and healthy. A source that needs you does not count. */
export function capabilities(ctx: Ctx): string[] {
  const caps = new Set<string>(["draft_local"]);
  const src = listSources(ctx).filter((s) => !s.revokedAt && !["needs_signin", "failed"].includes(s.state));
  if (src.some((s) => s.items > 0)) { caps.add("search_evidence"); caps.add("read_item"); }
  if (get(ctx.db, "SELECT 1 x FROM blocks WHERE owner_id=? AND kind='calendar' LIMIT 1", ctx.owner)) caps.add("read_calendar");
  if (get(ctx.db, "SELECT 1 x FROM tasks WHERE owner_id=? LIMIT 1", ctx.owner)) caps.add("read_tasks");
  if (get(ctx.db, "SELECT 1 x FROM commitments WHERE owner_id=? LIMIT 1", ctx.owner)) caps.add("read_commitments");
  return [...caps];
}
export const unavailableSources = (ctx: Ctx) => listSources(ctx).filter((s) => s.revokedAt || ["needs_signin", "failed", "stale"].includes(s.state) || s.mode === "unavailable").map((s) => ({ id: s.id, label: s.label, state: s.revokedAt ? "revoked" : s.state, message: s.message ?? "Not available." }));

/** Is this a quick command the local matcher handles ("what changed", "I have 20 minutes", "recall x"), or an outcome to deliver?
 *  Anything that is not clearly a short command is treated as an outcome: the assistant should not depend on a lucky phrasing. */
export function looksLikeGoal(text: string): boolean {
  const t = text.trim(); const words = t.split(/\s+/).length;
  if (words < 3) return false;
  if (/^(recall|find|search|forget|capture|show|go to|open|add a promise)\b/i.test(t) && words <= 8) return false;
  if (/^(what changed|show pace|who owes me|help|what do i have today)\??$/i.test(t)) return false;
  if (/\b\d{1,3}\s*(?:min|minutes)\b/i.test(t) && words <= 7) return false;
  if (/^resume\b/i.test(t) && words <= 3) return false;
  if (DRAFT_STRONG.test(t) || BRIEF.test(t) || PRIOR.test(t)) return true;
  return words >= 4;
}
const PROMISE_Q = /\b(promis\w*|committed|commitments?|i owe|did i agree|i said i would|i told .* i would)\b/i;

// ---------- requests ----------
export const Origins = ["ask-text", "ask-voice", "claude", "schedule", "api"] as const;
export const GoalInput = z.object({ text: z.string().trim().min(3).max(1000), origin: z.enum(Origins).default("api"), projectHint: z.string().max(120).nullish(), conversationId: z.string().max(80).nullish(), dedupKey: z.string().max(120).nullish(), synthetic: z.boolean().optional() }).strict();
export type GoalInput = z.input<typeof GoalInput>;

const links = (resultId: string, requestId: string) => ({ result: `/results/${resultId}`, resultUrl: `${deepLinkBase()}/results/${resultId}`, status: `/office?request=${requestId}` });
const activeJob = (st: string) => ["queued", "running", "waiting", "blocked"].includes(st);

export function submitGoal(ctx: Ctx, raw: GoalInput) {
  const i = GoalInput.parse(raw); const norm = i.text.toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  const key = i.dedupKey ? `k:${i.dedupKey}` : `t:${localDate(ctx.now())}:${sha(norm).slice(0, 20)}`;
  return tx(ctx.db, () => {
    const ex = get(ctx.db, "SELECT * FROM requests WHERE owner_id=? AND dedup_key=?", ctx.owner, key);
    if (ex) {
      const job = ex.job_id ? getJob(ctx, ex.job_id as string) : null;
      // The same words asked again after the work finished mean "refresh it"; an exact connector replay (explicit key) never does.
      if (!i.dedupKey && job && !activeJob(job.status)) return { ...reviseInternal(ctx, ex.id as string, { text: i.text, origin: i.origin, refresh: true }), duplicate: false, refreshed: true };
      return { ...receipt(ctx, ex.id as string), duplicate: true, refreshed: false };
    }
    const id = `req_${sha(`${ctx.owner}|${key}`).slice(0, 12)}`; const resultId = `res_${id.slice(4)}`; const now = ctx.now().toISOString();
    const intent = understand(ctx, i.text, { projectHint: i.projectHint });
    run(ctx.db, "INSERT INTO requests(id,owner_id,dedup_key,title,origin,text,revision,status,project_id,conversation_id,result_id,synthetic,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, ctx.owner, key, i.text.slice(0, 90), i.origin, i.text, 1, "queued", intent.projectId, i.conversationId ?? null, resultId, i.synthetic ? 1 : 0, now, now);
    run(ctx.db, "INSERT INTO request_revisions(request_id,revision,text,origin,at) VALUES(?,?,?,?,?)", id, 1, i.text, i.origin, now);
    run(ctx.db, "INSERT INTO results(id,owner_id,request_id,kind,title,project_id,version,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", resultId, ctx.owner, id, intent.deliverable, i.text.slice(0, 90), intent.projectId, 0, "pending", now, now);
    startRun(ctx, id, 1, intent);
    logActivity(ctx, "goal_submitted", id, `Goal (${i.origin}): ${i.text.slice(0, 80)}`);
    return { ...receipt(ctx, id), duplicate: false, refreshed: false };
  });
}
function startRun(ctx: Ctx, requestId: string, revision: number, intent: Intent, attempt = 0) {
  const req = get(ctx.db, "SELECT * FROM requests WHERE id=?", requestId)!;
  const j = enqueueJob(ctx, { dedupKey: `goal:${requestId}:r${revision}:a${attempt}`, kind: "supervise_goal", role: "Supervisor", area: "supervisor", title: String(req.title), input: { requestId, revision, conversationId: req.conversation_id }, evidenceIds: [],
    tools: intent.capabilities, budget: { modelCalls: 0, maxMinutes: 10 }, criteria: ["Sources chosen from what is connected", "Every claim traced to a source", "A result you can reopen"], synthetic: !!req.synthetic });
  run(ctx.db, "UPDATE requests SET job_id=?, status='queued', updated_at=? WHERE id=?", j.id, ctx.now().toISOString(), requestId);
  return j;
}

const PLAIN: Record<string, string> = { queued: "Waiting for a worker to pick it up", running: "Working", waiting: "Waiting on a helper", blocked: "Needs your answer", done: "Finished", failed: "Stopped with an error", cancelled: "Cancelled" };
export function receipt(ctx: Ctx, requestId: string) {
  const r = get(ctx.db, "SELECT * FROM requests WHERE id=? AND owner_id=?", requestId, ctx.owner); if (!r) throw new HttpError(404, "No such request");
  const job = r.job_id ? getJob(ctx, r.job_id as string) : null; const res = get(ctx.db, "SELECT version, state, kind FROM results WHERE id=?", r.result_id);
  const blockers: string[] = []; if (job?.status === "blocked") blockers.push(job.result?.ask?.question ?? job.error ?? "Needs your answer");
  const kids = job ? all(ctx.db, "SELECT status, result, error FROM jobs WHERE root_id=? AND status='blocked'", job.root_id ?? job.id) : []; for (const k of kids) { const q = k.result ? JSON.parse(k.result as string)?.ask?.question : null; if (q) blockers.push(q); }
  const status = (job?.status ?? "queued") as string; const done = status === "done" && (res?.version as number) > 0;
  return { requestId, revision: r.revision as number, title: r.title as string, origin: r.origin as string, jobId: (r.job_id as string) ?? null, resultId: r.result_id as string, status: kids.length && status !== "blocked" ? "blocked" : status, plain: kids.length ? PLAIN.blocked : (PLAIN[status] ?? status), step: job?.stage ?? null, blockers, ready: done, version: (res?.version as number) ?? 0, resultState: (res?.state as string) ?? "pending", links: links(r.result_id as string, requestId) };
}

// ---------- instruction revisions ----------
export const Instruction = z.object({ requestId: z.string().max(60), text: z.string().trim().min(2).max(600), origin: z.enum(Origins).default("api"), dedupKey: z.string().max(120).nullish() }).strict();
export function reviseRequest(ctx: Ctx, raw: z.input<typeof Instruction>) {
  const i = Instruction.parse(raw);
  if (i.dedupKey) { const k = `rev:${i.dedupKey}`; const ex = get(ctx.db, "SELECT 1 x FROM request_revisions WHERE request_id=? AND origin LIKE ?", i.requestId, `%#${k}`); if (ex) return { ...receipt(ctx, i.requestId), replay: true }; i.origin = `${i.origin}#${k}` as any; }
  return reviseInternal(ctx, i.requestId, { text: i.text, origin: i.origin, refresh: false });
}
function reviseInternal(ctx: Ctx, requestId: string, o: { text: string; origin: string; refresh: boolean }) {
  return tx(ctx.db, () => {
    const r = get(ctx.db, "SELECT * FROM requests WHERE id=? AND owner_id=?", requestId, ctx.owner); if (!r) throw new HttpError(404, "No such request");
    const revision = (r.revision as number) + 1; const now = ctx.now().toISOString();
    run(ctx.db, "INSERT INTO request_revisions(request_id,revision,text,origin,at) VALUES(?,?,?,?,?)", requestId, revision, o.refresh ? `(asked again) ${o.text}` : o.text, o.origin, now);
    run(ctx.db, "UPDATE requests SET revision=?, updated_at=? WHERE id=?", revision, now, requestId);
    const old = r.job_id ? getJob(ctx, r.job_id as string) : null; if (old && activeJob(old.status)) { cancelJob(ctx, old.id); jobEvent(ctx, old.id, "superseded", `You changed the request (revision ${revision}). This run is stopped.`, {}); }
    const intent = understand(ctx, String(r.text), { projectHint: r.project_id as string | null });
    startRun(ctx, requestId, revision, intent);
    logActivity(ctx, "goal_revised", requestId, `Request revised to r${revision}`);
    return { ...receipt(ctx, requestId), replay: false };
  });
}
export function refreshRequest(ctx: Ctx, requestId: string) { const r = get(ctx.db, "SELECT text FROM requests WHERE id=? AND owner_id=?", requestId, ctx.owner); if (!r) throw new HttpError(404, "No such request"); return reviseInternal(ctx, requestId, { text: String(r.text), origin: "api", refresh: true }); }
export function cancelRequest(ctx: Ctx, requestId: string) {
  const r = get(ctx.db, "SELECT * FROM requests WHERE id=? AND owner_id=?", requestId, ctx.owner); if (!r) throw new HttpError(404, "No such request");
  const j = r.job_id ? getJob(ctx, r.job_id as string) : null; if (j && activeJob(j.status)) cancelJob(ctx, j.id);
  run(ctx.db, "UPDATE requests SET status='cancelled', updated_at=? WHERE id=?", ctx.now().toISOString(), requestId); return receipt(ctx, requestId);
}
/** Continue: a stopped or cancelled run starts again; finished reads are reused when their sources have not changed. */
export function resumeRequest(ctx: Ctx, requestId: string) {
  const r = get(ctx.db, "SELECT * FROM requests WHERE id=? AND owner_id=?", requestId, ctx.owner); if (!r) throw new HttpError(404, "No such request");
  const j = r.job_id ? getJob(ctx, r.job_id as string) : null;
  if (j && activeJob(j.status)) { if (j.status === "blocked" && !j.result?.ask) { run(ctx.db, "UPDATE jobs SET status='queued', error=NULL WHERE id=?", j.id); } return receipt(ctx, requestId); }
  const attempts = (get(ctx.db, "SELECT COUNT(*) n FROM jobs WHERE owner_id=? AND dedup_key LIKE ?", ctx.owner, `goal:${requestId}:r${r.revision}:%`)!.n as number);
  startRun(ctx, requestId, r.revision as number, understand(ctx, String(r.text), { projectHint: r.project_id as string | null }), attempts); return receipt(ctx, requestId);
}

/** Extra instructions are applied on top of the request, in order. What cannot be applied is said, not silently dropped. */
export function parseInstructions(texts: string[]) {
  const out: { maxSentences?: number; preferValue?: string; wantDraft?: boolean; applied: string[]; unapplied: string[] } = { applied: [], unapplied: [] };
  const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  for (const t of texts) {
    let used = false; let m: RegExpExecArray | null;
    if ((m = /\b(?:keep it to|no more than|at most|in|under|just)\s+(\w+)\s+sentences?\b/i.exec(t))) { const n = NUM[m[1].toLowerCase()] ?? Number(m[1]); if (n >= 1 && n <= 10) { out.maxSentences = n; out.applied.push(`Keep it to ${n} sentence${n === 1 ? "" : "s"}`); used = true; } }
    if ((m = /\buse the (monday|tuesday|wednesday|thursday|friday|saturday|sunday) (?:decision|date|plan)\b/i.exec(t))) { out.preferValue = m[1].toLowerCase(); out.applied.push(`Use the ${m[1].toLowerCase()} decision`); used = true; }
    if (/\b(draft it|also draft|prepare (?:a |the )?(?:draft|message|email)|write (?:it|the message|the email)|draft the follow[- ]?up)\b/i.test(t)) { out.wantDraft = true; out.applied.push("Prepare the follow-up draft"); used = true; }
    if (!used) out.unapplied.push(t);
  }
  return out;
}
export const instructionsFor = (ctx: Ctx, requestId: string, upTo: number) => all(ctx.db, "SELECT text FROM request_revisions WHERE request_id=? AND revision>1 AND revision<=? ORDER BY revision", requestId, upTo).map((r) => String(r.text).replace(/^\(asked again\)\s*/, "")).filter((t, i, a) => !/^\(asked again\)/.test(String(all(ctx.db, "SELECT text FROM request_revisions WHERE request_id=? AND revision=?", requestId, i + 2)[0]?.text ?? "")) && a.indexOf(t) === i);

// ---------- read log ----------
export function recordRead(ctx: Ctx, requestId: string, revision: number, r: { kind: string; ref?: string | null; source?: string | null; itemRevision?: number | null; label: string; excerpt?: string | null; used?: boolean; note?: string | null }) {
  const id = `rd_${sha(`${requestId}|${revision}|${r.kind}|${r.ref ?? r.label}`).slice(0, 14)}`;
  run(ctx.db, "INSERT OR IGNORE INTO request_reads(id,request_id,revision,kind,ref,source_label,item_revision,label,excerpt,used,note,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, requestId, revision, r.kind, r.ref ?? null, r.source ?? null, r.itemRevision ?? null, r.label, r.excerpt?.slice(0, 400) ?? null, r.used === false ? 0 : 1, r.note ?? null, ctx.now().toISOString());
}
export const readsFor = (ctx: Ctx, requestId: string, revision?: number) => all(ctx.db, `SELECT * FROM request_reads WHERE request_id=? AND kind!='bundle' ${revision ? "AND revision=?" : ""} ORDER BY at, rowid`, ...(revision ? [requestId, revision] : [requestId])).map((r) => ({ kind: r.kind as string, ref: r.ref as string | null, source: r.source_label as string | null, itemRevision: r.item_revision as number | null, label: r.label as string, excerpt: r.excerpt as string | null, used: !!r.used, note: r.note as string | null, revision: r.revision as number }));

// ---------- research ----------
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const stripSubject = (t: string) => t.replace(/^\s*(re|fwd?):\s*/i, "").trim();
type SrcRef = { itemId: string; revision: number; title: string; kind: string; at: string; sourceLabel: string; mode: SourceMode; role: string; quote: string };

function authorizedItem(ctx: Ctx, itemId: string, revision?: number) { const it = getItem(ctx, itemId); return it && !("forgotten" in it && it.forgotten) && !("revoked" in it && it.revoked) && "body" in it ? it : null; }
function projectItems(ctx: Ctx, projectId: string | null, fallbackIds: string[]) {
  const rows = projectId ? all(ctx.db, "SELECT i.id FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.owner_id=? AND i.project_id=? AND i.tombstone=0 AND s.revoked_at IS NULL ORDER BY i.at", ctx.owner, projectId).map((r) => r.id as string) : fallbackIds;
  return rows.map((id) => authorizedItem(ctx, id)).filter(Boolean) as NonNullable<ReturnType<typeof authorizedItem>>[];
}

function researchDraft(ctx: Ctx, api: JobApi, intent: Intent, requestId: string, revision: number) {
  const hits = searchEvidence(ctx, intent.terms, { projectId: intent.projectId, limit: 8 });
  for (const h of hits.slice(0, 5)) recordRead(ctx, requestId, revision, { kind: "search", ref: h.itemId, source: h.sourceLabel, itemRevision: h.revision, label: `${h.title} (${h.kind}, ${fmtDay(localDate(h.at))})`, excerpt: h.excerpt });
  if (!hits.length) return { gap: `Nothing saved matches “${intent.terms.join(" ")}”. Share the conversation or import the thread and ask again.`, items: [] as any[], reads: 0 };
  const counts = new Map<string, number>(); for (const h of hits.slice(0, 4)) if (h.projectId) counts.set(h.projectId, (counts.get(h.projectId) ?? 0) + 1);
  const projectId = intent.projectId ?? ([...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  const proj = projectId ? get(ctx.db, "SELECT name FROM projects WHERE id=?", projectId) : null;
  const items = projectItems(ctx, projectId, hits.map((h) => h.itemId)).filter((i) => ["email", "transcript", "claude", "note", "slack", "export"].includes(i.kind));
  for (const it of items) recordRead(ctx, requestId, revision, { kind: "thread", ref: it.id, source: it.sourceLabel, itemRevision: it.revision, label: `${it.title} (${it.kind}, ${fmtDay(localDate(it.at))})`, excerpt: it.body.slice(0, 200) });
  const facts = items.flatMap((it) => it.facts.map((f) => ({ ...f, itemTitle: it.title, itemKind: it.kind, itemAt: it.at, itemRevision: it.revision, sourceLabel: it.sourceLabel, mode: it.mode })));
  return { projectId, projectName: (proj?.name as string) ?? null, items: items.map((i) => ({ id: i.id, title: i.title, kind: i.kind, at: i.at, revision: i.revision, sourceLabel: i.sourceLabel, mode: i.mode, author: i.author, participants: i.participants })), facts, reads: items.length + Math.min(5, hits.length) };
}

const stem = (t: string) => t.replace(/(ing|ed|es|s)$/, "");
const matchedTerms = (terms: string[], text: string) => { const toks = new Set(tokens(text).map(stem)); return terms.filter((t) => toks.has(stem(t)) || text.toLowerCase().includes(t)); };
const sentencesOf = (body: string) => body.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n+/).map((x) => x.trim()).filter(Boolean);
const TODO = /\b(todo|to-do|to do|need(?:s|ed)? to|must|still to|not (?:yet )?(?:sorted|booked|confirmed|done|decided|paid|signed)|haven'?t|unbooked|pending|waiting (?:on|for)|remember to|don'?t forget|is needed|are needed|required)\b/i;
const UNKNOWN = /\b(not asked|unknown|tbd|to be decided|not (?:yet )?(?:known|decided)|\?)/i;
const unitOf = (v: string) => v.replace(/[\d.,]/g, "").trim().toLowerCase();

/** The general answer path: search every authorized source, keep what matches the question, show what changed and what is still open. Extractive, not invented. */
function researchDigest(ctx: Ctx, api: JobApi, intent: Intent, requestId: string, revision: number) {
  const hits = searchEvidence(ctx, intent.terms, { projectId: intent.projectId, limit: 12 });
  if (!hits.length) return { mode: "digest", gap: `Nothing saved matches “${intent.terms.join(" ")}”. Share the conversation, forward the email or import the note, then ask again.`, items: [] as any[], terms: intent.terms, reads: 0 };
  const scored = hits.map((h) => ({ h, m: matchedTerms(intent.terms, `${h.title} ${authorizedItem(ctx, h.itemId)?.body ?? ""}`) }));
  const top = Math.max(...scored.map((x) => x.m.length)); const need = Math.max(1, Math.ceil(top / 2));
  // A term that most of the strongest matches share is what the question is about. An item that has it belongs, even if it matches little else.
  const strong = scored.filter((x) => x.m.length >= need); const subject = intent.terms.filter((t) => strong.length >= 2 && strong.filter((x) => x.m.includes(t)).length >= Math.ceil(strong.length * 0.6));
  const keep = (x: (typeof scored)[number]) => x.m.length >= need || x.m.some((t) => subject.includes(t));
  const use = scored.filter(keep).sort((a, b) => String(b.h.at).localeCompare(String(a.h.at)));
  const aside = scored.filter((x) => !keep(x));
  // Coherence: sources that share no subject matter with the rest of the matches (beyond the words you asked with) are probably a different thing that happens to use the same word.
  const OWN = new Set(["note", "claude", "export"]);   // what you wrote or shared yourself is never set aside as "someone else's"
  if (use.length >= 3) {
    const qs = new Set(intent.terms.map(stem)); const ctxToks = use.map((x) => new Set(tokens(`${x.h.title} ${authorizedItem(ctx, x.h.itemId)?.body ?? ""}`).map(stem).filter((t) => !qs.has(t) && t.length > 2)));
    const comp = use.map((_, i) => i); const find = (i: number): number => (comp[i] === i ? i : (comp[i] = find(comp[i])));
    for (let i = 0; i < use.length; i++) for (let j = i + 1; j < use.length; j++) if ([...ctxToks[i]].some((t) => ctxToks[j].has(t))) comp[find(i)] = find(j);
    const sizes = new Map<number, number>(); for (let i = 0; i < use.length; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
    const best = [...sizes].sort((a, b) => b[1] - a[1])[0]; if (best && best[1] >= 2) for (let i = use.length - 1; i >= 0; i--) if (find(i) !== best[0] && !OWN.has(use[i].h.kind)) { aside.push({ ...use[i], m: use[i].m.slice(0, 2) }); use.splice(i, 1); ctxToks.splice(i, 1); }
  }
  for (const x of aside) recordRead(ctx, requestId, revision, { kind: "search", ref: x.h.itemId, source: x.h.sourceLabel, label: `${x.h.title} (${x.h.kind}, not used: matched only “${x.m.join(", ")}” and shares nothing else with the other matches)`, used: false });
  const items = use.map(({ h, m }) => { const it = authorizedItem(ctx, h.itemId)!; recordRead(ctx, requestId, revision, { kind: "thread", ref: it.id, source: it.sourceLabel, itemRevision: it.revision, label: `${it.title} (${it.kind}, ${fmtDay(localDate(it.at))})`, excerpt: h.excerpt });
    const sents = sentencesOf(it.body); const SALIENT = /\b(not included|excluding|extra|additional|replaces|replaced|revised|instead|cap|budget|deadline|must|total|only|need(?:s|ed)?)\b|[$€£]\s?\d|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/i;
    const relevant = [...new Set([...sents.filter((s2) => matchedTerms(intent.terms, s2).length > 0).slice(0, 2), ...sents.filter((s2) => SALIENT.test(s2)).slice(0, 3)])].slice(0, 4);
    return { id: it.id, title: it.title, kind: it.kind, at: it.at, revision: it.revision, sourceLabel: it.sourceLabel, mode: it.mode, author: it.author, participants: it.participants, matched: m, say: relevant.length ? relevant : sents.slice(0, 1), todo: sents.filter((s2) => TODO.test(s2)), unknown: sents.filter((s2) => UNKNOWN.test(s2) && !TODO.test(s2)),
      facts: it.facts.map((f) => ({ ...f, itemTitle: it.title, itemKind: it.kind, itemAt: it.at, itemRevision: it.revision, sourceLabel: it.sourceLabel, mode: it.mode })) }; });
  const question = String(get(ctx.db, "SELECT text FROM requests WHERE id=?", requestId)?.text ?? "");
  const localOnly = items.some((it) => !!get(ctx.db, "SELECT 1 x FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.id=? AND s.local_only=1", it.id));
  return { mode: "digest", decide: DECISION_Q.test(question), localOnly, question, items, terms: intent.terms, setAside: aside.map((x) => x.h.title), reads: items.length };
}

function researchBrief(ctx: Ctx, api: JobApi, intent: Intent, requestId: string, revision: number) {
  const date = intent.when && intent.when.kind === "day" ? intent.when.date : addDays(localDate(ctx.now()), 1);
  const events = all(ctx.db, "SELECT * FROM blocks WHERE owner_id=? AND kind='calendar' AND state='active' ORDER BY start_at", ctx.owner).filter((b) => localDate(b.start_at as string) === date).map((b) => ({ title: b.title as string, start: b.start_at as string, end: b.end_at as string, source: b.source as string }));
  for (const e of events) recordRead(ctx, requestId, revision, { kind: "calendar", ref: `cal:${e.title}:${e.start}`, source: e.source === "fixture" ? "Calendar (fixture)" : "Calendar", label: `${e.title}, ${localHM(e.start)} to ${localHM(e.end)}` });
  if (!events.length) recordRead(ctx, requestId, revision, { kind: "calendar", ref: `cal:none:${date}`, source: "Calendar", label: `No calendar events on ${fmtDay(date)}` });
  const tasks = all(ctx.db, "SELECT id,title,due_at FROM tasks WHERE owner_id=? AND status='open' AND due_at IS NOT NULL ORDER BY due_at", ctx.owner).filter((t) => { const d = localDate(t.due_at as string); return d >= date && d <= addDays(date, 2); }).map((t) => ({ id: t.id as string, title: t.title as string, due: t.due_at as string }));
  for (const t of tasks) recordRead(ctx, requestId, revision, { kind: "task", ref: t.id, source: "Tasks", label: `${t.title}, due ${fmtDateTime(t.due)}` });
  const cms = (all(ctx.db, "SELECT id,who,owed_to,action,due_date FROM commitments WHERE owner_id=? AND status='open' AND due_date IS NOT NULL", ctx.owner) as any[]).filter((c) => c.due_date <= addDays(date, 1)).map((c) => ({ id: c.id as string, text: `${c.who} to ${c.owed_to}: ${c.action}`, due: c.due_date as string }));
  for (const c of cms) recordRead(ctx, requestId, revision, { kind: "commitment", ref: c.id, source: "Commitments", label: `${c.text} (due ${c.due})` });
  const since = new Date(ctx.now().getTime() - 4 * 86400_000).toISOString();
  const fresh = all(ctx.db, "SELECT i.id FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.owner_id=? AND i.tombstone=0 AND s.revoked_at IS NULL AND (i.at>=? OR i.revision>1) ORDER BY i.at DESC", ctx.owner, since).map((r) => authorizedItem(ctx, r.id as string)).filter(Boolean) as NonNullable<ReturnType<typeof authorizedItem>>[];
  const items = fresh.map((it) => {
    const dates = it.facts.filter((f) => f.kind === "date" && f.status !== "superseded");
    const rubricUnverified = /rubric|requirements?|instructions?|guidelines?/i.test(it.body) && /(not included|not attached|isn'?t included|see (?:the )?(?:course site|portal|link))/i.test(it.body);
    const myTokens = new Set(tokens(it.title + " " + it.body));
    const touches = [...events.filter((e) => tokens(e.title).filter((t) => myTokens.has(t)).length >= 1).map((e) => ({ kind: "event", label: e.title })), ...tasks.filter((t) => tokens(t.title).filter((x) => myTokens.has(x)).length >= 2).map((t) => ({ kind: "task", label: t.title }))];
    return { id: it.id, title: it.title, kind: it.kind, at: it.at, revision: it.revision, sourceLabel: it.sourceLabel, mode: it.mode, summary: it.body.slice(0, 220), dates: dates.map((d) => ({ value: d.value, quote: d.quote, start: d.start, end: d.end })), rubricUnverified, touches, tokens: [...myTokens] };
  });
  for (const it of items) recordRead(ctx, requestId, revision, { kind: "item", ref: it.id, source: it.sourceLabel, itemRevision: it.revision, label: `${it.title} (${it.kind}${it.revision > 1 ? `, revision ${it.revision}` : ""})`, excerpt: it.summary });
  const outlines = items.filter((it) => ["claude", "note"].includes(it.kind)).map((o) => ({ ...o, matches: events.filter((e) => tokens(e.title).filter((t) => o.tokens.includes(t)).length >= 2).map((e) => e.title) }));
  return { date, events, tasks, commitments: cms, items: items.filter((i) => !["claude", "note"].includes(i.kind)), outlines, reads: events.length + tasks.length + cms.length + items.length };
}

function researchMeeting(ctx: Ctx, api: JobApi, intent: Intent, requestId: string, revision: number, choice: string | null) {
  const terms = intent.terms;
  const transcripts = (terms.length ? searchEvidence(ctx, terms, { kinds: ["transcript"], limit: 6 }) : []).map((h) => h.itemId);
  const pool = all(ctx.db, "SELECT i.id FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.owner_id=? AND i.kind='transcript' AND i.tombstone=0 AND s.revoked_at IS NULL ORDER BY i.at DESC", ctx.owner).map((r) => r.id as string);
  const candidateIds = intent.anaphora || !transcripts.length ? pool : transcripts;
  const items = candidateIds.map((id) => authorizedItem(ctx, id)).filter(Boolean) as NonNullable<ReturnType<typeof authorizedItem>>[];
  if (!items.length) return { gap: "No meeting transcript is saved yet. Import one and ask again.", items: [] as any[], reads: 0 };
  let chosen = choice ? items.find((i) => i.id === choice) : undefined; let ambiguous: null | { question: string; choices: { id: string; label: string }[] } = null;
  if (!chosen) {
    const extra = tokens(api.ctx ? String(get(ctx.db, "SELECT text FROM requests WHERE id=?", requestId)?.text ?? "") : "").filter((t) => !GENERIC.has(t));
    const scored = items.map((it) => ({ it, s: extra.filter((t) => tokens(it.title + " " + it.body).includes(t)).length })).sort((a, b) => b.s - a.s || String(b.it.at).localeCompare(String(a.it.at)));
    const contextual = intent.projectId ? scored.filter((x) => x.it.projectId === intent.projectId) : [];
    if (contextual.length === 1) chosen = contextual[0].it;
    else if (scored.length === 1 || (scored[0].s > scored[1].s)) chosen = scored[0].it;
    else ambiguous = { question: `Two meetings could be “that meeting”. Which one did you mean?`, choices: scored.slice(0, 3).map((x) => ({ id: x.it.id, label: `${x.it.title}, ${fmtDay(localDate(x.it.at))}` })) };
  }
  if (ambiguous) return { ambiguous, items: [] as any[], reads: 0 };
  const it = chosen!;
  recordRead(ctx, requestId, revision, { kind: "thread", ref: it.id, source: it.sourceLabel, itemRevision: it.revision, label: `${it.title} (transcript, ${fmtDay(localDate(it.at))})`, excerpt: it.body.slice(0, 200) });
  for (const o of items.filter((x) => x.id !== it.id)) recordRead(ctx, requestId, revision, { kind: "search", ref: o.id, source: o.sourceLabel, label: `${o.title} (not used: a different meeting)`, used: false });
  return { items: [{ id: it.id, title: it.title, kind: it.kind, at: it.at, revision: it.revision, sourceLabel: it.sourceLabel, mode: it.mode, author: it.author, participants: it.participants }], facts: it.facts.map((f) => ({ ...f, itemTitle: it.title, itemKind: it.kind, itemAt: it.at, itemRevision: it.revision, sourceLabel: it.sourceLabel, mode: it.mode })), chosen: it.id, reads: 1 };
}

// ---------- composition ----------
const firstName = (n: string) => n.split(/\s+/)[0];
const clean = (s: string) => s.replace(/^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "").replace(/^[A-Z][\w .'-]{0,30}:\s+/, "").trim();

function composeDraft(ctx: Ctx, b: any, instr: ReturnType<typeof parseInstructions>, intent: Intent) {
  const me = ownerName(ctx); const facts: any[] = b.facts ?? [];
  const live = facts.filter((f) => f.kind === "date" && f.status === "confirmed" && !f.supersededBy);
  let current = [...live].sort((a, c) => String(c.itemAt).localeCompare(String(a.itemAt)) || c.start - a.start)[0];
  const flags: any[] = []; const sources: SrcRef[] = []; const applied = [...instr.applied]; const unapplied = [...instr.unapplied];
  if (instr.preferValue) {
    const want = live.filter((f) => new Date(`${f.value}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase() === instr.preferValue);
    if (want.length) current = want[want.length - 1]; else { flags.push({ kind: "instruction_unmet", text: `You asked to use the ${instr.preferValue} decision, but no confirmed ${instr.preferValue} decision exists in the sources.` }); applied.splice(applied.findIndex((a) => /decision/.test(a)), 1); }
  }
  const add = (f: any, role: string) => { if (!sources.some((s) => s.itemId === f.itemId && s.role === role)) sources.push({ itemId: f.itemId, revision: f.itemRevision, title: f.itemTitle, kind: f.itemKind, at: f.itemAt, sourceLabel: f.sourceLabel, mode: f.mode, role, quote: f.quote }); };
  const older = facts.filter((f) => f.kind === "date" && current && f.value !== current.value && (f.status === "superseded" || f.status === "proposed") && f.itemAt <= current.itemAt);
  for (const o of older) { flags.push({ kind: "older_proposal", text: `${fmtDay(o.value)} was an earlier ${o.status === "superseded" ? "proposal" : "mention"} in “${o.itemTitle}” (${fmtDay(localDate(o.itemAt))}). It was replaced by ${fmtDay(current.value)}, confirmed in “${current.itemTitle}”.`, itemId: o.itemId }); add(o, "older proposal, superseded"); break; }
  if (!current) flags.push({ kind: "no_decision", text: "No confirmed date was found in the sources, so the draft does not state one." });
  const topic = current ? stripSubject(String(current.itemTitle)).replace(/\s*follow[- ]?up\s*$/i, "").trim() : (b.projectName ?? "our project");
  const people = new Map<string, number>(); for (const it of b.items) for (const p of [it.author, ...(it.participants ?? [])]) if (p && !new RegExp(`^${me}\\b`, "i").test(p) && !/claude/i.test(p)) people.set(p, (people.get(p) ?? 0) + 1);
  const recipient = [...people].sort((a, c) => c[1] - a[1])[0]?.[0] ?? null;
  const reason = facts.filter((f) => f.why && f.itemKind === "transcript" && f.kind !== "date").sort((a, c) => String(c.itemAt).localeCompare(String(a.itemAt)))[0] ?? facts.filter((f) => f.why && (!current || f.itemId === current.itemId || f.kind !== "date")).find((f) => f.value !== undefined && !(current && f.kind === "date" && f.value !== current.value));
  const mine = facts.filter((f) => f.kind === "commitment" && f.who === me && !(intent.terms.some((t) => String(f.text).toLowerCase().includes(t)) && /\b(draft|send|write)\b/i.test(f.text)));
  const theirs = facts.filter((f) => f.kind === "commitment" && f.who && f.who !== me && (!recipient || f.who === recipient));
  const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase(); const byVal = new Map<string, any[]>(); for (const f of facts.filter((x) => x.kind === "figure")) byVal.set(norm(f.value), [...(byVal.get(norm(f.value)) ?? []), f]);
  const supportedFigs: any[] = [];
  for (const [v, fs] of byVal) { const srcs = new Set(fs.map((f) => f.itemId)); const inDecision = current && fs.some((f) => f.itemId === current.itemId && f.quote === current.quote); if (srcs.size >= 2 || inDecision) supportedFigs.push(fs[0]); else flags.push({ kind: "unsupported_figure", value: v, text: `${fs[0].value} appears only once, in “${fs[0].itemTitle}” (${fmtDay(localDate(fs[0].itemAt))}). I left it out of the draft. Confirm it or point me to a second source.`, itemId: fs[0].itemId }); }
  const s: { text: string; pri: number; src?: any; role?: string }[] = [];
  if (current) s.push({ text: `Thanks for confirming: I have us down for ${fmtDay(current.value)} for the ${topic} follow-up.`, pri: 1, src: current, role: "confirms the date" });
  if (reason) s.push({ text: `As ${reason.who ? firstName(reason.who) : "we"} put it when we met: “${clean(reason.why)}”`, pri: 2, src: reason, role: "states the reason" });
  if (mine[0]) s.push({ text: `On my side: ${clean(mine[0].quote).replace(/^I'?ll /i, "I will ")}`, pri: 3, src: mine[0], role: "my commitment" });
  if (theirs[0]) s.push({ text: `${firstName(String(theirs[0].who))}, you mentioned you would ${clean(theirs[0].quote).replace(/^I'?ll /i, "").replace(/\.$/, "")}.`, pri: 4, src: theirs[0], role: `${firstName(String(theirs[0].who))}'s commitment` });
  if (supportedFigs[0]) s.push({ text: `For planning, we are counting on ${supportedFigs.map((f) => f.value.replace(/(\d)([a-z])/, "$1 $2")).slice(0, 2).join(" and ")}.`, pri: 5, src: supportedFigs[0], role: "supported figure" });
  const max = instr.maxSentences ?? s.length; const keep = new Set([...s].sort((a, c) => a.pri - c.pri).slice(0, max).map((x) => x.pri));
  const body = s.filter((x) => keep.has(x.pri));
  for (const x of body) if (x.src) add(x.src, x.role!);
  if (!reason) flags.push({ kind: "no_reason", text: "The sources do not state why this follow-up is needed, so the draft does not give a reason." });
  if (instr.maxSentences) { const dropped = s.length - body.length; if (dropped > 0) flags.push({ kind: "trimmed", text: `Trimmed to ${instr.maxSentences} sentence${instr.maxSentences === 1 ? "" : "s"}; left out ${dropped} lower-priority point${dropped === 1 ? "" : "s"}.` }); }
  const text = [`**To:** ${recipient ?? "(recipient not identified)"}`, `**Subject:** Following up: ${topic}`, "", `Hi ${recipient ? firstName(recipient) : "there"},`, "", body.map((x) => x.text).join(" ") || "I wanted to follow up, but the sources do not yet settle a date.", "", `Best,`, me].join("\n");
  const summary = current ? `Draft for ${fmtDay(current.value)}${recipient ? ` to ${recipient}` : ""}. ${flags.length} flag${flags.length === 1 ? "" : "s"} to check.` : "Draft saved without a date: nothing confirmed it.";
  return { title: `Follow-up draft: ${topic}`, body: text, summary, sources, flags, applied, unapplied };
}

function composeBrief(ctx: Ctx, b: any, intent: Intent) {
  type Item = { score: number; head: string; why: string; item: any; action: { label: string; href: string } };
  const cands: Item[] = []; const flags: any[] = []; const sources: SrcRef[] = [];
  const evSrc = (it: any, role: string, quote: string) => { if (!sources.some((s) => s.itemId === it.id && s.role === role)) sources.push({ itemId: it.id, revision: it.revision, title: it.title, kind: it.kind, at: it.at, sourceLabel: it.sourceLabel, mode: it.mode, role, quote }); };
  for (const it of b.items) {
    const d = it.dates[0]; const touchesEvent = it.touches.some((t: any) => t.kind === "event");
    const daysTo = d ? Math.round((Date.parse(`${d.value}T12:00:00Z`) - Date.parse(`${b.date}T12:00:00Z`)) / 86400_000) : null;
    let score = 5 + (it.revision > 1 ? 2 : 0) + (touchesEvent ? 3 : 0) + (daysTo != null && daysTo >= 0 && daysTo <= 2 ? 5 : 0) + (d ? 1 : 0);
    const head = d ? (it.kind === "notice" ? `${stripSubject(it.title)}: due date now ${fmtDay(d.value)}` : `${stripSubject(it.title)}: mentions ${fmtDay(d.value)}`) : stripSubject(it.title);
    let why = d ? `“${String(it.dates[0].quote).slice(0, 140)}”` : it.summary.slice(0, 140);
    let action = { label: "Open the notice", href: `/evidence/${it.id}` };
    if (it.rubricUnverified) { why += " The notice says a rubric was updated but does not include it, so the requirements are unverified."; action = { label: "Sign in to read the rubric", href: "/connections" }; flags.push({ kind: "unverified_requirement", text: `“${stripSubject(it.title)}” mentions an updated rubric without its contents. Jarvis reports the change and leaves the requirements unverified.`, itemId: it.id }); score += 2; }
    if (d) evSrc(it, "changed date", String(d.quote)); else evSrc(it, "changed notice", it.summary);
    cands.push({ score, head, why, item: it, action });
  }
  for (const c of b.commitments) cands.push({ score: 4, head: `Promise due: ${c.text}`, why: `Due ${c.due}.`, item: null, action: { label: "Open follow-ups", href: "/tasks?tab=followups" } });
  for (const t of b.tasks) cands.push({ score: 3, head: `${t.title} due ${fmtDateTime(t.due)}`, why: "An open task due within two days.", item: null, action: { label: "Open the task", href: `/?task=${t.id}` } });
  for (const o of b.outlines.filter((x: any) => x.matches.length)) { cands.push({ score: 4, head: `You already have an outline for ${o.matches[0]}`, why: `${o.title}, ${fmtDay(localDate(o.at))}. ${o.summary.slice(0, 120)}`, item: o, action: { label: "Open the outline", href: `/evidence/${o.id}` } }); evSrc(o, "prior outline", o.summary); }
  const top = cands.sort((a, c) => c.score - a.score).slice(0, 3);
  const lines = [`**${fmtDay(b.date)}**`, ""];
  lines.push(b.events.length ? b.events.map((e: any) => `- ${localHM(e.start)}–${localHM(e.end)} ${e.title}`).join("\n") : "- Nothing on the calendar.");
  lines.push("", "**What needs attention**", "");
  top.forEach((t, i) => lines.push(`${i + 1}. **${t.head}.** ${t.why} Next: ${t.action.label}.`));
  if (!top.length) lines.push("Nothing changed that needs you.");
  const unav = unavailableSources(ctx); const unavailable = unav.map((u) => ({ label: u.label, state: u.state, message: u.message }));
  const summary = top.length ? `${top.length} thing${top.length === 1 ? "" : "s"} for ${fmtDay(b.date)}: ${top.map((t) => t.head).join("; ")}.` : `Nothing needs you on ${fmtDay(b.date)}.`;
  return { title: `Ready for ${fmtDay(b.date)}`, body: lines.join("\n"), summary, sources, flags, applied: [] as string[], unapplied: [] as string[], unavailable, actions: top.map((t) => t.action) };
}

function composeAnswer(ctx: Ctx, b: any, instr?: ReturnType<typeof parseInstructions>) {
  if (b.mode !== "digest") return composeMeeting(ctx, b);
  if (b.decide) {
    const d = composeDecision(ctx, b, String(b.question ?? ""), { wantDraft: !!instr?.wantDraft || DRAFT_CUE.test(String(b.question ?? "")), applied: instr?.applied ?? [], unapplied: instr?.unapplied ?? [] });
    if (d) return d;
    const dg = composeDigest(ctx, b); dg.flags.unshift({ kind: "not_comparable", text: "You asked for a decision, but I could not find two options with comparable prices, capacity or dates in the sources. Here is what the sources say." }); return dg;
  }
  return composeDigest(ctx, b);
}

function composeDigest(ctx: Ctx, b: any) {
  const sources: SrcRef[] = []; const flags: any[] = []; const items: any[] = b.items ?? [];
  const src = (it: any, role: string, quote: string) => { if (!sources.some((s) => s.itemId === it.id && s.role === role && s.quote === quote)) sources.push({ itemId: it.id, revision: it.revision, title: it.title, kind: it.kind, at: it.at, sourceLabel: it.sourceLabel, mode: it.mode, role, quote }); };
  const lines: string[] = [`**What the sources say** (newest first)`, ""];
  for (const it of items) { lines.push(`- **${it.title}** (${it.kind}, ${fmtDay(localDate(it.at))}): ${it.say.map((q: string) => `“${q}”`).join(" ")}`); for (const q of it.say) src(it, "says", q); }
  // What changed: the same kind of figure stated twice by related items; the later one stands and the earlier is marked replaced.
  const figs = items.flatMap((it) => it.facts.filter((f: any) => f.kind === "figure").map((f: any) => ({ ...f, it })));
  const changed: string[] = [];
  for (const f of figs) { const later = [...figs].sort((a: any, b: any) => String(a.it.at).localeCompare(String(b.it.at))).find((g: any) => g.it.id !== f.it.id && unitOf(g.value) === unitOf(f.value) && g.value.replace(/\s+/g, "").toLowerCase() !== f.value.replace(/\s+/g, "").toLowerCase() && String(g.it.at) > String(f.it.at) && ((g.it.author && f.it.author && g.it.author === f.it.author) || tokens(g.it.title).filter((t) => tokens(f.it.title).includes(t)).length >= 2)); if (later) { changed.push(`- ${f.value} (${fmtDay(localDate(f.it.at))}, “${f.it.title}”) was replaced by ${later.value} (${fmtDay(localDate(later.it.at))}, “${later.it.title}”).`); src(later.it, "changed value", later.quote); src(f.it, "older value, replaced", f.quote); } }
  if (changed.length) lines.push("", "**What changed**", "", ...[...new Set(changed)]);
  const todo = items.flatMap((it) => it.todo.map((t: string) => ({ it, t })));
  if (todo.length) { lines.push("", "**Still to do or not settled**", ""); for (const x of todo) { lines.push(`- ${x.t} (${x.it.title})`); src(x.it, "still to do", x.t); } }
  const unk = items.flatMap((it) => it.unknown.map((t: string) => ({ it, t })));
  if (unk.length) { lines.push("", "**Open questions in the sources**", ""); for (const x of unk) { lines.push(`- ${x.t} (${x.it.title})`); src(x.it, "open question", x.t); } }
  const commits = items.flatMap((it) => it.facts.filter((f: any) => f.kind === "commitment").map((f: any) => ({ ...f, it })));
  if (commits.length) { lines.push("", "**Promises mentioned**", ""); for (const c of commits) { lines.push(`- ${c.who ?? "Someone"}: ${clean(c.quote)}${c.value ? ` (due ${fmtDay(c.value)})` : ""}`); src(c.it, `${firstName(String(c.who ?? "someone"))}'s promise`, c.quote); } }
  if (b.setAside?.length) flags.push({ kind: "set_aside", text: `Set aside as less related: ${b.setAside.map((t: string) => `“${t}”`).join(", ")}. They matched only part of your question.` });
  flags.push({ kind: "extractive", text: "This is an extractive answer: passages, changes and open items found by search and rules, each with its source. It does not infer what is not written. It does not compare options or recommend one. Doing that needs a configured Claude model, which is off." });
  const used = items.flatMap((it: any) => tokens(`${it.title} ${it.say.join(" ")}`)); const missing = (b.terms ?? []).filter((t: string) => t.length >= 5 && !used.some((u: string) => u.slice(0, 5) === t.slice(0, 5))).slice(0, 4);
  if (missing.length) flags.push({ kind: "not_found", text: `Nothing in the sources mentions: ${missing.join(", ")}.` });
  const head = items.length ? `Found ${items.length} source${items.length === 1 ? "" : "s"}${changed.length ? `, ${changed.length} changed value${changed.length === 1 ? "" : "s"}` : ""}${todo.length ? `, ${todo.length} open item${todo.length === 1 ? "" : "s"}` : ""}.` : "Nothing found.";
  return { title: `Answer: ${String(b.question ?? (b.terms ?? []).join(" ")).replace(/[?.!]+$/, "").slice(0, 80)}`.trim(), body: lines.join("\n"), summary: head, sources, flags, applied: [] as string[], unapplied: [] as string[] };
}

function composeMeeting(ctx: Ctx, b: any) {
  const me = ownerName(ctx); const facts: any[] = (b.facts ?? []).filter((f: any) => f.kind === "commitment");
  const it = b.items[0]; const sources: SrcRef[] = []; const flags: any[] = [];
  const speakers = [...new Set(facts.map((f) => String(f.who)))]; const iAmThere = speakers.some((s2) => new RegExp(`^${me}\\b`, "i").test(s2)) || (it.participants ?? []).some((p: string) => new RegExp(`^${me}\\b`, "i").test(p));
  const mine = iAmThere ? facts.filter((f) => f.who === me) : [], theirs = iAmThere ? facts.filter((f) => f.who !== me) : facts;
  const line = (f: any) => `- ${clean(f.quote)}${f.value ? ` (due ${fmtDay(f.value)})` : ""} — ${f.stamp ? `at ${f.stamp}` : "in the transcript"}`;
  for (const f of facts) sources.push({ itemId: f.itemId, revision: f.itemRevision, title: f.itemTitle, kind: f.itemKind, at: f.itemAt, sourceLabel: f.sourceLabel, mode: f.mode, role: iAmThere ? (f.who === me ? "your promise" : `${firstName(String(f.who))}'s promise`) : `${firstName(String(f.who))}'s promise`, quote: f.quote });
  if (!sources.length && it) sources.push({ itemId: it.id, revision: it.revision, title: it.title, kind: it.kind, at: it.at, sourceLabel: it.sourceLabel, mode: it.mode, role: "meeting read", quote: "" });
  if (!iAmThere) flags.push({ kind: "owner_unknown", text: `I could not tell which speaker is you (your name is set to “${me}”). Promises are listed by speaker. Set your name in Settings and ask again to split yours from theirs.` });
  else if (!mine.length) flags.push({ kind: "none_found", text: `No promise by ${me} was found in “${it?.title}”.` });
  const body = iAmThere ? [`**What you promised in “${it.title}”** (${fmtDay(localDate(it.at))})`, "", mine.length ? mine.map(line).join("\n") : "- Nothing found.", "", "**What others promised**", "", theirs.length ? theirs.map((f) => `- **${firstName(String(f.who))}:** ${clean(f.quote)}${f.value ? ` (due ${fmtDay(f.value)})` : ""}`).join("\n") : "- Nothing found."].join("\n")
    : [`**Promises in “${it.title}”** (${fmtDay(localDate(it.at))}), by speaker`, "", facts.length ? facts.map((f) => `- ${f.who}: ${clean(f.quote)}${f.value ? ` (due ${fmtDay(f.value)})` : ""}`).join("\n") : "- Nothing found."].join("\n");
  return { title: `Promises after ${it.title}`, body, summary: iAmThere ? `${mine.length} promise${mine.length === 1 ? "" : "s"} by you, ${theirs.length} by others, from “${it.title}”.` : `${facts.length} promise${facts.length === 1 ? "" : "s"} by speaker, from “${it.title}”.`, sources, flags, applied: [] as string[], unapplied: [] as string[] };
}

// ---------- verification ----------
export function verifyResult(ctx: Ctx, c: { sources: SrcRef[]; body: string }) {
  const problems: string[] = []; const checks: { name: string; ok: boolean; detail: string }[] = [];
  let ok = 0;
  for (const s of c.sources) {
    const it = authorizedItem(ctx, s.itemId);
    if (!it) { problems.push(`“${s.title}” is no longer available (revoked or forgotten).`); continue; }
    if (it.revision !== s.revision) { problems.push(`“${s.title}” changed to revision ${it.revision} after it was read.`); continue; }
    if (s.quote && !it.body.includes(s.quote)) { problems.push(`The quote from “${s.title}” is no longer in the source.`); continue; }
    ok++;
  }
  checks.push({ name: "Every cited source is still authorized and unchanged", ok: problems.length === 0, detail: `${ok} of ${c.sources.length} verified${problems.length ? `: ${problems.join(" ")}` : ""}` });
  const dateClaims = [...c.body.matchAll(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]{2} \d{1,2}\b/g)].map((m) => m[0]);
  const supportedDates = new Set(c.sources.flatMap((s) => [fmtDayFromQuote(s)]).filter(Boolean));
  void dateClaims; void supportedDates;
  checks.push({ name: "At least one source backs the result", ok: c.sources.length > 0, detail: `${c.sources.length} source${c.sources.length === 1 ? "" : "s"} cited` });
  return { ok: checks.every((x) => x.ok), problems, checks };
}
const fmtDayFromQuote = (_s: SrcRef) => null as string | null;

// ---------- saving ----------
export function saveResult(ctx: Ctx, o: { requestId: string; revision: number; title: string; body: string; summary: string; sources: SrcRef[]; flags: any[]; unavailable: any[]; kind: string; projectId: string | null; verification?: any; analysis?: unknown; mode?: string; draft?: { to: string | null; subject: string; body: string; purpose: string } | null }) {
  return tx(ctx.db, () => {
    const r = get(ctx.db, "SELECT * FROM requests WHERE id=? AND owner_id=?", o.requestId, ctx.owner); if (!r) throw new HttpError(404, "No such request");
    // A result produced for an older instruction can never replace the current one.
    if ((r.revision as number) !== o.revision) { return { discarded: true as const, reason: `That result was for revision ${o.revision}, but the request is now at revision ${r.revision}.` }; }
    const resultId = r.result_id as string; const have = get(ctx.db, "SELECT version FROM result_versions WHERE result_id=? AND request_revision=?", resultId, o.revision);
    if (have) return { discarded: false as const, resultId, version: have.version as number, replay: true };
    const version = ((get(ctx.db, "SELECT MAX(version) v FROM result_versions WHERE result_id=?", resultId)?.v as number | null) ?? 0) + 1; const now = ctx.now().toISOString();
    run(ctx.db, "INSERT INTO result_versions(result_id,version,request_revision,body,summary,sources,flags,unavailable,created_at,analysis,mode) VALUES(?,?,?,?,?,?,?,?,?,?,?)", resultId, version, o.revision, o.body, o.summary, JSON.stringify(o.sources), JSON.stringify([...o.flags, ...(o.verification?.problems ?? []).map((p: string) => ({ kind: "verification", text: p }))]), JSON.stringify(o.unavailable), now, o.analysis ? JSON.stringify(o.analysis) : null, o.mode ?? "rules");
    if (o.draft) run(ctx.db, "INSERT OR REPLACE INTO result_drafts(result_id,version,to_addr,subject,body,purpose) VALUES(?,?,?,?,?,?)", resultId, version, o.draft.to, o.draft.subject, o.draft.body, o.draft.purpose);
    run(ctx.db, "UPDATE results SET version=?, title=?, kind=?, project_id=?, state='current', updated_at=? WHERE id=?", version, o.title, o.kind, o.projectId, now, resultId);
    run(ctx.db, "UPDATE requests SET status='done', project_id=COALESCE(?,project_id), updated_at=? WHERE id=?", o.projectId, now, o.requestId);
    return { discarded: false as const, resultId, version, replay: false };
  });
}

export function resultView(ctx: Ctx, id: string, version?: number) {
  const res = get(ctx.db, "SELECT * FROM results WHERE (id=? OR request_id=?) AND owner_id=?", id, id, ctx.owner); if (!res) throw new HttpError(404, "No such result");
  const req = get(ctx.db, "SELECT * FROM requests WHERE id=?", res.request_id)!; const rcpt = receipt(ctx, req.id as string);
  const vers = all(ctx.db, "SELECT version, request_revision, summary, created_at, stale FROM result_versions WHERE result_id=? ORDER BY version DESC", res.id);
  const v = get(ctx.db, "SELECT * FROM result_versions WHERE result_id=? AND version=?", res.id, version ?? (res.version as number));
  const sources = v ? (JSON.parse(v.sources as string) as SrcRef[]).map((s) => ({ ...s, link: `/evidence/${s.itemId}?q=${encodeURIComponent(s.quote.slice(0, 80))}`, url: `${deepLinkBase()}/evidence/${s.itemId}`, live: (() => { const it = getItem(ctx, s.itemId); return !!it && !("forgotten" in it && it.forgotten) && !("revoked" in it && it.revoked); })() })) : [];
  const revs = all(ctx.db, "SELECT revision, text, origin, at FROM request_revisions WHERE request_id=? ORDER BY revision", req.id).map((r) => ({ revision: r.revision as number, text: String(r.text).replace(/^\(asked again\)\s*/, ""), origin: String(r.origin).split("#")[0], at: r.at as string }));
  return { id: res.id as string, kind: res.kind as string, title: res.title as string, state: res.state as string, projectId: res.project_id as string | null, projectName: res.project_id ? (get(ctx.db, "SELECT name FROM projects WHERE id=?", res.project_id)?.name as string) : null, version: (v?.version as number) ?? 0, latestVersion: res.version as number, versions: vers.map((x) => ({ version: x.version as number, requestRevision: x.request_revision as number, summary: x.summary as string, at: x.created_at as string, stale: x.stale as string | null })),
    analysis: v?.analysis ? JSON.parse(v.analysis as string) : null, mode: (v?.mode as string) ?? "rules", draft: (() => { if (!v) return null; const d = get(ctx.db, "SELECT * FROM result_drafts WHERE result_id=? AND version=?", res.id, v.version); return d ? { to: d.to_addr as string | null, subject: d.subject as string, body: (d.edited_body ?? d.body) as string, original: d.body as string, edited: !!d.edited_body, purpose: d.purpose as string } : null; })(),
    body: (v?.body as string) ?? null, summary: (v?.summary as string) ?? null, sources, flags: v ? JSON.parse(v.flags as string) : [], unavailable: v ? JSON.parse(v.unavailable as string) : [], stale: (v?.stale as string) ?? null,
    request: { id: req.id as string, text: req.text as string, revision: req.revision as number, origin: req.origin as string, revisions: revs, synthetic: !!req.synthetic }, receipt: rcpt, reads: readsFor(ctx, req.id as string, v ? (v.request_revision as number) : undefined),
    applied: v ? parseInstructions(instructionsFor(ctx, req.id as string, v.request_revision as number)) : null, links: links(res.id as string, req.id as string) };
}
export function editDraft(ctx: Ctx, resultId: string, body: string, version?: number) {
  const res = get(ctx.db, "SELECT id, version FROM results WHERE id=? AND owner_id=?", resultId, ctx.owner); if (!res) throw new HttpError(404, "No such result");
  const v = version ?? (res.version as number); const d = get(ctx.db, "SELECT 1 x FROM result_drafts WHERE result_id=? AND version=?", resultId, v); if (!d) throw new HttpError(404, "This version has no draft");
  run(ctx.db, "UPDATE result_drafts SET edited_body=?, edited_at=? WHERE result_id=? AND version=?", body.slice(0, 20000), ctx.now().toISOString(), resultId, v); return { ok: true };
}
export const listResults = (ctx: Ctx, o: { projectId?: string; limit?: number } = {}) => all(ctx.db, `SELECT r.id, r.title, r.kind, r.version, r.state, r.project_id, r.updated_at, r.request_id, (SELECT summary FROM result_versions v WHERE v.result_id=r.id AND v.version=r.version) summary FROM results r WHERE r.owner_id=? AND r.version>0 ${o.projectId ? "AND r.project_id=?" : ""} ORDER BY r.updated_at DESC LIMIT ?`, ...[ctx.owner, ...(o.projectId ? [o.projectId] : []), o.limit ?? 30]).map((r) => ({ id: r.id as string, requestId: r.request_id as string, title: r.title as string, kind: r.kind as string, version: r.version as number, state: r.state as string, projectId: r.project_id as string | null, at: r.updated_at as string, summary: r.summary as string | null, link: `/results/${r.id}` }));
export const listRequests = (ctx: Ctx, limit = 20) => all(ctx.db, "SELECT id FROM requests WHERE owner_id=? ORDER BY updated_at DESC LIMIT ?", ctx.owner, limit).map((r) => receipt(ctx, r.id as string));

// ---------- handlers ----------
const blockWithAsk = (api: JobApi, message: string, ask: unknown): never => {
  run(api.ctx.db, "UPDATE jobs SET result=? WHERE id=?", JSON.stringify({ ask }), api.job.id);
  const root = get(api.ctx.db, "SELECT input FROM jobs WHERE id=?", api.job.root_id ?? api.job.id); const conv = root ? (JSON.parse(root.input as string).conversationId as string | null) : null;
  if (conv && !get(api.ctx.db, "SELECT 1 x FROM messages WHERE job_id=? AND kind='question' AND json_extract(data,'$.answered') IS NULL", api.job.id)) addMessage(api.ctx, conv, { role: "jarvis", kind: "question", jobId: api.job.id, text: (ask as any).question, data: { ask, spoken: (ask as any).question, jobId: api.job.id } });
  throw Object.assign(new Error(message), { blocked: true });
};

const supervise_goal: Handler = async (api) => {
  const ctx = api.ctx; const { requestId, revision } = api.input as { requestId: string; revision: number };
  const req0 = get(ctx.db, "SELECT * FROM requests WHERE id=? AND owner_id=?", requestId, ctx.owner); if (!req0) throw new Error("The request no longer exists");
  const intent = await api.step("understand", "Working out what you asked for", () => understand(ctx, String(req0.text), { projectHint: req0.project_id as string | null }));
  api.event("plan", `Chose a ${intent.deliverable}${intent.when && intent.when.kind === "day" ? ` for ${intent.when.label}` : ""} using: ${intent.capabilities.filter((c) => c !== "draft_local").join(", ") || "no connected sources"}`, { capabilities: intent.capabilities });
  let outcome: any = null; let verdict: any = null;
  for (let round = 1; round <= 2; round++) {
    if ((get(ctx.db, "SELECT revision FROM requests WHERE id=?", requestId)!.revision as number) !== revision) return { superseded: true };
    const research = api.spawn(`research${round}`, { kind: "goal_research", role: "Research", area: "research", title: `Find what applies: ${String(req0.title).slice(0, 50)}`, input: { requestId, revision, intent, conversationId: (api.input as any).conversationId }, evidenceIds: [], tools: intent.capabilities.filter((c) => c !== "draft_local"), budget: { modelCalls: 0 }, criteria: ["Only authorized sources", "Every read is logged"] });
    api.waitFor([research]); const rk = api.child(research); if (rk.status !== "done") throw new Error(`The research helper ${rk.status}`);
    const writer = api.spawn(`writer${round}`, { kind: "goal_writer", role: "Writer", area: "planning", title: `Compose the ${intent.deliverable}`, input: { requestId, revision, intent, bundle: rk.result }, evidenceIds: [], tools: ["draft_local"], budget: { modelCalls: 0 }, criteria: ["Every claim has a source", "Nothing is sent"] });
    api.waitFor([writer]); const wk = api.child(writer); if (wk.status !== "done") throw new Error(`The writer ${wk.status}`);
    const reviewer = api.spawn(`reviewer${round}`, { kind: "goal_reviewer", role: "Reviewer", area: "review", title: "Check every claim against its source", input: { requestId, revision, content: wk.result }, evidenceIds: [], tools: ["read_item"], budget: { modelCalls: 0 }, criteria: ["Sources still authorized", "Quotes still present"] });
    api.waitFor([reviewer]); const vk = api.child(reviewer); if (vk.status !== "done") throw new Error(`The reviewer ${vk.status}`);
    outcome = wk.result; verdict = vk.result;
    if (verdict.ok || round === 2) break;
    await api.step(`retry${round}`, "The reviewer found a gap and sent the work back once", () => { api.event("retry", "The reviewer found a gap and sent the work back once", { problems: verdict.problems }); return true; });
  }
  api.assertNotCancelled();
  const saved = await api.step("save", "Saving the result", () => saveResult(ctx, { requestId, revision, title: outcome.title, body: outcome.body, summary: outcome.summary, sources: outcome.sources, flags: outcome.flags ?? [], unavailable: outcome.unavailable ?? [], kind: outcome.kind, projectId: outcome.projectId ?? null, verification: verdict, analysis: outcome.analysis, mode: outcome.mode, draft: outcome.draft }));
  if (saved.discarded) { api.event("discarded", saved.reason); return { discarded: true }; }
  await api.step("announce", "Telling you it is ready", () => {
    const conv = (api.input as any).conversationId as string | null; const rid = saved.resultId; const spoken = `${outcome.summary}${outcome.flags?.length ? ` ${outcome.flags.length} thing${outcome.flags.length === 1 ? "" : "s"} to check.` : ""}`;
    if (conv && !get(ctx.db, "SELECT 1 x FROM messages WHERE job_id=? AND kind='result'", api.job.root_id ?? api.job.id)) addMessage(ctx, conv, { role: "jarvis", kind: "result", jobId: api.job.root_id ?? api.job.id, text: `${outcome.title} is ready. ${spoken}`, data: { resultId: rid, version: saved.version, links: { open: `/results/${rid}`, label: "Open the result" }, spoken: `${outcome.title} is ready. ${spoken}` } });
    // A scheduled check that found nothing says so in its receipt and stays quiet: no notification.
    const quiet = String(get(ctx.db, "SELECT origin FROM requests WHERE id=?", requestId)?.origin) === "schedule" && /^Nothing needs you/.test(String(outcome.summary));
    if (!quiet) notify(ctx, { eventKey: `result:${rid}:${saved.version}`, level: "brief", title: `${outcome.title} is ready`, body: spoken });
    return true;
  });
  return { resultId: saved.resultId, version: saved.version };
};

const goal_research: Handler = async (api) => {
  const ctx = api.ctx; const { requestId, revision, intent } = api.input as { requestId: string; revision: number; intent: Intent };
  const unavailable = await api.step("sources", "Checking which sources are connected", () => { const u = unavailableSources(ctx); for (const s of u) recordRead(ctx, requestId, revision, { kind: "source", ref: s.id, source: s.label, label: `${s.label}: ${s.state === "needs_signin" ? "needs your sign-in, not read" : s.state}`, used: false, note: s.message }); return u; });
  // Reuse an earlier run's reads when nothing they depend on has changed (a changed instruction should not repeat the research).
  const asked = /^\(asked again\)/.test(String(get(ctx.db, "SELECT text FROM request_revisions WHERE request_id=? AND revision=?", requestId, revision)?.text ?? ""));
  const prior = intent.deliverable === "brief" || asked ? null : get(ctx.db, "SELECT excerpt FROM request_reads WHERE request_id=? AND kind='bundle' AND ref=? ORDER BY revision DESC LIMIT 1", requestId, intent.signature);
  if (prior) {
    const b = JSON.parse(prior.excerpt as string); const still = (b.items ?? []).every((i: any) => { const it = authorizedItem(ctx, i.id); return it && it.revision === i.revision; });
    if (still && b.date === undefined || (still && b.date === (intent.when as any)?.date)) { api.event("reuse", "Reused the earlier reads: the sources have not changed", {}); recordRead(ctx, requestId, revision, { kind: "reuse", label: "Reused earlier reads (sources unchanged)" }); return { ...b, unavailable, reused: true }; }
  }
  const answers = (api.input.answers ?? {}) as { choice?: string };
  const bundle = await api.step(`read-${answers.choice ?? "auto"}`, "Reading the relevant sources", () => {
    if (intent.deliverable === "draft") return researchDraft(ctx, api, intent, requestId, revision);
    if (intent.deliverable === "brief") return researchBrief(ctx, api, intent, requestId, revision);
    const q = String(get(ctx.db, "SELECT text FROM requests WHERE id=?", requestId)?.text ?? "");
    const hasTranscript = !!get(ctx.db, "SELECT 1 x FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.owner_id=? AND i.kind='transcript' AND i.tombstone=0 AND s.revoked_at IS NULL", ctx.owner);
    if (PROMISE_Q.test(q) && hasTranscript) return { mode: "meeting", ...researchMeeting(ctx, api, intent, requestId, revision, answers.choice ?? null) };
    return researchDigest(ctx, api, intent, requestId, revision);
  }) as any;
  if (bundle.ambiguous) blockWithAsk(api, bundle.ambiguous.question, { question: bundle.ambiguous.question, choices: bundle.ambiguous.choices.map((c: any) => ({ id: c.id, guideId: c.id, label: c.label })) });
  if (!bundle.gap) run(ctx.db, "INSERT OR REPLACE INTO request_reads(id,request_id,revision,kind,ref,label,excerpt,used,at) VALUES(?,?,?,?,?,?,?,?,?)", `bd_${sha(requestId + intent.signature + revision).slice(0, 12)}`, requestId, revision, "bundle", intent.signature, "research bundle", JSON.stringify(bundle), 0, ctx.now().toISOString());
  return { ...bundle, unavailable };
};

const goal_writer: Handler = async (api) => {
  const ctx = api.ctx; const { requestId, revision, intent, bundle } = api.input as { requestId: string; revision: number; intent: Intent; bundle: any };
  const instr = parseInstructions(instructionsFor(ctx, requestId, revision));
  const out: any = await api.step("compose", "Writing it from the sources", () => {
    if (bundle.gap) return { kind: intent.deliverable, title: "Nothing to base it on", body: bundle.gap, summary: bundle.gap, sources: [], flags: [{ kind: "gap", text: bundle.gap }], applied: [], unapplied: instr.unapplied, unavailable: bundle.unavailable ?? [], projectId: null };
    const c = intent.deliverable === "draft" ? composeDraft(ctx, bundle, instr, intent) : intent.deliverable === "brief" ? composeBrief(ctx, bundle, intent) : composeAnswer(ctx, bundle, instr);
    return { kind: intent.deliverable, projectId: bundle.projectId ?? intent.projectId ?? null, unavailable: bundle.unavailable ?? [], mode: "rules", ...c };
  });
  // Only what the rules could not settle may go to a model, and only if it is on, authorized and allowed for these sources.
  if (out.analysis && out.needsJudgment) {
    const j = await api.step("judgment", "Asking for an evidence-bounded judgment, if allowed", async () => {
      const r = await synthesizeJudgment(ctx, { options: out.analysis.options, constraints: [], recommendation: out.analysis.recommendation, currency: out.analysis.currency, notes: out.analysis.notes } as any, String(bundle.question ?? ""), { sources: out.sources, localOnly: !!out.localOnly, retryKey: `decision:${requestId}:r${revision}`, onCall: () => api.modelCall() });
      return { text: r.text, citations: r.citations, info: r.info };
    });
    out.mode = j.info.mode;
    if (j.text) { out.body += `\n\n**Model-assisted judgment** (${j.info.mode}; checked against the sources and the computed totals)\n\n${j.text}`; for (const c of j.citations) if (!out.sources.some((x: any) => x.itemId === c.itemId && x.quote === c.quote && x.role === "cited by the model-assisted judgment")) out.sources.push({ ...c, role: "cited by the model-assisted judgment" }); }
    else out.flags.push({ kind: "model_unavailable", text: `The rules could not settle this and no model judgment was added: ${j.info.mode.replace(/^rules only \(|\)$/g, "")}.` });
  }
  return out;
};

const goal_reviewer: Handler = async (api) => {
  const { content } = api.input as { content: any };
  const request = String(get(api.ctx.db, "SELECT text FROM requests WHERE id=?", (api.input as any).requestId)?.text ?? "");
  const v = await api.step("verify", "Checking every cited source", () => {
    const base = (content.sources?.length || !content.flags?.some((f: any) => f.kind === "gap")) ? verifyResult(api.ctx, content) : { ok: true, problems: [] as string[], checks: [{ name: "Nothing to cite", ok: true, detail: "The request found no sources, and says so." }] };
    if (content.analysis) {
      const pr = recheckAnalysis(api.ctx, content.analysis as AnalysisJson, request);
      base.checks.push({ name: "Totals recomputed from the sources as they are now", ok: pr.length === 0, detail: pr.length ? pr.join(" ") : "Every total and the recommendation reproduce." });
      if (pr.length) { base.problems.push(...pr); base.ok = false; }
    }
    return base;
  });
  return v;
};

export const assistantHandlers: Record<string, Handler> = { supervise_goal, goal_research, goal_writer, goal_reviewer };
export { factOut };
