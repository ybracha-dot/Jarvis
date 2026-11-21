// Time, capacity and duration planning from authorized evidence. Pure functions: the same sources and request always give the same plan.
// Two kinds of question are handled, and both are written in terms of form (quantities, windows, durations, dates), not of any example:
//   "capacity"  where and when can this happen so that everyone fits (rooms, seats, sessions, breaks, availability windows)
//   "batch"     how many runs does this take, when does each start and end, and is it done before a deadline (cycles, operating windows)
// Every figure used carries its source and quote. Statements about somebody else's matter, about another date, or superseded by a later
// statement are set aside and shown, never silently mixed in. When an input is missing or two readings give different answers, the
// plan says so and asks one precise question instead of guessing.
import type { ItemIn, Src } from "./decision";

export const PLAN_Q = /\b(where and when|which (?:room|slot|day|time|space)|what time|when (?:do|should|can|will|must|could) (?:i|we) (?:start|begin|run|hold|schedule|book|fire|load|send|set up)|each (?:firing|run|batch|session|load|shift|trip)|how many (?:sessions|firings|runs|batches|shifts|trips|rounds)|fit(?:s)? (?:everyone|all)|everyone (?:who )?(?:is )?(?:registered |signed up )?(?:can|could|will|to) ?attend|before the [\w -]{0,40}?(?:load-?in|deadline|opening|cut-?off|set-?up)|(?:finished|fired|done|unloaded|processed|completed|ready) (?:and \w+ )?before (?:the )?[\w -]{0,30}?(?:load-?in|deadline|opening))\b/i;
export const isPlanRequest = (t: string) => PLAN_Q.test(t);

export interface PlanRow { label: string; value: string; src: Src | null; srcTitle: string; quote: string | null; note?: string }
export interface PlanStep { when: string; what: string }
export interface PlanOpt { option: string; label: string; verdict: "works" | "fails" | "depends"; summary: string; steps: PlanStep[]; checks: string[] }
export interface PlanRec { kind: "recommend" | "ask" | "none_fits" | "insufficient"; option: string | null; label: string | null; headline: string; tradeoff: string[]; question: string | null; nextAction: { kind: string; option?: string; text: string } | null; basis: string[]; qualifiers: string[] }
export interface PlanAnalysis { type: "plan"; kind: "capacity" | "batch"; recommendation: PlanRec; inputs: PlanRow[]; computation: string[]; options: PlanOpt[]; setAside: PlanRow[]; notes: string[]; contact: { name: string | null; why: string } | null; data: Record<string, unknown> }

// ---------- words, time and dates ----------
const STOP = new Set("the and for you your are was were with that this from have has had not but can could would should will shall all any each every where when what which who how why get got our out into onto than then them they their there here also too very more most some such only own same just about over under after before between during while does did done being been its it's i'm i'd my me we us he she him her his hers one two three four draft short note write email message please make give need want like let see tell show find ask send book slot slots plan start begin run ready tomorrow today tonight morning everyone registered attend people".split(" "));
const DAYS = new Set("monday tuesday wednesday thursday friday saturday sunday".split(" "));
const stem = (t: string) => t.replace(/(?:es|s)$/, "").replace(/(?:ing|ed|e)$/, "");
const wordsOf = (text: string) => [...new Set((text.replace(/'s\b/g, "").toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w) && !DAYS.has(w)).map(stem))];
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
    if (missing.length) { opts.push({ option: p.resource, label: p.resource, verdict: "depends", summary: `${p.resource}: ${plural(n, "run")} needed, but ${missing.join(" and ")} is not stated.`, steps: [], checks: [`Missing: ${missing.join("; ")}.`] }); continue; }
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

/** Plan from the authorized sources. Returns null when the sources hold nothing that looks like a plan. */
export function analyzePlan(items: ItemIn[], request: string): PlanAnalysis | null {
  void dayOfIso;
  const wantsPlace = /\b(where|which room|which space|what room)\b/i.test(request) || /\b(everyone|all)\b[^.?]*\b(attend|fit|registered|come)\b/i.test(request);
  const first = wantsPlace ? planCapacity(items, request) : planBatch(items, request);
  if (first && (first.options.length || first.recommendation.kind === "insufficient" && first.inputs.length)) return first;
  const second = wantsPlace ? planBatch(items, request) : planCapacity(items, request);
  if (second && second.options.length) return second;
  return first && first.inputs.length ? first : null;
}
