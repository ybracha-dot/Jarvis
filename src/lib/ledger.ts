// Open work from notes: who owns what, what happens next, what is blocking it. Notes are read in the order they were written, so a later
// note that hands a task to someone else, unblocks it or says it is finished changes only that task. Everything else keeps its original source.
// The table is built by code from quoted sentences. Nothing is inferred beyond what a sentence says. A sentence that names a person or a task
// but is not understood is reported, never dropped silently.
import type { ItemIn, Src } from "./decision";
import { wordsOf } from "./plan";

export interface Cite { src: Src; quote: string; role: string }
export interface TaskRow { id: string; task: string; obj: string; owner: string | null; next: string | null; blocker: string | null; blockerKey: Set<string>; due: string | null; progress: boolean; done: boolean; cites: Cite[]; history: string[] }
export interface TableSpec { columns: string[]; rowUnit: string | null; excludeDone: boolean; form?: "table" | "checklist"; groupByOwner?: boolean }
export interface TableAnalysis { type: "table"; form: "table" | "checklist"; columns: string[]; keys: string[]; rows: { cells: string[]; task: string; owner: string | null; cites: Cite[] }[]; leftOut: { text: string; reason: string; cites: Cite[] }[]; notes: string[]; unparsed: { text: string; src: Src }[]; missingColumns: string[]; openCount: number; taskCount: number; addedTaskColumn: boolean }

const NOT_NAMES = new Set("Update Correction Note Notes Handoff The This That These Those It He She They We I You Everything Nothing Someone Anyone Also Then Now Still Side Planning Plan Task Tasks Owner Status Next Action Blocker Done Open If In On At As So No Or To Of By My Our His Her Its An Is Are Was Be We Do Go Up Us".split(" "));
const NOT_TASK_VERBS = new Set("says said thinks think wants want asked asks mentioned mentions wrote writes noted notes confirmed confirms feels feel knows know likes like hopes hope believes believe seems seem is was has had does did gets got looks look".split(" "));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const stripThe = (s: string) => s.replace(/^(?:the|a|an|our|their)\s+/i, "");
const clean = (s: string) => s.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
/** Third person to base form: "sets up" -> "set up", "prints" -> "print", "books" -> "book", "buys" -> "buy", "coordinates" -> "coordinate", "goes" -> "go". */
export function baseVerb(v: string): string {
  const w0 = v.toLowerCase().split(" "); const w = w0[0]; const tail = w0.slice(1).join(" "); const out = (x: string) => (tail ? `${x} ${tail}` : x); if (/ies$/.test(w) && w.length > 4) return out(w.replace(/ies$/, "y")); if (/(?:ches|shes|sses|xes|zes|oes)$/.test(w)) return out(w.replace(/es$/, "")); if (/[^s]s$/.test(w)) return out(w.slice(0, -1)); return out(w);
}
const PARTICLES = new Set(["up", "out", "off", "over", "down", "in", "on", "back"]);

export function buildLedger(items: ItemIn[]): { tasks: TaskRow[]; notes: string[]; unparsed: { text: string; src: Src }[] } {
  const tasks: TaskRow[] = []; const notes: string[] = []; const unparsed: { text: string; src: Src }[] = []; let n = 0;
  const corpus = items.flatMap((it) => it.sentences.map((s) => s.text)).join(" ");
  const lower = new Set((corpus.match(/\b[a-z]{3,}\b/g) ?? []));
  const isName = (w: string) => /^[A-Z][a-z]{1,15}$/.test(w) && !NOT_NAMES.has(w) && !lower.has(w.toLowerCase());
  const nameWords = new Set<string>(); for (const w of corpus.match(/\b[A-Z][a-z]{1,15}\b/g) ?? []) if (isName(w)) nameWords.add(w.toLowerCase());
  const keyOf = (t: string) => new Set(wordsOf(t.replace(/-/g, " ").replace(/'s\b/g, "")).filter((w) => !["task", "work", "thing", "item", "job"].includes(w) && !nameWords.has(w)));
  const same = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return false; const o = [...a].filter((x) => b.has(x)).length; return o >= 1 && o >= Math.min(a.size, b.size) / 2; };
  const cite = (it: ItemIn, text: string, role: string): Cite => ({ src: it, quote: text.trim(), role });
  const open = () => tasks.filter((t) => !t.done);
  const find = (phrase: string, owner?: string | null, includeDone = false) => { const k = keyOf(phrase); const pool = includeDone ? tasks : open(); return pool.find((t) => owner && t.owner === owner && same(keyOf(t.obj), k)) ?? pool.find((t) => same(keyOf(t.obj), k)); };
  const dueOf = (s: string) => { const m = /\bdue\s+(?:on\s+|by\s+)?((?:Mon|Tues?|Wednes|Thurs?|Fri|Satur|Sun)(?:day)?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})\b/i.exec(s) ?? /\bby\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})\b/i.exec(s); return m ? m[1] : null; };
  const reassign = (t: TaskRow, to: string, it: ItemIn, raw: string) => { if (t.owner !== to) { t.history.push(`Reassigned from ${t.owner ?? "no one"} to ${to}`); t.owner = to; } t.cites.push(cite(it, raw, "reassigned")); };
  /** A person takes a piece of work: a task already on the list changes hands, a new one is added. */
  const assign = (name: string, phrase: string, it: ItemIn, raw: string, o: { verb?: string; blocker?: string | null; next?: string | null; due?: string | null } = {}) => {
    let p = clean(phrase); const due = o.due ?? dueOf(p); p = p.replace(/,?\s*due\s+.*$/i, "").trim(); if (!p) return null;
    const obj = o.verb ? p : p; const found = find(obj, null);
    const display = o.verb ? `${baseVerb(o.verb)}${PARTICLES.has(p.split(" ")[0]) ? "" : ""} ${p}`.replace(/\s+/g, " ").trim() : stripThe(p);
    let t = found;
    if (t) { if (t.owner !== name) reassign(t, name, it, raw); else t.cites.push(cite(it, raw, "task and owner")); }
    else { t = { id: `t${++n}`, task: cap(display), obj: p, owner: name, next: null, blocker: null, blockerKey: new Set(), due: null, progress: false, done: false, cites: [cite(it, raw, "task and owner")], history: [] }; tasks.push(t); }
    if (o.verb && !t.next) t.next = cap(display);
    if (o.next) { const objp = /^(?:the|a|an|our|their)\s/i.test(p) ? p : `the ${p}`; t.next = cap(clean(o.next).replace(/\b(it|them|this|that)\b/i, objp)); }
    if (due) t.due = due;
    if (o.blocker) { t.blocker = o.blocker; t.blockerKey = keyOf(o.blocker); t.cites.push(cite(it, raw, "blocker")); }
    return t;
  };
  const block = (t: TaskRow, x: string, lead: string, it: ItemIn, raw: string) => { t.blocker = `${lead} ${clean(x)}`; t.blockerKey = keyOf(x); t.cites.push(cite(it, raw, "blocker")); };
  const unblock = (t: TaskRow, it: ItemIn, raw: string) => { if (t.blocker) { t.blocker = null; t.blockerKey = new Set(); t.cites.push(cite(it, raw, "unblocked")); } };

  const sorted = [...items].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const it of sorted) for (const sent of it.sentences) {
    const raw = sent.text.trim(); let S = clean(raw).replace(/^[A-Z][^:.]{0,60}:\s*(?=[A-Za-z])/, "");   // "Update for the fair: ..." / "Side chat: ..."
    const clauses = S.split(/\s*(?:;|,\s+so\s+|,\s+and\s+(?=[A-Za-z'’]+\s+(?:is|are|was|were|has|have)\b)|\s+and\s+(?=(?:the\s+)?[\w' -]{2,40}?\s+(?:is|are|was|were|has been|have been)\s+(?:now\s+)?(?:no longer|done|finished|complete|completed)\b))\s*/i).filter(Boolean);
    let last: TaskRow | null = null; let consumed = false;
    for (const C of clauses) {
      let m: RegExpExecArray | null; let hit: TaskRow | null = null; let ok = true;
      const subjPoss = /^([A-Z][a-z]+)['’]s\s+(.+)$/.exec(C); const Cn = subjPoss && isName(subjPoss[1]) ? subjPoss[2] : C;
      // Finished.
      if ((m = /^(?:the\s+)?(.+?)\s+(?:is|are|was|were|has been|have been|got)\s+(?:now\s+)?(?:finished|complete|completed|done|signed off|approved|delivered|shipped|sorted)\b/i.exec(Cn)) || (m = /^(?:the\s+)?(.+?)\s+(?:was|were|is|are)\s+[^,]*,\s*(?:done|finished|complete|completed)$/i.exec(Cn)) || (m = /^[A-Z][a-z]+\s+(?:has\s+)?(?:finished|completed|wrapped up|done with)\s+(?:the\s+)?(.+)$/.exec(Cn))) {
        const t = find(m[1], null, true); if (t) { if (!t.done) t.done = true; t.cites.push(cite(it, raw, "completed")); hit = t; } else { const nt: TaskRow = { id: `t${++n}`, task: cap(stripThe(clean(m[1]))), obj: clean(m[1]), owner: null, next: null, blocker: null, blockerKey: new Set(), due: null, progress: false, done: true, cites: [cite(it, raw, "completed")], history: [] }; tasks.push(nt); hit = nt; }
      }
      // Unblocked: "filling the raised beds is no longer blocked", "Lena can submit the report now", "the soil arrived".
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:is|are)\s+(?:now\s+)?(?:no longer (?:blocked|waiting)|unblocked|ready to (?:go|start))\b/i.exec(Cn))) { const t = find(m[1], null); if (t) { unblock(t, it, raw); hit = t; } else ok = false; }
      else if ((m = /^([A-Z][a-z]+)\s+(?:can|could)\s+(?:now\s+)?([a-z]+(?:\s+up)?)\s+(.+?)\s+now$/.exec(Cn)) && isName(m[1])) { const t = find(m[3], m[1]) ?? open().filter((x) => x.owner === m![1]).pop(); if (t) { unblock(t, it, raw); hit = t; } else ok = false; }
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:has\s+|have\s+)?(?:arrived|been delivered|come in|came in|landed|is here|are here|was delivered|were delivered|got here|turned up|is confirmed|are confirmed|has been confirmed|have been confirmed|came through)\b/i.exec(Cn)) && !/^[A-Z][a-z]+\s+(?:has|have)\b/.test(Cn)) {
        const k = keyOf(m[1]); const hits = open().filter((t) => t.blocker && same(t.blockerKey, k)); if (hits.length) { for (const t of hits) unblock(t, it, raw); hit = hits[0]; } else ok = false;
      }
      // In progress: "they are in progress", "Felix has started the badges".
      else if ((m = /^(?:they|it|this|that)\s+(?:is|are)\s+(?:now\s+)?(?:in progress|underway|under way|started)\b/i.exec(Cn)) && last) { last.progress = true; last.cites.push(cite(it, raw, "in progress")); hit = last; }
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:is|are)\s+(?:now\s+)?(?:in progress|underway|under way|started)\b/i.exec(Cn))) { const t = find(m[1], null); if (t) { t.progress = true; t.cites.push(cite(it, raw, "in progress")); hit = t; } else ok = false; }
      else if ((m = /^([A-Z][a-z]+)\s+(?:has\s+)?(?:sent|started|begun|begins|sent off)\s+(?:the\s+)?(.+?)(?:\s+to\s+.+)?$/.exec(Cn)) && isName(m[1])) { const t = find(m[2], m[1]); if (t) { t.progress = true; t.cites.push(cite(it, raw, "in progress")); hit = t; } else ok = false; }
      // Reassigned: "the sound system is now with Lucia", "The posters have been handed to Tomas", "Route signs passed to Bao", "Carmen's helmet collection moved to Elena".
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:(?:is|are|has been|have been|was|were)\s+)?(?:now\s+)?(?:with|(?:handed|passed|moved|reassigned|assigned|given|going|gone|transferred|handed over|passed on|passed over)(?:\s+(?:over|on))?\s+to|owned by)\s+([A-Z][a-z]+)\b/.exec(Cn.replace(/^([A-Z][a-z]+)['’]s\s+/, ""))) && isName(m[2])) {
        const t = find(m[1], null); if (t) { reassign(t, m[2], it, raw); hit = t; } else { notes.push(`“${raw}” hands something to ${m[2]}, but no earlier note described that task, so it was not applied.`); unparsed.push({ text: raw, src: it }); hit = null; ok = true; consumed = true; }
      }
      // "Inez has taken over the printer booking from Theo and can book it now", "Sven also takes the marshal vests".
      else if ((m = /^([A-Z][a-z]+)\s+(?:has\s+|will\s+)?(?:now\s+|also\s+)?(?:taken|takes|taking|took|take|picks up|picked up|is taking)\s+(?:over\s+)?(?:the\s+)?(.+?)(?:\s+from\s+([A-Z][a-z]+))?(?:\s+and\s+(.*))?$/.exec(Cn)) && isName(m[1])) {
        const unb = m[4] && /\bcan\s+\w+\s+it\s+now\b|no longer blocked|unblocked/i.test(m[4]); const t = assign(m[1], m[2], it, raw); if (t) { if (unb) unblock(t, it, raw); hit = t; }
      }
      else if ((m = /^([A-Z][a-z]+)\s+(?:has\s+)?(?:handed|passed|gave)\s+(?:off\s+)?(?:the\s+)?(.+?)\s+(?:over\s+)?to\s+([A-Z][a-z]+)\b/.exec(Cn)) && isName(m[1]) && isName(m[3])) { const t = find(m[2], m[1]) ?? find(m[2], null); if (t) { reassign(t, m[3], it, raw); hit = t; } else { assign(m[3], m[2], it, raw); } }
      // Waiting: "Mara is still waiting for the final photo credits."
      else if ((m = /^([A-Z][a-z]+)\s+(?:is\s+)?(?:still\s+)?(?:waiting\s+(?:for|on)|blocked\s+(?:on|by))\s+(.+)$/i.exec(Cn)) && isName(m[1])) {
        const t = open().filter((x) => x.owner === m![1]).pop(); if (t) { block(t, m[2], "Waiting for", it, raw); hit = t; } else { const nt = assign(m[1], `work waiting on ${m[2]}`, it, raw); if (nt) { block(nt, m[2], "Waiting for", it, raw); hit = nt; } }
      }
      // Ownership and assignment: "Mara owns caption proofing and needs the final photo credits before she can send the proof", "Devon sets up the sound system", "Ana will call the caterer".
      else if ((m = /^([A-Z][a-z]+)\s+(?:now\s+|also\s+|still\s+)?(?:owns|is responsible for|handles|is handling|leads|is leading|is working on|is covering|will own|will handle|is in charge of|looks after)\s+(.+)$/.exec(Cn)) && isName(m[1])) {
        let rest = m[2]; let blocker: string | null = null; let next: string | null = null; let r: RegExpExecArray | null;
        if ((r = /^(.+?)\s+and\s+(?:needs|requires)\s+(.+?)\s+before\s+\w+\s+can\s+(.+)$/i.exec(rest))) { rest = r[1]; blocker = `Waiting for ${clean(r[2])}`; next = r[3]; }
        else if ((r = /^(.+?)\s+and\s+(?:is\s+)?(?:still\s+)?waiting\s+(?:for|on)\s+(.+)$/i.exec(rest))) { rest = r[1]; blocker = `Waiting for ${clean(r[2])}`; }
        else if ((r = /^(.+?),?\s*(?:but\s+)?(?:only\s+)?(after|once|until|when|as soon as)\s+(.+)$/i.exec(rest))) { rest = r[1]; blocker = `Waiting until ${clean(r[3])}`; }
        const t = assign(m[1], rest, it, raw, { blocker, next }); if (t) hit = t;
      }
      else if ((m = /^([A-Z][a-z]+)\s+(?:was|is|has been|were)\s+(?:assigned|asked|tasked)\s+(?:to|with)\s+(.+)$/.exec(Cn)) && isName(m[1])) { const v = /^([a-z]+)\s+(.*)$/.exec(m[2]); const t = v && !["the", "a", "an"].includes(v[1]) ? assign(m[1], v[2], it, raw, { verb: v[1] }) : assign(m[1], m[2], it, raw); if (t) hit = t; }
      else if ((m = /^([A-Z][a-z]+)\s+(?:will|is going to|plans to|should|must|needs to)\s+([a-z]+(?:\s+up)?)\s+(.+)$/.exec(Cn)) && isName(m[1])) {
        let rest = m[3]; let blocker: string | null = null; const r = /^(.+?),?\s*(?:but\s+)?(?:only\s+)?(after|once|until|when|as soon as)\s+(.+)$/i.exec(rest); if (r) { rest = r[1]; blocker = `Waiting until ${clean(r[3])}`; }
        const t = assign(m[1], rest, it, raw, { verb: m[2], blocker }); if (t) hit = t;
      }
      // Any other "<Name> <verb>s <rest>" is a task for that person: "Maria runs the bake sale table", "Tomas books the raffle prizes", "Greta buys the candles and paints the route signs".
      else if ((m = /^([A-Z][a-z]+)\s+(?:now\s+|also\s+|still\s+)?([a-z]+s)\s+((?:up|out|off|over|down)\s+)?(?:(?:the|a|an|our|their|all|some|new)\s+)?(.+)$/.exec(Cn)) && isName(m[1]) && !NOT_TASK_VERBS.has(m[2]) && !/^(?:to|from|by|that|with|for)\b/i.test(m[4])) {
        const verb = `${m[2]}${m[3] ? ` ${m[3].trim()}` : ""}`; const whole = Cn.slice(Cn.indexOf(m[2]) + m[2].length).trim();
        const parts = whole.split(/\s+and\s+(?=[a-z]+s\s+(?:the|a|an|their|our)\b)/); let first: TaskRow | null = null;
        parts.forEach((part, i) => { const v = i === 0 ? verb : (/^([a-z]+s)\b/.exec(part)?.[1] ?? verb); const rest = i === 0 ? part.replace(/^(?:up|out|off|over|down)\s+/, "") : part.replace(/^[a-z]+s\s+/, ""); const objPart = rest; let blocker: string | null = null; let rr = /^(.+?),?\s*(?:but\s+)?(?:only\s+)?(after|once|until|when|as soon as)\s+(.+)$/i.exec(objPart); const obj = rr ? rr[1] : objPart; if (rr) blocker = `Waiting until ${clean(rr[3])}`; const vv = i === 0 && m![3] ? `${v}` : v; const full = i === 0 && m![3] ? `${m![2]} ${m![3].trim()}` : vv; const t = assign(m![1], obj, it, raw, { verb: full, blocker }); first = first ?? t; });
        if (first) hit = first;
      }
      else if (/^(?:nothing|no\s+\w+|none)\b[^.]*\b(?:changed|different|new)\b|\b(?:is|are|was|were|remains?|stays?)\s+(?:all\s+)?(?:unchanged|the same|as before|as planned)\b|^(?:everything|all)\s+else\b/i.test(Cn)) { consumed = true; }   // a statement that nothing changed carries no task
      else ok = false;
      if (hit) { last = hit; consumed = true; }
      void ok;
    }
    // A sentence that names a person or a task on the list but was not understood is reported, not dropped.
    if (!consumed) { const mentionsOwner = (S.match(/\b[A-Z][a-z]{1,15}\b/g) ?? []).some((w) => tasks.some((t) => t.owner === w)); const mentionsTask = tasks.some((t) => same(keyOf(t.obj), keyOf(S))); if ((mentionsOwner || mentionsTask) && !/^[A-Z][a-z]+(?:\s+[a-z]+){0,3}\.?$/.test(S)) unparsed.push({ text: raw, src: it }); }
  }
  return { tasks, notes, unparsed };
}

const ADJ = /^(?:the\s+)?(?:current|latest|new|present|assigned|responsible|main|primary|updated)\s+/i;
const COLS: [RegExp, string][] = [[/^(?:owner|assignee|who|person|responsible|in charge)\b/i, "owner"], [/^(?:task|item|work|what|job)\b/i, "task"], [/^(?:next action|next step|next|action)\b/i, "next"], [/^(?:blocker|blocked by|blocking|waiting on|dependency|blocked)\b/i, "blocker"], [/^(?:status|state|progress)\b/i, "status"], [/^(?:due(?: date)?|deadline|due by|when)\b/i, "due"]];
export const columnKey = (c: string) => { const t = c.trim().replace(/^(?:the\s+)?/i, "").replace(ADJ, ""); return COLS.find(([r]) => r.test(t))?.[1] ?? null; };
const COLWORDS: [RegExp, string][] = [[/\bstatus\b/i, "status"], [/\bdue(?: date)?\b|\bdeadline\b/i, "due"], [/\bpriority\b/i, "priority"], [/\bphone(?: number)?\b/i, "phone number"], [/\be-?mail(?: address)?\b/i, "email"], [/\bcost\b|\bbudget\b/i, "cost"], [/\blocation\b/i, "location"]];
/** Column nouns a request mentions (status, due date, phone number...), so the saved table can be checked for covering them. */
export const columnMentions = (request: string) => COLWORDS.filter(([r]) => r.test(request)).map(([, n]) => n);
export const coversMention = (name: string, keys: string[], columns: string[]) => (name === "status" && keys.includes("status")) || (name === "due" && keys.includes("due")) || columns.some((c) => c.toLowerCase().includes(name.split(" ")[0]));

/** Build the table or checklist. Columns the sources cannot fill are reported, not made up. */
export function buildTaskTable(items: ItemIn[], spec: TableSpec): TableAnalysis {
  const { tasks, notes, unparsed } = buildLedger(items);
  const wanted0 = spec.columns.length ? spec.columns : ["Owner", "Next action", "Blocker"];
  let keys = wanted0.map((c) => columnKey(c) ?? "unknown"); let wanted = [...wanted0];
  // A row without a task name is not a handoff. When no column says what the work is, the task comes first.
  let addedTaskColumn = false; if (!keys.includes("task") && !keys.includes("next")) { keys = ["task", ...keys]; wanted = ["Task", ...wanted]; addedTaskColumn = true; }
  let missingColumns = wanted.filter((_, i) => keys[i] === "unknown").map(cap);
  const open = tasks.filter((t) => !t.done); const shown = spec.excludeDone ? open : tasks;
  const status = (t: TaskRow) => t.done ? "Done" : t.blocker ? `Blocked. ${t.blocker}` : t.progress ? "In progress" : "Open";
  const cell = (t: TaskRow, k: string) => k === "owner" ? t.owner ?? "Unassigned" : k === "task" ? t.task : k === "next" ? (t.done ? "None (complete)" : t.next ?? "Not stated") : k === "blocker" ? (t.done ? "None (complete)" : t.blocker ?? "None reported") : k === "status" ? status(t) : k === "due" ? t.due ?? "Not stated" : "Not stated";
  const rows = shown.map((t) => ({ task: t.task, owner: t.owner, cites: t.cites, cells: keys.map((k) => cell(t, k)) }));
  // A column every cell of which says "Not stated" is a column the notes cannot fill, whatever its name.
  keys.forEach((k, i) => { if ((k === "due" || k === "next") && rows.length && rows.every((r) => r.cells[i] === "Not stated") && !missingColumns.includes(cap(wanted[i]))) missingColumns.push(cap(wanted[i])); });
  const leftOut: TableAnalysis["leftOut"] = [];
  if (spec.excludeDone) for (const t of tasks.filter((x) => x.done)) leftOut.push({ text: cap(t.task), reason: "complete", cites: t.cites });
  for (const t of open) for (const h of t.history) leftOut.push({ text: `${t.task}: ${h}`, reason: "handed over, the row shows the current owner", cites: t.cites });
  for (const u of unparsed) notes.push(`Not applied, because I could not read it as a task, a handover or a status: “${u.text}” (${u.src.title}).`);
  return { type: "table", form: spec.form ?? "table", columns: wanted.map(cap), keys, rows, leftOut, notes, unparsed, missingColumns, openCount: open.length, taskCount: tasks.length, addedTaskColumn };
}
export const tableMarkdown = (t: TableAnalysis) => { const esc = (s: string) => s.replace(/\|/g, "\\|"); return [`| ${t.columns.join(" | ")} |`, `|${t.columns.map(() => "---").join("|")}|`, ...t.rows.map((r) => `| ${r.cells.map(esc).join(" | ")} |`)].join("\n"); };
export const tableTsv = (t: TableAnalysis) => [t.columns.join("\t"), ...t.rows.map((r) => r.cells.join("\t"))].join("\n");
/** A checklist grouped by person: one heading per owner, one checkbox per open task with its next step and blocker. */
export function checklistMarkdown(t: TableAnalysis): string {
  const ix = (k: string) => t.keys.indexOf(k); const by = new Map<string, typeof t.rows>(); for (const r of t.rows) by.set(r.owner ?? "Unassigned", [...(by.get(r.owner ?? "Unassigned") ?? []), r]);
  const out: string[] = []; for (const [who, rs] of by) { out.push(`**${who}**`); for (const r of rs) { const nx = ix("next") >= 0 ? r.cells[ix("next")] : r.task; const bl = ix("blocker") >= 0 && !/^None/.test(r.cells[ix("blocker")]) ? ` (${r.cells[ix("blocker")]})` : ""; out.push(`- [ ] ${nx === "Not stated" ? r.task : nx}${bl}`); } out.push(""); }
  return out.join("\n").trim();
}
