// Live adapters, modeled separately from imports. Each has a connection test and its own freshness.
// Nothing here is treated as a credential Claude's account connectors could hand to this process.
import { Ctx, getSetting } from "./db";
import { parseIcs } from "./imports";
import { upsertCalendar } from "./bundle";
import { recordSourceStatus } from "./ingest";
import { defaultTransport, dailyBudget } from "./router";
import { schedulerStatus, inboxDir } from "./scheduler";
import fs from "node:fs";

export type AdapterState = "ok" | "needs_connection" | "failed" | "import_only" | "off";
export interface AdapterReport { id: string; label: string; capability: string; state: AdapterState; liveVerified: boolean; message: string; steps: string[]; surface: string }

export interface CalendarFeed { fetchText(url: string, signal: AbortSignal): Promise<string> }
export const realFeed: CalendarFeed = { async fetchText(url, signal) { const r = await fetch(url, { signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); } };

/** Read-only calendar feed (a secret iCal address). Works whenever JARVIS_ICS_URL is set. */
export async function scanCalendarFeed(ctx: Ctx, feed: CalendarFeed = realFeed) {
  const url = process.env.JARVIS_ICS_URL;
  if (!url) return { ok: false as const, message: "JARVIS_ICS_URL is not set" };
  if (getSetting<string[]>(ctx.db, "disabled_sources", []).includes("ics-feed")) return { ok: false as const, message: "Disconnected by you" };
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 10_000);
  try {
    const parsed = parseIcs(await feed.fetchText(url, ac.signal));
    const r = upsertCalendar(ctx, "ics-feed", parsed.events, "Calendar feed");
    recordSourceStatus(ctx, "ics-feed", "Calendar feed", true, `${r.seen} events read, ${r.added} new${parsed.unsupported.length ? `, ${parsed.unsupported.length} unsupported` : ""}`);
    return { ok: true as const, ...r, unsupported: parsed.unsupported };
  } catch (e: any) {
    // Failure keeps the previous success time and the previous events.
    recordSourceStatus(ctx, "ics-feed", "Calendar feed", false, `Check failed: ${e.name === "AbortError" ? "timed out" : e.message}`);
    return { ok: false as const, message: e.message };
  } finally { clearTimeout(t); }
}

export interface BlackboardAdapter { read(): Promise<{ announcements: { id: string; courseId: string; text: string; publishedAt: string }[] }> }

export async function connections(ctx: Ctx, opts: { check?: boolean; feed?: CalendarFeed } = {}): Promise<AdapterReport[]> {
  const sch = schedulerStatus(ctx);
  const inbox = inboxDir(ctx);
  const ics = process.env.JARVIS_ICS_URL;
  let icsState: AdapterState = ics ? "ok" : "needs_connection"; let icsMsg = ics ? "Feed URL is set. Run a health check to read it." : "Not connected.";
  if (ics && opts.check) { const r = await scanCalendarFeed(ctx, opts.feed); icsState = r.ok ? "ok" : "failed"; icsMsg = r.ok ? `Read ${r.seen} events from the feed.` : `Read failed: ${r.message}`; }
  const claude = defaultTransport();
  return [
    { id: "import", label: "File import", capability: ".json bundle, .ics, .eml, .md, .txt, .html. PDF unsupported.", state: "ok", liveVerified: false, message: "Works locally. Tested with fixtures.", steps: [], surface: "This app" },
    { id: "inbox", label: "Watched folder", capability: "Drop files into the folder. The worker or Run now reads them.", state: fs.existsSync(inbox) ? "ok" : "off", liveVerified: false, message: inbox, steps: ["Export a notification email as .eml, or save an announcement as .md, into this folder."], surface: "This app (worker)" },
    { id: "calendar", label: "Calendar read (iCal feed)", capability: "Read-only. Busy time becomes protected blocks.", state: icsState, liveVerified: false, message: icsMsg + " Not live verified in this build.", steps: ["In Google Calendar settings, copy the secret address in iCal format.", "Put it in .env as JARVIS_ICS_URL and restart.", "Click Health check."], surface: "This app (worker)" },
    { id: "email", label: "Notification email", capability: "Read BU Blackboard notification emails.", state: "import_only", liveVerified: false, message: "Direct mailbox access is not built. Use .eml export or the watched folder.", steps: ["In Blackboard, turn on email notifications for announcements and due dates (BU Blackboard profile and settings).", "Save or forward them as .eml into the watched folder.", "Optional: ask Claude with a Gmail connector in Cowork to save them for you."], surface: "Claude Cowork connector or this app" },
    { id: "blackboard", label: "Blackboard", capability: "Authenticated browser read.", state: "needs_connection", liveVerified: false, message: "Needs you to sign in through BU's official flow and complete Duo. Jarvis never asks for your password.", steps: ["Open Blackboard in your own browser and sign in with Duo.", "Export or copy the announcement text into an import.", "A browser-session adapter is a contract only in this build."], surface: "Your browser" },
    { id: "claude", label: "Claude model provider", capability: "Council reviews, briefs, interpretation. Optional.", state: claude ? (dailyBudget(ctx) > 0 ? "ok" : "off") : "needs_connection", liveVerified: false, message: claude ? (dailyBudget(ctx) > 0 ? "Key present, not verified until you test it." : "Key present. Paid AI is off until you set a daily budget.") : "No ANTHROPIC_API_KEY.", steps: ["Put ANTHROPIC_API_KEY in .env.", "Set a daily budget in Settings.", "Click Test Claude."], surface: "This app (API, separate from Claude Code and Claude chat)" },
    { id: "worker", label: "Scheduler worker", capability: "Morning 08:00, afternoon 16:00, weekly Sunday.", state: sch.active ? "ok" : "off", liveVerified: sch.workerActive, message: sch.message, steps: ["Run: node scripts/jarvis.mjs (starts the app and the worker)", "Or set up a Cowork scheduled task (see docs/SURFACES.md)."], surface: "This app (worker process)" },
    { id: "push", label: "Mobile delivery (push or SMS)", capability: "Opt-in. Needs a provider and a recipient you confirm.", state: "off", liveVerified: false, message: "Off. The in-app inbox always works offline.", steps: ["Native Claude mobile notifications for Cowork or Dispatch sessions are separate from this app's channel."], surface: "Provider, not configured" },
  ];
}
export { getSetting };
