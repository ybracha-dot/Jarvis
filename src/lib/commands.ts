// Plain-language commands. With no model this is a small deterministic matcher, and the UI labels it that way.
import { searchEvidence, tokens } from "./evidence";
import { Ctx, get, all } from "./db";
import { today } from "./today";
import { forMinutes } from "./resume";
import { listGoals } from "./goals";
import { listCommitments } from "./commitments";
import { searchNotes } from "./memory";
import { recentChanges } from "./ingest";
import { teach, classifyCorrection } from "./skills";
import { fmtDateTime, localHM } from "./time";

export interface CommandResult { mode: "local command matcher (no model)"; intent: string; reply: string; navigate?: string; confirm?: { action: string; noteId: string; label: string } }

export function runCommand(ctx: Ctx, text: string): CommandResult {
  const t = text.trim();
  const mode = "local command matcher (no model)" as const;
  const done = (intent: string, reply: string, navigate?: string): CommandResult => ({ mode, intent, reply, navigate });
  if (!t) return done("none", "Type a command. Examples: what changed, I have 20 minutes, resume, show pace, who owes me, recall <topic>, forget <topic>.");
  let m: RegExpExecArray | null;
  if (/\b(you missed|you forgot|didn'?t (check|mention)|needs? (to be )?printing)\b/i.test(t) && classifyCorrection(t) === "procedure") {
    const task = get(ctx.db, "SELECT id FROM tasks WHERE owner_id=? AND status='open' AND kind='assignment' ORDER BY due_at LIMIT 1", ctx.owner);
    const r = teach(ctx, { text: t, taskId: task?.id as string | undefined, via: "text" });
    return done("teach correction", r.steps.join(" "), "/skills");
  }
  if ((m = /\b(\d{1,3})\s*(?:min|minutes)\b/i.exec(t))) { const r = forMinutes(ctx, Number(m[1])); return done("time available", r.kind === "none" ? r.step : `${r.task}${r.doc ? `, ${r.doc}, ${r.section}` : ""}: ${r.step} (about ${r.estMinutes} min).`); }
  if (/\bresume\b/i.test(t)) { const r = forMinutes(ctx, 120); return done("resume project", r.kind === "none" ? r.step : `${r.task}${r.doc ? ` · ${r.doc} · ${r.section}` : ""}. Next: ${r.step}`); }
  if (/what changed|changes|new\b/i.test(t)) { const c = recentChanges(ctx, 5); return done("what changed", c.length ? c.map((x: any) => `${fmtDateTime(x.at)}: ${x.summary}`).join("\n") : "Nothing changed this week."); }
  if (/\b(pace|goal|progress)\b/i.test(t)) return done("show pace", listGoals(ctx).map((g) => `${g.name}: ${g.line} (${g.paceLabel})`).join("\n") || "No goals yet.", "/goals");
  if (/\b(owe|promise|waiting on|who owes)\b/i.test(t) && !/^capture/i.test(t)) { const c = (listCommitments(ctx) as any[]).filter((x) => x.status !== "resolved"); return done("who owes me what", c.length ? c.map((x) => `${x.who}: ${x.action}${x.due_date ? ` (by ${x.due_date})` : ""} · ${x.status.replace("_", " ")}`).join("\n") : "Nobody owes you anything open.", "/tasks?tab=followups"); }
  if ((m = /^(?:recall|find|search)\s+(.+)/i.exec(t))) { const h = searchNotes(ctx, m[1], { limit: 5 }); const ev = searchEvidence(ctx, tokens(m[1]), { limit: 4 }); if (ev.length) return done("recall source", [...h.map((n: any) => `${n.title} (note)`), ...ev.map((e) => `${e.title} (${e.kind}, ${e.sourceLabel}): ${e.excerpt.slice(0, 120)}`)].join("\n")); return done("recall source", h.length ? h.map((n: any) => `${n.title} (${n.kind}, ${n.scope})`).join("\n") : "No matching notes.", "/memory"); }
  if ((m = /^forget\s+(.+)/i.exec(t))) { const h = searchNotes(ctx, m[1], { limit: 1 }); if (!h.length) return done("forget", "No matching note to forget."); return { mode, intent: "forget", reply: `Found "${h[0].title}". Forgetting removes it from search, the vault and exports.`, confirm: { action: "delete-note", noteId: h[0].id, label: `Forget "${h[0].title}"` } }; }
  if (/\b(council|review)\b/i.test(t)) return done("review with council", "Opening the council.", "/council");
  if (/\b(advisor|offer|lens)\b/i.test(t)) return done("discuss with advisors", "Opening the advisor room.", "/voice");
  if (/\b(prepare|brief).*(meeting|call)\b|\bmeeting\b/i.test(t)) { const c = (listCommitments(ctx) as any[])[0]; return done("prepare meeting", c ? `Objective: get a dated answer on "${c.action}". Ask: What is the status today? What date can I expect a final answer?` : "No open follow-ups to prepare for."); }
  if (/^capture|add a promise|promise/i.test(t)) return done("capture promise", "Opening capture.", "?capture=1");
  if (/\b(today|class|schedule|what do i have)\b/i.test(t)) { const d = today(ctx); return done("today", `${d.primary.label}. ${d.minutesAvailable} min free${d.nextBlock ? ` from ${localHM(d.nextBlock.start)}` : ""}. ${d.decisionsPending} decision${d.decisionsPending === 1 ? "" : "s"} waiting.`, "/"); }
  return done("unknown", "I did not recognize that. Without a Claude provider I match these: today, what changed, I have 20 minutes, resume, show pace, who owes me, recall <topic>, forget <topic>, capture a promise, review with council, advisors, prepare for the meeting, or a correction like \"you missed the printing\".");
}
export { all };
