"use client";
import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Clock, Check, CalendarX2, Printer } from "lucide-react";
import { api, useQuery, useAction } from "./api";
import { Button, Badge, Drawer, Notice, ErrorBox, Spinner, Quote, SectionTitle, Mono, Empty, cx, inputCls, Field } from "./ui";
import { useDrawerParams } from "./Shell";
import { fmtDateTime, localHM, addDays, localDate } from "@/lib/time";

const URG: Record<string, { label: string; tone: "amber" | "neutral" | "accent" }> = { interrupt: { label: "Interrupt now", tone: "amber" }, brief: { label: "Next brief", tone: "neutral" }, silent: { label: "Silent", tone: "neutral" } };
const STATE_LABEL: Record<string, string> = { accepted: "Done", deferred: "Deferred", handled: "Handled", superseded: "Replaced" };

export function DecisionList({ compact }: { compact?: boolean }) {
  const { open } = useDrawerParams();
  const pending = useQuery<any>("/decisions", { poll: 3000 });
  const past = useQuery<any>("/decisions?state=accepted,deferred,handled");
  const inbox = useQuery<any>("/inbox", { poll: 6000 });
  return (
    <div className="space-y-5">
      <section>
        <SectionTitle right={<Badge tone={pending.data?.decisions?.length ? "amber" : "neutral"}>{pending.data?.decisions?.length ?? 0}</Badge>}>Decisions</SectionTitle>
        {pending.loading && !pending.data && <Spinner />}
        {pending.error && !pending.data && <ErrorBox error={pending.error} onRetry={pending.reload} />}
        {pending.data && pending.data.decisions.length === 0 && <p className="text-[14px] text-muted py-2">Nothing needs you. Quiet is the goal.</p>}
        <ul className="space-y-2">
          {pending.data?.decisions.map((d: any) => (
            <li key={d.id}>
              <button onClick={() => open("decision", d.id)} data-testid="decision-card" className="w-full text-left rounded-xl border border-line bg-surface hover:border-line-strong p-3 transition-colors">
                <div className="flex items-center gap-2 mb-1"><Badge tone={URG[d.urgency]?.tone ?? "neutral"}>{URG[d.urgency]?.label ?? d.urgency}</Badge></div>
                <div className="text-sm font-medium leading-snug break-words">{d.title}</div>
                <div className="text-[14px] text-muted mt-1 line-clamp-2 break-words">{d.summary}</div>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {past.data?.decisions?.length > 0 && (
        <section>
          <SectionTitle>Decided</SectionTitle>
          <ul className="space-y-1.5">
            {past.data.decisions.slice(0, compact ? 3 : 6).map((d: any) => (
              <li key={d.id}><button onClick={() => open("decision", d.id)} className="w-full text-left flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface2 text-[14px]">
                <Check className="size-3.5 mt-0.5 text-accent shrink-0" aria-hidden /><span className="min-w-0"><span className="block break-words">{d.title}</span><span className="text-muted">{STATE_LABEL[d.state] ?? d.state}{d.state === "deferred" && d.resolution?.until ? ` until ${fmtDateTime(d.resolution.until)}` : ""}{d.resolution?.minutes ? ` · ${d.resolution.minutes} min reserved` : ""}</span></span>
              </button></li>
            ))}
          </ul>
        </section>
      )}
      {inbox.data?.items?.length > 0 && !compact && (
        <section>
          <SectionTitle>Inbox</SectionTitle>
          <ul className="space-y-1.5 text-[14px]">{inbox.data.items.slice(0, 4).map((i: any) => <li key={i.id} className="rounded-lg border border-line px-2.5 py-1.5"><div className="font-medium break-words">{i.title}</div><div className="text-muted line-clamp-2 break-words">{i.body}</div></li>)}</ul>
        </section>
      )}
    </div>
  );
}

function Chunks({ plan }: { plan: any }) {
  if (!plan.chunks.length) return <p className="text-[14px] text-muted">No block fits before the due date.</p>;
  return <ul className="space-y-1.5">{plan.chunks.map((c: any) => (
    <li key={c.start} className="flex items-center gap-2 text-sm rounded-lg bg-bg border border-line px-3 py-2"><Clock className="size-3.5 text-muted shrink-0" aria-hidden /><Mono className="text-[14px]">{fmtDateTime(c.start)} to {localHM(c.end)}</Mono><span className="ml-auto text-[13px] text-muted">{c.minutes} min</span></li>
  ))}</ul>;
}

export function DecisionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<any>(`/decisions/${id}`);
  const { open } = useDrawerParams();
  const d = q.data?.decision;
  const rec = q.data?.recommendation;
  const [plan, setPlan] = useState<"best" | "alternative">("best");
  const [mode, setMode] = useState<"proposed" | "confirmed">("proposed");
  const [deferOpen, setDeferOpen] = useState(false);
  const [until, setUntil] = useState("");
  const [showSources, setShowSources] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const task = useQuery<any>(d?.task_id && showSources ? `/tasks/${d.task_id}` : null);

  const reserve = useAction(async () => {
    setConflict(null);
    try {
      const chosen = plan === "best" ? rec.best : rec.alternative;
      const r = await api(`/decisions/${id}/reserve`, { body: { mode, plan, chunks: chosen.chunks.map((c: any) => ({ start: c.start, end: c.end })) } });
      setResult(`${r.blocks.length} local ${mode === "confirmed" ? "confirmed" : "proposed"} block${r.blocks.length > 1 ? "s" : ""} saved.`);
    } catch (e: any) {
      if (e.status === 409 && e.body?.conflict) { setConflict(e.message); q.reload(); setPlan("best"); return; }
      throw e;
    }
  });
  const defer = useAction(async () => { await api(`/decisions/${id}/defer`, { body: { until: new Date(until).toISOString() } }); setDeferOpen(false); });
  const handled = useAction(async () => { await api(`/decisions/${id}/handled`, { body: {} }); });
  const resolve = useAction(async (side: "a" | "b") => { await api(`/decisions/${id}/resolve`, { body: { side } }); });
  const accept = useAction(async () => { const r = await api(`/decisions/${id}/accept`, { body: {} }); if (r.plan) setResult(`Study plan created: ${r.plan.milestones.length} sessions over ${r.plan.daysAvailable} days, saved as local proposed blocks.`); else setResult("Done."); });
  const waited = useAction(async () => { const r = await api(`/decisions/${id}/waited`, { body: {} }); setResult(r.note); });

  const defaultUntil = () => { if (!q.data) return ""; const nowIso = q.data.decision.created_at; const t = addDays(localDate(nowIso), 1); return `${t}T08:00`; };

  if (q.loading && !q.data) return <Drawer title="Decision" onClose={onClose}><Spinner /></Drawer>;
  if (q.error && !q.data) return <Drawer title="Decision" onClose={onClose}><ErrorBox error={q.error} onRetry={q.reload} /></Drawer>;
  if (!d) return null;
  const ev = d.evidence ?? {};
  const pending = d.state === "pending";
  const reqs: any[] = ev.requirements ?? [];
  const isPlan = ["deadline_moved", "commitment_plan"].includes(d.kind);
  const err = reserve.error || defer.error || handled.error || resolve.error || accept.error;

  return (
    <Drawer title={d.title} onClose={onClose} wide
      subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={URG[d.urgency]?.tone}>{URG[d.urgency]?.label}</Badge><span>{d.urgency_reason}</span></span>}
      footer={pending ? (
        <div className="space-y-2">
          {err && <ErrorBox error={err} />}
          {conflict && <Notice>{conflict} Pick one of the fresh options above.</Notice>}
          {isPlan && <div className="flex flex-wrap gap-2">
            <Button variant="primary" busy={reserve.busy} disabled={!rec || (plan === "best" ? rec.best : rec.alternative).chunks.length === 0} onClick={() => reserve.run()}>Reserve</Button>
            <Button onClick={() => { setDeferOpen((v) => !v); if (!until) setUntil(defaultUntil()); }} aria-expanded={deferOpen}>Defer</Button>
            <Button variant="ghost" busy={handled.busy} onClick={() => handled.run()}>Already handled</Button>
          </div>}
          {d.kind === "date_conflict" && <Button variant="ghost" busy={handled.busy} onClick={() => handled.run()}>Already handled</Button>}
          {(d.kind === "new_task" || d.kind === "promise_found") && <div className="flex gap-2"><Button variant="primary" busy={accept.busy} onClick={() => accept.run()}>{d.kind === "new_task" ? "Add task" : "Track it"}</Button><Button variant="ghost" busy={handled.busy} onClick={() => handled.run()}>Dismiss</Button></div>}
          {["requirement_added", "requirement_waived", "needs_read", "commitment_moved"].includes(d.kind) && <Button variant="primary" busy={handled.busy} onClick={() => handled.run()}>{d.kind === "needs_read" ? "Already handled" : "Got it"}</Button>}
          <button onClick={() => waited.run()} className="text-[13px] text-muted hover:text-fg underline underline-offset-2">That could have waited</button>
        </div>
      ) : undefined}>
      {result && <Notice tone="accent">{result}</Notice>}
      {!pending && <Notice tone="neutral" ><span data-testid="decision-state">{d.state === "accepted" ? "Done" : STATE_LABEL[d.state] ?? d.state}</span>{d.state === "deferred" && d.resolution?.until ? `. Comes back ${fmtDateTime(d.resolution.until)}. The original due date still stands.` : ""}{d.resolution?.action === "reserve" ? `. Reserved ${d.resolution.minutes} min as ${d.resolution.mode === "booked" ? "confirmed" : "proposed"} local blocks.` : ""}{d.resolution?.action === "handled" ? ". Evidence trail kept." : ""}</Notice>}

      {isPlan && <>
        {d.kind === "deadline_moved" && <section>
          <SectionTitle>What changed</SectionTitle>
          <div className="rounded-xl border border-line bg-bg p-4 flex items-center gap-3 flex-wrap">
            <Mono className="text-sm text-muted line-through">{fmtDateTime(ev.oldDue)}</Mono><ArrowRight className="size-4 text-amber" aria-hidden /><Mono className="text-sm font-semibold">{fmtDateTime(ev.newDue)}</Mono>
            <Badge tone="amber" className="ml-auto">{ev.label}</Badge>
          </div>
        </section>}
        <section>
          <SectionTitle>Source</SectionTitle>
          {ev.synthetic && <div className="mb-2"><Badge tone="amber">SYNTHETIC SOURCE EVENT (fixture)</Badge></div>}
          <Quote source={<>{ev.sourceTitle} · {ev.captureId ? "captured" : "posted"} {fmtDateTime(ev.publishedAt)}</>}>{ev.quote}</Quote>
          <button onClick={() => setShowSources((v) => !v)} className="mt-2 text-[14px] text-accent flex items-center gap-1">{showSources ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Both versions and copies</button>
          {showSources && <div className="mt-2 space-y-2">{task.loading && <Spinner />}{task.data?.sources.map((s: any) => (
            <div key={s.revision_id} className="rounded-lg border border-line p-2.5 text-[14px]"><div className="flex items-center gap-2 flex-wrap"><span className="font-medium">{s.title}</span>{s.duplicate_of && <Badge>duplicate copy</Badge>}{s.stale ? <Badge tone="amber">older, ignored</Badge> : null}<Mono className="text-[12px] text-muted ml-auto">{fmtDateTime(s.published_at)}</Mono></div><p className="text-muted mt-1 break-words">{s.excerpt}</p></div>
          ))}</div>}
        </section>
        {reqs.length > 0 && <section>
          <SectionTitle>New requirement</SectionTitle>
          <ul className="space-y-2">{reqs.map((r, i) => <li key={i} className="flex items-start gap-2 text-sm rounded-lg border border-amber-dim bg-amber-soft px-3 py-2"><Printer className="size-4 text-amber mt-0.5 shrink-0" aria-hidden /><div className="min-w-0"><div className="font-medium">{r.text}{r.kind === "bring_print" && <Badge tone={r.mandatory ? "amber" : "neutral"} className="ml-2">{r.mandatory ? "Required" : "Optional"}</Badge>}</div><div className="text-[13px] text-muted mt-0.5 break-words">“{r.quote}”</div></div></li>)}</ul>
        </section>}
        {rec && pending && <>
          <section>
            <SectionTitle>Impact on your plans</SectionTitle>
            <ul className="space-y-1 text-sm list-disc pl-5 text-fg">{rec.impact.map((i: string) => <li key={i}>{i}</li>)}</ul>
            {rec.best.shortfall > 0 && <div className="mt-2"><Notice>Not enough time: {rec.best.shortfall} minutes are missing before the due date. Free a block, ask for an extension, or defer.</Notice></div>}
          </section>
          <section>
            <SectionTitle>Recommended work</SectionTitle>
            <div className="flex gap-1 p-1 rounded-lg bg-bg border border-line w-fit mb-3" role="radiogroup" aria-label="Plan">
              {(["best", "alternative"] as const).map((p) => <button key={p} role="radio" aria-checked={plan === p} onClick={() => setPlan(p)} className={cx("px-3 py-1.5 rounded-md text-[14px]", plan === p ? "bg-surface2 text-fg" : "text-muted")}>{p === "best" ? "Best available" : "Alternative (latest safe)"}</button>)}
            </div>
            <div data-testid="plan-chunks"><Chunks plan={plan === "best" ? rec.best : rec.alternative} /></div>
            <fieldset className="mt-3 space-y-1.5 text-[14px]"><legend className="sr-only">Block type</legend>
              <label className="flex items-start gap-2"><input type="radio" checked={mode === "proposed"} onChange={() => setMode("proposed")} className="mt-1 accent-[var(--color-accent)]" /><span><b className="font-medium">Proposed</b> <span className="text-muted">tentative local block, easy to drop</span></span></label>
              <label className="flex items-start gap-2"><input type="radio" checked={mode === "confirmed"} onChange={() => setMode("confirmed")} className="mt-1 accent-[var(--color-accent)]" /><span><b className="font-medium">Confirmed</b> <span className="text-muted">booked local block</span></span></label>
            </fieldset>
            <p className="text-[13px] text-muted mt-2 flex items-center gap-1.5"><CalendarX2 className="size-3.5" aria-hidden />Local block in Jarvis. It is not on Google Calendar. Writing to Google Calendar needs your approval and a connection.</p>
          </section>
          {deferOpen && <section className="rounded-xl border border-line bg-bg p-3 space-y-2">
            <Field label="When should this come back?"><input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className={inputCls} /></Field>
            <div className="flex gap-2"><Button variant="primary" size="sm" busy={defer.busy} disabled={!until} onClick={() => defer.run()}>Defer until then</Button><Button size="sm" variant="ghost" onClick={() => setDeferOpen(false)}>Cancel</Button></div>
            <p className="text-[13px] text-muted">The original due date stays. Deferring does not move your deadline.</p>
          </section>}
        </>}
        {q.data.blocks.length > 0 && <section><SectionTitle>Reserved</SectionTitle><ul className="space-y-1.5">{q.data.blocks.map((b: any) => <li key={b.id} className="flex items-center gap-2 text-sm rounded-lg bg-bg border border-line px-3 py-2"><Mono className="text-[14px]">{fmtDateTime(b.start_at)} to {localHM(b.end_at)}</Mono><Badge tone={b.kind === "booked" ? "accent" : "neutral"} className="ml-auto">{b.kind === "booked" ? "Confirmed" : "Proposed"} · local only</Badge></li>)}</ul></section>}
      </>}

      {d.kind === "date_conflict" && <section>
        <SectionTitle>Two records disagree</SectionTitle>
        <p className="text-sm text-muted mb-3">Neither source says it replaces the other. Jarvis kept the current due date. Choose one.</p>
        <div className="space-y-3">{(["a", "b"] as const).map((k) => (
          <div key={k} className="rounded-xl border border-line bg-bg p-3 space-y-2">
            <div className="flex items-center gap-2"><Badge tone={k === "a" ? "neutral" : "amber"}>{k === "a" ? "Current" : "New"}</Badge><Mono className="text-sm font-semibold">{fmtDateTime(ev[k].due)}</Mono></div>
            {ev[k].quote && <Quote source={<>{ev[k].sourceTitle}{ev[k].publishedAt ? ` · ${fmtDateTime(ev[k].publishedAt)}` : ""}</>}>{ev[k].quote}</Quote>}
            {pending && <Button size="sm" variant={k === "b" ? "amber" : "secondary"} busy={resolve.busy} onClick={() => resolve.run(k)}>{k === "a" ? "Keep current" : "Use new date"}</Button>}
          </div>))}</div>
      </section>}

      {["new_task", "promise_found", "requirement_added", "requirement_waived", "needs_read", "commitment_moved"].includes(d.kind) && <section>
        <SectionTitle>Source</SectionTitle>
        <p className="text-sm mb-2">{d.summary}</p>
        {ev.quote && <Quote source={<>{ev.sourceTitle}{ev.publishedAt ? ` · ${fmtDateTime(ev.publishedAt)}` : ""}</>}>{ev.quote}</Quote>}
        {ev.interpretation && <div className="mt-2"><Notice tone="neutral">Claude read this as due {ev.interpretation.dueLocalDate} (evidence: “{ev.interpretation.evidence}”). A suggestion only. Check the source.</Notice></div>}
      </section>}

      {q.data.memory?.length > 0 && <section>
        <button onClick={() => setShowWhy((v) => !v)} className="text-[14px] text-accent flex items-center gap-1" aria-expanded={showWhy}>{showWhy ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Why did you use this?</button>
        {showWhy && <ul className="mt-2 space-y-2">{q.data.memory.map((m: any) => <li key={m.id} className="rounded-lg border border-line p-2.5 text-[14px]"><div className="font-medium">{m.title} <Badge className="ml-1">{m.kind}</Badge></div><div className="text-muted mt-0.5">{m.why} Source: {m.source}.</div><div className="text-muted break-words mt-0.5">{m.body}</div></li>)}</ul>}
      </section>}

      {q.data.trail?.length > 0 && <section>
        <SectionTitle>Evidence trail</SectionTitle>
        <ol className="space-y-1.5 border-l border-line pl-3 ml-1">{q.data.trail.map((t: any, i: number) => <li key={i} className="text-[14px]"><Mono className="text-[12px] text-muted block">{fmtDateTime(t.at)} · {t.kind.replace(/_/g, " ")}</Mono><span className="break-words">{t.summary}</span></li>)}</ol>
        {d.task_id && <button className="mt-2 text-[14px] text-accent" onClick={() => open("task", d.task_id)}>Open task</button>}
      </section>}
    </Drawer>
  );
}
export { Empty };
