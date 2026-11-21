// Time, capacity and duration planning from authorized evidence. Pure functions: the same sources and request always give the same plan.
// Two kinds of question are handled, and both are written in terms of form (quantities, windows, durations, dates), not of any example:
//   "capacity"  where and when can this happen so that everyone fits (rooms, seats, sessions, breaks, availability windows)
//   "batch"     how many runs does this take, when does each start and end, and is it done before a deadline (cycles, operating windows)
// Every figure used carries its source and quote. Statements about somebody else's matter, about another date, or superseded by a later
// statement are set aside and shown, never silently mixed in. When an input is missing or two readings give different answers, the
// plan says so and asks one precise question instead of guessing.
import type { ItemIn, Src } from "./decision";

export const PLAN_Q = new RegExp([
  String.raw`\b(?:where and when|which (?:room|slot|day|time|space)|what time)\b`,
  String.raw`\bwhen (?:do|should|can|will|must|could) (?:i|we) (?:start|begin|run|hold|schedule|book|fire|load|send|set up|leave)\b`,
  String.raw`\beach (?:firing|run|batch|session|load|shift|trip)\b`,
  String.raw`\bhow many (?:sessions|firings|runs|batches|shifts|trips|rounds|vehicles|vans|buses|cars)\b`,
  String.raw`\bfit(?:s)? (?:everyone|all)\b`,
  String.raw`\beveryone (?:who )?(?:is )?(?:registered |signed up )?(?:can|could|will|to) ?attend\b`,
  String.raw`\bbefore the [\w -]{0,40}?(?:load-?in|deadline|opening|cut-?off|set-?up)\b`,
  String.raw`\b(?:finished|fired|done|unloaded|processed|completed|ready) (?:and \w+ )?before (?:the )?[\w -]{0,30}?(?:load-?in|deadline|opening)\b`,
  // "Can one van get everyone there by 10:30?": a feasibility question about moving or serving a count against a time.
  String.raw`\b(?:can|could|will|would|is it possible|are we able)\b[^.?!]{0,80}\b(?:get|make|fit|reach|arrive|finish|complete|carry|move|transport|deliver|serve|seat)\b[^.?!]{0,80}\b(?:by|before|within|in time|on time|everyone|all of)\b`,
  String.raw`\b(?:can|could|will|would)\b[^.?!]{0,60}\b(?:all|everyone|everything|whole|entire)\b[^.?!]{0,60}\b(?:by|before|within)\s+(?:\d|the\b|noon|midnight)`,
  String.raw`\b(?:will|would|can|could|does|do|is|are)\b[^.?!]{0,60}\bfit\b[^.?!]{0,40}\b(?:in|into|within|before|inside)\b`,
  String.raw`\b(?:when|what time) (?:does|do|will) (?:each|every)\b[^.?!]{0,30}\b(?:start|begin|end|finish)`,
  String.raw`\b(?:show|tell me|work out|figure out|calculate|when does|when do|what time does|what time do)\b[^.?!]{0,40}\b(?:last|final|first|each|every)\b[^.?!]{0,30}\b(?:arrive|arrives|arrival|finish|finishes|end|ends|done|leave|leaves|depart|departs)\b`,
].join("|"), "i");
export const isPlanRequest = (t: string) => PLAN_Q.test(t);

export interface PlanRow { label: string; value: string; src: Src | null; srcTitle: string; quote: string | null; note?: string }
export interface PlanStep { when: string; what: string }
export interface PlanOpt { option: string; label: string; verdict: "works" | "fails" | "depends"; summary: string; steps: PlanStep[]; checks: string[] }
export interface PlanRec { kind: "recommend" | "ask" | "none_fits" | "insufficient"; option: string | null; label: string | null; headline: string; tradeoff: string[]; question: string | null; nextAction: { kind: string; option?: string; text: string } | null; basis: string[]; qualifiers: string[] }
export interface PlanAnalysis { type: "plan"; kind: "capacity" | "batch" | "trips" | "sequence"; recommendation: PlanRec; inputs: PlanRow[]; computation: string[]; options: PlanOpt[]; setAside: PlanRow[]; notes: string[]; contact: { name: string | null; why: string } | null; data: Record<string, unknown>;
  /** Figures the plan computed, by name, so a request for "the last arrival" can be checked against what was actually produced. */
  figures?: { label: string; value: string }[];
  /** Strings that must appear in a draft built from this plan, so the draft cannot drift from the verified answer. */
  keyFigures?: string[];
  /** Computed sentences a draft may use, and the questions it may ask, in the plan's own words. */
  draftSketch?: { lines: string[]; ask: string[]; subject: string; form?: "message" | "list" } | null }

// ---------- words, time and dates ----------
const STOP = new Set("the and for you your are was were with that this from have has had not but can could would should will shall all any each every where when what which who how why get got our out into onto than then them they their there here also too very more most some such only own same just about over under after before between during while does did done being been its it's i'm i'd my me we us he she him her his hers one two three four draft short note write email message please make give need want like let see tell show find ask send book slot slots plan start begin run ready tomorrow today tonight morning everyone registered attend people".split(" "));
const DAYS = new Set("monday tuesday wednesday thursday friday saturday sunday".split(" "));
const stem = (t: string) => t.replace(/(?:es|s)$/, "").replace(/(?:ing|ed|e)$/, "");
export const wordsOf = (text: string) => [...new Set((text.replace(/'s\b/g, "").toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w) && !DAYS.has(w)).map(stem))];
/** Distinctive words of the request: what the question is about. Capitalised words after the first are names, not topic. */
function topicOf(request: string): string[] {
  const raw = request.match(/[A-Za-z][A-Za-z'-]*/g) ?? []; const kept = raw.filter((w, i) => i === 0 || !/^[A-Z]/.test(w));
  return wordsOf(kept.join(" ").replace(/-/g, " "));
}
const overlap = (topic: string[], text: string) => { const w = new Set(wordsOf(text.replace(/-/g, " "))); return topic.filter((t) => w.has(t)).length; };

const MON = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DT = () => new RegExp(`\\b(${MON})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?(?:,?\\s+(?:at\\s+)?(\\d{1,2}):(\\d{2}))?`, "gi");
const CLOCK = "(\\d{1,2}):(\\d{2})\\s*(am|pm)?|(\\d{1,2})\\s*(am|pm)";
const monthIndex = (m: string) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m.slice(0, 3).toLowerCase());
const clockMin = (h: string | undefined, m: string | undefined, ap: string | undefined) => { let hh = Number(h); const mm = Number(m ?? 0); if (ap) { const p = ap.toLowerCase(); if (p === "pm" && hh < 12) hh += 12; if (p === "am" && hh === 12) hh = 0; } return hh * 60 + mm; };
const clocksIn = (s: string): number[] => { const out: number[] = []; for (const m of s.matchAll(new RegExp(CLOCK, "gi"))) out.push(m[1] !== undefined ? clockMin(m[1], m[2], m[3]) : clockMin(m[4], undefined, m[5])); return out; };
/** Epoch minutes where the wall clock is read as UTC: no time zone arithmetic, so a plan never shifts by an hour. */
const epoch = (y: number, mo: number, d: number, min = 0) => Date.UTC(y, mo, d, 0, 0) / 60000 + min;
const dayOf = (e: number) => Math.floor(e / 1440) * 1440;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const fmtDay = (e: number) => { const d = new Date(e * 60000); return `${WD[d.getUTCDay()]} ${MN[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const fmtAt = (e: number) => `${fmtDay(e)} ${hhmm(((e % 1440) + 1440) % 1440)}`;
const fmtSpan = (mins: number) => { const a = Math.abs(mins); const h = Math.floor(a / 60), m = a % 60; return `${h ? `${h} hour${h === 1 ? "" : "s"}` : ""}${h && m ? " " : ""}${m ? `${m} minute${m === 1 ? "" : "s"}` : ""}` || "0 minutes"; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Dates with an optional time in a sentence, with the year taken from when the source was written. */
function datesIn(s: string, atIso: string): { e: number; day: number; hasTime: boolean; index: number }[] {
  const out: { e: number; day: number; hasTime: boolean; index: number }[] = []; const ref = new Date(atIso); const ry = ref.getUTCFullYear();
  for (const m of s.matchAll(DT())) {
    const mo = monthIndex(m[1]); const d = Number(m[2]); if (mo < 0 || d < 1 || d > 31) continue;
    let y = m[3] ? Number(m[3]) : ry; let day = epoch(y, mo, d);
    if (!m[3] && day < ref.getTime() / 60000 - 60 * 1440) { y += 1; day = epoch(y, mo, d); }
    const hasTime = m[4] !== undefined; out.push({ e: day + (hasTime ? clockMin(m[4], m[5], undefined) : 0), day, hasTime, index: m.index ?? 0 });
  }
  return out;
}

interface Sent { item: ItemIn; text: string; start: number; end: number; mine: boolean; first: boolean }
function sentencesOf(items: ItemIn[]): Sent[] {
  const out: Sent[] = [];
  for (const item of items) for (const s of item.sentences) out.push({ item, text: s.text, start: s.start, end: s.end, mine: item.ownerAuthored, first: false });
  return out;
}
const quoteOf = (s: Sent) => s.text.replace(/\s+/g, " ").trim();
const row = (label: string, value: string, s: Sent | null, note?: string): PlanRow => ({ label, value, src: s ? s.item : null, srcTitle: s ? s.item.title : "Your request", quote: s ? quoteOf(s) : null, note });
/** What a sender says about their own matter ("my cups", "our event") is not about yours. */
const ownMatterOfSender = (s: Sent) => !s.item.ownerAuthored && /\b(my|our|mine)\b/i.test(s.text);
const byRecency = (a: Sent, b: Sent) => String(b.item.at).localeCompare(String(a.item.at)) || b.start - a.start;

// ---------- shared: which sentences are about this question ----------
function dayOfIso(e: number) { return dayOf(e); }

// =====================================================================================================
//  CAPACITY: where and when, so that everyone fits
// =====================================================================================================
const ROOM = /\b((?:Room|Hall|Studio|Lab|Suite|Auditorium|Classroom|Gym|Theatre|Theater|Boardroom|Space)\s+[A-Z0-9][\w-]*)/g;
const HEAD = /\b(\d{1,5})\s+(?:people|persons|attendees|participants|guests|members|students|staff|employees|learners|trainees)\b[^.]{0,40}?\b(?:registered|signed up|sign(?:ed)? up|attending|confirmed|coming|enrolled|booked)\b|\b(?:registered|signed up|enrolled|confirmed)\b[^.]{0,30}?\b(\d{1,5})\s+(?:people|persons|attendees|participants|guests|members|students|staff)\b/i;
const CAPTXT = /(?:holds|seats|fits|accommodates)\s+(?:(?:a\s+)?max(?:imum)?(?:\s+of)?\s+|up\s+to\s+)?(\d{1,5})|(?:limit|capacity)\s+of\s+(\d{1,5})|\bmax(?:imum)?(?:\s+of)?\s+(\d{1,5})/i;

interface RoomState { name: string; cap: { n: number; s: Sent } | null; capHistory: { n: number; s: Sent }[]; avail: { kind: "blocked_all" | "free_all" | "free_from" | "blocked_until" | "blocked_between"; from?: number; to?: number; s: Sent } | null }

function planCapacity(items: ItemIn[], request: string): PlanAnalysis | null {
  const topic = topicOf(request); if (!topic.length) return null;
  const all = sentencesOf(items);
  const scored = items.map((it) => ({ it, sc: overlap(topic, `${it.title}. ${it.sentences.map((x) => x.text).join(" ")}`) })).filter((x) => x.sc > 0);
  const max = Math.max(0, ...scored.map((x) => x.sc)); const topicItems = new Set(scored.filter((x) => x.sc === max && max > 0).map((x) => x.it));
  const inputs: PlanRow[] = []; const setAside: PlanRow[] = []; const notes: string[] = []; const comp: string[] = [];

  // The day: the date the topic itself is about.
  const topicSents = all.filter((s) => topicItems.has(s.item));
  const dayCands = topicSents.flatMap((s) => datesIn(s.text, s.item.at).map((d) => ({ d, s }))).sort((a, b) => byRecency(a.s, b.s));
  const target = dayCands[0]?.d.day ?? null; const targetSent = dayCands[0]?.s ?? null;
  if (target !== null) inputs.push(row("Day", fmtDay(target), targetSent));
  const sameDay = (s: Sent) => { const ds = datesIn(s.text, s.item.at); if (!ds.length || target === null) return true; return ds.some((d) => d.day === target); };

  // Headcount: the latest statement wins, the older ones stay visible as replaced.
  const heads = topicSents.map((s) => { const m = HEAD.exec(s.text); return m ? { n: Number(m[1] ?? m[2]), s } : null; }).filter(Boolean).filter((h) => sameDay(h!.s) ).sort((a, b) => byRecency(a!.s, b!.s)) as { n: number; s: Sent }[];
  const headcount = heads[0] ?? null;
  if (headcount) { inputs.push(row("People to seat", String(headcount.n), headcount.s, "latest statement")); for (const h of heads.slice(1)) if (h.n !== headcount.n) setAside.push(row("Earlier headcount", String(h.n), h.s, `replaced by ${headcount.n} (${headcount.s.item.title})`)); }

  // Session shape: length, break, trainer or host window. Taken from the topic's own sources.
  const lenS = topicSents.map((s) => { const m = /(\d+(?:\.\d+)?)\s*(minute|min|hour|hr)s?\s+(?:per\s+|each\s+|a\s+)?session/i.exec(s.text); return m ? { min: Math.round(Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1)), s } : null; }).filter(Boolean).sort((a, b) => byRecency(a!.s, b!.s))[0] as { min: number; s: Sent } | undefined;
  const brkS = topicSents.map((s) => { const m = /(\d+)\s*(minute|min|hour|hr)s?\s+break/i.exec(s.text); return m ? { min: Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1), s } : null; }).filter(Boolean).sort((a, b) => byRecency(a!.s, b!.s))[0] as { min: number; s: Sent } | undefined;
  const winS = topicSents.map((s) => { const m = new RegExp(`(?:available|free|from|between)\\s+(${CLOCK})\\s+(?:to|until|-|and)\\s+(${CLOCK})`, "i").exec(s.text); if (!m) return null; const cl = clocksIn(m[0]); return cl.length >= 2 ? { a: cl[0], b: cl[1], s } : null; }).filter(Boolean).sort((a, b) => byRecency(a!.s, b!.s))[0] as { a: number; b: number; s: Sent } | undefined;
  if (lenS) inputs.push(row("Session length", `${lenS.min} minutes`, lenS.s));
  if (brkS) inputs.push(row("Break between sessions", `${brkS.min} minutes`, brkS.s)); else notes.push("No break between sessions was stated, so none is assumed.");
  if (winS) inputs.push(row("Available to run sessions", `${hhmm(winS.a)} to ${hhmm(winS.b)}`, winS.s));
  const len = lenS?.min ?? null; const brk = brkS?.min ?? 0;

  // Rooms: capacity and availability on that day only.
  const rooms = new Map<string, RoomState>(); const roomOf = (name: string) => { let r = rooms.get(name); if (!r) { r = { name, cap: null, capHistory: [], avail: null }; rooms.set(name, r); } return r; };
  for (const s of [...all].sort((a, b) => byRecency(b, a))) {   // oldest first, so the latest statement is applied last
    const names = [...new Set([...s.text.matchAll(ROOM)].map((m) => m[1]))]; if (names.length !== 1) continue;
    const name = names[0]; const cm = CAPTXT.exec(s.text); const hasAvail = /\b(booked|taken|reserved|unavailable|in use|free|available|open)\b/i.test(s.text);
    if (!cm && !hasAvail) continue;
    if (!sameDay(s)) { setAside.push(row(name, cm ? `limit ${cm[1] ?? cm[2] ?? cm[3]}` : "availability", s, `stated for ${datesIn(s.text, s.item.at).map((d) => fmtDay(d.day)).join(", ")}, not ${target !== null ? fmtDay(target) : "this day"}`)); continue; }
    if (ownMatterOfSender(s)) { setAside.push(row(name, "statement", s, "the sender is writing about their own matter")); continue; }
    const r = roomOf(name);
    if (cm) { const n = Number(cm[1] ?? cm[2] ?? cm[3]); if (r.cap) r.capHistory.push(r.cap); r.cap = { n, s }; }
    const t = s.text;
    let m: RegExpExecArray | null;
    if (/\b(?:booked|taken|reserved|unavailable|closed)\b[^.]*?\ball day\b/i.test(t)) r.avail = { kind: "blocked_all", s };
    else if ((m = new RegExp(`\\b(?:booked|taken|reserved|unavailable|in use)\\s+until\\s+(${CLOCK})`, "i").exec(t))) r.avail = { kind: "blocked_until", to: clocksIn(m[1])[0], s };
    else if ((m = new RegExp(`\\b(?:booked|taken|reserved|in use)\\s+(?:from\\s+)?(${CLOCK})\\s*(?:to|-|until)\\s*(${CLOCK})`, "i").exec(t))) { const cl = clocksIn(m[0]); r.avail = { kind: "blocked_between", from: cl[0], to: cl[1], s }; }
    else if (/\b(?:free|available|open)\s+(?:all day|the whole day|throughout)/i.test(t)) r.avail = { kind: "free_all", s };
    else if ((m = new RegExp(`\\b(?:free|available)\\s+(?:from|after)\\s+(${CLOCK})`, "i").exec(t))) r.avail = { kind: "free_from", from: clocksIn(m[1])[0], s };
  }
  for (const r of rooms.values()) {
    if (r.cap) inputs.push(row(`${r.name}: capacity`, `${r.cap.n}`, r.cap.s, r.capHistory.length ? "latest statement" : undefined));
    if (r.avail) inputs.push(row(`${r.name}: availability`, r.avail.kind === "blocked_all" ? "booked all day" : r.avail.kind === "free_all" ? "free all day" : r.avail.kind === "blocked_until" ? `booked until ${hhmm(r.avail.to!)}` : r.avail.kind === "free_from" ? `free from ${hhmm(r.avail.from!)}` : `booked ${hhmm(r.avail.from!)} to ${hhmm(r.avail.to!)}`, r.avail.s));
    for (const h of r.capHistory) setAside.push(row(`${r.name}: earlier capacity`, String(h.n), h.s, `replaced by ${r.cap!.n}`));
  }
  const room = [...rooms.values()].filter((r) => r.cap || r.avail);
  // Statements about the same kind of limit from another day are shown so the reader can see why they were not used.

  // What is missing, named.
  const missing: string[] = [];
  if (!headcount) missing.push("how many people need a seat"); if (len === null) missing.push("how long a session lasts"); if (!winS) missing.push("when the trainer or host is available"); if (!room.length) missing.push("any room, with its capacity and availability");
  const basis = [headcount ? `${headcount.n} people` : null, len !== null ? `${len}-minute sessions` : null, brk ? `${brk}-minute breaks` : null].filter(Boolean) as string[];
  if (missing.length) {
    const q = `What is missing: ${missing.join("; ")}. Tell me or add the note that states it and I will work it out.`;
    return { type: "plan", kind: "capacity", recommendation: { kind: "insufficient", option: null, label: null, headline: `I cannot place this yet: ${missing[0]} ${missing.length > 1 ? `(and ${missing.length - 1} more input${missing.length > 2 ? "s" : ""}) ` : ""}is not in the sources.`, tradeoff: [], question: q, nextAction: { kind: "ask_missing", text: q }, basis, qualifiers: [] }, inputs, computation: comp, options: [], setAside, notes, contact: null, data: {} };
  }

  const need = (cap: number) => Math.ceil(headcount!.n / cap);
  const options: PlanOpt[] = []; const placed: { r: RoomState; sessions: { s: number; e: number; n: number }[]; needed: number; ok: boolean }[] = [];
  const winStart = winS!.a, winEnd = winS!.b;
  for (const r of room.sort((x, y) => x.name.localeCompare(y.name))) {
    const checks: string[] = []; const steps: PlanStep[] = [];
    if (!r.cap) { options.push({ option: r.name, label: r.name, verdict: "depends", summary: `${r.name}: capacity is not stated.`, steps, checks: ["Capacity not stated, so seating cannot be checked."] }); continue; }
    let free: [number, number][];
    const a = r.avail;
    if (!a) { free = [[winStart, winEnd]]; checks.push("Availability on that day is not stated, so it is assumed free: unconfirmed."); }
    else if (a.kind === "blocked_all") free = [];
    else if (a.kind === "free_all") free = [[0, 1440]];
    else if (a.kind === "blocked_until") free = [[a.to!, 1440]];
    else if (a.kind === "free_from") free = [[a.from!, 1440]];
    else free = [[0, a.from!], [a.to!, 1440]];
    const windows = free.map(([x, y]) => [Math.max(x, winStart), Math.min(y, winEnd)] as [number, number]).filter(([x, y]) => y > x);
    const slots: { s: number; e: number; n: number }[] = []; let lastEnd: number | null = null;
    for (const [x, y] of windows) { let t: number = lastEnd === null ? x : Math.max(x, (lastEnd as number) + brk); while (t + len! <= y) { slots.push({ s: t, e: t + len!, n: 0 }); lastEnd = t + len!; t = t + len! + brk; } }
    const needed = need(r.cap.n); const ok = slots.length >= needed && windows.length > 0;
    const per = Math.ceil(headcount!.n / needed);
    comp.push(`${r.name}: ${headcount!.n} people ÷ ${r.cap.n} seats = ${(headcount!.n / r.cap.n).toFixed(2)}, so ${plural(needed, "session")} needed.`);
    if (a?.kind === "blocked_all") { checks.push("Booked all day, so no session fits."); comp.push(`${r.name}: booked all day, 0 sessions fit.`); }
    else { const winTxt = windows.map(([x, y]) => `${hhmm(x)} to ${hhmm(y)}`).join(" and ") || "none"; comp.push(`${r.name}: free time inside ${hhmm(winStart)} to ${hhmm(winEnd)} is ${winTxt}; ${len}-minute sessions${brk ? ` with ${brk}-minute breaks` : ""} give ${plural(slots.length, "session")}.`); }
    if (slots.length < needed && a?.kind !== "blocked_all") checks.push(`Only ${slots.length} of the ${needed} sessions needed fit.`);
    const use = slots.slice(0, needed); const sizes = use.map((_, i) => Math.min(per, headcount!.n - per * i));
    use.forEach((u, i) => { u.n = sizes[i]; steps.push({ when: `${target !== null ? `${fmtDay(target)} ` : ""}${hhmm(u.s)} to ${hhmm(u.e)}`, what: `${sizes[i]} people in ${r.name}` }); });
    if (ok && needed === 1) checks.push(`Everyone fits in one session (${headcount!.n} of ${r.cap.n} seats).`);
    if (ok && needed > 1) checks.push(`Needs ${needed} sessions of about ${per} people.`);
    placed.push({ r, sessions: use, needed, ok });
    options.push({ option: r.name, label: r.name, verdict: ok ? (a ? "works" : "depends") : "fails", summary: ok ? `${r.name}: ${needed === 1 ? "one session" : `${needed} sessions`}, ${use.map((u) => `${hhmm(u.s)}–${hhmm(u.e)}`).join(" and ")}.` : `${r.name}: does not work. ${checks[0] ?? ""}`.trim(), steps, checks });
  }
  const works = placed.filter((p) => p.ok).sort((a, b) => a.needed - b.needed || a.sessions[a.sessions.length - 1].e - b.sessions[b.sessions.length - 1].e || a.sessions[0].s - b.sessions[0].s);
  const dayTxt = target !== null ? fmtDay(target) : "that day";
  const contactOf = (r: RoomState) => ({ name: r.avail?.s.item.author ?? r.cap?.s.item.author ?? null, why: `${r.name}` });
  const rec = (kind: PlanRec["kind"], p: Partial<PlanRec>): PlanRec => ({ kind, option: null, label: null, headline: "", tradeoff: [], question: null, nextAction: null, basis, qualifiers: [], ...p });
  const qual: string[] = []; if (target === null) qual.push("No date was found for this, so availability is read as stated without a date.");
  if (!works.length) {
    const near = [...placed].sort((a, b) => a.needed - b.needed)[0];
    const q = `No room has enough seats and free time for ${headcount!.n} people. ${near ? `${near.r.name} comes closest (${near.needed} sessions needed).` : ""}`.trim();
    return { type: "plan", kind: "capacity", recommendation: rec("none_fits", { headline: q, tradeoff: options.map((o) => o.summary), nextAction: { kind: "none", text: "Decide whether to split the group over another day or find another room." }, qualifiers: qual }), inputs, computation: comp, options, setAside, notes, contact: null, data: { headcount: headcount!.n } };
  }
  const top = works[0]; const second = works[1];
  const tie = second && second.needed === top.needed && second.sessions[0].s === top.sessions[0].s;
  const sessTxt = top.sessions.map((u) => `${hhmm(u.s)} to ${hhmm(u.e)}`).join(" and ");
  const topOpt = options.find((o) => o.option === top.r.name)!;
  const why: string[] = [`${top.r.name} holds ${top.r.cap!.n}, so ${top.needed === 1 ? `all ${headcount!.n} registered people fit in one session` : `${plural(top.needed, "sessions")} are needed (about ${Math.ceil(headcount!.n / top.needed)} each)`}${top.r.avail?.kind === "blocked_until" ? `, and it is free from ${hhmm(top.r.avail.to!)} on ${dayTxt}` : ""}.`];
  for (const p of works.slice(1)) why.push(`${p.r.name} also works, with ${plural(p.needed, "session")} (${p.sessions.map((u) => `${hhmm(u.s)}–${hhmm(u.e)}`).join(", ")}).`);
  for (const o of options.filter((x) => x.verdict === "fails")) why.push(`${o.label} does not work: ${o.checks.join(" ")}`);
  const headline = `Use ${top.r.name} on ${dayTxt}, ${sessTxt}${top.needed === 1 ? ": one session seats all " + headcount!.n : `: ${plural(top.needed, "session")}`}.`;
  const next = { kind: "book_room", option: top.r.name, text: `Book ${top.r.name} for ${dayTxt}, ${sessTxt}${contactOf(top.r).name ? ` (${contactOf(top.r).name} manages the room availability)` : ""}.` };
  if (tie) {
    const q = `${top.r.name} and ${second.r.name} both work at the same time. Which do you prefer?`;
    return { type: "plan", kind: "capacity", recommendation: rec("ask", { option: top.r.name, label: top.r.name, headline: `${top.r.name} and ${second.r.name} both fit everyone at ${hhmm(top.sessions[0].s)} on ${dayTxt}.`, tradeoff: why, question: q, nextAction: { kind: "ask_missing", text: q }, qualifiers: qual }), inputs, computation: comp, options, setAside, notes, contact: contactOf(top.r), data: { headcount: headcount!.n } };
  }
  if (topOpt.verdict === "depends") qual.push(`${top.r.name}: availability on that day is not stated, so confirm it before booking.`);
  return { type: "plan", kind: "capacity", recommendation: rec("recommend", { option: top.r.name, label: top.r.name, headline, tradeoff: why, nextAction: next, qualifiers: qual }), inputs, computation: comp, options, setAside, notes, contact: contactOf(top.r), data: { headcount: headcount!.n, room: top.r.name, sessions: top.sessions } };
}

// =====================================================================================================
//  BATCH: how many runs, when each starts and ends, done before a deadline
// =====================================================================================================
const CAPN = /(?:holds|takes|fits|handles)\s+(?:up\s+to\s+|max(?:imum)?\s+|about\s+)?(\d{1,6})\s+([a-z]+)(?:\s+per\s+(?:[a-z]+\s+)?(?:firing|run|load|batch|cycle|trip|round))?/i;
const DET = new Set(["the", "a", "an", "our", "my", "for", "that", "this", "and", "which", "so", "then", "it", "its", "their", "your"]);
const subjectBefore = (text: string, idx: number) => { const ws = (text.slice(0, idx).match(/[A-Za-z][A-Za-z-]*/g) ?? []); const out: string[] = []; for (let i = ws.length - 1; i >= 0 && out.length < 2; i--) { if (DET.has(ws[i].toLowerCase())) break; out.unshift(ws[i].toLowerCase()); } return out.join(" "); };
const scopePrefix = (text: string) => { const m = /^\s*(?:For|During|At|In the case of)\s+(.+?)(?=\s+the\s+(?:[a-z-]+\s+){0,2}(?:holds|takes|fits|handles)\b|,)/i.exec(text); return m ? m[1] : null; };

interface Cap { subject: string; n: number; unit: string; s: Sent }

function planBatch(items: ItemIn[], request: string): PlanAnalysis | null {
  const topic = topicOf(request); if (!topic.length) return null;
  const all = sentencesOf(items); const inputs: PlanRow[] = []; const setAside: PlanRow[] = []; const notes: string[] = []; const comp: string[] = [];
  const topicScore = (s: Sent) => overlap(topic, `${s.item.title}. ${s.text}`);

  // Capacity of the resource: unscoped statements only. Scoped ones and the sender's own matters are shown, not used.
  const caps: Cap[] = [];
  for (const s of all) {
    const m = CAPN.exec(s.text); if (!m) continue; const subject = subjectBefore(s.text, m.index); if (!subject) continue; const unit = m[2].toLowerCase();
    if (/^(?:minutes?|mins?|hours?|hrs?|days?|seconds?|weeks?)$/.test(unit)) continue;   // "takes 40 minutes" is a duration, not a capacity per run
    const scope = scopePrefix(s.text);
    if (ownMatterOfSender(s)) { setAside.push(row(`${subject}: ${m[1]} ${unit} per run`, "set aside", s, "the sender is writing about their own batch, not yours")); continue; }
    if (scope && overlap(topic, scope) === 0) { setAside.push(row(`${subject}: ${m[1]} ${unit} per run`, "set aside", s, `stated for ${scope.trim()}, which is not what you asked about`)); continue; }
    caps.push({ subject, n: Number(m[1]), unit, s });
  }
  if (!caps.length) {
    const q = "How many pieces fit in one run, and how long does a run take? I found no capacity per run in the sources.";
    return { type: "plan", kind: "batch", recommendation: { kind: "insufficient", option: null, label: null, headline: "I cannot work out the runs: no capacity per run was found in the sources.", tradeoff: [], question: q, nextAction: { kind: "ask_missing", text: q }, basis: [], qualifiers: [] }, inputs, computation: comp, options: [], setAside, notes, contact: null, data: {} };
  }
  // The latest statement per resource.
  const resources = new Map<string, Cap[]>(); for (const c of caps) resources.set(c.subject, [...(resources.get(c.subject) ?? []), c]);
  const unit = caps[0].unit; const unitStem = stem(unit);

  // Quantity to process: your request first, then the latest note. Capacities per run are never read as quantities.
  let qty: { n: number; s: Sent | null } | null = null; const qtyHist: { n: number; s: Sent }[] = [];
  const mq = new RegExp(`\\b(\\d{1,6})\\s+(?:[a-z]+\\s+){0,2}${unitStem}(?:s|es)?\\b(?!\\s+per\\b)`, "i").exec(request);
  const withUnit = [...topic, unitStem]; const cands = all.filter((s) => overlap(withUnit, `${s.item.title}. ${s.text}`) + overlap(withUnit, s.item.title) >= 2 && !ownMatterOfSender(s) && !CAPN.test(s.text)).map((s) => { const m = new RegExp(`\\b(\\d{1,6})\\s+${unitStem}(?:s|es)?\\b(?!\\s+per\\b)`, "i").exec(s.text); return m ? { n: Number(m[1]), s } : null; }).filter(Boolean).sort((a, b) => byRecency(a!.s, b!.s)) as { n: number; s: Sent }[];
  if (cands.length) { qty = { n: cands[0].n, s: cands[0].s }; for (const c of cands.slice(1)) if (c.n !== cands[0].n) qtyHist.push(c); }
  if (mq) { const n = Number(mq[1]); if (qty && qty.n !== n) notes.push(`Your request says ${n}, but the latest note says ${qty.n} (${qty.s!.item.title}). I used the number in your request.`); qty = { n, s: null }; }
  if (qty) { inputs.push(row(`${unitStem === "piec" ? "Pieces" : unit[0].toUpperCase() + unit.slice(1)} to process`, String(qty.n), qty.s, mq ? "from your request" : "latest statement")); for (const h of qtyHist) setAside.push(row("Earlier count", String(h.n), h.s, `replaced by ${qty.n}`)); }

  // Deadline: the latest statement about the date the work must be done by.
  const dlC = all.filter((s) => /\b(load-?in|deadline|due|cut-?off|opening|set-?up|must be [^.]*?(?:by|before)|needed by)\b/i.test(s.text) && datesIn(s.text, s.item.at).length && (overlap(topic, s.item.title) + topicScore(s) >= 1) && !ownMatterOfSender(s)).sort(byRecency);
  for (const s of all.filter((x) => ownMatterOfSender(x) && /\b(load-?in|deadline|due|opening)\b/i.test(x.text) && datesIn(x.text, x.item.at).length)) setAside.push(row("Deadline of someone else", "set aside", s, "the sender is writing about their own event"));
  const dlS = dlC[0] ?? null; let deadline: number | null = null; let deadlineNoTime = false;
  if (dlS) { const ds = datesIn(dlS.text, dlS.item.at); const d = ds[ds.length - 1]; deadline = d.e; deadlineNoTime = !d.hasTime; inputs.push(row("Must be finished before", fmtAt(d.e) + (d.hasTime ? "" : " (no time stated, start of that day)"), dlS, "latest statement")); for (const o of dlC.slice(1)) { const od = datesIn(o.text, o.item.at); if (od.length && od[od.length - 1].e !== d.e && /load-?in|deadline|due|opening|set-?up/i.test(o.text)) setAside.push(row("Earlier deadline", fmtAt(od[od.length - 1].e), o, `replaced by ${fmtAt(d.e)} (${dlS.item.title})`)); } const conf = dlS.item.sentences.find((x) => /\bplease confirm\b|\bconfirm (?:you|that|by)\b/i.test(x.text)); if (conf) notes.push(`${dlS.item.author ?? "The sender"} asks you to confirm: “${conf.text.trim().slice(0, 140)}” (${dlS.item.title}). Nothing was sent.`); }

  type Plan = { resource: string; cap: Cap; cycle: number | null; phases: string; cycleS: Sent | null; loadW: [number, number] | null; unloadW: [number, number] | null; winS: Sent | null; slots: { e: number; label: string }[]; slotS: Sent | null };
  const plans: Plan[] = [];
  for (const [name, list] of resources) {
    const cap = [...list].sort((a, b) => byRecency(a.s, b.s))[0]; const siblings = all.filter((s) => s.item === cap.s.item && !ownMatterOfSender(s));
    let cycle: number | null = null; let phases = ""; let cycleS: Sent | null = null;
    for (const s of siblings) {
      const ph = /(\d+)\s*(hour|hr|minute|min)s?\s+of\s+([a-z]+)\D{0,30}?(\d+)\s*(hour|hr|minute|min)s?\s+of\s+([a-z]+)/i.exec(s.text); const full = /(?:full|total|entire|whole)\s+(\d+)\s*(hour|hr|minute|min)s?/i.exec(s.text);
      const mul = (u: string) => (/^h/i.test(u) ? 60 : 1);
      if (ph) { const sum = Number(ph[1]) * mul(ph[2]) + Number(ph[4]) * mul(ph[5]); cycle = sum; phases = `${ph[1]} ${ph[2]}s of ${ph[3]} + ${ph[4]} ${ph[5]}s of ${ph[6]}`; cycleS = s; if (full) { const f = Number(full[1]) * mul(full[2]); if (f !== sum) notes.push(`${name}: the phases add up to ${fmtSpan(sum)} but the same source says the full wait is ${fmtSpan(f)}. I used ${fmtSpan(Math.max(f, sum))}.`); cycle = Math.max(f, sum); } }
      else if (full && cycle === null) { cycle = Number(full[1]) * mul(full[2]); cycleS = s; phases = `${full[1]} ${full[2]}s`; }
    }
    let loadW: [number, number] | null = null, unloadW: [number, number] | null = null, winS: Sent | null = null;
    for (const s of siblings) {
      const lm = new RegExp(`\\b(?:loading|starting|load|start)\\b[^,.]*?between\\s+(${CLOCK})\\s+and\\s+(${CLOCK})`, "i").exec(s.text); const um = new RegExp(`\\bunload\\w*\\b[^,.]*?between\\s+(${CLOCK})\\s+and\\s+(${CLOCK})`, "i").exec(s.text);
      if (lm) { const cl = clocksIn(lm[0]); if (cl.length >= 2) { loadW = [cl[0], cl[1]]; winS = s; } }
      if (um) { const cl = clocksIn(um[0]); if (cl.length >= 2) { unloadW = [cl[0], cl[1]]; winS = winS ?? s; } }
    }
    // Start slots: from the source that says when the resource is free. More than one time means the slot is not settled yet.
    const slots: { e: number; label: string }[] = []; let slotS: Sent | null = null;
    for (const s of [...all].filter((x) => x.item === cap.s.item || x.item.sentences.some((y) => y.text === cap.s.text)).sort(byRecency)) {
      if (!/\b(free|available|open)\b/i.test(s.text) || /^\s*For\b/.test(s.text)) continue; const ds = datesIn(s.text, s.item.at); if (!ds.length) continue;
      const day = ds[0].day; const after = s.text.slice(ds[0].index); const times = [...new Set(clocksIn(after))];
      if (times.length) { for (const t of times) slots.push({ e: day + t, label: fmtAt(day + t) }); } else slots.push({ e: day + (loadW ? loadW[0] : 0), label: `${fmtDay(day)}${loadW ? ` ${hhmm(loadW[0])}` : ""}` });
      slotS = s; break;
    }
    plans.push({ resource: name, cap, cycle, phases, cycleS, loadW, unloadW, winS, slots, slotS });
  }
  const basis = [qty ? `${qty.n} ${unit}` : null, deadline !== null ? `finished before ${fmtAt(deadline)}` : null].filter(Boolean) as string[];
  const mk = (kind: PlanRec["kind"], p: Partial<PlanRec>): PlanRec => ({ kind, option: null, label: null, headline: "", tradeoff: [], question: null, nextAction: null, basis, qualifiers: [], ...p });
  if (!qty) { const q = `How many ${unit} need to be processed? I found no count in the sources or your request.`; return { type: "plan", kind: "batch", recommendation: mk("insufficient", { headline: `I cannot count the runs: the number of ${unit} is not stated.`, question: q, nextAction: { kind: "ask_missing", text: q } }), inputs, computation: comp, options: [], setAside, notes, contact: null, data: {} }; }

  const nextAllowed = (t: number, w: [number, number] | null) => { if (!w) return t; const tod = ((t % 1440) + 1440) % 1440; if (tod < w[0]) return t - tod + w[0]; if (tod <= w[1]) return t; return t - tod + 1440 + w[0]; };
  const opts: PlanOpt[] = []; type Sim = { start: number; end: number; unload: number; size: number }[];
  const sims: { p: Plan; slot: { e: number; label: string }; sim: Sim; ok: boolean | null; slack: number | null }[] = [];
  for (const p of plans) {
    const missing: string[] = []; if (p.cycle === null) missing.push(`how long one run takes in the ${p.resource}`); if (!p.slots.length) missing.push(`when the ${p.resource} is free to start`);
    const n = Math.ceil(qty.n / p.cap.n); const sizes = Array.from({ length: n }, (_, i) => (i < n - 1 ? p.cap.n : qty!.n - p.cap.n * (n - 1)));
    inputs.push(row(`${p.resource}: ${unit} per run`, String(p.cap.n), p.cap.s));
    if (p.cycle !== null) inputs.push(row(`${p.resource}: one run takes`, `${fmtSpan(p.cycle)} (${p.phases})`, p.cycleS));
    if (p.loadW) inputs.push(row(`${p.resource}: loading and starting allowed`, `${hhmm(p.loadW[0])} to ${hhmm(p.loadW[1])}`, p.winS));
    if (p.unloadW) inputs.push(row(`${p.resource}: unloading allowed`, `${hhmm(p.unloadW[0])} to ${hhmm(p.unloadW[1])}`, p.winS));
    if (p.slots.length) inputs.push(row(`${p.resource}: free to start`, p.slots.map((x) => x.label).join(" or "), p.slotS, p.slots.length > 1 ? "which slot applies is not settled in the sources" : undefined));
    comp.push(`${p.resource}: ${qty.n} ÷ ${p.cap.n} per run = ${(qty.n / p.cap.n).toFixed(2)}, rounded up to ${plural(n, "run")} (${sizes.join(" + ")}).`);
    if (missing.length) { opts.push({ option: p.resource, label: p.resource, verdict: "depends", summary: `${p.resource}: ${plural(n, "run")} needed, but ${missing.join(" and ")} was not found in the sources, or not in wording Jarvis can read.`, steps: [], checks: [`Missing: ${missing.join("; ")}.`] }); continue; }
    for (const slot of p.slots) {
      const sim: Sim = []; let start = nextAllowed(slot.e, p.loadW);
      for (let i = 0; i < n; i++) { const end = start + p.cycle!; const unload = nextAllowed(end, p.unloadW); sim.push({ start, end, unload, size: sizes[i] }); start = nextAllowed(unload, p.loadW); }
      const last = sim[sim.length - 1]; const ok = deadline === null ? null : last.unload <= deadline; const slack = deadline === null ? null : deadline - last.unload;
      sims.push({ p, slot, sim, ok, slack });
      const steps = sim.flatMap((r, i) => [{ when: fmtAt(r.start), what: `Start run ${i + 1} of ${n} (${r.size} ${unit})` }, { when: fmtAt(r.unload), what: `Unload run ${i + 1}${r.unload > r.end ? ` (ready at ${fmtAt(r.end)}, held until the unloading window opens)` : ""}` }]);
      comp.push(`${p.resource}, start ${slot.label}: each run is ${fmtSpan(p.cycle!)}; run ${n} unloads ${fmtAt(last.unload)}${deadline !== null ? `; deadline ${fmtAt(deadline)} is ${slack! >= 0 ? `${fmtSpan(slack!)} after that` : `${fmtSpan(slack!)} before that`}` : ""}.`);
      opts.push({ option: `${p.resource} @ ${slot.label}`, label: `${p.resource}, starting ${slot.label}`, verdict: ok === false ? "fails" : "works", summary: `${p.resource}, starting ${slot.label}: ${plural(n, "run")}, last unload ${fmtAt(last.unload)}${deadline !== null ? (ok ? `, ${fmtSpan(slack!)} before the deadline` : `, ${fmtSpan(slack!)} after the deadline`) : ""}.`, steps, checks: deadline === null ? ["No deadline found, so none was checked."] : [ok ? `Finishes ${fmtSpan(slack!)} before ${fmtAt(deadline)}.` : `Finishes ${fmtSpan(-slack!)} after ${fmtAt(deadline)}.`] });
    }
  }
  // Sources that disagree on capacity, for the same thing, where the other reading would change the run count.
  for (const a of setAside) { const m = /: (\d+) ([a-z]+) per run/.exec(a.label); if (m && m[2] === unit && Number(m[1]) !== caps[0].n) { const alt = Math.ceil(qty.n / Number(m[1])); const base = Math.ceil(qty.n / caps[0].n); if (alt !== base) notes.push(`A different capacity (${m[1]} ${unit}) appears in “${a.srcTitle}”, but it is stated for someone else's batch. If it applied to yours, it would be ${plural(alt, "run")} instead of ${base}.`); } }

  if (!sims.length) { const q = `${opts.map((o) => o.checks[0]).join(" ")} Tell me or add the note that states it.`; return { type: "plan", kind: "batch", recommendation: mk("insufficient", { headline: opts[0]?.summary ?? "A needed input is missing.", question: q, nextAction: { kind: "ask_missing", text: q } }), inputs, computation: comp, options: opts, setAside, notes, contact: null, data: {} }; }
  const byRes = new Map<string, typeof sims>(); for (const s of sims) byRes.set(s.p.resource, [...(byRes.get(s.p.resource) ?? []), s]);
  // The best resource: every slot works > some > none, then earliest finish.
  const score = (arr: typeof sims) => ({ all: arr.every((x) => x.ok !== false), any: arr.some((x) => x.ok !== false), end: Math.min(...arr.map((x) => x.sim[x.sim.length - 1].unload)) });
  const ranked = [...byRes].sort((a, b) => { const x = score(a[1]), y = score(b[1]); return Number(y.all) - Number(x.all) || Number(y.any) - Number(x.any) || x.end - y.end; });
  const [name, arr] = ranked[0]; const sc = score(arr); const first = arr[0];
  const n0 = first.sim.length; const sizesTxt = first.sim.map((r) => r.size).join(" + ");
  const good = arr.filter((x) => x.ok !== false), bad = arr.filter((x) => x.ok === false);
  const contact = first.p.slotS?.item.author ?? first.p.cap.s.item.author ?? null; const promise = first.p.slotS ? /\b(confirm|decide)\b[^.]*\b(slot|time|which)\b/i.test(first.p.slotS.text) || /\bdepending\b/i.test(first.p.slotS.text) : false;
  const lastTxt = (x: (typeof sims)[number]) => fmtAt(x.sim[x.sim.length - 1].unload);
  const tradeoff = [`${qty.n} ${unit} at ${first.p.cap.n} per run is ${plural(n0, "run")} (${sizesTxt}); each run takes ${fmtSpan(first.p.cycle!)}.`];
  for (const x of arr) tradeoff.push(`Starting ${x.slot.label}: ${x.sim.map((r, i) => `run ${i + 1} starts ${fmtAt(r.start)}, unloads ${fmtAt(r.unload)}`).join("; ")}${deadline !== null ? ` — ${x.ok ? `finished ${fmtSpan(x.slack!)} before` : `${fmtSpan(-x.slack!)} too late for`} ${fmtAt(deadline)}` : ""}.`);
  const sch = (x: (typeof sims)[number]) => x.sim.map((r, i) => `${i + 1}. start ${fmtAt(r.start)} (${r.size} ${unit}), unload ${fmtAt(r.unload)}`);
  if (deadline === null) return { type: "plan", kind: "batch", recommendation: mk("recommend", { option: first.p.resource, label: name, headline: `${plural(n0, "run")} in the ${name}: ${sch(first).join("; ")}. No deadline was found, so none was checked.`, tradeoff, nextAction: { kind: "book_slot", option: first.p.resource, text: `Ask ${contact ?? "the resource owner"} to book ${plural(n0, "run")} starting ${first.slot.label}.` }, qualifiers: ["No deadline was found in the sources or your request."] }), inputs, computation: comp, options: opts, setAside, notes, contact: { name: contact, why: name }, data: { runs: n0 } };
  if (!sc.any) return { type: "plan", kind: "batch", recommendation: mk("none_fits", { option: first.p.resource, label: name, headline: `No: ${plural(n0, "run")} in the ${name} cannot finish before ${fmtAt(deadline)}. The earliest the last run can be unloaded is ${lastTxt(arr.sort((a, b) => a.sim[a.sim.length - 1].unload - b.sim[b.sim.length - 1].unload)[0])}, ${fmtSpan(-arr[0].slack!)} too late.`, tradeoff, nextAction: { kind: "none", text: "Decide whether to cut the number of pieces, find a second kiln or machine, or ask for a later deadline." }, qualifiers: [] }), inputs, computation: comp, options: opts, setAside, notes, contact: null, data: { runs: n0 } };
  if (!sc.all) {
    const g = good[0], b = bad[0];
    const q = `Which start slot will the ${name} actually be free for: ${arr.map((x) => x.slot.label).join(" or ")}? Only ${g.slot.label} finishes before ${fmtAt(deadline)}; ${b.slot.label} finishes ${fmtSpan(-b.slack!)} too late.`;
    return { type: "plan", kind: "batch", recommendation: mk("ask", { option: first.p.resource, label: name, headline: `Yes if you can start at ${g.slot.label}: ${plural(n0, "run")} (${sizesTxt}) in the ${name}, last unload ${lastTxt(g)}, ${fmtSpan(g.slack!)} before ${fmtAt(deadline)}. Starting ${b.slot.label} instead would finish ${fmtSpan(-b.slack!)} too late.`, tradeoff, question: q, nextAction: { kind: "confirm_slot", option: first.p.resource, text: `Ask ${contact ?? "the resource owner"} to confirm the ${g.slot.label} slot${promise ? " (they said they would confirm which slot applies)" : ""} and book ${plural(n0, "run")}.` }, qualifiers: [`The slot is not settled in the sources: ${first.p.slotS ? `“${quoteOf(first.p.slotS).slice(0, 160)}”` : ""}`] }), inputs, computation: comp, options: opts, setAside, notes, contact: { name: contact, why: name }, data: { runs: n0, goodSlot: g.slot.label, badSlot: b.slot.label } };
  }
  const f0 = arr[0]; const qualifiers: string[] = []; if (deadlineNoTime) qualifiers.push("The deadline has no time of day, so I treated it as the start of that day.");
  return { type: "plan", kind: "batch", recommendation: mk("recommend", { option: first.p.resource, label: name, headline: `Yes: ${plural(n0, "run")} (${sizesTxt}) in the ${name}. ${sch(f0).join("; ")}. The last unload is ${lastTxt(f0)}, ${fmtSpan(f0.slack!)} before ${fmtAt(deadline)}.`, tradeoff, nextAction: { kind: "book_slot", option: first.p.resource, text: `Ask ${contact ?? "the resource owner"} to book ${plural(n0, "run")} starting ${f0.slot.label}.` }, qualifiers }), inputs, computation: comp, options: opts, setAside, notes, contact: { name: contact, why: name }, data: { runs: n0 } };
}

// =====================================================================================================
//  TRIPS: moving a count of people or things with vehicles that go out, come back and go out again
// =====================================================================================================
const NUMW: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const NUM = "(\\d{1,5}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)";
const numOf = (t: string) => (/^\d+$/.test(t) ? Number(t) : NUMW[t.toLowerCase()] ?? null);
const PERSON = "(?:people|persons|passengers|volunteers|guests|attendees|students|members|staff|workers|riders|visitors|participants|kids|children|players|employees|delegates|residents|campers|boxes|crates|pallets|parcels)";
const VEHICLE = "(?:van|vans|bus|buses|minibus|minibuses|car|cars|shuttle|shuttles|coach|coaches|truck|trucks|boat|boats|ferry|ferries|minivan|minivans)";
const durMin = (n: string, u: string) => Number(n) * (/^h/i.test(u) ? 60 : 1);
const TRIP_WORDS = new RegExp(`\\b${VEHICLE}\\b|\\bseats?\\b|\\bdrive|\\bshuttle|\\bdeparture`, "i");
export const looksLikeTrips = (request: string) => new RegExp(`\\b${VEHICLE}\\b|\\b(?:drive|ride|shuttle|trips?|carpool|depart\\w*)\\b`, "i").test(request);

function planTrips(items: ItemIn[], request: string): PlanAnalysis | null {
  const topic = topicOf(request); const all = sentencesOf(items).filter((s) => !ownMatterOfSender(s));
  const relevantItems = new Set(items.filter((it) => overlap(topic, `${it.title}. ${it.sentences.map((x) => x.text).join(" ")}`) >= 1 || it.sentences.some((x) => TRIP_WORDS.test(x.text))).filter((it) => it.sentences.some((x) => TRIP_WORDS.test(x.text) || new RegExp(`${NUM}\\s+${PERSON}\\b`, "i").test(x.text))));
  const S = all.filter((s) => relevantItems.has(s.item)); if (!S.length) return null;
  const inputs: PlanRow[] = []; const setAside: PlanRow[] = []; const notes: string[] = []; const comp: string[] = [];
  const latest = <T extends { s: Sent }>(xs: T[]) => [...xs].sort((a, b) => byRecency(a.s, b.s));
  const gather = <T,>(f: (s: Sent) => T | null): (T & { s: Sent })[] => S.map((s) => { const v = f(s); return v === null ? null : { ...(v as object), s }; }).filter(Boolean) as (T & { s: Sent })[];

  // Seats per vehicle and how many vehicles: "One van has eight passenger seats", "the bus seats 40".
  const seatsC = latest(gather((s) => { const m = new RegExp(`\\b(?:(${NUM}|a|an|the)\\s+)?${VEHICLE}\\s+(?:has|have|holds|seats|carries|fits|takes)\\s+(?:up to\\s+|max(?:imum)?\\s+|at most\\s+)?${NUM}\\b`, "i").exec(s.text); return m ? { seats: numOf(m[m.length - 1])!, count: m[1] ? numOf(m[1]) : null } : null; }));
  const seatsF = seatsC[0] ?? null;
  const vm = new RegExp(`\\b${NUM}\\s+${VEHICLE}\\b`, "i").exec(request);
  let vehicles = vm ? numOf(vm[1])! : seatsF?.count ?? null; let vehiclesSrc: Sent | null = seatsF && !vm && seatsF.count ? seatsF.s : null;
  if (vehicles === null) { vehicles = 1; notes.push("No number of vehicles was stated, so one vehicle is assumed."); }
  // People or things to move.
  const peopleC = latest(gather((s) => { if (new RegExp(`${NUM}\\s+(?:passenger\\s+)?seats?\\b`, "i").test(s.text) && !/\bmust|need|arrive|get\b/i.test(s.text)) return null; const m = new RegExp(`\\b${NUM}\\s+${PERSON}\\b(?!\\s+seats?)`, "i").exec(s.text); return m && /\b(arrive|must|need|get|take|bring|move|going|riding|coming|attend)\b/i.test(s.text) ? { n: numOf(m[1])!, unit: m[0].replace(/^\S+\s+/, "").toLowerCase() } : null; }));
  const people = peopleC[0] ?? null;
  // Travel times.
  const legs = latest(gather((s) => {
    const out = new RegExp(`${NUM}\\s*(minutes?|mins?|hours?|hrs?)\\s+to\\s+(?:drive|travel|ride|walk|go|get|fly|sail)\\s+(?:from\\s+[\\w ]+?\\s+)?to\\b`, "i").exec(s.text);
    const back = new RegExp(`${NUM}\\s*(minutes?|mins?|hours?|hrs?)\\s+(?:to\\s+)?(?:(?:drive|travel|ride|walk|go|get|come|fly|sail|return)\\s+)?back\\b|\\b(?:return|drive back|trip back)\\b[^.]{0,30}?(?:takes?|is)\\s+${NUM}\\s*(minutes?|mins?|hours?|hrs?)`, "i").exec(s.text);
    const each = new RegExp(`${NUM}\\s*(minutes?|mins?|hours?|hrs?)\\s+each way`, "i").exec(s.text);
    if (!out && !back && !each) return null;
    return { out: out ? durMin(String(numOf(out[1])), out[2]) : each ? durMin(String(numOf(each[1])), each[2]) : null, back: back ? (back[1] ? durMin(String(numOf(back[1])), back[2]) : durMin(String(numOf(back[3])), back[4])) : each ? durMin(String(numOf(each[1])), each[2]) : null };
  }));
  const outS = legs.find((l) => l.out !== null) ?? null, backS = legs.find((l) => l.back !== null) ?? null;
  // Boarding or loading time, if any.
  const loadS = latest(gather((s) => { if (/\bno\s+(?:loading|boarding|unloading)(?:\s+time)?\b/i.test(s.text)) return { load: 0 }; const m = new RegExp(`\\b(?:loading|boarding|unloading)\\b[^.]{0,30}?(?:takes?|is|of|needs?)\\s+${NUM}\\s*(minutes?|mins?)`, "i").exec(s.text); return m ? { load: Number(numOf(m[1])) } : null; }))[0] ?? null;
  // Departure: the latest statement wins; a sentence that says it replaces something is not a new value, and the replaced value is kept as history.
  const depAll = gather((s) => {
    const replacing = /\b(?:replaces?|replaced|instead of|rather than|no longer|supersedes?)\b/i.test(s.text); if (replacing) return null;
    const m = new RegExp(`(${CLOCK})\\s+(?:departure|departing|leave|pick-?up)|\\b(?:departure|depart(?:s|ing)?|leave[s]?|pick-?up|set(?:s)? off)\\b[^.]{0,50}?\\b(?:is|at|of|to|now|by)\\s+(?:now\\s+)?(${CLOCK})`, "i").exec(s.text);
    if (!m) return null; const cl = clocksIn(m[0]); return cl.length ? { min: cl[0] } : null;
  });
  const dep = latest(depAll)[0] ?? null;
  // Deadline: a time of day by which they must have arrived.
  const dlAll = gather((s) => { const m = new RegExp(`\\b(?:arrive(?:s|d)?|be there|get there|reach(?:ed)?)\\b[^.]{0,20}?\\b(by|before|no later than)\\s+(${CLOCK})|\\b(by|before|no later than)\\s+(${CLOCK})[^.]{0,20}?\\barriv`, "i").exec(s.text); if (!m) return null; const cl = clocksIn(m[0]); return cl.length ? { min: cl[cl.length - 1], strict: /before/i.test(m[1] ?? m[3] ?? "") } : null; });
  const dl = latest(dlAll)[0] ?? null;
  const day = [...S].sort(byRecency).flatMap((s) => datesIn(s.text, s.item.at).map((d) => d.day))[0] ?? null;

  if (seatsF) inputs.push(row("Seats per vehicle", String(seatsF.seats), seatsF.s));
  inputs.push(vehiclesSrc ? row("Vehicles", String(vehicles), vehiclesSrc) : row("Vehicles", String(vehicles), null, vm ? "from your request" : "assumed"));
  if (people) inputs.push(row("People to carry", `${people.n} (${people.unit.replace(/^\d+\s*/, "")})`, people.s, "latest statement"));
  if (outS) inputs.push(row("Drive out", `${outS.out} minutes`, outS.s));
  if (backS) inputs.push(row("Drive back", `${backS.back} minutes`, backS.s));
  if (loadS) inputs.push(row("Boarding or loading", `${loadS.load} minutes`, loadS.s)); else notes.push("No boarding or loading time was stated, so none is assumed.");
  if (dep) inputs.push(row("Earliest departure", hhmm(dep.min), dep.s, "latest statement"));
  if (dl) inputs.push(row(dl.strict ? "Must arrive before" : "Must arrive by", `${hhmm(dl.min)}${day !== null ? ` on ${fmtDay(day)}` : ""}`, dl.s));
  for (const d of latest(depAll).slice(1)) if (dep && d.min !== dep.min) setAside.push(row("Earlier departure", hhmm(d.min), d.s, `replaced by ${hhmm(dep.min)} (${dep.s.item.title})`));
  for (const p of peopleC.slice(1)) if (people && p.n !== people.n) setAside.push(row("Earlier count", String(p.n), p.s, `replaced by ${people.n}`));
  const basis = [people ? `${people.n} people` : null, seatsF ? `${seatsF.seats} seats per vehicle` : null, dl ? `${dl.strict ? "before" : "by"} ${hhmm(dl.min)}` : null].filter(Boolean) as string[];
  const rec = (kind: PlanRec["kind"], p: Partial<PlanRec>): PlanRec => ({ kind, option: null, label: null, headline: "", tradeoff: [], question: null, nextAction: null, basis, qualifiers: [], ...p });
  const base = { type: "plan" as const, kind: "trips" as const, inputs, setAside, notes, computation: comp };
  // Whatever cannot be known is named, with the part that can still be worked out.
  const missing: string[] = []; if (!seatsF) missing.push("how many seats a vehicle has"); if (!people) missing.push("how many people need to travel"); if (!outS) missing.push("how long the drive out takes");
  if (missing.length) { const q = `What is missing: ${missing.join("; ")}.`; return { ...base, recommendation: rec("insufficient", { headline: `I cannot work out the trips: ${missing[0]} is not in the sources.`, question: q, nextAction: { kind: "ask_missing", text: q } }), options: [], contact: null, data: {} }; }
  const seats = seatsF!.seats, n = Math.ceil(people!.n / seats), out = outS!.out!, load = loadS?.load ?? 0, k = Math.max(1, vehicles);
  const sizes = Array.from({ length: n }, (_, i) => (i < n - 1 ? seats : people!.n - seats * (n - 1)));
  comp.push(`${people!.n} people ÷ ${seats} seats = ${(people!.n / seats).toFixed(2)}, rounded up to ${plural(n, "trip")} (${sizes.join(" + ")}).`);
  const simulate = (depart: number, back: number, veh: number) => { const free = Array.from({ length: veh }, () => depart - load); const trips: { v: number; leave: number; arrive: number; back: number; size: number }[] = []; for (let i = 0; i < n; i++) { let j = 0; for (let x = 1; x < veh; x++) if (free[x] < free[j]) j = x; const leave = Math.max(free[j] + load, depart); const arrive = leave + out; const returned = arrive + back; free[j] = returned; trips.push({ v: j, leave, arrive, back: returned, size: sizes[i] }); } return trips; };
  const okAt = (arr: number) => (dl ? (dl.strict ? arr < dl.min : arr <= dl.min) : null);
  const needsReturn = n > k;
  if (needsReturn && !backS) {
    // The return time matters but is not stated: the answer is conditional, and the break-even is worked out.
    const q = `How long does the drive back take? The last group's arrival depends on it: ${plural(Math.ceil(n / k) - 1, "return")} come before it.`;
    let maxBack: number | null = null; if (dep && dl) for (let b = 0; b <= 600; b++) { const t = simulate(dep.min, b, k); if (okAt(Math.max(...t.map((x) => x.arrive)))) maxBack = b; else if (maxBack !== null) break; }
    comp.push(`Last arrival = ${dep ? hhmm(dep.min) : "departure"} + ${Math.ceil(n / k)} × ${out} minutes out + ${Math.ceil(n / k) - 1} × (drive back).`);
    const cond = dep && dl ? (maxBack === null ? `Even with an instant return the last group would arrive after ${hhmm(dl.min)}.` : `It works only if the drive back takes ${maxBack} minutes or less.`) : "";
    return { ...base, recommendation: rec("ask", { headline: `Cannot confirm yet: the drive back time was not found in the sources, or not in wording Jarvis can read. ${cond}`.trim(), question: q, nextAction: { kind: "ask_missing", text: q }, tradeoff: [`${plural(n, "trip")} (${sizes.join(" + ")}) with ${plural(k, "vehicle")}.`, cond].filter(Boolean), qualifiers: ["Provisional until the return time is known."] }), options: [], contact: null, data: { trips: n, maxBack }, figures: [{ label: "Trips needed", value: `${n} (${sizes.join(" + ")})` }, ...(cond ? [{ label: "Condition", value: cond }] : [])], keyFigures: cond ? [String(maxBack ?? "")].filter(Boolean) : [], draftSketch: { subject: "A question about the return trip", lines: [`I am working out whether everyone can arrive${dl ? ` by ${hhmm(dl.min)}` : ""}.`, ...(cond ? [cond] : [])], ask: ["How long does the drive back take?"] } };
  }
  const back = backS?.back ?? 0;
  if (!dep) {
    const total = (n - 1) * (back + load) + n * out;   // single vehicle, sequential
    const latestDep = dl ? dl.min - (Math.ceil(n / k) * out + (Math.ceil(n / k) - 1) * (back + load)) : null;
    const q = "When is the earliest the vehicle can leave? No departure time is in the sources or your request.";
    comp.push(`From departure to the last arrival takes ${fmtSpan(Math.ceil(n / k) * out + (Math.ceil(n / k) - 1) * (back + load))}.`); void total;
    return { ...base, recommendation: rec("ask", { headline: `Cannot confirm yet: no departure time was found in the sources, or not in wording Jarvis can read.${latestDep !== null && dl ? ` Everyone arrives ${dl.strict ? "before" : "by"} ${hhmm(dl.min)} only if the vehicle leaves at ${hhmm(latestDep)} or earlier.` : ""}`, question: q, nextAction: { kind: "ask_missing", text: q }, qualifiers: ["Provisional until a departure time is known."] }), options: [], contact: null, data: { trips: n, latestDep }, figures: [{ label: "Trips needed", value: `${n} (${sizes.join(" + ")})` }, ...(latestDep !== null ? [{ label: "Latest departure that works", value: hhmm(latestDep) }] : [])], keyFigures: latestDep !== null ? [hhmm(latestDep)] : [], draftSketch: { subject: "Departure time", lines: [`Everyone can arrive${dl ? ` ${dl.strict ? "before" : "by"} ${hhmm(dl.min)}` : ""} only if the vehicle leaves${latestDep !== null ? ` at ${hhmm(latestDep)} or earlier` : " early enough"}.`], ask: ["When is the earliest it can leave?"] } };
  }
  const t = simulate(dep.min, back, k); const lastArr = Math.max(...t.map((x) => x.arrive)); const ok = okAt(lastArr); const arrivals = [...t].sort((a, b) => a.arrive - b.arrive);
  t.forEach((x, i) => comp.push(`Trip ${i + 1}${k > 1 ? ` (vehicle ${x.v + 1})` : ""}: leaves ${hhmm(x.leave)}, arrives ${hhmm(x.arrive)} (${x.size} people)${i < n - 1 || k > 1 ? `, back at ${hhmm(x.back)}` : ""}.`));
  const legsOut = n, legsBack = Math.ceil(n / k) - 1;
  comp.push(`${plural(legsOut, "outbound leg")} and ${plural(legsBack, "return")} before the last arrival: ${hhmm(dep.min)} + ${Math.ceil(n / k)} × ${out}${legsBack ? ` + ${legsBack} × ${back + load}` : ""} minutes = ${hhmm(lastArr)}. The vehicle does not need to come back after the last delivery, so no final return is counted.`);
  const lastGroup = arrivals[arrivals.length - 1];
  let over = dl ? lastArr - dl.min : 0; const dlTxt = dl ? hhmm(dl.min) : "";
  const arrTxt = arrivals.map((x) => hhmm(x.arrive)).join(", "); const sizeTxt = arrivals.map((x) => x.size).join(", ");
  const figures = [{ label: "Last group arrives", value: `${hhmm(lastArr)}${dl ? (ok ? ` (${fmtSpan(dl.min - lastArr)} before the ${dlTxt} deadline)` : ` (${fmtSpan(over)} after the ${dlTxt} deadline)`) : ""}` }, { label: "Group arrival times", value: `${arrTxt} (${sizeTxt} people)` }, { label: "Trips needed", value: `${n} (${sizes.join(" + ")})` }, { label: "Legs before the last arrival", value: `${legsOut} out, ${legsBack} back` }];
  const options: PlanOpt[] = [{ option: `${plural(k, "vehicle")}, leave ${hhmm(dep.min)}`, label: `${plural(k, "vehicle")}, leaving ${hhmm(dep.min)}`, verdict: ok === false ? "fails" : "works", summary: `${plural(k, "vehicle")} leaving ${hhmm(dep.min)}: the last group arrives ${hhmm(lastArr)}${dl ? (ok ? ", on time" : `, ${fmtSpan(over)} late`) : ""}.`, steps: arrivals.map((x, i) => ({ when: `${hhmm(x.leave)} to ${hhmm(x.arrive)}`, what: `Group ${i + 1}: ${x.size} people${k > 1 ? ` (vehicle ${x.v + 1})` : ""}` })), checks: dl ? [ok ? `Arrives ${fmtSpan(dl.min - lastArr)} before ${dlTxt}.` : `Arrives ${fmtSpan(over)} after ${dlTxt}.`] : ["No deadline found, so none was checked."] }];
  const keyFigures = [hhmm(lastArr)]; const lines: string[] = []; const ask: string[] = [];
  lines.push(`With the ${hhmm(dep.min)} departure the groups would arrive at ${arrTxt} (${sizeTxt} people), so the last ${lastGroup.size} would arrive at ${hhmm(lastArr)}${dl ? (ok ? `, in time for ${dlTxt}` : `, ${fmtSpan(over)} after the ${dlTxt} deadline`) : ""}.`);
  const alt: string[] = [];
  if (dl && ok === false) {
    const latestDep = dep.min - over - (dl.strict ? 1 : 0); alt.push(`leave at ${hhmm(latestDep)} or earlier`); keyFigures.push(hhmm(latestDep));
    options.push({ option: `leave ${hhmm(latestDep)}`, label: `Leave at ${hhmm(latestDep)} (${plural(k, "vehicle")})`, verdict: "works", summary: `Leaving ${hhmm(latestDep)} instead of ${hhmm(dep.min)}, the last group arrives ${hhmm(lastArr - (dep.min - latestDep))}.`, steps: [], checks: [`Everything shifts ${fmtSpan(dep.min - latestDep)} earlier, so the last arrival is ${hhmm(lastArr - (dep.min - latestDep))}.`] });
    for (let kk = k + 1; kk <= k + 5; kk++) { const tt = simulate(dep.min, back, kk); const la = Math.max(...tt.map((x) => x.arrive)); if (okAt(la)) { alt.push(`add ${kk - k === 1 ? "another vehicle" : `${kk - k} more vehicles`} (the last group would arrive ${hhmm(la)})`); options.push({ option: `${kk} vehicles`, label: `${plural(kk, "vehicle")}, leaving ${hhmm(dep.min)}`, verdict: "works", summary: `${plural(kk, "vehicle")} leaving ${hhmm(dep.min)}: the last group arrives ${hhmm(la)}.`, steps: [...tt].sort((a, b) => a.arrive - b.arrive).map((x, i) => ({ when: `${hhmm(x.leave)} to ${hhmm(x.arrive)}`, what: `Group ${i + 1}: ${x.size} people (vehicle ${x.v + 1})` })), checks: [`Arrives ${fmtSpan(dl.min - la)} before ${dlTxt}.`] }); keyFigures.push(hhmm(la)); break; } }
    ask.push(`Could we ${alt.length > 1 ? alt[0] + ", or " + (/^add /.test(alt[1]) ? alt[1].replace(/^add /, "arrange ") : alt[1]) : alt[0] ?? "change the plan"}?`);
  }
  const alsoTxt = alt.length ? ` Two ways to fix it: ${alt.join("; or ")}.` : "";
  const headline = dl ? (ok ? `Yes: ${plural(k, "vehicle")} leaving ${hhmm(dep.min)} gets everyone there ${dl.strict ? "before" : "by"} ${dlTxt}. The last group of ${lastGroup.size} arrives ${hhmm(lastArr)}, ${fmtSpan(dl.min - lastArr)} early.` : `No: ${plural(k, "vehicle")} leaving ${hhmm(dep.min)} misses ${dlTxt} by ${fmtSpan(over)}. The groups arrive at ${arrTxt} (${sizeTxt} people), so the last ${lastGroup.size} arrive at ${hhmm(lastArr)}.${alsoTxt}`) : `The last group arrives ${hhmm(lastArr)}. No deadline was found, so none was checked.`;
  const tradeoff = [`${people!.n} people at ${seats} per trip is ${plural(n, "trip")} (${sizes.join(" + ")}), each ${out} minutes out${legsBack ? ` and ${back} back` : ""}.`, `${plural(legsOut, "outbound leg")} and ${plural(legsBack, "return")} come before the last arrival, and no return is counted after it.`, ...options.slice(1).map((o) => o.summary)];
  if (setAside.length && dep) tradeoff.push(`The departure used is ${hhmm(dep.min)}, which replaced ${setAside.filter((r) => r.label === "Earlier departure").map((r) => r.value).join(", ") || "an earlier time"}.`);
  const contact = items.find((i) => i.author)?.author ?? null;
  const next = ok === false ? { kind: "propose_fix", text: `Ask for an earlier departure (${alt[0]?.replace(/^leave /, "") ?? ""}) or another vehicle.` } : { kind: "none", text: "Nothing is blocking it on the evidence found." };
  return { ...base, recommendation: rec(ok === false ? "none_fits" : "recommend", { option: options[0].option, label: options[0].label, headline, tradeoff, nextAction: next, qualifiers: day === null ? ["No date was found for this trip, so only times of day are compared."] : [] }), options, contact: { name: contact, why: "shuttle" }, data: { trips: n, lastArrival: hhmm(lastArr), over }, figures, keyFigures, draftSketch: { subject: ok === false ? "The shuttle will arrive late with the current departure" : "Shuttle plan", lines, ask } };
}

/** Plan from the authorized sources. Returns null when the sources hold nothing that looks like a plan. */
// =====================================================================================================
//  SEQUENCE: items that run one after another, with breaks, against a window ("will the agenda fit the booking")
// =====================================================================================================
const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const FILLER = new Set(["now", "still", "also", "only", "currently", "then", "just", "will", "the", "a", "an", "and", "each", "all", "that", "which", "item", "items", "agenda", "has", "have"]);
const itemKey = (name: string) => name.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w)).map(stem).join(" ");
const cleanName = (name: string) => name.replace(/^(?:and|then|also|the|a|an)\s+/i, "").replace(/\s+(?:now|still|also|only|currently|then|will)$/i, "").trim();
export const looksLikeSequence = (request: string) => /\b(agenda|schedule|timetable|programme|program|itinerary|running order|line-?up|talks?|speakers?|items?|segments?|stops?)\b/i.test(request);

function planSequence(items: ItemIn[], request: string): PlanAnalysis | null {
  const all = sentencesOf(items).filter((s) => !ownMatterOfSender(s)); const inputs: PlanRow[] = []; const setAside: PlanRow[] = []; const notes: string[] = []; const comp: string[] = [];
  // Each "<name> takes <n> minutes" clause, in the order written. The latest statement for a name wins; the replaced one is kept.
  type Dur = { name: string; key: string; min: number; s: Sent; order: number };
  const durs: Dur[] = [];
  for (const s of [...all].sort((a, b) => String(a.item.at).localeCompare(String(b.item.at)) || a.start - b.start)) {
    if (/\b(?:break|booked|reserved)\b/i.test(s.text) && !/\btakes?\b/i.test(s.text)) continue;
    const clauses = s.text.split(/\s*(?:,|;|\band\b)\s*(?=[^,;]*\b(?:takes?|needs?|lasts?)\b)/i);
    for (const c of clauses) { const m = new RegExp(`^(.{2,60}?)\\s+(?:now\\s+|still\\s+)?(?:takes?|needs?|lasts?|runs? for)\\s+(?:about\\s+)?${NUM}\\s*(minutes?|mins?|hours?|hrs?)\\b`, "i").exec(c.trim()); if (!m) continue; const name = cleanName(m[1].split(":").pop()!.replace(/^.*\bthat\s+/i, "")); const key = itemKey(name); if (!key) continue; durs.push({ name, key, min: durMin(String(numOf(m[2])), m[3]), s, order: durs.length }); }
  }
  const keys = [...new Set(durs.map((d) => d.key))]; if (keys.length < 2) return null;
  const order = keys.map((k) => durs.find((d) => d.key === k)!);   // first mention fixes the position
  const cur = order.map((first) => { const all2 = durs.filter((d) => d.key === first.key).sort((a, b) => byRecency(a.s, b.s)); return { first, now: all2[0], older: all2.slice(1) }; });
  // Breaks: "10 minute coffee break after the second item".
  const breaks: { after: number; min: number; s: Sent }[] = [];
  for (const s of all) { const m = new RegExp(`${NUM}\\s*(?:-\\s*)?(minutes?|mins?|hours?|hrs?)?\\s+(?:[a-z]+\\s+)?break\\s+after\\s+(?:the\\s+)?(${Object.keys(ORD).join("|")}|\\d+(?:st|nd|rd|th)?)\\b`, "i").exec(s.text); if (m) { const after = ORD[m[3].toLowerCase()] ?? parseInt(m[3], 10); breaks.push({ after, min: m[2] ? durMin(String(numOf(m[1])), m[2]) : Number(numOf(m[1])), s }); } }
  // The window and the start.
  const win = [...all].sort(byRecency).map((s) => { const m = new RegExp(`\\b(?:booked|reserved|available|open|free|scheduled)\\s+(?:from\\s+)?(${CLOCK})\\s*(?:to|until|-|–)\\s*(${CLOCK})`, "i").exec(s.text); if (!m) return null; const cl = clocksIn(m[0]); return cl.length >= 2 ? { a: cl[0], b: cl[1], s } : null; }).find(Boolean) as { a: number; b: number; s: Sent } | undefined;
  const startS = [...all].sort(byRecency).map((s) => { const m = new RegExp(`\\b(?:start|starts|begin|begins|kick(?:s)? off)\\b[^.]{0,20}?\\bat\\s+(${CLOCK})`, "i").exec(s.text); return m ? { min: clocksIn(m[0])[0], s } : null; }).find(Boolean) as { min: number; s: Sent } | undefined;
  const start = startS?.min ?? win?.a ?? null;
  const basis = [win ? `window ${hhmm(win.a)} to ${hhmm(win.b)}` : null].filter(Boolean) as string[];
  const rec = (kind: PlanRec["kind"], p: Partial<PlanRec>): PlanRec => ({ kind, option: null, label: null, headline: "", tradeoff: [], question: null, nextAction: null, basis, qualifiers: [], ...p });
  for (const c of cur) { inputs.push(row(`${c.first.name[0].toUpperCase()}${c.first.name.slice(1)}`, `${c.now.min} minutes`, c.now.s, c.older.length ? "latest statement" : undefined)); for (const o of c.older) if (o.min !== c.now.min) setAside.push(row(`Earlier length: ${c.first.name}`, `${o.min} minutes`, o.s, `replaced by ${c.now.min} minutes (${c.now.s.item.title})`)); }
  for (const b of breaks) inputs.push(row(`Break after item ${b.after}`, `${b.min} minutes`, b.s));
  if (win) inputs.push(row("Booked window", `${hhmm(win.a)} to ${hhmm(win.b)}`, win.s)); if (startS) inputs.push(row("Planned start", hhmm(startS.min), startS.s));
  const base = { type: "plan" as const, kind: "sequence" as const, inputs, setAside, notes, computation: comp };
  if (start === null) { const q = "When does it start, and what is the booked window? Neither is in the sources or your request."; return { ...base, recommendation: rec("insufficient", { headline: "I cannot lay the items out: no start time or booked window was found.", question: q, nextAction: { kind: "ask_missing", text: q } }), options: [], contact: null, data: {} }; }
  let t = start; const rows: { name: string; a: number; b: number; brk?: number }[] = [];
  cur.forEach((c, i) => { const a = t; const b = a + c.now.min; t = b; rows.push({ name: c.first.name.charAt(0).toUpperCase() + c.first.name.slice(1), a, b }); const br = breaks.find((x) => x.after === i + 1); if (br) { rows.push({ name: "Break", a: t, b: t + br.min, brk: br.min }); t += br.min; } });
  const items2 = rows.filter((r) => !r.brk); const end = items2[items2.length - 1].b; const total = rows.reduce((a, r) => a + (r.b - r.a), 0);
  comp.push(`${cur.map((c) => `${c.now.min}`).join(" + ")}${breaks.length ? ` + ${breaks.map((b) => b.min).join(" + ")} break` : ""} = ${total} minutes (${fmtSpan(total)}).`);
  rows.forEach((r) => comp.push(`${r.name}: ${hhmm(r.a)} to ${hhmm(r.b)}`));
  const winTxt = win ? `${hhmm(win.a)} to ${hhmm(win.b)}` : null; const over = win ? end - win.b : null; const ok = win ? end <= win.b : null;
  if (win) comp.push(`Start ${hhmm(start)} + ${total} minutes = ${hhmm(end)}; the booking ends ${hhmm(win.b)}, so ${ok ? `${fmtSpan(win.b - end)} to spare` : `it overruns by ${fmtSpan(over!)}`}. Items run in the order written, with no gaps except the stated breaks.`);
  const lines = rows.map((r) => `${hhmm(r.a)}–${hhmm(r.b)}  ${r.name}`);
  const figures = [{ label: "Last item ends", value: `${hhmm(end)}${win ? (ok ? ` (${fmtSpan(win.b - end)} before the booking ends)` : ` (${fmtSpan(over!)} after the booking ends at ${hhmm(win.b)})`) : ""}` }, { label: "Total length", value: fmtSpan(total) }, ...rows.filter((r) => !r.brk).map((r) => ({ label: `${r.name} starts`, value: `${hhmm(r.a)} (ends ${hhmm(r.b)})` }))];
  const timetable: PlanStep[] = rows.map((r) => ({ when: `${hhmm(r.a)} to ${hhmm(r.b)}`, what: r.name }));
  const fixes: string[] = []; if (win && !ok) { const longest = [...cur].sort((a, b) => b.now.min - a.now.min)[0]; fixes.push(`extend the booking to ${hhmm(end)}`, `start at ${hhmm(start - over!)}`, `cut ${fmtSpan(over!)} (for example from the ${longest.first.name}, ${longest.now.min} minutes)`); }
  const options: PlanOpt[] = [{ option: "as written", label: "As written", verdict: ok === false ? "fails" : "works", summary: `As written the last item ends ${hhmm(end)}${win ? (ok ? ", inside the booking" : `, ${fmtSpan(over!)} after it ends`) : ""}.`, steps: timetable, checks: win ? [ok ? `Ends ${fmtSpan(win.b - end)} before ${hhmm(win.b)}.` : `Ends ${fmtSpan(over!)} after ${hhmm(win.b)}.`] : ["No booked window found, so none was checked."] }];
  if (fixes.length) options.push({ option: "fix", label: "What would make it fit", verdict: "works", summary: fixes.join("; "), steps: [], checks: fixes });
  const headline = win ? (ok ? `Yes: the agenda fits. Starting ${hhmm(start)}, the last item ends ${hhmm(end)}, ${fmtSpan(win.b - end)} before the booking ends at ${hhmm(win.b)}.` : `No: starting ${hhmm(start)}, the agenda runs until ${hhmm(end)}, ${fmtSpan(over!)} past the end of the ${winTxt} booking. To fit: ${fixes.join(", or ")}.`) : `Starting ${hhmm(start)}, the last item ends ${hhmm(end)}. No booked window was found, so none was checked.`;
  const tradeoff = [`${cur.length} items and ${plural(breaks.length, "break")} take ${fmtSpan(total)} in total.`, ...(setAside.length ? [`Latest lengths are used: ${setAside.map((r) => `${r.label.replace("Earlier length: ", "")} was ${r.value}, now ${r.note!.match(/replaced by (\d+ minutes)/)?.[1]}`).join("; ")}.`] : [])];
  return { ...base, recommendation: rec(ok === false ? "none_fits" : "recommend", { option: "as written", label: "As written", headline, tradeoff, nextAction: ok === false ? { kind: "propose_fix", text: `Decide how to make it fit: ${fixes.join("; or ")}.` } : { kind: "none", text: "Nothing is blocking it on the evidence found." }, qualifiers: [] }), options, contact: null, data: { end: hhmm(end) }, figures, keyFigures: [hhmm(end)], draftSketch: { subject: "Agenda", lines, ask: [], form: "list" } };
}

const hm2 = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** Name the figures a plan produced, so a requested figure and a draft can be checked against them. */
function withFigures(p: PlanAnalysis | null): PlanAnalysis | null {
  if (!p || p.figures) return p;
  const d = p.data as any;
  if (p.kind === "capacity" && d.room && d.sessions) { const ss = d.sessions as { s: number; e: number; n: number }[]; p.figures = [{ label: "Room", value: String(d.room) }, { label: "Sessions", value: ss.map((x) => `${hm2(x.s)} to ${hm2(x.e)} (${x.n} people)`).join(" and ") }]; p.keyFigures = [String(d.room), hm2(ss[0].s)]; }
  if (p.kind === "batch" && d.runs) { const good = p.options.find((o) => o.verdict === "works"); const last = good?.steps[good.steps.length - 1]; p.figures = [{ label: "Runs needed", value: String(d.runs) }, ...(last ? [{ label: "Last unload", value: last.when }] : [])]; p.keyFigures = last ? [last.when] : []; }
  return p;
}
export function analyzePlan(items: ItemIn[], request: string): PlanAnalysis | null { return withFigures(analyzePlanRaw(items, request)); }
function analyzePlanRaw(items: ItemIn[], request: string): PlanAnalysis | null {
  void dayOfIso;
  if (looksLikeTrips(request)) { const t = planTrips(items, request); if (t && (t.options.length || t.inputs.length > 1)) return t; }
  if (looksLikeSequence(request)) { const q = planSequence(items, request); if (q) return q; }
  const wantsPlace = /\b(where|which room|which space|what room)\b/i.test(request) || /\b(everyone|all)\b[^.?]*\b(attend|fit|registered|come)\b/i.test(request);
  const first = wantsPlace ? planCapacity(items, request) : planBatch(items, request);
  if (first && (first.options.length || first.recommendation.kind === "insufficient" && first.inputs.length)) return first;
  const second = wantsPlace ? planBatch(items, request) : planCapacity(items, request);
  if (second && second.options.length) return second;
  return first && first.inputs.length ? first : null;
}
