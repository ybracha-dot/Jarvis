"use client";
import { useState } from "react";
import Link from "next/link";
import { RefreshCw, Check, X, Share2, Pencil, ArrowRight, CalendarClock } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, Notice, ErrorBox, Spinner, cx } from "@/components/ui";
import { zonedToUtc } from "@/lib/time";

const fmt = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const fmtT = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const STATE_TONE: Record<string, "accent" | "neutral" | "amber" | "danger"> = { live: "accent", imported: "neutral", stale: "amber", unavailable: "danger" };

/** The first screen of the day: what changed, what is owed before tomorrow, and when it can be done. Everything on it opens its source. */
export function BriefCard() {
  const q = useQuery<any>("/brief", { poll: 20000 });
  const run = useAction(async () => { await api("/brief/run", { body: {} }); });
  const share = useAction(async (on: boolean, id: string) => { await api(`/sharing/results/${id}`, { body: { share: on } }); });
  const d = q.data;
  if (q.loading && !d) return <Spinner label="Loading your brief" />;
  if (q.error && !d) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!d) return null;
  const a = d.analysis; const tz: string = d.tz;
  const sch = d.scheduler;
  return (
    <section aria-labelledby="brief-h" data-testid="brief-card" className="space-y-3">
      <Card className="p-4 md:p-6 space-y-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 id="brief-h" className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium">Morning brief</h1>
            {a && <p className="text-[13px] text-muted mt-1" data-testid="brief-built">Built <Mono>{fmt(a.builtAt, tz)}</Mono> · {a.kind === "scheduled" ? "scheduled run" : "on request"}{a.baseline ? " · baseline" : ""} · no model was called</p>}
          </div>
          <Button variant="primary" busy={run.busy} onClick={() => run.run()} data-testid="brief-build"><RefreshCw className="size-4" />{a ? "Rebuild now" : "Build my first brief"}</Button>
        </div>
        {run.error && <ErrorBox error={run.error} />}

        {!a ? <div className="text-[15px] space-y-2" data-testid="brief-empty">
          <p>No brief yet. Give Jarvis three things, then build one:</p>
          <ol className="list-decimal pl-5 space-y-1 text-muted"><li>An assignment or project note you choose, and any later correction (<Link href="/try" className="underline">Try Jarvis with one real note</Link>).</li><li>A calendar: import a calendar file at <Link href="/sources" className="underline">Sources</Link>, or paste your Blackboard link at <Link href="/connections" className="underline">Connections</Link>.</li><li>Your times for classes and quiet intervals (<Link href="/settings#brief" className="underline">Settings</Link>).</li></ol>
          <p className="text-muted">The first brief is a baseline. It cannot say what changed until there is a brief to compare with.</p>
        </div> : <>
          <div data-testid="brief-lead" className="space-y-1">
            <h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium">{a.baseline ? "Baseline" : "What changed since your last brief"}</h2>
            <p className="text-[18px] md:text-[20px] leading-snug font-medium break-words">{a.leadText}</p>
            {a.lead?.source && <p className="text-[14px]"><Link className="text-accent underline underline-offset-2" href={a.lead.source.itemId.startsWith("task:") ? `/?drawer=task&id=${a.lead.source.itemId.slice(5)}` : `/evidence/${a.lead.source.itemId}?q=${encodeURIComponent(a.lead.source.quote.slice(0, 80))}`} data-testid="brief-lead-source">Open the source: {a.lead.source.title}</Link></p>}
            {a.changes.filter((c: any) => c.text !== a.lead?.text).length > 0 && <details className="text-[14px] text-muted mt-1"><summary className="cursor-pointer">{a.changes.filter((c: any) => c.text !== a.lead?.text).length} other change{a.changes.filter((c: any) => c.text !== a.lead?.text).length === 1 ? "" : "s"}</summary><ul className="list-disc pl-5 mt-1 space-y-0.5">{a.changes.filter((c: any) => c.text !== a.lead?.text).map((c: any, i: number) => <li key={i} className="break-words">{c.text}</li>)}</ul></details>}
          </div>

          <div data-testid="brief-owed"><h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium">What you owe</h2>
            <p className="text-[15px]"><b className="font-medium">{a.owedBeforeTomorrow}</b> item{a.owedBeforeTomorrow === 1 ? "" : "s"} due before tomorrow ends{a.priorities.length ? `. Your top ${a.priorities.length === 1 ? "priority" : a.priorities.length + " priorities"}:` : ". Nothing else is due soon in the sources Jarvis can read."}</p></div>

          <ol className="space-y-3" data-testid="brief-priorities">{a.priorities.map((p: any) => <Priority key={p.key} p={p} tz={tz} />)}</ol>

          {a.alsoDue.length > 0 && <details data-testid="brief-also-due" className="text-[14px]"><summary className="cursor-pointer text-muted">Also due ({a.alsoDue.length + a.alsoDueMore})</summary><ul className="mt-1 space-y-1">{a.alsoDue.map((o: any) => <li key={o.key} className="flex gap-2 flex-wrap items-baseline"><span className="break-words min-w-0">{o.href ? <Link className="underline underline-offset-2" href={o.href}>{o.title}</Link> : o.title}</span><Mono className="text-muted text-[13px]">{o.label}</Mono><DismissOnly k={o.key} /></li>)}{a.alsoDueMore > 0 && <li className="text-muted">…and {a.alsoDueMore} more</li>}</ul></details>}
          {a.dismissed.length > 0 && <p className="text-[13px] text-muted" data-testid="brief-dismissed">Dismissed: {a.dismissed.map((x: any) => x.title).join("; ")}. <UndoDismiss keys={a.dismissed.map((x: any) => x.key)} /></p>}
          {a.leftOut?.length > 0 && <p className="text-[13px] text-muted">Left out: {a.leftOut.join(" ")}</p>}
        </>}
      </Card>

      <Card className="p-4 space-y-2" data-testid="brief-status">
        <h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium">The machinery behind it</h2>
        <ul className="text-[14px] space-y-1">
          <li>Last successful check: <b className="font-medium" data-testid="brief-last">{d.lastSuccessAt ? fmt(d.lastSuccessAt, tz) : "never"}</b></li>
          <li>Next scheduled check: <b className="font-medium" data-testid="brief-next-check">{sch.enabled && !sch.paused && sch.nextRun ? fmt(sch.nextRun.at, tz) : sch.paused ? "paused" : "none: private schedules are off"}</b></li>
          <li data-testid="brief-worker">Worker: <Badge tone={sch.workerActive ? "accent" : "amber"}>{sch.workerActive ? "running" : "not running"}</Badge> <span className="text-muted">{sch.workerActive ? `heartbeat ${fmt(sch.lastHeartbeat, tz)}` : "Scheduled briefs only happen while a worker runs. Start one: npm run worker"}</span></li>
          {!sch.enabled && <li className="text-amber"><Link href="/settings#brief" className="underline">Turn on private schedules</Link> for the brief to build itself each morning. They are off until you choose.</li>}
          {sch.quietNow && <li className="text-muted">Quiet time you set, until {fmt(sch.quietNow, tz)}. Scheduled work waits.</li>}
        </ul>
        {d.recentMisses.length > 0 && <div className="text-[14px]" data-testid="brief-gaps"><p className="text-amber">A gap is visible:</p><ul className="list-disc pl-5">{d.recentMisses.map((m: any) => <li key={m.key} className="break-words">{fmt(m.scheduledFor, tz)}: {m.detail ?? m.status}</li>)}</ul></div>}
        {a?.gaps?.length > 0 && <div className="text-[14px]" data-testid="brief-input-gaps"><p className="text-amber">What I could not check:</p><ul className="list-disc pl-5">{a.gaps.map((g: string, i: number) => <li key={i} className="break-words">{g}</li>)}</ul></div>}
        {a?.inputs?.length > 0 && <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" data-testid="brief-inputs">{a.inputs.map((i: any, k: number) => <li key={k} className="flex items-center gap-1.5 min-w-0"><Badge tone={STATE_TONE[i.state]}>{i.state}</Badge><span className="break-words">{i.label}</span></li>)}</ul>}
      </Card>

      {a && d.resultId && <Card className="p-4 space-y-2" data-testid="brief-share">
        <h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium flex items-center gap-2"><Share2 className="size-3.5" />Claude</h2>
        <p className="text-[14px] text-muted">This brief stays on this computer. Claude can read a separate version that contains only notes you have shared (no calendar, no course records, nothing local-only). Nothing is shared until you press the button.</p>
        <div className="flex gap-2 flex-wrap items-center">
          {d.sharedClaudeCanRead ? <><Badge tone="accent" data-testid="brief-shared-state">Claude can read the shared version</Badge><Link className="text-[14px] underline" href={`/results/${d.sharedResultId}`}>Open it</Link><span className="text-[13px] text-muted">Result ID <Mono data-testid="brief-shared-id" className="text-fg select-all">{d.sharedResultId}</Mono></span><Button size="sm" busy={share.busy} onClick={() => share.run(false, d.resultId)} data-testid="brief-unshare">Take it back</Button></>
            : <Button size="sm" busy={share.busy} onClick={() => share.run(true, d.resultId)} data-testid="brief-share-btn"><Share2 className="size-3.5" />Share a Claude-safe view</Button>}
          <Link className="text-[14px] text-accent inline-flex items-center gap-1" href={`/results/${d.resultId}`}>Open the full brief <ArrowRight className="size-3.5" /></Link>
          <Link className="text-[14px] text-accent inline-flex items-center gap-1" href="/connections#sharing">What Claude can read <ArrowRight className="size-3.5" /></Link>
        </div>
        {share.error && <ErrorBox error={share.error} />}
      </Card>}
    </section>
  );
}

function Priority({ p, tz }: { p: any; tz: string }) {
  const [fix, setFix] = useState(false); const [due, setDue] = useState(""); const [est, setEst] = useState("");
  const reserve = useAction(async () => { await api("/brief/reserve", { body: { key: p.key, blocks: p.blocks.map((b: any) => ({ start: b.start, end: b.end })) } }); });
  const dismiss = useAction(async () => { await api("/brief/feedback", { body: { key: p.key, kind: "dismiss" } }); });
  const correct = useAction(async () => {
    if (due) { const [dt, tm] = due.split("T"); const [y, mo, dd] = dt.split("-").map(Number); const [h, mi] = tm.split(":").map(Number); await api("/brief/feedback", { body: { key: p.key, kind: "due", value: zonedToUtc(y, mo, dd, h, mi, tz).toISOString(), note: "Corrected in the brief" } }); }
    if (est) await api("/brief/feedback", { body: { key: p.key, kind: "estimate", value: Number(est) } });
    setFix(false); setDue(""); setEst("");
  });
  return (
    <li className="rounded-xl border border-line bg-surface p-3.5 md:p-4 space-y-2" data-testid="brief-priority" data-key={p.key}>
      <div className="flex items-start gap-2 flex-wrap">
        <span className="size-6 shrink-0 rounded-full bg-accent text-[#04141e] text-[13px] font-semibold grid place-items-center" aria-hidden>{p.rank}</span>
        <h3 className="text-[17px] font-medium break-words min-w-0 flex-1">{p.title}</h3>
        {p.changed.length > 0 && <Badge tone="amber">changed</Badge>}{p.conflicts.length > 0 && <Badge tone="danger">sources disagree</Badge>}
      </div>
      <p className="text-[15px]" data-testid="brief-next"><span className="text-muted">Next: </span><b className="font-medium">{p.next}</b></p>
      <p className="text-[15px]" data-testid="brief-due"><span className="text-muted">Due: </span>{p.due ? <><b className="font-medium">{p.due.label}</b> <span className="text-muted">({p.due.relative})</span></> : <span className="text-muted">no deadline found</span>}</p>
      {p.deadlineHistory.map((h: any, i: number) => <p key={i} className="text-[13px] text-muted break-words" data-testid="brief-history"><Link href={h.href} className="underline underline-offset-2">{h.label}</Link></p>)}
      {p.conflicts.map((c: any, i: number) => <p key={i} className="text-[13px] text-amber break-words"><Link href={c.href} className="underline underline-offset-2">{c.label}</Link></p>)}
      {p.why.map((w: string, i: number) => <p key={i} className="text-[13px] text-muted break-words">{w}</p>)}
      <ul className="space-y-1" aria-label="Sources">{p.evidence.map((e: any, i: number) => <li key={i} className="text-[13px] break-words"><Link href={e.href} className="text-accent underline underline-offset-2" data-testid="brief-evidence">{e.label}</Link><span className="text-muted"> “{e.quote}”</span></li>)}</ul>
      {p.asks.map((x: string, i: number) => <Notice key={i}>{x} <Link href="/try" className="underline">Add it</Link></Notice>)}
      <p className="text-[13px] text-muted" data-testid="brief-estimate">Time estimate: {p.estimate.label}</p>
      <div data-testid="brief-when" className="rounded-lg bg-bg border border-line p-2.5 space-y-1.5">
        {p.blocks.length > 0 ? <>
          <p className="text-[13px] text-muted flex items-center gap-1.5"><CalendarClock className="size-3.5" />Proposed time for your work, separate from the instructor's deadline.</p>
          <ul className="space-y-1">{p.blocks.map((b: any, i: number) => <li key={i} className="text-[14px]" data-testid="brief-block"><Mono>{fmt(b.start, tz)} to {fmtT(b.end, tz)}</Mono> <span className="text-muted">· {b.step === "print" ? "print and check" : "work"}, {b.minutes} min</span></li>)}</ul>
          <Button size="sm" variant="primary" busy={reserve.busy} onClick={() => reserve.run()} data-testid="brief-reserve">Reserve {p.blocks.length === 1 ? "this block" : `these ${p.blocks.length} blocks`} on this computer</Button>
          <p className="text-[12px] text-muted">Local only. Nothing is added to any other calendar.</p>
        </> : p.reserved.length > 0 ? <p className="text-[14px]" data-testid="brief-reserved"><Check className="size-3.5 inline text-accent mr-1" />Reserved: {p.reserved.map((b: any) => `${fmt(b.start, tz)} to ${fmtT(b.end, tz)}`).join("; ")}</p> : <p className="text-[13px] text-muted" data-testid="brief-no-block">No time proposed. {p.blockNote ?? ""}</p>}
        {p.blockNote && p.blocks.length > 0 && <p className="text-[12px] text-amber">{p.blockNote}</p>}
        {reserve.error && <ErrorBox error={reserve.error} />}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => setFix((v) => !v)} aria-expanded={fix} data-testid="brief-correct"><Pencil className="size-3.5" />Correct</Button>
        <Button size="sm" busy={dismiss.busy} onClick={() => dismiss.run()} data-testid="brief-dismiss"><X className="size-3.5" />Dismiss</Button>
      </div>
      {fix && <div className="rounded-lg border border-line p-3 space-y-2" data-testid="brief-correct-form">
        <p className="text-[13px] text-muted">Tell Jarvis what is wrong. Your correction sits above every source, and the next brief says you made it.</p>
        <label className="block text-[13px]">Correct deadline<input type="datetime-local" className="block mt-1 w-full rounded-lg bg-bg border border-line px-3 py-2 text-sm" value={due} onChange={(e) => setDue(e.target.value)} data-testid="brief-fix-due" /></label>
        <label className="block text-[13px]">Correct estimate (minutes)<input type="number" min={5} max={1200} className="block mt-1 w-full rounded-lg bg-bg border border-line px-3 py-2 text-sm" value={est} onChange={(e) => setEst(e.target.value)} data-testid="brief-fix-est" /></label>
        <Button size="sm" variant="primary" busy={correct.busy} disabled={!due && !est} onClick={() => correct.run()} data-testid="brief-fix-save">Save and rebuild</Button>
        {correct.error && <ErrorBox error={correct.error} />}
      </div>}
      {dismiss.error && <ErrorBox error={dismiss.error} />}
    </li>
  );
}
function DismissOnly({ k }: { k: string }) { const d = useAction(async () => { await api("/brief/feedback", { body: { key: k, kind: "dismiss" } }); }); return <button className="text-[12px] text-muted underline" onClick={() => d.run()}>dismiss</button>; }
function UndoDismiss({ keys }: { keys: string[] }) { const u = useAction(async () => { for (const k of keys) await api("/brief/feedback", { body: { key: k, kind: "undismiss" } }); }); return <button className="underline" onClick={() => u.run()} data-testid="brief-undo-dismiss">Undo</button>; }
export { cx };
