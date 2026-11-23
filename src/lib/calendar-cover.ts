// What the calendar can and cannot tell us. A calendar establishes only what it contains: a day it says nothing about is unknown, never free.
// Coverage is the span of days (first to last event) of a source that was read successfully, plus any span the user declares complete.
import { Ctx, all, getSetting, setSetting } from "./db";
import { Interval, plannerSettings } from "./planner";
import { localDate, addDays, parseLocal, fmtDateTime } from "./time";

export interface Coverage { id: string; provider: string; label: string; mode: "imported" | "live" | "declared"; fromDay: string; toDay: string; /** days on which this source actually lists something; for a declared range, every day in it */ days: string[]; events: number; readAt: string | null; state: "ok" | "stale" | "unavailable"; trusted: boolean; note: string }
const STALE_MS = 36 * 3600_000;
const LIVE = new Set(["ics-feed"]);

export function availabilityCoverage(ctx: Ctx): Coverage[] {
  const tz = plannerSettings(ctx).tz; const out: Coverage[] = [];
  for (const g of all(ctx.db, "SELECT source, MIN(start_at) a, MAX(end_at) b, COUNT(*) n FROM blocks WHERE owner_id=? AND kind='calendar' AND state='active' GROUP BY source", ctx.owner)) {
    const st = all(ctx.db, "SELECT label,state,last_success_at,last_attempt_at,message FROM source_status WHERE owner_id=? AND provider=?", ctx.owner, g.source)[0];
    const live = LIVE.has(String(g.source)); const readAt = (st?.last_success_at as string | null) ?? null; const age = readAt ? ctx.now().getTime() - Date.parse(readAt) : null;
    const down = !!st && st.state !== "ok"; const stale = live && (age == null || age > STALE_MS);
    const state: Coverage["state"] = down ? "unavailable" : stale ? "stale" : "ok";
    // A day is known only where the source lists something. A quiet day between two busy days is not evidence that the day is free: the export may simply have left it out.
    const seen = new Set<string>(); for (const e of all(ctx.db, "SELECT start_at, end_at FROM blocks WHERE owner_id=? AND kind='calendar' AND state='active' AND source=?", ctx.owner, g.source)) { let d = localDate(e.start_at as string, tz); const last = localDate(new Date(Math.max(Date.parse(e.start_at as string), Date.parse(e.end_at as string) - 1)), tz); for (let n = 0; d <= last && n < 40; n++) { seen.add(d); d = addDays(d, 1); } }
    out.push({ id: String(g.source), provider: String(g.source), label: (st?.label as string) ?? String(g.source), mode: live ? "live" : "imported", fromDay: localDate(g.a as string, tz), toDay: localDate(g.b as string, tz), days: [...seen].sort(), events: g.n as number, readAt, state, trusted: state === "ok",
      note: state === "ok" ? (live ? `Read ${readAt ? fmtDateTime(readAt) : "recently"}.` : `Imported ${readAt ? fmtDateTime(readAt) : "earlier"}; it is a snapshot and does not update by itself.`) : `The last refresh did not succeed${readAt ? ` (last good read ${fmtDateTime(readAt)})` : ""}. Its events are shown but cannot prove a day is free.` });
  }
  for (const [i, d] of getSetting<{ from: string; to: string }[]>(ctx.db, "calendar_declared", []).entries()) out.push({ id: `declared:${i}`, provider: "declared", label: "You confirmed your calendar is complete", mode: "declared", fromDay: d.from, toDay: d.to, days: (() => { const o: string[] = []; let x = d.from; for (let n = 0; x <= d.to && n < 60; n++) { o.push(x); x = addDays(x, 1); } return o; })(), events: 0, readAt: null, state: "ok", trusted: true, note: "Your statement. Jarvis cannot check it." });
  return out;
}
export const coveredOn = (cov: Coverage[], day: string) => cov.some((c) => c.trusted && c.days.includes(day));
/** Covered because the user said so, not because a calendar lists it. */
export const confirmedByUser = (cov: Coverage[], day: string) => cov.some((c) => c.mode === "declared" && c.days.includes(day)) && !cov.some((c) => c.mode !== "declared" && c.trusted && c.days.includes(day));
/** The user states that their calendar is complete for one day (or takes that back). Jarvis cannot check it, and says so. */
export function confirmDay(ctx: Ctx, day: string, on: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("A day looks like 2026-11-18");
  const cur = getSetting<{ from: string; to: string }[]>(ctx.db, "calendar_declared", []).filter((r) => !(r.from === day && r.to === day));
  setSetting(ctx.db, "calendar_declared", on ? [...cur, { from: day, to: day }].slice(-60) : cur); return { day, confirmed: on };
}
/** Whole local days in [from, to) that no trusted calendar covers, as intervals the planner must treat as unavailable. */
export function uncoveredIntervals(ctx: Ctx, from: Date, to: Date, cov = availabilityCoverage(ctx)): Interval[] {
  const tz = plannerSettings(ctx).tz; const out: Interval[] = []; let d = localDate(from, tz); const last = localDate(to, tz);
  while (d <= last) { if (!coveredOn(cov, d)) out.push({ start: parseLocal(d, "00:00", tz).getTime(), end: parseLocal(addDays(d, 1), "00:00", tz).getTime(), label: "Calendar coverage unknown", kind: "protected" }); d = addDays(d, 1); }
  return out;
}
export const uncoveredDays = (ctx: Ctx, from: Date, to: Date, cov = availabilityCoverage(ctx)): string[] => { const tz = plannerSettings(ctx).tz; const out: string[] = []; let d = localDate(from, tz); const last = localDate(to, tz); while (d <= last) { if (!coveredOn(cov, d)) out.push(d); d = addDays(d, 1); } return out; };
