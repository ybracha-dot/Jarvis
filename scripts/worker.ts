/* Unattended scheduler. Writes a heartbeat so the app can truthfully say a worker is running.
   Run: npm run worker. It checks both workspaces every 30 seconds. Schedules are off for the private workspace until you enable them. */
import { makeCtx, Mode } from "../src/lib/db";
import { tick, heartbeat } from "../src/lib/scheduler";
import { scanCalendarFeed } from "../src/lib/adapters";

const modes: Mode[] = ["demo", "personal"];
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function once() {
  for (const mode of modes) {
    const ctx = makeCtx(mode);
    heartbeat(ctx);
    try {
      const r = await tick(ctx);
      if (r.skipped && mode === "personal") continue;
      if (r.ran.length || r.missed.length) {
        console.log(`[${new Date().toISOString()}] ${mode}: ran ${r.ran.map((x) => x.key).join(", ") || "none"}; missed ${r.missed.length}`);
        if (process.env.JARVIS_ICS_URL) await scanCalendarFeed(ctx);
      }
    } catch (e) { console.error(`[${mode}]`, (e as Error).message); }
  }
}
console.log("Jarvis worker started. Ctrl+C to stop.");
(async () => { while (!stopping) { await once(); await new Promise((r) => setTimeout(r, 30_000)); } console.log("Worker stopped."); process.exit(0); })();
