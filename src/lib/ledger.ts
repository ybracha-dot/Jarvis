// Open work from notes: who owns what, what happens next, what is blocking it. Notes are read in the order they were written, so a later
// note that hands a task to someone else, unblocks it or says it is finished changes only that task. Everything else keeps its original source.
// The table is built by code from quoted sentences. Nothing is inferred beyond what a sentence says, and anything inferred is marked.
import type { ItemIn, Src } from "./decision";
import { wordsOf } from "./plan";

export interface Cite { src: Src; quote: string; role: string }
export interface TaskRow { id: string; task: string; owner: string | null; next: string | null; nextInferred: boolean; blocker: string | null; done: boolean; cites: Cite[]; history: string[] }
export interface TableSpec { columns: string[]; rowUnit: string | null; excludeDone: boolean }
export interface TableAnalysis { type: "table"; columns: string[]; keys: string[]; rows: { cells: string[]; task: string; cites: Cite[] }[]; leftOut: { text: string; reason: string; cites: Cite[] }[]; notes: string[]; missingColumns: string[]; openCount: number }

const NOT_NAMES = new Set("Update Correction Note Handoff The This That These Those It He She They We I You Lantern Everything Nothing Someone Anyone Also Then Now Still".split(" "));
const VERBS = /^(?:to\s+)?(book|send|write|call|email|order|confirm|prepare|review|draft|print|schedule|pay|buy|fix|finish|submit|upload|check|update|arrange|find|collect|deliver|set up|clean|organi[sz]e|create|build|test|install|measure|proof|ask|contact|reserve|register|file|sign|plan|make|get|pick up|follow up|cancel|renew|ship|hire|post|publish|approve|chase|cook|bake|pack|load|unload|invite|notify|tell|share|copy|move|label|hang)\b/i;
const sentenceText = (t: string) => t.replace(/^(?:Update|Correction|Note|Handoff)[^:.]{0,80}:\s*/i, "").replace(/\s+/g, " ").trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const trimThe = (s: string) => s.replace(/^to\s+/i, "").replace(/[.]+$/, "").trim();
const keyOf = (t: string) => new Set(wordsOf(t.replace(/-/g, " ")).filter((w) => !["task", "work", "thing", "item", "job"].includes(w)));
const same = (a: Set<string>, b: Set<string>) => { const o = [...a].filter((x) => b.has(x)).length; return o >= 1 && o >= Math.min(a.size, b.size) / 2; };
const isName = (n: string) => !NOT_NAMES.has(n);

export function buildLedger(items: ItemIn[]): { tasks: TaskRow[]; notes: string[] } {
  const tasks: TaskRow[] = []; const notes: string[] = []; let n = 0;
  const cite = (it: ItemIn, text: string, role: string): Cite => ({ src: it, quote: text.trim(), role });
  const find = (phrase: string, owner?: string | null) => { const k = keyOf(phrase); const open = tasks.filter((t) => !t.done); return open.find((t) => owner && t.owner === owner && same(keyOf(t.task), k)) ?? open.find((t) => same(keyOf(t.task), k)) ?? (owner ? open.filter((t) => t.owner === owner)[0] : undefined) ?? tasks.find((t) => same(keyOf(t.task), k)); };
  const add = (name: string, owner: string | null, it: ItemIn, raw: string): TaskRow => { const t: TaskRow = { id: `t${++n}`, task: trimThe(name).replace(/^(?:the|a|an)\s+/i, ""), owner, next: null, nextInferred: false, blocker: null, done: false, cites: [cite(it, raw, "task and owner")], history: [] }; tasks.push(t); return t; };
  const setNext = (t: TaskRow, text: string | null, inferred: boolean) => { if (text) { const obj = /^(?:to\s+)?(?:\w+\s+)?(?:it|them|this|that)\b/i.test(text) && !VERBS.test(t.task) ? t.task.replace(/^(?:the|a|an)\s+/i, "the ") : null; let x = trimThe(text); if (obj) x = x.replace(/\b(it|them|this|that)\b/i, obj.startsWith("the ") ? obj : `the ${obj}`); t.next = cap(x); t.nextInferred = inferred; } };
  const blockOn = (t: TaskRow, x: string, it: ItemIn, raw: string) => { t.blocker = `Waiting for ${trimThe(x)}`; t.cites.push(cite(it, raw, "blocker")); };
  const sorted = [...items].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const it of sorted) for (const sent of it.sentences) {
    const raw = sent.text.trim(); const S = sentenceText(raw); let m: RegExpExecArray | null;
    // Reassignment: "Inez has taken over the printer booking from Theo and can book it now."
    if ((m = /^([A-Z][a-z]+)\s+(?:has\s+)?(?:taken|takes|took)\s+over\s+(?:the\s+)?(.+?)\s+from\s+([A-Z][a-z]+)(.*)$/.exec(S)) && isName(m[1])) {
      const t = find(m[2], m[3]); const unblocked = /\bcan\s+\w+\s+it\s+now\b|\bno longer blocked\b|\bis (?:now )?unblocked\b/i.test(m[4]);
      if (t) { t.history.push(`Reassigned from ${t.owner ?? m[3]} to ${m[1]}`); t.owner = m[1]; t.cites.push(cite(it, raw, "reassigned")); if (unblocked) t.blocker = null; }
      else { const nt = add(m[2], m[1], it, raw); if (VERBS.test(m[2])) setNext(nt, m[2], false); notes.push(`${m[1]} took over “${m[2]}” from ${m[3]}, but no earlier note described that task.`); }
      continue;
    }
    if ((m = /^([A-Z][a-z]+)\s+(?:has\s+)?(?:handed|passed|gave)\s+(?:off\s+)?(?:the\s+)?(.+?)\s+(?:over\s+)?to\s+([A-Z][a-z]+)(.*)$/.exec(S)) && isName(m[1]) && isName(m[3])) { const t = find(m[2], m[1]); if (t) { t.history.push(`Reassigned from ${t.owner ?? m[1]} to ${m[3]}`); t.owner = m[3]; t.cites.push(cite(it, raw, "reassigned")); } continue; }
    if ((m = /(?:reassigned|moved)\s+(?:the\s+)?(.+?)\s+from\s+([A-Z][a-z]+)\s+to\s+([A-Z][a-z]+)/.exec(S))) { const t = find(m[1], m[2]); if (t) { t.history.push(`Reassigned from ${m[2]} to ${m[3]}`); t.owner = m[3]; t.cites.push(cite(it, raw, "reassigned")); } continue; }
    // Ownership: "Mara owns caption proofing and needs the final photo credits before she can send the proof."
    if ((m = /^([A-Z][a-z]+)\s+(?:now\s+)?(?:owns|is responsible for|handles|is handling|leads|is leading|is working on|is doing|is covering|will own)\s+(.+?)(?:\s+and\s+(.*))?$/.exec(S)) && isName(m[1])) {
      let t = find(m[2], m[1]); if (!t || t.owner !== m[1]) t = add(m[2], m[1], it, raw); else t.cites.push(cite(it, raw, "task and owner"));
      const rest = m[3] ?? ""; let r: RegExpExecArray | null;
      if ((r = /^(?:needs|requires)\s+(.+?)\s+before\s+(?:\w+)\s+can\s+(.+)$/i.exec(rest))) { blockOn(t, r[1], it, raw); setNext(t, r[2], false); }
      else if ((r = /^(?:is\s+)?(?:still\s+)?waiting\s+(?:for|on)\s+(.+)$/i.exec(rest))) blockOn(t, r[1], it, raw);
      if (!t.next) { if (VERBS.test(m[2])) setNext(t, m[2], false); else setNext(t, `continue ${trimThe(m[2])}`, true); }
      continue;
    }
    if ((m = /^([A-Z][a-z]+)\s+(?:was|is|has been|were)\s+(?:assigned|asked|tasked)\s+(?:to|with)\s+(.+)$/i.exec(S)) && isName(m[1])) { const t = add(m[2], m[1], it, raw); if (VERBS.test(m[2])) setNext(t, m[2], false); else setNext(t, `continue ${trimThe(m[2])}`, true); continue; }
    if ((m = /^([A-Z][a-z]+)\s+(?:will|is going to|plans to)\s+(.+)$/.exec(S)) && isName(m[1])) { const t = find(m[2], m[1]); if (t && t.owner === m[1] && same(keyOf(t.task), keyOf(m[2]))) { setNext(t, m[2], false); t.cites.push(cite(it, raw, "next action")); } else { const nt = add(m[2], m[1], it, raw); setNext(nt, m[2], false); } continue; }
    // Waiting: "Mara is still waiting for the final photo credits."
    if ((m = /^([A-Z][a-z]+)\s+(?:is\s+)?(?:still\s+)?(?:waiting\s+(?:for|on)|blocked\s+(?:on|by))\s+(.+)$/i.exec(S)) && isName(m[1])) {
      const t = tasks.filter((x) => !x.done && x.owner === m![1]).pop(); if (t) blockOn(t, m[2], it, raw); else { const nt = add(`work waiting on ${trimThe(m[2])}`, m[1], it, raw); blockOn(nt, m[2], it, raw); }
      continue;
    }
    // Finished: "The wall measurements are complete." / "Kofi finished the banner."
    if ((m = /^(?:the\s+)?(.+?)\s+(?:is|are|was|were|has been|have been)\s+(?:now\s+)?(?:finished|complete|completed|done|signed off|approved|delivered|shipped)\b/i.exec(S)) || (m = /^[A-Z][a-z]+\s+(?:has\s+)?(?:finished|completed|wrapped up)\s+(?:the\s+)?(.+)$/i.exec(S))) {
      const t = find(m[1]); if (t && same(keyOf(t.task), keyOf(m[1]))) { t.done = true; t.cites.push(cite(it, raw, "completed")); } else { const nt = add(m[1], null, it, raw); nt.done = true; nt.cites = [cite(it, raw, "completed")]; }
      continue;
    }
  }
  return { tasks, notes };
}

const COLS: [RegExp, string][] = [[/^(?:the\s+)?(?:owner|assignee|who|person|responsible)\b/i, "owner"], [/^(?:the\s+)?(?:task|item|work|what)\b/i, "task"], [/^(?:the\s+)?(?:next action|next step|action|next)\b/i, "next"], [/^(?:the\s+)?(?:blocker|blocked by|blocking|waiting on|dependency|status)\b/i, "blocker"]];
export const columnKey = (c: string) => COLS.find(([r]) => r.test(c.trim()))?.[1] ?? null;

/** Build the table. Columns the sources cannot fill are reported, not made up. */
export function buildTaskTable(items: ItemIn[], spec: TableSpec): TableAnalysis {
  const { tasks, notes } = buildLedger(items);
  const wanted = spec.columns.length ? spec.columns : ["Owner", "Next action", "Blocker"];
  const keys = wanted.map((c) => columnKey(c) ?? "unknown"); const missingColumns = wanted.filter((_, i) => keys[i] === "unknown").map(cap);
  const open = tasks.filter((t) => !t.done); const shown = spec.excludeDone ? open : tasks;
  const rows = shown.map((t) => ({ task: t.task, cites: t.cites, cells: keys.map((k) => k === "owner" ? t.owner ?? "Unassigned" : k === "task" ? cap(t.task) : k === "next" ? (t.done ? "None (complete)" : t.next ?? "Not stated") : k === "blocker" ? (t.done ? "None (complete)" : t.blocker ?? "None reported") : "Not stated") }));
  // The task name is not a requested column, so keep it visible in the row's label for the reader when the columns omit it.
  const leftOut: TableAnalysis["leftOut"] = [];
  if (spec.excludeDone) for (const t of tasks.filter((x) => x.done)) leftOut.push({ text: cap(t.task), reason: "complete", cites: t.cites });
  for (const t of open) for (const h of t.history) leftOut.push({ text: `${cap(t.task)}: ${h}`, reason: "handed over, the row shows the current owner", cites: t.cites });
  for (const t of open.filter((x) => x.nextInferred)) notes.push(`The next action for “${t.task}” is not stated in the notes, so the row says “${t.next}”.`);
  return { type: "table", columns: wanted.map(cap), keys, rows, leftOut, notes, missingColumns, openCount: open.length };
}
export const tableMarkdown = (t: TableAnalysis, withTask = false) => { const head = withTask ? ["Task", ...t.columns] : t.columns; const esc = (s: string) => s.replace(/\|/g, "\\|"); return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...t.rows.map((r) => `| ${(withTask ? [cap(r.task), ...r.cells] : r.cells).map(esc).join(" | ")} |`)].join("\n"); };
export const tableTsv = (t: TableAnalysis) => [t.columns.join("\t"), ...t.rows.map((r) => r.cells.join("\t"))].join("\n");
