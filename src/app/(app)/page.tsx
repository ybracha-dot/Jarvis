"use client";
import { useState } from "react";
import { Play, Clock3, RotateCcw, History, Users, HandCoins, Radio, RefreshCw, ChevronDown, ArrowRight } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Empty, Notice, cx } from "@/components/ui";
import { useDrawerParams } from "@/components/Shell";
import { fmtDateTime, localHM } from "@/lib/time";
import Link from "next/link";
import { VoiceDock } from "@/components/VoiceDock";
import { DecisionList } from "@/components/DecisionDrawer";
import { displayName } from "@/components/OfficeScene";

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

  const pendingCount = t.decisionsPending ?? 0;
  return (
    <div className={cx("grid gap-8", pendingCount > 0 ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "")}>
    <div className="space-y-6 min-w-0">
      {q.stale && <ErrorBox error="Could not refresh. Showing what was last loaded." onRetry={q.reload} />}

      <VoiceDock />

      <section aria-labelledby="next-block">
        <Card className="p-5 md:p-6 relative overflow-hidden">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 id="next-block" className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium mb-2">Next useful block</h1>
              {t.nextBlock ? <div className="flex items-baseline gap-3 flex-wrap"><Mono className="text-3xl md:text-4xl font-semibold tracking-tight" data-testid="next-block-time">{localHM(t.nextBlock.start)}</Mono><span className="text-muted text-sm">{t.minutesAvailable} min free, until {localHM(t.nextBlock.end)}{t.reserved ? ` · ${t.reserved.task_title} reserved ${localHM(t.reserved.start_at)}` : ""}</span></div>
                : <p className="text-lg">No free block in the next 48 hours.</p>}
              {t.suggestedTask && <p className="mt-2 text-sm text-muted">Suggested: <button className="text-fg underline underline-offset-2 decoration-line hover:decoration-accent" onClick={() => open("task", t.suggestedTask.id)}>{t.suggestedTask.title}</button> · {t.suggestedTask.remaining} min left · due <Mono>{fmtDateTime(t.suggestedTask.due)}</Mono>{t.suggestedTask.shortfall > 0 ? <Badge tone="amber" className="ml-2">short {t.suggestedTask.shortfall} min</Badge> : t.suggestedTask.latestSafeStart ? <span> · start by <Mono>{fmtDateTime(t.suggestedTask.latestSafeStart)}</Mono></span> : null}</p>}
            </div>
            <div className="flex flex-col items-stretch gap-2 min-w-48">
              <Button variant="primary" onClick={primaryClick} disabled={p.kind === "none"} data-testid="primary-action"><Play className="size-4" />{p.label}</Button>
              <p className="text-[13px] text-muted break-words max-w-64">{p.detail}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Quick actions">
            <Button size="sm" onClick={() => open("quick", "minutes")}><Clock3 className="size-3.5" />I have 20 minutes</Button>
            <Button size="sm" onClick={() => open("quick", "resume")}><RotateCcw className="size-3.5" />Resume</Button>
            <Button size="sm" onClick={() => document.getElementById("changes")?.scrollIntoView({ behavior: "smooth" })}><History className="size-3.5" />What changed?</Button>
            <Link href="/council" className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[14px] bg-surface2 border border-line hover:bg-[#222831]"><Users className="size-3.5" />Bring in the council</Link>
            <Button size="sm" onClick={() => open("capture")}><HandCoins className="size-3.5" />Capture a promise</Button>
          </div>
        </Card>
      </section>

      <TryCard />
      <AgentsAndOutput />

      {empty && <Card className="p-5"><Empty title="This private workspace is empty" hint="Nothing is connected yet. Import a syllabus or follow the connection checklist." ><div className="flex gap-2 justify-center"><Link href="/sources" className="inline-flex rounded-lg px-3.5 py-2 text-sm bg-accent text-[#04141e] font-medium">Import a syllabus</Link><Button onClick={() => open("connections")}>Open checklist</Button></div></Empty></Card>}

      <div className="grid lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3" aria-labelledby="tl">
          <SectionTitle><span id="tl">Today</span></SectionTitle>
          {t.timeline.length === 0 ? <Card className="p-4 text-sm text-muted">Nothing scheduled today.</Card> :
            <ol className="relative border-l border-line ml-2 space-y-3" data-testid="timeline">{t.timeline.map((b: any) => (
              <li key={b.id} className="pl-4 relative">
                <span className={cx("absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-bg", b.kind === "calendar" ? "bg-[#5d6772]" : b.kind === "protected" ? "bg-[#3a4049]" : "bg-accent")} aria-hidden />
                <div className="rounded-lg border border-line bg-surface px-3 py-2 flex items-center gap-3 flex-wrap">
                  <Mono className="text-[14px] text-muted w-28 shrink-0">{localHM(b.start_at)} to {localHM(b.end_at)}</Mono><span className="text-sm min-w-0 break-words flex-1">{b.title}</span>
                  <Badge tone={b.kind === "booked" || b.kind === "proposed" ? "accent" : "neutral"}>{KIND_LABEL[b.kind] ?? b.kind}{b.kind === "proposed" || b.kind === "booked" ? " · local" : ""}</Badge>
                </div>
              </li>))}</ol>}
        </section>

        <section className="lg:col-span-2" id="changes" aria-labelledby="ch">
          <SectionTitle><span id="ch">Changes this week</span></SectionTitle>
          {t.changes.length === 0 ? <Card className="p-4 text-sm text-muted">No changes. All on track.</Card> :
            <ul className="space-y-2" data-testid="changes">{groupChanges(t.changes).map((g) => (
              <li key={g.taskId}><button onClick={() => open("task", g.taskId)} className="w-full text-left rounded-lg border border-line bg-surface hover:border-[#37404a] px-3 py-2">
                <div className="flex items-center gap-2"><span className="text-sm font-medium break-words">{g.title}</span><Mono className="text-[12px] text-muted ml-auto shrink-0">{fmtDateTime(g.at)}</Mono></div>
                <ul className="mt-1 space-y-0.5">{g.items.map((c: any) => <li key={c.id} className="text-[14px] flex gap-2 items-start"><Badge tone={c.kind === "due_moved" || c.kind === "conflict" ? "amber" : "neutral"} className="shrink-0">{CHANGE_LABEL[c.kind] ?? c.kind.replace(/_/g, " ")}</Badge><span className="break-words text-muted">{c.summary}</span></li>)}</ul></button></li>))}</ul>}
        </section>
      </div>

      <section aria-labelledby="src">
        <SectionTitle><span id="src">Sources</span></SectionTitle>
        <Card className="p-3">
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]" data-testid="source-health">{t.sources.length === 0 ? <li className="text-muted">No sources connected yet.</li> : t.sources.map((s: any) => (
            <li key={s.provider} className="flex items-center gap-1.5"><span className={cx("size-2 rounded-full", s.state === "ok" ? "bg-accent" : s.state === "partial" || s.state === "unverified" ? "bg-amber" : s.state === "failed" ? "bg-danger" : "bg-muted")} aria-hidden />
              <span>{s.label}</span><span className="text-muted">{s.lastSuccessAt ? `verified ${fmtDateTime(s.lastSuccessAt)}` : "never verified"}{s.state !== "ok" ? ` · ${s.state}` : ""}</span></li>))}</ul>
          {t.sources.some((s: any) => s.message) && <p className="text-[13px] text-muted mt-2 break-words">{t.sources.filter((s: any) => s.message).map((s: any) => `${s.label}: ${s.message}`).join(" · ")}</p>}
          <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
            {demo ? <>
              <Button size="sm" variant="amber" busy={replay.busy} onClick={() => replay.run("bulletin")} data-testid="replay-update"><Radio className="size-3.5" />Replay update</Button>
              <div className="relative"><Button size="sm" onClick={() => setFixOpen((v) => !v)} aria-expanded={fixOpen}>More fixtures<ChevronDown className="size-3.5" /></Button>
                {fixOpen && <FixtureMenu onPick={(n) => { setFixOpen(false); replay.run(n); }} />}</div>
              <span className="text-[13px] text-muted">Example data through the normal import pipeline. Not a live check.</span>
            </> : <Button size="sm" busy={runNow.busy} onClick={() => runNow.run()}><RefreshCw className="size-3.5" />Run now</Button>}
          </div>
          {replay.error && <div className="mt-2"><ErrorBox error={replay.error} /></div>}
          {runNow.error && <div className="mt-2"><ErrorBox error={runNow.error} /></div>}
          {replayMsg && <div className="mt-2"><Notice tone="accent"><span data-testid="replay-result">{replayMsg}</span></Notice></div>}
        </Card>
      </section>

      {(t.goals.length > 0 || t.commitmentsOpen > 0) && <section>
        <div className="grid sm:grid-cols-2 gap-3">
          {t.goals.slice(0, 1).map((g: any) => <Link key={g.id} href="/goals" className="rounded-xl border border-line bg-surface p-3 hover:border-[#37404a]"><div className="text-[12px] uppercase tracking-wider text-muted mb-1">Goal pace</div><div className="text-sm font-medium">{g.name}</div><Mono className="text-[14px] text-muted">{g.line}</Mono></Link>)}
          {t.commitmentsOpen > 0 && <Link href="/tasks?tab=followups" className="rounded-xl border border-line bg-surface p-3 hover:border-[#37404a]"><div className="text-[12px] uppercase tracking-wider text-muted mb-1">Who owes you</div><div className="text-sm font-medium">{t.commitmentsOpen} open follow-up{t.commitmentsOpen > 1 ? "s" : ""}</div><span className="text-[14px] text-accent inline-flex items-center gap-1">Review <ArrowRight className="size-3" /></span></Link>}
        </div>
      </section>}
    </div>
    {pendingCount > 0 && <aside aria-label="Decisions" className="xl:sticky xl:top-16 self-start order-first xl:order-none"><DecisionList /></aside>}
    </div>
  );
}

/** Shown until you have imported something of your own. It points at the three-step private run. */
function TryCard() {
  const q = useQuery<any>("/evidence/sources");
  if (!q.data || q.data.sources.some((x: any) => x.mode === "imported" && x.items > 0)) return null;
  return <Link href="/try" className="block rounded-xl border border-accent-dim bg-[#0b1c29] p-4 hover:border-accent transition-colors" data-testid="try-card"><div className="flex items-center gap-2"><b className="text-[16px] font-medium">Try Jarvis with one real note</b><ArrowRight className="size-4 text-accent ml-auto" aria-hidden /></div><p className="text-[14px] text-muted mt-1">Paste one note, add a later correction, ask what was decided. About three minutes. It stays on this computer, with no key and no login.</p></Link>;
}

const SRC: Record<string, string> = { agent: "Jarvis", claude: "Claude", you: "You", task: "You" };
const ST: Record<string, "accent" | "amber" | "danger" | "neutral"> = { verified: "accent", waiting: "amber", failed: "danger", done: "neutral", cancelled: "neutral" };
/** What matters on one screen: who is working and who needs you, and where the finished output went. */
function AgentsAndOutput() {
  const o = useQuery<any>("/office", { poll: 2000 });
  const out = useQuery<any>("/outcomes?limit=5", { poll: 4000 });
  const jobs: any[] = o.data?.jobs ?? [];
  const working = jobs.filter((j) => j.area !== "supervisor" && ["running", "waiting", "queued"].includes(j.status) && !j.needsYou);
  const queuedWaiting = jobs.some((j) => j.status === "queued" && j.queuedMs > 20000);
  const needs = jobs.filter((j) => j.needsYou);
  return (
    <section aria-label="Agents and output" className="grid md:grid-cols-2 gap-4" data-testid="agents-output">
      <Link href="/office" className="rounded-xl border border-line bg-surface metal p-4 hover:border-[#3b434e] transition-colors" data-testid="today-agents">
        <div className="flex items-center gap-2 mb-2"><h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium">Agents</h2><ArrowRight className="size-4 text-muted ml-auto" aria-hidden /></div>
        {o.data && <p className={cx("text-[13px] mb-2", queuedWaiting ? "text-amber" : "text-muted")} data-testid="worker-health">{queuedWaiting ? "Work is waiting and no worker has picked it up. Start the worker: npm run worker. " : ""}{o.data.runner.message}</p>}
        {!o.data ? <p className="text-[14px] text-muted">Loading…</p> : working.length === 0 && needs.length === 0 ? <p className="text-[15px]">All desks are quiet. Nothing is running.</p> : <ul className="space-y-1.5 text-[15px]">
          {needs.map((j) => <li key={j.id} className="flex gap-2"><Badge tone="amber">needs you</Badge><span className="min-w-0 break-words"><b className="font-medium">{displayName(j.area)}</b> <span className="text-muted">{j.needsYou.text.replace(/^Proposed: /, "")}</span></span></li>)}
          {working.map((j) => <li key={j.id} className="flex gap-2"><Badge tone="accent">working</Badge><span className="min-w-0 break-words"><b className="font-medium">{displayName(j.area)}</b> <span className="text-muted">{j.status === "waiting" ? "waiting on helpers" : (j.stage ?? "starting").toLowerCase()}</span></span></li>)}
        </ul>}
      </Link>
      <div className="rounded-xl border border-line bg-surface metal p-4" data-testid="today-output">
        <h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium mb-2">Where the output went</h2>
        {!out.data ? <p className="text-[14px] text-muted">Loading…</p> : out.data.outcomes.length === 0 ? <p className="text-[15px]">Nothing finished yet. Finished work lands here with its receipt.</p> : <ul className="space-y-2">
          {out.data.outcomes.slice(0, 4).map((x: any) => <li key={x.id}><Link href={x.href} className="block rounded-lg px-2 py-1.5 -mx-2 hover:bg-surface2"><div className="flex items-center gap-2 flex-wrap"><Badge tone={ST[x.status]}>{x.status}</Badge><span className="text-[15px] font-medium break-words min-w-0">{x.goal}</span></div><p className="text-[14px] text-muted break-words">{SRC[x.source]}: {x.result}{x.receipt ? ` ${x.receipt}.` : ""}</p></Link></li>)}
        </ul>}
        <Link href="/activity" className="text-[14px] text-accent mt-2 inline-flex items-center gap-1">All outcomes <ArrowRight className="size-3.5" /></Link>
      </div>
    </section>
  );
}

const FIX = [
  ["exam", "Biology exam announced 18 days out"], ["registrar", "Registrar promises an answer by Friday"], ["conflict", "Conflicting date, no change language"],
  ["obsolete", "Obsolete course schedule resurfaces"], ["waiver", "Later announcement waives printing"],
];
function FixtureMenu({ onPick }: { onPick: (n: string) => void }) {
  return <div role="menu" className="absolute z-20 mt-1 w-72 rounded-xl border border-line bg-surface p-1 shadow-xl">{FIX.map(([k, l]) => <button key={k} role="menuitem" onClick={() => onPick(k)} className="w-full text-left px-3 py-2 rounded-lg text-[14px] hover:bg-surface2">{l}</button>)}</div>;
}
