import { expect, it } from "vitest";
import { memCtx } from "./helpers";
import { receipt, resultView, submitGoal } from "@/lib/assistant";
import { createProject } from "@/lib/projects";
import { importText } from "@/lib/evidence";
import { processQueue } from "@/lib/jobs";
import { HANDLERS } from "@/lib/handlers";

it("never marks the showcase handoff complete with an open owner missing", async () => {
  const ctx = memCtx("2026-11-21T12:00:00-05:00", "personal");
  const project = createProject(ctx, { name: "Signal Hall showcase" });
  const source = { kind: "note", projectId: project.id, label: "QA notes", localOnly: true };
  const original = importText(ctx, {
    ...source, title: "Crew assignments", text: "For the Signal Hall showcase, the badge proof is in Leila Park's hands. She is waiting for the sponsor artwork before she can release it. Evan Cole is arranging projector pickup. The stage map is already signed off.", at: "2026-11-20T12:00:00.000Z"
  });
  const correction = importText(ctx, {
    ...source, title: "Showcase crew update", text: "Projector pickup is complete. Evan Cole collected it this morning. The sponsor artwork has arrived, clearing Leila Park to release the badge proof. Amara Chen volunteered to prepare the check-in sheet and can start immediately.",
    at: "2026-11-21T12:00:00.000Z", corrects: original.id
  });
  const goal = submitGoal(ctx, { text: "Give me a paste-ready table of what our crew still owes for the showcase. Use one row per outstanding item with Owner, Next action, and Blocker. Leave closed items out.", projectHint: project.id, origin: "api" });
  await processQueue(ctx, { workerId: "showcase-qa", handlers: HANDLERS, leaseMs: 15000, paceMs: 0 });

  const job = receipt(ctx, goal.requestId);
  const view = resultView(ctx, goal.resultId);
  const reads = new Set(view.reads.map((r: { ref: string | null }) => r.ref));
  expect(reads.has(original.id) && reads.has(correction.id)).toBe(true);
  expect(job.ready).toBe(true);
  if (job.completion !== "complete") {
    expect(job.parts.some(part => part.status !== "done" && part.detail.trim().length > 0)).toBe(true);
    return;
  }

  type Row = { owner: string | null; cells: string[]; cites: { itemId: string; quote: string }[] };
  const rows: Row[] = view.analysis?.rows ?? [];
  expect(rows.map(row => row.owner).sort()).toEqual(["Amara Chen", "Leila Park"]);
  for (const row of rows) {
    expect(row.cites.some(c => c.itemId === correction.id && c.quote.trim().length > 0)).toBe(true);
    const action = row.cells[1];
    const blocker = row.cells[2];
    expect(action).toMatch(row.owner === "Leila Park" ? /proof/i : /check.in sheet/i);
    expect(blocker).toMatch(/none|clear|unblocked|no (?:remaining )?block|received|arrived/i);
  }
  expect(view.body).toMatch(/\|[^\n]*Leila Park[^\n]*\|/i);
  expect(view.body).toMatch(/\|[^\n]*Amara Chen[^\n]*\|/i);
});
