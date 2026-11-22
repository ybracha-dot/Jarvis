import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { all, get, setSetting, getSetting } from "@/lib/db";
import { importText } from "@/lib/evidence";
import { upsertCalendar } from "@/lib/bundle";
import { tick, schedulerStatus, heartbeat } from "@/lib/scheduler";
import { saveBriefConfig } from "@/lib/brief-config";
import { briefToday } from "@/lib/brief";
import { quietUntil } from "@/lib/notify";

// The scheduled morning brief, as the worker runs it: the same builder, one result per occurrence, honest about gaps. Nothing here calls a model.
const world = (clock: string) => {
  const ctx: any = memCtx(clock, "personal");
  importText(ctx, { kind: "note", title: "Essay 2 outline", text: "Essay 2 outline is due Thursday, November 19 at 9:00 AM. Please bring a printed alphanumeric outline to class.", at: "2026-11-10T12:00:00.000Z", label: "My class notes" });
  upsertCalendar(ctx, "ics", [{ title: "Lecture", start: "2026-11-17T15:00:00Z", end: "2026-11-17T16:30:00Z" }, { title: "Section", start: "2026-11-20T15:00:00Z", end: "2026-11-20T16:00:00Z" }], "Calendar file");
  saveBriefConfig(ctx, { enabled: true, time: "08:00" }); setSetting(ctx.db, "scheduler_cursor", "2026-11-17T04:00:00.000Z"); return ctx;
};
const briefs = (ctx: any) => all(ctx.db, "SELECT * FROM brief_runs WHERE view='full'");

describe("scheduled brief", () => {
  it("is off until the user turns private schedules on", async () => {
    const ctx: any = memCtx("2026-11-17T08:05:00-05:00", "personal"); const r = await tick(ctx); expect(r.skipped).toMatch(/Schedules are off/); expect(briefs(ctx)).toHaveLength(0);
  });
  it("runs the morning occurrence once and saves one brief with its occurrence key", async () => {
    const ctx = world("2026-11-17T08:05:00-05:00"); const r = await tick(ctx);
    expect(r.ran.map((x) => x.kind)).toContain("morning"); const b = briefs(ctx); expect(b).toHaveLength(1); expect(b[0].occurrence_key).toBe("morning:2026-11-17@08:00"); expect(b[0].kind).toBe("scheduled"); expect(b[0].model_calls).toBe(0);
    expect(get(ctx.db, "SELECT status FROM schedule_runs WHERE occurrence_key=?", "morning:2026-11-17@08:00")!.status).toBe("ok");
  });
  it("duplicate delivery, a second worker and a restart create no second brief, result, run or alert", async () => {
    const ctx = world("2026-11-17T08:05:00-05:00"); await tick(ctx);
    setSetting(ctx.db, "scheduler_cursor", "2026-11-17T04:00:00.000Z"); await tick(ctx);                               // the same delivery arrives again
    const [a, b] = await Promise.all([(async () => { setSetting(ctx.db, "scheduler_cursor", "2026-11-17T04:00:00.000Z"); return tick(ctx); })(), (async () => { setSetting(ctx.db, "scheduler_cursor", "2026-11-17T04:00:00.000Z"); return tick(ctx); })()]);
    void a; void b; expect(briefs(ctx)).toHaveLength(1); expect(all(ctx.db, "SELECT * FROM results WHERE kind='brief'")).toHaveLength(1);
    expect(all(ctx.db, "SELECT * FROM schedule_runs WHERE occurrence_key='morning:2026-11-17@08:00'")).toHaveLength(1); expect(all(ctx.db, "SELECT * FROM inbox WHERE event_key LIKE 'brief-ready:%'")).toHaveLength(1);
  });
  it("a claimed run that never finished (the worker died) is picked up and finished, still once", async () => {
    const ctx = world("2026-11-17T08:30:00-05:00");
    ctx.db.prepare("INSERT INTO schedule_runs(occurrence_key,kind,scheduled_for,ran_at,status,summary,missed,attempts) VALUES(?,?,?,?,?,?,0,1)").run("morning:2026-11-17@08:00", "morning", "2026-11-17T13:00:00.000Z", "2026-11-17T13:01:00.000Z", "running", "Running");
    const r = await tick(ctx); expect(r.retried).toEqual(["morning:2026-11-17@08:00"]); expect(briefs(ctx)).toHaveLength(1); expect(get(ctx.db, "SELECT status, attempts FROM schedule_runs WHERE occurrence_key=?", "morning:2026-11-17@08:00")).toMatchObject({ status: "ok", attempts: 2 });
  });
  it("catches up once after the computer was off and shows the gap, not a silent success", async () => {
    const ctx = world("2026-11-19T10:12:00-05:00"); setSetting(ctx.db, "scheduler_cursor", "2026-11-16T20:00:00.000Z");
    const r = await tick(ctx); expect(r.ran.filter((x) => x.kind === "morning")).toHaveLength(1); expect(r.missed.some((k) => k.startsWith("morning:"))).toBe(true);
    const keys = briefs(ctx).map((b) => b.occurrence_key); expect(keys).toEqual(["morning:2026-11-19@08:00"]);
    const t = briefToday(ctx, schedulerStatus(ctx)); expect(t.recentMisses.map((m) => m.detail).join(" ")).toMatch(/Ran 2 h 12 min after its .*slot|Nothing ran for this slot/); expect(t.analysis!.kind).toBe("scheduled");
  });
  it("a Shabbat or prayer interval the user entered holds the run until it ends, then it runs once", async () => {
    const ctx = world("2026-11-21T08:05:00-05:00"); saveBriefConfig(ctx, { shabbat: { label: "Shabbat", startDay: 5, start: "17:00", endDay: 6, end: "20:00" } }); setSetting(ctx.db, "scheduler_cursor", "2026-11-20T20:00:00.000Z");   // Saturday morning
    expect(quietUntil(ctx, ctx.now())!.toISOString()).toBe("2026-11-22T01:00:00.000Z");
    const held = await tick(ctx); expect(held.skipped).toMatch(/Quiet time you set/); expect(briefs(ctx)).toHaveLength(0); expect(get(ctx.db, "SELECT COUNT(*) n FROM schedule_runs")!.n).toBe(0);
    ctx.setNow("2026-11-21T20:05:00-05:00"); const after = await tick(ctx); expect(after.ran.some((r) => r.kind === "morning")).toBe(true); expect(briefs(ctx)).toHaveLength(1);
    expect(get(ctx.db, "SELECT detail FROM schedule_runs WHERE occurrence_key=?", "morning:2026-11-21@08:00")!.detail).toMatch(/after its/);
  });
  it("uses only the boundaries the user supplied: with none entered nothing is held", async () => {
    const ctx = world("2026-11-21T08:05:00-05:00"); expect(quietUntil(ctx, ctx.now())).toBeNull(); setSetting(ctx.db, "scheduler_cursor", "2026-11-20T20:00:00.000Z"); expect((await tick(ctx)).ran.some((r) => r.kind === "morning")).toBe(true);
  });
  it("a failed build is recorded, retried, and never advances the comparison point", async () => {
    const ctx = world("2026-11-17T08:05:00-05:00"); ctx.db.exec("CREATE TRIGGER boom BEFORE INSERT ON brief_runs BEGIN SELECT RAISE(ABORT,'disk full'); END;");
    const r = await tick(ctx); expect(r.ran).toHaveLength(0); expect(get(ctx.db, "SELECT status, detail FROM schedule_runs WHERE occurrence_key='morning:2026-11-17@08:00'")).toMatchObject({ status: "failed" }); expect(briefs(ctx)).toHaveLength(0);
    ctx.db.exec("DROP TRIGGER boom"); const r2 = await tick(ctx); expect(r2.retried).toEqual(["morning:2026-11-17@08:00"]); expect(briefs(ctx)).toHaveLength(1); expect(briefs(ctx)[0].baseline).toBe(1);
  });
  it("Today can say whether a worker is really running, and the last and next checks", async () => {
    const ctx = world("2026-11-17T08:05:00-05:00"); await tick(ctx); let t = briefToday(ctx, schedulerStatus(ctx)); expect(t.scheduler.workerActive).toBe(false); expect(t.scheduler.message).toMatch(/No worker is running/); expect(t.lastSuccessAt).not.toBeNull();
    heartbeat(ctx); setSetting(ctx.db, "worker_heartbeat", { at: new Date().toISOString(), pid: 4242 }); t = briefToday(ctx, schedulerStatus(ctx)); expect(t.scheduler.nextRun!.key).toMatch(/^(afternoon|morning|weekly):/); expect(getSetting(ctx.db, "brief_enabled", false)).toBe(true);
  });
});
