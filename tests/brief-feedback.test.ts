import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { all, get } from "@/lib/db";
import { importText } from "@/lib/evidence";
import { createProject } from "@/lib/projects";
import { buildBrief, runBrief, briefFeedback, briefToday, collectObligations, baseRequirement } from "@/lib/brief";
import { schedulerStatus } from "@/lib/scheduler";
import { rollback } from "@/lib/skills";
import { WORDING_SKILL, evaluateWording, casesFor, phraseFor, matchesPhrase, wordingState } from "@/lib/wording-skill";

const CLOCK = "2026-11-17T07:30:00-05:00";
const DUE = "Essay 2 outline is due Thursday, November 19 at 9:00 AM. Write a one-page outline.";
const ODD = "Update: outlines are expected on paper, stapled, at the start of class.";
function world() {
  const ctx = memCtx(CLOCK, "personal"); const essay = createProject(ctx, { name: "Essay 2", kind: "course" }); const maple = createProject(ctx, { name: "Maple Court", kind: "project" });
  const a = importText(ctx, { kind: "note", title: "Essay 2 outline", text: DUE, at: "2026-11-10T12:00:00.000Z", label: "Essay notes", projectId: essay.id });
  const odd = importText(ctx, { kind: "note", title: "Class update", text: ODD, at: "2026-11-16T23:00:00.000Z", label: "Essay notes", projectId: essay.id, corrects: a.id });
  return { ctx, essay, maple, a, odd };
}
const run1 = (ctx: any, k: string) => runBrief(ctx, { occurrenceKey: k, kind: "scheduled" });
const key = (ctx: any) => collectObligations(ctx).obligations.find((o) => /Essay 2/.test(o.title))!.key;

describe("feedback on the brief is tied to its source, its project and the brief it was given on", () => {
  it("useful and wrong record the exact sentence, the project, and the result; a wrong without a reason is refused", () => {
    const { ctx, essay } = world(); const first = run1(ctx, "morning:2026-11-16@08:00"); const k = key(ctx);
    const u = briefFeedback(ctx, { key: k, kind: "useful" });
    expect(u.receipt).toMatchObject({ obligation: "Essay 2 outline", project: "Essay 2", source: { title: expect.stringMatching(/Essay 2 outline|Class update/) }, result: { id: (first as any).resultId ?? expect.any(String) } });
    expect(() => briefFeedback(ctx, { key: k, kind: "wrong" })).toThrow(/Say what was wrong/);
    briefFeedback(ctx, { key: k, kind: "wrong", note: "the deadline is Friday, not Thursday" });
    const rows = all(ctx.db, "SELECT kind, item_id, project_id, quote, result_id, run_key FROM brief_feedback ORDER BY created_at, rowid") as any[];
    expect(rows.map((r) => r.kind)).toEqual(["useful", "wrong"]); expect(rows.every((r) => r.item_id && r.project_id === essay.id && r.quote && r.result_id && r.run_key === "morning:2026-11-16@08:00")).toBe(true);
    expect(get(ctx.db, "SELECT id FROM results WHERE id=?", rows[0].result_id)).toBeTruthy();                       // the result it was given on exists and is the one recorded
  });
  it("the next brief says why it changed, once, naming the sentence, the project and the earlier result; a correction after 'wrong' is acknowledged", () => {
    const { ctx } = world(); run1(ctx, "morning:2026-11-16@08:00"); const k = key(ctx); const at = (iso: string) => (ctx as any).setNow(iso);
    at("2026-11-17T07:35:00-05:00"); briefFeedback(ctx, { key: k, kind: "wrong", note: "the deadline is Friday" });
    let b = buildBrief(ctx, { occurrenceKey: "x1", kind: "ondemand" }).analysis; expect(b.because!.map((x) => x.kind)).toEqual(["wrong"]); expect(b.because![0].text).toMatch(/You said “Essay 2 outline” was wrong: “the deadline is Friday”.*project Essay 2/);
    expect(b.because![0].text).toMatch(/correct its deadline/);
    briefFeedback(ctx, { key: k, kind: "due", value: "2026-11-20T17:00:00-05:00", note: "from the announcement" });
    b = buildBrief(ctx, { occurrenceKey: "x2", kind: "ondemand" }).analysis; const w = b.because!.find((x) => x.kind === "wrong")!; expect(w.text).toMatch(/You then corrected it/); expect(b.because!.find((x) => x.kind === "due")!.text).toMatch(/Your date is used; the source's date is kept as history/);
    expect(b.because!.every((x) => x.resultHref && /^\/results\/res_/.test(x.resultHref))).toBe(true);
    at("2026-11-17T08:00:00-05:00"); run1(ctx, "morning:2026-11-17@08:00");                                        // that brief is saved: it explained it
    expect(buildBrief(ctx, { occurrenceKey: "x3", kind: "ondemand" }).analysis.because).toHaveLength(0);          // and the one after it does not repeat it
  });
});

describe("one narrow, repeatable skill from one demonstrated correction", () => {
  it("proposes the exact phrase, judges it on fixed cases including a different project, needs no new permission, and is not in force until approved", () => {
    const { ctx } = world(); run1(ctx, "morning:2026-11-16@08:00");
    const rv = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.review!.find((r) => /expected on paper/.test(r.sentence))!; expect(rv).toBeTruthy();
    const out = briefFeedback(ctx, { key: rv.key, kind: "req_add", value: rv.id }); const p = out.proposal!;
    expect(p).toMatchObject({ phrase: "expected on paper", status: "candidate", sameCapabilities: true, capabilities: ["read_sources"] });
    expect(p.eval.verdict).toBe("promote"); expect(p.eval.newCasePass).toBe(true); expect(p.eval.regressions).toEqual([]); expect(p.eval.falsePositives).toEqual([]); expect(p.eval.scores.baseline).toBeLessThan(p.eval.scores.candidate);
    expect(p.beforeAfter.map((x) => [x.before, x.after])).toEqual([["listed for your review, not counted", "counted as a requirement"], ["listed for your review, not counted", "counted as a requirement"]]);
    expect(p.beforeAfter[1].label).toMatch(/different project/);
    // not in force yet: another project's identical wording is still only listed for review
    const maple = ctx.db.prepare("SELECT id FROM projects WHERE name='Maple Court'").get() as any;
    importText(ctx, { kind: "note", title: "Maple Court posters", text: "Maple Court posters are due Friday, November 20 at 5:00 PM. Handouts are expected on paper.", at: "2026-11-16T12:00:00.000Z", label: "Maple notes", projectId: maple.id });
    const before = buildBrief(ctx, { occurrenceKey: "u", kind: "ondemand" }).analysis; expect(before.review!.some((r) => /Handouts are expected on paper/.test(r.sentence))).toBe(true);
    expect(wordingState(ctx, baseRequirement).proposals).toHaveLength(1); expect(wordingState(ctx, baseRequirement).active).toBeNull();
  });
  it("approving makes it apply in the other project too, never to questions, optional wording or waivers; rolling back restores the earlier behaviour", async () => {
    const { ctx } = world(); run1(ctx, "morning:2026-11-16@08:00");
    const rv = buildBrief(ctx, { occurrenceKey: "t", kind: "ondemand" }).analysis.review!.find((r) => /expected on paper/.test(r.sentence))!; const p = briefFeedback(ctx, { key: rv.key, kind: "req_add", value: rv.id }).proposal!;
    const maple = ctx.db.prepare("SELECT id FROM projects WHERE name='Maple Court'").get() as any;
    importText(ctx, { kind: "note", title: "Maple Court posters", text: "Maple Court posters are due Friday, November 20 at 5:00 PM. Handouts are expected on paper. Is it expected on paper? You may want to know that expected on paper is only a suggestion.", at: "2026-11-16T12:00:00.000Z", label: "Maple notes", projectId: maple.id });
    const { approveWording } = await import("@/lib/wording-skill"); approveWording(ctx, p.version);
    const after = buildBrief(ctx, { occurrenceKey: "v", kind: "ondemand" }).analysis; const maplePr = [...after.priorities].find((x) => /Maple Court posters/.test(x.title))!;
    expect(maplePr.requirements.map((r) => r.text)).toEqual(["Handouts are expected on paper"]); expect(after.review!.some((r) => /Handouts are expected on paper/.test(r.sentence))).toBe(false);
    expect(maplePr.evidence.some((e) => /your rule: “expected on paper”/.test(e.role))).toBe(true);
    expect(maplePr.requirements).toHaveLength(1);                                                                    // the question and the suggestion were not counted
    expect(wordingState(ctx, baseRequirement).active).toMatchObject({ rules: ["expected on paper"], canRollback: true });
    rollback(ctx, WORDING_SKILL);
    const back = buildBrief(ctx, { occurrenceKey: "w", kind: "ondemand" }).analysis; expect(back.priorities.find((x) => /Maple Court posters/.test(x.title))!.requirements).toHaveLength(0);
    expect(back.review!.some((r) => /Handouts are expected on paper/.test(r.sentence))).toBe(true);
    expect(all(ctx.db, "SELECT status FROM skills WHERE name=? ORDER BY version", WORDING_SKILL).map((r: any) => r.status)).toEqual(["active", "rolled_back"]);
  });
  it("a candidate that would change the capability list is quarantined, and the phrase must be narrow", () => {
    const cases = casesFor("expected on paper", ODD, "Essay 2"); const base = { name: WORDING_SKILL, version: 1, features: [], capabilities: ["read_sources"], trigger: "", instructions: "", exclusions: [] };
    const widened = { ...base, version: 2, features: ["phrase:expected on paper"], capabilities: ["read_sources", "send_email"] };
    expect(evaluateWording(base, widened, cases, baseRequirement).verdict).toBe("quarantine");
    expect(phraseFor("Everything is expected.", /\b(expected)\b/)).toBeNull();                                      // one common word is never a rule
    expect(matchesPhrase("Is it expected on paper?", ["expected on paper"])).toBeNull(); expect(matchesPhrase("Outlines are expected on paper.", ["expected on paper"])).toBe("expected on paper");
    // a loose candidate: a rule that is too broad fails its own false-positive cases
    const broad = { ...base, version: 3, features: ["phrase:expected"], capabilities: ["read_sources"] }; const ev = evaluateWording(base, broad, cases, baseRequirement);
    expect(ev.falsePositives.length).toBeGreaterThan(0); expect(ev.verdict).toBe("candidate");
  });
});
