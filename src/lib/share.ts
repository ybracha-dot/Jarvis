// What Claude may read from the private workspace, what it was actually shown, and how the user takes it back.
// Deny by default: in the private workspace the connector sees only (a) sources the user marked shareable, (b) results the user approved, (c) results of a goal Claude itself
// started whose every cited source is shareable. Revoking any of them takes effect on the very next call. The example workspace is synthetic and keeps its behaviour.
import { Ctx, all, get, run, uid, logActivity } from "./db";
import { HttpError } from "./decisions";
import { projectContext } from "./projects";

export const DENIED = "That is not shared with Claude. Open it in Jarvis, or share it from Jarvis (Connections → What Claude can read).";
const NOT_FOUND = "No shared result with that id.";

export const claudeScoped = (c: Ctx) => c.mode === "personal" && (c as any).audience === "claude";
export const asClaude = (c: Ctx): Ctx => Object.assign(c, { audience: "claude" as const });

export function logShare(ctx: Ctx, event: string, refKind: string | null, refId: string | null, o: { tool?: string; client?: string | null; detail?: string } = {}) {
  run(ctx.db, "INSERT INTO share_log(at,event,ref_kind,ref_id,tool,client,detail) VALUES(?,?,?,?,?,?,?)", ctx.now().toISOString(), event, refKind, refId, o.tool ?? null, o.client ?? null, o.detail ?? null);
}

// ---------- sources ----------
const sourceOk = (s: any) => !!s && !!s.shareable && !s.local_only && !s.revoked_at;
export const itemShareable = (ctx: Ctx, itemId: string) => { const r = get(ctx.db, "SELECT s.shareable, s.local_only, s.revoked_at, i.tombstone FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.id=? AND i.owner_id=?", itemId, ctx.owner); return !!r && !r.tombstone && sourceOk(r); };

export function sourcesSharing(ctx: Ctx) {
  return all(ctx.db, "SELECT s.id, s.kind, s.label, s.mode, s.shareable, s.local_only, s.revoked_at, s.project_id, s.state, s.last_success_at, s.message, (SELECT COUNT(*) FROM evidence_items i WHERE i.source_id=s.id AND i.tombstone=0) n FROM evidence_sources s WHERE s.owner_id=? ORDER BY s.created_at", ctx.owner)
    .map((s) => ({ id: s.id as string, kind: s.kind as string, label: s.label as string, mode: s.mode as string, items: s.n as number, shared: sourceOk(s), localOnly: !!s.local_only, revoked: !!s.revoked_at, state: s.state as string, lastSuccessAt: (s.last_success_at as string | null) ?? null, message: (s.message as string | null) ?? null }));
}
/** What Claude would receive from one source if it were shared: titles, dates and the text of those notes, and nothing else. */
export function sourcePreview(ctx: Ctx, sourceId: string) {
  const s = get(ctx.db, "SELECT label,kind FROM evidence_sources WHERE id=? AND owner_id=?", sourceId, ctx.owner); if (!s) throw new HttpError(404, "Source not found");
  const items = all(ctx.db, "SELECT title, at FROM evidence_items WHERE source_id=? AND tombstone=0 ORDER BY at DESC", sourceId);
  return { label: s.label as string, count: items.length, titles: items.slice(0, 8).map((i) => ({ title: i.title as string, at: i.at as string })), more: Math.max(0, items.length - 8), receives: "The text of these notes with their titles and dates. Passages are numbered so Claude can quote them.", never: "Your calendar, work blocks, course records, promises, other sources, and anything you keep local-only." };
}
/** The explicit choice. Sharing a source makes its notes readable by Claude; unsharing returns it to local-only at once. */
export function setSourceSharing(ctx: Ctx, sourceId: string, share: boolean, parentRef?: string) {
  const s = get(ctx.db, "SELECT id,label FROM evidence_sources WHERE id=? AND owner_id=?", sourceId, ctx.owner); if (!s) throw new HttpError(404, "Source not found");
  run(ctx.db, "UPDATE evidence_sources SET shareable=?, local_only=? WHERE id=?", share ? 1 : 0, share ? 0 : 1, sourceId);
  run(ctx.db, "INSERT INTO claude_grants(id,kind,ref_id,granted_at,revoked_at,parent_ref,note) VALUES(?,?,?,?,?,?,?)", uid("gr"), "source", sourceId, ctx.now().toISOString(), share ? null : ctx.now().toISOString(), parentRef ?? null, share ? "You chose to let Claude read this source" : "You took this source back to local-only");
  logShare(ctx, share ? "source_shared" : "source_unshared", "source", sourceId, { detail: String(s.label) });
  logActivity(ctx, share ? "share_source" : "unshare_source", sourceId, `${share ? "Shared with Claude" : "Back to local-only"}: ${s.label}`);
  return sourcesSharing(ctx).find((x) => x.id === sourceId)!;
}

// ---------- results ----------
const citedItemIds = (ctx: Ctx, resultId: string): string[] => { const v = get(ctx.db, "SELECT rv.sources FROM result_versions rv JOIN results r ON r.id=rv.result_id AND r.version=rv.version WHERE r.id=?", resultId); return v ? [...new Set((JSON.parse(v.sources as string) as { itemId: string }[]).map((x) => x.itemId))] : []; };
const latestGrant = (ctx: Ctx, kind: string, ref: string) => get(ctx.db, "SELECT * FROM claude_grants WHERE kind=? AND ref_id=? ORDER BY granted_at DESC, rowid DESC LIMIT 1", kind, ref);
/** May the connector read this result right now? A revoked grant, a source taken back, or any local-only citation closes it.
 *  A brief, or any result that cites nothing Jarvis can point to, is readable only when the user approved it. Everything else is readable when every note it cites is one the user shared. */
export function resultAccess(ctx: Ctx, idOrRequest: string): { allowed: boolean; via: "approved" | "shared-sources" | null; resultId: string | null } {
  const res = get(ctx.db, "SELECT r.id, r.kind FROM results r WHERE (r.id=? OR r.request_id=?) AND r.owner_id=?", idOrRequest, idOrRequest, ctx.owner);
  if (!res) return { allowed: false, via: null, resultId: null };
  const ids = citedItemIds(ctx, res.id as string); const sourcesOk = ids.every((i) => itemShareable(ctx, i));
  const g = latestGrant(ctx, "result", res.id as string);
  if (g) return g.revoked_at || !sourcesOk ? { allowed: false, via: null, resultId: res.id as string } : { allowed: true, via: "approved", resultId: res.id as string };
  if (res.kind !== "brief" && ids.length > 0 && sourcesOk) return { allowed: true, via: "shared-sources", resultId: res.id as string };
  return { allowed: false, via: null, resultId: res.id as string };
}
/** Claude's own goals, and any goal whose result Claude may read, appear in its list. Acting on a goal by id returns only a receipt, never a result body. */
export const requestVisible = (ctx: Ctx, requestId: string) => { const r = get(ctx.db, "SELECT result_id, origin FROM requests WHERE id=? AND owner_id=?", requestId, ctx.owner); return !!r && (r.origin === "claude" || resultAccess(ctx, r.result_id as string).allowed); };

/** Approve one result for Claude. A result that cites a local-only note cannot be approved as it is: it needs a separate shareable view. */
export function grantResult(ctx: Ctx, resultId: string, parentRef?: string) {
  const res = get(ctx.db, "SELECT id,title FROM results WHERE id=? AND owner_id=?", resultId, ctx.owner); if (!res) throw new HttpError(404, "No such result");
  if (get(ctx.db, "SELECT 1 x FROM brief_runs WHERE result_id=? AND view='full'", resultId)) throw new HttpError(409, "This is your private brief: it includes your calendar, course records and notes you keep local-only. Share the Claude-safe view instead.");
  const blocked = citedItemIds(ctx, resultId).filter((i) => !itemShareable(ctx, i));
  if (blocked.length) throw new HttpError(409, "This result cites notes you keep local-only, so Claude cannot be given it as it is. Share the Claude-safe view instead: it contains only what you have shared.");
  run(ctx.db, "INSERT INTO claude_grants(id,kind,ref_id,granted_at,parent_ref,note) VALUES(?,?,?,?,?,?)", uid("gr"), "result", resultId, ctx.now().toISOString(), parentRef ?? null, "You approved this result for Claude");
  logShare(ctx, "result_shared", "result", resultId, { detail: String(res.title) }); logActivity(ctx, "share_result", resultId, `Approved for Claude: ${res.title}`);
  return { resultId, shared: true as const };
}
export function revokeResult(ctx: Ctx, resultId: string) {
  const res = get(ctx.db, "SELECT id,title FROM results WHERE id=? AND owner_id=?", resultId, ctx.owner); if (!res) throw new HttpError(404, "No such result");
  run(ctx.db, "INSERT INTO claude_grants(id,kind,ref_id,granted_at,revoked_at,note) VALUES(?,?,?,?,?,?)", uid("gr"), "result", resultId, ctx.now().toISOString(), ctx.now().toISOString(), "You took this result back from Claude");
  logShare(ctx, "result_unshared", "result", resultId, { detail: String(res.title) }); logActivity(ctx, "unshare_result", resultId, `Taken back from Claude: ${res.title}`);
  return { resultId, shared: false as const };
}
export const resultShared = (ctx: Ctx, resultId: string) => { const g = latestGrant(ctx, "result", resultId); return !!g && !g.revoked_at; };

// ---------- projects ----------
export const projectShared = (ctx: Ctx, projectId: string) => { const g = latestGrant(ctx, "project", projectId); return !!g && !g.revoked_at; };
export function setProjectSharing(ctx: Ctx, projectId: string, share: boolean) {
  const p = get(ctx.db, "SELECT id,name FROM projects WHERE id=? AND owner_id=?", projectId, ctx.owner); if (!p) throw new HttpError(404, "Project not found");
  run(ctx.db, "INSERT INTO claude_grants(id,kind,ref_id,granted_at,revoked_at,note) VALUES(?,?,?,?,?,?)", uid("gr"), "project", projectId, ctx.now().toISOString(), share ? null : ctx.now().toISOString(), share ? "You shared this project's context with Claude" : "You took this project's context back");
  logShare(ctx, share ? "project_shared" : "project_unshared", "project", projectId, { detail: String(p.name) });
  return { projectId, shared: share };
}

// ---------- one project, one understandable path: choose, preview exactly, share, reopen elsewhere, take it all back ----------
/** What sharing THIS project would give Claude, spelled out: the decisions, the notes (and which source each belongs to), and the drafts. Plus what stays private. */
export function projectSharePlan(ctx: Ctx, projectId: string) {
  const p = get(ctx.db, "SELECT id,name FROM projects WHERE (id=? OR slug=?) AND owner_id=?", projectId, projectId, ctx.owner); if (!p) throw new HttpError(404, "Project not found");
  const pid = p.id as string; const ctxP = projectContext(ctx, pid);
  const decisions = [...ctxP.current, ...ctxP.options, ...ctxP.actions, ...ctxP.questions].map((f: any) => ({ key: f.key as string, kind: f.kind as string, text: f.text as string, asOf: f.asOf as string }));
  const srcRows = all(ctx.db, "SELECT s.id, s.label, s.kind, s.shareable, s.local_only, s.revoked_at, s.mode FROM evidence_sources s WHERE s.owner_id=? AND s.kind NOT IN ('calendar','claude') AND EXISTS (SELECT 1 FROM evidence_items i WHERE i.source_id=s.id AND i.tombstone=0 AND i.project_id=?)", ctx.owner, pid);
  const sources = srcRows.map((s) => {
    const items = all(ctx.db, "SELECT i.id, i.title, i.at, i.project_id FROM evidence_items i WHERE i.source_id=? AND i.tombstone=0 ORDER BY i.at DESC", s.id);
    const inProject = items.filter((i) => i.project_id === pid); const others = items.filter((i) => i.project_id !== pid);
    return { id: s.id as string, label: s.label as string, shared: sourceOk(s), revoked: !!s.revoked_at, notes: inProject.map((i) => ({ id: i.id as string, title: i.title as string, at: i.at as string })), alsoInSource: others.map((i) => ({ id: i.id as string, title: i.title as string })) };
  });
  const results = all(ctx.db, "SELECT id,title,kind,version FROM results WHERE owner_id=? AND project_id=? AND version>0 ORDER BY updated_at DESC", ctx.owner, pid).map((r) => {
    const ids = citedItemIds(ctx, r.id as string); const blocked = ids.filter((i) => !itemShareable(ctx, i)); const isBrief = !!get(ctx.db, "SELECT 1 x FROM brief_runs WHERE result_id=? AND view='full'", r.id);
    return { id: r.id as string, title: r.title as string, kind: r.kind as string, version: r.version as number, shared: resultShared(ctx, r.id as string), canShare: !isBrief && blocked.length === 0, blockedBy: isBrief ? ["It is your private brief."] : blocked.map((i) => (get(ctx.db, "SELECT title FROM evidence_items WHERE id=?", i)?.title as string) ?? i) };
  });
  const kept = {
    localOnlyNotes: sources.filter((s) => !s.shared).reduce((n, s) => n + s.notes.length, 0),
    otherProjectsNotes: (get(ctx.db, "SELECT COUNT(*) n FROM evidence_items i JOIN evidence_sources s ON s.id=i.source_id WHERE i.owner_id=? AND i.tombstone=0 AND s.kind NOT IN ('calendar','claude') AND COALESCE(i.project_id,'')!=?", ctx.owner, pid)?.n as number) ?? 0,
    always: ["Your calendar and work blocks", "Your private morning brief", "Notes you keep local-only", "Notes from other projects, unless their own source is shared"],
  };
  return { project: { id: pid, name: p.name as string, shared: projectShared(ctx, pid) }, decisions, sources, results, kept,
    reopen: { tool: "get_project_context", project: p.name as string, resultTool: "get_result" } };
}
/** The one consent: share the project's decisions, plus exactly the sources and drafts you ticked. Everything granted is remembered as part of THIS project so one button can take it all back. */
export function shareProject(ctx: Ctx, projectId: string, o: { sources?: string[]; results?: string[] } = {}) {
  const plan = projectSharePlan(ctx, projectId); const parent = `project:${plan.project.id}`;
  for (const sid of o.sources ?? []) { const src = plan.sources.find((s) => s.id === sid); if (!src) throw new HttpError(422, "That source has no notes in this project."); if (!src.shared) setSourceSharing(ctx, sid, true, parent); }
  setProjectSharing(ctx, plan.project.id, true);
  for (const rid of o.results ?? []) { const r = plan.results.find((x) => x.id === rid); if (!r) throw new HttpError(422, "That result does not belong to this project."); if (!r.shared) grantResult(ctx, rid, parent); }
  logShare(ctx, "project_share_confirmed", "project", plan.project.id, { detail: `${plan.project.name}: ${(o.sources ?? []).length} source(s), ${(o.results ?? []).length} result(s)` });
  return projectSharePlan(ctx, projectId);
}
/** Take back everything this project's sharing granted: the decisions, every result of the project (every version sits under one result id), and the sources shared through it. */
export function unshareProject(ctx: Ctx, projectId: string) {
  const plan = projectSharePlan(ctx, projectId); const parent = `project:${plan.project.id}`;
  for (const r of plan.results) if (r.shared) revokeResult(ctx, r.id);
  for (const s of plan.sources) { const g = latestGrant(ctx, "source", s.id); if (s.shared && g && g.parent_ref === parent) setSourceSharing(ctx, s.id, false, parent); }
  if (plan.project.shared) setProjectSharing(ctx, plan.project.id, false);
  logShare(ctx, "project_unshared_all", "project", plan.project.id, { detail: plan.project.name });
  return projectSharePlan(ctx, projectId);
}

export function sharingState(ctx: Ctx) {
  const results = all(ctx.db, "SELECT r.id, r.title, r.updated_at FROM results r WHERE r.owner_id=? AND r.version>0 ORDER BY r.updated_at DESC LIMIT 40", ctx.owner).map((r) => { const a = resultAccess(ctx, r.id as string); return { id: r.id as string, title: r.title as string, at: r.updated_at as string, claudeCanRead: a.allowed, via: a.via }; });
  const projects = all(ctx.db, "SELECT id,name FROM projects WHERE owner_id=? AND status!='archived' ORDER BY updated_at DESC", ctx.owner).map((p) => ({ id: p.id as string, name: p.name as string, shared: projectShared(ctx, p.id as string) }));
  const log = all(ctx.db, "SELECT at,event,ref_kind,ref_id,tool,client,detail FROM share_log ORDER BY id DESC LIMIT 40");
  return { sources: sourcesSharing(ctx), projects, results: results.filter((r) => r.claudeCanRead).concat(results.filter((r) => !r.claudeCanRead).slice(0, 10)), log };
}

// ---------- the connector boundary ----------
const DENY_TOOLS = new Set(["today", "changed_tasks", "source_status", "get_evidence", "propose_decision"]);
const generic = (message: string) => ({ error: message });
/** Runs before a tool in the private workspace for Claude. Returns a result to send instead of running the tool, or null to run it. */
export function connectorBefore(ctx: Ctx, name: string, args: any): unknown | null {
  if (!claudeScoped(ctx)) return null;
  if (DENY_TOOLS.has(name)) return generic(DENIED);
  if (name === "get_result") { if (!args.id) return null; const a = resultAccess(ctx, args.id); return a.allowed ? null : generic(NOT_FOUND); }
  if (name === "get_reader_task" || name === "get_project_context" || name === "apply_project_update") {
    if (name === "get_reader_task") return null;                 // issues only passages of notes the user shared (see reader.ts eligibleSpans)
    if (!args.project) return null;
    const p = get(ctx.db, "SELECT id FROM projects WHERE owner_id=? AND (id=? OR slug=? OR lower(name)=lower(?))", ctx.owner, args.project, args.project, args.project);
    if (!p) return name === "apply_project_update" ? null : generic("No project matches that name.");
    return projectShared(ctx, p.id as string) ? null : generic("No project matches that name.");
  }
  return null;
}
/** Runs after a tool: filters what a read tool found down to what Claude may see, and records what it was shown. */
export function connectorAfter(ctx: Ctx, name: string, args: any, out: any, client: string | null): unknown {
  if (!claudeScoped(ctx)) return out;
  const log = (kind: string, id: string | null, detail?: string) => logShare(ctx, "disclosed", kind, id, { tool: name, client, detail });
  if (name === "get_result" && !args.id) { const kept = (out.results ?? []).filter((r: any) => resultAccess(ctx, r.id).allowed); return { results: kept }; }
  if (name === "get_result" && out?.id) { log("result", out.id); return out; }
  if (name === "get_goal" && !args.requestId) return { goals: (out.goals ?? []).filter((g: any) => requestVisible(ctx, g.requestId)) };
  if (name === "get_reader_task" && out?.spans) { log("reader_task", args.requestId, `${out.spans.length} passages`); return out; }
  if (name === "search_evidence") { const hits = (out.hits ?? []).filter((h: any) => itemShareable(ctx, h.itemId ?? h.id)); hits.forEach((h: any) => log("item", h.itemId ?? h.id)); return { ...out, hits }; }
  if (name === "recall_from_jarvis") {
    const items = (out.items ?? []).filter((i: any) => i.type === "connection_check" || (i.type === "capture" && get(ctx.db, "SELECT 1 x FROM captures WHERE id=? AND via='mcp'", i.id)) || (i.type === "project_fact" && get(ctx.db, "SELECT 1 x FROM project_facts f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND f.origin IN ('claude','test') ", i.id)));
    return { ...out, items, count: items.length, scope: "Only what Claude itself saved to Jarvis. Your private notes, tasks and commitments are not searchable from Claude." };
  }
  if (name === "get_project_context" && !args.project && out?.projects) return { ...out, projects: out.projects.filter((p: any) => projectShared(ctx, p.id)) };
  if (name === "apply_project_update" && out?.saved) { const p = get(ctx.db, "SELECT id FROM projects WHERE owner_id=? AND (id=? OR slug=? OR lower(name)=lower(?))", ctx.owner, args.project, args.project, args.project); if (p && !projectShared(ctx, p.id as string)) setProjectSharing(ctx, p.id as string, true); }
  return out;
}
