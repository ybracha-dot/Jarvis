"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Empty } from "@/components/ui";
import { useDrawerParams } from "@/components/Shell";
import { fmtDateTime } from "@/lib/time";

const EV: Record<string, string> = { draft_saved: "Draft saved", user_completed: "You marked it done", submission_receipt: "Submission receipt" };
export default function CompletedPage() {
  const [course, setCourse] = useState("");
  const q = useQuery<any>(`/completed${course ? `?course=${course}` : ""}`);
  const { open } = useDrawerParams();
  const reopen = useAction(async (id: string) => { await api(`/tasks/${id}/reopen`, { body: {} }); });
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const days = new Map<string, any[]>();
  for (const t of q.data.tasks) days.set(t.day, [...(days.get(t.day) ?? []), t]);
  return <div className="space-y-5">
    <h1 className="text-xl font-semibold tracking-tight">Completed</h1>
    <div className="flex gap-2 flex-wrap" aria-label="Filter by course"><Button size="sm" variant={!course ? "primary" : "secondary"} onClick={() => setCourse("")}>All courses</Button>{q.data.courses.map((c: any) => <Button key={c.external_id} size="sm" variant={course === c.external_id ? "primary" : "secondary"} onClick={() => setCourse(c.external_id)}>{c.code}</Button>)}</div>
    {reopen.error && <ErrorBox error={reopen.error} />}
    {q.data.tasks.length === 0 && <Card><Empty title="Nothing completed yet" hint="Finished work shows here with the evidence that closed it." /></Card>}
    {[...days.entries()].map(([day, rows]) => <section key={day}><SectionTitle>{day}</SectionTitle><ul className="space-y-2">{rows.map((t) => (
      <li key={t.id} className="rounded-xl border border-line bg-surface p-3.5" data-testid="completed-row">
        <div className="flex items-center gap-2 flex-wrap"><button onClick={() => open("task", t.id)} className="text-sm font-medium text-left underline-offset-2 hover:underline break-words">{t.title}</button><Badge>{t.course_code}</Badge><Button size="sm" variant="ghost" className="ml-auto" onClick={() => reopen.run(t.id)}><RotateCcw className="size-3.5" />Reopen</Button></div>
        <ul className="mt-2 flex flex-wrap gap-2">{t.evidence.map((e: any, i: number) => <li key={i}><Badge tone={e.kind === "submission_receipt" ? "accent" : "neutral"}>{EV[e.kind] ?? e.kind} · {fmtDateTime(e.at)}</Badge></li>)}</ul>
        {!t.evidence.some((e: any) => e.kind === "submission_receipt") && <p className="text-[13px] text-muted mt-1.5">No submission receipt on file.</p>}
      </li>))}</ul></section>)}
  </div>;
}
