// Import: parse first, preview, then commit through the normal ingestion pipeline. Imported content is untrusted data.
import { z } from "zod";
import { Parser } from "htmlparser2";
import { Ctx, all, get, run, tx, uid, sha } from "./db";
import { Bundle, importBundle, upsertCalendar } from "./bundle";
import { ingestRevision, IngestInput } from "./ingest";
import { HttpError } from "./decisions";
import { zonedToUtc, DEFAULT_TZ } from "./time";

export const MAX_BYTES = 2 * 1024 * 1024;

export interface CalEvent { title: string; start: string; end: string; uid: string; tz?: string }
export interface Preview {
  token: string; format: string; summary: string;
  items: { kind: "source" | "calendar" | "bundle"; label: string; detail: string }[];
  warnings: string[]; unsupported: string[]; needs: string[];
}
export interface Parsed { format: string; sources: IngestInput[]; calendar: CalEvent[]; bundle?: z.infer<typeof Bundle>; warnings: string[]; unsupported: string[]; needs: string[] }

export const ImportRequest = z.object({
  filename: z.string().min(1).max(200), content: z.string().max(MAX_BYTES * 1.4), encoding: z.enum(["utf8", "base64"]).default("utf8"),
  courseExternalId: z.string().max(100).optional(), kind: z.enum(["announcement", "syllabus", "email", "assignment", "reference", "receipt", "other"]).optional(),
  publishedAt: z.string().optional(), title: z.string().max(300).optional(),
});

// ---------- ICS ----------
export function parseIcs(text: string): { events: CalEvent[]; warnings: string[]; unsupported: string[] } {
  const warnings: string[] = [], unsupported: string[] = [];
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new HttpError(422, "Not a calendar file: no BEGIN:VCALENDAR found.");
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: CalEvent[] = []; const seen = new Set<string>();
  let cur: Record<string, { params: Record<string, string>; value: string }> | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; continue; }
    if (/^END:VEVENT/i.test(line) && cur) {
      const c = cur; cur = null;
      const title = (c.SUMMARY?.value ?? "(untitled)").replace(/\\,/g, ",").replace(/\\n/gi, " ");
      const uidv = c.UID?.value ?? sha(JSON.stringify(c)).slice(0, 16);
      if (seen.has(uidv)) { warnings.push(`Duplicate UID skipped: ${title}`); continue; }
      seen.add(uidv);
      if (c.RRULE) unsupported.push(`Recurring event "${title}" (RRULE). Only the first occurrence is imported.`);
      if (!c.DTSTART) { warnings.push(`"${title}" has no start. Skipped.`); continue; }
      const s = icsDate(c.DTSTART.value, c.DTSTART.params);
      if (s.error) { unsupported.push(`"${title}": ${s.error}`); continue; }
      if (s.allDay) { unsupported.push(`All-day event "${title}" is not imported as busy time.`); continue; }
      let end: Date;
      if (c.DTEND) { const e = icsDate(c.DTEND.value, c.DTEND.params); if (e.error || !e.date) { unsupported.push(`"${title}": ${e.error}`); continue; } end = e.date; }
      else if (c.DURATION) { const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(c.DURATION.value); end = new Date(s.date!.getTime() + (((Number(m?.[1] ?? 0)) * 60) + Number(m?.[2] ?? 0)) * 60000); }
      else end = new Date(s.date!.getTime() + 3600000);
      if (end <= s.date!) { warnings.push(`"${title}" ends before it starts. Skipped.`); continue; }
      events.push({ title, start: s.date!.toISOString(), end: end.toISOString(), uid: uidv, tz: c.DTSTART.params.TZID });
      continue;
    }
    if (!cur) continue;
    const m = /^([A-Za-z-]+)((?:;[^:]+)*):(.*)$/.exec(line);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (const p of m[2].split(";").filter(Boolean)) { const [k, v] = p.split("="); params[k.toUpperCase()] = v; }
    cur[m[1].toUpperCase()] = { params, value: m[3] };
  }
  return { events, warnings, unsupported };
}
function icsDate(v: string, params: Record<string, string>): { date?: Date; allDay?: boolean; error?: string } {
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) return { allDay: true };
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return { error: `Unreadable date "${v}"` };
  const [, y, mo, d, h, mi, , z] = m;
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)) };
  const tz = params.TZID ?? DEFAULT_TZ;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { return { error: `Unsupported time zone "${tz}". Use an IANA name such as America/New_York.` }; }
  return { date: zonedToUtc(+y, +mo, +d, +h, +mi, tz) };
}

// ---------- EML ----------
export function parseEml(text: string) {
  const norm = text.replace(/\r\n/g, "\n");
  const split = norm.indexOf("\n\n");
  if (split < 0 || !/^[A-Za-z-]+:/m.test(norm.slice(0, split))) throw new HttpError(422, "Not an email file: no headers found.");
  const headers = parseHeaders(norm.slice(0, split));
  const body = norm.slice(split + 2);
  const parts: { type: string; text: string; filename?: string }[] = [];
  collect(headers, body, parts);
  const plain = parts.find((p) => p.type === "text/plain" && !p.filename)?.text;
  const html = parts.find((p) => p.type === "text/html" && !p.filename)?.text;
  const attachments = parts.filter((p) => p.filename).map((p) => p.filename!);
  return { subject: decodeWords(headers.subject ?? "(no subject)"), from: decodeWords(headers.from ?? ""), date: headers.date ? new Date(headers.date) : null, messageId: headers["message-id"] ?? null, text: (plain ?? (html ? htmlToText(html) : "")).trim(), attachments, usedHtml: !plain && !!html };
}
function parseHeaders(block: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const l of block.replace(/\n[ \t]+/g, " ").split("\n")) { const m = /^([A-Za-z-]+):\s*(.*)$/.exec(l); if (m) h[m[1].toLowerCase()] = m[2]; }
  return h;
}
function decodeWords(s: string) { return s.replace(/=\?([\w-]+)\?([BQ])\?([^?]+)\?=/gi, (_m, _cs, enc, data) => enc.toUpperCase() === "B" ? Buffer.from(data, "base64").toString("utf8") : decodeQp(data.replace(/_/g, " "))); }
function decodeQp(s: string) { return Buffer.from(s.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"); }
function collect(h: Record<string, string>, body: string, out: { type: string; text: string; filename?: string }[]) {
  const ct = h["content-type"] ?? "text/plain";
  const type = ct.split(";")[0].trim().toLowerCase();
  const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  if (type.startsWith("multipart/") && boundary) {
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith("--")) break;
      const t = part.replace(/^\n/, ""); const i = t.indexOf("\n\n"); if (i < 0) continue;
      collect(parseHeaders(t.slice(0, i)), t.slice(i + 2), out);
    }
    return;
  }
  const cd = h["content-disposition"] ?? "";
  const filename = /filename\*?="?([^";]+)"?/i.exec(cd)?.[1] ?? /name="?([^";]+)"?/i.exec(ct)?.[1];
  const cte = (h["content-transfer-encoding"] ?? "").toLowerCase();
  let text = body;
  if (cte === "base64") text = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  else if (cte === "quoted-printable") text = decodeQp(body);
  out.push({ type, text: /^text\//.test(type) ? text : "", filename: filename || (/attachment/i.test(cd) ? "attachment" : undefined) });
}

// ---------- HTML ----------
export function htmlToText(html: string): string {
  let out = ""; let skip = 0;
  const p = new Parser({
    onopentag(n) { if (n === "script" || n === "style" || n === "noscript") skip++; if (/^(p|br|div|li|h\d|tr)$/.test(n)) out += "\n"; },
    onclosetag(n) { if (n === "script" || n === "style" || n === "noscript") skip--; },
    ontext(t) { if (!skip) out += t; },
  }, { decodeEntities: true });
  p.write(html); p.end();
  return out.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

// ---------- Dispatch ----------
export function parseUpload(ctx: Ctx, req: z.infer<typeof ImportRequest>): Parsed {
  const r = ImportRequest.parse(req);
  const buf = Buffer.from(r.content, r.encoding === "base64" ? "base64" : "utf8");
  if (buf.length > MAX_BYTES) throw new HttpError(413, `File is ${(buf.length / 1048576).toFixed(1)} MB. The limit is ${MAX_BYTES / 1048576} MB.`);
  if (buf.includes(0)) throw new HttpError(415, "Binary file. Export as text, Markdown, .ics, .eml or a JSON bundle.");
  const text = buf.toString("utf8");
  const ext = r.filename.toLowerCase().split(".").pop() ?? "";
  const out: Parsed = { format: ext, sources: [], calendar: [], warnings: [], unsupported: [], needs: [] };
  const published = r.publishedAt ?? ctx.now().toISOString();
  if (ext === "pdf" || text.startsWith("%PDF")) throw new HttpError(415, "PDF is not supported yet. Open it, copy the text, and import it as .txt or paste it. (No PDF parser is installed in this build.)");
  if (ext === "json") {
    let j: unknown; try { j = JSON.parse(text); } catch (e) { throw new HttpError(422, `Malformed JSON: ${(e as Error).message}`); }
    const b = Bundle.safeParse(j);
    if (!b.success) throw new HttpError(422, `Not a valid Jarvis source bundle: ${b.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    out.format = "json bundle"; out.bundle = b.data;
    if (b.data.mode === "example" && ctx.mode !== "demo") out.warnings.push("This bundle is marked as example data. Import it in the demo workspace.");
    return out;
  }
  if (ext === "ics") {
    const p = parseIcs(text); out.format = "calendar (.ics)"; out.calendar = p.events; out.warnings.push(...p.warnings); out.unsupported.push(...p.unsupported);
    if (!p.events.length) out.warnings.push("No importable events found.");
    return out;
  }
  if (ext === "eml") {
    const m = parseEml(text); out.format = "email (.eml)";
    if (m.attachments.length) out.unsupported.push(`Attachments not read: ${m.attachments.join(", ")}`);
    if (!m.text) throw new HttpError(422, "This email has no readable text part.");
    if (m.usedHtml) out.warnings.push("HTML-only email. Text was extracted and scripts were ignored.");
    const course = r.courseExternalId ?? courseFromText(ctx, `${m.subject} ${m.text.slice(0, 400)}`);
    if (!course) out.needs.push("courseExternalId");
    out.sources.push({ provider: "eml", externalId: m.messageId ?? `eml-${sha(text).slice(0, 12)}`, title: m.subject, courseExternalId: course ?? "", kind: r.kind === "announcement" || !r.kind ? "email" : r.kind, text: m.text, publishedAt: (m.date && !Number.isNaN(m.date.getTime()) ? m.date : new Date(published)).toISOString() });
    return out;
  }
  if (ext === "html" || ext === "htm") { out.format = "web page (.html)"; const t = htmlToText(text); if (!t) throw new HttpError(422, "No readable text in this page."); return textSource(ctx, out, r, t, published); }
  if (["md", "markdown", "txt", "text", ""].includes(ext)) { out.format = ext === "md" || ext === "markdown" ? "Markdown" : "plain text"; return textSource(ctx, out, r, text, published); }
  throw new HttpError(415, `Unsupported format ".${ext}". Supported: .json bundle, .ics, .eml, .md, .txt, .html. PDF is not supported yet.`);
}

function textSource(ctx: Ctx, out: Parsed, r: z.infer<typeof ImportRequest>, text: string, published: string): Parsed {
  if (!text.trim()) throw new HttpError(422, "The file is empty.");
  const course = r.courseExternalId ?? courseFromText(ctx, text.slice(0, 600));
  if (!course) out.needs.push("courseExternalId");
  out.sources.push({ provider: "import", externalId: `file-${sha(r.filename + text).slice(0, 14)}`, title: r.title ?? r.filename, courseExternalId: course ?? "", kind: r.kind ?? "announcement", text: text.slice(0, 200_000), publishedAt: new Date(published).toISOString() });
  return out;
}

export function courseFromText(ctx: Ctx, text: string): string | null {
  for (const c of all(ctx.db, "SELECT external_id, code FROM courses WHERE owner_id=?", ctx.owner)) if (new RegExp(`\\b${String(c.code).replace(/[^\w]/g, "")}\\b`, "i").test(text.replace(/[^\w]/g, " "))) return c.external_id as string;
  return null;
}

export function previewImport(ctx: Ctx, req: z.input<typeof ImportRequest>): Preview {
  const p = parseUpload(ctx, req as z.infer<typeof ImportRequest>);
  const items: Preview["items"] = [];
  for (const s of p.sources) items.push({ kind: "source", label: s.title, detail: `${s.kind} · ${s.text.slice(0, 160).replace(/\s+/g, " ")}${s.text.length > 160 ? "..." : ""}` });
  for (const e of p.calendar) items.push({ kind: "calendar", label: e.title, detail: `${e.start} to ${e.end}` });
  if (p.bundle) items.push({ kind: "bundle", label: `Bundle: ${p.bundle.assignment?.title ?? "no assignment"}`, detail: `${p.bundle.revisions.length} revisions, ${p.bundle.calendar.length} calendar events${p.bundle.promise ? ", 1 promise" : ""}${p.bundle.goal ? ", 1 goal" : ""}` });
  const token = uid("imp");
  run(ctx.db, "INSERT INTO import_previews(token,created_at,payload) VALUES(?,?,?)", token, ctx.now().toISOString(), JSON.stringify({ parsed: p, courseExternalId: (req as any).courseExternalId }));
  return { token, format: p.format, summary: `${items.length} item${items.length === 1 ? "" : "s"} ready`, items, warnings: p.warnings, unsupported: p.unsupported, needs: p.needs };
}

export function commitImport(ctx: Ctx, token: string, patch: { courseExternalId?: string } = {}) {
  const row = get(ctx.db, "SELECT * FROM import_previews WHERE token=?", token);
  if (!row) throw new HttpError(404, "Preview expired. Choose the file again.");
  const { parsed } = JSON.parse(row.payload as string) as { parsed: Parsed };
  return tx(ctx.db, () => {
    const applied = { sources: 0, duplicates: 0, unchanged: 0, calendarAdded: 0, calendarSeen: 0, decisions: 0, changes: [] as string[] };
    for (const s of parsed.sources) {
      const course = patch.courseExternalId || s.courseExternalId;
      if (!course) throw new HttpError(422, "Choose a course for this file before importing.");
      const r = ingestRevision(ctx, { ...s, courseExternalId: course });
      if (!r.newRevision) applied.unchanged++; else if (r.duplicateOf) applied.duplicates++; else applied.sources++;
      applied.decisions += r.decisionIds.length; applied.changes.push(...r.changes.map((c) => c.summary));
    }
    if (parsed.calendar.length) {
      const c = upsertCalendar(ctx, "ics", parsed.calendar, "Calendar file"); applied.calendarAdded += c.added; applied.calendarSeen += c.seen;
    }
    if (parsed.bundle) {
      const r = importBundle(ctx, parsed.bundle, { provider: parsed.bundle.mode === "example" ? "example-blackboard" : "json-bundle" });
      applied.sources += r.results.filter((x) => x.newRevision && !x.duplicateOf).length; applied.unchanged += r.results.filter((x) => !x.newRevision).length;
      applied.calendarAdded += r.calendarAdded; applied.calendarSeen += r.calendarSeen;
      applied.decisions += r.results.reduce((n, x) => n + x.decisionIds.length, 0);
      applied.changes.push(...r.results.flatMap((x) => x.changes.map((c) => c.summary)));
    }
    run(ctx.db, "DELETE FROM import_previews WHERE token=?", token);
    return applied;
  });
}
