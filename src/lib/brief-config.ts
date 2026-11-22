// What the user tells the brief about their week. Every boundary here is one the user typed; Jarvis computes no prayer or Shabbat times and assumes none.
import { z } from "zod";
import { Ctx, getSetting, setSetting, logActivity } from "./db";
import { WeeklyEntry } from "./planner";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 07:30");
const days = z.array(z.number().int().min(0).max(6)).min(1).max(7);
export const BriefConfigInput = z.object({
  enabled: z.boolean().optional(), time: hhmm.optional(), tz: z.string().max(60).optional(), dayStart: hhmm.optional(), dayEnd: hhmm.optional(),
  classes: z.array(z.object({ label: z.string().trim().min(1).max(60), days, start: hhmm, end: hhmm })).max(14).optional(),
  prayers: z.array(z.object({ label: z.string().trim().min(1).max(60), days, start: hhmm, end: hhmm })).max(10).optional(),
  shabbat: z.object({ label: z.string().trim().max(60).default("Shabbat"), startDay: z.number().int().min(0).max(6), start: hhmm, endDay: z.number().int().min(0).max(6), end: hhmm }).nullable().optional(),
  calendarDeclared: z.array(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).max(6).optional(),
}).strict();
export type BriefConfigInput = z.infer<typeof BriefConfigInput>;
export interface BriefConfig { enabled: boolean; time: string; tz: string; dayStart: string; dayEnd: string; classes: { label: string; days: number[]; start: string; end: string }[]; prayers: { label: string; days: number[]; start: string; end: string }[]; shabbat: { label: string; startDay: number; start: string; endDay: number; end: string } | null; calendarDeclared: { from: string; to: string }[] }

export function getBriefConfig(ctx: Ctx): BriefConfig {
  const raw = getSetting<Partial<BriefConfig>>(ctx.db, "brief_config", {});
  return { enabled: getSetting<boolean>(ctx.db, "brief_enabled", false), time: getSetting<string[]>(ctx.db, "check_times", ["08:00", "16:00"])[0], tz: getSetting(ctx.db, "tz", "America/New_York"), dayStart: getSetting(ctx.db, "day_start", "08:00"), dayEnd: getSetting(ctx.db, "day_end", "22:00"),
    classes: raw.classes ?? [], prayers: raw.prayers ?? [], shabbat: raw.shabbat ?? null, calendarDeclared: getSetting(ctx.db, "calendar_declared", []) };
}
export function saveBriefConfig(ctx: Ctx, raw: unknown): BriefConfig {
  const b = BriefConfigInput.parse(raw); const cur = getBriefConfig(ctx);
  const next: BriefConfig = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) } as BriefConfig;
  try { new Intl.DateTimeFormat("en-US", { timeZone: next.tz }); } catch { next.tz = cur.tz; }
  const entries: WeeklyEntry[] = [
    ...next.classes.map((c) => ({ label: c.label, kind: "class" as const, days: c.days, start: c.start, end: c.end, quiet: false })),
    ...next.prayers.map((p) => ({ label: p.label, kind: "prayer" as const, days: p.days, start: p.start, end: p.end, quiet: true })),
    ...(next.shabbat ? [{ label: next.shabbat.label || "Shabbat", kind: "shabbat" as const, days: [next.shabbat.startDay], start: next.shabbat.start, end: next.shabbat.end, spansDays: (next.shabbat.endDay - next.shabbat.startDay + 7) % 7, quiet: true }] : []),
  ];
  setSetting(ctx.db, "brief_config", { classes: next.classes, prayers: next.prayers, shabbat: next.shabbat });
  setSetting(ctx.db, "weekly_busy", entries); setSetting(ctx.db, "brief_enabled", next.enabled); setSetting(ctx.db, "tz", next.tz); setSetting(ctx.db, "day_start", next.dayStart); setSetting(ctx.db, "day_end", next.dayEnd); setSetting(ctx.db, "calendar_declared", next.calendarDeclared);
  const times = getSetting<string[]>(ctx.db, "check_times", ["08:00", "16:00"]); setSetting(ctx.db, "check_times", [next.time, times[1] ?? "16:00"]);
  // Turning the brief on is the choice to run private schedules; turning it off leaves the example workspace's own schedule alone.
  if (ctx.mode === "personal") setSetting(ctx.db, "scheduler_enabled", next.enabled);
  logActivity(ctx, "brief_config", null, `Brief ${next.enabled ? "on" : "off"} at ${next.time}; ${next.classes.length} classes, ${next.prayers.length} prayer intervals, Shabbat ${next.shabbat ? "set" : "not set"}`);
  return getBriefConfig(ctx);
}
