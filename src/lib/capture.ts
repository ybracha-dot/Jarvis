// Capture: "Remember for Jarvis: ..." from ordinary Claude, a pasted note, an import or a connector. One handler for every route.
// Idempotent by a stable dedup key. Saves the commitment immediately, then wakes the supervisor. Incoming content never authorizes an outbound action.
import { z } from "zod";
import { findProject } from "./projects";
import { Ctx, all, get, run, tx, uid, sha } from "./db";
import { HttpError } from "./decisions";
import { createCommitment } from "./commitments";
import { createNote } from "./memory";
import { enqueueJob, cancelJob } from "./jobs";
import { recordSourceStatus } from "./ingest";
import { resolveWeekday, findDates } from "./extract";
import { localDate } from "./time";

export const SOURCE_KINDS = ["claude-chat", "claude-project", "claude-export", "paste", "mcp", "gmail", "whatsapp-business", "whatsapp-forward", "apple-messages-forward", "import"] as const;
export const SOURCE_LABELS: Record<string, string> = {
  "claude-chat": "Ordinary Claude chat (explicit 'Remember for Jarvis')", "claude-project": "Claude Project (opted in)", "claude-export": "Claude conversation export (selected)", paste: "Pasted into Jarvis",
  mcp: "Connector (save_to_jarvis)", gmail: "Gmail (selected labels)", "whatsapp-business": "WhatsApp Business webhook", "whatsapp-forward": "WhatsApp (forwarded by you)", "apple-messages-forward": "Apple Messages (forwarded by you)", import: "File import",
};

export const CaptureInput = z.object({
  text: z.string().trim().min(3).max(4000), sourceKind: z.enum(SOURCE_KINDS).default("paste"), sourceLabel: z.string().max(120).optional(), delivery: z.string().max(80).optional(),
  course: z.string().max(60).optional(), project: z.string().max(80).optional(), sourceRef: z.string().max(300).optional(), dedupKey: z.string().max(200).optional(),
  synthetic: z.boolean().default(false), via: z.string().max(40).default("app"),
});
export type CaptureInput = z.input<typeof CaptureInput>;

const NUM: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const WD = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const stripTrigger = (t: string) => t.replace(/^\s*(?:please\s+)?remember(?:\s+for\s+jarvis)?\s*[:,-]?\s*/i, "").trim();

export interface Parsed { kind: "commitment" | "note"; who?: string; owedTo?: string; action?: string; dueDate?: string | null; dueText?: string | null; effortMinutes?: number; body: string }

export function parseCapture(text: string, publishedAt: string): Parsed {
  const body = stripTrigger(text);
  const due = (s: string): string | null => {
    const wd = new RegExp(`\\b(${WD})\\b`, "i").exec(s); if (wd) return resolveWeekday(wd[1], publishedAt);
    const d = findDates(s, publishedAt)[0]; return d ? d.localDate : null;
  };
  let m = /\bI owe\s+(?:the\s+)?((?:[\w&-]+\s+){0,2}(?:team|group|club|committee|board)|(?:[A-Z][\w&-]*)(?:\s+[A-Z][\w&-]*)*|\w+)\s+(.+?)\s+by\s+(.+?)[.!]?$/.exec(body);
  if (m) {
    const action = m[2].trim();
    const n = NUM[action.split(/\s+/)[0].toLowerCase()] ?? Number(action.split(/\s+/)[0]) ?? 0;
    return { kind: "commitment", who: "Yonathan", owedTo: m[1].trim(), action, dueDate: due(m[3]), dueText: m[3].trim(), effortMinutes: Number.isFinite(n) && n > 0 ? Math.min(n * 30, 480) : 60, body };
  }
  m = /^(.+?)\s+(?:owes|will send|promised)\s+me\s+(.+?)\s+by\s+(.+?)[.!]?$/i.exec(body);
  if (m) return { kind: "commitment", who: m[1].trim(), owedTo: "Yonathan", action: m[2].trim(), dueDate: due(m[3]), dueText: m[3].trim(), body };
  return { kind: "note", body };
}

export const deepLinkBase = () => (process.env.JARVIS_PUBLIC_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

export function captureReceipt(ctx: Ctx, id: string) {
  const c = get(ctx.db, "SELECT * FROM captures WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!c) return null;
  const link = c.commitment_id ? `/tasks?tab=followups&focus=${c.commitment_id}` : `/office?capture=${c.id}`;
  const pj = c.project_id ? get(ctx.db, "SELECT id, name FROM projects WHERE id=?", c.project_id) : null;
  return {
    project: pj ? { id: pj.id as string, name: pj.name as string } : null,
    id: c.id as string, kind: c.kind as string, source: c.source_label as string, sourceKind: c.source_kind as string, synthetic: !!c.synthetic, undone: !!c.undone_at,
    commitmentId: (c.commitment_id as string) ?? null, noteId: (c.note_id as string) ?? null, decisionId: (c.decision_id as string) ?? null,
    deepLink: `${deepLinkBase()}${link}`, path: link, officePath: `/office?capture=${c.id}`, parsed: JSON.parse(c.parsed as string),
  };
}

export function captureToJarvis(ctx: Ctx, raw: CaptureInput) {
  const i = CaptureInput.parse(raw);
  const nowIso = ctx.now().toISOString();
  const key = i.dedupKey ?? sha(`${i.sourceKind}|${i.sourceRef ?? ""}|${stripTrigger(i.text).toLowerCase().replace(/\s+/g, " ")}`).slice(0, 32);
  return tx(ctx.db, () => {
    const ex = get(ctx.db, "SELECT id, undone_at FROM captures WHERE owner_id=? AND dedup_key=?", ctx.owner, key);
    if (ex) return { ...captureReceipt(ctx, ex.id as string)!, created: false, duplicate: true, message: ex.undone_at ? "You undid this capture earlier. Nothing was saved again." : "Already saved. Nothing was duplicated." };
    // Bounded: at most 40 captures an hour from any connector.
    const recent = (get(ctx.db, "SELECT COUNT(*) n FROM captures WHERE owner_id=? AND created_at>=?", ctx.owner, new Date(ctx.now().getTime() - 3600_000).toISOString())!.n as number);
    if (recent >= 40) throw new HttpError(429, "Too many captures in the last hour.");
    const parsed = parseCapture(i.text, nowIso);
    const id = uid("cap");
    // A capture that names a project lands in that project's scope. Exact names only; an unknown name is never guessed.
    let prj: { id: string; slug: string; name: string } | null = null; let projectWarning = "";
    if (i.project) { try { prj = findProject(ctx, i.project); } catch (e) { projectWarning = (e as Error).message; } if (!prj && !projectWarning) projectWarning = `No project named "${i.project}", so this was saved to general notes.`; }
    const label = i.sourceLabel ?? SOURCE_LABELS[i.sourceKind];
    run(ctx.db, `INSERT INTO captures(id,owner_id,dedup_key,source_kind,source_label,delivery,text,course,project,source_ref,synthetic,via,kind,parsed,created_at,project_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, ctx.owner, key, i.sourceKind, label, i.delivery ?? (i.sourceKind === "mcp" ? "MCP tool call" : i.via), i.text, i.course ?? null, i.project ?? null, i.sourceRef ?? null, i.synthetic ? 1 : 0, i.via, parsed.kind, JSON.stringify(parsed), nowIso, prj?.id ?? null);
    if (parsed.kind === "commitment") {
      const cid = createCommitment(ctx, { who: parsed.who!, owedTo: parsed.owedTo!, action: parsed.action!, dueDate: parsed.dueDate ?? null, agreement: `Captured from ${label}: "${parsed.body.slice(0, 200)}"`, dedupe: true });
      run(ctx.db, "UPDATE captures SET commitment_id=? WHERE id=?", cid, id);
      if (prj) run(ctx.db, "UPDATE commitments SET project_id=? WHERE id=?", prj.id, cid);
    } else {
      const nid = createNote(ctx, { kind: "inbox", title: parsed.body.slice(0, 60), body: parsed.body, source: `capture:${i.sourceKind}`, sourceRef: id, scope: prj ? `project:${prj.slug}` : i.course ? `course:${i.course}` : "global" });
      if (prj) run(ctx.db, "UPDATE notes SET project_id=? WHERE id=?", prj.id, nid);
      run(ctx.db, "UPDATE captures SET note_id=? WHERE id=?", nid, id);
    }
    recordSourceStatus(ctx, `capture:${i.sourceKind}`, label, true, i.synthetic ? "Synthetic source event (fixture)" : undefined);
    run(ctx.db, "UPDATE source_status SET last_event_at=?, gap_reason=? WHERE owner_id=? AND provider=?", nowIso, i.synthetic ? "Synthetic events only. No live connection." : null, ctx.owner, `capture:${i.sourceKind}`);
    if (parsed.kind === "commitment") {
      const j = enqueueJob(ctx, {
        dedupKey: `capture:${id}`, kind: "supervise_capture", role: "Supervisor", area: "supervisor", title: `Handle: ${parsed.owedTo} ${parsed.action}`.slice(0, 80), input: { captureId: id },
        evidenceIds: [id], tools: ["read_calendar", "read_tasks", "create_commitment", "propose_decision"], budget: { modelCalls: 0, maxMinutes: 5 },
        criteria: ["Commitment saved exactly once", "One decision raised for you"], synthetic: i.synthetic,
      });
      void j;
    }
    return { ...captureReceipt(ctx, id)!, created: true, duplicate: false, message: parsed.kind === "commitment" ? `Saved: you owe ${parsed.owedTo} ${parsed.action}${parsed.dueDate ? ` by ${parsed.dueDate}` : ""}.` : (prj ? `Saved to project ${prj.name}.` : "Saved as a note.") + (projectWarning ? ` ${projectWarning}` : "") };
  });
}

/** Undo removes what the capture created and cancels its jobs. The capture row stays so a replay cannot recreate it silently. */
export function undoCapture(ctx: Ctx, id: string) {
  return tx(ctx.db, () => {
    const c = get(ctx.db, "SELECT * FROM captures WHERE id=? AND owner_id=?", id, ctx.owner);
    if (!c) throw new HttpError(404, "Capture not found");
    if (c.undone_at) return { ok: true, already: true };
    const j = get(ctx.db, "SELECT id FROM jobs WHERE owner_id=? AND dedup_key=?", ctx.owner, `capture:${id}`);
    if (j) cancelJob(ctx, j.id as string);
    if (c.task_id) { run(ctx.db, "DELETE FROM blocks WHERE task_id=?", c.task_id); run(ctx.db, "DELETE FROM decisions WHERE task_id=?", c.task_id); run(ctx.db, "DELETE FROM tasks WHERE id=?", c.task_id); }
    if (c.decision_id) run(ctx.db, "DELETE FROM decisions WHERE id=?", c.decision_id);
    if (c.commitment_id) run(ctx.db, "DELETE FROM commitments WHERE id=?", c.commitment_id);
    if (c.note_id) run(ctx.db, "UPDATE notes SET tombstone=1, title='(deleted)', body='' WHERE id=?", c.note_id), run(ctx.db, "DELETE FROM notes_fts WHERE id=?", c.note_id);
    run(ctx.db, "UPDATE captures SET undone_at=? WHERE id=?", ctx.now().toISOString(), id);
    return { ok: true, already: false };
  });
}

export function recallFromJarvis(ctx: Ctx, query: string, o: { project?: string } = {}) {
  const q = query.trim();
  if (q.length < 2) throw new HttpError(422, "Ask with at least two characters");
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const items: { type: string; id: string; title: string; detail: string; deepLink: string }[] = [];
  const prj = o.project ? findProject(ctx, o.project) : null;
  if (o.project && !prj) throw new HttpError(404, `No project matches "${o.project}".`);
  for (const f of all(ctx.db, `SELECT f.id, f.key, f.text, f.status, f.kind, p.id pid, p.name FROM project_facts f JOIN projects p ON p.id=f.project_id WHERE p.owner_id=? AND f.forgotten=0 AND f.status IN ('current','option') AND (f.text LIKE ? OR f.key LIKE ? OR p.name LIKE ?)${prj ? " AND p.id=?" : ""} ORDER BY f.created_at DESC LIMIT 6`, ...(prj ? [ctx.owner, like, like, like, prj.id] : [ctx.owner, like, like, like])))
    items.push({ type: "project_fact", id: f.id as string, title: `${f.name}: ${f.text}`, detail: `${f.status === "option" ? "open option" : f.kind}`, deepLink: `${deepLinkBase()}/projects/${f.pid}` });
  if (prj) for (const n of all(ctx.db, "SELECT id,title,kind FROM notes WHERE owner_id=? AND tombstone=0 AND project_id=? AND (title LIKE ? OR body LIKE ?) LIMIT 5", ctx.owner, prj.id, like, like))
    items.push({ type: "note", id: n.id as string, title: n.title as string, detail: `note in ${prj.name}`, deepLink: `${deepLinkBase()}/projects/${prj.id}` });
  if (prj) return { query: q, count: items.length, items, missing: items.length ? null : `Nothing in project ${prj.name} matches "${q}".`, scope: `Project ${prj.name} only.` };
  for (const c of all(ctx.db, "SELECT id,text,source_label,commitment_id FROM captures WHERE owner_id=? AND undone_at IS NULL AND text LIKE ? ORDER BY created_at DESC LIMIT 5", ctx.owner, like))
    items.push({ type: "capture", id: c.id as string, title: String(c.text).slice(0, 80), detail: `from ${c.source_label}`, deepLink: `${deepLinkBase()}${c.commitment_id ? `/tasks?tab=followups&focus=${c.commitment_id}` : `/office?capture=${c.id}`}` });
  for (const c of all(ctx.db, "SELECT id,who,owed_to,action,due_date,status FROM commitments WHERE owner_id=? AND (action LIKE ? OR who LIKE ? OR owed_to LIKE ?) ORDER BY created_at DESC LIMIT 5", ctx.owner, like, like, like))
    items.push({ type: "commitment", id: c.id as string, title: `${c.who} to ${c.owed_to}: ${c.action}`, detail: `${c.status}${c.due_date ? `, due ${c.due_date}` : ""}`, deepLink: `${deepLinkBase()}/tasks?tab=followups&focus=${c.id}` });
  for (const d of all(ctx.db, "SELECT id,title,folder,course FROM documents WHERE owner_id=? AND (title LIKE ? OR course LIKE ?) LIMIT 5", ctx.owner, like, like))
    items.push({ type: "document", id: d.id as string, title: d.title as string, detail: `${d.course} / ${d.folder}`, deepLink: `${deepLinkBase()}/guides/${d.id}` });
  for (const n of all(ctx.db, "SELECT id,title,kind FROM notes WHERE owner_id=? AND tombstone=0 AND project_id IS NULL AND sensitivity='normal' AND (title LIKE ? OR body LIKE ?) LIMIT 5", ctx.owner, like, like))
    items.push({ type: "note", id: n.id as string, title: n.title as string, detail: n.kind as string, deepLink: `${deepLinkBase()}/memory` });
  // Honest about scope: this searches what was saved to Jarvis, not every Claude chat.
  const missing = items.length ? null : `Nothing saved in Jarvis matches "${q}". Jarvis only has what you captured with "Remember for Jarvis", pasted, imported or attached. If it was in a Claude conversation, share that conversation (or export just that one) and import it under Sources, or attach the file here.`;
  return { query: q, count: items.length, items, missing, scope: "Saved Jarvis records only. This is not a feed of your Claude chats." };
}
export { localDate };
