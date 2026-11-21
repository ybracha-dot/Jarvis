// Projects: the persistent place ordinary Claude and Jarvis share. Current state, discussion options and dated decision history are kept apart.
// Every write is an event: stable event id, origin, expected revision, a receipt. Replays return the same receipt. Stale patches never override newer edits.
import { z } from "zod";
import crypto from "node:crypto";
import { Ctx, all, get, run, tx, uid, getSetting, setSetting, logActivity, sha } from "./db";
import { HttpError } from "./decisions";

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
export const workspaceIdentity = (ctx: Ctx) => {
  let id = getSetting<string | null>(ctx.db, "workspace_id", null);
  if (!id) { id = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`; setSetting(ctx.db, "workspace_id", id); }
  return { id, mode: ctx.mode };
};

export const OPS = ["option", "decide", "fact", "action", "question", "retract"] as const;
const key = z.string().min(1).max(60);
const text = z.string().trim().min(1).max(1000);
const at = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO time").optional();
export const Change = z.discriminatedUnion("op", [
  z.object({ op: z.literal("option"), key, text, at }).strict(),
  z.object({ op: z.literal("decide"), key, text, tentative: z.boolean().optional(), supersedesKey: key.optional(), at }).strict(),
  z.object({ op: z.literal("fact"), key, text, at }).strict(),
  z.object({ op: z.literal("action"), key, text, at }).strict(),
  z.object({ op: z.literal("question"), key, text, at }).strict(),
  z.object({ op: z.literal("retract"), key, at }).strict(),
]);
export const ProjectUpdate = z.object({
  project: z.string().min(1).max(120), createIfMissing: z.object({ name: z.string().min(1).max(120).optional(), kind: z.enum(["trip", "course", "club", "project", "other"]).optional() }).optional(),
  eventId: z.string().min(8).max(80), dedupKey: z.string().max(120).optional(), expectedRevision: z.number().int().min(0).optional(),
  origin: z.enum(["claude", "jarvis-ui", "import", "test"]).default("claude"), client: z.string().max(60).optional(), sourceRef: z.string().max(300).optional(),
  sentAt: at, offTheRecord: z.boolean().optional(), changes: z.array(Change).min(1).max(12),
}).strict();
export type ProjectUpdate = z.input<typeof ProjectUpdate>;

const parseProject = (p: any) => ({ ...p, aliases: JSON.parse(p.aliases) });
export function createProject(ctx: Ctx, o: { name: string; kind?: string; aliases?: string[]; course?: string | null }) {
  const slug = slugify(o.name); if (!slug) throw new HttpError(422, "A project needs a name");
  const ex = get(ctx.db, "SELECT * FROM projects WHERE owner_id=? AND slug=?", ctx.owner, slug); if (ex) return parseProject(ex);
  const id = `prj_${sha(`${ctx.owner}|${slug}`).slice(0, 12)}`; const now = ctx.now().toISOString();
  run(ctx.db, "INSERT INTO projects(id,owner_id,slug,name,kind,aliases,course,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", id, ctx.owner, slug, o.name.trim(), o.kind ?? "project", JSON.stringify(o.aliases ?? []), o.course ?? null, now, now);
  return parseProject(get(ctx.db, "SELECT * FROM projects WHERE id=?", id)!);
}
/** Exact id, slug, name or alias only. Similar names are never merged, and an ambiguous reference is refused. */
export function findProject(ctx: Ctx, ref: string) {
  const r = ref.trim(); const s = slugify(r);
  const rows = all(ctx.db, "SELECT * FROM projects WHERE owner_id=? AND status!='archived'", ctx.owner).map(parseProject);
  const hits = rows.filter((p) => p.id === r || p.slug === s || p.name.toLowerCase() === r.toLowerCase() || p.aliases.some((a: string) => a.toLowerCase() === r.toLowerCase()));
  if (hits.length > 1) throw new HttpError(409, `"${ref}" matches ${hits.length} projects: ${hits.map((h) => h.name).join(", ")}. Use the project id.`);
  return hits[0] ?? null;
}
export const listProjects = (ctx: Ctx) => all(ctx.db, "SELECT * FROM projects WHERE owner_id=? AND status!='archived' ORDER BY updated_at DESC", ctx.owner).map((p) => ({
  ...parseProject(p), counts: { current: (get(ctx.db, "SELECT COUNT(*) n FROM project_facts WHERE project_id=? AND status='current' AND forgotten=0", p.id)!.n as number), suggestions: (get(ctx.db, "SELECT COUNT(*) n FROM project_facts WHERE project_id=? AND status='suggested' AND forgotten=0", p.id)!.n as number) } }));

const fact = (f: any) => ({ id: f.id as string, key: f.key as string, kind: f.kind as string, text: f.forgotten ? "(forgotten)" : (f.text as string), status: f.status as string, revision: f.revision as number, asOf: f.asserted_at as string, recordedAt: f.created_at as string, source: f.source as string | null, sourceRef: f.source_ref as string | null, origin: f.origin as string, eventId: f.event_id as string | null, locator: f.locator as string | null, supersedes: f.supersedes as string | null, supersededBy: f.superseded_by as string | null, pinned: !!f.pinned, forgotten: !!f.forgotten, note: f.note as string | null });

export function projectContext(ctx: Ctx, ref: string) {
  const p = findProject(ctx, ref); if (!p) throw new HttpError(404, `No project matches "${ref}".`);
  const rows = all(ctx.db, "SELECT * FROM project_facts WHERE project_id=? ORDER BY revision, created_at, rowid", p.id).map(fact);
  const live = rows.filter((f) => !f.forgotten);
  const cur = (kind: string[]) => live.filter((f) => f.status === "current" && kind.includes(f.kind));
  const current = cur(["decision", "fact"]);
  const options = live.filter((f) => f.status === "option"); const suggestions = live.filter((f) => f.status === "suggested");
  const history = rows.filter((f) => ["superseded", "retracted"].includes(f.status));
  const sources = all(ctx.db, "SELECT event_id, origin, client, at, resulting_revision rev FROM project_events WHERE project_id=? AND undone_at IS NULL ORDER BY at DESC, rowid DESC LIMIT 12", p.id);
  const answer = [current.length ? `Current: ${current.map((f) => `${f.key.replace(/-/g, " ")}: ${f.text} (${f.origin}, rev ${f.revision}, ${f.asOf.slice(0, 10)})`).join("; ")}.` : "Nothing is decided yet.",
    options.length ? `Open options: ${options.map((f) => f.text).join("; ")}.` : "", history.some((f) => f.status === "superseded" && f.kind !== "option") ? `Earlier: ${history.filter((f) => f.status === "superseded" && f.kind !== "option").map((f) => `${f.text} (replaced)`).join("; ")}.` : "",
    suggestions.length ? `Waiting for your confirmation: ${suggestions.map((f) => f.text).join("; ")}.` : ""].filter(Boolean).join(" ");
  return { project: { id: p.id as string, name: p.name as string, slug: p.slug as string, kind: p.kind as string, revision: p.revision as number, updatedAt: p.updated_at as string, lastOrigin: p.last_origin as string | null, course: p.course as string | null },
    workspace: workspaceIdentity(ctx), current, options, suggestions, actions: cur(["action"]), questions: cur(["question"]), history, sources, answer };
}

export class ProjectConflict extends Error { constructor(public keys: string[], public currentRevision: number) { super(`Newer edits exist for: ${keys.join(", ")}`); } }
type Receipt = { saved: true; replay: boolean; eventId: string; project: { id: string; name: string; slug: string }; revision: number; workspace: { id: string; mode: string }; origin: string; client: string | null; at: string; changes: { factId: string; key: string; op: string; status: string; note?: string }[] };
const listeners = new Set<(e: { ctx: Ctx; projectId: string; eventId: string }) => void>();
export const onProjectEvent = (fn: (e: { ctx: Ctx; projectId: string; eventId: string }) => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export function applyProjectUpdate(ctx: Ctx, raw: ProjectUpdate): Receipt | { saved: false; reason: string } | { saved: false; conflict: true; keys: string[]; currentRevision: number; current: ReturnType<typeof projectContext> } {
  const i = ProjectUpdate.parse(raw);
  if (i.offTheRecord) return { saved: false, reason: "Off the record. Nothing was saved." };
  const prior = get(ctx.db, "SELECT receipt FROM project_events WHERE owner_id=? AND event_id=?", ctx.owner, i.eventId);
  if (prior) return { ...(JSON.parse(prior.receipt as string) as Receipt), replay: true };
  let out: Receipt;
  try {
    out = tx(ctx.db, () => {
      let p = findProject(ctx, i.project);
      if (!p) {
        if (!i.createIfMissing) throw new HttpError(404, `No project named "${i.project}". Check the name, or pass createIfMissing to start one.`);
        p = createProject(ctx, { name: i.createIfMissing.name ?? i.project, kind: i.createIfMissing.kind });
      }
      if (i.dedupKey) { const d = get(ctx.db, "SELECT receipt FROM project_events WHERE owner_id=? AND project_id=? AND dedup_key=?", ctx.owner, p.id, i.dedupKey); if (d) return { ...(JSON.parse(d.receipt as string) as Receipt), replay: true }; }
      const keys = [...new Set(i.changes.map((c) => slugify(c.key)))];
      if (i.expectedRevision != null && i.expectedRevision < p.revision) {
        const hit = keys.filter((k) => get(ctx.db, "SELECT 1 x FROM project_facts WHERE project_id=? AND key=? AND revision>? AND status!='retracted'", p.id, k, i.expectedRevision));
        if (hit.length) throw new ProjectConflict(hit, p.revision);
      }
      const rev = (p.revision as number) + 1; const now = ctx.now().toISOString(); const source = i.origin === "claude" ? "Claude conversation" : i.origin === "jarvis-ui" ? "Edited in Jarvis" : i.origin === "import" ? "Import" : "Test";
      const changes: Receipt["changes"] = [];
      for (const c of i.changes) {
        const k = slugify(c.key); const asserted = c.at ?? i.sentAt ?? now;
        const kind = c.op === "option" ? "option" : c.op === "decide" ? "decision" : c.op === "retract" ? "retract" : c.op;
        if (c.op === "retract") {
          const n = run(ctx.db, "UPDATE project_facts SET status='retracted' WHERE project_id=? AND key=? AND status IN ('current','option','suggested') AND forgotten=0", p.id, k);
          changes.push({ factId: "", key: k, op: "retract", status: Number(n.changes) ? "retracted" : "nothing to retract" }); continue;
        }
        const newer = get(ctx.db, "SELECT id, asserted_at FROM project_facts WHERE project_id=? AND key=? AND kind=? AND status='current' AND forgotten=0", p.id, k, kind) as any;
        const stale = !!newer && c.op !== "action" && c.op !== "question" && newer.asserted_at > asserted;     // an out-of-order message never overwrites what is newer
        const tentative = c.op === "decide" && (c as any).tentative === true;
        const status = c.op === "option" ? "option" : tentative ? "suggested" : stale ? "superseded" : "current";
        const id = uid("pf"); let supersedes: string | null = null;
        if (status === "current" && newer && c.op !== "action" && c.op !== "question") { supersedes = newer.id; run(ctx.db, "UPDATE project_facts SET status='superseded', superseded_by=? WHERE id=?", id, newer.id); }
        // Several options can sit under one key; repeating the same one only refreshes it.
        if (c.op === "option") { const o = get(ctx.db, "SELECT id FROM project_facts WHERE project_id=? AND key=? AND kind='option' AND status='option' AND lower(text)=lower(?)", p.id, k, (c as any).text) as any; if (o) { supersedes = o.id; run(ctx.db, "UPDATE project_facts SET status='superseded', superseded_by=? WHERE id=?", id, o.id); } }
        if (c.op === "decide" && status === "current") {
          // A decision settles the question it answers: options with the same key, or the one it names, move into history.
          for (const sk of [k, (c as any).supersedesKey ? slugify((c as any).supersedesKey) : null].filter(Boolean) as string[])
            for (const o of all(ctx.db, "SELECT id FROM project_facts WHERE project_id=? AND key=? AND status='option'", p.id, sk)) { run(ctx.db, "UPDATE project_facts SET status='superseded', superseded_by=? WHERE id=?", id, o.id); supersedes = supersedes ?? (o.id as string); }
        }
        run(ctx.db, `INSERT INTO project_facts(id,project_id,key,kind,text,status,revision,supersedes,source,source_ref,origin,event_id,locator,asserted_at,created_at,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, p.id, k, kind, (c as any).text, status, rev, supersedes, source, i.sourceRef ?? null, i.origin, i.eventId, i.sourceRef ? `${i.sourceRef}` : null, asserted, now, stale ? "Arrived out of order. An earlier message than the current one." : tentative ? "Tentative wording. Waiting for your confirmation." : null);
        changes.push({ factId: id, key: k, op: c.op, status, ...(stale ? { note: "out of order: kept in history" } : tentative ? { note: "pending suggestion" } : {}) });
      }
      run(ctx.db, "UPDATE projects SET revision=?, updated_at=?, last_origin=?, last_source=? WHERE id=?", rev, now, i.origin, source, p.id);
      const receipt: Receipt = { saved: true, replay: false, eventId: i.eventId, project: { id: p.id, name: p.name, slug: p.slug }, revision: rev, workspace: workspaceIdentity(ctx), origin: i.origin, client: i.client ?? null, at: now, changes };
      run(ctx.db, "INSERT INTO project_events(id,owner_id,project_id,event_id,dedup_key,origin,client,expected_revision,resulting_revision,receipt,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", uid("pev"), ctx.owner, p.id, i.eventId, i.dedupKey ?? null, i.origin, i.client ?? null, i.expectedRevision ?? null, rev, JSON.stringify(receipt), now);
      logActivity(ctx, "project_update", p.id, `${p.name} r${rev}: ${changes.map((c) => `${c.op} ${c.key}`).join(", ")}`);
      return receipt;
    });
  } catch (e) {
    if (e instanceof ProjectConflict) { const p = findProject(ctx, i.project)!; return { saved: false, conflict: true, keys: e.keys, currentRevision: e.currentRevision, current: projectContext(ctx, p.id) }; }
    throw e;
  }
  if (!out.replay) for (const l of listeners) { try { l({ ctx, projectId: out.project.id, eventId: out.eventId }); } catch { /* a listener must not break a committed write */ } }
  return out;
}

/** Your own edit in Jarvis: a new event that replaces the fact under the same key. Refused if the fact changed since you opened it. */
export function editFact(ctx: Ctx, factId: string, textNew: string, expectedRevision: number) {
  const f = get(ctx.db, "SELECT f.*, p.id pid FROM project_facts f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND p.owner_id=?", factId, ctx.owner);
  if (!f || f.forgotten) throw new HttpError(404, "That item no longer exists. It may have been forgotten. Reload.");
  const op = f.kind === "decision" ? "decide" : f.kind;
  const r = applyProjectUpdate(ctx, { project: f.pid as string, eventId: `ui-${uid("e")}`, origin: "jarvis-ui", expectedRevision, changes: [{ op, key: f.key as string, text: textNew } as any] });
  if ("conflict" in r) throw new HttpError(409, `Someone changed this since you opened it (now revision ${r.currentRevision}). Reload and try again.`);
  return r;
}
export function resolveSuggestion(ctx: Ctx, factId: string, accept: boolean) {
  const f = get(ctx.db, "SELECT f.*, p.id pid FROM project_facts f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND p.owner_id=? AND f.status='suggested'", factId, ctx.owner);
  if (!f) throw new HttpError(404, "That suggestion is gone or was already handled.");
  if (!accept) { run(ctx.db, "UPDATE project_facts SET status='retracted', note='You declined this suggestion' WHERE id=?", factId); return { ok: true }; }
  run(ctx.db, "UPDATE project_facts SET status='retracted', note='Confirmed as a decision' WHERE id=?", factId);
  return applyProjectUpdate(ctx, { project: f.pid as string, eventId: `ui-${uid("e")}`, origin: "jarvis-ui", changes: [{ op: "decide", key: f.key as string, text: f.text as string }] });
}
/** Undo the latest event: only if nothing newer touched the same keys. Restores what it replaced. */
export function undoEvent(ctx: Ctx, eventId: string) {
  return tx(ctx.db, () => {
    const e = get(ctx.db, "SELECT * FROM project_events WHERE owner_id=? AND event_id=? AND undone_at IS NULL", ctx.owner, eventId); if (!e) throw new HttpError(404, "Nothing to undo.");
    const facts = all(ctx.db, "SELECT * FROM project_facts WHERE event_id=? AND project_id=?", eventId, e.project_id);
    for (const f of facts) if (get(ctx.db, "SELECT 1 x FROM project_facts WHERE project_id=? AND key=? AND revision>? AND event_id!=?", e.project_id, f.key, f.revision, eventId)) throw new HttpError(409, `Something newer changed "${f.key}". Undo that first.`);
    for (const f of facts) { run(ctx.db, "UPDATE project_facts SET status='retracted', note='Undone' WHERE id=?", f.id); if (f.supersedes) run(ctx.db, "UPDATE project_facts SET status=CASE WHEN kind='option' THEN 'option' ELSE 'current' END, superseded_by=NULL WHERE id=?", f.supersedes); }
    run(ctx.db, "UPDATE project_events SET undone_at=? WHERE id=?", ctx.now().toISOString(), e.id);
    run(ctx.db, "UPDATE projects SET revision=revision+1, updated_at=?, last_origin='jarvis-ui', last_source='Undo' WHERE id=?", ctx.now().toISOString(), e.project_id);
    return { ok: true };
  });
}
export function forgetFact(ctx: Ctx, factId: string) {
  const f = get(ctx.db, "SELECT f.id FROM project_facts f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND p.owner_id=?", factId, ctx.owner); if (!f) throw new HttpError(404, "That item no longer exists.");
  run(ctx.db, "UPDATE project_facts SET text='', forgotten=1, source_ref=NULL, locator=NULL WHERE id=?", factId); return { ok: true };
}
export function pinFact(ctx: Ctx, factId: string, pinned: boolean) { run(ctx.db, "UPDATE project_facts SET pinned=? WHERE id=? AND project_id IN (SELECT id FROM projects WHERE owner_id=?)", pinned ? 1 : 0, factId, ctx.owner); return { ok: true }; }
export const projectEvents = (ctx: Ctx, projectId: string) => all(ctx.db, "SELECT event_id, origin, client, at, resulting_revision rev, undone_at FROM project_events WHERE owner_id=? AND project_id=? ORDER BY at DESC, rowid DESC LIMIT 30", ctx.owner, projectId);
