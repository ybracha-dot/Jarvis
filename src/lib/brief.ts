// The first private morning brief. One builder serves an on-demand request and a scheduled run, and it never calls a model.
// It answers: what changed since my last brief, what do I owe before tomorrow, and when can I do it.
// Everything shown is derived from a source the user can open: a deadline from the sentence that states it, a requirement from the sentence that asks for it, a time slot only where a calendar says it is free.
import { Ctx, all, get, run, tx, sha, uid, getSetting, setSetting, logActivity } from "./db";
import { HttpError } from "./decisions";
import { findDates, resolveWeekday, splitSentences } from "./extract";
import { tokens, ownerName } from "./evidence";
import { findTaskRefs } from "./extract";
import { Interval, plannerSettings, planWork, collides, weeklyEntries } from "./planner";
import { availabilityCoverage, uncoveredIntervals, uncoveredDays, Coverage, coveredOn } from "./calendar-cover";
import { addDays, dayOfWeek, diffDays, fmtDateTime, localDate, localHM, parseLocal } from "./time";
import { saveResult, verifyResult } from "./assistant";
import { enqueue } from "./notify";
import { deepLinkBase } from "./capture";
import { grantResult, revokeResult, resultShared, resultAccess } from "./share";

// ---------- types ----------
export interface BriefSource { itemId: string; revision: number; title: string; kind: string; at: string; sourceLabel: string; mode: string; role: string; quote: string; shareable: boolean }
export interface Obligation {
  key: string; kind: "note" | "task" | "calendar" | "commitment"; title: string;
  due: { at: string; timeAssumed: boolean } | null; dueSource: BriefSource | null; dueBasis: string;
  superseded: { at: string; timeAssumed: boolean; source: BriefSource; by: string }[];
  conflicts: { at: string; timeAssumed: boolean; source: BriefSource }[];
  requirements: { text: string; action: string; quote: string; source: BriefSource; mandatory: boolean }[];
  waived: { quote: string; source: BriefSource }[];
  requirementsKnown: boolean; sources: BriefSource[]; shareable: boolean; sourceIds: string[]; link: string | null; text: string;
  userDue?: { at: string; note: string | null } | null; leftOutNote?: string | null;
}
export interface Change { type: "new_item" | "due_moved" | "requirement_added" | "requirement_removed" | "conflict" | "removed" | "you_corrected" | "you_dismissed"; key: string; title: string; text: string; score: number; days?: number; source: BriefSource | null; due?: string | null; previousDue?: string | null }
export interface BlockProposal { start: string; end: string; minutes: number; label: string; step: "work" | "print" }
export interface Priority {
  key: string; rank: number; title: string; kind: string; next: string; due: { at: string; label: string; relative: string; assumedTime: boolean } | null; why: string[];
  estimate: { minutes: number; basis: "default" | "user"; label: string }; evidence: { label: string; href: string; quote: string; role: string }[];
  deadlineHistory: { label: string; by: string; href: string }[]; conflicts: { label: string; href: string }[]; requirements: { text: string; href: string }[];
  blocks: BlockProposal[]; blockNote: string | null; reserved: { id: string; start: string; end: string; label: string }[]; asks: string[]; shareable: boolean; changed: string[];
}
export interface InputStatus { label: string; kind: string; state: "live" | "imported" | "stale" | "unavailable"; readAt: string | null; detail: string }
export interface BriefAnalysis {
  type: "brief"; version: 1; view: "full" | "shared"; occurrenceKey: string; kind: "scheduled" | "ondemand"; builtAt: string; tz: string; baseline: boolean; lastBriefAt: string | null;
  lead: Change | null; leadText: string; changes: Change[]; priorities: Priority[]; alsoDue: { key: string; title: string; due: string | null; label: string; href: string | null }[]; alsoDueMore: number;
  dismissed: { key: string; title: string }[]; owedBeforeTomorrow: number; inputs: InputStatus[]; coverage: Coverage[]; gaps: string[]; leftOut: string[]; modelCalls: 0; shareableCount: number; unshareableCount: number;
}

// ---------- reading dates, requirements and owners out of sentences ----------
const DUE_CUE = /\b(due|deadline|submit(?:ted)?|turn(?:ed)? in|hand(?:ed)? in|by|before|no later than|until|exam|midterm|quiz|presentation|moved|moves|moving|extended|rescheduled|brought forward|pushed|now)\b/i;
const CHANGE_LANG = /\b(now due|is now|moved|moves|moving|extended|extension|postponed|rescheduled|changed to|pushed|brought forward|new deadline|instead|earlier)\b/i;
const REQ_VERB = /\b(bring|print(?:ed)?|printout|hard ?copy|submit|upload|hand in|turn in|attach|include|email|sign|cite)\b/i;
const REQ_FORCE = /\b(please|must|need(?:s)? to|should|required|requirement|make sure|be sure|remember to|don'?t forget|bring|include|attach|upload|submit)\b/i;
const OPTIONAL = /\b(optional|if you (?:like|wish|want|prefer)|consider|may (?:want|choose|wish)|you can|suggest(?:ed)?|recommended|helpful to)\b/i;
const WAIVER = /\b(no longer (?:need|required|have|necessary)|do(?:es)? not need|don'?t need|waive[sd]?|not (?:be )?required|no need|is (?:cancell?ed|dropped)|no (?:paper|printed|hard)[ -]?copies|no printing|online[- ]only)\b/i;
const GENERIC = new Set("due deadline submit submitted turn hand now new class please assignment note update reminder moved extended earlier later instead bring print printed copy copies include attach upload email sign cite will must need needs should have this that from with your you the".split(" "));
const FIRSTNAME = (n: string) => n.trim().split(/\s+/)[0].toLowerCase();

export function dueDates(sentence: string, at: string, tz: string): { iso: string; timeAssumed: boolean; text: string }[] {
  const ds = findDates(sentence, at, tz, "23:59"); if (ds.length) return ds.map((d) => ({ iso: d.iso, timeAssumed: d.timeAssumed, text: d.text }));
  const wd = /\b(?:by|before|due|on|until)\s+(?:the\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b(?:\s*(?:at|by)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i.exec(sentence); if (!wd) return [];
  const date = resolveWeekday(wd[1], at, tz); if (!date) return [];
  let time = "23:59"; let assumed = true; if (wd[2]) { let h = Number(wd[2]) % 12; if (/pm/i.test(wd[4] ?? "")) h += 12; time = `${String(h).padStart(2, "0")}:${wd[3] ?? "00"}`; assumed = false; }
  return [{ iso: parseLocal(date, time, tz).toISOString(), timeAssumed: assumed, text: wd[0] }];
}
/** The action a requirement sentence asks for, in the sentence's own words ("Please bring a printed alphanumeric outline to class." → "Bring a printed alphanumeric outline to class"). */
export function requirementAction(sentence: string): string {
  const m = REQ_VERB.exec(sentence); const from = m ? sentence.slice(m.index) : sentence; const clause = from.replace(/[.!?]+$/, "").split(/;|, and (?=[a-z]+ )| — /)[0].trim();
  return (clause.charAt(0).toUpperCase() + clause.slice(1)).slice(0, 110);
}
const assignedToOther = (sentence: string, owner: string): string | null => {
  const m = /(?:^|[.;,]\s*|\band\s+)((?:[A-Z][a-z]+)(?:\s[A-Z][a-z]+)?)\s+(?:will|must|needs? to|has to|is going to|should|is to)\b/.exec(sentence); if (!m) return null;
  const n = m[1]; if (/^(?:You|We|I|They|Students|Everyone|Please|The|Class|It|This|That|Jarvis)\b/.test(n)) return null; return FIRSTNAME(n) === FIRSTNAME(owner) ? null : n;
};
const defaultEstimate = (text: string): { minutes: number; why: string } => {
  const t = text.toLowerCase();
  if (/\b(outline)\b/.test(t)) return { minutes: 60, why: "Jarvis's default for an outline" };
  if (/\b(exam|midterm|final|quiz|study)\b/.test(t)) return { minutes: 120, why: "Jarvis's default for exam preparation" };
  if (/\b(essay|paper|report|memo|proposal|case)\b/.test(t)) return { minutes: 120, why: "Jarvis's default for a written piece" };
  if (/\b(presentation|slides|deck|pitch)\b/.test(t)) return { minutes: 90, why: "Jarvis's default for a presentation" };
  if (/\b(reading|read)\b/.test(t)) return { minutes: 45, why: "Jarvis's default for a reading" };
  return { minutes: 60, why: "Jarvis's default when nothing says how long it takes" };
};

// ---------- collecting what is owed ----------
const srcOf = (it: any, role: string, quote: string): BriefSource => ({ itemId: it.id, revision: it.revision, title: it.title, kind: it.kind, at: it.at, sourceLabel: it.slabel, mode: it.smode, role, quote, shareable: !!it.shareable && !it.local_only && !it.srev });
const topicTokens = (sentence: string, exclude: Set<string>) => tokens(sentence).filter((t) => !GENERIC.has(t) && !exclude.has(t));
const feedback = (ctx: Ctx) => all(ctx.db, "SELECT * FROM brief_feedback WHERE undone_at IS NULL ORDER BY created_at, rowid");

export interface Collected { obligations: Obligation[]; leftOut: string[]; unreadable: string[] }
export function collectObligations(ctx: Ctx): Collected {
  const tz = plannerSettings(ctx).tz; const me = ownerName(ctx); const now = ctx.now();
  const rows = all(ctx.db, `SELECT i.*, s.label slabel, s.mode smode, s.shareable, s.local_only, s.revoked_at srev, s.id sid FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.owner_id=? AND i.tombstone=0 AND s.revoked_at IS NULL AND i.kind NOT IN ('claude') ORDER BY i.at, i.revision, i.rowid`, ctx.owner);
  const byId = new Map(rows.map((r) => [r.id as string, r])); const rootOf = (id: string) => { let cur = id; const seen = new Set<string>(); while (byId.get(cur)?.corrects && byId.has(byId.get(cur)!.corrects as string) && !seen.has(cur)) { seen.add(cur); cur = byId.get(cur)!.corrects as string; } return cur; };
  const chains = new Map<string, any[]>(); for (const r of rows) { const k = rootOf(r.id as string); chains.set(k, [...(chains.get(k) ?? []), r]); }
  const out: Obligation[] = []; const leftOut: string[] = [];
  const calUnits: Obligation[] = []; const noteObl: Obligation[] = [];

  for (const [rootId, members] of chains) {
    const root = byId.get(rootId)!; const isCal = members.every((m) => m.kind === "calendar");
    const titleToks = new Set(tokens(String(root.title)));
    type U = { sentence: string; at: string; assumed: boolean; item: any; topic: string[]; change: boolean };
    let current: (U & { superseded: Obligation["superseded"] })[] = [];
    const reqs: Obligation["requirements"] = []; const waived: Obligation["waived"] = [];
    for (const it of members) {
      const units: U[] = []; let sentences = splitSentences(String(it.body)); if (isCal) sentences = sentences.filter((s) => !/\(cancelled\)|no longer appears in the feed/i.test(s) || true);
      for (const sentence of sentences) {
        if (WAIVER.test(sentence) && (REQ_VERB.test(sentence) || /print|paper|copy|copies/i.test(sentence))) {
          for (let i = reqs.length - 1; i >= 0; i--) if (/(print|bring|hard ?copy|paper|copy|copies)/i.test(sentence) === /(print|bring|hard ?copy|paper|copy|copies)/i.test(reqs[i].quote) && (reqs[i].source.itemId !== it.id)) { waived.push({ quote: sentence, source: srcOf(it, "waiver", sentence) }); reqs.splice(i, 1); }
          continue;
        }
        const ds = DUE_CUE.test(sentence) ? dueDates(sentence, it.at as string, tz) : [];
        if (ds.length) { const other = assignedToOther(sentence, me); if (other) { leftOut.push(`“${sentence.slice(0, 90)}” is assigned to ${other}, not to you.`); continue; } for (const d of ds.slice(0, 1)) units.push({ sentence, at: d.iso, assumed: d.timeAssumed, item: it, topic: topicTokens(sentence, titleToks), change: CHANGE_LANG.test(sentence) }); }
        if (REQ_VERB.test(sentence) && REQ_FORCE.test(sentence) && !/\?\s*$/.test(sentence) && !OPTIONAL.test(sentence) && !ds.some(() => /^(?:the )?(?:essay|paper|assignment)\b.*\bis due\b/i.test(sentence) && !REQ_VERB.test(sentence)) && !(assignedToOther(sentence, me)) && !reqs.some((r) => r.quote === sentence)) reqs.push({ text: sentence, action: requirementAction(sentence), quote: sentence, source: srcOf(it, "requirement", sentence), mandatory: true });
      }
      for (const u of units) {
        const sameTopic = current.findIndex((c) => (u.topic.length && c.topic.length ? u.topic.filter((t) => c.topic.includes(t)).length / Math.min(u.topic.length, c.topic.length) >= 0.5 : false));
        const onlyOne = units.length === 1 && current.length === 1; const emptyTopic = !u.topic.length;
        const idx = sameTopic >= 0 ? sameTopic : onlyOne || (emptyTopic && current.length === 1) ? 0 : -1;
        if (idx >= 0 && (idx >= 0)) { const prev = current[idx]; const hist = [...prev.superseded, ...(prev.at !== u.at || prev.item.id !== u.item.id ? [{ at: prev.at, timeAssumed: prev.assumed, source: srcOf(prev.item, "superseded deadline", prev.sentence), by: `${u.item.title}` }] : [])]; current[idx] = { ...u, superseded: hist }; }
        else current.push({ ...u, superseded: [] });
      }
    }
    for (const u of current) {
      const multi = current.length > 1; const base = String(root.title); const title = multi && u.topic.length ? `${base}: ${u.topic.slice(0, 3).join(" ")}` : base;
      const shareable = members.every((m) => !!m.shareable && !m.local_only);
      const srcs = [srcOf(u.item, "deadline", u.sentence), ...u.superseded.map((s) => s.source), ...reqs.map((r) => r.source)];
      const o: Obligation = { key: `${isCal ? "cal" : "note"}:${rootId}${multi ? `:${sha(u.topic.join(" ")).slice(0, 6)}` : ""}`, kind: isCal ? "calendar" : "note", title, due: { at: u.at, timeAssumed: u.assumed }, dueSource: srcOf(u.item, "deadline", u.sentence),
        dueBasis: u.superseded.length ? `Replaced the earlier deadline in “${u.superseded[0].source.title}”.` : "", superseded: u.superseded, conflicts: [], requirements: isCal ? [] : reqs.filter((r) => !multi || !r.quote || true), waived, requirementsKnown: !isCal || false,
        sources: srcs, shareable, sourceIds: [...new Set(members.map((m) => m.sid as string))], link: `/evidence/${u.item.id}`, text: `${title}. ${u.sentence}` };
      (isCal ? calUnits : noteObl).push(o);
    }
    // A note that asks for something but states no deadline is still shown, without a date, if it carries a requirement.
    if (!current.length && !isCal && reqs.length) { const it = members[members.length - 1]; noteObl.push({ key: `note:${rootId}`, kind: "note", title: String(root.title), due: null, dueSource: null, dueBasis: "", superseded: [], conflicts: [], requirements: reqs, waived, requirementsKnown: true, sources: reqs.map((r) => r.source), shareable: members.every((m) => !!m.shareable && !m.local_only), sourceIds: [...new Set(members.map((m) => m.sid as string))], link: `/evidence/${it.id}`, text: String(root.title) }); }
  }
  // A calendar event for the same work as a note either agrees with it, or disagrees without either replacing the other: that is a conflict, shown, never resolved silently.
  for (const c of calUnits) {
    const ct = new Set(tokens(c.title).filter((t) => !GENERIC.has(t))); const ref = findTaskRefs(c.title)[0]?.externalId;
    const match = noteObl.find((n) => n.due && (n.title && ((ref && findTaskRefs(`${n.title} ${n.text}`).some((r) => r.externalId === ref)) || tokens(`${n.title} ${n.text}`).filter((t) => ct.has(t)).length >= 2)));
    if (!match) { c.requirementsKnown = false; out.push(c); continue; }
    match.sources.push(...c.sources.map((s) => ({ ...s, role: "calendar" }))); match.sourceIds = [...new Set([...match.sourceIds, ...c.sourceIds])]; match.shareable = match.shareable && c.shareable;
    const same = c.due && match.due && localDate(c.due.at, tz) === localDate(match.due.at, tz);
    if (c.due && match.due && !same) match.conflicts.push({ at: c.due.at, timeAssumed: c.due.timeAssumed, source: c.sources[0] });
  }
  out.push(...noteObl);

  // Course records, if the user imported any, and promises the user owes.
  for (const t of all(ctx.db, "SELECT t.*, c.code ccode FROM tasks t LEFT JOIN courses c ON c.id=t.course_id WHERE t.owner_id=? AND t.status='open' AND t.kind!='practice' AND t.due_at IS NOT NULL", ctx.owner)) {
    const hist = all(ctx.db, "SELECT h.due_at, h.kind, h.recorded_at, h.note FROM task_due_history h WHERE h.task_id=? ORDER BY h.recorded_at, h.rowid", t.id);
    const q = (s: string) => ({ itemId: `task:${t.id}`, revision: 1, title: String(t.title), kind: "task", at: String(t.created_at), sourceLabel: "Course record", mode: "imported", role: s, quote: String(t.title), shareable: false } as BriefSource);
    out.push({ key: `task:${t.id}`, kind: "task", title: `${t.ccode ? `${t.ccode}: ` : ""}${t.title}`, due: { at: String(t.due_at), timeAssumed: false }, dueSource: q("deadline"), dueBasis: "From your course record.", superseded: hist.filter((h) => h.due_at !== t.due_at).map((h) => ({ at: String(h.due_at), timeAssumed: false, source: q("superseded deadline"), by: String(h.note ?? "a later update") })),
      conflicts: [], requirements: all(ctx.db, "SELECT text, quote FROM requirements WHERE task_id=? AND status='active'", t.id).map((r) => ({ text: String(r.text), action: String(r.text), quote: String(r.quote), source: q("requirement"), mandatory: true })), waived: [], requirementsKnown: true, sources: [], shareable: false, sourceIds: [], link: `/?drawer=task&id=${t.id}`, text: String(t.title) });
  }
  for (const c of all(ctx.db, "SELECT * FROM commitments WHERE owner_id=? AND status!='resolved' AND due_date IS NOT NULL", ctx.owner)) {
    if (FIRSTNAME(String(c.who)) !== FIRSTNAME(me)) continue;
    const q = (s: string) => ({ itemId: `commitment:${c.id}`, revision: 1, title: String(c.action), kind: "commitment", at: String(c.created_at ?? ""), sourceLabel: "Your promise", mode: "imported", role: s, quote: String(c.action), shareable: false } as BriefSource);
    out.push({ key: `commitment:${c.id}`, kind: "commitment", title: `${c.action} (to ${c.owed_to})`, due: { at: parseLocal(String(c.due_date), "17:00", tz).toISOString(), timeAssumed: true }, dueSource: q("deadline"), dueBasis: "A promise you made.", superseded: [], conflicts: [], requirements: [], waived: [], requirementsKnown: true, sources: [], shareable: false, sourceIds: [], link: `/tasks?tab=followups&focus=${c.id}`, text: String(c.action) });
  }
  // The user's own corrections sit on top of every source.
  const fb = feedback(ctx);
  for (const o of out) for (const f of fb) if (f.obligation_key === o.key && f.kind === "due" && f.value) { if (o.due) o.superseded.push({ at: o.due.at, timeAssumed: o.due.timeAssumed, source: o.dueSource ?? { itemId: "", revision: 1, title: o.title, kind: o.kind, at: String(f.created_at), sourceLabel: "Earlier", mode: "imported", role: "superseded deadline", quote: o.title, shareable: false }, by: "you" }); o.due = { at: String(f.value), timeAssumed: false }; o.userDue = { at: String(f.value), note: (f.note as string | null) ?? null }; o.conflicts = []; o.dueBasis = "You corrected this deadline."; }
  void now; return { obligations: out, leftOut: [...new Set(leftOut)].slice(0, 6), unreadable: [] };
}

// ---------- inputs ----------
export function inputStatuses(ctx: Ctx): InputStatus[] {
  const out: InputStatus[] = []; const now = ctx.now().getTime();
  for (const s of all(ctx.db, "SELECT s.*, (SELECT COUNT(*) FROM evidence_items i WHERE i.source_id=s.id AND i.tombstone=0) n FROM evidence_sources s WHERE s.owner_id=? AND s.revoked_at IS NULL ORDER BY s.created_at", ctx.owner)) {
    if (!s.n && s.kind !== "calendar") continue;
    const age = s.last_success_at ? now - Date.parse(s.last_success_at as string) : null; const down = ["needs_signin", "failed", "pending"].includes(String(s.state)) || s.mode === "unavailable";
    const live = s.mode === "live"; const state: InputStatus["state"] = down ? "unavailable" : live ? (age != null && age > 36 * 3600_000 ? "stale" : "live") : "imported";
    out.push({ label: String(s.label), kind: s.kind === "calendar" ? "calendar feed" : "notes", state, readAt: (s.last_success_at as string | null) ?? null, detail: down ? String(s.message ?? "Not readable right now") + (s.last_success_at ? ` Last good read ${fmtDateTime(s.last_success_at as string)}.` : " It has never been read.") : live ? `Read ${s.last_success_at ? fmtDateTime(s.last_success_at as string) : "—"}.` : `Imported ${s.last_success_at ? fmtDateTime(s.last_success_at as string) : "earlier"}; ${s.n} item${s.n === 1 ? "" : "s"}.` });
  }
  for (const c of availabilityCoverage(ctx)) out.push({ label: c.label, kind: "calendar availability", state: c.state === "ok" ? (c.mode === "live" ? "live" : "imported") : c.state === "stale" ? "stale" : "unavailable", readAt: c.readAt, detail: `${c.fromDay} to ${c.toDay}. ${c.note}` });
  const nt = get(ctx.db, "SELECT COUNT(*) n FROM tasks WHERE owner_id=? AND status='open'", ctx.owner)?.n as number; if (nt) out.push({ label: "Course records", kind: "tasks", state: "imported", readAt: null, detail: `${nt} open task${nt === 1 ? "" : "s"} from files you imported.` });
  return out;
}
const sourceDown = (ctx: Ctx, sourceIds: string[]) => sourceIds.some((id) => { const s = get(ctx.db, "SELECT state, mode, last_success_at FROM evidence_sources WHERE id=?", id); if (!s) return false; if (["needs_signin", "failed"].includes(String(s.state)) || (s.mode === "unavailable")) return true; return s.mode === "live" && (!s.last_success_at || ctx.now().getTime() - Date.parse(String(s.last_success_at)) > 36 * 3600_000); });

// ---------- snapshots and changes ----------
interface SnapObl { title: string; due: string | null; reqs: string[]; conflict: boolean; source: BriefSource | null }
interface Snapshot { obligations: Record<string, SnapObl> }
const lastRun = (ctx: Ctx, view = "full") => get(ctx.db, "SELECT * FROM brief_runs WHERE view=? AND status='ok' ORDER BY built_at DESC, rowid DESC LIMIT 1", view);
const toSnap = (o: Obligation): SnapObl => ({ title: o.title, due: o.due?.at ?? null, reqs: o.requirements.map((r) => r.action).sort(), conflict: o.conflicts.length > 0, source: o.dueSource });

function diffChanges(ctx: Ctx, prev: Snapshot, cur: Obligation[], tz: string, dismissed: Set<string>): Change[] {
  const out: Change[] = []; const now = ctx.now().getTime(); const near = (iso: string | null, days: number) => !!iso && Date.parse(iso) - now < days * 86400000;
  const curBy = new Map(cur.map((o) => [o.key, o]));
  for (const o of cur) {
    if (dismissed.has(o.key)) continue; const before = prev.obligations[o.key];
    if (!before) { out.push({ type: "new_item", key: o.key, title: o.title, text: `New: ${o.title}${o.due ? `, due ${fmtDueLabel(o.due.at, o.due.timeAssumed, tz)}` : ""}.`, score: near(o.due?.at ?? null, 7) ? 60 : 25, source: o.dueSource, due: o.due?.at ?? null }); continue; }
    if (o.due && before.due && o.due.at !== before.due) {
      const days = diffDays(localDate(before.due, tz), localDate(o.due.at, tz)); const earlier = Date.parse(o.due.at) < Date.parse(before.due);
      out.push({ type: "due_moved", key: o.key, title: o.title, text: `${o.title} is now due ${fmtDueLabel(o.due.at, o.due.timeAssumed, tz)}. It was ${fmtDueLabel(before.due, false, tz)}${days !== 0 ? ` (${earlier ? "moved up" : "pushed back"} ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"})` : ""}.`, score: earlier ? 100 + Math.min(30, Math.abs(days)) + (near(o.due.at, 3) ? 20 : 0) : 40, days, source: o.dueSource, due: o.due.at, previousDue: before.due });
    }
    for (const r of o.requirements) if (!before.reqs.includes(r.action)) out.push({ type: "requirement_added", key: o.key, title: o.title, text: `${o.title}: ${r.action}.`, score: near(o.due?.at ?? null, 7) ? 80 : 45, source: r.source, due: o.due?.at ?? null });
    for (const r of before.reqs) if (!o.requirements.some((x) => x.action === r)) out.push({ type: "requirement_removed", key: o.key, title: o.title, text: `${o.title}: no longer required — ${r}.`, score: 30, source: o.waived[0]?.source ?? null });
    if (o.conflicts.length && !before.conflict) out.push({ type: "conflict", key: o.key, title: o.title, text: `${o.title}: two sources give different deadlines (${fmtDueLabel(o.due!.at, o.due!.timeAssumed, tz)} vs ${fmtDueLabel(o.conflicts[0].at, o.conflicts[0].timeAssumed, tz)}). Neither says it replaces the other.`, score: 70, source: o.conflicts[0].source, due: o.due?.at ?? null });
  }
  for (const [k, b] of Object.entries(prev.obligations)) if (!curBy.has(k) && !dismissed.has(k) && b.due && Date.parse(b.due) > now && !k.startsWith("task:") && !k.startsWith("commitment:")) out.push({ type: "removed", key: k, title: b.title, text: `${b.title} no longer appears in your sources (it was due ${fmtDueLabel(b.due, false, tz)}).`, score: 35, source: b.source });
  return out.sort((a, b) => b.score - a.score);
}

// ---------- wording ----------
export const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
export function fmtDueLabel(iso: string, assumed: boolean, tz: string): string {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
  return assumed ? `${d} (no time stated)` : `${d}, ${new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso))}`;
}
function relative(ctx: Ctx, iso: string, tz: string): string {
  const days = diffDays(localDate(ctx.now(), tz), localDate(iso, tz));
  if (Date.parse(iso) < ctx.now().getTime()) return days === 0 ? "overdue (earlier today)" : `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  return days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}
const href = (s: BriefSource) => s.itemId.startsWith("task:") ? `/?drawer=task&id=${s.itemId.slice(5)}` : s.itemId.startsWith("commitment:") ? `/tasks?tab=followups&focus=${s.itemId.slice(11)}` : `/evidence/${s.itemId}?q=${encodeURIComponent(s.quote.slice(0, 80))}`;

// ---------- the brief ----------
export interface BuildOpts { occurrenceKey: string; kind: "scheduled" | "ondemand"; view?: "full" | "shared" }
const STEP_PRINT = 15;
function plan(ctx: Ctx, o: Obligation, est: number, cov: Coverage[], now: Date, reservedOwn: any[], taken: Interval[] = []): { blocks: BlockProposal[]; note: string | null } {
  if (!o.due) return { blocks: [], note: null }; const due = new Date(o.due.at); if (due.getTime() <= now.getTime()) return { blocks: [], note: "The deadline has passed, so Jarvis proposes no time." };
  if (reservedOwn.length) return { blocks: [], note: null };
  if (!cov.some((c) => c.trusted)) return { blocks: [], note: "No calendar has been read, so Jarvis cannot say when you are free. Import a calendar file or paste your Blackboard link, then rebuild." };
  const extra = [...uncoveredIntervals(ctx, now, due, cov), ...taken]; const hasPrint = o.requirements.some((r) => /print|hard ?copy|printout/i.test(r.action));
  const workMin = Math.max(15, est);
  const p1 = planWork(ctx, { effort: workMin, from: now, due, extraBusy: extra, minChunk: Math.min(30, workMin) });
  const gaps = uncoveredDays(ctx, now, due, cov);
  if (p1.shortfall > 0) return { blocks: [], note: gaps.length ? `The calendar covers only some of the days before this is due (${gaps.length} day${gaps.length === 1 ? "" : "s"} unknown), and there is not enough free time in the covered days. Jarvis will not call an unknown day free.` : `No free ${workMin} minutes before this is due (short by ${p1.shortfall} min). Free a block, or ask for an extension.` };
  const blocks: BlockProposal[] = p1.chunks.map((c) => ({ start: c.start, end: c.end, minutes: c.minutes, label: `Work on ${o.title}`, step: "work" }));
  if (hasPrint) {
    const used: Interval[] = blocks.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end), kind: "proposed" }));
    const after = new Date(Math.max(...blocks.map((b) => Date.parse(b.end))));
    const p2 = planWork(ctx, { effort: STEP_PRINT, from: after, due, extraBusy: [...extra, ...used], minChunk: 15, maxChunk: 30 });
    if (p2.shortfall > 0) return { blocks, note: "There is time to do the work but no free slot after it to print before the deadline." };
    blocks.push(...p2.chunks.map((c) => ({ start: c.start, end: c.end, minutes: c.minutes, label: `Print and check: ${o.title}`, step: "print" as const })));
  }
  return { blocks, note: gaps.length ? `Calendar coverage is unknown for ${gaps.length} day${gaps.length === 1 ? "" : "s"} before the deadline; only covered days were used.` : null };
}

function priorityOf(ctx: Ctx, o: Obligation, rank: number, cov: Coverage[], changes: Change[], fbs: any[], tz: string, taken: Interval[] = []): Priority {
  const now = ctx.now(); const est = fbs.filter((f) => f.obligation_key === o.key && f.kind === "estimate").pop();
  const base = defaultEstimate(`${o.title} ${o.requirements.map((r) => r.action).join(" ")}`);
  const estimate = est ? { minutes: Number(est.value), basis: "user" as const, label: `${est.value} min (your estimate)` } : { minutes: base.minutes, basis: "default" as const, label: `${base.minutes} min (estimate: ${base.why}; correct it if it is wrong)` };
  const reserved = all(ctx.db, "SELECT id,start_at,end_at,title FROM blocks WHERE owner_id=? AND source='brief' AND revision_id=? AND state='active' AND end_at>?", ctx.owner, `brief:${o.key}`, now.toISOString()).map((b) => ({ id: String(b.id), start: String(b.start_at), end: String(b.end_at), label: String(b.title) }));
  const pl = plan(ctx, o, estimate.minutes, cov, now, reserved, taken);
  const first = o.requirements[0]; const next = first ? first.action : !o.requirementsKnown ? `Find out what “${o.title}” requires (the calendar only gives the date)` : /outline|essay|paper|draft|report|memo|proposal|presentation|slides/i.test(o.title) ? `Work on ${o.title}` : `Do: ${o.title}`;
  const dueLabel = o.due ? { at: o.due.at, label: fmtDueLabel(o.due.at, o.due.timeAssumed, tz), relative: relative(ctx, o.due.at, tz), assumedTime: o.due.timeAssumed } : null;
  const why: string[] = []; if (o.superseded.length && o.due) { const last = o.superseded[o.superseded.length - 1]; const n = diffDays(localDate(last.at, tz), localDate(o.due.at, tz)); why.push(o.userDue ? `You corrected the deadline (it was ${fmtDueLabel(last.at, last.timeAssumed, tz)}).` : `${n < 0 ? "Moved up" : n > 0 ? "Pushed back" : "Time changed"}${n ? ` ${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}` : ""} from ${fmtDueLabel(last.at, last.timeAssumed, tz)} by “${last.by}”. The instructor's deadline is the one above; your work blocks are separate.`); } else if (o.dueBasis) why.push(o.dueBasis); if (o.conflicts.length) why.push("Two sources disagree about the deadline; the earlier one is used until you decide."); if (!o.requirementsKnown) why.push("This deadline comes from a calendar, which does not include the instructions or what to hand in.");
  const lateReserved = reserved.filter((r) => o.due && Date.parse(r.end) > Date.parse(o.due.at)); if (lateReserved.length) why.push("A block you reserved ends after the new deadline. Move it.");
  const ev: Priority["evidence"] = []; const seen = new Set<string>(); for (const s of o.sources) { const k = `${s.itemId}|${s.role}`; if (seen.has(k) || s.role === "superseded deadline") continue; seen.add(k); ev.push({ label: `${s.title} (${s.role})`, href: href(s), quote: s.quote.slice(0, 220), role: s.role }); }
  return { key: o.key, rank, title: o.title, kind: o.kind, next, due: dueLabel, why, estimate, evidence: ev,
    deadlineHistory: o.superseded.map((s) => ({ label: `Was ${fmtDueLabel(s.at, s.timeAssumed, tz)} (“${s.source.title}”). Replaced ${s.by === "you" ? "by your correction" : `by “${s.by}”`}.`, by: s.by, href: href(s.source) })),
    conflicts: o.conflicts.map((c) => ({ label: `${c.source.sourceLabel} says ${fmtDueLabel(c.at, c.timeAssumed, tz)}.`, href: href(c.source) })), requirements: o.requirements.map((r) => ({ text: r.action, href: href(r.source) })),
    blocks: pl.blocks, blockNote: pl.note, reserved, asks: o.requirementsKnown ? [] : ["Paste the original instructions, or a notification email you are allowed to forward, so Jarvis can tell what to hand in."], shareable: o.shareable, changed: changes.filter((c) => c.key === o.key).map((c) => c.text) };
}

export function buildBrief(ctx: Ctx, opts: BuildOpts): { analysis: BriefAnalysis; sources: BriefSource[] } {
  const tz = plannerSettings(ctx).tz; const now = ctx.now(); const view = opts.view ?? "full";
  const coll = collectObligations(ctx); const cov = availabilityCoverage(ctx); const fbs = feedback(ctx);
  const prevRun = lastRun(ctx, view); const prev: Snapshot | null = prevRun ? JSON.parse(String(prevRun.snapshot)) : null; const baseline = !prev;
  // Dismissed items stay out until their deadline moves earlier than it was when dismissed.
  const dismissedKeys = new Set<string>(); const dismissedList: { key: string; title: string }[] = [];
  for (const o of coll.obligations) { const d = fbs.filter((f) => f.obligation_key === o.key && f.kind === "dismiss").pop(); const un = fbs.filter((f) => f.obligation_key === o.key && f.kind === "done").pop();
    if (un) { dismissedKeys.add(o.key); continue; }
    if (d && !(o.due && d.value && Date.parse(o.due.at) < Date.parse(String(d.value)))) { dismissedKeys.add(o.key); dismissedList.push({ key: o.key, title: o.title }); } }
  let obls = coll.obligations;
  if (view === "shared") obls = obls.filter((o) => o.shareable);
  const changesAll = prev ? diffChanges(ctx, prev, obls, tz, dismissedKeys) : [];
  // Corrections the user made since the last brief are acknowledged, never presented as news from a source.
  const acknowledged: Change[] = []; if (view === "full") for (const f of fbs) if (prevRun && String(f.created_at) >= String(prevRun.built_at) && (f.kind === "due" || f.kind === "dismiss")) { const o = coll.obligations.find((x) => x.key === f.obligation_key); if (o) acknowledged.push({ type: f.kind === "due" ? "you_corrected" : "you_dismissed", key: o.key, title: o.title, text: f.kind === "due" ? `You corrected ${o.title}: now ${fmtDueLabel(String(f.value), false, tz)}.` : `You dismissed ${o.title}.`, score: 5, source: null }); }
  // Anything whose source could not be refreshed keeps its previous comparison point: it is shown, flagged, and its change is still to come.
  const downKeys = new Set(obls.filter((o) => sourceDown(ctx, o.sourceIds)).map((o) => o.key));
  const changes = changesAll.filter((c) => !downKeys.has(c.key)); const lead = changes[0] && changes[0].score >= 30 ? changes[0] : null;

  const live = obls.filter((o) => !dismissedKeys.has(o.key) && (!o.due || Date.parse(o.due.at) > now.getTime() - 14 * 86400000));
  const endTomorrow = parseLocal(addDays(localDate(now, tz), 2), "00:00", tz).getTime();
  const score = (o: Obligation) => { if (!o.due) return -50; const h = (Date.parse(o.due.at) - now.getTime()) / 3600000; const base = h < 0 ? 400 + Math.min(60, -h / 24) : 300 / (1 + h / 24); return base + (changes.filter((c) => c.key === o.key).reduce((m, c) => Math.max(m, c.score), 0)) * 0.6 + (o.conflicts.length ? 25 : 0); };
  const ranked = live.filter((o) => o.due && (Date.parse(o.due.at) - now.getTime() < 7 * 86400000 || changes.some((c) => c.key === o.key) || o.conflicts.length)).sort((a, b) => score(b) - score(a));
  const top = ranked.slice(0, 3); const topKeys = new Set(top.map((o) => o.key));
  // Suggestions never overlap each other: each priority plans around the ones above it.
  const taken: Interval[] = []; const priorities = top.map((o, i) => { const pr = priorityOf(ctx, o, i + 1, cov, changes, fbs, tz, taken); for (const b of pr.blocks) taken.push({ start: Date.parse(b.start), end: Date.parse(b.end), kind: "proposed" }); return pr; });
  const rest = live.filter((o) => !topKeys.has(o.key) && o.due).sort((a, b) => Date.parse(a.due!.at) - Date.parse(b.due!.at));
  const alsoDue = rest.slice(0, 8).map((o) => ({ key: o.key, title: o.title, due: o.due!.at, label: fmtDueLabel(o.due!.at, o.due!.timeAssumed, tz), href: o.dueSource ? href(o.dueSource) : o.link }));
  const owedBeforeTomorrow = live.filter((o) => o.due && Date.parse(o.due.at) < endTomorrow).length;

  const inputs = view === "full" ? inputStatuses(ctx) : [];
  const gaps: string[] = []; for (const i of inputs) if (i.state === "unavailable" || i.state === "stale") gaps.push(`${i.label}: ${i.state === "stale" ? "stale" : "unavailable"}. ${i.detail}`);
  if (view === "full" && !cov.some((c) => c.trusted)) gaps.push("No calendar covers any day, so no time slot is claimed as free.");
  const noteCount = coll.obligations.length; if (!noteCount) gaps.push("Nothing with a deadline was found in your notes or calendar yet.");
  const leadText = baseline ? "This is your first brief, so it is a baseline: there is nothing earlier to compare with. Changes will show from the next one." : lead ? lead.text : prevRun ? `No material change since your last brief (${fmtDateTime(String(prevRun.built_at), tz)}).` : "No material change.";
  const sourcesOut: BriefSource[] = []; const seenSrc = new Set<string>(); for (const o of [...top, ...ranked.slice(3, 3)]) for (const s of o.sources) { if (s.itemId.startsWith("task:") || s.itemId.startsWith("commitment:") || seenSrc.has(`${s.itemId}|${s.quote}`)) continue; seenSrc.add(`${s.itemId}|${s.quote}`); sourcesOut.push(s); }
  const analysis: BriefAnalysis = { type: "brief", version: 1, view, occurrenceKey: opts.occurrenceKey, kind: opts.kind, builtAt: now.toISOString(), tz, baseline, lastBriefAt: prevRun ? String(prevRun.built_at) : null, lead, leadText, changes: [...changes, ...acknowledged].slice(0, 12), priorities, alsoDue, alsoDueMore: Math.max(0, rest.length - alsoDue.length), dismissed: dismissedList,
    owedBeforeTomorrow, inputs, coverage: view === "full" ? cov : [], gaps, leftOut: view === "full" ? coll.leftOut : [], modelCalls: 0, shareableCount: obls.filter((o) => o.shareable).length, unshareableCount: coll.obligations.filter((o) => !o.shareable).length };
  if (view === "shared") { for (const p of analysis.priorities) { p.blocks = []; p.blockNote = null; p.reserved = []; } analysis.coverage = []; analysis.gaps = []; analysis.leftOut = []; }
  return { analysis, sources: sourcesOut };
}

export function briefMarkdown(a: BriefAnalysis): string {
  const L: string[] = [];
  L.push(`**${a.view === "shared" ? "Morning brief (the version shared with Claude)" : "Morning brief"}**`, "", a.baseline ? `**Baseline.** ${a.leadText}` : `**What changed.** ${a.leadText}`, "");
  if (a.changes.filter((c) => c.text !== a.lead?.text).length) { L.push("Other changes:", ...a.changes.filter((c) => c.text !== a.lead?.text).slice(0, 5).map((c) => `- ${c.text}`), ""); }
  L.push(`**What you owe.** ${a.owedBeforeTomorrow} item${a.owedBeforeTomorrow === 1 ? "" : "s"} due before tomorrow ends.`, "");
  a.priorities.forEach((p) => {
    L.push(`**${p.rank}. ${p.title}**`, `- Next: ${p.next}`, `- Due: ${p.due ? `${p.due.label} (${p.due.relative})` : "no deadline found"}`);
    for (const h of p.deadlineHistory) L.push(`- ${h.label}`); for (const c of p.conflicts) L.push(`- Conflict: ${c.label}`); for (const w of p.why) L.push(`- ${w}`);
    if (p.blocks.length) L.push(`- When: ${p.blocks.map((b) => `${new Intl.DateTimeFormat("en-US", { timeZone: a.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(b.start))} to ${fmtTime(b.end, a.tz)} (${b.step === "print" ? "print" : "work"}, ${b.minutes} min)`).join("; ")}. Estimate: ${p.estimate.label}.`);
    else if (p.reserved.length) L.push(`- Reserved: ${p.reserved.map((b) => `${fmtDateTime(b.start, a.tz)} to ${fmtTime(b.end, a.tz)}`).join("; ")}.`); else if (p.blockNote) L.push(`- No time proposed: ${p.blockNote}`);
    for (const e of p.evidence) L.push(`- Source: ${e.label}: “${e.quote}”`); for (const q of p.asks) L.push(`- ${q}`); L.push("");
  });
  if (!a.priorities.length) L.push("Nothing is due soon in the sources Jarvis can read.", "");
  if (a.alsoDue.length) L.push("**Also due**", ...a.alsoDue.map((d) => `- ${d.title}: ${d.label}`), a.alsoDueMore ? `- …and ${a.alsoDueMore} more` : "", "");
  if (a.view === "full") { if (a.gaps.length) L.push("**What I could not check**", ...a.gaps.map((g) => `- ${g}`), ""); if (a.inputs.length) L.push("**Inputs**", ...a.inputs.map((i) => `- ${i.label} (${i.kind}): ${i.state}. ${i.detail}`), ""); }
  L.push("No model was called. Nothing was sent, submitted or changed outside Jarvis.");
  return L.filter((x, i, arr) => !(x === "" && arr[i - 1] === "")).join("\n");
}

// ---------- saving: one result per occurrence ----------
const briefIds = (ctx: Ctx, key: string) => { const h = sha(`${ctx.owner}|brief|${key}`).slice(0, 12); return { requestId: `req_br_${h}`, resultId: `res_br_${h}` }; };
const titleFor = (a: BriefAnalysis, ctx: Ctx) => `${a.view === "shared" ? "Morning brief for Claude" : "Morning brief"}: ${new Intl.DateTimeFormat("en-US", { timeZone: a.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ctx.now())}`;

export function runBrief(ctx: Ctx, opts: BuildOpts) {
  const view = opts.view ?? "full"; const storeKey = view === "shared" ? `${opts.occurrenceKey}|shared` : opts.occurrenceKey;
  const ex = get(ctx.db, "SELECT * FROM brief_runs WHERE occurrence_key=?", storeKey);
  if (ex) return { created: false as const, resultId: ex.result_id as string, requestId: ex.request_id as string, builtAt: ex.built_at as string, baseline: !!ex.baseline, summary: ex.summary as string | null, link: `/results/${ex.result_id}` };
  const { analysis, sources } = buildBrief(ctx, { ...opts, view }); const body = briefMarkdown(analysis); const { requestId, resultId } = briefIds(ctx, storeKey);
  return tx(ctx.db, () => {
    const now = ctx.now().toISOString(); const title = titleFor(analysis, ctx);
    if (!get(ctx.db, "SELECT 1 x FROM requests WHERE id=?", requestId)) {
      run(ctx.db, "INSERT INTO requests(id,owner_id,dedup_key,title,origin,text,revision,status,project_id,result_id,synthetic,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", requestId, ctx.owner, JSON.stringify([null, `brief:${storeKey}`]), title, opts.kind === "scheduled" ? "schedule" : "api", "What changed since my last brief, what do I owe before tomorrow, and when can I do it?", 1, "done", null, resultId, 0, now, now);
      run(ctx.db, "INSERT INTO request_revisions(request_id,revision,text,origin,at) VALUES(?,?,?,?,?)", requestId, 1, "What changed since my last brief, what do I owe before tomorrow, and when can I do it?", opts.kind === "scheduled" ? "schedule" : "api", now);
      run(ctx.db, "INSERT INTO results(id,owner_id,request_id,kind,title,project_id,version,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", resultId, ctx.owner, requestId, "brief", title, null, 0, "pending", now, now);
    }
    const srcRefs = sources.map((s) => ({ itemId: s.itemId, revision: s.revision, title: s.title, kind: s.kind, at: s.at, sourceLabel: s.sourceLabel, mode: s.mode, role: s.role, quote: s.quote })) as any[];
    const verification = verifyResult(ctx, { sources: srcRefs, body });
    const flags = [...analysis.gaps.map((g) => ({ kind: "input_gap", text: g })), ...(analysis.baseline ? [{ kind: "baseline", text: "First brief: a baseline, not a comparison." }] : [])];
    const saved = saveResult(ctx, { requestId, revision: 1, title, body, summary: analysis.leadText.slice(0, 280), sources: srcRefs, flags, unavailable: analysis.inputs.filter((i) => i.state === "unavailable").map((i) => ({ label: i.label, reason: i.detail })), kind: "brief", projectId: null, verification, analysis, mode: `Morning brief (${opts.kind === "scheduled" ? "scheduled" : "on request"}, rules only, no model call)`, outcomes: [] });
    if (saved.discarded) throw new HttpError(409, saved.reason);
    // The comparison point moves forward per item: anything whose source could not be refreshed keeps its earlier entry.
    const prevRun = lastRun(ctx, view); const prev: Snapshot = prevRun ? JSON.parse(String(prevRun.snapshot)) : { obligations: {} };
    const coll = collectObligations(ctx); const snap: Snapshot = { obligations: {} };
    for (const o of coll.obligations) { if (view === "shared" && !o.shareable) continue; snap.obligations[o.key] = sourceDown(ctx, o.sourceIds) && prev.obligations[o.key] ? prev.obligations[o.key] : toSnap(o); }
    for (const [k, v] of Object.entries(prev.obligations)) if (!(k in snap.obligations) && coll.obligations.length === 0) snap.obligations[k] = v;
    run(ctx.db, "INSERT OR IGNORE INTO brief_runs(occurrence_key,kind,view,built_at,result_id,request_id,baseline,snapshot,summary,inputs,status,model_calls) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", storeKey, opts.kind, view, now, resultId, requestId, analysis.baseline ? 1 : 0, JSON.stringify(snap), analysis.leadText.slice(0, 280), JSON.stringify(analysis.inputs), "ok", 0);
    if (view === "full") enqueue(ctx, { eventKey: `brief-ready:${storeKey}`, level: "brief", title: "Morning brief", body: analysis.leadText.slice(0, 200) });
    logActivity(ctx, "brief_built", resultId, `${view} brief ${opts.kind}: ${analysis.priorities.length} priorities, baseline=${analysis.baseline}`);
    return { created: true as const, resultId, requestId, builtAt: now, baseline: analysis.baseline, summary: analysis.leadText, link: `/results/${resultId}` };
  });
}

/** Give Claude a separate view of a brief, built only from notes the user has shared (no calendar, no course records, nothing local-only), and approve that view. The private brief itself is never handed over. */
export function shareBrief(ctx: Ctx, resultId: string) {
  const row = get(ctx.db, "SELECT occurrence_key, kind FROM brief_runs WHERE result_id=? AND view='full'", resultId); if (!row) throw new HttpError(404, "That is not a brief you can share.");
  const v = runBrief(ctx, { occurrenceKey: row.occurrence_key as string, kind: row.kind as "scheduled" | "ondemand", view: "shared" }); grantResult(ctx, v.resultId, resultId);
  return { shared: true as const, sharedResultId: v.resultId, link: `/results/${v.resultId}` };
}
/** Take it back: every shared view that Claude can still open is closed, whichever brief it was made from. A newer brief does not leave an older shared view open. */
export function unshareBrief(ctx: Ctx, _resultId?: string) {
  for (const r of all(ctx.db, "SELECT result_id FROM brief_runs WHERE view='shared'")) if (resultShared(ctx, r.result_id as string)) revokeResult(ctx, r.result_id as string);
  return { shared: false as const };
}

// ---------- the agenda beside the brief ----------
export interface AgendaItem { id: string; kind: "busy" | "class" | "quiet" | "deadline" | "proposed" | "reserved"; start: string; end: string | null; label: string; detail: string | null; href: string | null }
export interface AgendaDay { day: string; name: string; covered: boolean; coverageNote: string; items: AgendaItem[] }
/** Real busy periods, the instructor's deadlines, suggested times and reserved times, each kept distinct. A day no calendar covers is unknown, never free. */
export function agendaFor(ctx: Ctx, a: BriefAnalysis | null): { days: AgendaDay[]; coverage: string[] } {
  const tz = plannerSettings(ctx).tz; const now = ctx.now(); const today = localDate(now, tz); const cov = availabilityCoverage(ctx);
  const dayNames = (d: string) => d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${d}T12:00:00Z`));
  const days = new Set<string>([today, addDays(today, 1)]);
  for (const p of a?.priorities ?? []) { if (p.due) { const d = localDate(p.due.at, tz); if (d >= today && d <= addDays(today, 4)) days.add(d); } for (const b of p.blocks) days.add(localDate(b.start, tz)); }
  const reserved = all(ctx.db, "SELECT id,start_at,end_at,title,revision_id FROM blocks WHERE owner_id=? AND source='brief' AND state='active' AND end_at>?", ctx.owner, now.toISOString()); for (const b of reserved) days.add(localDate(b.start_at as string, tz));
  const order = [...days].filter((d) => d >= today).sort().slice(0, 4); const out: AgendaDay[] = [];
  for (const d of order) {
    const lo = parseLocal(d, "00:00", tz), hi = parseLocal(addDays(d, 1), "00:00", tz); const items: AgendaItem[] = []; const covered = coveredOn(cov, d);
    for (const b of all(ctx.db, "SELECT id,start_at,end_at,title,source FROM blocks WHERE owner_id=? AND kind='calendar' AND state='active' AND end_at>? AND start_at<? ORDER BY start_at", ctx.owner, lo.toISOString(), hi.toISOString())) items.push({ id: String(b.id), kind: "busy", start: String(b.start_at), end: String(b.end_at), label: String(b.title), detail: "On your calendar", href: null });
    for (const w of weeklyEntries(ctx)) if (w.days.includes(dayOfWeek(d))) items.push({ id: `w:${w.label}:${d}`, kind: w.kind === "class" ? "class" : "quiet", start: parseLocal(d, w.start, tz).toISOString(), end: parseLocal(addDays(d, w.spansDays ?? 0), w.end, tz).toISOString(), label: w.label, detail: w.kind === "class" ? "Your class time" : "Quiet time you set", href: null });
    for (const p of a?.priorities ?? []) {
      if (p.due && localDate(p.due.at, tz) === d) items.push({ id: `due:${p.key}`, kind: "deadline", start: p.due.at, end: null, label: `Due: ${p.title}`, detail: "Deadline set by the instructor", href: p.evidence[0]?.href ?? null });
      if (!p.reserved.length) for (const b of p.blocks) if (localDate(b.start, tz) === d) items.push({ id: `prop:${p.key}:${b.start}`, kind: "proposed", start: b.start, end: b.end, label: b.step === "print" ? `Print and check: ${p.title}` : `Work on ${p.title}`, detail: `${b.minutes} min · not reserved yet`, href: null });
    }
    for (const b of reserved) if (localDate(b.start_at as string, tz) === d) items.push({ id: String(b.id), kind: "reserved", start: String(b.start_at), end: String(b.end_at), label: String(b.title), detail: "Reserved on this computer", href: null });
    items.sort((x, y) => Date.parse(x.start) - Date.parse(y.start) || x.kind.localeCompare(y.kind));
    out.push({ day: d, name: dayNames(d), covered, items, coverageNote: covered ? "A calendar you read covers this day." : cov.some((c) => c.trusted) ? "No calendar covers this day, so open time here is unknown, not free." : "No calendar has been read, so open time is unknown, not free." });
  }
  const notes = cov.map((c) => c.mode === "declared" ? `${c.label}: ${c.fromDay} to ${c.toDay}.` : c.trusted ? `${c.label}: covers ${c.fromDay} to ${c.toDay}, judged from its first and last event${c.mode === "imported" ? "; it is a snapshot and does not update by itself" : ""}.` : `${c.label}: ${c.note}`);
  return { days: out, coverage: notes };
}

/** If a scheduled brief is going to be missed, say so, with the step that fixes it. */
function scheduleWarning(ctx: Ctx, sch: { enabled: boolean; paused: boolean; workerActive: boolean; nextRun: any }, tz: string): { text: string; fix: string } | null {
  if (!sch.enabled || !sch.nextRun) return null; const when = fmtDateTime(sch.nextRun.at, tz);
  if (sch.paused) return { text: `Scheduled briefs are paused, so the one due ${when} will not run.`, fix: "Resume them in Settings." };
  if (!sch.workerActive && Date.parse(sch.nextRun.at) - ctx.now().getTime() < 36 * 3600_000) return { text: `The brief due ${when} will not run: no worker is running.`, fix: "Start one in Terminal: npm run worker" };
  return null;
}

/** What Claude would receive if the user shared the brief now. Titles of what would be included, and only a count of what is kept out. */
export function sharePreview(ctx: Ctx) {
  const { analysis: a } = buildBrief(ctx, { occurrenceKey: "preview", kind: "ondemand", view: "shared" }); const tz = a.tz;
  return { included: [...a.priorities.map((p) => ({ title: p.title, due: p.due ? p.due.label : null })), ...a.alsoDue.map((o) => ({ title: o.title, due: o.label }))], withheld: a.unshareableCount };
}

/** Today's reading of the latest brief, plus the honest state of the machinery behind it. */
export function briefToday(ctx: Ctx, sch: { enabled: boolean; paused: boolean; workerActive: boolean; lastHeartbeat: string | null; nextRun: any; lastRun: any; message: string; quietNow: string | null }) {
  const run1 = lastRun(ctx, "full"); const tz = plannerSettings(ctx).tz;
  const analysis = run1 ? (get(ctx.db, "SELECT rv.analysis FROM result_versions rv JOIN results r ON r.id=rv.result_id AND r.version=rv.version WHERE r.id=?", run1.result_id)?.analysis as string | null) : null;
  const recentMisses = all(ctx.db, "SELECT occurrence_key, scheduled_for, ran_at, status, detail FROM schedule_runs WHERE (missed=1 OR status IN ('failed','deferred') OR detail IS NOT NULL) AND ran_at>? ORDER BY ran_at DESC LIMIT 5", new Date(ctx.now().getTime() - 7 * 86400000).toISOString()).map((r) => ({ key: r.occurrence_key as string, scheduledFor: r.scheduled_for as string, ranAt: r.ran_at as string, status: r.status as string, detail: (r.detail as string | null) ?? null }));
  const sharedRuns = all(ctx.db, "SELECT * FROM brief_runs WHERE view='shared' AND status='ok' ORDER BY built_at DESC, rowid DESC LIMIT 12"); const shared = sharedRuns.find((r) => resultAccess(ctx, r.result_id as string).allowed) ?? sharedRuns[0] ?? null;
  return { tz, enabled: getSetting(ctx.db, "brief_enabled", ctx.mode === "personal"), analysis: analysis ? (JSON.parse(analysis) as BriefAnalysis) : null, resultId: (run1?.result_id as string | null) ?? null, builtAt: (run1?.built_at as string | null) ?? null, occurrenceKey: (run1?.occurrence_key as string | null) ?? null,
    agenda: agendaFor(ctx, analysis ? (JSON.parse(analysis) as BriefAnalysis) : null), hasNotes: (get(ctx.db, "SELECT COUNT(*) n FROM evidence_items WHERE owner_id=? AND tombstone=0 AND kind NOT IN ('calendar','claude')", ctx.owner)?.n as number) > 0, hasCalendar: availabilityCoverage(ctx).some((c) => c.trusted), now: ctx.now().toISOString(), scheduleWarning: scheduleWarning(ctx, sch, tz),
    scheduler: { enabled: sch.enabled, paused: sch.paused, workerActive: sch.workerActive, lastHeartbeat: sch.lastHeartbeat, nextRun: sch.nextRun, lastRun: sch.lastRun, message: sch.message, quietNow: sch.quietNow }, lastSuccessAt: (run1?.built_at as string | null) ?? null, recentMisses, sharedResultId: (shared?.result_id as string | null) ?? null, link: deepLinkBase() };
}

// ---------- what the user can do with it ----------
export function briefFeedback(ctx: Ctx, o: { key: string; kind: "dismiss" | "undismiss" | "due" | "estimate" | "done" | "undo"; value?: string | number | null; note?: string | null }) {
  const known = collectObligations(ctx).obligations.find((x) => x.key === o.key); if (!known) throw new HttpError(404, "That item is not in your sources any more.");
  if (o.kind === "undismiss" || o.kind === "undo") { run(ctx.db, "UPDATE brief_feedback SET undone_at=? WHERE obligation_key=? AND kind IN ('dismiss','done') AND undone_at IS NULL", ctx.now().toISOString(), o.key); return { ok: true }; }
  if (o.kind === "due") { const t = Date.parse(String(o.value)); if (Number.isNaN(t)) throw new HttpError(422, "Give the corrected deadline as a date and time."); }
  if (o.kind === "estimate") { const m = Number(o.value); if (!Number.isFinite(m) || m < 5 || m > 1200) throw new HttpError(422, "An estimate is between 5 and 1200 minutes."); }
  run(ctx.db, "INSERT INTO brief_feedback(id,obligation_key,kind,value,note,created_at) VALUES(?,?,?,?,?,?)", uid("bf"), o.key, o.kind, o.kind === "dismiss" ? (known.due?.at ?? null) : o.value == null ? null : String(o.value), o.note ?? null, ctx.now().toISOString());
  logActivity(ctx, "brief_feedback", o.key, `${o.kind}: ${known.title}`); return { ok: true };
}
/** Rebuild now, as a new on-demand brief that reflects the correction. A repeat within the same minute and the same inputs returns the same brief. */
export function briefNow(ctx: Ctx) {
  const fb = (get(ctx.db, "SELECT COUNT(*) n, MAX(created_at) m FROM brief_feedback WHERE undone_at IS NULL")?.n as number) ?? 0;
  const undone = (get(ctx.db, "SELECT COUNT(*) n FROM brief_feedback WHERE undone_at IS NOT NULL")?.n as number) ?? 0;
  const itemSig = sha(JSON.stringify(all(ctx.db, "SELECT id,revision FROM evidence_items WHERE tombstone=0 ORDER BY id").map((r) => `${r.id}@${r.revision}`)) + JSON.stringify(all(ctx.db, "SELECT COUNT(*) n, MAX(start_at) m FROM blocks WHERE state='active'")) + JSON.stringify(all(ctx.db, "SELECT id,state,mode,last_success_at,revoked_at,shareable,local_only FROM evidence_sources ORDER BY id")) + JSON.stringify(all(ctx.db, "SELECT provider,state,last_success_at FROM source_status ORDER BY provider"))).slice(0, 8);
  return runBrief(ctx, { occurrenceKey: `ondemand:${ctx.now().toISOString().slice(0, 16)}:f${fb}.${undone}:${itemSig}`, kind: "ondemand" });
}

export function reserveBrief(ctx: Ctx, o: { key: string; blocks?: { start: string; end: string }[] }) {
  const ob = collectObligations(ctx).obligations.find((x) => x.key === o.key); if (!ob || !ob.due) throw new HttpError(404, "That item has no deadline in your sources any more.");
  const cov = availabilityCoverage(ctx); const tz = plannerSettings(ctx).tz;
  return tx(ctx.db, () => {
    const have = all(ctx.db, "SELECT id FROM blocks WHERE source='brief' AND revision_id=? AND state='active' AND end_at>?", `brief:${ob.key}`, ctx.now().toISOString());
    if (have.length && !o.blocks?.length) return { reserved: 0, already: have.length, blocks: all(ctx.db, "SELECT id,start_at,end_at,title FROM blocks WHERE source='brief' AND revision_id=? AND state='active' ORDER BY start_at", `brief:${ob.key}`).map((b) => ({ id: b.id as string, start: b.start_at as string, end: b.end_at as string, label: b.title as string })), note: "Already reserved on this computer. Nothing was added." };
    const fbs = feedback(ctx); const est = fbs.filter((f) => f.obligation_key === ob.key && f.kind === "estimate").pop(); const minutes = est ? Number(est.value) : defaultEstimate(`${ob.title} ${ob.requirements.map((r) => r.action).join(" ")}`).minutes;
    const pl = o.blocks?.length ? { blocks: o.blocks.map((b) => ({ start: b.start, end: b.end, minutes: Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60000), label: `Work on ${ob.title}`, step: "work" as const })) } : plan(ctx, ob, minutes, cov, ctx.now(), []);
    if (!pl.blocks.length) throw new HttpError(422, "There is no time to reserve that Jarvis can stand behind. Import a calendar that covers the days before the deadline, or correct the estimate.");
    const dueMs = Date.parse(ob.due!.at); const made: string[] = []; const existing: string[] = [];
    for (const b of pl.blocks) {
      const s = Date.parse(b.start), e = Date.parse(b.end); if (!(e > s) || e > dueMs) throw new HttpError(422, "A block ends after the deadline."); if (s < ctx.now().getTime() - 60000) throw new HttpError(422, "A block starts in the past.");
      if (!coveredOn(cov, localDate(new Date(s), tz)) || !coveredOn(cov, localDate(new Date(e - 1), tz))) throw new HttpError(422, "No calendar covers that day, so Jarvis cannot say it is free.");
      const idem = `brief:${ob.key}:${new Date(s).toISOString()}`; const dup = get(ctx.db, "SELECT id FROM blocks WHERE idempotency_key=?", idem); if (dup) { existing.push(dup.id as string); continue; }
      const hit = collides(ctx, new Date(s).toISOString(), new Date(e).toISOString()); if (hit) throw new HttpError(409, `That time now collides with ${hit.label ?? "something on your calendar"}. Rebuild the brief for a fresh proposal.`);
      const id = uid("blk"); run(ctx.db, "INSERT OR IGNORE INTO blocks(id,owner_id,start_at,end_at,tz,kind,title,task_id,decision_id,source,revision_id,idempotency_key,sync,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, ctx.owner, new Date(s).toISOString(), new Date(e).toISOString(), tz, "booked", b.label, null, null, "brief", `brief:${ob.key}`, idem, "local-only", ctx.now().toISOString()); made.push(id);
    }
    logActivity(ctx, "brief_reserve", ob.key, `Reserved ${made.length} local block(s) for ${ob.title}`);
    return { reserved: made.length, already: existing.length, blocks: all(ctx.db, "SELECT id,start_at,end_at,title FROM blocks WHERE source='brief' AND revision_id=? AND state='active' ORDER BY start_at", `brief:${ob.key}`).map((b) => ({ id: b.id as string, start: b.start_at as string, end: b.end_at as string, label: b.title as string })), note: "Reserved on this computer only. Nothing was added to any other calendar." };
  });
}
void getSetting; void setSetting; void dayOfWeek;
