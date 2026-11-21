// "Work out X and draft Y" is two outcomes with a dependency, not one deliverable. Each requested part is named, given a status, and
// checked against what the result actually contains: an answer that settled the question, a figure that was actually computed, a draft
// addressed to the person named that carries the verified figures. A result that is missing a part says so, part by part.
import { wordsOf } from "./plan";
import { columnMentions, coversMention } from "./ledger";

export type OutcomeKind = "answer" | "report" | "draft" | "table";
export interface TableWish { columns: string[]; rowUnit: string | null; excludeDone: boolean; form?: "table" | "checklist"; groupByOwner?: boolean; perPerson?: boolean; mentions?: string[]; numbered?: boolean; sortByDue?: boolean; person?: string | null; about?: string | null; autoDue?: boolean }
export interface Outcome { id: string; kind: OutcomeKind; text: string; recipient: string | null; table?: TableWish }
export interface OutcomeStatus extends Outcome { status: "done" | "partial" | "missing"; detail: string }
export type Completion = "complete" | "partial" | "incomplete";

const WRITE = "(?:draft|write|compose|prepare|put together|make|produce|create|give me|turn (?:it|this|that) into)";
const THING = "(?:reply|replies|note|email|message|follow[- ]?up|response|text|letter|invite|request|booking|confirmation|list|agenda|summary|checklist|schedule|timetable|plan|itinerary|outline|minutes|announcement|handout|table|reminder|update)";
const DRAFT = new RegExp(`\\b${WRITE}\\b[^.?!]{0,60}?\\b${THING}\\b|\\b(reply to|email|message)\\s+[A-Z]`, "i");
const ASK = /^(?:and\s+|also\s+|then\s+)?(?:can|could|will|would|is|are|does|do|did|should|which|who|when|where|what|how|why|whether)\b/i;
const REPORT = /^(?:and\s+|also\s+|then\s+)?(?:show|tell|list|give|work out|figure out|calculate|compute|find|report|explain|summari[sz]e|say|state|include|add)\b/i;
const NOT_NAMES = new Set("Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December I Jarvis The A An My Our".split(" "));

const TABLE_ASK = /^\s*(?:an?\s+|the\s+)?(?:simple\s+|quick\s+)?(?:[a-z]+\s+)?(?:table|spreadsheet)\b|\b(?:turn|put|convert|make|build|give me|produce|create|draft|write|prepare|show)\b[^.?!]{0,80}?\b(?:table|spreadsheet|grid)\b/i;
const CHECK_ASK = /\b(?:give me|make|turn|show|write|build|create|put|prepare|produce|list)\b[^.?!]{0,60}?\b(?:check-?list|bulleted list|bullet list|to-?do list|bullets)\b[^.?!]{0,80}\b(?:per|for each|by|each)\s+(?:person|owner|people|assignee)\b|\b(?:check-?list|bulleted list|to-?do list)\b[^.?!]{0,40}\b(?:what|who|open|still)\b/i;
const TABLE_MOD = /\b(?:rows?|columns?)\b|\bleave\b[^.?!]*\bout\b|\bexclude\b|\bonly (?:include|show|list)\b|\bskip\b/i;
const splitList = (t: string) => t.split(/\s*[,|]\s*(?:and\s+)?|\s+and\s+/i).map((x) => x.replace(/^(?:the|a|an)\s+/i, "").replace(/[.]+$/, "").trim()).filter(Boolean);

/** The parts of a request. A single-part request returns one outcome; the caller decides whether that is worth showing. */
const WORKSTATE = /\b(?:who(?:'s|\s+is|\s+are)?\s+(?:doing|owns|has|responsible|handling|in charge)|who owns what|who (?:prints|does|handles|makes|books|orders|writes|builds)\b|status board|status of (?:the )?(?:tasks?|work)|(?:status|task|progress|handoff|action)\s+(?:table|board|list|sheet|tracker|summary|items?)|action items?|what(?:'s|\s+is|\s+are)?\s+(?:left|remaining|outstanding|still (?:to do|open|needed|need))|what still needs|open (?:items|tasks)|to-?do list|task list|what (?:does|is|do) [A-ZÀ-ÝĀ-ſ][\wà-ÿĀ-ſ]+ (?:still )?(?:have to|need to|left to|doing|do)\b|what is left for\b|what is each person doing|one-line summary (?:per|for each)|summary (?:per|for each) (?:person|owner)|numbered list (?:by|of)\b|(?:a|an|the)?\s*(?:simple\s+)?(?:status\s+)?table\b)/i;
const COLNOUNS = /\b(task|owner|person|assignee|status|blocker|blocked by|next action|next step|due date|deadline|budget|cost|priority|phone number|email)\b/gi;
/** Column nouns in the order the request names them, when it names at least two. */
const columnNouns = (t: string) => { const out: string[] = []; for (const m of t.matchAll(COLNOUNS)) { const n = m[1].toLowerCase(); if (!out.includes(n)) out.push(n); } return out; };
export function parseOutcomes(request: string, o: { project?: boolean } = {}): Outcome[] {
  const out: Outcome[] = [];
  const sentences = request.split(/(?<=[.?!])\s+(?=[A-Za-z])/).map((x) => x.trim()).filter(Boolean);
  const clauses = sentences.flatMap((s) => s.split(/,?\s+and\s+(?=(?:show|draft|write|tell|list|give|prepare|also|then|reply|email|work out|figure out|calculate|what|how|when|which|where|can|could)\b)/i));
  let tableAt = clauses.findIndex((c) => TABLE_ASK.test(c) || CHECK_ASK.test(c)); const workState = tableAt < 0 && !!o.project && clauses.findIndex((c) => WORKSTATE.test(c)) >= 0; if (workState) tableAt = clauses.findIndex((c) => WORKSTATE.test(c));
  // A table is one outcome. The sentences that describe its rows, columns and exclusions belong to it and are not separate requests.
  let wish: TableWish | null = null; const consumed = new Set<number>();
  if (tableAt >= 0) {
    wish = { columns: [], rowUnit: null, excludeDone: false, form: (CHECK_ASK.test(clauses[tableAt]) || (workState && /\b(?:bullets?|bulleted|check-?list)\b/i.test(request))) && !/\btable\b/i.test(clauses[tableAt]) ? "checklist" : "table", mentions: columnMentions(request) }; wish.perPerson = (/\bone row per (?:person|owner)\b|\b(?:per|by|for each|each) (?:person|owner)\b|\bsummary (?:per|for each)\b|\bwhat is each person doing\b/i.test(request)) && wish.form === "table"; if (/\bnumbered list\b/i.test(request)) { wish.form = "checklist"; wish.numbered = true; wish.sortByDue = /\bby (?:deadline|due date|date)\b/i.test(request); } if (/\bone-line summary\b|\bsummary per\b/i.test(request) && !/\btable\b/i.test(request)) wish.perPerson = true; const pm = /\bwhat (?:does|is|do) ([A-ZÀ-ÝĀ-ſ][a-zà-ÿĀ-ſ]+) (?:still )?(?:have to|need to|left to|doing|do)\b|\bwhat(?:'s| is) left for ([A-ZÀ-Ý][a-zà-ÿ]+)\b|\b([A-ZÀ-Ý][a-zà-ÿ]+)['’]s (?:tasks|to-?do|open items)\b/.exec(request); if (pm) { wish.person = pm[1] ?? pm[2] ?? pm[3]; wish.form = "checklist"; wish.perPerson = false; } const am = /\bwho(?:'s| is| are)? (?:responsible|in charge|handling|doing) (?!what\b)(?:for |of )?(?:the )?([^?.]+?)\??$|\bwho (?:prints|does|handles|makes|books|orders|writes|builds) (?:the )?([^?.]+?)\??$/i.exec(request.trim()); if (am) { wish.about = (am[1] ?? am[2]).trim(); wish.form = "table"; } if (!wish.columns.length && /\bstatus (?:table|board|sheet|tracker)\b/i.test(request)) { wish.columns = ["task", "owner", "status"]; (wish as any).autoDue = true; } if (workState || !/\b(?:row|column)s?\b/i.test(request)) { const cl = clauses[tableAt]; const tailText = cl.includes(":") ? cl.slice(cl.lastIndexOf(":") + 1) : /\bwith\b/i.test(cl) ? cl.slice(cl.search(/\bwith\b/i)) : cl; const nouns = [...new Set(columnNouns(tailText.replace(/\b(?:one row )?(?:per|by|for each|each)\s+(?:person|owner|people|assignee)\b/gi, "")).map((x) => (x === "person" ? "owner" : x)))]; if (nouns.length >= 2 && nouns.some((x) => ["task","owner","person","assignee","status","blocker","blocked by","next action","next step"].includes(x))) wish.columns = nouns; } wish.groupByOwner = wish.form === "checklist" && /\b(?:per|for each|by|each)\s+(?:person|owner|people|assignee)\b/i.test(request); consumed.add(tableAt);
    clauses.forEach((c, i) => {
      if (i !== tableAt && !TABLE_MOD.test(c)) return; if (i !== tableAt) consumed.add(i);
      const cols = /\b(?:with|columns?(?:\s+for)?:?|showing|listing|including)\s+(.+?)[.?!]*$/i.exec(c); if (cols && (/\b(?:row|column)s?\b/i.test(c) || (i === tableAt && /\btable\b/i.test(c) && /\bwith\b/i.test(c) && !wish!.columns.length))) wish!.columns = splitList(cols[1].replace(/^columns?:?\s+/i, "").replace(/\s+for\s+(?:this|the|each|every)\s+[a-z ]+$/i, ""));
      const unit = /\b(?:each|every|per)\s+(.+?)\s+(?:one row|a row|its own row|gets|get)\b|\bone row (?:per|for each)\s+(.+?)(?:\s+with|[.,]|$)/i.exec(c); if (unit) wish!.rowUnit = (unit[1] ?? unit[2]).trim();
      if (/\bleave\s+(?:the\s+)?(?:completed|finished|done|closed)\b|\bexclude\s+(?:the\s+)?(?:completed|finished|done)\b|\bonly (?:include|show|list)\s+(?:the\s+)?(?:open|unfinished|incomplete)\b/i.test(c)) wish!.excludeDone = true;
    });
    if (workState || /\bopen\b|\bstill (?:need|to do|have to)|\bremaining\b|\boutstanding\b/i.test(clauses.filter((_, i) => consumed.has(i)).join(" ")) || wish.form === "checklist") wish.excludeDone = true;
  }
  clauses.forEach((raw, i) => {
    if (consumed.has(i) && i !== tableAt) return;
    const text = raw.replace(/^[\s,;]+|[\s]+$/g, "").replace(/^(?:please|then)\s+/i, ""); if (text.length < 4) return;
    if (i === tableAt && wish) { const cols = wish.columns.length ? wish.columns.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(", ") : "default columns"; out.push({ id: `o${out.length + 1}`, kind: "table", text: `${wish.form === "checklist" ? "A bulleted checklist" + (wish.groupByOwner ? " per person" : "") + " of open work" : "A pasteable table"}${wish.form === "checklist" ? "" : wish.rowUnit ? `: one row per ${wish.rowUnit}` : ""} ${wish.form === "checklist" ? "" : ` with ${cols}`}${wish.excludeDone ? "; completed work left out" : ""}`, recipient: null, table: wish }); return; }
    if (DRAFT.test(text)) { const m = /\b(?:to|for)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/.exec(text); const rec = m && !NOT_NAMES.has(m[1].split(" ")[0]) ? m[1] : null; out.push({ id: `o${out.length + 1}`, kind: "draft", text: text.replace(/[.?!]+$/, ""), recipient: rec }); }
    else if (/\?$/.test(text) || ASK.test(text)) out.push({ id: `o${out.length + 1}`, kind: "answer", text: text.replace(/[.?!]+$/, ""), recipient: null });
    else if (REPORT.test(text)) out.push({ id: `o${out.length + 1}`, kind: "report", text: text.replace(/[.?!]+$/, ""), recipient: null });
  });
  return out;
}

const UNSUPPORTED = "Not computed: Jarvis has no calculation for this kind of question yet. It can place people in rooms, schedule runs of a machine against a deadline, plan vehicle trips, and lay items out in a booked window. The sources are quoted in the answer.";
interface Content { tableReason?: string; body?: string; kind?: string; needsCalc?: boolean; analysis?: any; draft?: { to: string | null; subject?: string; body: string } | null; flags?: any[] }
const first = (s: string) => s.split(/\s+/)[0].toLowerCase();
const short = (s: string, n = 200) => { const t = s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim(); return t.length <= n ? t : `${t.slice(0, n).replace(/\s+\S*$/, "")}…`; };

/** Score each requested part against what the saved result actually contains. */
export function scoreOutcomes(outcomes: Outcome[], c: Content): OutcomeStatus[] {
  const a = c.analysis; const rec = a?.recommendation; const kind: string | null = rec?.kind ?? null;
  const settled = kind === "recommend" || kind === "provisional" || kind === "none_fits";
  const gap = (rec?.question as string | null) ?? null;
  return outcomes.map((o): OutcomeStatus => {
    if (o.kind === "answer") {
      if (!a && c.needsCalc) return { ...o, status: "missing", detail: UNSUPPORTED };
      if (!a) return { ...o, status: "partial", detail: "No figure could be computed from the sources, so this is answered only with what they quote." };
      if (settled) return { ...o, status: "done", detail: short(rec.headline) };
      if (kind === "ask") return { ...o, status: "partial", detail: `Leaning, but one input decides it: ${short(gap ?? rec.headline)}` };
      return { ...o, status: "missing", detail: `Not answered: ${short(gap ?? rec?.headline ?? "the inputs were not found in the sources")}` };
    }
    if (o.kind === "report") {
      if (a?.type === "table") return { ...o, status: "missing", detail: "This is not part of the table and no note states it, so it was not made up." };
      const figs: { label: string; value: string }[] = a?.figures ?? [];
      const want = wordsOf(o.text.replace(/-/g, " ")); const hit = figs.map((f) => ({ f, n: wordsOf(f.label).filter((w) => want.includes(w)).length })).sort((x, y) => y.n - x.n)[0];
      if (hit && hit.n >= 2) return { ...o, status: "done", detail: `${hit.f.label}: ${short(hit.f.value, 120)}` };
      if (a && settled && !figs.length) return { ...o, status: "done", detail: "Shown in the calculation." };
      if (a && figs.length) return { ...o, status: "partial", detail: `The calculation did not produce this exact figure. It produced: ${figs.slice(0, 3).map((f) => `${f.label}: ${short(f.value, 60)}`).join("; ")}.` };
      return { ...o, status: "missing", detail: !a && c.needsCalc ? UNSUPPORTED : `Not computed${gap ? `: ${short(gap)}` : ": the sources do not hold the inputs it needs."}` };
    }
    if (o.kind === "table") return scoreTable(o, c);
    // A draft is only done when it exists, goes to the person named, and carries the verified figures. A template is not a draft of this request.
    const d = c.draft ?? (c.kind === "draft" && c.body ? { to: /^\*\*To:\*\*\s*(.+)$/m.exec(c.body)?.[1]?.replace(/\(.*\)/, "").trim() || null, body: c.body } : null);
    if (!d) return { ...o, status: "missing", detail: !a && c.needsCalc ? "Not produced: it depends on a calculation that could not be done." : a && !settled ? `Not drafted: it depends on the answer above, which is incomplete${gap ? ` (${short(gap, 120)})` : ""}.` : "No draft was produced." };
    const probs: string[] = [];
    if (o.recipient && !(d.to && first(d.to) === first(o.recipient))) probs.push(`it is addressed to ${d.to ?? "no one"}, not ${o.recipient}`);
    const keys: string[] = (a?.keyFigures ?? []).filter(Boolean); const miss = keys.filter((k) => !d.body.includes(k));
    if (keys.length && miss.length) probs.push(`it does not carry the verified figure${miss.length === 1 ? "" : "s"} ${miss.join(", ")}`);
    if (a && !settled) return { ...o, status: "partial", detail: `This asks for the missing input instead of giving the reply you asked for, because ${short(gap ?? "the answer is incomplete", 140)}` };
    if (probs.length) return { ...o, status: "partial", detail: `A draft exists, but ${probs.join(" and ")}.` };
    return { ...o, status: "done", detail: `Editable draft to ${d.to ?? "(choose a recipient)"}${keys.length ? `, using ${keys.slice(0, 3).join(", ")}` : ""}. Nothing was sent.` };
  });
}
export function completionOf(s: OutcomeStatus[]): Completion { if (!s.length) return "complete"; if (s.every((x) => x.status === "done")) return "complete"; return s.some((x) => x.status !== "missing") ? "partial" : "incomplete"; }
export const completionLine = (s: OutcomeStatus[]) => { const done = s.filter((x) => x.status === "done").length, part = s.filter((x) => x.status === "partial").length; return `${done} of ${s.length} requested parts done${part ? `, ${part} partly done` : ""}`; };

/** A table is done only when the saved artifact has the requested columns, a cited row for every open item, nothing that was asked to be left out, and no empty column. */
function scoreTable(o: Outcome, c: Content): OutcomeStatus {
  const t = c.analysis; const wish = o.table; const what = wish?.form === "checklist" ? "checklist" : "table";
  if (!t || t.type !== "table") return { ...o, status: "missing", detail: c.tableReason ?? `No ${what} could be built: Jarvis found no tasks with owners in the notes. Nothing was invented.` };
  const probs: string[] = [];
  if (t.unparsed?.length) probs.push(`${t.unparsed.length} sentence${t.unparsed.length === 1 ? "" : "s"} naming a person or task could not be read and ${t.unparsed.length === 1 ? "was" : "were"} not applied`);
  if (!t.rows.length) {
    if (t.filtered && !probs.length) return wish?.person ? { ...o, status: "done", detail: `No open task for ${t.filtered} in the notes.` } : { ...o, status: "missing", detail: `No task about “${t.filtered}” could be found in the notes.` };
    if (t.taskCount > 0 && t.openCount === 0 && !probs.length) return { ...o, status: "done", detail: `No open tasks: all ${t.taskCount} task${t.taskCount === 1 ? "" : "s"} in the notes are complete, so the ${what} has no rows.` };
    return { ...o, status: probs.length ? "partial" : "missing", detail: probs.length ? `No ${what} rows: ${probs.join("; ")}.` : `The notes hold no open tasks, so the ${what} has no rows.` };
  }
  if (what === "table") {
    const want = (wish?.columns.length ? wish.columns : t.columns).map((x: string) => x.toLowerCase()); const have: string[] = t.columns.map((x: string) => x.toLowerCase());
    const wantFull = t.addedTaskColumn ? ["task", ...want] : want;
    if (wantFull.join("|") !== have.join("|")) probs.push(`the columns are ${t.columns.join(", ")}, not the ${want.join(", ")} you asked for`);
    for (const m of wish?.mentions ?? []) if (!coversMention(m, t.keys, t.columns)) probs.push(`your request mentions ${m} but no column covers it`);
  }
  const uncited = t.rows.filter((r: any) => !r.cites?.length || r.cites.some((x: any) => !x.quote)); if (uncited.length) probs.push(`${uncited.length} ${what === "table" ? "row" : "item"}${uncited.length === 1 ? "" : "s"} without a cited source`);
  if (wish?.excludeDone) { const leaked = t.rows.filter((r: any) => (t.leftOut ?? []).some((l: any) => (l.reason === "complete" || l.reason === "cancelled") && l.text.toLowerCase() === String(r.task).toLowerCase())); if (leaked.length) probs.push("a completed item is in a row"); if (t.rows.length !== t.openCount) probs.push(`${t.rows.length} rows for ${t.openCount} open items`); }
  if (t.missingColumns?.length) probs.push(`no source states ${t.missingColumns.join(", ")}, so those cells say “Not stated”`);
  if (probs.length) return { ...o, status: "partial", detail: `A ${what} was built, but ${probs.join("; ")}.` };
  const left = (t.leftOut ?? []).filter((l: any) => l.reason === "complete" || l.reason === "cancelled").length;
  return { ...o, status: "done", detail: `${what === "table" ? `Table with ${t.rows.length} row${t.rows.length === 1 ? "" : "s"} (${t.columns.join(", ")})` : `Checklist with ${t.rows.length} open item${t.rows.length === 1 ? "" : "s"}${wish?.groupByOwner ? " grouped by person" : ""}`}, every ${what === "table" ? "row" : "item"} cited${left ? `; ${left} completed or cancelled item${left === 1 ? "" : "s"} left out` : ""}.` };
}
