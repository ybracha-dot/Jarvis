"use client";
import Link from "next/link";
import { useQuery } from "@/components/api";
import { Card, Badge, Mono, SectionTitle, Spinner, ErrorBox } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

export default function ActivityPage() {
  const router = useQuery<any>("/router");
  const sched = useQuery<any>("/scheduler");
  const inbox = useQuery<any>("/inbox");
  const weekly = useQuery<any>("/review/weekly");
  const out = useQuery<any>("/outcomes?limit=30", { poll: 5000 });
  if (inbox.loading && !inbox.data) return <Spinner />;
  return <div className="space-y-6"><h1 className="t-title">Activity and outcomes</h1>
    <section aria-label="Outcomes"><SectionTitle right={<Link href="/completed" className="text-[14px] text-accent">Completed work</Link>}>Outcomes: goal, result, receipt</SectionTitle>
      {out.error && !out.data && <ErrorBox error={out.error} onRetry={out.reload} />}
      <ul className="space-y-2" data-testid="outcomes">{out.data?.outcomes.map((x: any) => <li key={x.id}><Link href={x.href} className="block rounded-xl border border-line bg-surface hover:border-line-strong p-4" data-testid="outcome-row">
        <div className="flex items-center gap-2 flex-wrap"><Badge tone={x.status === "verified" ? "accent" : x.status === "waiting" ? "amber" : x.status === "failed" ? "danger" : "neutral"}>{x.status}</Badge><b className="text-[16px] font-medium break-words min-w-0">{x.goal}</b><Mono className="text-[13px] text-muted ml-auto">{fmtDateTime(x.at)}</Mono></div>
        <p className="text-[15px] mt-1.5 break-words">{x.result}</p>{x.receipt && <p className="text-[14px] text-muted mt-0.5">Receipt: {x.receipt}</p>}</Link></li>)}
        {out.data?.outcomes.length === 0 && <li className="text-[15px] text-muted">Nothing has finished yet.</li>}</ul></section>
    {inbox.error && !inbox.data && <ErrorBox error={inbox.error} onRetry={inbox.reload} />}
    {weekly.data && <section><SectionTitle>Weekly review</SectionTitle><Card className="p-4 space-y-3 text-sm" data-testid="weekly-review">
      <div><div className="text-[13px] text-muted">One adjustment</div><p>{weekly.data.review.adjustment ?? "None. " + weekly.data.review.note}</p>{weekly.data.review.adjustment && <p className="text-[13px] text-muted">{weekly.data.review.note} {weekly.data.review.evidence.join("; ")}</p>}</div>
      <div><div className="text-[13px] text-muted mb-1">Blind spots</div>{weekly.data.blindSpots.length === 0 ? <p className="text-muted">None found.</p> : <ul className="space-y-2">{weekly.data.blindSpots.map((f: any, i: number) => <li key={i} className="rounded-lg border border-line p-2.5"><p>{f.text}</p><p className="text-[13px] text-muted">Next: {f.next} Source: {f.source}.</p></li>)}</ul>}</div></Card></section>}
    {sched.data && <section><SectionTitle>Scheduler</SectionTitle><Card className="p-4 text-sm space-y-1"><p>{sched.data.message}</p>{sched.data.lastRun && <p className="text-muted">Last run: <Mono>{sched.data.lastRun.occurrence_key}</Mono> at {fmtDateTime(sched.data.lastRun.ran_at)}: {sched.data.lastRun.summary}</p>}{sched.data.missedCycles > 0 && <p className="text-amber">{sched.data.missedCycles} missed cycle{sched.data.missedCycles > 1 ? "s" : ""} caught up once.</p>}</Card></section>}
    <section><SectionTitle>Inbox</SectionTitle><ul className="space-y-2">{inbox.data?.items.map((i: any) => <li key={i.id}><Card className="p-3"><div className="flex items-center gap-2"><span className="text-sm font-medium break-words flex-1">{i.title}</span><Badge tone={i.level === "interrupt" ? "amber" : "neutral"}>{i.level === "brief" ? "next brief" : i.level}</Badge><Mono className="text-[12px] text-muted">{fmtDateTime(i.at)}</Mono></div><p className="text-[14px] text-muted mt-1 break-words">{i.body}</p></Card></li>)}{inbox.data?.items.length === 0 && <li className="text-sm text-muted">Nothing yet.</li>}</ul></section>
    {router.data && <section><SectionTitle>Model use</SectionTitle><Card className="p-4 text-sm space-y-1"><p>Provider: {router.data.provider}</p><p>Today: ${router.data.spentTodayUsd.toFixed(4)} of ${router.data.dailyBudgetUsd.toFixed(2)} budget (estimates, configured rates). Premium: {router.data.premium}.</p><p className="text-muted">Deterministic work, such as {router.data.deterministic.join(", ")}, never calls a model.</p></Card></section>}
  </div>;
}
