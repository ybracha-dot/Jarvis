// Deterministic capacity planner. Zero model calls.
import { Ctx, all, getSetting } from "./db";
import { parseLocal, localDate, addDays, minutesBetween, DEFAULT_TZ } from "./time";

export interface Interval { start: number; end: number; label?: string; kind?: string }
export interface Chunk { start: string; end: string; minutes: number }

export interface PlannerSettings {
  dayStart: string; dayEnd: string; bufferMin: number; minChunk: number; maxChunk: number; dueBufferMin: number;
  protectedDaily: { start: string; end: string; label: string }[];
  protectedIntervals: { start: string; end: string; label: string; source: string }[];
  tz: string;
}
export function plannerSettings(ctx: Ctx): PlannerSettings {
  return {
    dayStart: getSetting(ctx.db, "day_start", "08:00"),
    dayEnd: getSetting(ctx.db, "day_end", "22:00"),
    bufferMin: getSetting(ctx.db, "buffer_min", 10),
    minChunk: getSetting(ctx.db, "min_chunk", 30),
    maxChunk: getSetting(ctx.db, "max_chunk", 90),
    dueBufferMin: getSetting(ctx.db, "due_buffer_min", 60),
    protectedDaily: getSetting(ctx.db, "protected_daily", []),
    protectedIntervals: getSetting(ctx.db, "protected_intervals", []),
    tz: getSetting(ctx.db, "tz", DEFAULT_TZ),
  };
}

const MIN = 60000;
const roundUp15 = (ms: number) => Math.ceil(ms / (15 * MIN)) * 15 * MIN;

/** All busy intervals (calendar, protected, proposed, booked, daily protection, user quiet periods) in [from, to). */
export function busyIntervals(ctx: Ctx, from: Date, to: Date, opts: { excludeTaskId?: string; excludeDecisionId?: string } = {}): Interval[] {
  const s = plannerSettings(ctx);
  const out: Interval[] = [];
  const rows = all(ctx.db,
    "SELECT start_at,end_at,kind,title,task_id,decision_id FROM blocks WHERE owner_id=? AND state='active' AND end_at>? AND start_at<?",
    ctx.owner, from.toISOString(), to.toISOString());
  for (const r of rows) {
    if (opts.excludeTaskId && r.task_id === opts.excludeTaskId && (r.kind === "proposed" || r.kind === "booked")) continue;
    if (opts.excludeDecisionId && r.decision_id === opts.excludeDecisionId) continue;
    out.push({ start: new Date(r.start_at).getTime(), end: new Date(r.end_at).getTime(), label: r.title, kind: r.kind });
  }
  for (const p of s.protectedIntervals) {
    const a = new Date(p.start).getTime(), b = new Date(p.end).getTime();
    if (b > from.getTime() && a < to.getTime()) out.push({ start: a, end: b, label: p.label, kind: "protected" });
  }
  let d = addDays(localDate(from, s.tz), -1);
  const last = addDays(localDate(to, s.tz), 1);
  while (d <= last) {
    for (const p of s.protectedDaily) {
      out.push({ start: parseLocal(d, p.start, s.tz).getTime(), end: parseLocal(d, p.end, s.tz).getTime(), label: p.label, kind: "protected" });
    }
    d = addDays(d, 1);
  }
  return out;
}

/** Free windows inside working hours. Events get a buffer on each side. */
export function freeWindows(ctx: Ctx, from: Date, to: Date, opts: { excludeTaskId?: string; excludeDecisionId?: string; extraBusy?: Interval[] } = {}): Interval[] {
  const s = plannerSettings(ctx);
  const buf = s.bufferMin * MIN;
  const busy = [...busyIntervals(ctx, from, to, opts), ...(opts.extraBusy ?? [])]
    .map((b) => ({ ...b, start: b.start - (b.kind === "protected" ? 0 : buf), end: b.end + (b.kind === "protected" ? 0 : buf) }))
    .sort((a, b) => a.start - b.start);
  const windows: Interval[] = [];
  let d = localDate(from, s.tz);
  const lastDay = localDate(to, s.tz);
  while (d <= lastDay) {
    let ws = Math.max(parseLocal(d, s.dayStart, s.tz).getTime(), roundUp15(from.getTime()));
    const we = Math.min(parseLocal(d, s.dayEnd, s.tz).getTime(), to.getTime());
    let cursor = ws;
    for (const b of busy) {
      if (b.end <= cursor || b.start >= we) continue;
      if (b.start > cursor) windows.push({ start: cursor, end: Math.min(b.start, we) });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < we) windows.push({ start: cursor, end: we });
    d = addDays(d, 1);
  }
  return windows.filter((w) => w.end - w.start >= 15 * MIN).map((w) => ({ start: roundUp15(w.start), end: w.end })).filter((w) => w.end - w.start >= 15 * MIN);
}

const toChunk = (start: number, minutes: number): Chunk => ({
  start: new Date(start).toISOString(), end: new Date(start + minutes * MIN).toISOString(), minutes,
});

export interface Plan { chunks: Chunk[]; scheduledMinutes: number; shortfall: number; latestSafeStart: string | null; strategy: string }

export function planWork(ctx: Ctx, o: {
  effort: number; from: Date; due: Date; strategy?: "early" | "late"; excludeTaskId?: string; excludeDecisionId?: string;
  extraBusy?: Interval[]; maxChunk?: number; minChunk?: number;
}): Plan {
  const s = plannerSettings(ctx);
  const strategy = o.strategy ?? "early";
  const min = (o.minChunk ?? s.minChunk) * MIN;
  const max = (o.maxChunk ?? s.maxChunk) * MIN;
  const end = new Date(o.due.getTime() - s.dueBufferMin * MIN);
  const windows = end > o.from ? freeWindows(ctx, o.from, end, o) : [];
  const chunks: Chunk[] = [];
  let remaining = o.effort * MIN;

  if (strategy === "early") {
    // One session per day while days remain. Pick the longest window of the day, earliest start.
    const byDay = new Map<string, Interval[]>();
    for (const w of windows) { const k = localDate(new Date(w.start), s.tz); byDay.set(k, [...(byDay.get(k) ?? []), w]); }
    for (const [, ws] of [...byDay.entries()].sort()) {
      if (remaining <= 0) break;
      const best = [...ws].sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)[0];
      const len = best.end - best.start;
      let take = Math.min(max, remaining, len);
      if (take < min && remaining > take) continue; // too small to be useful
      take = Math.floor(take / (15 * MIN)) * 15 * MIN;
      if (take <= 0) continue;
      chunks.push(toChunk(best.start, take / MIN));
      remaining -= take;
    }
    // Still short: allow more sessions per day.
    if (remaining > 0) {
      const used = chunks.map((c) => ({ start: new Date(c.start).getTime(), end: new Date(c.end).getTime(), kind: "proposed" }));
      const extra = freeWindows(ctx, o.from, end, { ...o, extraBusy: [...(o.extraBusy ?? []), ...used] });
      for (const w of extra) {
        if (remaining <= 0) break;
        let take = Math.min(max, remaining, w.end - w.start);
        take = Math.floor(take / (15 * MIN)) * 15 * MIN;
        if (take < Math.min(min, remaining) || take <= 0) continue;
        chunks.push(toChunk(w.start, take / MIN));
        remaining -= take;
      }
    }
  } else {
    const lateMax = Math.max(max, 120 * MIN);
    for (const w of [...windows].reverse()) {
      if (remaining <= 0) break;
      let take = Math.min(lateMax, remaining, w.end - w.start);
      take = Math.floor(take / (15 * MIN)) * 15 * MIN;
      if (take < Math.min(min, remaining) || take <= 0) continue;
      chunks.push(toChunk(w.end - take, take / MIN));
      remaining -= take;
    }
  }
  chunks.sort((a, b) => a.start.localeCompare(b.start));
  const scheduled = chunks.reduce((n, c) => n + c.minutes, 0);
  const shortfall = Math.max(0, o.effort - scheduled);

  let latest: string | null = null;
  if (strategy === "late") latest = shortfall === 0 && chunks.length ? chunks[0].start : null;
  else {
    const late = planWork(ctx, { ...o, strategy: "late" });
    latest = late.latestSafeStart;
  }
  return { chunks, scheduledMinutes: scheduled, shortfall, latestSafeStart: latest, strategy };
}

/** True if [start,end) collides with anything busy (no buffer). Used again just before a write. */
export function collides(ctx: Ctx, start: string, end: string, opts: { excludeDecisionId?: string; excludeTaskId?: string } = {}): Interval | null {
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  for (const i of busyIntervals(ctx, new Date(a - 86400000), new Date(b + 86400000), opts)) {
    if (i.start < b && i.end > a) return i;
  }
  return null;
}

export function minutesFree(ctx: Ctx, from: Date, to: Date): number {
  return freeWindows(ctx, from, to).reduce((n, w) => n + minutesBetween(new Date(w.start), new Date(w.end)), 0);
}

/** Next useful free window starting at or after now. */
export function nextFreeWindow(ctx: Ctx, now: Date, horizonHours = 48): { start: string; end: string; minutes: number } | null {
  const ws = freeWindows(ctx, now, new Date(now.getTime() + horizonHours * 3600000));
  const w = ws.find((x) => x.end - x.start >= 20 * MIN);
  return w ? { start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString(), minutes: minutesBetween(new Date(w.start), new Date(w.end)) } : null;
}
