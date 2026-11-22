// Open work from notes: who owns what, what happens next, what is blocking it. Notes are read in the order they were written, so a later
// note that hands a task to someone else, unblocks it or says it is finished changes only that task. Everything else keeps its original source.
// The table is built by code from quoted sentences. Nothing is inferred beyond what a sentence says. A sentence that names a person or a task
// but is not understood is reported, never dropped silently.
import type { ItemIn, Src } from "./decision";
import { wordsOf } from "./plan";

export interface Cite { src: Src; quote: string; role: string }
export interface TaskRow { id: string; task: string; obj: string; key: Set<string>; owner: string | null; next: string | null; blocker: string | null; blockerKey: Set<string>; due: string | null; progress: boolean; done: boolean; cancelled: boolean; cites: Cite[]; history: string[] }
export interface TableSpec { columns: string[]; rowUnit: string | null; excludeDone: boolean; form?: "table" | "checklist"; groupByOwner?: boolean; perPerson?: boolean; numbered?: boolean; sortByDue?: boolean; person?: string | null; about?: string | null; autoDue?: boolean }
export interface TableAnalysis { type: "table"; form: "table" | "checklist"; columns: string[]; keys: string[]; rows: { cells: string[]; task: string; owner: string | null; due?: string | null; cites: Cite[] }[]; leftOut: { text: string; reason: string; cites: Cite[] }[]; notes: string[]; unparsed: { text: string; src: Src }[]; missingColumns: string[]; openCount: number; taskCount: number; addedTaskColumn: boolean; numbered: boolean; filtered: string | null }

const NOT_NAMES = new Set("Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Update Correction Note Notes Handoff The This That These Those It He She They We I You Everything Nothing Someone Anyone Also Then Now Still Side Planning Plan Task Tasks Owner Status Next Action Blocker Done Open If In On At As So No Or To Of By My Our His Her Its An Is Are Was Be We Do Go Up Us".split(" "));
const NOT_TASK_VERBS = new Set("says said thinks think wants want asked asks mentioned mentions noted confirmed confirms feels feel knows know likes like hopes hope believes believe seems seem is was has had does did gets got looks look".split(" "));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const stripThe = (s: string) => s.replace(/^(?:the|a|an|our|their)\s+/i, "");
const clean = (s: string) => s.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
/** Third person to base form: "sets up" -> "set up", "prints" -> "print", "books" -> "book", "buys" -> "buy", "coordinates" -> "coordinate", "goes" -> "go". */
export function baseVerb(v: string): string {
  const w0 = v.toLowerCase().split(" "); const w = w0[0]; const tail = w0.slice(1).join(" "); const out = (x: string) => (tail ? `${x} ${tail}` : x); if (/ies$/.test(w) && w.length > 4) return out(w.replace(/ies$/, "y")); if (/(?:ches|shes|sses|xes|zes|oes)$/.test(w)) return out(w.replace(/es$/, "")); if (/[^s]s$/.test(w)) return out(w.slice(0, -1)); return out(w);
}
const E_STEMS = new Set("mak tak writ creat arrang organiz coordinat prepar schedul manag produc serv chang includ provid receiv plac sav giv mov driv updat remov delet releas hir clos compar decid handl settl bak rais finaliz ".split(" "));
/** "ordering" -> "order", "making" -> "make", "running" -> "run", "picking up" keeps its particle. */
export function ingBase(w: string): string { let b = w.toLowerCase().replace(/ing$/, ""); if (/([bdgmnprt])\1$/.test(b) && b.length > 3) b = b.slice(0, -1); return E_STEMS.has(b) || /[cvz]$/.test(b) || /(?:writ|creat|updat|validat|migrat|mak|tak|giv|provid|includ|complet|delet|releas|compar|prepar|schedul|organiz|coordinat|manag|chang|sav|remov|mov|driv|plac|serv|produc|revis|arrang|handl|finaliz|configur|measur|resolv|solv|improv|approv|continu|rais|clos|propos|purchas)$/.test(b) ? `${b}e` : b; }
/** Peel a blocker off the end of a task phrase: "…, which is waiting on finance's spreadsheet", "…but only after the soil arrives", "… once the edit is finished". */
function splitBlocker(rest: string): { rest: string; blocker: string | null; next: string | null } {
  let r: RegExpExecArray | null;
  if ((r = /^(.+?),?\s+and\s+(?:can|could|is able to)\s+(?:start|begin|go ahead)(?:\s+(?:immediately|now|right away|at once))?$/i.exec(rest))) return { rest: r[1], blocker: null, next: null };
  if ((r = /^(.+?)\s+and\s+(?:needs|requires)\s+(.+?)\s+before\s+\w+\s+can\s+(.+)$/i.exec(rest))) return { rest: r[1], blocker: `Waiting for ${clean(r[2])}`, next: r[3] };
  if ((r = /^(.+?)\s+and\s+(?:needs|requires)\s+(.+?)\s+first$/i.exec(rest))) return { rest: r[1], blocker: `Waiting for ${clean(r[2])}`, next: null };
  if ((r = /^(.+?),\s*(?:but\s+)?(?:needs|requires)\s+(.+)$/i.exec(rest))) return { rest: r[1], blocker: `Waiting for ${clean(r[2])}`, next: null };
  if ((r = /^(.+?),?\s*but\s+(?:the\s+)?(.+?)\s+(?:has|have)\s+not\s+(?:answered|replied|responded|confirmed|arrived|sent)(?:\s+yet)?$/i.exec(rest))) return { rest: r[1], blocker: `Waiting for ${clean(r[2])}`, next: null };
  if ((r = /^(.+?),?\s*(?:and\s+|which\s+|that\s+|who\s+)?(?:is\s+|are\s+)?(?:still\s+)?(?:stuck waiting|waiting|held up|stalled|blocked|pending)\s+(on|for|until|by)\s+(.+)$/i.exec(rest))) return { rest: r[1], blocker: `${/^until$/i.test(r[2]) ? "Waiting until" : "Waiting for"} ${clean(r[3])}`, next: null };
  if ((r = /^(.+?),?\s*(?:and\s+)?(?:can(?:'|’)?t|cannot|can not)\s+(?:start|begin|go)\s+until\s+(.+)$/i.exec(rest))) return { rest: r[1], blocker: `Waiting until ${clean(r[2])}`, next: null };
  if ((r = /^(.+?),?\s*(?:but\s+)?(?:only\s+)?(after|once|until|when|as soon as)\s+(.+)$/i.exec(rest))) return { rest: r[1], blocker: `Waiting until ${clean(r[3])}`, next: null };
  return { rest, blocker: null, next: null };
}
const IRREG: Record<string, string> = { laid: "lay", cut: "cut", built: "build", made: "make", done: "do", sent: "send", bought: "buy", brought: "bring", run: "run", held: "hold", given: "give", found: "find", written: "write", drawn: "draw", chosen: "choose", "put out": "put out", "set up": "set up", "put together": "put together", "taken care of": "take care of" };
/** "printed" -> "print", "booked" -> "book", "laminated" -> "laminate", "laid" -> "lay". */
export function partBase(w: string): string { const x = w.toLowerCase(); if (IRREG[x]) return IRREG[x]; return ingBase(`${x.replace(/ied$/, "y").replace(/ed$/, "").replace(/en$/, "")}ing`); }
const nounSubject2 = (t: string) => t.split(/\s+/).length <= 9 && !/\b(?:will|would|can|could|should|must|once|when|after|until|because|if|unless|then|going to|plans? to|is|are|was|were|which|that|who)\b/i.test(t);
const PARTICLES = new Set(["up", "out", "off", "over", "down", "in", "on", "back"]);

export function buildLedger(items: ItemIn[]): { tasks: TaskRow[]; notes: string[]; unparsed: { text: string; src: Src }[]; disp: (o: string | null) => string } {
  const tasks: TaskRow[] = []; const notes: string[] = []; const unparsed: { text: string; src: Src }[] = []; let n = 0;
  const corpus = items.flatMap((it) => it.sentences.map((s) => s.text)).join(" ");
  const lower = new Set((corpus.match(/\b[a-z]{3,}\b/g) ?? []));
  const isName1 = (w: string) => /^[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]{1,15}(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?$/.test(w) && !NOT_NAMES.has(w) && !lower.has(w.toLowerCase().split("-")[0]);
  const isName = (w: string) => w.split("+").every(isName1);
  const nameWords = new Set<string>(); for (const w of corpus.match(/(?<![\wÀ-ÿĀ-ſḀ-ỿ])[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]{1,15}(?:-[a-zà-ÿĀ-ſḀ-ỿ]+)?\b/g) ?? []) if (isName1(w)) nameWords.add(w.toLowerCase());
  // "Hanneke de Vries" is "Hanneke" while parsing and "Hanneke de Vries" when shown; "Ingrid and Tomasz will ..." is one shared owner.
  const PART = "(?:de|van|der|den|von|di|da|al|el|le|la|du|bin|ibn)";
  const FULL = new RegExp(`(?<![\\wÀ-ÿĀ-ſḀ-ỿ])([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]{1,15}(?:-[a-zà-ÿĀ-ſḀ-ỿ]+)?)((?:(?:\\s+${PART})*\\s+[A-ZÀ-ÝĀ-ſḀ-ỿ][A-Za-zà-ÿĀ-ſḀ-ỿ-]{1,20}){2,3}(?=\\s+(?:will|is|are|has|have|must|should|can|to)\\b)|(?:\\s+${PART})*\\s+[A-ZÀ-ÝĀ-ſḀ-ỿ][A-Za-zà-ÿĀ-ſḀ-ỿ-]{1,20})\\b`, "g");
  const fullName = new Map<string, string>(); for (const m of corpus.matchAll(FULL)) if (isName1(m[1])) { const cur = fullName.get(m[1]); if (!cur || m[0].length > cur.length) fullName.set(m[1], m[0]); }
  const alias = (t: string) => t.replace(FULL, (m0, f) => (isName1(f) ? f : m0)).replace(/\b([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+)\s+and\s+([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+)\b(?=\s+(?:will|are|have|jointly|together|both|can|must)\b)/g, (m0, a, b) => (isName1(a) && isName1(b) ? `${a}+${b}` : m0));
  const disp = (o: string | null) => (o ? o.split("+").map((x) => fullName.get(x) ?? x).join(" and ") : "Unassigned");
  // Task identity: the content words of the phrase, verb included ("book the label printer" and "the printer booking" share {book, printer}).
  // Two phrases are the same task when one's words all appear in the other's. A single shared word ("water" in "water pump" and "water sensor") is not enough.
  const KSTOP = new Set("the a an and or of to for from with on in at by is are was were be been it its their our his her this that these those my your as up out off over into onto than then so not no just now still also only very all each every some any other more most such own same new".split(" "));
  const kstem = (w: string) => w.replace(/(?:es|s)$/, "").replace(/(?:ing|ed|e)$/, "");
  const keyOf = (t: string) => new Set((t.toLowerCase().replace(/['’]s\b/g, "").match(/[a-zà-ÿĀ-ſḀ-ỿ]{2,}/g) ?? []).filter((w) => !KSTOP.has(w) && !nameWords.has(w) && !["task", "work", "thing", "item", "job"].includes(w)).map(kstem).filter((w) => w.length > 1));
  const hasW = (set: Set<string>, w: string) => set.has(w) || [...set].some((x) => (x.length >= 4 && w.startsWith(x)) || (w.length >= 4 && x.startsWith(w)));
  const same = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return false; const [sm, lg] = a.size <= b.size ? [a, b] : [b, a]; return [...sm].every((x) => hasW(lg, x)); };
  const cite = (it: ItemIn, text: string, role: string): Cite => ({ src: it, quote: text.trim(), role });
  const open = () => tasks.filter((t) => !t.done);
  const find = (phrase: string, owner?: string | null, includeDone = false) => { const k = keyOf(phrase); const pool = includeDone ? tasks : open(); return pool.find((t) => owner && t.owner === owner && same(t.key, k)) ?? pool.find((t) => same(t.key, k)); };
  const MONS = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
  const DATEP = `(?:(?:\\d{1,2}:\\d{2}(?:\\s*[ap]m)?\\s+(?:on\\s+)?)?(?:(?:Mon|Tues?|Wednes|Thurs?|Fri|Satur|Sun)day(?:\\s+(?:morning|afternoon|evening))?(?:\\s+(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONS}|${MONS}\\s+\\d{1,2}(?:st|nd|rd|th)?))?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONS}|${MONS}\\s+\\d{1,2}(?:st|nd|rd|th)?|the\\s+\\d{1,2}(?:st|nd|rd|th)(?:\\s+of\\s+${MONS})?|(?:the\\s+)?end of (?:the\\s+)?(?:month|week)|tomorrow|next\\s+\\w+))`;
  const dueOf2 = (t: string) => { const m = new RegExp(`\\b(?:due|by|before|no later than|until)\\s+(?:on\\s+)?(${DATEP})`, "i").exec(t); return m ? m[1] : null; };
  const dueOf = (s: string) => { const m = /\bdue\s+(?:on\s+|by\s+)?((?:Mon|Tues?|Wednes|Thurs?|Fri|Satur|Sun)(?:day)?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})\b/i.exec(s) ?? /\bby\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})\b/i.exec(s); return m ? m[1] : null; };
  const reassign = (t: TaskRow, to: string, it: ItemIn, raw: string) => { if (t.owner !== to) { t.history.push(`Reassigned from ${t.owner ?? "no one"} to ${to}`); t.owner = to; } t.cites.push(cite(it, raw, "reassigned")); };
  /** A person takes a piece of work: a task already on the list changes hands, a new one is added. */
  const assign = (name: string, phrase: string, it: ItemIn, raw: string, o: { verb?: string; blocker?: string | null; next?: string | null; due?: string | null } = {}) => {
    let p = clean(phrase).replace(/\s+(?:but|and|so|though|then)$/i, ""); const due = o.due ?? dueOf2(p) ?? new RegExp(`\\bon\\s+(${DATEP})`, "i").exec(p)?.[1] ?? dueOf(p); p = p.replace(new RegExp(`,?\\s*(?:\\b(?:all\\s+)?(?:by|before|due|no later than|on)\\s+(?:on\\s+)?${DATEP}).*$`, "i"), "").replace(/,?\s*due\s+.*$/i, "").trim(); if (!p) return null;
    const obj = o.verb ? p : p; const found = find(obj, null);
    const display = o.verb ? `${baseVerb(o.verb)}${PARTICLES.has(p.split(" ")[0]) ? "" : ""} ${p}`.replace(/\s+/g, " ").trim() : stripThe(p);
    let t = found;
    if (t) { if (t.owner !== name) reassign(t, name, it, raw); else t.cites.push(cite(it, raw, "task and owner")); }
    else { t = { id: `t${++n}`, task: cap(display), obj: p, key: new Set([...keyOf(p), ...(o.verb ? keyOf(baseVerb(o.verb)) : [])]), owner: name, next: null, blocker: null, blockerKey: new Set(), due: null, progress: false, done: false, cancelled: false, cites: [cite(it, raw, "task and owner")], history: [] }; tasks.push(t); }
    if (o.verb && !t.next) t.next = cap(display);
    if (o.next) { const objp = /^(?:the|a|an|our|their)\s/i.test(p) ? p : `the ${p}`; t.next = cap(clean(o.next).replace(/\b(it|them|this|that)\b/i, objp)); }
    if (due) t.due = due;
    if (o.blocker) { t.blocker = o.blocker; t.blockerKey = keyOf(o.blocker.replace(/^(?:Waiting (?:for|until)|Blocked by)\s+/i, "")); t.cites.push(cite(it, raw, "blocker")); }
    return t;
  };
  const block = (t: TaskRow, x: string, lead: string, it: ItemIn, raw: string) => { t.blocker = `${lead} ${clean(x)}`; t.blockerKey = keyOf(x); t.cites.push(cite(it, raw, "blocker")); };
  const unblock = (t: TaskRow, it: ItemIn, raw: string) => { if (t.blocker) { t.blocker = null; t.blockerKey = new Set(); t.cites.push(cite(it, raw, "unblocked")); } };

  /** "orders the banners and the first-aid supplies" is two tasks; "will record it" means the task named just before. */
  let lastTask: TaskRow | null = null;
  const assignMany = (name: string, rest: string, it: ItemIn, raw: string, o: { verb?: string; blocker?: string | null; next?: string | null }) => {
    const r0 = clean(rest); const pron = /^(?:it|that|this|them)$/i.test(r0) && lastTask ? [lastTask.obj] : r0.split(/\s+and\s+(?=(?:the|a|an|their|our)\s)/); let first: TaskRow | null = null;
    for (const part of pron) { const t = assign(name, part, it, raw, o); first = first ?? t; } return first;
  };
  const sorted = [...items].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const it of sorted) for (const sent of it.sentences) {
    const raw = sent.text.trim(); let S = alias(clean(raw).replace(/^[A-Z][^:.]{0,60}:\s*(?=[A-Za-z])/, "").replace(/^(?:we|i)\s+(?:also\s+)?(?:forgot|noticed|realised|realized|remembered|learned|agreed)\s+(?:that\s+)?/i, "").replace(/^(?:for|on|in|at|during)\s+the\s+[^,]{3,60},\s+/i, ""));   // "Update for the fair: ..." / "Side chat: ..."
    const clauses = S.split(/\s*(?:;|,\s+so\s+|(?:,\s+|\s+and\s+)(?=[A-ZÀ-ÝĀ-ſḀ-ỿ][\wà-ÿĀ-ſḀ-ỿ]+\s+(?:will|is|are|has|have|must|should|can)\b)|,\s+and\s+(?=(?:the\s+)?[\w'’ -]{2,40}?\s+(?:is|are|will be)\s+(?:to be\s+|expected to be\s+)?\w+)|,\s+and\s+(?=[A-Za-z'’]+\s+(?:is|are|was|were|has|have)\b)|\s+and\s+(?=(?:the\s+)?[\w' -]{2,30}?\s+(?:is|are)\s+[A-Z][a-zà-ÿĀ-ſḀ-ỿ]+['’]s\b)|\s+and\s+(?=(?:the\s+)?[\w' -]{2,40}?\s+(?:is|are|was|were|has been|have been)\s+(?:now\s+)?(?:no longer|done|finished|complete|completed|fixed|ordered|booked)\b))\s*/i).filter(Boolean);
    let last: TaskRow | null = null; let consumed = false;
    for (const C of clauses) {
      let m: RegExpExecArray | null; let hit: TaskRow | null = null; let ok = true;
      const subjPoss = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)['’]s\s+(.+)$/.exec(C); const Cn = subjPoss && isName(subjPoss[1]) ? subjPoss[2] : C;
      // ---- statements about the task list itself: cancelled, due date changed, passive "will be printed by X" ----
      const pre = ((): { hit: TaskRow | null } | null => {
        let r: RegExpExecArray | null; const NMX = "([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)";
        const cancel = (phrase: string, who?: string | null) => { const t = find(phrase, who ?? null); if (t) { t.cancelled = true; t.done = true; t.cites.push(cite(it, raw, "cancelled")); return { hit: t }; } return null; };
        if ((r = /^(?:([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+)?(?:will|is going to|plans to)\s+not\s+(.+?)\s+(?:anymore|any more|after all)(?:\s+(?:because|since|as)\b.*)?$/i.exec(Cn))) return cancel(r[2], r[1]);
        if ((r = /^(?:the\s+)?(.+?)\s+(?:is|are|has been|have been|was|were|gets|got)\s+(?:now\s+)?(?:cancelled|canceled|dropped|scrapped|called off|abandoned)\b/i.exec(Cn)) && nounSubject2(r[1])) return cancel(r[1]);
        if ((r = /^(?:we|they)\s+(?:are\s+|'re\s+|will\s+)?(?:no longer|not)\s+(?:doing|going to do|needing|need|having|hosting|running)\s+(?:the\s+)?(.+)$/i.exec(Cn))) return cancel(r[1]);
        if ((r = /^(?:the\s+)?(.+?)\s+(?:is|are)\s+no longer needed\b/i.exec(Cn)) && nounSubject2(r[1])) return cancel(r[1]);
        const dueChange = (phrase: string, date: string) => { const t = find(phrase.replace(/^[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+['’]s\s+/, ""), null); if (!t) return null; t.history.push(`Due date changed to ${date}`); t.due = date; t.cites.push(cite(it, raw, "deadline changed")); return { hit: t }; };
        if ((r = new RegExp(`^(?:the\\s+)?(.+?)\\s+(?:is|are)\\s+(?:now\\s+)?due\\s+(?:on\\s+|by\\s+)?(${DATEP})`, "i").exec(Cn)) && nounSubject2(r[1])) return dueChange(r[1], r[2]);
        if ((r = new RegExp(`^(?:the\\s+)?(.+?)\\s+(?:has been\\s+|have been\\s+|is\\s+|are\\s+|was\\s+|were\\s+)?(?:moved|moves|move|pushed back|pushed|postponed|rescheduled|delayed|brought forward|shifted|shifts|slides|slid)\\s+(?:back\\s+)?(?:to|until|by)\\s+(${DATEP})`, "i").exec(Cn)) && nounSubject2(r[1])) return dueChange(r[1], r[2]);
        if ((r = new RegExp(`^(?:the\\s+)?(.+?)\\s+(?:moves|move|moved|goes|go|went|shifts|shift|shifted|passes|pass|passed)\\s+from\\s+${NMX}\\s+to\\s+${NMX}\\b`, "i").exec(Cn)) && isName(r[3]) && nounSubject2(r[1].replace(/^(?:editing|the)\s+/i, ""))) { const t = find(r[1].replace(/^(?:editing|the)\s+/i, ""), r[2]) ?? find(r[1], null); if (t) { reassign(t, r[3], it, raw); return { hit: t }; } }
        // Passive: "The flyers will be printed by Marta before the 20th", "the hall booking is being taken care of by Priya instead of Søren", "the sorting will be done by Ingrid alone", "has to be registered with the city office by Zoë, no later than 15 February".
        if ((r = new RegExp(`^(?:the\\s+)?(.+?)\\s+(?:will be|is to be|are to be|is being|are being|is going to be|are going to be|is expected to be|are expected to be|has to be|have to be|must be|should be|has been|have been|is|are|was|were)\\s+(?:(?:now|also)\\s+)?([a-z]+ed|[a-z]+en|laid|cut|built|made|done|sent|bought|brought|run|held|given|found|written|drawn|chosen|put out|set up|put together|taken care of)(?:\\s+(?:with|to|at|for|in|up|out)(?:\\s+[^,]*?)?)?\\s+by\\s+${NMX}(?:['’]s\\s+\\w+)?(.*)$`, "i").exec(Cn)) && nounSubject2(r[1]) && isName(r[3])) {
          const verb = partBase(r[2]); const due = dueOf2(r[4]) ?? (new RegExp(`\\bon\\s+(${DATEP})`, "i").exec(r[4])?.[1] ?? null);
          const t = assign(r[3], r[1], it, raw, { verb, due }); return { hit: t };
        }
        return null;
      })();
      if (pre) { if (pre.hit) { last = pre.hit; lastTask = pre.hit; consumed = true; } continue; }

      // Finished.
      const nounSubject = (t: string) => t.split(/\s+/).length <= 8 && !/\b(?:will|would|can|could|should|must|once|when|after|until|because|if|unless|then|going to|plans? to|is|are|was|were|which|that|who)\b/i.test(t) && !/^[A-Z][a-zà-ÿĀ-ſḀ-ỿ]+\s+[a-z]+s\b/.test(t) && !isName(t.split(/\s+/)[0]);
      const doneMatch = ((): RegExpExecArray | null => { let r: RegExpExecArray | null;
        if ((r = /^(?:the\s+)?(.+?)\s+(?:is|are|was|were|has been|have been|got)\s+(?:now\s+|already\s+)?(?:finished|complete|completed|done|signed off|approved|delivered|shipped|sorted|fixed|repaired|resolved|installed|ordered|booked|placed|submitted)\b/i.exec(Cn)) && nounSubject(r[1])) return r;
        if ((r = /^(?:the\s+)?(.+?)\s+(?:was|were|is|are)\s+[^,]*,\s*(?:done|finished|complete|completed)$/i.exec(Cn)) && nounSubject(r[1])) return r;
        if ((r = /^[A-Z][a-zà-ÿĀ-ſḀ-ỿ]+\s+(?:has\s+)?(?:finished|completed|wrapped up|done with)\s+(?:the\s+)?(.+)$/.exec(Cn))) return r;
        return null; })();
      if (doneMatch) {
        m = doneMatch;
        const t = find(m[1], null, true); if (t) { if (!t.done) t.done = true; t.cites.push(cite(it, raw, "completed")); hit = t; } else { const nt: TaskRow = { id: `t${++n}`, task: cap(stripThe(clean(m[1]))), obj: clean(m[1]), key: keyOf(m[1]), owner: null, next: null, blocker: null, blockerKey: new Set(), due: null, progress: false, done: true, cancelled: false, cites: [cite(it, raw, "completed")], history: [] }; tasks.push(nt); hit = nt; }
      }
      // Unblocked: "filling the raised beds is no longer blocked", "Lena can submit the report now", "the soil arrived".
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:is|are)\s+(?:now\s+)?(?:no longer (?:blocked|waiting)|unblocked|ready to (?:go|start))\b/i.exec(Cn))) { const t = find(m[1], null); if (t) { unblock(t, it, raw); hit = t; } else ok = false; }
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:can|could)\s+(?:now\s+)?([a-z]+(?:\s+up)?)\s+(.+?)\s+now$/.exec(Cn)) && isName(m[1])) { const t = find(m[3], m[1]) ?? open().filter((x) => x.owner === m![1]).pop(); if (t) { unblock(t, it, raw); hit = t; } else ok = false; }
      else if ((m = /^(?:the\s+)?(.+?)\s+can\s+(?:now\s+)?(?:go ahead|proceed|start|begin|move forward|continue)\b/i.exec(Cn)) && nounSubject(m[1]) && find(m[1], null)) { const t = find(m[1], null)!; unblock(t, it, raw); hit = t; }
      else if ((m = /^(.+?)\s+(?:sent|delivered|provided|supplied|gave|approved|signed off(?: on)?)\s+(?:us\s+|them\s+)?(?:the\s+)?(.+)$/i.exec(Cn)) && !isName(m[1].split(/\s+/)[0]) && !/\b(?:already|has|have|will)\b/i.test(m[1]) && open().some((t) => t.blocker && same(t.blockerKey, keyOf(m![2])))) { const k = keyOf(m[2]); const hs = open().filter((t) => t.blocker && same(t.blockerKey, k)); for (const t of hs) unblock(t, it, raw); hit = hs[0]; }
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:has\s+|have\s+)?(?:arrived|been delivered|come in|came in|landed|is here|are here|was delivered|were delivered|got here|turned up|is confirmed|are confirmed|has been confirmed|have been confirmed|came through|(?:has |have )?(?:replied|responded|answered|confirmed|come back|got back)(?: and confirmed)?)\b/i.exec(Cn)) && !/^[A-Z][a-zà-ÿĀ-ſḀ-ỿ]+\s+(?:has|have)\b/.test(Cn)) {
        const k = keyOf(m[1]); const hits = open().filter((t) => t.blocker && same(t.blockerKey, k)); if (hits.length) { for (const t of hits) unblock(t, it, raw); hit = hits[0]; } else ok = false;
      }
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+already\s+(?:sent|finished|completed|booked|ordered|paid|submitted|done|wrapped up)\s+(?:the\s+)?(.+?)(?:\s+(?:yesterday|today|last \w+|this \w+))?$/.exec(Cn)) && isName(m[1])) { const t = find(m[2], m[1]); if (t) { t.done = true; t.cites.push(cite(it, raw, "completed")); hit = t; } else ok = false; }
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:has\s+)?(?:already\s+)?(?:collected|booked|ordered|paid|submitted|printed|delivered|bought|made|wrote|signed|cleaned|painted|built|fixed|called|emailed|phoned|posted|filed|finished|completed|arranged|organised|organized|confirmed)\s+(?:the\s+)?(.+?)(?:\s+(?:yesterday|today|last \w+|this \w+|on \w+|already))?$/.exec(Cn)) && isName(m[1]) && !/\bto\b/.test(m[2].split(" ")[0])) { const t = /^(?:it|them|this|that)$/i.test(clean(m[2])) ? open().filter((x) => (x.owner ?? "").split("+").includes(m![1])).pop() ?? null : find(m[2], m[1]); if (t) { t.done = true; t.cites.push(cite(it, raw, "completed")); hit = t; } else { consumed = true; } }
      // In progress: "they are in progress", "Felix has started the badges".
      else if ((m = /^(?:they|it|this|that)\s+(?:is|are)\s+(?:now\s+)?(?:in progress|underway|under way|started)\b/i.exec(Cn)) && last) { last.progress = true; last.cites.push(cite(it, raw, "in progress")); hit = last; }
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:is|are)\s+(?:now\s+)?(?:in progress|underway|under way|started)\b/i.exec(Cn))) { const t = find(m[1], null); if (t) { t.progress = true; t.cites.push(cite(it, raw, "in progress")); hit = t; } else ok = false; }
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:has\s+)?(?:sent|started|begun|begins|sent off)\s+(?:the\s+)?(.+?)(?:\s+to\s+.+)?$/.exec(Cn)) && isName(m[1])) { const t = find(m[2], m[1]); if (t) { t.progress = true; t.cites.push(cite(it, raw, "in progress")); hit = t; } else ok = false; }
      // Noun subjects with a state: "The pump test is blocked until the hose comes in", "The runbook is stalled until ...", "Samuel's rota is on hold until ...", "Episode three's edit is waiting on the raw audio", "The booklets cannot go to print until the logos turn up".
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:is|are)\s+(?:now\s+|still\s+)?(?:blocked|stalled|on hold|held up|stuck|waiting)\s*(until|by|on|for)?\s*(.*)$/i.exec(Cn.replace(/^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)['’]s\s+/, ""))) && m[3] && nounSubject(m[1].replace(/\b(?:blocked|stalled)\b/, ""))) {
        const t = find(m[1], null); if (t) { block(t, m[3], /^until$/i.test(m[2] ?? "") ? "Waiting until" : /^(?:by)$/i.test(m[2] ?? "") ? "Blocked by" : "Waiting for", it, raw); hit = t; } else ok = false;
      }
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:cannot|can(?:'|’)?t|can not)\s+[^,]*?\buntil\s+(.+)$/i.exec(Cn)) && nounSubject(m[1])) { const t = find(m[1], null); if (t) { block(t, m[2], "Waiting until", it, raw); hit = t; } else ok = false; }
      // "Dev cannot do the jingle after all": the task has no owner until the next sentence says who takes it.
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:cannot|can(?:'|’)?t|can not|is unable to|won(?:'|’)?t be able to)\s+(?:do|handle|take|make|run|cover|manage|finish)\s+(?:the\s+)?(.+?)(?:\s+after all|\s+any more|\s+anymore)?$/.exec(Cn)) && isName(m[1])) { const t = find(m[2], m[1]); if (t) { t.history.push(`${t.owner ?? m[1]} can no longer do it`); t.owner = null; t.cites.push(cite(it, raw, "reassigned")); hit = t; } else ok = false; }
      // "Pavel got the part": what a person received clears the blocker that was waiting for it.
      else if ((m = /^[A-Z][a-zà-ÿĀ-ſḀ-ỿ]+\s+(?:has\s+)?(?:got|gotten|received|collected|picked up)\s+(?:the\s+)?(.+)$/.exec(Cn)) && open().some((t) => t.blocker && same(t.blockerKey, keyOf(m![1])))) { const k = keyOf(m[1]); const hs = open().filter((t) => t.blocker && same(t.blockerKey, k)); for (const t of hs) unblock(t, it, raw); hit = hs[0]; }
      // "Hana's menu is now Lucía's job as Hana is travelling", "the pump test is Ines's".
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:is|are)\s+(?:now\s+)?([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)['’]s(?:\s+(?:job|task|responsibility))?(?:\s+as well)?(?:,?\s+due\b.*)?(?:\s+(?:as|because|since)\b.*)?$/.exec(Cn.replace(/^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)['’]s\s+/, ""))) && isName(m[2])) { const t = find(m[1], null); if (t) { reassign(t, m[2], it, raw); hit = t; } else { const nt = assign(m[2], m[1].replace(/^(?:the\s+)?/, ""), it, raw, { due: dueOf2(Cn) }); if (nt) hit = nt; } }
      // "The badge proof is in Leila Park's hands.", "the badge proof is with Leila".
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:is|are)\s+in\s+([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)['’]s\s+hands\b/i.exec(Cn)) && isName(m[2])) { const t = assign(m[2], m[1], it, raw, {}); if (t) hit = t; }
      // "She is waiting for the sponsor artwork before she can release it." (the person and task named just before)
      else if ((m = /^(?:she|he|they)\s+(?:is|are)\s+(?:still\s+)?waiting\s+(?:for|on)\s+(.+?)(?:\s+before\s+(?:she|he|they)\s+can\s+(.+))?$/i.exec(Cn)) && lastTask && !lastTask.done) {
        block(lastTask, m[1], "Waiting for", it, raw); if (m[2]) { const objp = /^(?:the|a|an|our|their)\s/i.test(lastTask.obj) ? lastTask.obj : `the ${lastTask.obj}`; lastTask.next = cap(clean(m[2]).replace(/\b(it|them|this|that)\b/i, objp)); } hit = lastTask;
      }
      // Reassigned: "the sound system is now with Lucia", "The posters have been handed to Tomas", "Route signs passed to Bao", "Carmen's helmet collection moved to Elena".
      else if ((m = /^(?:the\s+)?(.+?)\s+(?:(?:is|are|has been|have been|was|were)\s+)?(?:now\s+)?(?:with|(?:handed|passed|moved|reassigned|assigned|given|going|gone|transferred|handed over|passed on|passed over)(?:\s+(?:over|on))?\s+to|owned by|falls? to|goes to|stays with|remains? with)\s+([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\b/.exec(Cn.replace(/^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)['’]s\s+/, ""))) && isName(m[2])) {
        const t = find(m[1], null); if (t) { reassign(t, m[2], it, raw); hit = t; } else { notes.push(`“${raw}” hands something to ${m[2]}, but no earlier note described that task, so it was not applied.`); unparsed.push({ text: raw, src: it }); hit = null; ok = true; consumed = true; }
      }
      // "Inez has taken over the printer booking from Theo and can book it now", "Sven also takes the marshal vests".
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:is\s+|are\s+|has\s+|will\s+)?(?:now\s+|also\s+)?(?:taken|takes|taking|took|take|picks up|picked up)\s+(?:over\s+)?(?:the\s+)?(.+?)(?:\s+from\s+([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*))?(?:\s+and\s+(.*))?$/.exec(Cn)) && isName(m[1])) {
        const unb = m[4] && /\bcan\s+\w+\s+it\s+now\b|no longer blocked|unblocked/i.test(m[4]); const t = assign(m[1], m[2], it, raw); if (t) { if (unb) unblock(t, it, raw); hit = t; }
      }
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:has\s+)?(?:handed|passed|gave)\s+(?:off\s+)?(?:the\s+)?(.+?)\s+(?:over\s+)?to\s+([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\b/.exec(Cn)) && isName(m[1]) && isName(m[3])) { const t = find(m[2], m[1]) ?? find(m[2], null); if (t) { reassign(t, m[3], it, raw); hit = t; } else { assign(m[3], m[2], it, raw); } }
      // Waiting: "Mara is still waiting for the final photo credits."
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:is\s+)?(?:still\s+)?(?:waiting\s+(?:for|on)|blocked\s+(?:on|by))\s+(.+)$/i.exec(Cn)) && isName(m[1])) {
        const t = open().filter((x) => x.owner === m![1]).pop(); if (t) { block(t, m[2], "Waiting for", it, raw); hit = t; } else { const nt = assign(m[1], `work waiting on ${m[2]}`, it, raw); if (nt) { block(nt, m[2], "Waiting for", it, raw); hit = nt; } }
      }
      // Ownership and assignment: "Mara owns caption proofing and needs the final photo credits before she can send the proof", "Devon sets up the sound system", "Ana will call the caterer".
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:now\s+|also\s+|still\s+)?(?:owns|is responsible for|handles|is handling|leads|is leading|is working on|will own|will handle|is in charge of|looks after|is on the hook for|takes the lead on|takes charge of|takes care of|is taking the lead on|has the lead on)\s+(.+)$/.exec(Cn)) && isName(m[1])) {
        const sb = splitBlocker(m[2]); const rest = sb.rest; const blocker = sb.blocker; const next = sb.next;
        const t = assign(m[1], rest, it, raw, { blocker, next }); if (t) hit = t;
      }
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:was|is|has been|were)\s+(?:assigned|asked|tasked)\s+(?:to|with)\s+(.+)$/.exec(Cn)) && isName(m[1])) { const v = /^([a-z]+)\s+(.*)$/.exec(m[2]); const t = v && !["the", "a", "an"].includes(v[1]) ? assign(m[1], v[2], it, raw, { verb: v[1] }) : assign(m[1], m[2], it, raw); if (t) hit = t; }
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:will(?:\s+also)?|(?:is|are)(?:\s+also)?\s+going to|plans? to|should|must(?:\s+also)?|needs? to|has to|have to|(?:also\s+)?agreed to|has agreed to|promised to|volunteered to|offered to|(?:is|are) to)(?:\s+(?:also|jointly|together))?\s+([a-z]+(?:\s+up)?)\s+(.+)$/i.exec(Cn)) && isName(m[1])) {
        const sb = splitBlocker(m[3]); const rest = sb.rest; const blocker = sb.blocker;
        const t = assignMany(m[1], rest, it, raw, { verb: m[2], blocker }); if (t) hit = t;
      }
      // "Priya is covering for Omar on the invoice export": Omar's work (or that one task) goes to Priya.
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:is|are|will be)\s+(?:now\s+)?(?:covering|standing in|filling in|stepping in|substituting|subbing)\s+for\s+([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)(?:\s+(?:on|with|for)\s+(?:the\s+)?(.+))?$/.exec(Cn)) && isName(m[1]) && isName(m[2])) {
        const what = m[3] ? m[3].replace(/\s+(?:while|because|since|as|until|when)\b.*$/i, "") : null; const pool = what ? open().filter((t) => same(t.key, keyOf(what))) : open().filter((t) => t.owner === m![2]); const mine = pool.filter((t) => t.owner === m![2]); const hitsT = mine.length ? mine : pool;
        if (hitsT.length) { for (const t of hitsT) reassign(t, m[1], it, raw); hit = hitsT[0]; } else ok = false;
      }
      // "Faye is ordering the banners", "Noor is picking up the banners": a person doing a task now.
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:is|are)\s+(?:now\s+|also\s+|still\s+)?([a-z]{3,}ing)(\s+(?:up|out|off|over|down))?\s+(?:(?:the|a|an|our|their|all|some|new|his|her)\s+)?(.+)$/.exec(Cn)) && isName(m[1]) && !/^(?:waiting|being|going|having|looking|hoping|thinking|feeling|trying|wondering|doing)$/.test(m[2])) {
        const verb = `${ingBase(m[2])}${m[3] ? m[3] : ""}`; const whole = Cn.slice(Cn.indexOf(m[2]) + m[2].length + (m[3] ? m[3].length : 0)).trim(); const sb = splitBlocker(whole);
        const t = assignMany(m[1], sb.rest, it, raw, { verb, blocker: sb.blocker, next: sb.next }); if (t) hit = t;
      }
      // "Book the health inspection with the council, I will do that.": a task with no named owner.
      else if ((m = /^((?:book|call|email|send|order|confirm|pay|buy|fix|finish|submit|check|arrange|find|collect|schedule|renew|cancel|prepare|draft|write|remind|follow up|chase)\b.+?)(?:,?\s+(?:I|we) (?:will|'ll|need to) (?:do|handle) (?:that|it|this))?$/.exec(Cn))) { const v = /^([a-z]+(?: up)?)\s+(.*)$/.exec(m[1]); if (v) { const t = assign("", v[2], it, raw, { verb: v[1] }); if (t) { t.owner = null; hit = t; } } }
      // Any other "<Name> <verb>s <rest>" is a task for that person: "Maria runs the bake sale table", "Tomas books the raffle prizes", "Greta buys the candles and paints the route signs".
      else if ((m = /^([A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?(?:\+[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]+(?:-[A-Za-zà-ÿĀ-ſḀ-ỿ]+)?)*)\s+(?:now\s+|also\s+|still\s+)?([a-z]+s)\s+((?:up|out|off|over|down)\s+)?(?:(?:the|a|an|our|their|all|some|new)\s+)?(.+)$/.exec(Cn)) && isName(m[1]) && !NOT_TASK_VERBS.has(m[2]) && !/^(?:to|from|by|that|with|for)\b/i.test(m[4])) {
        const verb = `${m[2]}${m[3] ? ` ${m[3].trim()}` : ""}`; const whole = Cn.slice(Cn.indexOf(m[2]) + m[2].length).trim();
        const parts = whole.split(/\s+and\s+(?=[a-z]+s\s+(?:the|a|an|their|our)\b)/); let first: TaskRow | null = null;
        parts.forEach((part, i) => { const v = i === 0 ? verb : (/^([a-z]+s)\b/.exec(part)?.[1] ?? verb); const rest = i === 0 ? part.replace(/^(?:up|out|off|over|down)\s+/, "") : part.replace(/^[a-z]+s\s+/, ""); const sbp = splitBlocker(rest); const obj = sbp.rest; const blocker = sbp.blocker; const vv = i === 0 && m![3] ? `${v}` : v; const full = i === 0 && m![3] ? `${m![2]} ${m![3].trim()}` : vv; const t = assign(m![1], obj, it, raw, { verb: full, blocker }); first = first ?? t; });
        if (first) hit = first;
      }
      else if (/^(?:nothing|no\s+\w+|none)\b[^.]*\b(?:changed|different|new)\b|\b(?:is|are|was|were|remains?|stays?)\s+(?:all\s+)?(?:unchanged|the same|as before|as planned)\b|^(?:everything|all)\s+else\b/i.test(Cn)) { consumed = true; }   // a statement that nothing changed carries no task
      else ok = false;
      if (hit) { last = hit; lastTask = hit; consumed = true; }
      void ok;
    }
    // A sentence that names a person or a task on the list but was not understood is reported, not dropped.
    if (!consumed) { const taskish = new RegExp(`\\b(?:will|needs? to|has to|have to|must|should|owns|handles?|stalled|blocked|waiting|stuck|covering|taking over|picking up|assigned|responsible|in charge|agreed|promised|volunteered|offered|going to|cancel+ed|anymore|instead of|moved|pushed|due|deadline|taken care of)\\b|\\bis\\s+[a-z]+ing\\b|\\b(?:by|before|no later than)\\s+${DATEP}`, "i").test(S); const mentionsOwner = (S.match(/\b[A-Z][a-zà-ÿĀ-ſḀ-ỿ]{1,15}\b/g) ?? []).some((w) => taskish && (tasks.some((t) => t.owner === w) || nameWords.has(w.toLowerCase()))); const mentionsTask = tasks.some((t) => same(t.key, keyOf(S))); const anyOwner = (S.match(/(?<![\wÀ-ÿĀ-ſḀ-ỿ])[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]{1,15}\b/g) ?? []).some((w) => tasks.some((t) => (t.owner ?? "").split("+").includes(w))); const toks = (S.match(/(?<![\wÀ-ÿĀ-ſḀ-ỿ])[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]{1,15}(?:-[a-zà-ÿĀ-ſḀ-ỿ]+)?/g) ?? []); const namesPerson = toks.some((w) => tasks.some((t) => (t.owner ?? "").split("+").includes(w))) || (!!it.corrects && toks.some((w) => nameWords.has(w.toLowerCase()) && !S.startsWith(w))); const unowned = /\b(?:needs? to be \w+|still need|to be (?:set|decided|confirmed|booked|arranged|assigned|chosen)|maybe|might|tbd|not (?:yet )?(?:decided|set|assigned|settled)|no one|nobody|unassigned|someone (?:needs|should|has) to|up in the air)\b/i.test(S); if ((mentionsOwner || mentionsTask || unowned || namesPerson || (it.corrects && anyOwner)) && !/^[A-Z][a-zà-ÿĀ-ſḀ-ỿ]+(?:\s+[a-z]+){0,3}\.?$/.test(S)) unparsed.push({ text: raw, src: it }); }
  }
  return { tasks, notes, unparsed, disp };
}

const ADJ = /^(?:the\s+)?(?:current|latest|new|present|assigned|responsible|main|primary|updated)\s+/i;
const COLS: [RegExp, string][] = [[/^(?:owner|assignee|who|person|responsible|in charge)\b/i, "owner"], [/^(?:task|item|work|what|job)\b/i, "task"], [/^(?:next action|next step|next|action)\b/i, "next"], [/^(?:blocker|blocked by|blocking|waiting on|dependency|blocked)\b/i, "blocker"], [/^(?:status|state|progress)\b/i, "status"], [/^(?:due(?: date)?|deadline|due by|when)\b/i, "due"]];
export const columnKey = (c: string) => { const t = c.trim().replace(/^(?:the\s+)?/i, "").replace(ADJ, ""); return COLS.find(([r]) => r.test(t))?.[1] ?? null; };
const COLWORDS = /\b(status|due date|due|deadline|priority|phone number|phone|e-?mail address|e-?mail|cost|budget|location|hourly rate|rate|total hours|hours|manager|salary|price|quantity|contact)\b/gi;
/** Column nouns a request mentions (status, due date, budget, phone number...), so the saved table can be checked for covering them. */
export const columnMentions = (request: string) => [...new Set([...request.matchAll(COLWORDS)].map((m) => m[1].toLowerCase()))];
export const coversMention = (name: string, keys: string[], columns: string[]) => (name === "status" && keys.includes("status")) || (/^(?:due|due date|deadline)$/.test(name) && keys.includes("due")) || columns.some((c) => c.toLowerCase().includes(name.split(" ")[0]));

const MONNUM: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** A sortable key for a due phrase: "4 May", "May 4", "the 9th". Unreadable or missing dates sort last. */
const dueKey = (d: string | null): number => { if (!d) return 99999; const m1 = /(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3})/.exec(d) ?? null; const m2 = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/.exec(d); let mo = 0, day = 0; if (m1 && MONNUM[m1[2].toLowerCase()]) { mo = MONNUM[m1[2].toLowerCase()]; day = Number(m1[1]); } else if (m2 && MONNUM[m2[1].toLowerCase()]) { mo = MONNUM[m2[1].toLowerCase()]; day = Number(m2[2]); } else { const m3 = /the\s+(\d{1,2})/.exec(d); if (m3) return 5000 + Number(m3[1]); return 9000; } return mo * 100 + day; };

/** Build the table or checklist. Columns the sources cannot fill are reported, not made up. */
export function buildTaskTable(items: ItemIn[], spec: TableSpec): TableAnalysis {
  const { tasks, notes, unparsed, disp } = buildLedger(items);
  return tableFromTasks(tasks, notes, unparsed, disp, spec);
}
/** Shape tasks (from the local reader or from a validated Claude reading) into the requested table or checklist. */
export function tableFromTasks(tasks: TaskRow[], notes: string[], unparsed: { text: string; src: Src }[], disp: (o: string | null) => string, spec: TableSpec): TableAnalysis {
  const wanted0 = spec.columns.length ? spec.columns : ["Owner", "Next action", "Blocker"];
  let keys = wanted0.map((c) => columnKey(c) ?? "unknown"); let wanted = [...wanted0];
  if (spec.autoDue && !keys.includes("due") && tasks.some((t) => !t.done && t.due)) { keys.push("due"); wanted.push("Due"); }
  // A row without a task name is not a handoff. When no column says what the work is, the task comes first.
  let addedTaskColumn = false; if (!keys.includes("task") && !keys.includes("next")) { keys = ["task", ...keys]; wanted = ["Task", ...wanted]; addedTaskColumn = true; }
  const missingColumns = wanted.filter((_, i) => keys[i] === "unknown").map(cap);
  const open = tasks.filter((t) => !t.done); let shown = spec.excludeDone ? open : tasks.filter((t) => !t.cancelled || keys.includes("status")); let filtered: string | null = null;
  const firstOf = (o: string | null) => (o ?? "").split("+").map((x) => x.toLowerCase());
  if (spec.person) { filtered = spec.person; shown = shown.filter((t) => firstOf(t.owner).includes(spec.person!.toLowerCase())); }
  if (spec.about) { filtered = spec.about; const k = keyOf2(spec.about); shown = shown.filter((t) => sameKey(t.key, k)); }
  if (spec.sortByDue) shown = [...shown].sort((a, b) => dueKey(a.due) - dueKey(b.due));
  const status = (t: TaskRow) => t.cancelled ? "Cancelled" : t.done ? "Done" : t.blocker ? `Blocked. ${t.blocker}` : t.progress ? "In progress" : "Open";
  const cell = (t: TaskRow, k: string) => k === "owner" ? disp(t.owner) : k === "task" ? t.task : k === "next" ? (t.done ? (t.cancelled ? "Cancelled" : "None (complete)") : t.next ? `${t.next}${t.due && !keys.includes("due") ? ` (due ${t.due})` : ""}` : "Not stated") : k === "blocker" ? (t.done ? (t.cancelled ? "Cancelled" : "None (complete)") : t.blocker ?? "None reported") : k === "status" ? status(t) : k === "due" ? t.due ?? "Not stated" : "Not stated";
  let rows = shown.map((t) => ({ task: t.task, owner: disp(t.owner), due: t.due, cites: t.cites, cells: keys.map((k) => cell(t, k)) }));
  if (spec.perPerson) {   // one row per person: that person's tasks, blockers and statuses joined, each cell still cited through the tasks behind it
    const by = new Map<string, TaskRow[]>(); for (const t of shown) for (const who of (t.owner ?? "").split("+").filter(Boolean).length ? (t.owner ?? "").split("+") : ["Unassigned"]) by.set(who, [...(by.get(who) ?? []), t]);
    rows = [...by].map(([who, ts]) => ({ task: ts.map((t) => t.task).join("; "), owner: disp(who), due: ts.length === 1 ? ts[0].due : null, cites: ts.flatMap((t) => t.cites), cells: keys.map((k) => k === "owner" ? disp(who) : [...new Set(ts.map((t) => cell(t, k)))].filter((x) => !/^(None reported|Not stated)$/.test(x) || ts.length === 1).join("; ") || cell(ts[0], k)) }));
  }
  // A column every cell of which says "Not stated" is a column the notes cannot fill, whatever its name.
  keys.forEach((k, i) => { if ((k === "due" || k === "next") && rows.length && rows.every((r) => r.cells[i] === "Not stated") && !missingColumns.includes(cap(wanted[i]))) missingColumns.push(cap(wanted[i])); });
  const leftOut: TableAnalysis["leftOut"] = [];
  for (const t of tasks.filter((x) => x.done && (spec.excludeDone || (x.cancelled && !keys.includes("status"))))) leftOut.push({ text: cap(t.task), reason: t.cancelled ? "cancelled" : "complete", cites: t.cites });
  for (const t of open) for (const h of t.history) leftOut.push({ text: `${t.task}: ${h}`, reason: "handed over, the row shows the current value", cites: t.cites });
  for (const u of unparsed) notes.push(`Not applied, because I could not read it as a task, a handover or a status: “${u.text}” (${u.src.title}).`);
  return { type: "table", form: spec.form ?? "table", columns: wanted.map(cap), keys, rows, leftOut, notes, unparsed, missingColumns, openCount: filtered ? shown.length : open.length, taskCount: tasks.length, addedTaskColumn, numbered: !!spec.numbered, filtered };
}
const keyOf2 = (t: string) => new Set((t.toLowerCase().replace(/['’]s\b/g, "").match(/[a-zà-ÿĀ-ſḀ-ỿ]{2,}/g) ?? []).filter((w) => !["the", "a", "an", "and", "of", "to", "for", "with", "on", "in", "at", "by"].includes(w)).map((w) => w.replace(/(?:es|s)$/, "").replace(/(?:ing|ed|e)$/, "")));
const sameKey = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return false; const [sm, lg] = a.size <= b.size ? [a, b] : [b, a]; return [...sm].every((x) => lg.has(x) || [...lg].some((y) => (y.length >= 4 && x.startsWith(y)) || (x.length >= 4 && y.startsWith(x)))); };
export const tableMarkdown = (t: TableAnalysis) => { const esc = (s: string) => s.replace(/\|/g, "\\|"); return [`| ${t.columns.join(" | ")} |`, `|${t.columns.map(() => "---").join("|")}|`, ...t.rows.map((r) => `| ${r.cells.map(esc).join(" | ")} |`)].join("\n"); };
export const tableTsv = (t: TableAnalysis) => [t.columns.join("\t"), ...t.rows.map((r) => r.cells.join("\t"))].join("\n");
/** A checklist grouped by person, or a numbered list when asked: one line per open task with its next step, due date and blocker. */
export function checklistMarkdown(t: TableAnalysis): string {
  const ix = (k: string) => t.keys.indexOf(k); const line = (r: TableAnalysis["rows"][number]) => { const nx = ix("next") >= 0 ? r.cells[ix("next")] : r.task; const bl = ix("blocker") >= 0 && !/^None/.test(r.cells[ix("blocker")]) ? ` (${r.cells[ix("blocker")]})` : ""; const due = r.due ? `, due ${r.due}` : ""; return `${nx === "Not stated" ? r.task : nx}${due}${bl}`; };
  if (t.numbered) return t.rows.map((r, i) => `${i + 1}. ${line(r)} (${r.owner ?? "Unassigned"})`).join("\n");
  const by = new Map<string, typeof t.rows>(); for (const r of t.rows) by.set(r.owner ?? "Unassigned", [...(by.get(r.owner ?? "Unassigned") ?? []), r]);
  const out: string[] = []; for (const [who, rs] of by) { out.push(`**${who}**`); for (const r of rs) out.push(`- [ ] ${line(r)}`); out.push(""); }
  return out.join("\n").trim();
}

/** People named in the notes: capitalised words never written in lower case, seen somewhere other than the start of a sentence or as a possessive owner. */
export function personNames(items: ItemIn[]): Set<string> {
  const lower = new Set((items.flatMap((it) => it.sentences.map((x) => x.text)).join(" ").match(/\b[a-z]{3,}\b/g) ?? [])); const out = new Set<string>();
  for (const it of items) for (const sn of it.sentences) { const re = /(?<![\wÀ-ÿĀ-ſḀ-ỿ])[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ]{1,15}(?:-[a-zà-ÿĀ-ſḀ-ỿ]+)?/g; let m: RegExpExecArray | null; while ((m = re.exec(sn.text))) { const w = m[0]; const first = m.index === 0; if (NOT_NAMES.has(w) || lower.has(w.toLowerCase().split("-")[0])) continue; if (!first || /^[A-ZÀ-ÝĀ-ſḀ-ỿ][a-zà-ÿĀ-ſḀ-ỿ-]+\s+(?:will|is|are|has|have|must|should|can|owns|handles|volunteered)\b/.test(sn.text)) out.add(w.toLowerCase()); } }
  return out;
}
