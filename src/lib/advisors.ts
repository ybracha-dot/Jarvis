// Advisor library: user-selected, lawfully accessible primary sources. Short excerpts with locators. No scraping, no invented quotes.
import { z } from "zod";
import { Ctx, all, get, run, uid, sha } from "./db";
import { HttpError } from "./decisions";

export const RIGHTS = ["public-domain", "licensed", "user-notes", "fair-use-excerpt"] as const;
export const AdvisorSourceInput = z.object({
  title: z.string().min(1).max(200), speaker: z.string().min(1).max(120), published: z.string().max(40).optional(),
  url: z.string().url().refine((u) => /^https?:/.test(u), "http or https only").optional(), locator: z.string().max(80).optional(),
  rights: z.enum(RIGHTS), excerpt: z.string().min(10).max(1200),
});

export function addAdvisorSource(ctx: Ctx, raw: z.input<typeof AdvisorSourceInput>) {
  const i = AdvisorSourceInput.parse(raw);
  const hash = sha(`${i.speaker}|${i.excerpt.replace(/\s+/g, " ").trim()}`);
  if (get(ctx.db, "SELECT 1 x FROM advisor_sources WHERE hash=?", hash)) throw new HttpError(409, "Duplicate: this excerpt is already in the library.");
  const gaps = [!i.locator ? "No locator or timestamp, so the excerpt cannot be checked against the source." : null, !i.url ? "No URL." : null, !i.published ? "No date." : null].filter(Boolean);
  const id = uid("adv");
  run(ctx.db, "INSERT INTO advisor_sources(id,owner_id,title,speaker,published,url,locator,rights,excerpt,status,note,hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, ctx.owner, i.title, i.speaker, i.published ?? null, i.url ?? null, i.locator ?? null, i.rights, i.excerpt, gaps.length ? "gap" : "ok", gaps.join(" ") || null, hash, ctx.now().toISOString());
  return { id, status: gaps.length ? "gap" : "ok", gaps };
}
export const listAdvisorSources = (ctx: Ctx) => all(ctx.db, "SELECT * FROM advisor_sources WHERE owner_id=? ORDER BY created_at DESC", ctx.owner);
export function deleteAdvisorSource(ctx: Ctx, id: string) { run(ctx.db, "DELETE FROM advisor_sources WHERE id=? AND owner_id=?", id, ctx.owner); return { ok: true }; }

export interface Lens { id: string; name: string; principles: { id: string; text: string }[]; verifiedFor: string | null; note: string }
export const LENSES: Lens[] = [
  { id: "offer", name: "Offer design (generic)", verifiedFor: null, note: "Original sample material. Not attributed to any person.", principles: [
    { id: "outcome", text: "Name one concrete outcome the buyer wants, with a time frame." },
    { id: "risk", text: "Remove the buyer's biggest perceived risk with a specific guarantee or trial." },
    { id: "effort", text: "Reduce the effort and delay between purchase and first result." },
    { id: "test", text: "Test the offer with five real buyers before building more." }] },
  { id: "operator", name: "Operator", verifiedFor: null, note: "Original sample material.", principles: [
    { id: "dependency", text: "List what must be true for this to run without you." },
    { id: "cost", text: "Estimate the weekly hours and dollars to run it." }] },
  { id: "skeptic", name: "Skeptic", verifiedFor: null, note: "Original sample material.", principles: [
    { id: "assumption", text: "State the one assumption that, if false, kills the plan." },
    { id: "disconfirm", text: "Define the result that would make you stop." }] },
  { id: "hormozi", name: "Hormozi-inspired offer lens", verifiedFor: "Hormozi", note: "An analytical lens on published work, not the person. Needs imported sources to quote.", principles: [] },
];

export interface Turn { lens: string; segments: { label: "Direct quotation" | "Paraphrase" | "Jarvis application" | "Missing evidence"; text: string; source?: { title: string; locator: string | null; url: string | null } }[]; test: string }

/** Deterministic turn. Quotations come only from imported excerpts and carry their locator. */
export function advise(ctx: Ctx, lensId: string, question: string): Turn {
  const lens = LENSES.find((l) => l.id === lensId);
  if (!lens) throw new HttpError(404, "Unknown lens");
  const segs: Turn["segments"] = [];
  const sources = lens.verifiedFor ? all(ctx.db, "SELECT * FROM advisor_sources WHERE owner_id=? AND lower(speaker) LIKE ? AND status!='failed'", ctx.owner, `%${lens.verifiedFor.toLowerCase()}%`) : [];
  if (lens.verifiedFor && !sources.length) {
    segs.push({ label: "Missing evidence", text: `No verified ${lens.verifiedFor} sources are imported. Import a public interview, an authored article or your own notes in the Advisor library. Until then, use the generic offer lens.` });
    const g = LENSES[0];
    segs.push({ label: "Jarvis application", text: `Generic lens on "${question.slice(0, 120)}": ${g.principles[0].text}` });
    return { lens: lens.id, segments: segs, test: "Ask five target buyers to state the outcome they want in one sentence. Pass: at least three describe the same outcome." };
  }
  for (const s of sources.slice(0, 2)) segs.push({ label: "Direct quotation", text: `"${s.excerpt}"`, source: { title: s.title as string, locator: s.locator as string | null, url: s.url as string | null } });
  const ps = lens.principles.slice(0, 2);
  for (const p of ps) segs.push({ label: "Jarvis application", text: `${p.text} For "${question.slice(0, 120)}": write your answer as one sentence and one number.` });
  if (!sources.length) segs.push({ label: "Missing evidence", text: "These are original sample principles, not quotations from anyone." });
  return { lens: lens.id, segments: segs, test: ps[0]?.id === "test" || lens.id === "offer" ? "Pitch the offer to five real buyers. Pass: at least two ask how to start." : "Write the assumption on one line. Find one fact this week that could prove it false." };
}
