import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { createProject } from "@/lib/projects";
import { importText, listSources } from "@/lib/evidence";
import { submitGoal, resultView } from "@/lib/assistant";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";
import { all } from "@/lib/db";

// The first private run, with non-personal, previously unseen material: one note you choose, a later correction, a question.
describe("first private run: one note, one correction, one question", () => {
  it("the correction wins with a link to the original wording, and the whole run stays local", async () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); const clock = () => new Date(1_000_000);
    const proj = createProject(ctx, { name: "Garden co-op", kind: "project" });
    const n1 = importText(ctx, { kind: "note", title: "Seed swap plan", text: "We will rent the community hall on March 12 for the seed swap. The hall fee is $180. Maya brings the folding tables.", at: "2026-11-10T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true });
    const n2 = importText(ctx, { kind: "note", title: "Seed swap correction", text: "Correction: the seed swap moved to March 19. The hall fee is now $210.", at: "2026-11-14T15:00:00.000Z", projectId: proj.id, label: "Notes I imported", localOnly: true, corrects: n1.id });
    expect(n2.id).not.toBe(n1.id);
    const g = submitGoal(ctx, { text: "When is the seed swap and what does the hall cost?", origin: "ask-text", projectHint: proj.id }); await processQueue(ctx, { workerId: "w", handlers: HANDLERS, clock, leaseMs: 1000 });
    const v: any = resultView(ctx, g.resultId);
    expect(v.projectId).toBe(proj.id); expect(v.projectName).toBe("Garden co-op");
    expect(v.body).toMatch(/Mar 19[^.]*your correction “Seed swap correction”/); expect(v.body).toMatch(/\$180 \([^)]*“Seed swap plan”\) was replaced by \$210/);
    expect(v.body).toMatch(/Seed swap plan[^:]*replaced by your later correction/);
    const roles = v.sources.map((s: any) => `${s.title}|${s.role}`); expect(roles).toEqual(expect.arrayContaining(["Seed swap plan|original wording, replaced", "Seed swap correction|changed date", "Seed swap correction|changed value"]));
    expect(v.sources.every((s: any) => s.link.startsWith("/evidence/ev_") && s.live)).toBe(true); expect(v.sources.find((s: any) => s.role === "original wording, replaced").quote).toMatch(/March 12|\$180/);
    expect(listSources(ctx).every((s) => s.localOnly && s.mode === "imported")).toBe(true);        // nothing marked live or fixture, everything local-only
    expect(all(ctx.db, "SELECT COUNT(*) n FROM runs")[0].n).toBe(0); expect(all(ctx.db, "SELECT model_calls FROM jobs").every((j) => j.model_calls === 0)).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/Lantern|Okafor|fixture/i);                             // no demo material leaks into a private request
  });
});
