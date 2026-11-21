// Blackboard, read-only, through the calendar feed link a signed-in student can copy from Blackboard.
// What it can confirm: dated events (title, time, the description the instructor wrote). What it cannot: rubrics, instructions, grades.
// What it is not: a portal login. Jarvis never sees a password or Duo. If the link stops working the owner signs in on the official site,
// copies a fresh link, and the same pending work resumes. A provider counts as connected only after a successful read, never because a URL is saved.
import dns from "node:dns/promises";
import net from "node:net";
import { Ctx, all, get, run, getSetting, setSetting, sha, logActivity } from "./db";
import { HttpError } from "./decisions";
import { registerSource, ingestItem, markSource, listSources } from "./evidence";
import { DEFAULT_TZ, zonedToUtc, fmtDateTime } from "./time";
import { enqueueJob } from "./jobs";
import { refreshRequest } from "./assistant";

export const COVERAGE = "Calendar feed. It confirms dated events (title, time and any description). It does not include rubrics, assignment instructions or grades, so those stay unverified.";
export const SOURCE_LABEL = "Blackboard calendar feed";
const MAX_BYTES = 2 * 1024 * 1024;
const REFRESH_MS = 15 * 60_000;
const STALE_MS = 36 * 3600_000;

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: "manual" }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;
let fetcher: Fetcher = (url, init) => fetch(url, init) as any;
export const setFeedFetcher = (f: Fetcher | null) => { fetcher = f ?? ((url, init) => fetch(url, init) as any); };

// ---------- URL safety ----------
const allowLocal = () => process.env.JARVIS_ALLOW_LOCAL_FEEDS === "1";
function privateIp(ip: string) { return net.isIP(ip) === 4 ? /^(10\.|127\.|169\.254\.|192\.168\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) : /^(::1|fc|fd|fe80)/i.test(ip); }
export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL; try { u = new URL(raw.trim()); } catch { throw new HttpError(422, "That is not a web address. Copy the whole calendar link from Blackboard."); }
  if (u.username || u.password) throw new HttpError(422, "The link must not contain a username or password.");
  if (!allowLocal()) {
    if (u.protocol !== "https:") throw new HttpError(422, "The calendar link must start with https://.");
    if (net.isIP(u.hostname) || /^localhost$/i.test(u.hostname) || /\.(local|internal)$/i.test(u.hostname)) throw new HttpError(422, "That address points at this computer or a private network. Use the https link from Blackboard.");
    try { for (const a of await dns.lookup(u.hostname, { all: true })) if (privateIp(a.address)) throw new HttpError(422, "That address resolves to a private network. Use the https link from Blackboard."); } catch (e) { if (e instanceof HttpError) throw e; /* an unresolvable host is reported by the read itself */ }
  }
  return u;
}
export const maskUrl = (raw: string) => { try { const u = new URL(raw); return `${u.protocol}//${u.host}/…${raw.slice(-4)}`; } catch { return "…"; } };

// ---------- ICS ----------
export interface FeedEvent { uid: string; summary: string; description: string; start: Date | null; allDay: boolean; tz: string; lastModified: string | null; cancelled: boolean; sequence: number }
const unescapeIcs = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
export function parseFeed(text: string): { events: FeedEvent[]; warnings: string[] } {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new HttpError(422, "That did not look like a calendar feed.");
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n"); const events: FeedEvent[] = []; const warnings: string[] = []; const seen = new Set<string>();
  let cur: Record<string, { p: Record<string, string>; v: string }> | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; continue; }
    if (/^END:VEVENT/i.test(line) && cur) {
      const c = cur; cur = null; const uid = c.UID?.v; if (!uid) { warnings.push("An event without a UID was skipped."); continue; } if (seen.has(uid)) continue; seen.add(uid);
      const ds = c.DTSTART; let start: Date | null = null; let allDay = false; const tz = ds?.p.TZID ?? DEFAULT_TZ;
      if (ds) { if (ds.p.VALUE === "DATE" || /^\d{8}$/.test(ds.v)) { allDay = true; const m = /^(\d{4})(\d{2})(\d{2})/.exec(ds.v); if (m) start = zonedToUtc(+m[1], +m[2], +m[3], 12, 0, tz); }
        else { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(ds.v); if (m) start = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : (() => { try { return zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz); } catch { return null; } })(); } }
      if (!start) warnings.push(`"${unescapeIcs(c.SUMMARY?.v ?? "(untitled)")}" has no readable start.`);
      const lm = c["LAST-MODIFIED"]?.v ?? c.DTSTAMP?.v ?? null; const lmIso = lm && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.test(lm) ? lm.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z") : null;
      events.push({ uid, summary: unescapeIcs(c.SUMMARY?.v ?? "(untitled)").trim(), description: unescapeIcs(c.DESCRIPTION?.v ?? "").trim(), start, allDay, tz, lastModified: lmIso, cancelled: /CANCELLED/i.test(c.STATUS?.v ?? ""), sequence: Number(c.SEQUENCE?.v ?? 0) });
      continue;
    }
    if (!cur) continue; const m = /^([A-Za-z-]+)((?:;[^:]+)*):(.*)$/.exec(line); if (!m) continue;
    const p: Record<string, string> = {}; for (const part of m[2].split(";").filter(Boolean)) { const [k, v] = part.split("="); p[k.toUpperCase()] = v; }
    cur[m[1].toUpperCase()] = { p, v: m[3] };
  }
  return { events, warnings };
}
const fmtEvent = (e: FeedEvent) => e.start ? new Date(e.start).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", ...(e.allDay ? {} : { hour: "numeric", minute: "2-digit" }), timeZone: e.tz }) : "date not stated";
/** The words of the event as an evidence item, so the usual extraction finds its date and a change shows as a new revision. */
export function eventBody(e: FeedEvent): string {
  return [e.summary + (e.cancelled ? " (cancelled)" : ""), `${e.cancelled ? "Was scheduled" : "Due"}: ${fmtEvent(e)}${e.allDay ? "" : ` (${e.tz})`}.`, e.description ? e.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500) : ""].filter(Boolean).join("\n");
}

// ---------- configuration (the link is a secret: stored locally, never returned, never logged) ----------
interface Cfg { url: string; savedAt: string }
const cfg = (ctx: Ctx) => getSetting<Cfg | null>(ctx.db, "blackboard_feed", null);
export function blackboardStatus(ctx: Ctx) {
  const c = cfg(ctx); const src = listSources(ctx).find((s) => s.label === SOURCE_LABEL);
  const st = get(ctx.db, "SELECT * FROM feed_state WHERE source_id=?", src?.id ?? "");
  const connected = !!src && src.state === "ok" && !!src.lastSuccessAt && !src.revokedAt;
  return { configured: !!c, linkHint: c ? maskUrl(c.url) : null, connected, state: !c ? "not_configured" : src?.state ?? "pending", message: src?.message ?? null, lastAttemptAt: src?.lastAttemptAt ?? null, lastSuccessAt: src?.lastSuccessAt ?? null, items: src?.items ?? 0,
    lastStatus: (st?.last_status as string) ?? null, coverage: COVERAGE, ownerAccount: "pending: not run on your account until you paste your own link and a read succeeds", mode: connected ? "live" : "unavailable" };
}
export function removeFeed(ctx: Ctx) { setSetting(ctx.db, "blackboard_feed", null); const src = listSources(ctx).find((s) => s.label === SOURCE_LABEL); if (src) markSource(ctx, src.id, { state: "pending", message: "Disconnected. The link was removed from this computer. Items already read are kept until you forget them." }); logActivity(ctx, "blackboard_removed", null, "Blackboard calendar link removed"); return { ok: true }; }

// ---------- reading ----------
export interface ReadResult { ok: boolean; kind: "ok" | "unchanged" | "needs_signin" | "expired" | "rate_limited" | "unreadable" | "unreachable" | "invalid"; message: string; events?: number; changed?: number; created?: number; range?: { from: string; to: string } | null; retryAfter?: number; resumed?: string[] }
async function get_(url: string, headers: Record<string, string>) {
  let target = url;
  for (let hop = 0; hop < 4; hop++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15_000);
    try { const r = await fetcher(target, { headers, signal: ac.signal, redirect: "manual" }); if ([301, 302, 303, 307, 308].includes(r.status)) { const loc = r.headers.get("location"); if (!loc) return r; const next = new URL(loc, target); if (next.protocol !== new URL(url).protocol) throw new Error("redirect to a different protocol"); await assertSafeUrl(next.toString()); target = next.toString(); continue; } return r; }
    finally { clearTimeout(t); }
  }
  throw new Error("too many redirects");
}
const looksLikeLogin = (body: string) => /<html|<!doctype/i.test(body.slice(0, 400)) && /(sign in|log in|login|duo|authenticate|single sign)/i.test(body.slice(0, 6000));

/** Read the feed. dryRun only checks it (the setup check). Otherwise events become evidence items and changes become revisions. */
export async function readFeed(ctx: Ctx, o: { dryRun?: boolean; url?: string } = {}): Promise<ReadResult> {
  const c = cfg(ctx); const url = o.url ?? c?.url; if (!url) return { ok: false, kind: "invalid", message: "No calendar link is saved yet." };
  try { await assertSafeUrl(url); } catch (e) { return { ok: false, kind: "invalid", message: (e as Error).message }; }
  const src = registerSource(ctx, { kind: "calendar", label: SOURCE_LABEL, mode: "unavailable", state: "pending", message: "Waiting for the first successful read." });
  const stRow = get(ctx.db, "SELECT * FROM feed_state WHERE source_id=?", src.id);
  const headers: Record<string, string> = { accept: "text/calendar, text/plain;q=0.8", "user-agent": "Jarvis/1 (read-only calendar feed)" };
  if (!o.dryRun) { if (stRow?.etag) headers["if-none-match"] = String(stRow.etag); if (stRow?.last_modified) headers["if-modified-since"] = String(stRow.last_modified); }
  const fail = (kind: ReadResult["kind"], message: string, state: string, status: string, retryAfter?: number): ReadResult => {
    if (!o.dryRun) { markSource(ctx, src.id, { state, message, attempt: true }); run(ctx.db, "INSERT OR REPLACE INTO feed_state(source_id,etag,last_modified,last_status,checked_at) VALUES(?,?,?,?,?)", src.id, stRow?.etag ?? null, stRow?.last_modified ?? null, status, ctx.now().toISOString()); if (kind === "needs_signin" || kind === "expired") ensureSignInJob(ctx, message); }
    return { ok: false, kind, message, retryAfter };
  };
  let res; try { res = await get_(url, headers); } catch (e) { return fail("unreachable", `Could not reach Blackboard: ${(e as Error).message}. Check the connection and try again. Nothing was changed.`, "failed", "unreachable"); }
  if (res.status === 304) { if (!o.dryRun) { markSource(ctx, src.id, { state: "ok", message: null, attempt: true, success: true }); run(ctx.db, "UPDATE feed_state SET last_status='unchanged', checked_at=? WHERE source_id=?", ctx.now().toISOString(), src.id); } return { ok: true, kind: "unchanged", message: "Nothing changed since the last read." }; }
  if (res.status === 401 || res.status === 403) return fail("needs_signin", "Blackboard did not accept the calendar link (it may need you to sign in again). Open Blackboard, sign in (including Duo), copy your calendar link again, and paste it here.", "needs_signin", String(res.status));
  if (res.status === 404 || res.status === 410) return fail("expired", "Blackboard says this calendar link no longer exists. Open Blackboard, sign in, copy a fresh calendar link, and paste it here.", "needs_signin", String(res.status));
  if (res.status === 429) { const ra = Number(res.headers.get("retry-after") ?? 0) || 900; return fail("rate_limited", `Blackboard asked Jarvis to slow down. It will try again in about ${Math.ceil(ra / 60)} minutes. Your earlier reads are unchanged.`, "stale", "429", ra); }
  if (res.status >= 500) return fail("unreachable", `Blackboard had a problem (${res.status}). Jarvis will try again later. Your earlier reads are unchanged.`, "failed", String(res.status));
  if (res.status !== 200) return fail("unreadable", `Blackboard answered with status ${res.status}, which Jarvis does not understand.`, "failed", String(res.status));
  let body = await res.text(); if (body.length > MAX_BYTES) return fail("unreadable", "The calendar feed is larger than 2 MB, so it was not read.", "failed", "toolarge");
  if (looksLikeLogin(body)) return fail("needs_signin", "Blackboard answered with a sign-in page instead of a calendar. Sign in on the Blackboard site (including Duo), copy your calendar link again, and paste it here.", "needs_signin", "login-page");
  let parsed; try { parsed = parseFeed(body); } catch (e) { return fail("unreadable", `${(e as Error).message} Make sure you copied the calendar link, not the page address.`, "failed", "not-ics"); }
  const dated = parsed.events.filter((e) => e.start); const range = dated.length ? { from: new Date(Math.min(...dated.map((e) => +e.start!))).toISOString().slice(0, 10), to: new Date(Math.max(...dated.map((e) => +e.start!))).toISOString().slice(0, 10) } : null;
  if (o.dryRun) return { ok: true, kind: "ok", message: `Readable: ${parsed.events.length} events${range ? `, from ${range.from} to ${range.to}` : ""}. ${COVERAGE}`, events: parsed.events.length, range };
  let created = 0, changed = 0; const seenIds = new Set<string>();
  for (const e of parsed.events) {
    const r = ingestItem(ctx, { sourceId: src.id, externalId: e.uid, kind: "calendar", title: e.summary, author: "Blackboard", at: e.lastModified ?? ctx.now().toISOString(), body: eventBody(e), projectId: null });
    seenIds.add(r.id); if (r.created) created++; else if (r.revised) changed++;
  }
  // An event that disappears from the feed is not silently kept as current.
  for (const row of all(ctx.db, "SELECT id, external_id, title, body FROM evidence_items WHERE source_id=? AND tombstone=0", src.id)) if (!seenIds.has(row.id as string) && !/no longer appears in the feed/.test(String(row.body))) { ingestItem(ctx, { sourceId: src.id, externalId: row.external_id as string, kind: "calendar", title: row.title as string, author: "Blackboard", at: ctx.now().toISOString(), body: `${row.title}\nThis event no longer appears in the Blackboard feed (removed or cancelled).` }); changed++; }
  const wasDown = ["needs_signin", "failed", "stale"].includes(src.state);
  run(ctx.db, "UPDATE evidence_sources SET mode='live', state='ok', message=NULL WHERE id=?", src.id);
  markSource(ctx, src.id, { state: "ok", message: null, attempt: true, success: true });
  run(ctx.db, "INSERT OR REPLACE INTO feed_state(source_id,etag,last_modified,last_status,checked_at) VALUES(?,?,?,?,?)", src.id, res.headers.get("etag"), res.headers.get("last-modified"), "ok", ctx.now().toISOString());
  const resumed: string[] = [];
  if (wasDown) for (const id of resumePending(ctx, src.id).slice(0, 3)) { try { refreshRequest(ctx, id); resumed.push(id); } catch { /* the request may be gone */ } }
  return { ok: true, kind: "ok", message: `Read ${parsed.events.length} events (${created} new, ${changed} changed).${resumed.length ? ` Resumed ${resumed.length} pending request${resumed.length === 1 ? "" : "s"} that were waiting for Blackboard.` : ""}`, events: parsed.events.length, changed, created, range, resumed };
}

export async function saveFeed(ctx: Ctx, url: string) {
  const u = await assertSafeUrl(url);
  const check = await readFeed(ctx, { dryRun: true, url: u.toString() });
  if (!check.ok) return { saved: false, check };
  setSetting(ctx.db, "blackboard_feed", { url: u.toString(), savedAt: ctx.now().toISOString() } satisfies Cfg);
  logActivity(ctx, "blackboard_saved", null, `Blackboard calendar link saved (${maskUrl(u.toString())})`);   // the masked hint, never the link
  const first = await readFeed(ctx); return { saved: true, check, read: first };
}

/** The sign-in handoff. A blocked job tells the owner exactly what to do; replacing the link (or pressing resume) re-reads and resumes pending work. */
function ensureSignInJob(ctx: Ctx, message: string) {
  const key = `blackboard-signin:${new Date(ctx.now()).toISOString().slice(0, 10)}`;
  const j = enqueueJob(ctx, { dedupKey: key, kind: "blackboard_signin", role: "Intake", area: "intake", title: "Blackboard needs you to sign in", input: {}, evidenceIds: [], tools: [], budget: { modelCalls: 0 }, criteria: ["You re-copied the calendar link"], synthetic: false });
  run(ctx.db, "UPDATE jobs SET status='blocked', error=?, result=?, stage=? WHERE id=? AND status='queued'", message, JSON.stringify({ ask: { question: message, choices: [{ id: "retry", guideId: "retry", label: "I pasted a fresh link. Read again" }] } }), "Waiting for you to sign in on Blackboard", j.id);
}
/** After access returns, the same pending requests are re-run so their result (same link) gains what was missing. */
export function resumePending(ctx: Ctx, sourceId: string) {
  run(ctx.db, "UPDATE jobs SET status='done', result=?, error=NULL, finished_at=? WHERE kind='blackboard_signin' AND status='blocked' AND owner_id=?", JSON.stringify({ resumed: true }), Date.now(), ctx.owner);
  const label = SOURCE_LABEL; const out: string[] = [];
  for (const r of all(ctx.db, "SELECT r.id, r.request_id, rv.unavailable FROM results r JOIN result_versions rv ON rv.result_id=r.id AND rv.version=r.version WHERE r.owner_id=? ORDER BY r.updated_at DESC LIMIT 20", ctx.owner)) {
    const un = JSON.parse(r.unavailable as string) as { label: string }[]; if (un.some((u) => /blackboard/i.test(u.label) || u.label === label)) out.push(r.request_id as string);
  }
  void sourceId; return out;
}
export const isFeedDue = (ctx: Ctx) => { if (!cfg(ctx)) return false; const s = listSources(ctx).find((x) => x.label === SOURCE_LABEL); if (!s?.lastAttemptAt) return true; return ctx.now().getTime() - Date.parse(s.lastAttemptAt) >= REFRESH_MS && s.state !== "needs_signin"; };
/** A feed not read for a day and a half is stale, said once and cleared by the next good read. */
export function refreshFreshness(ctx: Ctx) {
  const s = listSources(ctx).find((x) => x.label === SOURCE_LABEL); if (!s || s.state !== "ok" || !s.lastSuccessAt) return;
  if (ctx.now().getTime() - Date.parse(s.lastSuccessAt) > STALE_MS) markSource(ctx, s.id, { state: "stale", message: `Last read ${fmtDateTime(s.lastSuccessAt)}. Jarvis has not been able to read it since. Check the link or the connection.` });
}
export const feedHash = (t: string) => sha(t).slice(0, 12);
