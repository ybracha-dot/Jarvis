// The exact round trip the owner runs with a real Claude account: Claude saves a project decision, Jarvis changes it, a fresh Claude chat reads the change.
// The receipt names each step, its time and the client as it described itself, and says plainly whether that counts as a Claude account or a local test client.
import crypto from "node:crypto";
import { Ctx, get, run, uid, all } from "./db";
import { HttpError } from "./decisions";
import { createProject, findProject, projectContext, editFact } from "./projects";
import { setProjectSharing } from "./share";
import { classifyClient } from "./client-context";

const KEY = "roundtrip-check";
const code = () => `RT-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
export function startRoundTrip(ctx: Ctx, o: { project: string }) {
  const name = o.project.trim(); if (name.length < 2) throw new HttpError(422, "Give the project a name.");
  const p = findProject(ctx, name) ?? createProject(ctx, { name, kind: "project" }); if (ctx.mode === "personal") setProjectSharing(ctx, p.id, true);   /* a connection check the user started: that project is shared on purpose */ const c = code(); const id = uid("rt");
  run(ctx.db, "INSERT INTO roundtrips(id,owner_id,code,project_id,project_name,value_a,value_b,created_at) VALUES(?,?,?,?,?,?,?,?)", id, ctx.owner, c, p.id, p.name, `ALPHA-${c}`, `BRAVO-${c}`, ctx.now().toISOString());
  return roundTripState(ctx, id)!;
}
export function roundTripState(ctx: Ctx, id?: string) {
  const r = id ? get(ctx.db, "SELECT * FROM roundtrips WHERE id=? AND owner_id=?", id, ctx.owner) : get(ctx.db, "SELECT * FROM roundtrips WHERE owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", ctx.owner); if (!r) return null;
  const w = classifyClient(r.written_client as string | null), rd = classifyClient(r.read_client as string | null);
  const done = !!(r.written_at && r.edited_at && r.read_at && r.read_saw === r.value_b);
  const asClaude = done && w.kind === "claude" && rd.kind === "claude";
  return { id: r.id as string, code: r.code as string, project: r.project_name as string, projectId: r.project_id as string, valueA: r.value_a as string, valueB: r.value_b as string, createdAt: r.created_at as string,
    written: r.written_at ? { at: r.written_at as string, client: w.label, kind: w.kind } : null, edited: r.edited_at ? { at: r.edited_at as string } : null, read: r.read_at ? { at: r.read_at as string, client: rd.label, kind: rd.kind, sawChange: r.read_saw === r.value_b, origin: r.read_origin as string | null } : null,
    complete: done, verdict: !done ? "not finished" : asClaude ? "Completed. Both ends reported themselves as Claude. Jarvis cannot verify an account from that, but this is the round trip you asked for." : "Completed with a local test client. This proves the connector works. It does not prove your Claude account can reach Jarvis.",
    say: { write: `Use Jarvis to record a decision on the project “${r.project_name}”. The decision is: ${r.value_a}. Call apply_project_update with project “${r.project_name}”, eventId “${r.code}-1”, and one change: op decide, key “${KEY}”, text “${r.value_a}”. Then show me the receipt.`,
      read: `Using Jarvis, what is the current decision for “${KEY}” on the project “${r.project_name}”? Call get_project_context and quote the decision, its source and its revision.` } };
}
/** Hook for the connector's apply_project_update: Claude's write is recognised by the code in the decision text. */
export function noteRoundTripWrite(ctx: Ctx, projectRef: string, changes: { key?: string; text?: string }[], client: string | null) {
  const c = changes.find((x) => x.key === KEY && typeof x.text === "string" && /ALPHA-RT-[0-9A-F]{4}/.test(x.text)); if (!c) return;
  const r = get(ctx.db, "SELECT * FROM roundtrips WHERE owner_id=? AND value_a=? AND written_at IS NULL", ctx.owner, c.text!.match(/ALPHA-RT-[0-9A-F]{4}/)![0]); if (!r) return;
  const ctxp = projectContext(ctx, r.project_id as string); const f = ctxp.current.find((x) => x.key === KEY);
  run(ctx.db, "UPDATE roundtrips SET written_at=?, written_client=?, fact_id=? WHERE id=?", ctx.now().toISOString(), client ?? "unknown client", f?.id ?? null, r.id);
}
export function editRoundTrip(ctx: Ctx, id: string) {
  const r = get(ctx.db, "SELECT * FROM roundtrips WHERE id=? AND owner_id=?", id, ctx.owner); if (!r) throw new HttpError(404, "Not found"); if (!r.written_at) throw new HttpError(409, "Claude has not saved the decision yet. Do step 1 first.");
  const ctxp = projectContext(ctx, r.project_id as string); const f = ctxp.current.find((x) => x.key === KEY); if (!f) throw new HttpError(409, "The decision is not current any more.");
  editFact(ctx, f.id, r.value_b as string, ctxp.project.revision); run(ctx.db, "UPDATE roundtrips SET edited_at=? WHERE id=?", ctx.now().toISOString(), id); return roundTripState(ctx, id)!;
}
/** Hook for get_project_context: a read that shows the Jarvis-side change counts as the third step. */
export function noteRoundTripRead(ctx: Ctx, ctxp: { project: { id: string }; current: { key: string; text: string; origin: string }[] }, client: string | null) {
  const r = get(ctx.db, "SELECT * FROM roundtrips WHERE owner_id=? AND project_id=? AND edited_at IS NOT NULL AND read_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1", ctx.owner, ctxp.project.id); if (!r) return;
  const f = ctxp.current.find((x) => x.key === KEY); if (!f) return;
  run(ctx.db, "UPDATE roundtrips SET read_at=?, read_client=?, read_saw=?, read_origin=? WHERE id=?", ctx.now().toISOString(), client ?? "unknown client", f.text, f.origin, r.id);
}
export const roundTrips = (ctx: Ctx) => all(ctx.db, "SELECT id FROM roundtrips WHERE owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 5", ctx.owner).map((r) => roundTripState(ctx, r.id as string)!);
