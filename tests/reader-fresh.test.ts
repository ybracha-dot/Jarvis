import { it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { submitGoal } from "@/lib/assistant";
import { issueReaderTask, submitReaderResult } from "@/lib/reader";

// A NEW project (different wording and numbers from the fixtures and from the quantity tests). Expectations were written before the first run:
//   R1 (cites the correction, "Purchase forty-eight folding chairs") ACCEPTED   R2 ("Buy 36 folding chairs", cites only the original) REJECTED: replaced by 48
//   R3 ("Print 60 menus", no count in the notes) REJECTED   R4 ("Print the menus") ACCEPTED   R5 ("Rent 2 marquees", the notes say "two marquees") ACCEPTED
//   R6 ("Buy 48 chairs for Mei Ling Tan" with Mei Ling's quote) REJECTED: the number is Yusuf's.
const ORIG = "Yusuf Demir is buying 36 folding chairs for the garden party. Mei Ling Tan will print the menus. Anika Roy has to rent two marquees.";
const FIX = "Yusuf Demir's chair purchase is raised to 48 folding chairs.";
// Each candidate is an independent first submission on its own copy of the project (a second submission on the same snapshot only tests duplicate handling:
// my first harness did that and masked five of the six results, so those were not counted).
async function fresh() {
  const ctx = memCtx("2026-11-21T12:00:00-05:00", "personal"); const proj = createProject(ctx, { name: "Garden party" });
  const a = importText(ctx, { kind: "note", projectId: proj.id, shareable: true, title: "Party plan", text: ORIG, at: "2026-11-20T12:00:00.000Z" }); importText(ctx, { kind: "note", projectId: proj.id, shareable: true, title: "Party update", text: FIX, at: "2026-11-21T09:00:00.000Z", corrects: a.id });
  const goal = submitGoal(ctx, { text: "What does my team still owe? One row per open item with Owner, Next action and Blocker.", projectHint: proj.id, origin: "claude" }); const t: any = issueReaderTask(ctx, goal.requestId);
  const sp = (s: string) => t.spans.find((x: any) => x.text.includes(s)); const cov = t.spans.map((x: any) => ({ spanId: x.spanId, role: "contributes", refs: ["u1"], reason: "about the party" }));
  return (owner: string, action: string, cite: string[]) => submitReaderResult(ctx, { requestId: t.requestId, revision: t.revision, snapshot: t.snapshot, updates: [{ ref: "u1", owner, action, status: "open", blocker: null, effective: "new", confidence: "stated", quotes: cite.map((c) => ({ spanId: sp(c).spanId, quote: c })) }], coverage: cov }, { client: "test", origin: "simulation" });
}
const CASES: Record<string, [string, string, string[]]> = {
  R1: ["Yusuf Demir", "Purchase forty-eight folding chairs", ["Yusuf Demir's chair purchase is raised to 48 folding chairs."]],
  R2: ["Yusuf Demir", "Buy 36 folding chairs", ["Yusuf Demir is buying 36 folding chairs for the garden party."]],
  R3: ["Mei Ling Tan", "Print 60 menus", ["Mei Ling Tan will print the menus."]],
  R4: ["Mei Ling Tan", "Print the menus", ["Mei Ling Tan will print the menus."]],
  R5: ["Anika Roy", "Rent 2 marquees", ["Anika Roy has to rent two marquees."]],
  R6: ["Mei Ling Tan", "Buy 48 chairs", ["Mei Ling Tan will print the menus.", "Yusuf Demir's chair purchase is raised to 48 folding chairs."]],
};
it("fresh project: first valid results, kept as a regression", async () => {
  const first: Record<string, { accepted: boolean; why: string }> = {};
  for (const [k, [owner, action, cite]] of Object.entries(CASES)) { const o = (await fresh())(owner, action, cite); first[k] = { accepted: o.accepted, why: o.reasons.join(" ").slice(0, 200) }; }
  require("node:fs").writeFileSync("/tmp/claude-0/readerfix/fresh-FIRST-valid.json", JSON.stringify(first, null, 2));
  // Expected before the run: R1 accepted, R2 rejected (replaced by 48), R3 rejected, R4 accepted, R5 accepted, R6 rejected.
  expect(Object.fromEntries(Object.entries(first).map(([k, v]) => [k, v.accepted]))).toEqual({ R1: true, R2: false, R3: false, R4: true, R5: true, R6: false });
  expect(first.R2.why).toMatch(/a later passage .* gives 48 instead/); expect(first.R3.why).toMatch(/says 60/); expect(first.R6.why).toMatch(/none of the quotes names Mei Ling Tan|says 48/);
});
