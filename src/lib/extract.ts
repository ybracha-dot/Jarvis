// Deterministic fact extraction. No model calls. Imported text is untrusted data: nothing here executes it.
import { zonedToUtc, DEFAULT_TZ, localDate, localHM } from "./time";

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const MON_ABBR = MONTHS.map((m) => m.slice(0, 3));

export interface DateMention {
  iso: string; localDate: string; localTime: string | null; timeAssumed: boolean; text: string; sentence: string;
}
export interface Req {
  kind: "bring_print" | "upload" | "sign" | "other";
  text: string; quote: string; mandatory: boolean; detail: { articles?: number[] };
}
export interface Waiver { kind: "bring_print"; quote: string }
export interface TaskRef { externalId: string; label: string }
export interface Facts {
  taskRefs: TaskRef[];
  dueMention: DateMention | null;
  changeLanguage: boolean;
  requirements: Req[];
  waivers: Waiver[];
  ambiguous: boolean;
}

export function splitSentences(text: string): string[] {
  const protectedText = text
    .replace(/\b([ap])\.m\./gi, "$1\u0001m.")
    .replace(/\b(e\.g|i\.e|etc|vs|dr|prof)\./gi, (m) => m.replace(/\./g, "\u0001"));
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n+/)
    .map((s) => s.replace(/\u0001/g, ".").trim())
    .filter(Boolean);
}

const DATE_RE = new RegExp(
  String.raw`(?:(?:mon|tues?|wednes|thurs?|fri|satur|sun)(?:day)?\.?,?\s+)?` +
  String.raw`\b(${MONTHS.join("|")}|${MON_ABBR.join("|")})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?` +
  String.raw`(?:\s*(?:,|at|by|before|@)?\s*(?:(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|(noon)|(midnight)))?`,
  "ig",
);

export function findDates(text: string, publishedAt: string, tz = DEFAULT_TZ, fallbackTime?: string | null): DateMention[] {
  const out: DateMention[] = [];
  const pubY = Number(localDate(publishedAt, tz).slice(0, 4));
  const pubMs = new Date(publishedAt).getTime();
  for (const sentence of splitSentences(text)) {
    const protectedS = sentence;
    DATE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DATE_RE.exec(protectedS))) {
      let mi = MONTHS.indexOf(m[1].toLowerCase());
      if (mi < 0) mi = MON_ABBR.indexOf(m[1].toLowerCase().slice(0, 3));
      if (mi < 0) continue;
      const day = Number(m[2]);
      if (day < 1 || day > 31) continue;
      let year = m[3] ? Number(m[3]) : pubY;
      let h: number, min: number, assumed = false;
      if (m[7]) { h = 12; min = 0; }
      else if (m[8]) { h = 0; min = 0; }
      else if (m[4]) {
        h = Number(m[4]) % 12; min = m[5] ? Number(m[5]) : 0;
        if (/^p/i.test(m[6])) h += 12;
      } else {
        assumed = true;
        const [fh, fm] = (fallbackTime ?? "23:59").split(":").map(Number);
        h = fh; min = fm;
      }
      let d = zonedToUtc(year, mi + 1, day, h, min, tz);
      // Year inference: a date months before the publication date belongs to the next year.
      if (!m[3] && d.getTime() < pubMs - 60 * 86400000) d = zonedToUtc(++year, mi + 1, day, h, min, tz);
      out.push({
        iso: d.toISOString(), localDate: localDate(d, tz), localTime: assumed ? null : localHM(d, tz), timeAssumed: assumed,
        text: m[0].trim(), sentence,
      });
    }
  }
  return out;
}

const TASK_RE = /\b(essay|exam|quiz|midterm|final|paper|project|problem set|pset|lab|homework|hw|assignment|memo|case)\s*#?\s*(\d+)?\b/gi;
export function findTaskRefs(text: string): TaskRef[] {
  const seen = new Map<string, TaskRef>();
  let m: RegExpExecArray | null;
  TASK_RE.lastIndex = 0;
  while ((m = TASK_RE.exec(text))) {
    const word = m[1].toLowerCase().replace(/\s+/g, "-").replace("pset", "problem-set").replace(/^hw$/, "homework");
    const id = m[2] ? `${word}-${Number(m[2])}` : word;
    if (!seen.has(id)) seen.set(id, { externalId: id, label: m[0].trim() });
  }
  return [...seen.values()];
}

const CHANGE_RE = /\b(now due|is now|moved|moves|moving|extended|extension|postponed|rescheduled|changed to|pushed|brought forward|new deadline|due date (?:has )?(?:been )?changed|instead)\b/i;
const WAIVE_RE = /\b(no longer (?:need|required|have|necessary)|do(?:es)? not need|don'?t need|waive[sd]?|not (?:be )?required|is (?:cancell?ed|dropped)|no need)\b/i;
const NEG_PAPER_RE = /\bno (?:paper|printed|hard)[ -]?copies\b|\bno printing\b|\bonline[- ]only\b/i;
const PRINT_RE = /\b(bring|print|printed|printout|hard ?copy|paper cop(?:y|ies))\b/i;
const OPTIONAL_RE = /\b(optional|if you (?:like|wish|want|prefer)|consider|may (?:want|choose|wish)|you can|suggest(?:ed)?|recommended|helpful to)\b/i;
const UPLOAD_RE = /\b(upload|submit(?:ted)?|turn in|hand in)\b[^.]*\b(blackboard|gradescope|portal|online|pdf|canvas|lms)\b/i;
const SIGN_RE = /\b(sign|signature|signed)\b[^.]*\b(form|waiver|sheet|slip)\b/i;

export function parseArticles(s: string): number[] {
  const m = /\barticles?\s+((?:\d+\s*(?:,\s*(?:and\s+)?|and\s+|&\s*|-\s*|to\s+)?)+)/i.exec(s);
  if (!m) return [];
  return [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0]));
}

export function extractFacts(text: string, publishedAt: string, tz = DEFAULT_TZ, fallbackTime?: string | null): Facts {
  const sentences = splitSentences(text);
  const dates = findDates(text, publishedAt, tz, fallbackTime);
  const dueDates = dates.filter((d) => /\b(due|deadline|submit|exam|midterm|quiz|moved|rescheduled|postponed|extended|on)\b/i.test(d.sentence));
  const dueMention = dueDates[0] ?? null;
  const requirements: Req[] = [];
  const waivers: Waiver[] = [];
  for (const s of sentences) {
    if (WAIVE_RE.test(s) && (PRINT_RE.test(s) || /\bprint/i.test(s))) { waivers.push({ kind: "bring_print", quote: s }); continue; }
    if (NEG_PAPER_RE.test(s)) { waivers.push({ kind: "bring_print", quote: s }); continue; }
    if (PRINT_RE.test(s) && /\b(excerpt|copy|copies|reading|article|packet|document|handout|draft|essay|text|pages?)\b/i.test(s)) {
      const mandatory = !OPTIONAL_RE.test(s);
      const articles = parseArticles(s);
      requirements.push({
        kind: "bring_print", mandatory, quote: s, detail: articles.length ? { articles } : {},
        text: `${mandatory ? "Bring" : "Optional: bring"} a printed copy${articles.length ? ` of articles ${articles.join(", ")}` : ""}`,
      });
      continue;
    }
    if (UPLOAD_RE.test(s)) requirements.push({ kind: "upload", mandatory: true, quote: s, detail: {}, text: "Upload to the course site" });
    else if (SIGN_RE.test(s)) requirements.push({ kind: "sign", mandatory: true, quote: s, detail: {}, text: "Sign the form" });
  }
  return {
    taskRefs: findTaskRefs(text),
    dueMention,
    changeLanguage: dueMention ? CHANGE_RE.test(dueMention.sentence) : false,
    requirements,
    waivers,
    ambiguous: /\bdue\b/i.test(text) && !dueMention,
  };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** "Friday" in a message published on a given date means the next such day on or after that date, in the user's zone. */
export function resolveWeekday(word: string, publishedAt: string, tz = DEFAULT_TZ): string | null {
  const i = WEEKDAYS.indexOf(word.toLowerCase());
  if (i < 0) return null;
  const d = localDate(publishedAt, tz);
  const cur = new Date(`${d}T00:00:00Z`).getUTCDay();
  const delta = (i - cur + 7) % 7;
  return new Date(Date.parse(`${d}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
}
