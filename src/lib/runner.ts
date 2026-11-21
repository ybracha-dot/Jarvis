// Runs the durable queue. Two runners can exist at once (this app server and `npm run worker`): leases keep them from doing the same job twice.
import { makeCtx, Mode, setSetting, getSetting } from "./db";
import { processQueue, recoverStale } from "./jobs";
import { HANDLERS } from "./handlers";

const draining = new Set<string>();
export const leaseMs = () => Number(process.env.JARVIS_JOB_LEASE_MS ?? 15000);
export const paceMs = (mode: Mode) => Number(process.env.JARVIS_JOB_PACE_MS ?? (mode === "demo" ? 700 : 0));

export function noteRunner(mode: Mode, id: string, kind: "app-server" | "worker") {
  const ctx = makeCtx(mode);
  setSetting(ctx.db, "job_runner", { id, kind, at: Date.now(), pid: process.pid });
}
export function runnerStatus(mode: Mode) {
  const r = getSetting<{ id: string; kind: string; at: number; pid: number } | null>(makeCtx(mode).db, "job_runner", null);
  const age = r ? Date.now() - r.at : null;
  return { runner: r, alive: age != null && age < 20_000, message: r && age != null && age < 20_000
    ? (r.kind === "worker" ? `Worker process running (pid ${r.pid}).` : `Running inside this app server (pid ${r.pid}). It stops when the server stops.`)
    : "No runner active. Jobs wait until the app server or `npm run worker` picks them up." };
}

/** Run everything that is ready, in the background. Safe to call often. */
export function kick(mode: Mode): void {
  if (process.env.JARVIS_INAPP_RUNNER === "0" || draining.has(mode)) return;
  draining.add(mode);
  void (async () => {
    try {
      const ctx = makeCtx(mode); const id = `app-${process.pid}`;
      noteRunner(mode, id, "app-server");
      recoverStale(ctx);
      // Keep going while helpers wake their supervisors.
      for (let i = 0; i < 40; i++) {
        const n = await processQueue(ctx, { workerId: id, handlers: HANDLERS, leaseMs: leaseMs(), paceMs: paceMs(mode) });
        noteRunner(mode, id, "app-server");
        if (!n) break;
      }
    } catch (e) { console.error("[runner]", (e as Error).message); }
    finally { draining.delete(mode); }
  })();
}
