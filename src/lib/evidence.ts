// Evidence: authorized sources, their items (with stable ids and revisions), and individually searchable facts that each point at a quote.
// Deterministic first: no model call is made to ingest, extract or search. Retrieved text is source material, never instructions.
import crypto from "node:crypto";
import { Ctx, all, get, run, tx, uid, sha, logActivity, getSetting } from "./db";
import { HttpError } from "./decisions";
import { findDates, splitSentences } from "./extract";
import { addDays, localDate } from "./time";

export const SOURCE_KINDS = ["email", "transcript", "claude", "notice", "note", "calendar", "slack", "web", "export", "portal"] as const;
export type SourceMode = "live" | "imported" | "fixture" | "simulated" | "unavailable";
export const MODE_LABEL: Record<SourceMode, string> = { live: "Live", imported: "Imported by you", fixture: "Fixture (synthetic)", simulated: "Simulated", unavailable: "Unavailable" };

export interface SourceRow { id: string; kind: string; label: string; mode: SourceMode; projectId: string | null; state: string; localOnly: boolean; shareable: boolean; cursor: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null; message: string | null; revokedAt: string | null }
const srcRow = (r: any): SourceRow => ({ id: r.id, kind: r.kind, label: r.label, mode: r.mode, projectId: r.project_id, state: r.state, localOnly: !!r.local_only, shareable: !!r.shareable, cursor: r.cursor, lastAttemptAt: r.last_attempt_at, lastSuccessAt: r.last_success_at, message: r.message, revokedAt: r.revoked_at });

export function registerSource(ctx: Ctx, o: { kind: string; label: string; mode: SourceMode; projectId?: string | null; localOnly?: boolean; shareable?: boolean; state?: string; message?: string }): SourceRow {
  const ex = get(ctx.db, "SELECT * FROM evidence_sources WHERE owner_id=? AND kind=? AND label=?", ctx.owner, o.kind, o.label);
  if (ex) return srcRow(ex);
  const id = `src_${sha(`${ctx.owner}|${o.kind}|${o.label}`).slice(0, 10)}`;
  run(ctx.db, "INSERT INTO evidence_sources(id,owner_id,kind,label,mode,project_id,state,local_only,message,created_at,shareable) VALUES(?,?,?,?,?,?,?,?,?,?,?)", id, ctx.owner, o.kind, o.label, o.mode, o.projectId ?? null, o.state ?? "ok", o.localOnly ? 1 : 0, o.message ?? null, ctx.now().toISOString(), o.shareable ? 1 : 0);
  return srcRow(get(ctx.db, "SELECT * FROM evidence_sources WHERE id=?", id)!);
}
export const listSources = (ctx: Ctx) => all(ctx.db, "SELECT s.*, (SELECT COUNT(*) FROM evidence_items i WHERE i.source_id=s.id AND i.tombstone=0) n FROM evidence_sources s WHERE s.owner_id=? ORDER BY s.created_at", ctx.owner).map((r) => ({ ...srcRow(r), items: r.n as number }));
export function markSource(ctx: Ctx, id: string, p: { state?: string; message?: string | null; attempt?: boolean; success?: boolean; cursor?: string | null }) {
  const now = ctx.now().toISOString();
  run(ctx.db, "UPDATE evidence_sources SET state=COALESCE(?,state), message=?, last_attempt_at=CASE WHEN ? THEN ? ELSE last_attempt_at END, last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END, cursor=COALESCE(?,cursor) WHERE id=? AND owner_id=?",
    p.state ?? null, p.message === undefined ? (get(ctx.db, "SELECT message FROM evidence_sources WHERE id=?", id)?.message ?? null) : p.message, p.attempt ? 1 : 0, now, p.success ? 1 : 0, now, p.cursor ?? null, id, ctx.owner);
}

// ---------- deterministic extraction ----------
const STOP = new Set("a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its just let me my of on or our she so than that the their them then there these they this to us was we were what when where which who why will with would you your yes no not ok okay also very about over after before again still more some any all one two see get got make made need want like going know think said say says send sent write wrote draft pick left off where".split(" "));
const DATE_WORDS = new Set("monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec today tomorrow week next".split(" "));
export const tokens = (s: string) => [...new Set((s.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).map((t) => t.replace(/'s$/, "")).filter((t) => t.length > 2 && !STOP.has(t) && !DATE_WORDS.has(t) && !/^\d+$/.test(t)))];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const CONFIRM = /\b(confirm(?:ed|ing|s)|agreed?|decided|we'?ll go with|locked in|settled|final(?:ly)?|moved to|changed to|moving (?:it )?to|instead|works for (?:me|us|everyone)|see you|sounds good|let'?s do|go(?:ing)? with|booked)\b/i;
const PROPOSE = /\b(propos\w*|suggest\w*|how about|what about|could we|maybe|perhaps|tentativ\w*|i'?d say|thinking|let'?s|would .* work)\b/i;
const REASON = /\b(because|since|so that|in order to|due to|as the|given that|that way|the reason)\b/i;
const MONEY = /(?:[$€£]\s?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?[kKmM]\b)?)|(?:\b(?:EUR|USD|GBP|CAD|AUD)\s?\d(?:[\d,]*\d)?(?:\.\d+)?)|(?:\b\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:EUR|USD|GBP|CAD|AUD)\b)/g;
const PCT = /\b\d+(?:\.\d+)?\s?%/g;
const COUNT = /\b\d+\s+(?:pilots?|customers?|users?|students?|people|clubs?|seats?|weeks?|hours?|slides?|sponsors?|members?|teams?|nights?|days?|months?|guests?|rooms?|tickets?|units?|pages?|miles?|attendees?)\b/gi;

export interface RawFact { kind: string; subject: string; text: string; value: string | null; who: string | null; quote: string; start: number; end: number; stamp: string | null; status: "confirmed" | "proposed"; why: string | null }

/** Lines like "Dana: text" or "[00:12] Dana: text" are speaker turns. Anything else is attributed to the author. */
export function extractFacts(body: string, at: string, author: string | null, ownerName: string): RawFact[] {
  const out: RawFact[] = []; let cursor = 0;
  const lines = body.split("\n");
  let prevDecision = null as RawFact | null;
  for (const line of lines) {
    const lineStart = cursor; cursor += line.length + 1;
    const m = /^\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([A-Z][\w .'-]{0,30}?):\s+(.*)$/.exec(line);
    const stamp = m?.[1] ?? null; const speaker = (m ? m[2] : author)?.trim() ?? null; const text = m ? m[3] : line;
    const textStart = lineStart + (m ? line.length - text.length : 0);
    let sCursor = 0;
    for (const sent of splitSentences(text)) {
      const idx = text.indexOf(sent, sCursor); if (idx < 0) continue; sCursor = idx + sent.length;
      const start = textStart + idx, end = start + sent.length; const sub = tokens(sent).slice(0, 8).join(" ");
      const who = speaker && new RegExp(`^${ownerName}\\b`, "i").test(speaker) ? ownerName : speaker;
      const dates: { v: string; text: string }[] = findDates(sent, at).map((d) => ({ v: d.localDate, text: d.text }));
      for (const w of WEEKDAYS) { const wm = new RegExp(`\\b${w}\\b`, "i").exec(sent); if (wm && !dates.some((d) => d.text.toLowerCase().includes(w))) { const base = localDate(at); let d = base; for (let i = 1; i <= 7; i++) { d = addDays(base, i); if (new Date(`${d}T12:00:00Z`).getUTCDay() === WEEKDAYS.indexOf(w)) break; } dates.push({ v: d, text: wm[0] }); } }
      const cue: "confirmed" | "proposed" = CONFIRM.test(sent) && !PROPOSE.test(sent) ? "confirmed" : CONFIRM.test(sent) && /\b(confirm|agreed|decided|moved|instead|final)\w*/i.test(sent) ? "confirmed" : "proposed";
      const reasonHere = REASON.test(sent) ? sent : null;
      for (const d of dates) {
        // "moved from Monday to Wednesday": the date after "from" (or "instead of") is the old one, not the decision.
        const at0 = sent.toLowerCase().indexOf(d.text.toLowerCase()); const before = at0 > 0 ? sent.slice(Math.max(0, at0 - 24), at0) : "";
        const old = /(?:\bfrom|instead of|rather than|not)\s+$/i.test(before);
        const f: RawFact = { kind: "date", subject: sub, text: sent, value: d.v, who, quote: sent, start, end, stamp, status: old ? "proposed" : cue, why: reasonHere }; out.push(f); if (!old) prevDecision = f;
      }
      if (!dates.length && (CONFIRM.test(sent) || PROPOSE.test(sent))) { const f: RawFact = { kind: cue === "confirmed" ? "decision" : "proposal", subject: sub, text: sent, value: null, who, quote: sent, start, end, stamp, status: cue, why: reasonHere }; out.push(f); prevDecision = f; }
      if (!reasonHere && prevDecision && /^(?:the reason|that way|this way|reason is|it'?s because)/i.test(sent)) prevDecision.why = prevDecision.why ?? sent;
      // commitments: "I'll send", "Dana will", "I owe"
      const cm = /\b(?:(I)'?(?:ll| will)|I'?m going to|((?:[A-ZÀ-Ý][\wÀ-ÿ'-]*(?:\s(?:de|van|der|den|von|di|da|al|el|le|la|du|bin))*(?:\s&)?\s){0,2}[A-ZÀ-Ý][\wÀ-ÿ'-]*)\s+(?:will|to)\b|I owe)\s+([^.!?]{3,120})/.exec(sent);
      if (cm && !/^(be|have|see|think|say|try|go with|let)\b/i.test(cm[3].trim())) {
        const PRON = /^(We|They|You|It|He|She|This|That|There|Who|What)$/i;
        const named = cm[2] && !PRON.test(cm[2].trim()) ? cm[2].trim() : null;
        const first = !!cm[1] || /^I /.test(cm[0]);
        const owner = named ?? who;
        out.push({ kind: "commitment", subject: sub, text: sent, value: /\b(by|before|due|until|no later than|deadline)\b/i.test(sent) ? (dates[0]?.v ?? null) : null, who: first && speaker && new RegExp(`^${ownerName}\\b`, "i").test(speaker) ? ownerName : owner, quote: sent, start, end, stamp, status: "confirmed", why: null });
      }
      for (const re of [MONEY, PCT, COUNT]) { re.lastIndex = 0; let fm: RegExpExecArray | null; while ((fm = re.exec(sent))) out.push({ kind: "figure", subject: sub, text: sent, value: fm[0].trim(), who, quote: sent, start, end, stamp, status: "confirmed", why: null }); }
      const cmd = /`([^`]{3,200})`/.exec(sent); if (cmd) out.push({ kind: "command", subject: sub, text: sent, value: cmd[1], who, quote: sent, start, end, stamp, status: "confirmed", why: null });
      if (/\b(error|exception|failed|failure|traceback)\b[: ]/i.test(sent)) out.push({ kind: "error", subject: sub, text: sent, value: null, who, quote: sent, start, end, stamp, status: "confirmed", why: null });
    }
  }
  return out;
}

// ---------- ingest ----------
export interface ItemInput { sourceId: string; externalId: string; kind: string; title: string; author?: string | null; participants?: string[]; at: string; body: string; projectId?: string | null; corrects?: string | null }
export const ownerName = (ctx: Ctx): string => getSetting<string>(ctx.db, "owner_name", "Yonathan");

function ftsPutItem(ctx: Ctx, id: string, title: string, body: string) { run(ctx.db, "DELETE FROM evidence_fts WHERE ref=?", `item:${id}`); run(ctx.db, "INSERT INTO evidence_fts(ref,owner,title,body) VALUES(?,?,?,?)", `item:${id}`, ctx.owner, title, body); }
function dropFts(ctx: Ctx, itemId: string) { run(ctx.db, "DELETE FROM evidence_fts WHERE ref=?", `item:${itemId}`); for (const f of all(ctx.db, "SELECT id FROM evidence_facts WHERE item_id=?", itemId)) run(ctx.db, "DELETE FROM evidence_fts WHERE ref=?", `fact:${f.id}`); }

function indexItem(ctx: Ctx, itemId: string) {
  const it = get(ctx.db, "SELECT * FROM evidence_items WHERE id=?", itemId)!;
  dropFts(ctx, itemId); run(ctx.db, "DELETE FROM evidence_facts WHERE item_id=?", itemId);
  const now = ctx.now().toISOString(); const facts = extractFacts(it.body as string, it.at as string, it.author as string | null, ownerName(ctx));
  ftsPutItem(ctx, itemId, it.title as string, it.body as string);
  for (const f of facts) {
    const id = uid("fct");
    run(ctx.db, `INSERT INTO evidence_facts(id,owner_id,item_id,item_revision,kind,subject,text,value,who,quote,start,"end",stamp,effective_at,status,why,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, ctx.owner, itemId, it.revision, f.kind, f.subject, f.text, f.value, f.who, f.quote, f.start, f.end, f.stamp, it.at, f.status, f.why, now);
    run(ctx.db, "INSERT INTO evidence_fts(ref,owner,title,body) VALUES(?,?,?,?)", `fact:${id}`, ctx.owner, it.title as string, `${f.text} ${f.value ?? ""}`);
  }
  const first = splitSentences(String(it.body)).slice(0, 2).join(" ").slice(0, 280);
  run(ctx.db, "UPDATE evidence_items SET summary=? WHERE id=?", first, itemId);
}

/** Idempotent. Same content is a no-op, changed content becomes a new revision whose facts replace the old ones. */
export function ingestItem(ctx: Ctx, i: ItemInput): { id: string; created: boolean; revised: boolean; unchanged: boolean; revision: number } {
  const src = get(ctx.db, "SELECT * FROM evidence_sources WHERE id=? AND owner_id=?", i.sourceId, ctx.owner);
  if (!src) throw new HttpError(404, "Unknown source");
  if (src.revoked_at) throw new HttpError(409, "That source was revoked. Authorize it again before importing.");
  if (!i.body.trim()) throw new HttpError(422, "Nothing to import: the text is empty.");
  if (i.body.length > 200_000) throw new HttpError(413, "That is too large to import as one item.");
  return tx(ctx.db, () => {
    const bodySha = sha(i.body); const now = ctx.now().toISOString();
    const ex = get(ctx.db, "SELECT * FROM evidence_items WHERE owner_id=? AND source_id=? AND external_id=?", ctx.owner, i.sourceId, i.externalId);
    if (ex && ex.body_sha === bodySha && !ex.tombstone) { markSource(ctx, i.sourceId, { attempt: true, success: true }); return { id: ex.id as string, created: false, revised: false, unchanged: true, revision: ex.revision as number }; }
    let id: string; let revision = 1;
    if (ex) { id = ex.id as string; revision = (ex.revision as number) + 1; run(ctx.db, "UPDATE evidence_items SET revision=?, kind=?, title=?, author=?, participants=?, at=?, body=?, body_sha=?, project_id=?, tombstone=0, updated_at=? WHERE id=?", revision, i.kind, i.title, i.author ?? null, JSON.stringify(i.participants ?? []), i.at, i.body, bodySha, i.projectId ?? ex.project_id ?? null, now, id); }
    else { id = `ev_${sha(`${ctx.owner}|${i.sourceId}|${i.externalId}`).slice(0, 12)}`; run(ctx.db, "INSERT INTO evidence_items(id,owner_id,source_id,external_id,revision,kind,title,author,participants,at,body,body_sha,project_id,created_at,updated_at,corrects) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, ctx.owner, i.sourceId, i.externalId, 1, i.kind, i.title, i.author ?? null, JSON.stringify(i.participants ?? []), i.at, i.body, bodySha, i.projectId ?? src.project_id ?? null, now, now, i.corrects ?? null); }
    run(ctx.db, "INSERT OR REPLACE INTO evidence_revisions(item_id,revision,body,at) VALUES(?,?,?,?)", id, revision, i.body, now);
    indexItem(ctx, id); reconcile(ctx, (get(ctx.db, "SELECT project_id FROM evidence_items WHERE id=?", id)!.project_id as string | null)); applyCorrections(ctx);
    markSource(ctx, i.sourceId, { attempt: true, success: true, state: src.state === "needs_signin" ? "needs_signin" : "ok" });
    if (ex) invalidateResultsCiting(ctx, [id], `A source it cites (“${i.title}”) changed to revision ${revision}.`, revision);
    return { id, created: !ex, revised: !!ex, unchanged: false, revision };
  });
}

/** A later, explicit confirmation of a different date on the same topic supersedes an earlier proposal or decision. Older facts are kept, labelled. */
export function reconcile(ctx: Ctx, projectId: string | null) {
  const facts = all(ctx.db, `SELECT f.*, i.title it_title, i.at it_at, i.project_id pid FROM evidence_facts f JOIN evidence_items i ON i.id=f.item_id JOIN evidence_sources s ON s.id=i.source_id
    WHERE f.owner_id=? AND f.kind='date' AND i.tombstone=0 AND s.revoked_at IS NULL AND ${projectId ? "i.project_id=?" : "i.project_id IS NULL"} ORDER BY i.at, f.start`, ...(projectId ? [ctx.owner, projectId] : [ctx.owner]));
  // Superseded is a link, never an overwrite of what the source said. Recompute the links from scratch so revoking a source restores what it had replaced.
  for (const a of facts) run(ctx.db, "UPDATE evidence_facts SET superseded_by=NULL WHERE id=?", a.id);
  const fresh = all(ctx.db, `SELECT f.*, i.title it_title, i.at it_at FROM evidence_facts f JOIN evidence_items i ON i.id=f.item_id JOIN evidence_sources s ON s.id=i.source_id WHERE f.owner_id=? AND f.kind='date' AND i.tombstone=0 AND s.revoked_at IS NULL AND ${projectId ? "i.project_id=?" : "i.project_id IS NULL"} ORDER BY i.at, f.start`, ...(projectId ? [ctx.owner, projectId] : [ctx.owner]));
  for (let x = 0; x < fresh.length; x++) for (let y = x + 1; y < fresh.length; y++) {
    const a = fresh[x], b = fresh[y];
    if (a.value === b.value || b.status !== "confirmed" || a.superseded_by) continue;
    if (String(b.it_at) <= String(a.it_at) && a.item_id !== b.item_id) continue;
    const ta = new Set([...tokens(String(a.subject)), ...tokens(String(a.it_title))]); const shared = [...new Set([...tokens(String(b.subject)), ...tokens(String(b.it_title))])].filter((t) => ta.has(t));
    if (shared.length >= 2) { run(ctx.db, "UPDATE evidence_facts SET superseded_by=? WHERE id=?", b.id, a.id); a.superseded_by = b.id; }
  }
}

/** An item the owner marked as a correction of another replaces that item's dates. The original wording stays, labelled superseded. */
function applyCorrections(ctx: Ctx) {
  for (const c of all(ctx.db, "SELECT i.id, i.corrects FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.owner_id=? AND i.corrects IS NOT NULL AND i.tombstone=0 AND s.revoked_at IS NULL", ctx.owner)) {
    const mine = all(ctx.db, "SELECT id FROM evidence_facts WHERE item_id=? AND kind='date' ORDER BY start DESC", c.id); if (!mine.length) continue;
    for (const o of all(ctx.db, "SELECT id FROM evidence_facts WHERE item_id=? AND kind='date'", c.corrects)) run(ctx.db, "UPDATE evidence_facts SET superseded_by=? WHERE id=?", mine[0].id, o.id);
  }
}
export function revokeSource(ctx: Ctx, id: string) {
  const s = get(ctx.db, "SELECT label FROM evidence_sources WHERE id=? AND owner_id=?", id, ctx.owner); if (!s) throw new HttpError(404, "Source not found");
  tx(ctx.db, () => {
    run(ctx.db, "UPDATE evidence_sources SET revoked_at=COALESCE(revoked_at,?), state='revoked', message='You revoked access. Nothing from this source is read or searched.' WHERE id=?", ctx.now().toISOString(), id);
    const ids = all(ctx.db, "SELECT id FROM evidence_items WHERE source_id=?", id).map((r) => r.id as string);
    for (const it of ids) dropFts(ctx, it);
    invalidateResultsCiting(ctx, ids, `The source “${s.label}” was revoked.`);
    for (const pid of new Set(all(ctx.db, "SELECT DISTINCT project_id p FROM evidence_items WHERE source_id=?", id).map((r) => r.p as string | null))) reconcile(ctx, pid);
    logActivity(ctx, "source_revoked", id, `Revoked source: ${s.label}`);
  });
  return { ok: true };
}
export function reauthorizeSource(ctx: Ctx, id: string) {
  tx(ctx.db, () => {
    run(ctx.db, "UPDATE evidence_sources SET revoked_at=NULL, state='ok', message=NULL WHERE id=? AND owner_id=?", id, ctx.owner);
    for (const r of all(ctx.db, "SELECT id FROM evidence_items WHERE source_id=? AND tombstone=0", id)) indexItem(ctx, r.id as string);
    for (const pid of new Set(all(ctx.db, "SELECT DISTINCT project_id p FROM evidence_items WHERE source_id=?", id).map((r) => r.p as string | null))) reconcile(ctx, pid);
  });
  return { ok: true };
}
/** Forget one item: the text, its facts, its summary and every search path are erased; results that cited it are flagged. */
export function forgetItem(ctx: Ctx, id: string) {
  const it = get(ctx.db, "SELECT title FROM evidence_items WHERE id=? AND owner_id=?", id, ctx.owner); if (!it) throw new HttpError(404, "Item not found");
  tx(ctx.db, () => {
    dropFts(ctx, id); run(ctx.db, "DELETE FROM evidence_facts WHERE item_id=?", id); run(ctx.db, "DELETE FROM evidence_revisions WHERE item_id=?", id);
    run(ctx.db, "UPDATE evidence_items SET tombstone=1, title='(forgotten)', body='', summary=NULL, author=NULL, participants='[]', updated_at=? WHERE id=?", ctx.now().toISOString(), id);
    invalidateResultsCiting(ctx, [id], "A source it cited was forgotten.");
  });
  return { ok: true };
}
function invalidateResultsCiting(ctx: Ctx, itemIds: string[], reason: string, newRevision?: number) {
  if (!itemIds.length) return;
  for (const v of all(ctx.db, "SELECT rv.result_id, rv.version, rv.sources FROM result_versions rv JOIN results r ON r.id=rv.result_id WHERE r.owner_id=? AND rv.stale IS NULL", ctx.owner)) {
    const srcs = JSON.parse(v.sources as string) as { itemId: string; revision: number }[];
    if (srcs.some((s) => itemIds.includes(s.itemId) && (newRevision === undefined || s.revision < newRevision))) { run(ctx.db, "UPDATE result_versions SET stale=? WHERE result_id=? AND version=?", reason, v.result_id, v.version); run(ctx.db, "UPDATE results SET state='stale', updated_at=? WHERE id=?", ctx.now().toISOString(), v.result_id); }
  }
}

// ---------- retrieval ----------
export interface Hit { itemId: string; title: string; kind: string; sourceId: string; sourceLabel: string; mode: SourceMode; at: string; revision: number; score: number; facts: any[]; excerpt: string; projectId: string | null; participants: string[]; author: string | null }
const ftsQuery = (terms: string[]) => terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" OR ");

/** BM25 over titles, summaries, facts and text. Owner, project, revocation and tombstones are enforced here, before anything is returned. */
export function searchEvidence(ctx: Ctx, terms: string[], o: { projectId?: string | null; limit?: number; kinds?: string[]; sinceIso?: string } = {}): Hit[] {
  const ts = terms.map((t) => t.toLowerCase()).filter((t) => t.length > 1); if (!ts.length) return [];
  const rows = all(ctx.db, "SELECT ref, bm25(evidence_fts, 5.0, 1.0) rank FROM evidence_fts WHERE evidence_fts MATCH ? AND owner=? ORDER BY rank LIMIT 80", ftsQuery(ts), ctx.owner);
  const byItem = new Map<string, { score: number; factIds: string[] }>();
  for (const r of rows) {
    const [kind, id] = String(r.ref).split(":"); let itemId = id; let factId: string | null = null;
    if (kind === "fact") { const f = get(ctx.db, "SELECT item_id FROM evidence_facts WHERE id=? AND owner_id=?", id, ctx.owner); if (!f) continue; itemId = f.item_id as string; factId = id; }
    const e = byItem.get(itemId) ?? { score: 0, factIds: [] }; e.score += -(r.rank as number) * (kind === "item" ? 1 : 0.6); if (factId) e.factIds.push(factId); byItem.set(itemId, e);
  }
  const hits: Hit[] = [];
  for (const [itemId, e] of byItem) {
    const it = get(ctx.db, "SELECT i.*, s.label slabel, s.mode smode, s.revoked_at srev, s.local_only FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.id=? AND i.owner_id=?", itemId, ctx.owner);
    if (!it || it.tombstone || it.srev) continue;
    if (o.projectId !== undefined && o.projectId !== null && it.project_id && it.project_id !== o.projectId) continue;     // another project's material is never pulled in
    if (o.kinds && !o.kinds.includes(it.kind as string)) continue; if (o.sinceIso && String(it.at) < o.sinceIso) continue;
    const facts = all(ctx.db, "SELECT * FROM evidence_facts WHERE item_id=? ORDER BY start", itemId);
    const hitFacts = facts.filter((f) => e.factIds.includes(f.id as string)); const focus = hitFacts[0] ?? facts.find((f) => ts.some((t) => String(f.text).toLowerCase().includes(t)));
    const titleBoost = ts.filter((t) => String(it.title).toLowerCase().includes(t)).length * 2;
    hits.push({ itemId, title: it.title as string, kind: it.kind as string, sourceId: it.source_id as string, sourceLabel: it.slabel as string, mode: it.smode as SourceMode, at: it.at as string, revision: it.revision as number, score: e.score + titleBoost, facts: facts.map(factOut), excerpt: focus ? excerptAround(it.body as string, focus.start as number, focus.end as number) : String(it.summary ?? it.body).slice(0, 220), projectId: it.project_id as string | null, participants: JSON.parse(it.participants as string), author: it.author as string | null });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, o.limit ?? 8);
}
export const factOut = (f: any) => ({ id: f.id as string, kind: f.kind as string, text: f.text as string, value: f.value as string | null, who: f.who as string | null, quote: f.quote as string, start: f.start as number, end: f.end as number, stamp: f.stamp as string | null, status: (f.superseded_by ? "superseded" : f.status) as string, supersededBy: f.superseded_by as string | null, why: f.why as string | null, itemId: f.item_id as string });
export function excerptAround(body: string, start: number, end: number, pad = 90) { const a = Math.max(0, start - pad), b = Math.min(body.length, end + pad); return `${a > 0 ? "…" : ""}${body.slice(a, b).trim()}${b < body.length ? "…" : ""}`; }

export function getItem(ctx: Ctx, id: string) {
  const it = get(ctx.db, "SELECT i.*, s.label slabel, s.mode smode, s.revoked_at srev, s.kind skind FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.id=? AND i.owner_id=?", id, ctx.owner);
  if (!it) return null; if (it.tombstone) return { id, forgotten: true as const };
  if (it.srev) return { id, revoked: true as const, title: it.title as string, sourceLabel: it.slabel as string };
  return { id, forgotten: false as const, revoked: false as const, title: it.title as string, kind: it.kind as string, author: it.author as string | null, participants: JSON.parse(it.participants as string) as string[], at: it.at as string, body: it.body as string, revision: it.revision as number, sourceId: it.source_id as string, sourceLabel: it.slabel as string, mode: it.smode as SourceMode, projectId: it.project_id as string | null, corrects: (it.corrects as string | null) ?? null, facts: all(ctx.db, "SELECT * FROM evidence_facts WHERE item_id=? ORDER BY start", id).map(factOut) };
}
export const listItems = (ctx: Ctx, o: { projectId?: string; kind?: string } = {}) => all(ctx.db, `SELECT i.id, i.title, i.kind, i.at, i.revision, i.project_id, s.label slabel, s.mode smode FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.owner_id=? AND i.tombstone=0 AND s.revoked_at IS NULL ${o.projectId ? "AND i.project_id=?" : ""} ${o.kind ? "AND i.kind=?" : ""} ORDER BY i.at DESC LIMIT 100`, ...[ctx.owner, ...(o.projectId ? [o.projectId] : []), ...(o.kind ? [o.kind] : [])]);

/** Paste, export or file import. The user chose it, so it is labelled imported. */
export function importText(ctx: Ctx, o: { kind: string; title: string; text: string; at?: string; author?: string; participants?: string[]; projectId?: string | null; label?: string; externalId?: string; corrects?: string | null; localOnly?: boolean; shareable?: boolean }) {
  if (o.shareable && o.localOnly) throw new HttpError(400, "A source cannot be both local-only and shareable with Claude");
  const src = registerSource(ctx, { kind: o.kind, label: o.label ?? (o.shareable ? `Shareable ${o.kind} (Claude may read these)` : `Imported ${o.kind}`), mode: "imported", projectId: o.projectId ?? null, localOnly: o.localOnly, shareable: !!o.shareable });
  const r = ingestItem(ctx, { sourceId: src.id, externalId: o.externalId ?? sha(o.title + o.text).slice(0, 16), kind: o.kind, title: o.title, author: o.author ?? null, participants: o.participants, at: o.at ?? ctx.now().toISOString(), body: o.text, projectId: o.projectId ?? null, corrects: o.corrects ?? null });
  return { ...r, sourceId: src.id };
}
export const hash8 = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);

/** Authorized items linked to the given ones by a correction, in either direction, followed until nothing new turns up. */
export function linkedCorrections(ctx: Ctx, ids: string[]): { id: string; why: string }[] {
  const out: { id: string; why: string }[] = []; const seen = new Set(ids); let frontier = [...ids];
  for (let round = 0; round < 6 && frontier.length; round++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const r of all(ctx.db, "SELECT i.id, i.title FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.owner_id=? AND i.corrects=? AND i.tombstone=0 AND s.revoked_at IS NULL", ctx.owner, id)) if (!seen.has(r.id as string)) { seen.add(r.id as string); next.push(r.id as string); out.push({ id: r.id as string, why: `your later correction “${r.title}”` }); }
      const me = get(ctx.db, "SELECT corrects FROM evidence_items WHERE id=? AND owner_id=?", id, ctx.owner);
      if (me?.corrects) { const o = get(ctx.db, "SELECT i.id, i.title FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.id=? AND i.owner_id=? AND i.tombstone=0 AND s.revoked_at IS NULL", me.corrects, ctx.owner); if (o && !seen.has(o.id as string)) { seen.add(o.id as string); next.push(o.id as string); out.push({ id: o.id as string, why: `the note “${o.title}” that this corrects` }); } }
    }
    frontier = next;
  }
  return out;
}

/** A later correction to a note, kept in the same source as the original so it has the same privacy. The original stays, labelled superseded where the correction restates a date. */
export function addCorrection(ctx: Ctx, itemId: string, text: string, at?: string) {
  const it = get(ctx.db, "SELECT i.*, s.revoked_at srev FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.id=? AND i.owner_id=?", itemId, ctx.owner);
  if (!it || it.tombstone) throw new HttpError(404, "Note not found"); if (it.srev) throw new HttpError(409, "That note's source was revoked."); if (it.kind === "calendar") throw new HttpError(422, "A calendar event is changed in the calendar, not here.");
  if (!text.trim() || text.length > 20000) throw new HttpError(422, "Write what changed.");
  const when = at ?? ctx.now().toISOString(); const title = String(it.title).startsWith("Correction to ") ? String(it.title) : `Correction to ${it.title}`;
  const r = ingestItem(ctx, { sourceId: it.source_id as string, externalId: sha(`correction|${itemId}|${text}`).slice(0, 16), kind: it.kind as string, title, at: when, body: text.trim(), projectId: it.project_id as string | null, corrects: itemId });
  return { ...r, correctsId: itemId };
}
