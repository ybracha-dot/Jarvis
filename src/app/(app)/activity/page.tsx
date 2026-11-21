"use client";
import { useQuery } from "@/components/api";
import { Card, Badge, Mono, SectionTitle, Spinner, ErrorBox } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

export default function ActivityPage() {
  const router = useQuery<any>("/router");
  const sched = useQuery<any>("/scheduler");
  const inbox = useQuery<any>("/inbox");
  if (inbox.loading && !inbox.data) return <Spinner />;
  return <div className="space-y-6"><h1 className="text-xl font-semibold tracking-tight">Activity</h1>
    {inbox.error && !inbox.data && <ErrorBox error={inbox.error} onRetry={inbox.reload} />}
    {sched.data && <section><SectionTitle>Scheduler</SectionTitle><Card className="p-4 text-sm space-y-1"><p>{sched.data.message}</p>{sched.data.lastRun && <p className="text-muted">Last run: <Mono>{sched.data.lastRun.occurrence_key}</Mono> at {fmtDateTime(sched.data.lastRun.ran_at)}: {sched.data.lastRun.summary}</p>}{sched.data.missedCycles > 0 && <p className="text-amber">{sched.data.missedCycles} missed cycle{sched.data.missedCycles > 1 ? "s" : ""} caught up once.</p>}</Card></section>}
    <section><SectionTitle>Inbox</SectionTitle><ul className="space-y-2">{inbox.data?.items.map((i: any) => <li key={i.id}><Card className="p-3"><div className="flex items-center gap-2"><span className="text-sm font-medium break-words flex-1">{i.title}</span><Badge tone={i.level === "interrupt" ? "amber" : "neutral"}>{i.level === "brief" ? "next brief" : i.level}</Badge><Mono className="text-[11px] text-muted">{fmtDateTime(i.at)}</Mono></div><p className="text-[13px] text-muted mt-1 break-words">{i.body}</p></Card></li>)}{inbox.data?.items.length === 0 && <li className="text-sm text-muted">Nothing yet.</li>}</ul></section>
    {router.data && <section><SectionTitle>Model use</SectionTitle><Card className="p-4 text-sm space-y-1"><p>Provider: {router.data.provider}</p><p>Today: ${router.data.spentTodayUsd.toFixed(4)} of ${router.data.dailyBudgetUsd.toFixed(2)} budget (estimates, configured rates). Premium: {router.data.premium}.</p><p className="text-muted">Deterministic work, such as {router.data.deterministic.join(", ")}, never calls a model.</p></Card></section>}
  </div>;
}
