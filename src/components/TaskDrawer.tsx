"use client";
import { useState } from "react";
import { Printer, FileText, Receipt, RotateCcw, CircleDot } from "lucide-react";
import { api, useQuery, useAction } from "./api";
import { Button, Badge, Drawer, Notice, ErrorBox, Spinner, Quote, SectionTitle, Mono, Field, inputCls, cx, Empty } from "./ui";
import { useDrawerParams } from "./Shell";
import { fmtDateTime, localHM } from "@/lib/time";

const TABS = ["Overview", "Sources", "History", "Work", "Brief"] as const;

export function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<any>(`/tasks/${id}`);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const t = q.data?.task;
  if (q.loading && !q.data) return <Drawer title="Task" onClose={onClose}><Spinner /></Drawer>;
  if (q.error && !q.data) return <Drawer title="Task" onClose={onClose}><ErrorBox error={q.error} onRetry={q.reload} /></Drawer>;
  if (!t) return null;
  const moved = q.data.dueHistory.find((h: any) => h.kind === "moved");
  return (
    <Drawer title={t.title} wide onClose={onClose}
      subtitle={<span className="flex flex-wrap items-center gap-2"><Badge>{t.course_code ?? "No course"}</Badge><Badge tone={t.status === "done" ? "accent" : t.status === "open" ? "neutral" : "amber"}>{t.status}</Badge>{t.due_at && <Mono className="text-[13px]">due {fmtDateTime(t.due_at)}</Mono>}</span>}>
      <div role="tablist" className="flex gap-1 p-1 rounded-lg bg-bg border border-line w-fit max-w-full overflow-x-auto">
        {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("px-3 py-1.5 rounded-md text-[14px] whitespace-nowrap", tab === k ? "bg-surface2 text-fg" : "text-muted")}>{k}</button>)}
      </div>
      {tab === "Overview" && <Overview d={q.data} moved={moved} />}
      {tab === "Sources" && <Sources d={q.data} />}
      {tab === "History" && <History d={q.data} />}
      {tab === "Work" && <Work d={q.data} />}
      {tab === "Brief" && <Brief id={id} />}
    </Drawer>
  );
}

function Overview({ d, moved }: { d: any; moved: any }) {
  const t = d.task;
  return <>
    {moved && <Notice>Due date moved: {moved.note}. Both dates and both sources are kept below.</Notice>}
    <section><SectionTitle>Due date history</SectionTitle>
      <ol className="space-y-2">{d.dueHistory.map((h: any) => <li key={h.id} className="rounded-lg border border-line p-2.5 text-[14px]">
        <div className="flex items-center gap-2 flex-wrap"><Mono className="font-semibold">{fmtDateTime(h.due_at)}</Mono><Badge tone={h.kind === "moved" ? "amber" : "neutral"}>{h.kind.replace("_", " ")}</Badge><span className="text-muted ml-auto text-[13px]">{h.source_title ?? h.note}</span></div>
        {h.rev_text && <p className="text-muted mt-1 break-words">“{String(h.rev_text).slice(0, 180)}”</p>}
      </li>)}</ol>
    </section>
    {d.requirements.length > 0 && <section><SectionTitle>Requirements</SectionTitle>
      <ul className="space-y-2">{d.requirements.map((r: any) => <li key={r.id} className={cx("rounded-lg border p-2.5 text-sm", r.status === "waived" ? "border-line opacity-70" : "border-amber-dim bg-amber-soft")}>
        <div className="flex items-center gap-2 flex-wrap">{r.kind === "bring_print" ? <Printer className="size-4 text-amber" aria-hidden /> : <FileText className="size-4 text-muted" aria-hidden />}<span className={cx("font-medium", r.status === "waived" && "line-through")}>{r.text}</span>{r.kind === "bring_print" && <Badge tone={r.mandatory ? "amber" : "neutral"}>{r.mandatory ? "Required" : "Optional"}</Badge>}{r.status === "waived" && <Badge>waived</Badge>}</div>
        <Quote source={r.source_title}>{r.quote}</Quote>
        {r.detail?.bibliography && <p className="text-[13px] text-muted mt-1">Bibliography: {r.detail.bibliography.map((b: any) => b.title).join(", ")}</p>}
      </li>)}</ul></section>}
    <section><SectionTitle>Plan</SectionTitle>
      {t.next_step && <p className="text-sm mb-2"><span className="text-muted">Next step:</span> {t.next_step}</p>}
      {d.blocks.length ? <ul className="space-y-1.5">{d.blocks.map((b: any) => <li key={b.id} className="flex items-center gap-2 text-sm rounded-lg bg-bg border border-line px-3 py-2"><Mono className="text-[14px]">{fmtDateTime(b.start_at)} to {localHM(b.end_at)}</Mono><Badge className="ml-auto" tone={b.kind === "booked" ? "accent" : "neutral"}>{b.kind === "booked" ? "Confirmed" : "Proposed"} · local</Badge></li>)}</ul> : <p className="text-[14px] text-muted">No reserved blocks. {t.effort_minutes} min of work estimated.</p>}
      {d.children.length > 0 && <div className="mt-3"><div className="text-[13px] text-muted mb-1">Milestones</div><ul className="space-y-1.5">{d.children.map((c: any) => <li key={c.id} className="text-[14px] rounded-lg border border-line px-2.5 py-1.5"><div className="font-medium">{c.title}</div><div className="text-muted break-words">{c.milestone}</div></li>)}</ul></div>}
    </section>
  </>;
}

function Sources({ d }: { d: any }) {
  return <section><SectionTitle>Every version, kept</SectionTitle>
    {d.sources.length === 0 ? <Empty title="No sources yet" /> : <ul className="space-y-2">{d.sources.map((s: any) => <li key={s.revision_id} className="rounded-lg border border-line p-2.5 text-[14px]">
      <div className="flex items-center gap-2 flex-wrap"><span className="font-medium break-words">{s.title}</span><Badge>{s.kind}</Badge>{s.duplicate_of && <Badge>duplicate copy</Badge>}{s.stale ? <Badge tone="amber">older, ignored</Badge> : null}</div>
      <Mono className="text-[12px] text-muted block mt-0.5">{s.provider} · {fmtDateTime(s.published_at)}</Mono><p className="text-muted mt-1 break-words">{s.excerpt}</p></li>)}</ul>}</section>;
}

const KIND_LABEL: Record<string, string> = { due_moved: "Due date moved", work_reserved: "Work reserved", requirement_added: "Requirement added", requirement_waived: "Requirement waived", draft_saved: "Draft saved", user_completed: "You marked it done", submission_receipt: "Submission receipt", correction: "Correction", checkpoint: "Paused", decision_deferred: "Deferred", decision_handled: "Handled", practice_result: "Practice result", study_plan: "Study plan", conflict: "Conflict", stale_source: "Older source", reopened: "Reopened", time_logged: "Time logged", council: "Council", created: "Created", due_established: "Due date set", conflict_resolved: "Conflict resolved" };
function History({ d }: { d: any }) {
  return <section><SectionTitle>History</SectionTitle><ol className="space-y-2 border-l border-line pl-3 ml-1">{d.events.map((e: any) => <li key={e.id} className="text-[14px]"><Mono className="text-[12px] text-muted block">{fmtDateTime(e.at)} · {KIND_LABEL[e.kind] ?? e.kind}</Mono><span className="break-words">{e.summary}</span></li>)}</ol></section>;
}

function Work({ d }: { d: any }) {
  const t = d.task; const [reason, setReason] = useState(""); const [until, setUntil] = useState("");
  const [log, setLog] = useState({ planned: "", actual: "", flag: "" });
  const [cp, setCp] = useState({ doc: "", section: "", question: "", nextStep: "" });
  const [pr, setPr] = useState({ area: "", correct: "", total: "5" });
  const [msg, setMsg] = useState<string | null>(null);
  const status = useAction(async (s: string) => { await api(`/tasks/${t.id}/status`, { body: { status: s, reason: reason || undefined, until: s === "deferred" && until ? new Date(until).toISOString() : undefined } }); setMsg(`Status: ${s}`); });
  const complete = useAction(async (kind: string, revisionId?: string) => { const r = await api(`/tasks/${t.id}/complete`, { body: { kind, revisionId } }); setMsg(kind === "draft_saved" ? "Draft saved. The task is still open. A draft is not a submission." : r.receipt ? "Closed with a submission receipt." : "Marked done by you. No submission receipt on file."); });
  const reopen = useAction(async () => { await api(`/tasks/${t.id}/reopen`, { body: {} }); });
  const logTime = useAction(async () => { await api(`/tasks/${t.id}/time`, { body: { plannedMinutes: log.planned ? Number(log.planned) : undefined, actualMinutes: Number(log.actual), flag: log.flag || undefined } }); setLog({ planned: "", actual: "", flag: "" }); setMsg("Time logged."); });
  const save = useAction(async () => { await api("/checkpoints", { body: { taskId: t.id, doc: cp.doc, section: cp.section, question: cp.question || undefined, nextStep: cp.nextStep } }); setMsg("Checkpoint saved. Resume will return it."); });
  const fixture = useAction(async () => { const r = await api(`/tasks/${t.id}/receipt-fixture`, { body: {} }); await complete.run("submission_receipt", r.revisionId); });
  const practice = useAction(async () => { const r = await api(`/tasks/${t.id}/practice`, { body: { area: pr.area, correct: Number(pr.correct), total: Number(pr.total) } }); setMsg(r.effect); });
  const weak: string[] = t.meta?.weakAreas ?? [];
  const err = status.error || complete.error || logTime.error || save.error || practice.error || reopen.error || fixture.error;
  return <>
    {msg && <Notice tone="accent">{msg}</Notice>}{err && <ErrorBox error={err} />}
    {t.status === "done" ? <section><SectionTitle>Done</SectionTitle><Button size="sm" busy={reopen.busy} onClick={() => reopen.run()}><RotateCcw className="size-3.5" />Reopen</Button></section> : <>
      <section><SectionTitle>Finish</SectionTitle>
        <p className="text-[13px] text-muted mb-2">Three different events: a saved draft, your own completion, and a submission receipt from a real source.</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => complete.run("draft_saved")}><FileText className="size-3.5" />Save draft</Button><Button size="sm" onClick={() => complete.run("user_completed")}><CircleDot className="size-3.5" />Mark done (mine)</Button><Button size="sm" onClick={() => fixture.run()}><Receipt className="size-3.5" />Attach receipt (fixture email)</Button></div>
      </section>
      <section><SectionTitle>Status</SectionTitle>
        <div className="space-y-2"><Field label="Reason (optional)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Waiting on sources" /></Field>
          <div className="flex flex-wrap gap-2 items-end"><Button size="sm" onClick={() => status.run("blocked")}>Blocked</Button><Button size="sm" onClick={() => status.run("open")}>Open</Button>
            <span className="flex items-end gap-2"><input aria-label="Defer until" type="datetime-local" className={cx(inputCls, "w-auto")} value={until} onChange={(e) => setUntil(e.target.value)} /><Button size="sm" disabled={!until} onClick={() => status.run("deferred")}>Defer</Button></span></div>
          <p className="text-[13px] text-muted">Deferring keeps the original promise: {t.original_due_at ? fmtDateTime(t.original_due_at) : "no date"}.</p></div></section>
    </>}
    <section><SectionTitle>Log time</SectionTitle>
      <div className="grid grid-cols-3 gap-2"><Field label="Planned min"><input type="number" min={0} className={inputCls} value={log.planned} onChange={(e) => setLog({ ...log, planned: e.target.value })} /></Field><Field label="Actual min"><input type="number" min={0} className={inputCls} value={log.actual} onChange={(e) => setLog({ ...log, actual: e.target.value })} /></Field>
        <Field label="Flag"><select className={inputCls} value={log.flag} onChange={(e) => setLog({ ...log, flag: e.target.value })}><option value="">None</option><option value="estimate_low">Estimate was low</option><option value="blocked">Blocked</option></select></Field></div>
      <Button size="sm" className="mt-2" disabled={!log.actual} busy={logTime.busy} onClick={() => logTime.run()}>Log</Button>
      {d.timeLogs.length > 0 && <ul className="mt-2 text-[14px] text-muted space-y-0.5">{d.timeLogs.map((l: any) => <li key={l.id}>{l.actual_minutes} min{l.planned_minutes ? ` of ${l.planned_minutes} planned` : ""}{l.flag ? ` · ${l.flag.replace("_", " ")}` : ""}</li>)}</ul>}</section>
    <section><SectionTitle>Pause here</SectionTitle>
      <div className="grid grid-cols-2 gap-2"><Field label="Document"><input className={inputCls} value={cp.doc} onChange={(e) => setCp({ ...cp, doc: e.target.value })} placeholder="Essay 2 draft" /></Field><Field label="Section"><input className={inputCls} value={cp.section} onChange={(e) => setCp({ ...cp, section: e.target.value })} placeholder="Paragraph 2" /></Field></div>
      <div className="mt-2 space-y-2"><Field label="Next step"><input className={inputCls} value={cp.nextStep} onChange={(e) => setCp({ ...cp, nextStep: e.target.value })} /></Field><Field label="Open question (optional)"><input className={inputCls} value={cp.question} onChange={(e) => setCp({ ...cp, question: e.target.value })} /></Field></div>
      <Button size="sm" className="mt-2" disabled={!(cp.doc && cp.section && cp.nextStep)} busy={save.busy} onClick={() => save.run()}>Save checkpoint</Button>
      {d.checkpoints.length > 0 && <p className="text-[14px] text-muted mt-2">Last: <Mono>{d.checkpoints[0].doc}</Mono>, {d.checkpoints[0].section}. {d.checkpoints[0].next_step}</p>}</section>
    {t.kind === "exam" && <section><SectionTitle>Practice result</SectionTitle>
      <div className="grid grid-cols-3 gap-2"><Field label="Area"><select className={inputCls} value={pr.area} onChange={(e) => setPr({ ...pr, area: e.target.value })}><option value="">Choose</option>{weak.map((w) => <option key={w}>{w}</option>)}</select></Field><Field label="Correct"><input type="number" min={0} className={inputCls} value={pr.correct} onChange={(e) => setPr({ ...pr, correct: e.target.value })} /></Field><Field label="Out of"><input type="number" min={1} className={inputCls} value={pr.total} onChange={(e) => setPr({ ...pr, total: e.target.value })} /></Field></div>
      <Button size="sm" className="mt-2" disabled={!pr.area || pr.correct === ""} busy={practice.busy} onClick={() => practice.run()}>Record result</Button>
      {d.practice.length > 0 && <ul className="mt-2 text-[14px] space-y-0.5">{d.practice.map((p: any) => <li key={p.id} className="text-muted"><Mono>{fmtDateTime(p.at)}</Mono> · {p.area}: {p.correct}/{p.total}</li>)}</ul>}</section>}
  </>;
}

function Brief({ id }: { id: string }) {
  const q = useQuery<any>(`/tasks/${id}/brief`);
  const [text, setText] = useState("");
  const [out, setOut] = useState<any>(null);
  const teach = useAction(async () => { const r = await api("/skills/teach", { body: { text, taskId: id, via: "task" } }); setOut(r); setText(""); });
  const b = q.data;
  return <>
    <section><SectionTitle right={b && <Badge tone="accent">{b.skill.name} v{b.skill.version}</Badge>}>Pre-class brief</SectionTitle>
      {q.loading && !b && <Spinner />}{q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {b && <div className="rounded-xl border border-line bg-bg p-4 space-y-2" data-testid="brief">
        {b.lines.map((l: string, i: number) => <p key={i} className="text-sm break-words">{l}</p>)}
        {b.materials.length > 0 ? <div className="pt-2 border-t border-line space-y-2" data-testid="brief-materials"><div className="text-[13px] uppercase tracking-wider text-amber">Materials</div>{b.materials.map((m: any, i: number) => <div key={i}><div className="text-sm font-medium flex items-center gap-2"><Printer className="size-4 text-amber" aria-hidden />{m.text}<Badge tone={m.mandatory ? "amber" : "neutral"}>{m.mandatoryLabel}</Badge></div><Quote source={m.sourceTitle}>{m.quote}</Quote></div>)}</div>
          : !b.skill.features.includes("materials_check") && <p className="text-[13px] text-muted pt-2 border-t border-line">This version of the skill does not check required materials.</p>}
      </div>}
    </section>
    <section><SectionTitle>Correct this brief</SectionTitle>
      <div className="flex gap-2"><input aria-label="Correction" className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="You missed the printed excerpt last time." /><Button variant="primary" busy={teach.busy} disabled={text.trim().length < 4} onClick={() => teach.run()}>Teach</Button></div>
      {teach.error && <div className="mt-2"><ErrorBox error={teach.error} /></div>}
      {out && <div className="mt-3 rounded-xl border border-accent-dim bg-accent-soft p-3 text-[14px] space-y-1" data-testid="teach-result"><div className="font-medium text-accent">{out.duplicate ? "Already handled" : `Outcome: ${out.outcome}`}</div>{out.steps.map((s: string, i: number) => <p key={i}>{s}</p>)}</div>}
    </section>
  </>;
}
