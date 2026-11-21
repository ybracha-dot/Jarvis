"use client";
import { useState } from "react";
import { Play, Clock3, RotateCcw, History, Users, HandCoins, Radio, RefreshCw, ChevronDown, ArrowRight } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Empty, Notice, cx } from "@/components/ui";
import { useDrawerParams } from "@/components/Shell";
import { fmtDateTime, localHM } from "@/lib/time";
import Link from "next/link";

const CHANGE_LABEL: Record<string, string> = { due_moved: "Due date", requirement_added: "Requirement", requirement_waived: "Waived", conflict: "Conflict", stale_source: "Older source", due_established: "Due date" };
function groupChanges(rows: any[]) {
  const m = new Map<string, { taskId: string; title: string; at: string; items: any[] }>();
  for (const r of rows) { const g = m.get(r.task_id) ?? { taskId: r.task_id, title: r.task_title, at: r.at, items: [] as any[] }; g.items.push(r); if (r.at > g.at) g.at = r.at; m.set(r.task_id, g); }
  return [...m.values()];
}
const KIND_LABEL: Record<string, string> = { calendar: "Calendar", proposed: "Proposed work", booked: "Confirmed work", protected: "Protected" };

export default function TodayPage() {
  const q = useQuery<any>("/today");
  const session = useQuery<any>("/session");
  const { open } = useDrawerParams();
  const [fixOpen, setFixOpen] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);
  const replay = useAction(async (name: string) => {
    const r = await api("/demo/replay", { body: { name } });
    const n: number = r.results.reduce((a: number, x: any) => a + x.changes.length, 0);
    setReplayMsg(n ? `Replayed. ${n} change${n > 1 ? "s" : ""} found.` : "Replayed. Nothing new: this update was already applied, so no counts changed.");
  });
  const runNow = useAction(async () => { const r = await api("/scheduler/run-now", { body: {} }); setReplayMsg(r.message); });
  const t = q.data;
  const demo = session.data?.mode !== "personal";

  if (q.loading && !t) return <Spinner label="Loading Today" />;
  if (q.error && !t) return <ErrorBox error={q.error} onRetry={q.reload} offline={q.error.status === 0} />;
  if (!t) return null;
  const p = t.primary;
  const primaryClick = () => {
    if (p.kind === "review_decision") open("decision", p.decisionId);
    else if (p.taskId) open("task", p.taskId);
  };
  const empty = t.timeline.length === 0 && t.changes.length === 0 && !t.suggestedTask && !demo;

  return (
    <div className="space-y-6">
      {q.stale && <ErrorBox error="Could not refresh. Showing what was last loaded." onRetry={q.reload} />}

      <section aria-labelledby="next-block">
        <Card className="p-5 md:p-6 relative overflow-hidden">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 id="next-block" className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium mb-2">Next useful block</h1>
              {t.nextBlock ? <div className="flex items-baseline gap-3 flex-wrap"><Mono className="text-3xl md:text-4xl font-semibold tracking-tight" data-testid="next-block-time">{localHM(t.nextBlock.start)}</Mono><span className="text-muted text-sm">{t.minutesAvailable} min free, until {localHM(t.nextBlock.end)}{t.reserved ? ` · ${t.reserved.task_title} reserved ${localHM(t.reserved.start_at)}` : ""}</span></div>
                : <p className="text-lg">No free block in the next 48 hours.</p>}
              {t.suggestedTask && <p className="mt-2 text-sm text-muted">Suggested: <button className="text-fg underline underline-offset-2 decoration-line hover:decoration-accent" onClick={() => open("task", t.suggestedTask.id)}>{t.suggestedTask.title}</button> · {t.suggestedTask.remaining} min left · due <Mono>{fmtDateTime(t.suggestedTask.due)}</Mono>{t.suggestedTask.shortfall > 0 ? <Badge tone="amber" className="ml-2">short {t.suggestedTask.shortfall} min</Badge> : t.suggestedTask.latestSafeStart ? <span> · start by <Mono>{fmtDateTime(t.suggestedTask.latestSafeStart)}</Mono></span> : null}</p>}
            </div>
            <div className="flex flex-col items-stretch gap-2 min-w-48">
              <Button variant="primary" onClick={primaryClick} disabled={p.kind === "none"} data-testid="primary-action"><Play className="size-4" />{p.label}</Button>
              <p className="text-[12px] text-muted break-words max-w-64">{p.detail}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Quick actions">
            <Button size="sm" onClick={() => open("quick", "minutes")}><Clock3 className="size-3.5" />I have 20 minutes</Button>
            <Button size="sm" onClick={() => open("quick", "resume")}><RotateCcw className="size-3.5" />Resume</Button>
            <Button size="sm" onClick={() => document.getElementById("changes")?.scrollIntoView({ behavior: "smooth" })}><History className="size-3.5" />What changed?</Button>
            <Link href="/council" className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] bg-surface2 border border-line hover:bg-[#222831]"><Users className="size-3.5" />Bring in the council</Link>
            <Button size="sm" onClick={() => open("capture")}><HandCoins className="size-3.5" />Capture a promise</Button>
          </div>
        </Card>
      </section>

      {empty && <Card className="p-5"><Empty title="This private workspace is empty" hint="Nothing is connected yet. Import a syllabus or follow the connection checklist." ><div className="flex gap-2 justify-center"><Link href="/sources" className="inline-flex rounded-lg px-3.5 py-2 text-sm bg-accent text-[#06201b] font-medium">Import a syllabus</Link><Button onClick={() => open("connections")}>Open checklist</Button></div></Empty></Card>}

      <div className="grid lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3" aria-labelledby="tl">
          <SectionTitle><span id="tl">Today</span></SectionTitle>
          {t.timeline.length === 0 ? <Card className="p-4 text-sm text-muted">Nothing scheduled today.</Card> :
            <ol className="relative border-l border-line ml-2 space-y-3" data-testid="timeline">{t.timeline.map((b: any) => (
              <li key={b.id} className="pl-4 relative">
                <span className={cx("absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-bg", b.kind === "calendar" ? "bg-[#5d6772]" : b.kind === "protected" ? "bg-[#3a4049]" : "bg-accent")} aria-hidden />
                <div className="rounded-lg border border-line bg-surface px-3 py-2 flex items-center gap-3 flex-wrap">
                  <Mono className="text-[13px] text-muted w-28 shrink-0">{localHM(b.start_at)} to {localHM(b.end_at)}</Mono><span className="text-sm min-w-0 break-words flex-1">{b.title}</span>
                  <Badge tone={b.kind === "booked" || b.kind === "proposed" ? "accent" : "neutral"}>{KIND_LABEL[b.kind] ?? b.kind}{b.kind === "proposed" || b.kind === "booked" ? " · local" : ""}</Badge>
                </div>
              </li>))}</ol>}
        </section>

        <section className="lg:col-span-2" id="changes" aria-labelledby="ch">
          <SectionTitle><span id="ch">Changes this week</span></SectionTitle>
          {t.changes.length === 0 ? <Card className="p-4 text-sm text-muted">No changes. All on track.</Card> :
            <ul className="space-y-2" data-testid="changes">{groupChanges(t.changes).map((g) => (
              <li key={g.taskId}><button onClick={() => open("task", g.taskId)} className="w-full text-left rounded-lg border border-line bg-surface hover:border-[#37404a] px-3 py-2">
                <div className="flex items-center gap-2"><span className="text-sm font-medium break-words">{g.title}</span><Mono className="text-[11px] text-muted ml-auto shrink-0">{fmtDateTime(g.at)}</Mono></div>
                <ul className="mt-1 space-y-0.5">{g.items.map((c: any) => <li key={c.id} className="text-[13px] flex gap-2 items-start"><Badge tone={c.kind === "due_moved" || c.kind === "conflict" ? "amber" : "neutral"} className="shrink-0">{CHANGE_LABEL[c.kind] ?? c.kind.replace(/_/g, " ")}</Badge><span className="break-words text-muted">{c.summary}</span></li>)}</ul></button></li>))}</ul>}
        </section>
      </div>

      <section aria-labelledby="src">
        <SectionTitle><span id="src">Sources</span></SectionTitle>
        <Card className="p-3">
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]" data-testid="source-health">{t.sources.length === 0 ? <li className="text-muted">No sources connected yet.</li> : t.sources.map((s: any) => (
            <li key={s.provider} className="flex items-center gap-1.5"><span className={cx("size-2 rounded-full", s.state === "ok" ? "bg-accent" : s.state === "partial" ? "bg-amber" : s.state === "failed" ? "bg-danger" : "bg-muted")} aria-hidden />
              <span>{s.label}</span><span className="text-muted">{s.lastSuccessAt ? `verified ${fmtDateTime(s.lastSuccessAt)}` : "never verified"}{s.state !== "ok" ? ` · ${s.state}` : ""}</span></li>))}</ul>
          {t.sources.some((s: any) => s.message) && <p className="text-[12px] text-muted mt-2 break-words">{t.sources.filter((s: any) => s.message).map((s: any) => `${s.label}: ${s.message}`).join(" · ")}</p>}
          <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
            {demo ? <>
              <Button size="sm" variant="amber" busy={replay.busy} onClick={() => replay.run("bulletin")} data-testid="replay-update"><Radio className="size-3.5" />Replay update</Button>
              <div className="relative"><Button size="sm" onClick={() => setFixOpen((v) => !v)} aria-expanded={fixOpen}>More fixtures<ChevronDown className="size-3.5" /></Button>
                {fixOpen && <FixtureMenu onPick={(n) => { setFixOpen(false); replay.run(n); }} />}</div>
              <span className="text-[12px] text-muted">Example data through the normal import pipeline. Not a live check.</span>
            </> : <Button size="sm" busy={runNow.busy} onClick={() => runNow.run()}><RefreshCw className="size-3.5" />Run now</Button>}
          </div>
          {replay.error && <div className="mt-2"><ErrorBox error={replay.error} /></div>}
          {runNow.error && <div className="mt-2"><ErrorBox error={runNow.error} /></div>}
          {replayMsg && <div className="mt-2"><Notice tone="accent"><span data-testid="replay-result">{replayMsg}</span></Notice></div>}
        </Card>
      </section>

      {(t.goals.length > 0 || t.commitmentsOpen > 0) && <section>
        <div className="grid sm:grid-cols-2 gap-3">
          {t.goals.slice(0, 1).map((g: any) => <Link key={g.id} href="/goals" className="rounded-xl border border-line bg-surface p-3 hover:border-[#37404a]"><div className="text-[11px] uppercase tracking-wider text-muted mb-1">Goal pace</div><div className="text-sm font-medium">{g.name}</div><Mono className="text-[13px] text-muted">{g.line}</Mono></Link>)}
          {t.commitmentsOpen > 0 && <Link href="/tasks?tab=followups" className="rounded-xl border border-line bg-surface p-3 hover:border-[#37404a]"><div className="text-[11px] uppercase tracking-wider text-muted mb-1">Who owes you</div><div className="text-sm font-medium">{t.commitmentsOpen} open follow-up{t.commitmentsOpen > 1 ? "s" : ""}</div><span className="text-[13px] text-accent inline-flex items-center gap-1">Review <ArrowRight className="size-3" /></span></Link>}
        </div>
      </section>}
    </div>
  );
}

const FIX = [
  ["exam", "Biology exam announced 18 days out"], ["registrar", "Registrar promises an answer by Friday"], ["conflict", "Conflicting date, no change language"],
  ["obsolete", "Obsolete course schedule resurfaces"], ["waiver", "Later announcement waives printing"],
];
function FixtureMenu({ onPick }: { onPick: (n: string) => void }) {
  return <div role="menu" className="absolute z-20 mt-1 w-72 rounded-xl border border-line bg-surface p-1 shadow-xl">{FIX.map(([k, l]) => <button key={k} role="menuitem" onClick={() => onPick(k)} className="w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-surface2">{l}</button>)}</div>;
}
