import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { memCtx } from "./helpers";
import { assertSafeUrl, saveFeed, readFeed, blackboardStatus, parseFeed, SOURCE_LABEL, removeFeed } from "@/lib/blackboard";
import { listSources, searchEvidence, tokens } from "@/lib/evidence";
import { submitGoal, resultView } from "@/lib/assistant";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { all, get, setSetting } from "@/lib/db";

// The protocol is verified against a local HTTP server that behaves like Blackboard's calendar feed. The owner's real account is a separate step.
const ics = (events: { uid: string; summary: string; start: string; desc?: string; status?: string; allDay?: boolean }[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap((e) => ["BEGIN:VEVENT", `UID:${e.uid}`, `SUMMARY:${e.summary}`, e.allDay ? `DTSTART;VALUE=DATE:${e.start}` : `DTSTART;TZID=America/New_York:${e.start}`, `LAST-MODIFIED:20261114T150000Z`, ...(e.desc ? [`DESCRIPTION:${e.desc}`] : []), ...(e.status ? [`STATUS:${e.status}`] : []), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
let state: { status: number; body: string; etag: string; headers: Record<string, string> } = { status: 200, body: "", etag: '"v1"', headers: {} }; const seen: Record<string, string | undefined>[] = [];
let server: http.Server; let url = "";
beforeAll(async () => { process.env.JARVIS_ALLOW_LOCAL_FEEDS = "1"; server = http.createServer((req, res) => { seen.push({ inm: req.headers["if-none-match"] as string | undefined, ua: req.headers["user-agent"] as string | undefined }); if (state.status === 200 && req.headers["if-none-match"] === state.etag) { res.writeHead(304); return res.end(); } res.writeHead(state.status, { "content-type": state.body.startsWith("<") ? "text/html" : "text/calendar", etag: state.etag, ...state.headers }); res.end(state.body); }); await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); url = `http://127.0.0.1:${(server.address() as any).port}/webapps/calendar/feed/SECRET-TOKEN-abc123`; });
afterAll(() => { server.close(); delete process.env.JARVIS_ALLOW_LOCAL_FEEDS; });
const V1 = () => ({ status: 200, etag: '"v1"', headers: {}, body: ics([{ uid: "a1", summary: "Design Memo due", start: "20261119T170000", desc: "Submit the memo. Rubric posted on the course site." }, { uid: "a2", summary: "Studio critique", start: "20261117T110000" }]) });
const fresh = () => memCtx("2026-11-16T10:00:00-05:00");

describe("Blackboard calendar feed: setup and safety", () => {
  it("refuses unsafe addresses unless local feeds are explicitly allowed", async () => {
    delete process.env.JARVIS_ALLOW_LOCAL_FEEDS;
    for (const bad of ["http://example.com/f.ics", "https://127.0.0.1/f.ics", "https://localhost/f", "https://user:pw@example.com/f", "not a url", "https://192.168.0.5/x"]) await expect(assertSafeUrl(bad)).rejects.toThrow();
    process.env.JARVIS_ALLOW_LOCAL_FEEDS = "1";
  });
  it("the setup check reads without saving, and a saved link alone is never 'connected'", async () => {
    state = V1(); const ctx = fresh();
    const c = await readFeed(ctx, { dryRun: true, url }); expect(c).toMatchObject({ ok: true, events: 2 }); expect(c.message).toMatch(/does not include rubrics/);
    expect(blackboardStatus(ctx)).toMatchObject({ configured: false, connected: false }); expect(all(ctx.db, "SELECT COUNT(*) n FROM evidence_items")[0].n).toBe(0);
    setSetting(ctx.db, "blackboard_feed", { url, savedAt: "x" });                                           // configuration exists, nothing has been read
    expect(blackboardStatus(ctx)).toMatchObject({ configured: true, connected: false, mode: "unavailable" });
  });
  it("saving reads it once, becomes connected only after that read, and the link never leaks", async () => {
    state = V1(); const ctx = fresh(); const r = await saveFeed(ctx, url);
    expect(r).toMatchObject({ saved: true, read: { ok: true, created: 2 } });
    const st = blackboardStatus(ctx); expect(st).toMatchObject({ connected: true, mode: "live", items: 2, state: "ok" }); expect(st.lastSuccessAt).toBeTruthy(); expect(st.ownerAccount).toMatch(/pending/);
    expect(JSON.stringify([st, all(ctx.db, "SELECT * FROM activity"), all(ctx.db, "SELECT * FROM evidence_sources")])).not.toContain("SECRET-TOKEN-abc123"); expect(st.linkHint).toMatch(/…c123$/);
    expect(listSources(ctx).find((s) => s.label === SOURCE_LABEL)).toMatchObject({ mode: "live", kind: "calendar" });
    expect(removeFeed(ctx)).toEqual({ ok: true }); expect(blackboardStatus(ctx).configured).toBe(false);
  });
});

describe("Blackboard calendar feed: reading changes", () => {
  it("a conditional request that returns 304 changes nothing, and a moved deadline becomes revision 2 that the brief reports", async () => {
    state = V1(); const ctx = fresh(); await saveFeed(ctx, url);
    const same = await readFeed(ctx); expect(same).toMatchObject({ ok: true, kind: "unchanged" }); expect(seen.at(-1)!.inm).toBe('"v1"'); expect(seen.at(-1)!.ua).toMatch(/read-only/);
    expect(all(ctx.db, "SELECT MAX(revision) r FROM evidence_items")[0].r).toBe(1);
    state = { ...V1(), etag: '"v2"', body: ics([{ uid: "a1", summary: "Design Memo due", start: "20261120T170000", desc: "Submit the memo. Rubric posted on the course site." }, { uid: "a2", summary: "Studio critique", start: "20261117T110000" }]) };
    const moved = await readFeed(ctx); expect(moved).toMatchObject({ ok: true, changed: 1, created: 0 });
    const it = get(ctx.db, "SELECT id, revision FROM evidence_items WHERE title='Design Memo due'")!; expect(it.revision).toBe(2);
    expect(searchEvidence(ctx, tokens("design memo due"), { limit: 3 })[0].facts.some((f: any) => f.kind === "date" && f.value === "2026-11-20")).toBe(true);
    const g = submitGoal(ctx, { text: "Get me ready for tomorrow", origin: "ask-text" }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
    const v: any = resultView(ctx, g.resultId); expect(v.body).toMatch(/Design Memo due: due date now Friday, Nov 20/); expect(v.sources.some((s: any) => s.role === "changed date" && /Blackboard calendar feed/.test(s.sourceLabel) && s.mode === "live")).toBe(true);
    expect(v.body).toMatch(/Studio critique/);
  });
  it("removed and cancelled events are not kept as current", async () => {
    state = V1(); const ctx = fresh(); await saveFeed(ctx, url);
    state = { ...V1(), etag: '"v3"', body: ics([{ uid: "a1", summary: "Design Memo due", start: "20261119T170000", status: "CANCELLED" }]) }; await readFeed(ctx);
    const rows = all(ctx.db, "SELECT title, body FROM evidence_items ORDER BY title"); expect(rows.find((r) => r.title === "Design Memo due")!.body).toMatch(/cancelled/i); expect(rows.find((r) => r.title === "Studio critique")!.body).toMatch(/no longer appears in the Blackboard feed/);
  });
  it("parses all-day events and unfolds long lines", () => {
    const f = parseFeed(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x", "SUMMARY:Reading week", "DTSTART;VALUE=DATE:20261123", "DESCRIPTION:A very long", "  description here", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
    expect(f.events[0]).toMatchObject({ summary: "Reading week", allDay: true, description: "A very long description here" });
  });
});

describe("Blackboard calendar feed: when it needs you, and when it comes back", () => {
  it("sign-in needed: honest state, one blocked job with the exact action, work still delivered partially, then resumed with a fresh link", async () => {
    state = V1(); const ctx = fresh(); await saveFeed(ctx, url);
    state = { status: 401, etag: '"x"', headers: {}, body: "no" };
    const bad = await readFeed(ctx); expect(bad).toMatchObject({ ok: false, kind: "needs_signin" }); expect(bad.message).toMatch(/sign in \(including Duo\)/);
    expect(blackboardStatus(ctx)).toMatchObject({ connected: false, state: "needs_signin" }); expect(blackboardStatus(ctx).lastSuccessAt).toBeTruthy();   // last good read is still shown, separately from the failure
    await readFeed(ctx); expect(all(ctx.db, "SELECT status FROM jobs WHERE kind='blackboard_signin'")).toEqual([{ status: "blocked" }]);                // one pending handoff, not two
    const g = submitGoal(ctx, { text: "Get me ready for tomorrow", origin: "ask-text" }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(1_000_000), leaseMs: 1000 });
    const v1: any = resultView(ctx, g.resultId); expect(v1.unavailable.map((u: any) => u.label)).toContain(SOURCE_LABEL); expect(v1.unavailable.find((u: any) => u.label === SOURCE_LABEL).message).toMatch(/Duo/); expect(v1.version).toBe(1);
    state = V1(); state.etag = '"fresh"'; const ok = await readFeed(ctx);
    expect(ok).toMatchObject({ ok: true }); expect(ok.resumed!.length).toBe(1); expect(blackboardStatus(ctx)).toMatchObject({ connected: true, state: "ok" });
    expect(all(ctx.db, "SELECT status FROM jobs WHERE kind='blackboard_signin'")).toEqual([{ status: "done" }]);
    await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock: () => new Date(2_000_000), leaseMs: 1000 });
    const v2: any = resultView(ctx, g.resultId); expect(v2.version).toBe(2); expect(v2.unavailable.map((u: any) => u.label)).not.toContain(SOURCE_LABEL);   // the same result link gained what was missing
  });
  it("a sign-in page, an expired link, a rate limit, a broken feed and an unreachable server each get a precise message and change nothing", async () => {
    state = V1(); const ctx = fresh(); await saveFeed(ctx, url); const before = all(ctx.db, "SELECT id, revision FROM evidence_items");
    state = { status: 200, etag: '"l"', headers: {}, body: "<html><body>Please sign in with Duo to continue</body></html>" }; expect(await readFeed(ctx)).toMatchObject({ kind: "needs_signin" });
    state = { status: 410, etag: '"g"', headers: {}, body: "" }; const exp = await readFeed(ctx); expect(exp).toMatchObject({ kind: "expired" }); expect(exp.message).toMatch(/fresh calendar link/);
    state = { status: 429, etag: '"r"', headers: { "retry-after": "1200" }, body: "" }; const rl = await readFeed(ctx); expect(rl).toMatchObject({ kind: "rate_limited", retryAfter: 1200 }); expect(blackboardStatus(ctx).state).toBe("stale");
    state = { status: 200, etag: '"j"', headers: {}, body: "just some text" }; expect(await readFeed(ctx)).toMatchObject({ kind: "unreadable" });
    server.close(); const un = await readFeed(ctx); expect(un).toMatchObject({ kind: "unreachable" }); expect(un.message).toMatch(/Nothing was changed/);
    expect(all(ctx.db, "SELECT id, revision FROM evidence_items")).toEqual(before);
    await new Promise<void>((r) => server.listen((new URL(url).port as any) * 1, "127.0.0.1", r));
  });
});
