"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RotateCw, Undo2, Square, Radio, Cpu, FileText, ExternalLink } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Notice, Field, inputCls, cx } from "@/components/ui";
import { OfficeScene, OfficeJob, displayName } from "@/components/OfficeScene";
import { AskPanel } from "@/components/AskPanel";
import { useDrawerParams } from "@/components/Shell";
import { fmtDateTime } from "@/lib/time";

const TAMID = "Remember for Jarvis: I owe the TAMID team three pitch angles by Thursday.";
const TONE: Record<string, "accent" | "amber" | "neutral" | "danger"> = { running: "accent", waiting: "neutral", queued: "neutral", blocked: "amber", failed: "danger", done: "accent", cancelled: "neutral" };
const fmtMs = (ms: number) => ms < 1000 ? "under 1 s" : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;

export default function OfficePage() { return <Suspense fallback={<Spinner />}><Office /></Suspense>; }

function Office() {
  const q = useQuery<any>("/office", { poll: 1000 });
  const sess = useQuery<any>("/session");
  const { open } = useDrawerParams();
  const sp = useSearchParams();
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState(TAMID);
  const [receipt, setReceipt] = useState<any>(null);
  const demo = sess.data?.mode !== "personal";
  const capture = useAction(async (t: string, synthetic: boolean) => { setReceipt(await api("/captures", { body: { text: t, sourceKind: "claude-chat", synthetic } })); });
  const undo = useAction(async (id: string) => { await api(`/captures/${id}/undo`, { body: {} }); setReceipt((r: any) => (r ? { ...r, undone: true, message: "Undone. The commitment and its decision were removed." } : r)); });
  const cancel = useAction(async (id: string) => { await api(`/office/jobs/${id}/cancel`, { body: {} }); });
  const tpl = useAction(async (id: string, name: string) => api(`/office/jobs/${id}/template`, { body: { name } }));
  const approve = useAction(async (id: string) => { await api(`/office/templates/${id}/approve`, { body: { confirm: true } }); });
  const [tplMsg, setTplMsg] = useState<string | null>(null);
  useEffect(() => { const c = sp.get("capture"); if (c && !receipt) api(`/captures/${c}`).then(setReceipt).catch(() => {}); }, [sp, receipt]);

  const o = q.data;
  if (q.loading && !o) return <Spinner label="Opening the office" />;
  if (q.error && !o) return <ErrorBox error={q.error} onRetry={q.reload} offline={q.error.status === 0} />;
  const jobs: any[] = o.jobs; const active = jobs.filter((j) => !["done", "failed", "cancelled"].includes(j.status));
  const selected = jobs.find((j) => j.id === sel) ?? null;
  const synthetic = jobs.some((j) => j.synthetic);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 flex-wrap"><div className="flex-1 min-w-0"><h1 className="text-xl font-semibold tracking-tight">Office</h1><p className="text-sm text-muted mt-1">This room shows Jarvis&apos;s own background workers. Every move comes from a saved job event. Claude Code terminals appear in Pixel Agents instead.</p></div>
        <div className="text-[13px] text-muted text-right" data-testid="office-runner"><Cpu className="size-3.5 inline mr-1" aria-hidden />{o.runner.message}<br />{o.idle ? "All desks idle. Idle desks make zero model calls." : `${active.length} active. Model calls so far: ${o.modelCalls}.`}</div></div>
      <HandoffStrip jobs={jobs} onSelect={setSel} onOpenDecision={(id) => open("decision", id)} />
      {q.stale && <ErrorBox error="Lost the connection. Showing the last state. It will catch up when the server answers." onRetry={q.reload} offline />}

      <div className={cx("grid gap-5", selected ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "")}>
        <div className="space-y-4 min-w-0">
          <div className="hidden sm:block"><OfficeScene jobs={jobs as OfficeJob[]} pendingDecisions={o.decisions} selected={sel} onSelect={setSel} onOpenDecision={(id) => open("decision", id)} /></div>
          {synthetic && <Notice>Source events here are synthetic fixtures. The workers handling them are real, and they act only on this example workspace.</Notice>}
          <section aria-label="Roster"><SectionTitle>Roster</SectionTitle>
            <ul className="space-y-2" data-testid="roster">
              {!active.some((j) => j.area === "supervisor") && <li className="rounded-lg border border-line bg-surface px-3 py-2 flex items-center gap-2 text-sm"><span className="size-2 rounded-full bg-muted" aria-hidden /><b className="font-medium">Supervisor</b><span className="text-muted">persistent, waiting for the next event</span><Badge className="ml-auto">idle</Badge></li>}
              {jobs.map((j) => (
                <li key={j.id}><button onClick={() => setSel(j.id)} data-testid="roster-job" data-status={j.status} aria-pressed={sel === j.id} className={cx("w-full text-left rounded-lg border px-3 py-2 text-sm", sel === j.id ? "border-accent bg-[#0f2420]" : "border-line bg-surface hover:border-[#37404a]")} style={{ marginLeft: j.depth * 16, width: `calc(100% - ${j.depth * 16}px)` }}>
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-medium break-words min-w-0">{displayName(j.area)}</span><span className="text-[13px] text-muted">{j.role !== displayName(j.area) ? j.role : ""}</span>{j.synthetic && <Badge tone="amber">synthetic source</Badge>}<Badge tone={TONE[j.status]} className="ml-auto">{j.status}</Badge></div>
                  <div className="text-[13px] text-muted break-words">{j.title}</div>
                  <div className="text-[12px] text-muted mono">{j.progress ? `${j.progress.done} of ${j.progress.total}` : j.stage ?? ""}{j.delegatedBy ? ` · from ${j.delegatedBy}` : ""}</div></button></li>))}
              {jobs.length === 0 && <li className="text-sm text-muted px-1">Nobody is working. Capture something below to watch it move.</li>}
            </ul></section>
          <PixelAgentsNote />
        </div>
        {selected && <aside className="space-y-4 xl:sticky xl:top-4 self-start">
          <Card className="p-4 space-y-3" aria-label="Inspector" data-testid="inspector">
            {selected && <>
              <div className="flex items-center gap-2 flex-wrap"><b className="text-sm">{displayName(selected.area)}</b><span className="text-[13px] text-muted">{selected.role}</span><Badge tone={TONE[selected.status]}>{selected.status}</Badge>{selected.synthetic && <Badge tone="amber">synthetic source</Badge>}</div>
              <p className="text-sm break-words">{selected.title}</p>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-muted">Assigned by</dt><dd>{selected.parentRole ? `${selected.parentRole === "Supervisor" ? "Jarvis" : selected.parentRole}` : "you (a capture)"}{selected.delegatedBy ? <span className="text-muted"> · {selected.delegatedBy}</span> : null}</dd>
                <dt className="text-muted">Current step</dt><dd data-testid="inspector-stage">{selected.stage ?? "waiting to start"}{selected.progress ? ` (${selected.progress.done} of ${selected.progress.total})` : ""}</dd>
                <dt className="text-muted">Elapsed</dt><dd><Mono>{fmtMs(selected.elapsedMs)}</Mono></dd>
                <dt className="text-muted">Last heartbeat</dt><dd><Mono>{selected.heartbeatAgeMs == null ? "not started" : `${fmtMs(selected.heartbeatAgeMs)} ago`}</Mono>{selected.leaseOwner ? ` · ${selected.leaseOwner}` : ""}</dd>
                <dt className="text-muted">Usage</dt><dd>{selected.modelCalls ? `${selected.modelCalls} model call${selected.modelCalls > 1 ? "s" : ""}` : "No model used (deterministic)."}</dd>
                <dt className="text-muted">Evidence</dt><dd className="break-all"><Mono className="text-[12px]">{selected.evidenceIds.join(", ") || "none"}</Mono></dd>
                <dt className="text-muted">Tools</dt><dd>{selected.tools.join(", ") || "none"}</dd>
                <dt className="text-muted">Budget</dt><dd>{selected.budget.modelCalls != null ? `${selected.budget.modelCalls} model calls` : "unset"}{selected.budget.maxMinutes ? `, ${selected.budget.maxMinutes} min` : ""}</dd>
                <dt className="text-muted">Done when</dt><dd><ul className="list-disc pl-4">{selected.criteria.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></dd>
              </dl>
              {selected.status === "blocked" && <div className="rounded-lg border border-amber-dim bg-[#1a1508] p-3 space-y-2" data-testid="blocked-ask"><div className="text-sm font-medium text-amber">Waiting for you</div>{selected.result?.ask ? <AskPanel jobId={selected.id} ask={selected.result.ask} /> : <><p className="text-[13px]">{selected.error}</p><Button size="sm" onClick={() => api(`/office/jobs/${selected.id}/retry`, { body: {} })}>Retry now</Button></>}</div>}
              {selected.error && selected.status !== "blocked" && <ErrorBox error={selected.error} />}
              {selected.steps.length > 0 && <div><div className="text-[11px] uppercase tracking-wider text-muted mb-1">Finished steps</div><ol className="list-decimal pl-5 text-[13px] space-y-0.5">{selected.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></div>}
              <div><div className="text-[11px] uppercase tracking-wider text-muted mb-1">Events</div><ol className="space-y-1 text-[12px]">{selected.events.map((e: any, i: number) => <li key={i} className="text-muted"><Mono>{e.kind}</Mono> {e.summary}</li>)}</ol></div>
              <div className="flex gap-2 flex-wrap">
                {["queued", "running", "waiting", "blocked"].includes(selected.status) && <Button size="sm" variant="danger" busy={cancel.busy} onClick={() => cancel.run(selected.id)}><Square className="size-3.5" />Cancel (and its helpers)</Button>}
                {selected.status === "done" && selected.depth > 0 && !selected.templated && <Button size="sm" busy={tpl.busy} onClick={async () => { const r = await tpl.run(selected.id, selected.role); if (r) setTplMsg(r.note); }}>Keep as a named template</Button>}
              </div>
              {tplMsg && <Notice tone="neutral">{tplMsg}</Notice>}{tpl.error && <ErrorBox error={tpl.error} />}
              {o.templates.filter((t: any) => t.status === "proposed").map((t: any) => <div key={t.id} className="text-[13px] flex items-center gap-2"><span>Template “{t.name}” is proposed.</span><Button size="sm" onClick={() => approve.run(t.id)}>Approve</Button></div>)}
            </>}
          </Card>
        </aside>}
      </div>

      <section><SectionTitle>Capture something</SectionTitle>
        <Card className="p-4 space-y-3">
          <Field label="What you would say in ordinary Claude" hint={demo ? "In the example workspace the button below sends a synthetic Claude-chat event through the real capture handler. Nothing leaves this computer." : "This saves your own words as a capture from a paste."}><textarea className={cx(inputCls, "min-h-16")} value={text} onChange={(e) => setText(e.target.value)} data-testid="capture-text" /></Field>
          <div className="flex gap-2 flex-wrap">
            <Button variant="primary" busy={capture.busy} disabled={text.trim().length < 3} onClick={() => capture.run(text, demo)} data-testid="capture-send"><Radio className="size-4" />{demo ? "Send as synthetic Claude message" : "Save to Jarvis"}</Button>
            <Button busy={capture.busy} disabled={!receipt} onClick={() => capture.run(text, demo)} data-testid="capture-replay"><RotateCw className="size-4" />Replay the same message</Button>
          </div>
          {capture.error && <ErrorBox error={capture.error} />}
          {receipt && <div className="rounded-xl border border-accent-dim bg-[#0e1f1c] p-3 space-y-2 text-sm" data-testid="capture-receipt">
            <div className="flex items-center gap-2 flex-wrap"><b className="font-medium">Receipt</b>{receipt.synthetic && <Badge tone="amber">SYNTHETIC SOURCE EVENT</Badge>}{receipt.duplicate && <Badge>duplicate: nothing new</Badge>}{receipt.undone && <Badge>undone</Badge>}</div>
            <p data-testid="receipt-message">{receipt.message ?? (receipt.parsed?.action ? `Saved: you owe ${receipt.parsed.owedTo} ${receipt.parsed.action}.` : "Saved.")}</p>
            <p className="text-[12px] text-muted">Source: {receipt.source}. Capture <Mono>{receipt.id}</Mono></p>
            <div className="flex gap-2 flex-wrap">{receipt.commitmentId && !receipt.undone && <Link className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] bg-surface2 border border-line" href={receipt.path} data-testid="receipt-open"><ExternalLink className="size-3.5" />Open the commitment</Link>}
              {!receipt.undone && <Button size="sm" variant="ghost" busy={undo.busy} onClick={() => undo.run(receipt.id)} data-testid="capture-undo"><Undo2 className="size-3.5" />Undo</Button>}</div>
          </div>}
        </Card></section>
    </div>
  );
}
export { FileText, fmtDateTime };

function ago(ms: number) { return ms < 1500 ? "just now" : ms < 60000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`; }

/** The room in words: who assigned, who is working, who needs you. Works at any width and for screen readers. */
function HandoffStrip({ jobs, onSelect, onOpenDecision }: { jobs: any[]; onSelect: (id: string) => void; onOpenDecision: (id: string) => void }) {
  const workers = jobs.filter((j) => j.area !== "supervisor");
  const assigned = workers.filter((j) => j.parentId).sort((a, b) => (a.createdAgoMs ?? 0) - (b.createdAgoMs ?? 0))[0];
  const working = workers.filter((j) => ["running", "waiting", "queued"].includes(j.status) && !j.needsYou);
  const needs = jobs.filter((j) => j.needsYou);
  const cell = "rounded-xl border px-3.5 py-3 min-w-0";
  return (
    <section aria-label="Handoff" aria-live="polite" className="grid md:grid-cols-3 gap-3" data-testid="handoff-strip">
      <div className={cx(cell, "border-line bg-surface")} data-testid="handoff-assigned"><div className="text-[12px] uppercase tracking-wider text-muted mb-1">Assigned by</div>
        {assigned ? <button className="text-left w-full" onClick={() => onSelect(assigned.id)}><div className="text-[15px]"><b className="font-medium">{assigned.parentRole === "Supervisor" || !assigned.parentRole ? "Jarvis" : assigned.parentRole}</b> <span aria-hidden>→</span><span className="sr-only">assigned</span> <b className="font-medium text-accent">{displayName(assigned.area)}</b></div><div className="text-[13px] text-muted break-words">{assigned.title} · {ago(assigned.createdAgoMs ?? 0)}</div></button> : <p className="text-[14px] text-muted">No handoff in progress.</p>}</div>
      <div className={cx(cell, "border-line bg-surface")} data-testid="handoff-working"><div className="text-[12px] uppercase tracking-wider text-muted mb-1">Working now</div>
        {working.length ? <ul className="space-y-1">{working.map((j) => <li key={j.id}><button className="text-left w-full text-[14px]" onClick={() => onSelect(j.id)}><b className="font-medium">{displayName(j.area)}</b> <span className="text-muted">{j.status === "queued" ? "has just arrived" : j.status === "waiting" ? "is waiting on helpers" : j.progress ? `step ${j.progress.done} of ${j.progress.total}` : (j.stage ?? "working").toLowerCase()}</span></button></li>)}</ul> : <p className="text-[14px] text-muted">Every desk is quiet.</p>}</div>
      <div className={cx(cell, needs.length ? "border-amber-dim bg-[#1a1508]" : "border-line bg-surface")} data-testid="handoff-needs"><div className={cx("text-[12px] uppercase tracking-wider mb-1", needs.length ? "text-amber" : "text-muted")}>Needs you</div>
        {needs.length ? <ul className="space-y-1.5">{needs.map((j) => <li key={j.id} className="text-[14px]"><b className="font-medium">{displayName(j.area)}</b> <span className="text-muted break-words">{j.needsYou.text.replace(/^Proposed: /, "")}</span>
          <div className="mt-1.5">{j.needsYou.decisionId ? <Button size="sm" variant="primary" onClick={() => onOpenDecision(j.needsYou.decisionId)}>Open decision</Button> : <Button size="sm" onClick={() => onSelect(j.id)}>Answer</Button>}</div></li>)}</ul> : <p className="text-[14px] text-muted">Nothing is waiting for you.</p>}</div>
    </section>
  );
}

function PixelAgentsNote() {
  return (
    <details className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px]" data-testid="pixel-agents-note">
      <summary className="cursor-pointer flex items-center gap-2"><ExternalLink className="size-4" aria-hidden /><span className="font-medium">Open Pixel Agents</span><span className="text-muted">for your Claude Code terminals</span></summary>
      <div className="mt-2 space-y-2 text-muted">
        <p>Pixel Agents (by Pablo De Lucca) is a separate app that watches Claude Code terminal sessions on this computer. This room does not show those, and Pixel Agents does not show Jarvis&apos;s background workers. It has no documented way for another app to feed it jobs, so the two are kept apart.</p>
        <p>Start it next to Jarvis on its own local port. In a terminal:</p>
        <pre className="mono text-[13px] rounded-lg bg-bg border border-line px-3 py-2 overflow-x-auto select-all">npx pixel-agents --host 127.0.0.1 --port 3100</pre>
        <p>It prints an address ending in <span className="mono">?token=</span>. Open that address. Keep it private: whoever has it can launch agents. Jarvis never stores or logs it.</p>
        <a className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[14px] bg-surface2 border border-line text-fg" href="http://127.0.0.1:3100/" target="_blank" rel="noreferrer noopener" data-testid="open-pixel-agents"><ExternalLink className="size-4" aria-hidden />Open Pixel Agents on port 3100</a>
        <p className="text-[13px]">Not run in this build environment: it reads your Claude Code session files and edits hooks under your home folder, so it needs your own Mac and your say-so. Code license: MIT. Character art is credited to other authors; check it before bundling anything.</p>
      </div>
    </details>
  );
}
