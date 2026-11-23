"use client";
// The inspector answers five questions about one agent, in this order: what you asked for, who assigned it,
// what it is doing now, what it needs from you, and the result you can open. Run details stay one click away.
import Link from "next/link";
import { FileText, Square, X, ArrowRight, Quote } from "lucide-react";
import { api, useAction } from "@/components/api";
import { Button, Badge, Mono, ErrorBox, Notice, cx } from "@/components/ui";
import { displayName } from "@/components/OfficeScene";
import { AskPanel } from "@/components/AskPanel";
import { useState } from "react";

const TONE: Record<string, "accent" | "amber" | "neutral" | "danger"> = { running: "accent", waiting: "neutral", queued: "neutral", blocked: "amber", failed: "danger", done: "accent", cancelled: "neutral" };
const DOT: Record<string, string> = { supervisor: "#2f6fe0", intake: "#2fa27a", research: "#8a52d6", planning: "#e08a2f", review: "#d6527a", decisions: "#d6527a" };
const VIA: Record<string, string> = { "ask-text": "typed in Ask Jarvis", "ask-voice": "spoken to Jarvis", claude: "asked in Claude", schedule: "Jarvis's own schedule", api: "an API call" };
const via = (from: string) => VIA[from] ?? from;
export const fmtMs = (ms: number) => ms < 1000 ? "under 1 s" : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;

function Row({ label, children, testid }: { label: string; children: React.ReactNode; testid?: string }) {
  return <div className="grid grid-cols-[104px_1fr] gap-x-3 py-2.5 border-t border-line first:border-t-0"><dt className="text-[13px] text-muted pt-0.5">{label}</dt><dd className="text-[14.5px] min-w-0 break-words" data-testid={testid}>{children}</dd></div>;
}

export function doingNow(j: any): string {
  if (j.status === "done") return `Finished ${fmtMs(j.finishedAgoMs ?? 0)} ago`;
  if (j.status === "failed") return "Stopped with an error";
  if (j.status === "cancelled") return "Cancelled";
  if (j.status === "queued") return "Just arrived, waiting for a worker";
  if (j.status === "waiting") return "Waiting on its helpers";
  if (j.status === "blocked") return "Stopped, waiting for you";
  return `${j.stage ?? "Working"}${j.progress ? ` (step ${j.progress.done} of ${j.progress.total})` : ""}`;
}

export function Inspector({ selected, templates, resultId, onClose, onOpenDecision }: { selected: any; templates: any[]; resultId: string | null; onClose: () => void; onOpenDecision: (id: string) => void }) {
  const cancel = useAction(async (id: string) => { await api(`/office/jobs/${id}/cancel`, { body: {} }); });
  const tpl = useAction(async (id: string, name: string) => api(`/office/jobs/${id}/template`, { body: { name } }));
  const approve = useAction(async (id: string) => { await api(`/office/templates/${id}/approve`, { body: { confirm: true } }); });
  const [tplMsg, setTplMsg] = useState<string | null>(null);
  const j = selected;
  const needs = j.needsYou as { kind: string; text: string; decisionId?: string } | null;
  const assigner = j.parentRole ? (j.parentRole === "Supervisor" ? "Jarvis" : j.parentRole) : j.asked?.from === "schedule" ? "Jarvis's schedule" : j.asked?.from && VIA[j.asked.from] ? `You, ${via(j.asked.from)}` : "You (a capture)";
  const done = ["done", "failed", "cancelled"].includes(j.status);
  const accent = DOT[j.area] ?? "#2fa27a";
  return (
    <div className={cx("rounded-2xl border bg-surface overflow-hidden lift", needs ? "border-amber-dim" : "border-line")} aria-label="Inspector" data-testid="inspector" data-needs-you={needs ? "1" : "0"}>
      <div className="flex items-center gap-3 px-4 pt-4 pb-3" style={{ boxShadow: `inset 4px 0 0 ${accent}` }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap"><b className="text-[17px] tracking-tight">{displayName(j.area)}</b>{needs ? <Badge tone="amber">needs you</Badge> : <Badge tone={TONE[j.status]}>{j.status}</Badge>}{j.synthetic && <Badge tone="amber">synthetic source</Badge>}</div>
          <p className="text-[14px] text-muted break-words mt-0.5">{j.title}</p>
        </div>
        <button onClick={onClose} aria-label="Close inspector" className="touch grid place-items-center size-9 rounded-lg text-muted hover:text-fg hover:bg-surface2"><X className="size-4" aria-hidden /></button>
      </div>

      {needs && (
        <div className="mx-4 mb-3 rounded-xl border border-amber-dim bg-amber-soft p-3.5 space-y-2.5" data-testid="needs-block">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-amber">{displayName(j.area)} is waiting for you</div>
          <p className="text-[15px] leading-snug font-medium break-words">{needs.text.replace(/^Proposed: /, "")}</p>
          {needs.decisionId
            ? <Button variant="primary" onClick={() => onOpenDecision(needs.decisionId!)} data-testid="inspector-open-decision">Review and decide <ArrowRight className="size-4" aria-hidden /></Button>
            : j.status === "blocked" && <div data-testid="blocked-ask">{j.result?.ask ? <AskPanel jobId={j.id} ask={j.result.ask} /> : <div className="space-y-2"><p className="text-[14px]">{j.error}</p><Button size="sm" onClick={() => api(`/office/jobs/${j.id}/retry`, { body: {} })}>Retry now</Button></div>}</div>}
        </div>
      )}

      <dl className="px-4 pb-1">
        <Row label="You asked">
          {j.asked ? <div className="space-y-0.5"><p className="flex gap-1.5"><Quote className="size-3.5 mt-1 shrink-0 text-muted" aria-hidden /><span data-testid="inspector-asked">{j.asked.text}</span></p><p className="text-[13px] text-muted">{VIA[j.asked.from] ? `From ${via(j.asked.from)}` : `via ${j.asked.from}`}</p></div> : <span className="text-muted">Started by Jarvis on its own schedule.</span>}
        </Row>
        <Row label="Assigned by">{assigner}{j.delegatedBy ? <span className="text-muted"> · {j.delegatedBy}</span> : null}</Row>
        <Row label="Doing now" testid="inspector-stage">{doingNow(j)}</Row>
        <Row label="Needs from you">{needs ? <span className="text-amber font-medium">{needs.kind === "decision" ? "A decision" : "An answer"}: {needs.text.replace(/^Proposed: /, "")}</span> : <span className="text-muted">Nothing.</span>}</Row>
        <Row label="Result">
          {resultId ? <Link href={`/results/${resultId}`} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[14px] bg-accent text-on-accent font-medium hover:brightness-110" data-testid="inspector-open-result"><FileText className="size-4" aria-hidden />Open what it produced</Link>
            : j.requestId ? <Link href={`/results/res_${String(j.requestId).slice(4)}`} className="text-accent underline underline-offset-2">Open the request page</Link>
            : <span className="text-muted">{done ? "No saved page for this step." : "Not ready yet."}</span>}
        </Row>
        <Row label="Last heartbeat"><Mono>{j.heartbeatAgeMs == null ? "not started" : `${fmtMs(j.heartbeatAgeMs)} ago`}</Mono>{j.leaseOwner ? <span className="text-muted"> · {j.leaseOwner}</span> : null}</Row>
        <Row label="Usage">{j.modelCalls ? `${j.modelCalls} model call${j.modelCalls > 1 ? "s" : ""}` : "No model used (deterministic)."}</Row>
      </dl>

      {j.error && j.status !== "blocked" && <div className="px-4 pb-3"><ErrorBox error={j.error} /></div>}

      <details className="border-t border-line group" data-testid="run-details">
        <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium text-muted hover:text-fg">Run details</summary>
        <div className="px-4 pb-4 space-y-3 text-[14px]">
          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted">Elapsed</dt><dd><Mono>{fmtMs(j.elapsedMs)}</Mono></dd>
            <dt className="text-muted">Evidence</dt><dd className="break-all"><Mono className="text-[13px]">{j.evidenceIds.join(", ") || "none"}</Mono></dd>
            <dt className="text-muted">Tools</dt><dd>{j.tools.join(", ") || "none"}</dd>
            <dt className="text-muted">Budget</dt><dd>{j.budget.modelCalls != null ? `${j.budget.modelCalls} model calls` : "unset"}{j.budget.maxMinutes ? `, ${j.budget.maxMinutes} min` : ""}</dd>
            <dt className="text-muted">Done when</dt><dd><ul className="list-disc pl-4">{j.criteria.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></dd>
          </dl>
          {j.steps.length > 0 && <div><div className="text-[12px] uppercase tracking-wider text-muted mb-1">Finished steps</div><ol className="list-decimal pl-5 space-y-0.5">{j.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></div>}
          <div><div className="text-[12px] uppercase tracking-wider text-muted mb-1">Events</div><ol className="space-y-1 text-[13px]">{j.events.map((e: any, i: number) => <li key={i} className="text-muted"><Mono>{e.kind}</Mono> {e.summary}</li>)}</ol></div>
        </div>
      </details>

      {(["queued", "running", "waiting", "blocked"].includes(j.status) || (j.status === "done" && j.depth > 0 && !j.templated) || templates.some((t) => t.status === "proposed")) && (
        <div className="border-t border-line px-4 py-3 flex gap-2 flex-wrap items-center">
          {["queued", "running", "waiting", "blocked"].includes(j.status) && <Button size="sm" variant="danger" busy={cancel.busy} onClick={() => cancel.run(j.id)}><Square className="size-3.5" aria-hidden />Cancel (and its helpers)</Button>}
          {j.status === "done" && j.depth > 0 && !j.templated && <Button size="sm" busy={tpl.busy} onClick={async () => { const r = await tpl.run(j.id, j.role); if (r) setTplMsg(r.note); }}>Keep as a named template</Button>}
          {templates.filter((t) => t.status === "proposed").map((t) => <span key={t.id} className="text-[14px] flex items-center gap-2">Template “{t.name}” is proposed.<Button size="sm" onClick={() => approve.run(t.id)}>Approve</Button></span>)}
        </div>
      )}
      {tplMsg && <div className="px-4 pb-3"><Notice tone="neutral">{tplMsg}</Notice></div>}{tpl.error && <div className="px-4 pb-3"><ErrorBox error={tpl.error} /></div>}
    </div>
  );
}
