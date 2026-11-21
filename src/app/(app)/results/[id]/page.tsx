"use client";
import { Suspense, use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Copy, Check, RefreshCw, Square, ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Notice, Field, inputCls, cx } from "@/components/ui";
import { AskPanel } from "@/components/AskPanel";
import { fmtDateTime } from "@/lib/time";

const KIND: Record<string, string> = { draft: "Draft", brief: "Brief", answer: "Answer" };
const MODE: Record<string, { label: string; tone: "accent" | "amber" | "neutral" }> = { live: { label: "live", tone: "accent" }, imported: { label: "imported by you", tone: "neutral" }, fixture: { label: "fixture", tone: "amber" }, simulated: { label: "simulated", tone: "amber" }, unavailable: { label: "unavailable", tone: "neutral" } };
const render = (md: string) => md.split("\n").map((l, i) => { const parts = l.split(/(\*\*[^*]+\*\*)/g).map((p, j) => /^\*\*[^*]+\*\*$/.test(p) ? <b key={j} className="font-semibold">{p.slice(2, -2)}</b> : <span key={j}>{p}</span>); return l.trim() === "" ? <div key={i} className="h-3" /> : <p key={i} className={cx("text-[16px] leading-relaxed break-words", /^(- |\d\. )/.test(l) && "pl-1")}>{parts}</p>; });

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <Suspense fallback={<Spinner />}><Result id={id} /></Suspense>; }

function Result({ id }: { id: string }) {
  const sp = useSearchParams(); const ver = sp.get("version");
  const q = useQuery<any>(`/results/${id}${ver ? `?version=${ver}` : ""}`, { poll: 1500 });
  const [instr, setInstr] = useState(""); const [copied, setCopied] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const revise = useAction(async () => { await api(`/asks/${q.data.request.id}/revise`, { body: { text: instr } }); setInstr(""); setMsg("Got it. Jarvis keeps what still applies and redoes only what changed. The page updates when the new version is ready."); });
  const cancel = useAction(async () => { await api(`/asks/${q.data.request.id}/cancel`, { body: {} }); });
  const refresh = useAction(async () => { await api(`/asks/${q.data.request.id}/refresh`, { body: {} }); setMsg("Re-checking the sources now. The earlier version stays."); });
  const resume = useAction(async () => { await api(`/asks/${q.data.request.id}/resume`, { body: {} }); });
  if (q.loading && !q.data) return <Spinner label="Opening the result" />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} offline={q.error.status === 0} />;
  const d = q.data; const r = d.receipt; const working = !["done", "failed", "cancelled"].includes(r.status);
  const err = [revise.error, cancel.error, refresh.error, resume.error].find(Boolean);
  const copy = async () => { try { await navigator.clipboard.writeText(d.body.replace(/\*\*/g, "")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } };
  const blockedJob = r.blockers.length > 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/" className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-fg"><ArrowLeft className="size-4" />Today</Link>
      <header className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap"><Badge tone="accent">{KIND[d.kind] ?? d.kind}</Badge>{d.version > 0 && <Badge>version {d.version}{d.latestVersion !== d.version ? ` of ${d.latestVersion}` : ""}</Badge>}{d.projectName && <Link href={`/projects/${d.projectId}`}><Badge tone="neutral">{d.projectName}</Badge></Link>}{d.request.synthetic && <Badge tone="amber">synthetic source</Badge>}</div>
        <h1 className="text-2xl font-semibold tracking-tight break-words" data-testid="result-title">{d.version > 0 ? d.title : d.request.text}</h1>
        <p className="text-[14px] text-muted">Asked {d.request.origin === "claude" ? "from Claude" : d.request.origin === "ask-voice" ? "by voice" : "in Jarvis"}: “{d.request.text}” · <Mono className="text-[13px]">{d.id}</Mono></p>
      </header>
      {err && <ErrorBox error={err as any} />}{msg && <Notice tone="accent">{msg}</Notice>}
      <section aria-label="Status" className={cx("rounded-xl border px-4 py-3 flex items-center gap-3 flex-wrap", blockedJob ? "border-amber-dim bg-[#1a1508]" : "border-line bg-surface")} data-testid="result-status">
        <b className="font-medium text-[15px]">{r.plain}</b>{r.step && working && <span className="text-[14px] text-muted">{r.step}</span>}
        {working && <Link className="text-[14px] text-accent ml-auto" href={d.links.status}>Watch in the Office</Link>}
        {working && <Button size="sm" variant="danger" busy={cancel.busy} onClick={() => cancel.run()}><Square className="size-4" />Cancel</Button>}
        {(r.status === "failed" || r.status === "cancelled") && <Button size="sm" variant="primary" busy={resume.busy} onClick={() => resume.run()}>Continue</Button>}
      </section>
      {blockedJob && <Card className="p-4 space-y-2" data-testid="result-question"><b className="text-[15px] text-amber">Jarvis needs one answer</b><p className="text-[15px]">{r.blockers[0]}</p><BlockedAsk /></Card>}
      {d.stale && <Notice>This version is out of date: {d.stale} Ask again to rebuild it from what is still authorized.</Notice>}
      {d.body && <section aria-label={KIND[d.kind]} className="rounded-2xl border border-line bg-surface metal p-5 md:p-6 space-y-1" data-testid="result-body">
        <div className="flex items-center gap-2 mb-2"><h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium flex-1">{KIND[d.kind]}. Nothing has been sent.</h2><Button size="sm" onClick={copy}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}</Button></div>
        {render(d.body)}</section>}
      {d.flags.length > 0 && <section aria-label="Things to check"><SectionTitle>Check these</SectionTitle><ul className="space-y-2" data-testid="result-flags">{d.flags.map((f: any, i: number) => <li key={i} className="rounded-lg border border-amber-dim bg-[#1a1508] px-3.5 py-2.5 text-[15px] text-[#f6d7a1]" data-flag={f.kind}>{f.text}{f.itemId && <> <Link className="underline underline-offset-2" href={`/evidence/${f.itemId}`}>Open the source</Link></>}</li>)}</ul></section>}
      {d.applied && (d.applied.applied.length > 0 || d.applied.unapplied.length > 0) && <section aria-label="Instructions"><SectionTitle>Your changes</SectionTitle><ul className="text-[15px] space-y-1" data-testid="result-applied">{d.applied.applied.map((a: string) => <li key={a}>✔ {a}</li>)}{d.applied.unapplied.map((a: string) => <li key={a} className="text-muted">Noted, not applied automatically: {a}</li>)}</ul></section>}
      {d.sources.length > 0 && <section aria-label="Sources"><SectionTitle>Where each claim came from</SectionTitle><ul className="space-y-2" data-testid="result-sources">{d.sources.map((s: any, i: number) => (
        <li key={i} className="rounded-xl border border-line bg-surface p-3.5"><div className="flex items-center gap-2 flex-wrap"><Badge tone="accent">{s.role}</Badge><Badge tone={MODE[s.mode]?.tone}>{s.sourceLabel} · {MODE[s.mode]?.label ?? s.mode}</Badge>{!s.live && <Badge tone="danger">no longer available</Badge>}</div>
          <p className="mt-1.5 text-[15px] font-medium break-words">{s.live ? <Link href={s.link} className="underline underline-offset-2 hover:text-accent">{s.title}</Link> : s.title}</p>
          {s.quote && <p className="text-[14px] text-muted mt-1 break-words">“{s.quote}”</p>}<p className="text-[13px] text-muted mt-1">{s.kind} · {fmtDateTime(s.at)} · revision {s.revision}</p></li>))}</ul></section>}
      {d.unavailable.length > 0 && <section aria-label="Not available"><SectionTitle>What Jarvis could not read</SectionTitle><ul className="space-y-2" data-testid="result-unavailable">{d.unavailable.map((u: any, i: number) => <li key={i} className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[15px]"><b className="font-medium">{u.label}</b> <span className="text-muted">{u.message}</span> <Link href="/connections" className="text-accent underline underline-offset-2">Connections</Link></li>)}</ul>
        <div className="mt-2"><Button size="sm" busy={refresh.busy} onClick={() => refresh.run()} data-testid="result-refresh"><RefreshCw className="size-4" />Check again with what is available now</Button></div></section>}
      {d.reads.length > 0 && <section aria-label="What Jarvis read"><SectionTitle>What Jarvis read for this</SectionTitle><details className="rounded-xl border border-line bg-surface p-3.5" open data-testid="result-reads"><summary className="cursor-pointer text-[15px]">{d.reads.filter((x: any) => x.used).length} read, {d.reads.filter((x: any) => !x.used).length} skipped or not available</summary>
        <ul className="mt-3 space-y-2">{d.reads.map((x: any, i: number) => <li key={i} className="text-[14px]"><Badge tone={x.used ? "neutral" : "amber"} className="mr-2">{x.used ? x.kind : "not used"}</Badge><span className="break-words">{x.ref && x.kind !== "calendar" && x.kind !== "task" && x.kind !== "commitment" && x.kind !== "source" ? <Link className="underline underline-offset-2" href={`/evidence/${x.ref}`}>{x.label}</Link> : x.label}</span>{x.source && <span className="text-muted"> · {x.source}</span>}{x.note && <span className="text-muted"> · {x.note}</span>}</li>)}</ul></details></section>}
      <section aria-label="Change the request"><SectionTitle>Change the request</SectionTitle><Card className="p-4 space-y-2">
        <Field label="Tell Jarvis what to change" hint="For example: use the Wednesday decision and keep it to three sentences. It keeps the reads that still apply."><textarea className={cx(inputCls, "min-h-16")} value={instr} onChange={(e) => setInstr(e.target.value)} data-testid="revise-text" /></Field>
        <div className="flex gap-2 flex-wrap"><Button variant="primary" busy={revise.busy} disabled={instr.trim().length < 2} onClick={() => revise.run()} data-testid="revise-send">Apply the change</Button>{!d.unavailable.length && d.version > 0 && <Button busy={refresh.busy} onClick={() => refresh.run()}><RefreshCw className="size-4" />Rebuild from current sources</Button>}</div>
        <ol className="text-[13px] text-muted space-y-0.5 pt-1" data-testid="revision-list">{d.request.revisions.map((x: any) => <li key={x.revision}>r{x.revision}: {x.text} <span>({x.origin === "claude" ? "from Claude" : x.origin.startsWith("ask") ? "in Jarvis" : x.origin})</span></li>)}</ol></Card></section>
      {d.versions.length > 1 && <section aria-label="Versions"><SectionTitle>Earlier versions</SectionTitle><ul className="text-[14px] space-y-1" data-testid="version-list">{d.versions.map((v: any) => <li key={v.version}><Link className="underline underline-offset-2" href={`/results/${d.id}?version=${v.version}`}>Version {v.version}</Link> <span className="text-muted">· {fmtDateTime(v.at)} · {v.summary}{v.stale ? " · out of date" : ""}</span></li>)}</ul></section>}
    </div>
  );
}

function BlockedAsk() {
  const q = useQuery<any>("/office", { poll: 1500 });
  const j = q.data?.jobs.find((x: any) => x.status === "blocked" && x.result?.ask);
  return j ? <AskPanel jobId={j.id} ask={j.result.ask} /> : <p className="text-[14px] text-muted">Open the Office to answer.</p>;
}
export { ExternalLink, FileText };
