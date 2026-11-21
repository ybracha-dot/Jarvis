// Decision engine. Pure functions over evidence facts and sentences: no database, no model, no network.
// 1) Option terms: who offers what, with source, revision, date, value, unit and how to treat it (confirmed or estimate, included or extra).
// 2) The user's own constraints (budget, deadline, capacity), read from what they wrote, never from an option's marketing.
// 3) Totals computed in integer minor units. An included component is never counted twice. An unknown component stays visible.
// 4) A recommendation that follows the stated criteria, or one precise question when a missing input could flip the choice.
// Nothing here knows an example name. Money, dates and capacity are recognised by their form.

import { splitSentences } from "./extract";

export interface Src { itemId: string; revision: number; title: string; kind: string; at: string; author: string | null; sourceLabel: string; mode: string }
export interface SentenceIn extends Src { text: string; start: number; end: number }
export interface FactIn extends Src { id: string; kind: string; value: string | null; quote: string; start: number; end: number }
export interface ItemIn extends Src { facts: FactIn[]; sentences: { text: string; start: number; end: number }[]; ownerAuthored: boolean }

export const COMPONENTS = ["permit", "fee", "tax", "deposit", "shipping", "delivery", "setup", "installation", "insurance", "licence", "license", "service charge", "materials", "labor", "labour", "disposal", "cleanup", "travel", "tip", "surcharge", "registration"];
const SYMBOL: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP" };
export interface Money { minor: number; currency: string }
export function parseMoney(text: string): Money | null {
  const t = text.trim(); let cur = ""; let num = "";
  let m = /^([$€£])\s?([\d,]+(?:\.\d+)?)\s?([kKmM])?$/.exec(t); if (m) { cur = SYMBOL[m[1]]; num = m[2]; return fin(num, cur, m[3]); }
  m = /^(EUR|USD|GBP|CAD|AUD)\s?([\d,]+(?:\.\d+)?)\s?([kKmM])?$/i.exec(t); if (m) return fin(m[2], m[1].toUpperCase(), m[3]);
  m = /^([\d,]+(?:\.\d+)?)\s?(EUR|USD|GBP|CAD|AUD)$/i.exec(t); if (m) return fin(m[1], m[2].toUpperCase(), undefined);
  return null;
}
function fin(num: string, cur: string, suffix?: string): Money { let v = parseFloat(num.replace(/,/g, "")); if (suffix) v *= /k/i.test(suffix) ? 1_000 : 1_000_000; return { minor: Math.round(v * 100), currency: cur }; }
export function fmtMoney(minor: number, currency: string): string {
  const v = minor / 100; const whole = Math.abs(v - Math.round(v)) < 0.005;
  const n = new Intl.NumberFormat("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  const s = currency === "USD" ? `$${n}` : currency === "EUR" ? `€${n}` : currency === "GBP" ? `£${n}` : `${currency} ${n}`; return v < 0 ? `-${s}` : s;
}
const MONEY_RE = /(?:[$€£]\s?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?[kKmM]\b)?)|(?:\b(?:EUR|USD|GBP|CAD|AUD)\s?\d(?:[\d,]*\d)?(?:\.\d+)?)|(?:\b\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:EUR|USD|GBP|CAD|AUD)\b)/g;

export type Treatment = "included" | "extra" | "n/a";
export interface Term {
  id: string; option: string; optionLabel: string; role: "base" | "total" | "component" | "availability" | "completion" | "deadline" | "capacity";
  name: string; money?: Money; max?: Money; qty?: number; unit?: string; date?: string; semantic: "confirmed" | "estimate"; treatment: Treatment; includes: string[]; unknownAmount: boolean;
  src: Src; quote: string; start: number; end: number; superseded: boolean; supersededBy?: string; why?: string;
}
export interface Constraint { id: string; kind: "budget_max" | "deadline" | "capacity_min"; money?: Money; allIn?: boolean; date?: string; qty?: number; unit?: string; src: Src | { itemId: null; title: string }; quote: string }

const ORG_SUFFIX = /\b((?:[A-Z][\w&'.-]*\s(?:&\s)?){0,3}(?:Plumbing|Sons|Inc\.?|LLC|Ltd\.?|Co\.|Company|Group|Studio|Services|Electric|Electrical|Roofing|Construction|Builders|Contractors|Associates|Partners|Hotel|Hostel|Catering|Rentals|Movers|Airlines|Air|Agency|Consulting|Labs?|Works))\b/;
/** The offering party of an item: an organisation named in the text, else the sender. */
export function partyOf(it: { title: string; author: string | null; texts: string[] }): { key: string; label: string } {
  const body = it.texts.join(" "); const m = ORG_SUFFIX.exec(body) ?? ORG_SUFFIX.exec(it.title);
  const author = it.author && !/claude|shared by you/i.test(it.author) ? it.author : null;
  return { key: (author ?? m?.[1] ?? it.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), label: m ? m[1].trim() : (author ?? it.title) };
}

const EST = /\b(estimat\w*|approx\w*|about|around|roughly|ballpark|~)\b/i;
const EXTRA = /\b(plus|extra|additional|on top|not included|excluding|exclusive of|separate(?:ly)?|in addition)\b/i;
const INCL = /\b(including|includes|included|inclusive|incl\.)\b/i;
const NOT_INCL = /\bnot (?:been )?included\b/i;
function componentIn(s: string): string | null { const low = s.toLowerCase(); let best: { n: string; i: number } | null = null; for (const c of COMPONENTS) { const i = low.lastIndexOf(c); if (i >= 0 && (!best || i > best.i)) best = { n: c === "license" ? "licence" : c === "labour" ? "labor" : c, i }; } return best?.n ?? null; }

export function extractTerms(items: ItemIn[]): Term[] {
  const out: Term[] = []; let seq = 0; const id = () => `t${++seq}`;
  const offers = items.filter((i) => !i.ownerAuthored);
  const byParty = new Map<string, string>();     // key -> best label
  for (const it of offers) { const p = partyOf({ title: it.title, author: it.author, texts: it.sentences.map((s) => s.text) }); const have = byParty.get(p.key); if (!have || (/\s/.test(p.label) && p.label.length > have.length && ORG_SUFFIX.test(p.label))) byParty.set(p.key, p.label); }
  for (const it of offers) {
    const p = partyOf({ title: it.title, author: it.author, texts: it.sentences.map((s) => s.text) }); const label = byParty.get(p.key) ?? p.label;
    let baseTaken = false;
    for (const s of it.sentences) {
      const src: Src = it; const low = s.text.toLowerCase();
      const monies = [...s.text.matchAll(MONEY_RE)].map((m) => ({ text: m[0], at: m.index ?? 0, money: parseMoney(m[0]) })).filter((m) => m.money);
      const lonely = componentIn(s.text);
      // an included component with no amount: "including the permit", "permit included"
      const inclNames = INCL.test(s.text) && !NOT_INCL.test(s.text) ? COMPONENTS.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(s.text)) : [];
      // an excluded component with no amount: "the permit is not included"
      if (!monies.length && lonely && NOT_INCL.test(s.text)) out.push({ id: id(), option: p.key, optionLabel: label, role: "component", name: lonely, semantic: "estimate", treatment: "extra", includes: [], unknownAmount: true, src, quote: s.text, start: s.start, end: s.end, superseded: false });
      for (let k = 0; k < monies.length; k++) {
        const m = monies[k]; const before = s.text.slice(Math.max(0, m.at - 46), m.at); const after = s.text.slice(m.at + m.text.length, m.at + m.text.length + 40);
        const comp = componentIn(before) ?? (EXTRA.test(s.text) && lonely && monies.length === 1 ? lonely : null) ?? (/\b(extra|additional)\b/i.test(after) && lonely ? lonely : null);
        const est = EST.test(before) || EST.test(after.slice(0, 20));
        const range = after.match(/^\s*(?:to|-|–|and)\s*([$€£]?\s?\d(?:[\d,]*\d)?(?:\.\d+)?)/); const hi = range ? parseMoney((m.text.match(/^[$€£]|^[A-Z]{3}/)?.[0] ?? "$") + range[1].replace(/^[$€£]\s?/, "")) : null;
        if (comp) {
          const incl = INCL.test(before + " " + after.slice(0, 15)) && !NOT_INCL.test(s.text) && !EXTRA.test(before);
          out.push({ id: id(), option: p.key, optionLabel: label, role: "component", name: comp, money: m.money!, max: hi ?? undefined, semantic: est ? "estimate" : "confirmed", treatment: incl ? "included" : "extra", includes: [], unknownAmount: false, src, quote: s.text, start: s.start, end: s.end, superseded: false });
        } else if (!baseTaken || /\b(all[- ]in|total|altogether)\b/i.test(s.text)) {
          const total = /\b(all[- ]in|total|altogether|grand total)\b/i.test(s.text);
          if (!total) baseTaken = true;
          out.push({ id: id(), option: p.key, optionLabel: label, role: total ? "total" : "base", name: "price", money: m.money!, max: hi ?? undefined, semantic: est ? "estimate" : "confirmed", treatment: "n/a", includes: inclNames, unknownAmount: false, src, quote: s.text, start: s.start, end: s.end, superseded: false });
        }
      }
      // dates
      for (const f of it.facts.filter((x) => x.kind === "date" && x.quote === s.text)) {
        const role: Term["role"] | null = /\b(start|begin|available|availability|open)\b/i.test(s.text) ? "availability" : /\b(finish\w*|complet\w*|done|ready|deliver\w*|wrap)\b/i.test(s.text) ? "completion" : /\b(due|deadline|sign by|expires?|valid until|respond by)\b/i.test(s.text) ? "deadline" : null;
        if (role && f.value) out.push({ id: id(), option: p.key, optionLabel: label, role, name: role, date: f.value, semantic: "confirmed", treatment: "n/a", includes: [], unknownAmount: false, src, quote: s.text, start: s.start, end: s.end, superseded: false });
      }
      // capacity
      const cap = /\b(?:seats?|holds?|capacity of|up to|sleeps|fits)\s+(?:up to\s+)?(\d{1,5})\s*(people|guests|seats|attendees|members|students|persons)?\b/i.exec(s.text) ?? /\b(\d{1,5})\s+(seats|people|guests|attendees|persons)\s+(?:capacity|max|maximum)\b/i.exec(s.text);
      if (cap && !monies.some((mm) => s.text.indexOf(cap[1]) >= mm.at && s.text.indexOf(cap[1]) < mm.at + mm.text.length)) out.push({ id: id(), option: p.key, optionLabel: label, role: "capacity", name: "capacity", qty: Number(cap[1]), unit: (cap[2] ?? "people").toLowerCase(), semantic: "confirmed", treatment: "n/a", includes: [], unknownAmount: false, src, quote: s.text, start: s.start, end: s.end, superseded: false });
      void low;
    }
  }
  // Later statements from the same party replace earlier ones. The earlier ones stay as history.
  const key = (t: Term) => `${t.option}|${t.role === "base" || t.role === "total" ? "price" : t.role === "component" ? `component:${t.name}` : t.role}`;
  const groups = new Map<string, Term[]>(); for (const t of out) groups.set(key(t), [...(groups.get(key(t)) ?? []), t]);
  for (const g of groups.values()) { g.sort((a, b) => String(a.src.at).localeCompare(String(b.src.at)) || a.start - b.start); const latestAt = g[g.length - 1].src.at; const latest = g.filter((t) => t.src.at === latestAt); for (const t of g) if (t.src.at !== latestAt) { t.superseded = true; t.supersededBy = latest[0].id; } }
  // A later quote that does not mention a component no longer carries what the earlier base included, but never invents one: leave the component to its own latest statement.
  return out;
}

export function extractConstraints(items: ItemIn[], request: string): Constraint[] {
  const out: Constraint[] = []; let n = 0;
  const scan = (sentences: { text: string }[], src: Src | { itemId: null; title: string }) => {
    for (const s of sentences) {
      const text = s.text;
      const budget = /\b(budget|cap|ceiling|max(?:imum)?|limit|no more than|not (?:to )?exceed|up to|under|at most|afford)\b[^.$€£]{0,40}?((?:[$€£]\s?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?[kKmM]\b)?)|(?:\b(?:EUR|USD|GBP)\s?\d(?:[\d,]*\d)?(?:\.\d+)?))/i.exec(text);
      if (budget) { const money = parseMoney(budget[2]); if (money) out.push({ id: `c${++n}`, kind: "budget_max", money, allIn: /\b(all[- ]in|total|everything|including)\b/i.test(text), src, quote: text }); }
      const dl = /\b(?:done|finished|complete[d]?|ready|need(?:s|ed)?(?: it)?|before|by|no later than|deadline|must (?:be|finish))\b[^.]{0,60}?\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})\b/i.exec(text);
      if (dl && /\b(done|finish\w*|complet\w*|ready|need\w*|deadline|must|before|no later)\b/i.test(text) && !/\b(quote|estimate|offer)\b/i.test(text)) { out.push({ id: `c${++n}`, kind: "deadline", date: dl[1], src, quote: text }); }
      const cap = /\b(?:at least|minimum(?: of)?|need(?:s)?(?: room| space| seats?| capacity)?(?: for)?|for|capacity of)\s+(\d{1,5})\s+(people|seats|guests|attendees|members|students|persons)\b/i.exec(text);
      if (cap && /\b(at least|minimum|need|capacity|must|for)\b/i.test(text)) out.push({ id: `c${++n}`, kind: "capacity_min", qty: Number(cap[1]), unit: cap[2].toLowerCase(), src, quote: text });
    }
  };
  for (const it of items.filter((i) => i.ownerAuthored)) scan(it.sentences, it);
  scan(request.split(/(?<=[.!?])\s+/).map((t) => ({ text: t })), { itemId: null, title: "Your request" });
  return out;
}

export interface Calc { min: number; max: number; currency: string; approx: boolean; parts: { label: string; term: Term | null; money: Money | null; note: string }[]; unknown: { name: string; term: Term }[]; includedNote: string[] }
export interface OptionResult {
  option: string; label: string; terms: Term[]; current: Term[]; history: Term[];
  calc: Calc | null; checks: { constraint: Constraint; status: "ok" | "violated" | "unknown" | "unconfirmed"; detail: string; diffMinor?: number }[];
  availability: Term | null; completion: Term | null;
}
export interface Analysis {
  options: OptionResult[]; constraints: Constraint[]; recommendation: Rec; currency: string | null; notes: string[]; fx?: { basis: string } | null;
}
export interface Rec { kind: "recommend" | "provisional" | "none_fits" | "ask" | "insufficient"; option: string | null; label: string | null; headline: string; tradeoff: string[]; question: string | null; nextAction: { kind: "confirm_completion" | "ask_missing" | "none"; option?: string; text: string } | null; basis: string[]; qualifiers: string[] }

const sumMoney = (a: Money, b: Money): Money => ({ minor: a.minor + b.minor, currency: a.currency });
export function computeOption(label: string, current: Term[]): Calc | null {
  const price = current.find((t) => t.role === "total") ?? current.find((t) => t.role === "base");
  if (!price?.money) return null;
  const cur = price.money.currency; const parts: Calc["parts"] = []; const unknown: Calc["unknown"] = []; const includedNote: string[] = [];
  let min = price.money.minor, max = (price.max ?? price.money).minor; let approx = price.semantic === "estimate";
  parts.push({ label: price.role === "total" ? "Stated all-in price" : "Quoted price", term: price, money: price.money, note: price.semantic === "estimate" ? "estimate" : "confirmed" });
  const inc = new Set(price.includes);
  for (const c of current.filter((t) => t.role === "component")) {
    if (price.role === "total") { parts.push({ label: `${c.name} (already in the all-in price)`, term: c, money: c.money ?? null, note: "not added again" }); continue; }
    if (inc.has(c.name) && c.treatment !== "extra") { includedNote.push(c.name); parts.push({ label: `${c.name} (included in the quote)`, term: c, money: c.money ?? null, note: "included, not added again" }); continue; }
    if (c.treatment === "included") { includedNote.push(c.name); parts.push({ label: `${c.name} (included)`, term: c, money: c.money ?? null, note: "included, not added again" }); continue; }
    if (c.unknownAmount || !c.money) { unknown.push({ name: c.name, term: c }); parts.push({ label: `${c.name} (not included, amount unknown)`, term: c, money: null, note: "unknown: not in the total" }); continue; }
    if (c.money.currency !== cur) { unknown.push({ name: `${c.name} (${c.money.currency})`, term: c }); parts.push({ label: `${c.name} in ${c.money.currency}`, term: c, money: c.money, note: "different currency: not added without an exchange rate" }); continue; }
    min += c.money.minor; max += (c.max ?? c.money).minor; if (c.semantic === "estimate") approx = true;
    parts.push({ label: `${c.name} (extra${c.semantic === "estimate" ? ", estimate" : ""})`, term: c, money: c.money, note: c.semantic === "estimate" ? "estimate" : "confirmed" });
  }
  for (const n of inc) if (!current.some((t) => t.role === "component" && t.name === n && t.treatment === "extra") && !includedNote.includes(n)) { includedNote.push(n); parts.push({ label: `${n} (included in the quote)`, term: price, money: null, note: "included, not added again" }); }
  void label; return { min, max, currency: cur, approx, parts, unknown, includedNote };
}

function parseMonthDay(md: string, refIso: string): string {
  const y = new Date(refIso).getUTCFullYear(); const d = new Date(`${md} ${y} 12:00:00 UTC`); if (isNaN(d.getTime())) return md;
  let iso = d.toISOString().slice(0, 10); if (iso < refIso.slice(0, 10)) iso = new Date(`${md} ${y + 1} 12:00:00 UTC`).toISOString().slice(0, 10); return iso;
}
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const approxWord = (c: Calc) => (c.approx ? "about " : "");
const money = (c: Calc, v: number) => `${approxWord(c)}${fmtMoney(v, c.currency)}`;

export function analyze(items: ItemIn[], request: string, o: { fxRates?: Record<string, number> } = {}): Analysis {
  const terms = extractTerms(items); const constraints = extractConstraints(items, request);
  for (const c of constraints) if (c.kind === "deadline" && c.date && !/^\d{4}-/.test(c.date)) c.date = parseMonthDay(c.date, (c.src as Src).at ?? new Date().toISOString());
  const labels = new Map<string, string>(); for (const t of terms) labels.set(t.option, t.optionLabel);
  const opts: OptionResult[] = [...labels].map(([key, label]) => {
    const ts = terms.filter((t) => t.option === key); const current = ts.filter((t) => !t.superseded); const history = ts.filter((t) => t.superseded);
    return { option: key, label, terms: ts, current, history, calc: computeOption(label, current), checks: [], availability: current.find((t) => t.role === "availability") ?? null, completion: current.find((t) => t.role === "completion") ?? null };
  }).filter((o2) => o2.current.some((t) => ["base", "total", "capacity", "availability", "completion"].includes(t.role)));
  const notes: string[] = [];
  // Currency: only one authorized basis lets different currencies meet.
  const currencies = new Set(opts.filter((x) => x.calc).map((x) => x.calc!.currency)); let currency: string | null = currencies.size === 1 ? [...currencies][0] : null; let fxBasis: string | null = null;
  if (currencies.size > 1) {
    const target = [...currencies][0];
    const rates = o.fxRates ?? {};
    if ([...currencies].every((c) => c === target || rates[`${c}_${target}`])) { for (const x of opts) if (x.calc && x.calc.currency !== target) { const r = rates[`${x.calc.currency}_${target}`]; x.calc = { ...x.calc, min: Math.round(x.calc.min * r), max: Math.round(x.calc.max * r), currency: target, approx: true }; } currency = target; fxBasis = `Converted to ${target} with the exchange rates you provided.`; notes.push(fxBasis); }
    else notes.push(`The options are priced in different currencies (${[...currencies].join(", ")}). Jarvis does not compare them without an exchange rate you provide.`);
  }
  // A later statement of your own limit replaces an earlier one. The earlier one is kept in the notes, not applied.
  for (const k of ["budget_max", "deadline"] as const) {
    const same = constraints.filter((c) => c.kind === k).sort((a, b) => String((b.src as Src).at ?? "9999").localeCompare(String((a.src as Src).at ?? "9999")));
    for (const old of same.slice(1)) { const i = constraints.indexOf(old); if (i >= 0) { constraints.splice(i, 1); notes.push(`Your earlier ${k === "budget_max" ? `budget of ${fmtMoney(old.money!.minor, old.money!.currency)}` : `deadline of ${fmtDate(old.date!)}`} was replaced by a later statement.`); } }
  }
  const budget = constraints.find((c) => c.kind === "budget_max" && c.money && (!currency || c.money.currency === currency));
  for (const x of opts) {
    if (budget && x.calc) {
      const cap = budget.money!.minor;
      const lowerOver = x.calc.min - cap;
      if (x.calc.unknown.length) {
        if (x.calc.min > cap) x.checks.push({ constraint: budget, status: "violated", detail: `already ${fmtMoney(lowerOver, x.calc.currency)} over your ${fmtMoney(cap, x.calc.currency)} limit before ${x.calc.unknown.map((u) => u.name).join(" and ")}`, diffMinor: lowerOver });
        else x.checks.push({ constraint: budget, status: "unknown", detail: `${money(x.calc, x.calc.min)} before ${x.calc.unknown.map((u) => u.name).join(" and ")}, whose amount is not stated, so your ${fmtMoney(cap, x.calc.currency)} limit cannot be checked` });
      } else if (x.calc.max <= cap) x.checks.push({ constraint: budget, status: "ok", detail: `${fmtMoney(cap - x.calc.max, x.calc.currency)} under your ${fmtMoney(cap, x.calc.currency)} limit`, diffMinor: x.calc.max - cap });
      else if (x.calc.min > cap) x.checks.push({ constraint: budget, status: "violated", detail: `${fmtMoney(x.calc.min - cap, x.calc.currency)} over your ${fmtMoney(cap, x.calc.currency)} limit`, diffMinor: x.calc.min - cap });
      else x.checks.push({ constraint: budget, status: "unknown", detail: `between ${fmtMoney(x.calc.min, x.calc.currency)} and ${fmtMoney(x.calc.max, x.calc.currency)}, which straddles your ${fmtMoney(cap, x.calc.currency)} limit` });
    } else if (budget && !x.calc) x.checks.push({ constraint: budget, status: "unknown", detail: "no price found" });
    for (const dl of constraints.filter((c) => c.kind === "deadline" && c.date)) {
      if (x.completion?.date) x.checks.push({ constraint: dl, status: x.completion.date < dl.date! ? "ok" : "violated", detail: `finished ${fmtDate(x.completion.date)}, ${x.completion.date < dl.date! ? "before" : "not before"} ${fmtDate(dl.date!)}` });
      else if (x.availability?.date) x.checks.push({ constraint: dl, status: "unconfirmed", detail: `can start ${fmtDate(x.availability.date)}, which does not say when it will be finished` });
      else x.checks.push({ constraint: dl, status: "unknown", detail: "no dates given" });
    }
    for (const cp of constraints.filter((c) => c.kind === "capacity_min")) {
      const t = x.current.find((y) => y.role === "capacity" && (!cp.unit || y.unit === cp.unit || true));
      if (t?.qty != null) x.checks.push({ constraint: cp, status: t.qty >= cp.qty! ? "ok" : "violated", detail: `${t.qty} ${t.unit}` }); else x.checks.push({ constraint: cp, status: "unknown", detail: "capacity not stated" });
    }
  }
  return { options: opts, constraints, recommendation: recommend(opts, constraints, currency, budget ?? null), currency, notes, fx: fxBasis ? { basis: fxBasis } : null };
}

function recommend(opts: OptionResult[], constraints: Constraint[], currency: string | null, budget: Constraint | null): Rec {
  const none = (kind: Rec["kind"], headline: string, extra: Partial<Rec> = {}): Rec => ({ kind, option: null, label: null, headline, tradeoff: [], question: null, nextAction: null, basis: [], qualifiers: [], ...extra });
  const priced = opts.filter((o) => o.calc);
  if (opts.length < 2) return none("insufficient", opts.length === 1 ? `Only one option was found (${opts[0].label}), so there is nothing to compare yet.` : "No comparable options with prices, capacity or dates were found in the sources.");
  const hard = constraints.filter((c) => c.kind !== "deadline" || true);
  const basis = hard.map((c) => c.kind === "budget_max" ? `budget ${fmtMoney(c.money!.minor, c.money!.currency)}${c.allIn ? " all-in" : ""}` : c.kind === "deadline" ? `finished before ${fmtDate(c.date!)}` : `at least ${c.qty} ${c.unit}`);
  const statusOf = (o: OptionResult) => o.checks.some((c) => c.status === "violated") ? "violated" : o.checks.some((c) => c.status === "unknown") ? "unknown" : o.checks.some((c) => c.status === "unconfirmed") ? "unconfirmed" : "ok";
  const total = (o: OptionResult) => (o.calc ? o.calc.max : Number.POSITIVE_INFINITY);
  const surviving = opts.filter((o) => statusOf(o) !== "violated");
  const rank = (a: OptionResult, b: OptionResult) => { const tier = (o: OptionResult) => ({ ok: 0, unconfirmed: 1, unknown: 2, violated: 3 }[statusOf(o)]); return tier(a) - tier(b) || total(a) - total(b) || String(a.availability?.date ?? "9").localeCompare(String(b.availability?.date ?? "9")); };
  if (!surviving.length) {
    const best = [...opts].sort((a, b) => total(a) - total(b))[0];
    return none("none_fits", `No option meets ${basis.join(" and ")}.`, { basis, tradeoff: opts.map((o) => `${o.label}: ${o.checks.filter((c) => c.status === "violated").map((c) => c.detail).join("; ")}`), nextAction: { kind: "none", text: `The closest is ${best.label}. Decide whether to raise the limit or ask for a lower quote.` }, option: best.option, label: best.label });
  }
  const ranked = [...surviving].sort(rank); const top = ranked[0];
  // Could a missing input flip the choice? An option with an unknown component whose known part already beats the leader.
  const flippers = ranked.slice(1).filter((o) => o.calc && o.calc.unknown.length && o.calc.min < total(top) && top.calc);
  const topUnknown = top.calc?.unknown.length ? top.calc.unknown : [];
  if (topUnknown.length || flippers.length) {
    const who = topUnknown.length ? top : flippers[0]; const u = who.calc!.unknown[0];
    const breakEven = who === top ? null : total(top) - who.calc!.min;
    const q = who === top ? `How much is the ${u.name} for ${who.label}? It is not in the quote, so its total is not confirmed.` : `How much is the ${u.name} for ${who.label}? ${breakEven != null && breakEven > 0 ? `If it is under ${fmtMoney(breakEven, who.calc!.currency)}, ${who.label} would beat ${top.label}.` : ""}`.trim();
    return { kind: "ask", option: top.option, label: top.label, headline: `On the evidence so far ${top.label} leads${top.calc ? ` at ${money(top.calc, top.calc.max)}` : ""}, but one missing amount could change that.`, tradeoff: ranked.map((o) => describe(o)), question: q, nextAction: { kind: "ask_missing", option: who.option, text: q }, basis, qualifiers: ["Provisional until that amount is known."] };
  }
  const qualifiers: string[] = [];
  const knownKinds = new Set(constraints.map((c) => c.kind));
  if (knownKinds.size === 1 && knownKinds.has("budget_max")) qualifiers.push("This applies only to your budget. No other requirement of yours was found in the sources.");
  const unconfirmed = top.checks.filter((c) => c.status === "unconfirmed");
  for (const u of unconfirmed) qualifiers.push(`Completion before ${fmtDate((u.constraint as Constraint).date!)} is unconfirmed: ${top.label} ${u.detail}.`);
  const others = opts.filter((o) => o !== top).sort((a, b) => total(a) - total(b)).map((o) => compareTo(top, o));
  const budgetCheck = top.checks.find((c) => c.constraint.kind === "budget_max");
  const incl = top.calc?.includedNote.length ? ` (the ${top.calc.includedNote.join(" and ")} included)` : "";
  const headline = `${top.label} fits best${budget ? " on your stated budget" : ""}: ${top.calc ? `${money(top.calc, top.calc.max)}${incl}` : "the strongest on the evidence"}${budgetCheck?.status === "ok" ? `, ${budgetCheck.detail}` : ""}.`;
  const confirm = unconfirmed[0];
  const nextAction: Rec["nextAction"] = confirm ? { kind: "confirm_completion", option: top.option, text: `Ask ${top.label} to confirm the work will be finished before ${fmtDate((confirm.constraint as Constraint).date!)}.` } : { kind: "none", text: `Nothing is blocking ${top.label} on the evidence found.` };
  void currency;
  return { kind: knownKinds.size === 1 ? "provisional" : "recommend", option: top.option, label: top.label, headline, tradeoff: [describe(top), ...others], question: null, nextAction, basis, qualifiers };
}
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
function describe(o: OptionResult): string {
  const c = o.calc; const parts: string[] = [];
  if (c) parts.push(`${o.label}: ${money(c, c.max)}${c.min !== c.max ? ` (range ${fmtMoney(c.min, c.currency)} to ${fmtMoney(c.max, c.currency)})` : ""}${c.unknown.length ? `, plus ${c.unknown.map((u) => u.name).join(" and ")} (amount not stated)` : ""}${c.includedNote.length ? `, with the ${c.includedNote.join(" and ")} included` : ""}`);
  else parts.push(o.label);
  const detail = o.checks.map((k) => cap1(k.detail)).join(". ");
  return `${parts.join("")}${detail ? `. ${detail}` : ""}`;
}
function compareTo(top: OptionResult, o: OptionResult): string {
  if (!top.calc || !o.calc || top.calc.currency !== o.calc.currency) return describe(o);
  const diff = o.calc.max - top.calc.max;
  const rel = diff > 0 ? `about ${fmtMoney(diff, o.calc.currency)} more than ${top.label}` : diff < 0 ? `${fmtMoney(-diff, o.calc.currency)} less than ${top.label}` : `the same as ${top.label}`;
  const prior = o.history.find((h) => h.role === "base" || h.role === "total");
  const checks = o.checks.filter((c) => c.constraint.kind === "budget_max").map((c) => c.detail).join("; ");
  return `${o.label}: ${money(o.calc, o.calc.max)}, ${rel}${checks ? `; ${checks}` : ""}${o.calc.unknown.length ? `; ${o.calc.unknown.map((u) => u.name).join(" and ")} amount not stated` : ""}${prior?.money ? ` (its earlier quote of ${fmtMoney(prior.money.minor, o.calc.currency)} was replaced)` : ""}.`;
}
export { fmtDate, parseMonthDay };

const OWN_KINDS = new Set(["note", "claude", "export"]);
/** Adapt an authorized evidence item (body and facts) to the engine's input. Sentences carry their offsets so each term can point at its quote. */
export function itemInFrom(it: { id: string; title: string; kind: string; at: string; revision: number; author: string | null; sourceLabel: string; mode: string; body: string; facts: { id: string; kind: string; value: string | null; quote: string; start: number; end: number }[] }): ItemIn {
  const sentences: { text: string; start: number; end: number }[] = []; let cur = 0;
  for (const line of it.body.split("\n")) { const ls = it.body.indexOf(line, cur); cur = ls + line.length; let sc = 0; for (const s of splitSentences(line)) { const i = line.indexOf(s, sc); if (i < 0) continue; sc = i + s.length; sentences.push({ text: s, start: ls + i, end: ls + i + s.length }); } }
  return { itemId: it.id, revision: it.revision, title: it.title, kind: it.kind, at: it.at, author: it.author, sourceLabel: it.sourceLabel, mode: it.mode, facts: it.facts.map((f) => ({ ...f, itemId: it.id, revision: it.revision, title: it.title, kind: f.kind, at: it.at, author: it.author, sourceLabel: it.sourceLabel, mode: it.mode })), sentences, ownerAuthored: OWN_KINDS.has(it.kind) || !it.author };
}
