// Memory: portable Markdown notes with frontmatter and wikilinks. Local full-text search first.
// Conventions follow the pinned Obsidian skills (properties, quoted wikilinks in YAML, .base and .canvas files).
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Ctx, all, get, run, tx, uid, sha, modeDir, logActivity } from "./db";
import { HttpError } from "./decisions";

export const KINDS = ["preference", "habit", "inference", "project_fact", "commitment_dated", "person", "course", "decision", "inbox", "skill"] as const;
export const FOLDERS = ["Inbox", "People", "Projects", "Courses", "Decisions", "Preferences", "Skills"] as const;
const KIND_FOLDER: Record<string, string> = { preference: "Preferences", habit: "Preferences", inference: "Inbox", project_fact: "Projects", commitment_dated: "Decisions", person: "People", course: "Courses", decision: "Decisions", inbox: "Inbox", skill: "Skills" };

export const NoteInput = z.object({
  kind: z.enum(KINDS), title: z.string().min(1).max(160), body: z.string().max(50_000).default(""),
  scope: z.string().max(120).default("global"), source: z.string().max(200).default("user"), sourceRef: z.string().max(300).optional(),
  effectiveFrom: z.string().optional(), effectiveTo: z.string().optional(), sensitivity: z.enum(["normal", "private"]).default("normal"),
  confidence: z.number().min(0).max(1).default(1), aliases: z.array(z.string().max(100)).max(10).default([]), folder: z.enum(FOLDERS).optional(),
});
export type NoteInput = z.input<typeof NoteInput>;

const parseNote = (n: any) => ({ ...n, aliases: JSON.parse(n.aliases), conflict: n.conflict ? JSON.parse(n.conflict) : null });
const ftsPut = (ctx: Ctx, id: string, title: string, body: string) => {
  run(ctx.db, "DELETE FROM notes_fts WHERE id=?", id);
  run(ctx.db, "INSERT INTO notes_fts(title,body,id) VALUES(?,?,?)", title, body, id);
};

export function createNote(ctx: Ctx, raw: NoteInput, opts: { id?: string; userEdited?: boolean } = {}): string {
  const n = NoteInput.parse(raw);
  const id = opts.id ?? uid("note");
  const now = ctx.now().toISOString();
  // Uncertain inferences stay provisional until confirmed.
  const provisional = n.kind === "inference" && n.confidence < 0.8 ? 1 : 0;
  run(ctx.db,
    `INSERT INTO notes(id,owner_id,kind,folder,title,body,scope,source,source_ref,effective_from,effective_to,sensitivity,confidence,provisional,aliases,user_edited,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ctx.owner, n.kind, n.folder ?? KIND_FOLDER[n.kind], n.title, n.body, n.scope, n.source, n.sourceRef ?? null, n.effectiveFrom ?? null, n.effectiveTo ?? null,
    n.sensitivity, n.confidence, provisional, JSON.stringify(n.aliases), opts.userEdited || n.source === "user" ? 1 : 0, now, now);
  ftsPut(ctx, id, n.title, n.body);
  logActivity(ctx, "note_created", id, `Note: ${n.title}`);
  return id;
}

export const NotePatch = z.object({
  title: z.string().min(1).max(160).optional(), body: z.string().max(50_000).optional(), scope: z.string().max(120).optional(),
  effectiveTo: z.string().nullable().optional(), effectiveFrom: z.string().nullable().optional(), confidence: z.number().min(0).max(1).optional(),
  autoLearn: z.boolean().optional(), provisional: z.boolean().optional(),
});
export function updateNote(ctx: Ctx, id: string, raw: z.input<typeof NotePatch>) {
  const p = NotePatch.parse(raw);
  return tx(ctx.db, () => {
    const n = get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=? AND tombstone=0", id, ctx.owner);
    if (!n) throw new HttpError(404, "Note not found");
    const next = {
      title: p.title ?? n.title, body: p.body ?? n.body, scope: p.scope ?? n.scope,
      effective_to: p.effectiveTo === undefined ? n.effective_to : p.effectiveTo, effective_from: p.effectiveFrom === undefined ? n.effective_from : p.effectiveFrom,
      confidence: p.confidence ?? n.confidence, auto_learn: p.autoLearn === undefined ? n.auto_learn : p.autoLearn ? 1 : 0,
      provisional: p.provisional === undefined ? (p.confidence != null && p.confidence >= 0.8 ? 0 : n.provisional) : p.provisional ? 1 : 0,
    };
    run(ctx.db, "UPDATE notes SET prev=? WHERE id=?", JSON.stringify({ title: n.title, body: n.body, scope: n.scope, project_id: n.project_id ?? null }), id);   // one step of undo
    run(ctx.db, "UPDATE notes SET title=?,body=?,scope=?,effective_to=?,effective_from=?,confidence=?,auto_learn=?,provisional=?,user_edited=1,updated_at=? WHERE id=?",
      next.title, next.body, next.scope, next.effective_to, next.effective_from, next.confidence, next.auto_learn, next.provisional, ctx.now().toISOString(), id);
    ftsPut(ctx, id, next.title as string, next.body as string);
    return { ok: true };
  });
}

export function pinNote(ctx: Ctx, id: string, pinned: boolean) {
  const r = run(ctx.db, "UPDATE notes SET pinned=? WHERE id=? AND owner_id=? AND tombstone=0", pinned ? 1 : 0, id, ctx.owner);
  if (!Number(r.changes)) throw new HttpError(404, "Note not found"); return { ok: true };
}
/** Move a note to a project, a course or back to everywhere. The previous place is kept so Undo can restore it. */
export function moveNote(ctx: Ctx, id: string, to: { projectId?: string | null; scope?: string }) {
  return tx(ctx.db, () => {
    const n = get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=? AND tombstone=0", id, ctx.owner); if (!n) throw new HttpError(404, "Note not found");
    let scope = to.scope ?? "global"; let pid: string | null = null;
    if (to.projectId) { const p = get(ctx.db, "SELECT id, slug FROM projects WHERE id=? AND owner_id=?", to.projectId, ctx.owner); if (!p) throw new HttpError(404, "Project not found"); scope = `project:${p.slug}`; pid = p.id as string; }
    run(ctx.db, "UPDATE notes SET prev=?, scope=?, project_id=?, user_edited=1, updated_at=? WHERE id=?", JSON.stringify({ title: n.title, body: n.body, scope: n.scope, project_id: n.project_id ?? null }), scope, pid, ctx.now().toISOString(), id);
    return { ok: true, scope };
  });
}
/** Merge one note into another: the text is appended with its source, and the merged note moves to history. Undo on the target reverses it. */
export function mergeNotes(ctx: Ctx, fromId: string, intoId: string) {
  if (fromId === intoId) throw new HttpError(422, "Pick a different note to merge into");
  return tx(ctx.db, () => {
    const a = get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=? AND tombstone=0", fromId, ctx.owner), b = get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=? AND tombstone=0", intoId, ctx.owner);
    if (!a || !b) throw new HttpError(404, "Note not found");
    const body = `${b.body}\n\n---\nMerged from "${a.title}" (${String(a.created_at).slice(0, 10)}):\n${a.body}`;
    run(ctx.db, "UPDATE notes SET prev=?, body=?, user_edited=1, updated_at=? WHERE id=?", JSON.stringify({ title: b.title, body: b.body, scope: b.scope, project_id: b.project_id ?? null, mergedFrom: fromId }), body, ctx.now().toISOString(), intoId);
    ftsPut(ctx, intoId, b.title as string, body);
    run(ctx.db, "UPDATE notes SET superseded_by=?, effective_to=COALESCE(effective_to,?) WHERE id=?", intoId, ctx.now().toISOString(), fromId);
    return { ok: true };
  });
}
export function undoNote(ctx: Ctx, id: string) {
  return tx(ctx.db, () => {
    const n = get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=? AND tombstone=0", id, ctx.owner); if (!n || !n.prev) throw new HttpError(404, "Nothing to undo");
    const p = JSON.parse(n.prev as string);
    run(ctx.db, "UPDATE notes SET title=?, body=?, scope=?, project_id=?, prev=NULL, updated_at=? WHERE id=?", p.title, p.body, p.scope, p.project_id ?? null, ctx.now().toISOString(), id);
    ftsPut(ctx, id, p.title, p.body);
    if (p.mergedFrom) run(ctx.db, "UPDATE notes SET superseded_by=NULL, effective_to=NULL WHERE id=? AND owner_id=?", p.mergedFrom, ctx.owner);
    return { ok: true };
  });
}
/** What Jarvis believes about a topic right now, and why. Project decisions come first because they are the most deliberate. */
export function memoryAnswer(ctx: Ctx, q: string) {
  const like = `%${q.trim().replace(/[%_]/g, "")}%`;
  const facts = all(ctx.db, `SELECT f.text, f.key, f.origin, f.asserted_at, f.id, f.event_id, p.name, p.id pid FROM project_facts f JOIN projects p ON p.id=f.project_id WHERE p.owner_id=? AND f.forgotten=0 AND f.status='current' AND (f.text LIKE ? OR f.key LIKE ? OR p.name LIKE ?) ORDER BY f.asserted_at DESC LIMIT 3`, ctx.owner, like, like, like);
  const notes = searchNotes(ctx, q, { limit: 5 });
  const top = facts[0] ? { kind: "project", title: `${facts[0].name}: ${String(facts[0].key).replace(/-/g, " ")}`, text: facts[0].text as string, why: `Decided in ${facts[0].origin === "claude" ? "a Claude conversation" : "Jarvis"} on ${String(facts[0].asserted_at).slice(0, 10)} (project ${facts[0].name}).`, href: `/projects/${facts[0].pid}` }
    : notes[0] ? { kind: "note", title: notes[0].title, text: String(notes[0].body ?? "").slice(0, 400), why: `${notes[0].kind === "preference" ? "A preference you stated" : notes[0].kind === "habit" ? "A habit Jarvis observed" : "A saved note"}. Source: ${notes[0].source}.`, href: `/memory?note=${notes[0].id}`, id: notes[0].id } : null;
  const others = [...facts.slice(1).map((f) => ({ title: `${f.name}: ${f.key}`, text: f.text as string })), ...notes.slice(top?.kind === "note" ? 1 : 0).map((n) => ({ title: n.title, text: String(n.body ?? "").slice(0, 160) }))].slice(0, 4);
  return { query: q, answer: top, alternatives: others, none: top ? null : `Jarvis has nothing saved about "${q}".` };
}
export function memoryOverview(ctx: Ctx) {
  const notes = all(ctx.db, "SELECT n.*, p.name project_name FROM notes n LEFT JOIN projects p ON p.id=n.project_id WHERE n.owner_id=? AND n.tombstone=0 AND n.superseded_by IS NULL AND n.kind!='inbox' ORDER BY n.pinned DESC, n.updated_at DESC", ctx.owner).map((n) => ({ ...parseNote(n), project_name: (n.project_name as string) ?? null, pinned: !!n.pinned, canUndo: !!n.prev }));
  const inbox = all(ctx.db, "SELECT n.*, p.name project_name FROM notes n LEFT JOIN projects p ON p.id=n.project_id WHERE n.owner_id=? AND n.tombstone=0 AND n.superseded_by IS NULL AND n.kind='inbox' ORDER BY n.created_at DESC LIMIT 30", ctx.owner).map((n) => ({ ...parseNote(n), project_name: (n.project_name as string) ?? null, pinned: !!n.pinned, canUndo: !!n.prev }));
  return { pinned: notes.filter((n) => n.pinned), review: notes.filter((n) => !n.pinned && n.provisional), known: notes.filter((n) => !n.pinned && !n.provisional), inbox, projects: all(ctx.db, "SELECT id,name,kind,(SELECT COUNT(*) FROM project_facts f WHERE f.project_id=projects.id AND f.status='current' AND f.forgotten=0) n FROM projects WHERE owner_id=? AND status!='archived'", ctx.owner) };
}

/** A changed preference supersedes the old note. The old one stays for history. */
export function supersedeNote(ctx: Ctx, id: string, raw: NoteInput) {
  return tx(ctx.db, () => {
    const old = get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=? AND tombstone=0", id, ctx.owner);
    if (!old) throw new HttpError(404, "Note not found");
    const nid = createNote(ctx, { ...{ kind: old.kind, title: old.title, scope: old.scope }, ...raw } as NoteInput, { userEdited: true });
    run(ctx.db, "UPDATE notes SET superseded_by=?, effective_to=COALESCE(effective_to,?) WHERE id=?", nid, ctx.now().toISOString(), id);
    run(ctx.db, "UPDATE notes SET supersedes=? WHERE id=?", id, nid);
    return { id: nid };
  });
}

/** Forget: remove content from the table, search index and vault. A tombstone row keeps only the id. */
export function deleteNote(ctx: Ctx, id: string) {
  return tx(ctx.db, () => {
    const n = get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=?", id, ctx.owner);
    if (!n) throw new HttpError(404, "Note not found");
    run(ctx.db, "UPDATE notes SET tombstone=1, title='(deleted)', body='', aliases='[]', source_ref=NULL, conflict=NULL, updated_at=? WHERE id=?", ctx.now().toISOString(), id);
    run(ctx.db, "DELETE FROM notes_fts WHERE id=?", id);
    try { removeVaultFile(ctx, n as any); } catch { /* file may not exist */ }
    logActivity(ctx, "note_deleted", id, "Note deleted");
    return { ok: true };
  });
}

export function getNote(ctx: Ctx, id: string) {
  const n = get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!n || n.tombstone) return null;
  const note = parseNote(n);
  return { note, links: outgoing(ctx, note), backlinks: backlinks(ctx, note) };
}

export function listNotes(ctx: Ctx, o: { includeSuperseded?: boolean; folder?: string } = {}) {
  return all(ctx.db, `SELECT * FROM notes WHERE owner_id=? AND tombstone=0 ${o.includeSuperseded ? "" : "AND superseded_by IS NULL"} ${o.folder ? "AND folder=?" : ""} ORDER BY folder, title`,
    ...(o.folder ? [ctx.owner, o.folder] : [ctx.owner])).map(parseNote);
}

const WIKI = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
export const wikilinks = (body: string) => [...body.matchAll(WIKI)].map((m) => m[1].trim());

function resolveTitle(ctx: Ctx, title: string) {
  const t = title.toLowerCase();
  return all(ctx.db, "SELECT * FROM notes WHERE owner_id=? AND tombstone=0 AND superseded_by IS NULL", ctx.owner).find((n) => String(n.title).toLowerCase() === t || (JSON.parse(n.aliases as string) as string[]).some((a) => a.toLowerCase() === t));
}
function outgoing(ctx: Ctx, n: any) {
  return [...new Set(wikilinks(n.body))].map((t) => { const r = resolveTitle(ctx, t); return { title: t, id: r?.id ?? null }; });
}
function backlinks(ctx: Ctx, n: any) {
  const names = [n.title, ...n.aliases].map((s: string) => s.toLowerCase());
  return all(ctx.db, "SELECT id,title,folder,kind FROM notes WHERE owner_id=? AND tombstone=0 AND id!=? AND body LIKE '%[[%'", ctx.owner, n.id)
    .filter((o) => wikilinks((get(ctx.db, "SELECT body FROM notes WHERE id=?", o.id)!.body as string)).some((l) => names.includes(l.toLowerCase())));
}

export function graph(ctx: Ctx, centerId: string) {
  const c = getNote(ctx, centerId);
  if (!c) throw new HttpError(404, "Note not found");
  const nodes = new Map<string, { id: string; title: string; kind: string; center: boolean }>();
  const edges: { from: string; to: string }[] = [];
  nodes.set(c.note.id, { id: c.note.id, title: c.note.title, kind: c.note.kind, center: true });
  for (const l of c.links) if (l.id) { const o = get(ctx.db, "SELECT id,title,kind FROM notes WHERE id=?", l.id)!; nodes.set(l.id, { id: l.id, title: o.title as string, kind: o.kind as string, center: false }); edges.push({ from: c.note.id, to: l.id }); }
  for (const b of c.backlinks) { nodes.set(b.id as string, { id: b.id as string, title: b.title as string, kind: b.kind as string, center: false }); edges.push({ from: b.id as string, to: c.note.id }); }
  return { nodes: [...nodes.values()], edges };
}

const ftsQuery = (q: string) => q.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0).map((t) => `"${t.replace(/"/g, "")}"*`).join(" ");

/** Rank: title hits, scope specificity, recency. Superseded and deleted notes never appear. */
export function searchNotes(ctx: Ctx, q: string, o: { scope?: string; limit?: number } = {}) {
  const fq = ftsQuery(q);
  if (!fq) return [];
  const rows = all(ctx.db,
    `SELECT n.*, bm25(notes_fts, 5.0, 1.0) rank FROM notes_fts JOIN notes n ON n.id=notes_fts.id WHERE notes_fts MATCH ? AND n.owner_id=? AND n.tombstone=0 AND n.superseded_by IS NULL ORDER BY rank LIMIT 50`, fq, ctx.owner);
  const now = ctx.now().getTime();
  return rows.map((n) => {
    let score = -(n.rank as number);
    if (o.scope && n.scope === o.scope) score += 3;
    if (n.confidence < 0.8) score -= 1;
    score += Math.max(0, 1 - (now - new Date(n.updated_at as string).getTime()) / (90 * 86400000));
    return { ...parseNote(n), score };
  }).sort((a, b) => b.score - a.score).slice(0, o.limit ?? 20);
}

/** Notes that shaped a recommendation. Provisional inferences and expired notes are not used. */
export function notesUsedFor(ctx: Ctx, task: { external_id?: string; course_ext?: string } | null) {
  const now = ctx.now().toISOString();
  const rows = all(ctx.db, "SELECT * FROM notes WHERE owner_id=? AND tombstone=0 AND superseded_by IS NULL AND provisional=0 AND kind IN ('preference','habit','project_fact','commitment_dated')", ctx.owner);
  return rows.filter((n) => (!n.effective_from || n.effective_from <= now) && (!n.effective_to || n.effective_to >= now))
    .filter((n) => n.scope === "global" || (task?.external_id && n.scope === `task:${task.external_id}`) || (task?.course_ext && n.scope === `course:${task.course_ext}`))
    .map((n) => ({ id: n.id as string, title: n.title as string, kind: n.kind as string, scope: n.scope as string, body: String(n.body).slice(0, 160), source: n.source as string,
      why: n.scope === "global" ? "Applies to all scheduling." : `Scoped to ${n.scope}.` }));
}

export function learned(ctx: Ctx) {
  return all(ctx.db, "SELECT * FROM notes WHERE owner_id=? AND tombstone=0 AND source!='user' ORDER BY created_at DESC LIMIT 50", ctx.owner).map(parseNote);
}
export function timeline(ctx: Ctx) {
  return all(ctx.db, "SELECT id,title,kind,folder,scope,source,created_at,superseded_by FROM notes WHERE owner_id=? AND tombstone=0 ORDER BY created_at DESC LIMIT 100", ctx.owner);
}

// ---------- Vault (Obsidian-compatible) ----------
export function vaultRoot(ctx: Ctx): string { return path.join(modeDir(ctx.mode), "vault"); }
const safeName = (t: string) => t.replace(/[\\/:*?"<>|#^\[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";

/** Resolve a relative path inside the vault. Rejects traversal and symlinks that point outside. */
export function safeVaultPath(root: string, rel: string): string {
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, rel);
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) throw new HttpError(400, "Path is outside the vault");
  let probe = target;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) throw new HttpError(400, "Path resolves outside the vault (symlink)");
  return target;
}

const yq = (s: string) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
export function serialize(n: any): string {
  const links = [...new Set(wikilinks(n.body))];
  const fm = [
    "---", `id: ${n.id}`, `kind: ${n.kind}`, `scope: ${yq(n.scope)}`, `source: ${yq(n.source)}`, `confidence: ${n.confidence}`,
    ...(n.effective_from ? [`effective_from: ${n.effective_from}`] : []), ...(n.effective_to ? [`effective_to: ${n.effective_to}`] : []),
    `sensitivity: ${n.sensitivity}`, `provisional: ${n.provisional ? "true" : "false"}`,
    ...(n.supersedes ? [`supersedes: ${yq(`[[${n.supersedes}]]`)}`] : []),
    `aliases: [${(n.aliases as string[]).map(yq).join(", ")}]`, `tags: [jarvis, ${n.kind}]`,
    ...(links.length ? ["related:", ...links.map((l) => `  - ${yq(`[[${l}]]`)}`)] : []), "---", "",
  ];
  return fm.join("\n") + n.body.replace(/\r\n/g, "\n") + (n.body.endsWith("\n") ? "" : "\n");
}

export function parseFrontmatter(text: string): { fm: Record<string, any>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return { fm: {}, body: text };
  const fm: Record<string, any> = {};
  let listKey: string | null = null;
  for (const line of m[1].split("\n")) {
    const li = /^\s+-\s+(.*)$/.exec(line);
    if (li && listKey) { (fm[listKey] ||= []).push(unq(li[1])); continue; }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    listKey = null;
    const v = kv[2].trim();
    if (v === "") { listKey = kv[1]; fm[kv[1]] = []; }
    else if (v.startsWith("[") && v.endsWith("]")) fm[kv[1]] = v.slice(1, -1).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => unq(s.trim())).filter(Boolean);
    else fm[kv[1]] = unq(v);
  }
  return { fm, body: m[2] };
}
const unq = (s: string) => (/^".*"$/.test(s) ? s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\") : s);

function fileFor(ctx: Ctx, n: { folder: string; title: string }) { return safeVaultPath(vaultRoot(ctx), path.join(n.folder, `${safeName(n.title)}.md`)); }
function removeVaultFile(ctx: Ctx, n: { folder: string; title: string }) { const f = fileFor(ctx, n); if (fs.existsSync(f)) fs.unlinkSync(f); }

export function exportVault(ctx: Ctx) {
  const root = vaultRoot(ctx);
  fs.mkdirSync(root, { recursive: true });
  let written = 0, skipped = 0;
  const notes = all(ctx.db, "SELECT * FROM notes WHERE owner_id=? AND tombstone=0 AND superseded_by IS NULL AND sensitivity='normal'", ctx.owner).map(parseNote);
  for (const n of notes) {
    if (n.conflict) { skipped++; continue; }
    const file = fileFor(ctx, n);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = serialize(n);
    fs.writeFileSync(file, text);
    run(ctx.db, "UPDATE notes SET vault_hash=? WHERE id=?", sha(text), n.id);
    written++;
  }
  // superseded or private notes are not exported; remove stale files for them.
  for (const n of all(ctx.db, "SELECT * FROM notes WHERE owner_id=? AND (superseded_by IS NOT NULL OR sensitivity='private') AND tombstone=0", ctx.owner)) { try { removeVaultFile(ctx, n as any); } catch { /* ignore */ } }
  exportOverview(ctx, notes);
  return { written, skipped, root };
}

export function exportOverview(ctx: Ctx, notes = listNotes(ctx)) {
  const root = vaultRoot(ctx);
  const base = [
    "filters:", "  and:", '    - \'file.hasTag("jarvis")\'', "properties:", "  note.kind:", "    displayName: Kind", "  note.scope:", "    displayName: Scope", "  note.confidence:", "    displayName: Confidence",
    "views:", "  - type: table", "    name: Jarvis memory", "    order:", "      - file.name", "      - kind", "      - scope", "      - confidence", "    sort:", "      - property: file.name", "        direction: ASC", "",
  ].join("\n");
  fs.writeFileSync(safeVaultPath(root, "Jarvis memory.base"), base);
  const id16 = (s: string) => sha(s).slice(0, 16);
  const nodes = notes.map((n: any, i: number) => ({ id: id16(n.id), type: "file", file: `${n.folder}/${safeName(n.title)}.md`, x: (i % 4) * 340, y: Math.floor(i / 4) * 200, width: 300, height: 140 }));
  const idByTitle = new Map(notes.map((n: any) => [String(n.title).toLowerCase(), id16(n.id)]));
  const edges: any[] = [];
  for (const n of notes as any[]) for (const l of new Set(wikilinks(n.body))) { const t = idByTitle.get(l.toLowerCase()); if (t) edges.push({ id: id16(`${n.id}>${t}`), fromNode: id16(n.id), toNode: t }); }
  fs.writeFileSync(safeVaultPath(root, "Jarvis map.canvas"), JSON.stringify({ nodes, edges }, null, 2));
}

export interface ImportReport { updated: string[]; created: string[]; conflicts: string[]; unchanged: number; rejected: { file: string; reason: string }[] }

export function importVault(ctx: Ctx): ImportReport {
  const root = vaultRoot(ctx);
  const rep: ImportReport = { updated: [], created: [], conflicts: [], unchanged: 0, rejected: [] };
  if (!fs.existsSync(root)) return rep;
  const realRoot = fs.realpathSync(root);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.name.startsWith(".")) continue;
      if (e.isSymbolicLink()) {
        let real: string; try { real = fs.realpathSync(p); } catch { rep.rejected.push({ file: path.relative(root, p), reason: "Broken symlink" }); continue; }
        if (!real.startsWith(realRoot + path.sep)) { rep.rejected.push({ file: path.relative(root, p), reason: "Symlink points outside the vault" }); continue; }
      }
      if (e.isDirectory()) walk(p); else if (e.name.endsWith(".md")) files.push(p);
    }
  };
  walk(root);
  tx(ctx.db, () => {
    for (const f of files) {
      const rel = path.relative(root, f);
      if (fs.statSync(f).size > 1_000_000) { rep.rejected.push({ file: rel, reason: "File over 1 MB" }); continue; }
      const text = fs.readFileSync(f, "utf8");
      const { fm, body } = parseFrontmatter(text);
      const fileHash = sha(text);
      const existing = fm.id ? get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=?", fm.id, ctx.owner) : undefined;
      if (existing && existing.tombstone) { rep.rejected.push({ file: rel, reason: "Note was deleted in Jarvis" }); continue; }
      if (existing) {
        if (existing.vault_hash === fileHash) { rep.unchanged++; continue; }
        const appText = serialize(parseNote(existing));
        if (sha(appText) !== existing.vault_hash) {
          // Both sides changed since export. Keep the app copy and flag the file copy.
          run(ctx.db, "UPDATE notes SET conflict=? WHERE id=?", JSON.stringify({ fileBody: body, fileHash, at: ctx.now().toISOString() }), existing.id);
          rep.conflicts.push(existing.title as string); continue;
        }
        const title = path.basename(f, ".md");
        run(ctx.db, "UPDATE notes SET title=?, body=?, scope=COALESCE(?,scope), confidence=COALESCE(?,confidence), user_edited=1, vault_hash=?, updated_at=? WHERE id=?",
          title, body.replace(/^\n/, ""), fm.scope ?? null, fm.confidence != null ? Number(fm.confidence) : null, fileHash, ctx.now().toISOString(), existing.id);
        ftsPut(ctx, existing.id as string, title, body);
        rep.updated.push(title);
      } else {
        const folder = (FOLDERS as readonly string[]).includes(rel.split(path.sep)[0]) ? rel.split(path.sep)[0] : "Inbox";
        const title = path.basename(f, ".md");
        const id = createNote(ctx, { kind: (KINDS as readonly string[]).includes(fm.kind) ? fm.kind : "inbox", title, body: body.replace(/^\n/, ""), source: "vault-import", sourceRef: rel, folder: folder as any, scope: fm.scope ?? "global" }, { userEdited: true });
        const n = parseNote(get(ctx.db, "SELECT * FROM notes WHERE id=?", id)!);
        const out = serialize(n);
        fs.writeFileSync(f, out);
        run(ctx.db, "UPDATE notes SET vault_hash=? WHERE id=?", sha(out), id);
        rep.created.push(title);
      }
    }
  });
  return rep;
}

export function resolveNoteConflict(ctx: Ctx, id: string, keep: "app" | "file") {
  const n = get(ctx.db, "SELECT * FROM notes WHERE id=? AND owner_id=? AND tombstone=0", id, ctx.owner);
  if (!n || !n.conflict) throw new HttpError(404, "No conflict on this note");
  const c = JSON.parse(n.conflict as string);
  if (keep === "file") { run(ctx.db, "UPDATE notes SET body=?, updated_at=? WHERE id=?", c.fileBody.replace(/^\n/, ""), ctx.now().toISOString(), id); ftsPut(ctx, id, n.title as string, c.fileBody); }
  run(ctx.db, "UPDATE notes SET conflict=NULL, vault_hash=NULL WHERE id=?", id);
  return { ok: true };
}

// ---------- Private reflection room: nothing is stored ----------
export function reflect(message: string, perspective: "A" | "B"): string {
  // Deterministic, transient. No persistence, no logging of content.
  const q = /\?\s*$/.test(message.trim());
  if (perspective === "A") return q ? "Perspective A (AI, not a therapist): What would you want to be true a month from now? Name one small step that moves toward it." : "Perspective A (AI, not a therapist): That sounds like it matters to you. What is the part you most want to be heard on?";
  return "Perspective B (AI, not a therapist): What is the question you would bring to a licensed professional about this? Write it in one sentence. You can save only that line.";
}
