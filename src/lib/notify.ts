// Delivery levels, quiet hours, inbox and outbox. Deterministic. No external sends unless a channel is explicitly enabled.
import { Ctx, all, get, run, getSetting, uid, logActivity } from "./db";
import { parseLocal, localDate, addDays, DEFAULT_TZ, fmtDateTime } from "./time";

export type Level = "interrupt" | "brief" | "silent";
export interface ChannelConfig { inbox: boolean; capture: boolean; push: boolean; sms: boolean }
export const captureSink: { eventKey: string; channel: string; payload: unknown }[] = [];

export function channelConfig(ctx: Ctx): ChannelConfig {
  return getSetting<ChannelConfig>(ctx.db, "channels", { inbox: true, capture: false, push: false, sms: false });
}

export function nextBriefAfter(ctx: Ctx, from: Date): Date {
  const tz = getSetting(ctx.db, "tz", DEFAULT_TZ);
  const times = getSetting<string[]>(ctx.db, "check_times", ["08:00", "16:00"]);
  let d = localDate(from, tz);
  for (let i = 0; i < 3; i++) {
    for (const t of [...times].sort()) {
      const at = parseLocal(d, t, tz);
      if (at.getTime() > from.getTime()) return at;
    }
    d = addDays(d, 1);
  }
  return new Date(from.getTime() + 86400000);
}

/** If `at` falls in a quiet period, returns when the period ends. */
export function quietUntil(ctx: Ctx, at: Date): Date | null {
  const tz = getSetting(ctx.db, "tz", DEFAULT_TZ);
  const daily = getSetting<{ start: string; end: string }[]>(ctx.db, "quiet_daily", []);
  const intervals = getSetting<{ start: string; end: string }[]>(ctx.db, "quiet_intervals", []);
  let latest: Date | null = null;
  const consider = (e: Date) => { if (!latest || e > latest) latest = e; };
  for (const i of intervals) if (at >= new Date(i.start) && at < new Date(i.end)) consider(new Date(i.end));
  const day = localDate(at, tz);
  for (const q of daily) {
    for (const base of [addDays(day, -1), day]) {
      const s = parseLocal(base, q.start, tz);
      let e = parseLocal(base, q.end, tz);
      if (e <= s) e = parseLocal(addDays(base, 1), q.end, tz);
      if (at >= s && at < e) consider(e);
    }
  }
  return latest;
}

export function classify(ctx: Ctx, expiresAt: string | null, kind: string): { level: Level; reason: string } {
  const now = ctx.now();
  if (kind === "requirement_waived" || kind === "info") return { level: "silent", reason: "Informational. Updated silently." };
  if (expiresAt) {
    const nb = nextBriefAfter(ctx, now);
    if (new Date(expiresAt) < nb) {
      return { level: "interrupt", reason: `This expires ${fmtDateTime(expiresAt)}, before the next brief at ${fmtDateTime(nb.toISOString())}.` };
    }
    return { level: "brief", reason: `Safe to wait. It expires ${fmtDateTime(expiresAt)}, after the next brief at ${fmtDateTime(nb.toISOString())}.` };
  }
  return { level: "brief", reason: "No expiry. Included in the next brief." };
}

export function enqueue(ctx: Ctx, o: { eventKey: string; level: Level; title: string; body: string; decisionId?: string }): void {
  const at = ctx.now().toISOString();
  // In-app inbox works offline and is the source of truth.
  run(ctx.db, "INSERT OR IGNORE INTO inbox(id,at,level,title,body,decision_id,event_key) VALUES(?,?,?,?,?,?,?)",
    uid("inb"), at, o.level, o.title, o.body, o.decisionId ?? null, o.eventKey);
  if (o.level === "silent") return;
  const cfg = channelConfig(ctx);
  const quiet = o.level === "interrupt" ? quietUntil(ctx, ctx.now()) : null;
  for (const channel of ["capture", "push", "sms"] as const) {
    if (!cfg[channel]) continue;
    run(ctx.db,
      "INSERT OR IGNORE INTO deliveries(id,event_key,channel,status,level,payload,created_at,deliver_after) VALUES(?,?,?,?,?,?,?,?)",
      uid("dlv"), o.eventKey, channel, quiet ? "deferred" : "pending", o.level,
      JSON.stringify({ title: o.title, body: o.body, decisionId: o.decisionId }), at, quiet ? quiet.toISOString() : at);
  }
}

export type Transport = (payload: any, d: { eventKey: string; channel: string }) => Promise<{ receipt: string }>;
export const defaultTransports: Record<string, Transport> = {
  capture: async (payload, d) => { captureSink.push({ eventKey: d.eventKey, channel: d.channel, payload }); return { receipt: `capture:${captureSink.length}` }; },
};

/** Send due deliveries once. Failures back off and retry. A sent delivery is never re-sent. */
export async function drainOutbox(ctx: Ctx, transports: Record<string, Transport> = defaultTransports): Promise<{ sent: number; deferred: number; failed: number }> {
  const now = ctx.now();
  const rows = all(ctx.db, "SELECT * FROM deliveries WHERE status IN ('pending','deferred') AND deliver_after<=? ORDER BY created_at", now.toISOString());
  let sent = 0, deferred = 0, failed = 0;
  for (const r of rows) {
    const q = quietUntil(ctx, now);
    if (r.level === "interrupt" && q) {
      run(ctx.db, "UPDATE deliveries SET status='deferred', deliver_after=? WHERE id=?", q.toISOString(), r.id);
      deferred++; continue;
    }
    // Claim the row first so a concurrent drain cannot send it twice.
    const claim = run(ctx.db, "UPDATE deliveries SET status='sending', attempts=attempts+1 WHERE id=? AND status IN ('pending','deferred')", r.id);
    if (Number(claim.changes) === 0) continue;
    const tr = transports[r.channel];
    try {
      if (!tr) throw new Error(`No transport configured for ${r.channel}`);
      const res = await tr(JSON.parse(r.payload), { eventKey: r.event_key, channel: r.channel });
      run(ctx.db, "UPDATE deliveries SET status='sent', sent_at=?, receipt=? WHERE id=?", now.toISOString(), res.receipt, r.id);
      sent++;
    } catch (e) {
      const attempts = Number(r.attempts) + 1;
      if (attempts >= 3) { run(ctx.db, "UPDATE deliveries SET status='failed', receipt=? WHERE id=?", (e as Error).message, r.id); failed++; }
      else run(ctx.db, "UPDATE deliveries SET status='pending', deliver_after=?, receipt=? WHERE id=?",
        new Date(now.getTime() + 2 ** attempts * 60000).toISOString(), (e as Error).message, r.id);
    }
  }
  if (sent || failed) logActivity(ctx, "outbox", null, `Outbox: ${sent} sent, ${deferred} deferred, ${failed} failed`);
  return { sent, deferred, failed };
}

export function inbox(ctx: Ctx, limit = 30) {
  return all(ctx.db, "SELECT * FROM inbox ORDER BY at DESC, rowid DESC LIMIT ?", limit);
}
export const unreadCount = (ctx: Ctx) => (get(ctx.db, "SELECT COUNT(*) n FROM inbox WHERE read=0 AND level!='silent'")?.n as number) ?? 0;
