"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RotateCw, Undo2, Square, Radio, Cpu, FileText, ExternalLink } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Notice, Field, inputCls, cx } from "@/components/ui";
import { OfficeScene, OfficeJob } from "@/components/OfficeScene";
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
      <div className="flex items-start gap-3 flex-wrap"><div className="flex-1 min-w-0"><h1 className="text-xl font-semibold tracking-tight">Office</h1><p className="text-sm text-muted mt-1">Who is working, who handed it to them, and what needs you. Every move comes from a saved job event.</p></div>
        <div className="text-[12px] text-muted text-right" data-testid="office-runner"><Cpu className="size-3.5 inline mr-1" aria-hidden />{o.runner.message}<br />{o.idle ? "All desks idle. Idle desks make zero model calls." : `${active.length} active. Model calls so far: ${o.modelCalls}.`}</div></div>
      {q.stale && <ErrorBox error="Lost the connection. Showing the last state. It will catch up when the server answers." onRetry={q.reload} offline />}
      {synthetic && <Notice>Source events here are synthetic fixtures. The workers handling them are real, and they act only on this example workspace.</Notice>}

      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        <div className="space-y-3 min-w-0">
          <div className="hidden sm:block"><OfficeScene jobs={jobs as OfficeJob[]} pendingDecisions={o.decisions} selected={sel} onSelect={setSel} onOpenDecision={(id) => open("decision", id)} /></div>
          <section aria-label="Roster"><SectionTitle>Roster</SectionTitle>
            <ul className="space-y-2" data-testid="roster">
              {!active.some((j) => j.area === "supervisor") && <li className="rounded-lg border border-line bg-surface px-3 py-2 flex items-center gap-2 text-sm"><span className="size-2 rounded-full bg-muted" aria-hidden /><b className="font-medium">Supervisor</b><span className="text-muted">persistent, waiting for the next event</span><Badge className="ml-auto">idle</Badge></li>}
              {jobs.map((j) => (
                <li key={j.id}><button onClick={() => setSel(j.id)} data-testid="roster-job" data-status={j.status} aria-pressed={sel === j.id} className={cx("w-full text-left rounded-lg border px-3 py-2 text-sm", sel === j.id ? "border-accent bg-[#0f2420]" : "border-line bg-surface hover:border-[#37404a]")} style={{ marginLeft: j.depth * 16, width: `calc(100% - ${j.depth * 16}px)` }}>
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-medium break-words min-w-0">{j.role}</span>{j.synthetic && <Badge tone="amber">synthetic source</Badge>}<Badge tone={TONE[j.status]} className="ml-auto">{j.status}</Badge></div>
                  <div className="text-[13px] text-muted break-words">{j.title}</div>
                  <div className="text-[12px] text-muted mono">{j.progress ? `${j.progress.done} of ${j.progress.total}` : j.stage ?? ""}{j.delegatedBy ? ` · from ${j.delegatedBy}` : ""}</div></button></li>))}
              {jobs.length === 0 && <li className="text-sm text-muted px-1">Nobody is working. Capture something below to watch it move.</li>}
            </ul></section>
        </div>

        <aside className="space-y-4">
          <Card className="p-4 space-y-3" aria-label="Inspector" data-testid="inspector">
            {!selected ? <p className="text-sm text-muted">Click a worker to see its task, evidence, current step and heartbeat.</p> : <>
              <div className="flex items-center gap-2 flex-wrap"><b className="text-sm">{selected.role}</b><Badge tone={TONE[selected.status]}>{selected.status}</Badge>{selected.synthetic && <Badge tone="amber">synthetic source</Badge>}</div>
              <p className="text-sm break-words">{selected.title}</p>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-muted">Delegated by</dt><dd>{selected.delegatedBy ?? "you (a capture)"}</dd>
                <dt className="text-muted">Current step</dt><dd data-testid="inspector-stage">{selected.stage ?? "waiting to start"}{selected.progress ? ` (${selected.progress.done} of ${selected.progress.total})` : ""}</dd>
                <dt className="text-muted">Elapsed</dt><dd><Mono>{fmtMs(selected.elapsedMs)}</Mono></dd>
                <dt className="text-muted">Last heartbeat</dt><dd><Mono>{selected.heartbeatAgeMs == null ? "not started" : `${fmtMs(selected.heartbeatAgeMs)} ago`}</Mono>{selected.leaseOwner ? ` · ${selected.leaseOwner}` : ""}</dd>
                <dt className="text-muted">Usage</dt><dd>{selected.modelCalls ? `${selected.modelCalls} model call${selected.modelCalls > 1 ? "s" : ""}` : "No model used (deterministic)."}</dd>
                <dt className="text-muted">Evidence</dt><dd className="break-all"><Mono className="text-[12px]">{selected.evidenceIds.join(", ") || "none"}</Mono></dd>
                <dt className="text-muted">Tools</dt><dd>{selected.tools.join(", ") || "none"}</dd>
                <dt className="text-muted">Budget</dt><dd>{selected.budget.modelCalls != null ? `${selected.budget.modelCalls} model calls` : "unset"}{selected.budget.maxMinutes ? `, ${selected.budget.maxMinutes} min` : ""}</dd>
                <dt className="text-muted">Done when</dt><dd><ul className="list-disc pl-4">{selected.criteria.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></dd>
              </dl>
              {selected.error && <ErrorBox error={selected.error} />}
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
        </aside>
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
