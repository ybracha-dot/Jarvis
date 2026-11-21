import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject, projectContext, applyProjectUpdate, editFact, undoEvent, forgetFact, resolveSuggestion, findProject, listProjects } from "@/lib/projects";
import { captureToJarvis, recallFromJarvis } from "@/lib/capture";
import { TOOLS } from "@/lib/agent";
import { all, get } from "@/lib/db";

const fresh = () => { const ctx = memCtx("2026-11-16T10:00:00-05:00"); createProject(ctx, { name: "Iceland trip", kind: "trip", aliases: ["Iceland"] }); return ctx; };
const up = (ctx: any, o: any) => applyProjectUpdate(ctx, { project: "Iceland trip", origin: "claude", client: "Claude", ...o }) as any;

describe("golden Iceland scenario", () => {
  it("keeps current decisions, open options and history apart, and answers 'what did we decide'", () => {
    const ctx = fresh();
    const r1 = up(ctx, { eventId: "evt-0001-a", changes: [{ op: "option", key: "lodging", text: "Reykjavik apartment" }, { op: "option", key: "lodging", text: "Vik guesthouse" }, { op: "decide", key: "dates", text: "June 12 to 19" }] });
    expect(r1).toMatchObject({ saved: true, replay: false, revision: 1, origin: "claude" });
    expect(r1.workspace.id).toMatch(/^ws_/);
    const r2 = up(ctx, { eventId: "evt-0002-a", expectedRevision: 1, changes: [{ op: "decide", key: "lodging", text: "Vik guesthouse" }, { op: "decide", key: "dates", text: "June 14 to 21" }] });
    expect(r2.revision).toBe(2);
    const c = projectContext(ctx, "Iceland");
    expect(c.current.map((f) => [f.key, f.text])).toEqual(expect.arrayContaining([["lodging", "Vik guesthouse"], ["dates", "June 14 to 21"]]));
    expect(c.options).toHaveLength(0);                                        // the decision settled the options
    expect(c.history.some((f) => f.text === "June 12 to 19" && f.status === "superseded")).toBe(true);
    expect(c.answer).toMatch(/June 14 to 21/); expect(c.answer.split("Earlier:")[0]).not.toMatch(/June 12 to 19/);
    expect(c.current.every((f) => f.origin && f.eventId && f.asOf)).toBe(true); // every fact cites origin, event and time
  });
  it("replays return the same receipt and write nothing; dedupKey collapses a different event id", () => {
    const ctx = fresh();
    const a = up(ctx, { eventId: "evt-1000-a", dedupKey: "msg-9", changes: [{ op: "fact", key: "flight", text: "Arrive 06:40" }] });
    const b = up(ctx, { eventId: "evt-1000-a", changes: [{ op: "fact", key: "flight", text: "Arrive 06:40" }] });
    const c = up(ctx, { eventId: "evt-1000-b", dedupKey: "msg-9", changes: [{ op: "fact", key: "flight", text: "Arrive 06:40" }] });
    expect(b).toMatchObject({ replay: true, revision: a.revision }); expect(c).toMatchObject({ replay: true, revision: a.revision });
    expect(get(ctx.db, "SELECT COUNT(*) n FROM project_facts")!.n).toBe(1);
  });
  it("an out-of-order older message never overwrites a newer decision", () => {
    const ctx = fresh();
    up(ctx, { eventId: "evt-2000-a", sentAt: "2026-11-16T12:00:00Z", changes: [{ op: "decide", key: "budget", text: "$4,000" }] });
    const late = up(ctx, { eventId: "evt-2000-b", sentAt: "2026-11-16T09:00:00Z", changes: [{ op: "decide", key: "budget", text: "$3,000" }] });
    expect(late.changes[0].note).toMatch(/out of order/);
    expect(projectContext(ctx, "Iceland").current.find((f) => f.key === "budget")!.text).toBe("$4,000");
  });
  it("a stale patch conflicts and returns current state; an unrelated key still saves", () => {
    const ctx = fresh();
    const r1 = up(ctx, { eventId: "evt-3000-a", changes: [{ op: "decide", key: "car", text: "4x4" }] });
    editFact(ctx, projectContext(ctx, "Iceland").current[0].id, "Small SUV", r1.revision);                    // you edit in Jarvis
    const stale = up(ctx, { eventId: "evt-3000-b", expectedRevision: r1.revision, changes: [{ op: "decide", key: "car", text: "Camper van" }] });
    expect(stale).toMatchObject({ saved: false, conflict: true, keys: ["car"] });
    expect(stale.current.current[0].text).toBe("Small SUV");
    expect(up(ctx, { eventId: "evt-3000-c", expectedRevision: r1.revision, changes: [{ op: "fact", key: "passport", text: "Valid to 2030" }] }).saved).toBe(true);
    expect(() => editFact(ctx, projectContext(ctx, "Iceland").current.find((f) => f.key === "car")!.id, "x", 0)).toThrow(/Someone changed|Reload/);
  });
  it("similar projects never cross-contaminate; ambiguous or unknown names are refused, never guessed", () => {
    const ctx = fresh(); createProject(ctx, { name: "Iceland Ring Road", kind: "trip" }); createProject(ctx, { name: "Iceland trip 2027", kind: "trip", aliases: ["Iceland"] });
    expect(() => findProject(ctx, "Iceland")).toThrow(/matches 2 projects/);
    up(ctx, { project: "iceland-trip", eventId: "evt-4000-a", changes: [{ op: "decide", key: "dates", text: "June 14 to 21" }] });
    expect(projectContext(ctx, "Iceland Ring Road").current).toHaveLength(0);
    expect(() => applyProjectUpdate(ctx, { project: "Norway", eventId: "evt-4000-b", origin: "claude", changes: [{ op: "fact", key: "x", text: "y" }] })).toThrow(/No project named/);
    expect(listProjects(ctx).length).toBe(3);
  });
  it("off the record saves nothing; tentative wording waits for confirmation; undo restores what was replaced", () => {
    const ctx = fresh();
    expect(up(ctx, { eventId: "evt-5000-a", offTheRecord: true, changes: [{ op: "fact", key: "secret", text: "x" }] })).toMatchObject({ saved: false });
    expect(get(ctx.db, "SELECT COUNT(*) n FROM project_facts")!.n).toBe(0);
    const t = up(ctx, { eventId: "evt-5000-b", changes: [{ op: "decide", key: "hotel", text: "Maybe the harbor hotel", tentative: true }] });
    expect(projectContext(ctx, "Iceland").current).toHaveLength(0);
    const sug = projectContext(ctx, "Iceland").suggestions[0]; expect(sug.text).toMatch(/harbor/);
    resolveSuggestion(ctx, sug.id, true); expect(projectContext(ctx, "Iceland").current[0].text).toMatch(/harbor/);
    up(ctx, { eventId: "evt-5000-c", changes: [{ op: "decide", key: "dates", text: "A" }] });
    const e = up(ctx, { eventId: "evt-5000-d", changes: [{ op: "decide", key: "dates", text: "B" }] });
    undoEvent(ctx, "evt-5000-d"); expect(projectContext(ctx, "Iceland").current.find((f) => f.key === "dates")!.text).toBe("A"); void t; void e;
  });
  it("forgetting erases the text everywhere it is served, including recall", () => {
    const ctx = fresh();
    up(ctx, { eventId: "evt-6000-a", changes: [{ op: "fact", key: "allergy", text: "Shellfish allergy" }] });
    expect(recallFromJarvis(ctx, "Shellfish").count).toBe(1);
    forgetFact(ctx, projectContext(ctx, "Iceland").current[0].id);
    expect(recallFromJarvis(ctx, "Shellfish").count).toBe(0);
    expect(JSON.stringify(projectContext(ctx, "Iceland"))).not.toMatch(/Shellfish/);
    expect(all(ctx.db, "SELECT text FROM project_facts").every((r) => !/Shellfish/.test(String(r.text)))).toBe(true);
  });
  it("a capture naming a project lands in that project and not in general memory", () => {
    const ctx = fresh();
    const r = captureToJarvis(ctx, { text: "Remember for Jarvis: Reykjavik restaurants need booking in advance", project: "Iceland trip", via: "test", synthetic: true });
    expect(r.project?.name).toBe("Iceland trip");
    const n = get(ctx.db, "SELECT scope, project_id FROM notes WHERE id=?", r.noteId!)!; expect(n.scope).toBe("project:iceland-trip"); expect(n.project_id).toBeTruthy();
    const miss = captureToJarvis(ctx, { text: "Remember for Jarvis: some other idea about cars", project: "Nowhere", via: "test", synthetic: true });
    expect(miss.message).toMatch(/No project named "Nowhere"/);
    expect(recallFromJarvis(ctx, "restaurants", { project: "Iceland trip" }).count).toBe(1);
  });
  it("the MCP tools exist, validate input, and round-trip", () => {
    const ctx = fresh();
    const get_ = TOOLS.find((t) => t.name === "get_project_context")!, set_ = TOOLS.find((t) => t.name === "apply_project_update")!;
    expect(set_.schema.safeParse({ project: "Iceland trip", eventId: "evt-7000-a", changes: [{ op: "bogus", key: "a", text: "b" }] }).success).toBe(false);
    const rc: any = set_.run(ctx, set_.schema.parse({ project: "Iceland trip", eventId: "evt-7000-b", changes: [{ op: "decide", key: "dates", text: "June 14 to 21" }] }));
    expect(rc.saved).toBe(true);
    expect((get_.run(ctx, { project: "Iceland trip" }) as any).project.revision).toBe(rc.revision);
    expect((get_.run(ctx, {}) as any).projects.length).toBe(1);
  });
});
