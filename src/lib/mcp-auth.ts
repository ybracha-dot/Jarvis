// Connector credentials. A token is shown once, stored only as a SHA-256 hash, scoped (read or read+write), optionally expiring, and revocable.
// The raw value never goes into the database, activity log, URLs or API list responses. Mode is encoded in the prefix so the route knows which workspace to open.
import crypto from "node:crypto";
import { z } from "zod";
import { Ctx, Mode, all, get, run, uid, makeCtx, logActivity } from "./db";
import { HttpError } from "./decisions";

export const SCOPES = ["read", "write"] as const;
export type Scope = (typeof SCOPES)[number];
const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
const prefix = (mode: Mode) => (mode === "personal" ? "jvs_p_" : "jvs_d_");

export const NewToken = z.object({ label: z.string().trim().min(1).max(60), scopes: z.array(z.enum(SCOPES)).min(1).default(["read", "write"]), expiresInDays: z.number().int().min(1).max(365).nullable().default(null) }).strict();

export function createToken(ctx: Ctx, raw: z.input<typeof NewToken>) {
  const i = NewToken.parse(raw);
  const secret = `${prefix(ctx.mode)}${crypto.randomBytes(32).toString("base64url")}`;
  const now = ctx.now(); const id = uid("tok");
  const scopes = i.scopes.includes("write") ? ["read", "write"] : ["read"];
  run(ctx.db, "INSERT INTO mcp_tokens(id,owner_id,label,hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?)", id, ctx.owner, i.label, hash(secret), JSON.stringify(scopes), now.toISOString(), i.expiresInDays ? new Date(now.getTime() + i.expiresInDays * 86400_000).toISOString() : null);
  logActivity(ctx, "token_created", id, `Connector token created: ${i.label} (${scopes.join("+")})`);   // the label, never the secret
  return { id, token: secret, hint: secret.slice(0, 10) + "…", label: i.label, scopes, expiresAt: i.expiresInDays ? new Date(now.getTime() + i.expiresInDays * 86400_000).toISOString() : null };
}
export const listTokens = (ctx: Ctx) => all(ctx.db, "SELECT id,label,scopes,created_at,expires_at,last_used_at,revoked_at,last_client,last_client_at FROM mcp_tokens WHERE owner_id=? ORDER BY created_at DESC", ctx.owner).map((t) => ({
  id: t.id as string, label: t.label as string, scopes: JSON.parse(t.scopes as string) as Scope[], createdAt: t.created_at as string, expiresAt: t.expires_at as string | null, lastUsedAt: t.last_used_at as string | null, revokedAt: t.revoked_at as string | null, lastClient: (t.last_client as string | null) ?? null, lastClientAt: (t.last_client_at as string | null) ?? null,
  status: t.revoked_at ? "revoked" : t.expires_at && t.expires_at < ctx.now().toISOString() ? "expired" : "active" }));
export function revokeToken(ctx: Ctx, id: string) {
  const t = get(ctx.db, "SELECT label FROM mcp_tokens WHERE id=? AND owner_id=?", id, ctx.owner); if (!t) throw new HttpError(404, "Token not found");
  run(ctx.db, "UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=?", ctx.now().toISOString(), id);
  logActivity(ctx, "token_revoked", id, `Connector token revoked: ${t.label}`); return { ok: true };
}
/** Rotate: a new token with the same label and scopes, and the old one revoked in the same step. */
export function rotateToken(ctx: Ctx, id: string) {
  const t = get(ctx.db, "SELECT label,scopes,expires_at,created_at FROM mcp_tokens WHERE id=? AND owner_id=? AND revoked_at IS NULL", id, ctx.owner); if (!t) throw new HttpError(404, "Active token not found");
  const days = t.expires_at ? Math.max(1, Math.round((Date.parse(t.expires_at as string) - Date.parse(t.created_at as string)) / 86400_000)) : null;
  const next = createToken(ctx, { label: t.label as string, scopes: JSON.parse(t.scopes as string), expiresInDays: days }); revokeToken(ctx, id); return next;
}

export interface Principal { id: string; mode: Mode; scopes: Scope[]; label: string }
const buckets = new Map<string, number[]>();
/** At most 120 calls a minute per token. */
export function rateLimited(tokenId: string, now = Date.now()) { const w = (buckets.get(tokenId) ?? []).filter((t) => now - t < 60_000); w.push(now); buckets.set(tokenId, w); return w.length > 120; }

export function verifyToken(rawBearer: string): Principal | null {
  const m = /^jvs_([pd])_[A-Za-z0-9_-]{43}$/.exec(rawBearer); if (!m) return null;
  const mode: Mode = m[1] === "p" ? "personal" : "demo"; const ctx = makeCtx(mode);
  const row = get(ctx.db, "SELECT id,label,scopes,expires_at,revoked_at FROM mcp_tokens WHERE hash=?", hash(rawBearer));
  if (!row || row.revoked_at || (row.expires_at && (row.expires_at as string) < new Date().toISOString())) return null;
  run(ctx.db, "UPDATE mcp_tokens SET last_used_at=? WHERE id=?", new Date().toISOString(), row.id);
  return { id: row.id as string, mode, scopes: JSON.parse(row.scopes as string), label: row.label as string };
}

// ---- Two-way connection proof ----
// 1) Ask ordinary Claude to save the code (Claude -> Jarvis). 2) Jarvis edits the saved note (Jarvis changes state). 3) Ask Claude to read it back (Jarvis -> Claude).
const WORDS = ["ORANGE-HERON", "VIOLET-OTTER", "AMBER-LYNX", "COBALT-FINCH", "JADE-MARTEN", "SCARLET-WREN"];
export function startProbe(ctx: Ctx) {
  const code = `JV-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; const id = uid("prb"); const marker = WORDS[crypto.randomInt(WORDS.length)] + "-" + crypto.randomInt(10, 99);
  run(ctx.db, "INSERT INTO connection_probes(id,owner_id,code,edit_marker,created_at) VALUES(?,?,?,?,?)", id, ctx.owner, code, marker, ctx.now().toISOString());
  return probeState(ctx, id)!;
}
export function probeState(ctx: Ctx, id?: string) {
  const p = id ? get(ctx.db, "SELECT * FROM connection_probes WHERE id=? AND owner_id=?", id, ctx.owner) : get(ctx.db, "SELECT * FROM connection_probes WHERE owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", ctx.owner); if (!p) return null;
  return { id: p.id as string, code: p.code as string, createdAt: p.created_at as string, written: p.written_at ? { at: p.written_at as string, via: p.written_client as string | null, noteId: p.note_id as string | null } : null, edited: p.edited_at ? { at: p.edited_at as string, marker: p.edit_marker as string } : null, read: p.read_at ? { at: p.read_at as string, via: p.read_client as string | null, sawMarker: p.read_stamp === p.edit_marker } : null,
    complete: !!(p.written_at && p.edited_at && p.read_at && p.read_stamp === p.edit_marker),
    say: { write: `Use Jarvis to save this exactly: "Remember for Jarvis: connection check ${p.code}"`, read: `Ask Jarvis what it has saved for connection check ${p.code}, and tell me the marker word it shows.` } };
}
/** Called by capture when a saved text carries a probe code. */
export function noteProbeWrite(ctx: Ctx, text: string, noteId: string | null, captureId: string, via: string | null) {
  const m = /\bJV-[0-9A-F]{6}\b/.exec(text); if (!m) return;
  run(ctx.db, "UPDATE connection_probes SET written_at=COALESCE(written_at,?), written_client=?, note_id=?, capture_id=? WHERE owner_id=? AND code=? AND written_at IS NULL", ctx.now().toISOString(), via, noteId, captureId, ctx.owner, m[0]);
}
export function editProbe(ctx: Ctx, id: string) {
  const p = get(ctx.db, "SELECT * FROM connection_probes WHERE id=? AND owner_id=?", id, ctx.owner); if (!p) throw new HttpError(404, "Check not found");
  if (!p.written_at || !p.note_id) throw new HttpError(409, "Claude has not saved the code yet. Do step 1 first.");
  const n = get(ctx.db, "SELECT body FROM notes WHERE id=? AND owner_id=? AND tombstone=0", p.note_id, ctx.owner); if (!n) throw new HttpError(409, "The saved note was removed.");
  run(ctx.db, "UPDATE notes SET body=?, updated_at=?, user_edited=1 WHERE id=?", `${n.body}\n\nEdited in Jarvis. Marker: ${p.edit_marker}`, ctx.now().toISOString(), p.note_id);
  run(ctx.db, "UPDATE connection_probes SET edited_at=COALESCE(edited_at,?) WHERE id=?", ctx.now().toISOString(), id);
  return probeState(ctx, id)!;
}
/** Called by recall when the query carries a probe code: Claude proves it can read what Jarvis now holds. */
export function noteProbeRead(ctx: Ctx, query: string, via: string | null): { probeNote: string } | null {
  const m = /\bJV-[0-9A-F]{6}\b/.exec(query); if (!m) return null;
  const p = get(ctx.db, "SELECT * FROM connection_probes WHERE owner_id=? AND code=?", ctx.owner, m[0]); if (!p || !p.note_id) return null;
  const n = get(ctx.db, "SELECT body FROM notes WHERE id=? AND owner_id=? AND tombstone=0", p.note_id, ctx.owner); if (!n) return null;
  const body = String(n.body); const saw = p.edited_at && body.includes(p.edit_marker as string);
  if (saw) run(ctx.db, "UPDATE connection_probes SET read_at=COALESCE(read_at,?), read_client=?, read_stamp=? WHERE id=?", ctx.now().toISOString(), via, p.edit_marker, p.id);
  return { probeNote: body };
}

export function rememberClient(mode: Mode, tokenId: string, client: string) { const ctx = makeCtx(mode); run(ctx.db, "UPDATE mcp_tokens SET last_client=?, last_client_at=? WHERE id=?", client, new Date().toISOString(), tokenId); }
export function lastClient(mode: Mode, tokenId: string): string | null { return (get(makeCtx(mode).db, "SELECT last_client FROM mcp_tokens WHERE id=?", tokenId)?.last_client as string | null) ?? null; }
