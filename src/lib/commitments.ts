// Commitments: who owes whom. A reply is not a resolution.
import { Ctx, all, get, run, tx, uid } from "./db";
import { HttpError } from "./decisions";
import { fmtDateTime } from "./time";

export function createCommitment(ctx: Ctx, o: { who: string; owedTo: string; action: string; dueDate?: string | null; agreement?: string; threadId?: string; dedupe?: boolean }): string {
  if (o.dedupe) {
    const ex = get(ctx.db, "SELECT id FROM commitments WHERE owner_id=? AND who=? AND action=? AND COALESCE(due_date,'')=COALESCE(?, '')", ctx.owner, o.who, o.action, o.dueDate ?? null);
    if (ex) return ex.id as string;
  }
  const id = uid("cmt");
  const now = ctx.now().toISOString();
  run(ctx.db,
    "INSERT INTO commitments(id,owner_id,who,owed_to,action,agreement,due_date,thread_id,created_at,next_check_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    id, ctx.owner, o.who, o.owedTo, o.action, o.agreement ?? null, o.dueDate ?? null, o.threadId ?? null, now, o.dueDate ? `${o.dueDate}T12:00:00.000Z` : null);
  addEvent(ctx, id, "promise", `${o.who} to ${o.owedTo}: ${o.action}${o.dueDate ? ` by ${o.dueDate}` : ""}`);
  return id;
}

export function addEvent(ctx: Ctx, id: string, kind: string, text: string, key?: string): boolean {
  const r = run(ctx.db, "INSERT OR IGNORE INTO commitment_events(id,commitment_id,at,kind,text,idempotency_key) VALUES(?,?,?,?,?,?)", uid("ce"), id, ctx.now().toISOString(), kind, text, key ?? null);
  return Number(r.changes) > 0;
}

export function listCommitments(ctx: Ctx) {
  return all(ctx.db, "SELECT * FROM commitments WHERE owner_id=? ORDER BY CASE status WHEN 'resolved' THEN 1 ELSE 0 END, COALESCE(due_date,'9999')", ctx.owner)
    .map((c) => ({ ...c, events: all(ctx.db, "SELECT at,kind,text FROM commitment_events WHERE commitment_id=? ORDER BY at, rowid", c.id) }));
}

export function prepareFollowUp(ctx: Ctx, id: string) {
  const c = get(ctx.db, "SELECT * FROM commitments WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!c) throw new HttpError(404, "Commitment not found");
  const last = get(ctx.db, "SELECT text,at FROM commitment_events WHERE commitment_id=? AND kind IN ('reply','promise') ORDER BY at DESC, rowid DESC LIMIT 1", id);
  const text = `Hello,\n\nFollowing up on: ${c.action}. ${c.due_date ? `You mentioned an answer by ${c.due_date}. ` : ""}Could you confirm the current status and the expected date?\n\nThank you,\nYonathan`;
  addEvent(ctx, id, "draft", text, `draft:${id}:${last?.at ?? "none"}`);
  run(ctx.db, "UPDATE commitments SET delivery='draft' WHERE id=? AND delivery IN ('none','draft')", id);
  return { draft: text, objective: `Get a dated answer on: ${c.action}`, questions: ["What is the status today?", "What date can I expect a final answer?"], lastExchange: last ?? null, delivery: "draft", note: "Draft only. Nothing was sent." };
}

export type SimEvent = "send_ack" | "reply" | "correction";
export function simulateEvent(ctx: Ctx, id: string, kind: SimEvent) {
  return tx(ctx.db, () => {
    const c = get(ctx.db, "SELECT * FROM commitments WHERE id=? AND owner_id=?", id, ctx.owner);
    if (!c) throw new HttpError(404, "Commitment not found");
    if (c.status === "resolved") throw new HttpError(409, "Already resolved. Reopen first.");
    const now = ctx.now().toISOString();
    if (kind === "send_ack") {
      if (c.delivery !== "draft") throw new HttpError(422, "Nothing to send yet. Prepare a draft first.");
      addEvent(ctx, id, "send_ack", "Fixture event: mail server acknowledged delivery.", `ack:${id}`);
      run(ctx.db, "UPDATE commitments SET delivery='sent_ack', last_contact_at=? WHERE id=?", now, id);
    } else if (kind === "reply") {
      addEvent(ctx, id, "reply", "Fixture reply in the same thread: \"We received your request and are reviewing it.\"", `reply:${id}`);
      run(ctx.db, "UPDATE commitments SET status='reply_received', last_contact_at=?, next_check_at=? WHERE id=?", now, new Date(ctx.now().getTime() + 2 * 86400000).toISOString(), id);
    } else {
      addEvent(ctx, id, "correction", "Fixture correction: registrar record updated, transfer credits are 8, not 4.", `corr:${id}`);
      setRecord(ctx, "transfer_credits", "8 credits", `Correction in ${c.action}`);
    }
    return { ok: true };
  });
}

export function setRecord(ctx: Ctx, key: string, value: string, why: string) {
  const cur = get(ctx.db, "SELECT * FROM student_record WHERE key=?", key);
  const hist = cur ? JSON.parse(cur.history as string) : [];
  if (cur && cur.value === value) return;
  if (cur) hist.push({ value: cur.value, until: ctx.now().toISOString(), why });
  run(ctx.db, "INSERT INTO student_record(key,value,updated_at,history) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, history=excluded.history", key, value, ctx.now().toISOString(), JSON.stringify(hist));
}
export const studentRecord = (ctx: Ctx) => all(ctx.db, "SELECT * FROM student_record ORDER BY key").map((r) => ({ ...r, history: JSON.parse(r.history as string) }));

/** Resolution needs evidence. A reply alone never resolves. */
export function resolveCommitment(ctx: Ctx, id: string, evidence: string) {
  if (!evidence || evidence.trim().length < 5) throw new HttpError(422, "Add the evidence that the issue is resolved. A reply alone does not resolve it.");
  return tx(ctx.db, () => {
    const c = get(ctx.db, "SELECT * FROM commitments WHERE id=? AND owner_id=?", id, ctx.owner);
    if (!c) throw new HttpError(404, "Commitment not found");
    run(ctx.db, "UPDATE commitments SET status='resolved', resolution_evidence=? WHERE id=?", evidence.trim(), id);
    addEvent(ctx, id, "resolved", `Resolved with evidence: ${evidence.trim()}`);
    return { ok: true };
  });
}
export function reopenCommitment(ctx: Ctx, id: string) {
  run(ctx.db, "UPDATE commitments SET status='open', resolution_evidence=NULL WHERE id=? AND owner_id=?", id, ctx.owner);
  addEvent(ctx, id, "reopened", "Reopened");
}

/** Promises found in imported email text. Jarvis proposes. You accept. */
export function findPromises(text: string): { action: string; due: string | null; quote: string }[] {
  const out: { action: string; due: string | null; quote: string }[] = [];
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    const m = /\b(?:we|i)(?:'ll| will)\s+(respond|reply|get back to you|answer|send|follow up|review|decide)\b([^.]*?)(?:\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\w+ \d{1,2}))?[.!]?$/i.exec(s.trim());
    if (m) out.push({ action: `${m[1]} ${m[2]}`.trim().replace(/\s+/g, " "), due: m[3] ?? null, quote: s.trim() });
  }
  return out;
}
export { fmtDateTime };
