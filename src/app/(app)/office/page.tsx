"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RotateCw, Undo2, Radio, ExternalLink, ArrowRight, Hourglass } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, SectionTitle, Spinner, ErrorBox, Notice, Field, Mono, inputCls, cx } from "@/components/ui";
import { OfficeScene, OfficeJob, displayName } from "@/components/OfficeScene";
import { Inspector, doingNow } from "@/components/OfficeInspector";
import { useDrawerParams } from "@/components/Shell";

const TAMID = "Remember for Jarvis: I owe the TAMID team three pitch angles by Thursday.";
const TONE: Record<string, "accent" | "amber" | "neutral" | "danger"> = { running: "accent", waiting: "neutral", queued: "neutral", blocked: "amber", failed: "danger", done: "accent", cancelled: "neutral" };
const ago = (ms: number) => (ms < 1500 ? "just now" : ms < 60000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`);

export default function OfficePage() { return <Suspense fallback={<Spinner />}><Office /></Suspense>; }

function Office() {
  const q = useQuery<any>("/office", { poll: 1000 });
  const sess = useQuery<any>("/session");
  const { open } = useDrawerParams();
  const sp = useSearchParams();
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState(TAMID);
  const [receipt, setReceipt] = useState<any>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const demo = sess.data?.mode !== "personal";
  const capture = useAction(async (t: string, synthetic: boolean) => { setReceipt(await api("/captures", { body: { text: t, sourceKind: "claude-chat", synthetic } })); });
  const undo = useAction(async (id: string) => { await api(`/captures/${id}/undo`, { body: {} }); setReceipt((r: any) => (r ? { ...r, undone: true, message: "Undone. The commitment and its decision were removed." } : r)); });
  const reqParam = sp.get("request");
  useEffect(() => { const c = sp.get("capture"); if (c && !receipt) api(`/captures/${c}`).then(setReceipt).catch(() => {}); }, [sp, receipt]);
  // Below the wide layout the inspector sits under the room, so bring it into view when something is picked.
  const pick = (id: string) => { setSel(id); setTimeout(() => { if (window.innerWidth < 1280) inspectorRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, 30); };

  const o = q.data;
  if (q.loading && !o) return <Spinner label="Opening the office" />;
  if (q.error && !o) return <ErrorBox error={q.error} onRetry={q.reload} offline={q.error.status === 0} />;
  const jobs: any[] = o.jobs; const active = jobs.filter((j) => !["done", "failed", "cancelled"].includes(j.status));
  const fromRequest = reqParam ? jobs.find((j) => j.requestId === reqParam && j.depth === 0) : null;
  const selected = jobs.find((j) => j.id === (sel ?? fromRequest?.id)) ?? null;
  const rootOf = (j: any) => j ? (j.depth === 0 ? j : jobs.find((x) => x.id === j.rootId)) : null;
  const resultId = selected ? (selected.result?.resultId ?? rootOf(selected)?.result?.resultId ?? null) : null;
  const synthetic = jobs.some((j) => j.synthetic);
  // The roster leads with whatever is still moving or waiting on you, then the newest finished work. A job stays directly under the one that delegated it.
  const groups = new Map<string, any[]>(); for (const j of jobs) { const k = j.rootId ?? j.id; groups.set(k, [...(groups.get(k) ?? []), j]); }
  const live = (g: any[]) => g.some((j) => j.needsYou || !["done", "failed", "cancelled"].includes(j.status)); const age = (g: any[]) => Math.min(...g.map((j) => j.createdAgoMs ?? 0));
  const ordered = [...groups.values()].sort((a, b) => Number(live(b)) - Number(live(a)) || age(a) - age(b)).flat();

  return (
    <div className="space-y-4 md:space-y-5">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-0"><h1 className="t-title">Office</h1><p className="text-[14.5px] text-muted mt-0.5 hidden sm:block">Jarvis&apos;s own background workers. Every move here comes from a saved job event.</p></div>
      </div>

      <PhoneNow jobs={jobs} active={active} onSelect={pick} onOpenDecision={(id) => open("decision", id)} />
      <StatusLine o={o} jobs={jobs} active={active} onSelect={pick} onOpenDecision={(id) => open("decision", id)} />
      {q.stale && <ErrorBox error="Lost the connection. Showing the last state. It will catch up when the server answers." onRetry={q.reload} offline />}

      <div className={cx("grid gap-5", selected ? "xl:grid-cols-[minmax(0,1fr)_380px]" : "")}>
        <div className="space-y-5 min-w-0">
          <div className="hidden sm:block mx-auto w-full rounded-2xl overflow-hidden border border-line bg-[#13244d] lift aspect-[3/2] md:max-w-[max(34rem,calc((100dvh-17.5rem)*1.5))]" data-testid="room-frame">
            <OfficeScene jobs={jobs as OfficeJob[]} pendingDecisions={o.decisions} selected={selected?.id ?? null} onSelect={pick} onOpenDecision={(id) => open("decision", id)} />
          </div>
          {synthetic && <Notice>Source events here are synthetic fixtures. The workers handling them are real, and they act only on this example workspace.</Notice>}
          <section aria-label="Roster"><SectionTitle>Roster</SectionTitle>
            <ul className="space-y-2" data-testid="roster">
              {!active.some((j) => j.area === "supervisor") && <li className="rounded-xl border border-line bg-surface px-3.5 py-2.5 flex items-center gap-2 text-[14.5px]"><span className="size-2 rounded-full bg-muted" aria-hidden /><b className="font-medium">Jarvis</b><span className="text-muted">waiting for the next event</span><Badge className="ml-auto">idle</Badge></li>}
              {ordered.map((j) => (
                <li key={j.id}><button onClick={() => pick(j.id)} data-testid="roster-job" data-status={j.status} aria-pressed={selected?.id === j.id} className={cx("w-full text-left rounded-xl border px-3.5 py-2.5 transition-colors", selected?.id === j.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong")} style={{ marginLeft: j.depth * 16, width: `calc(100% - ${j.depth * 16}px)` }}>
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-medium break-words min-w-0 text-[15px]">{displayName(j.area)}</span><span className="text-[14px] text-muted">{j.role !== displayName(j.area) ? j.role : ""}</span>{j.synthetic && <Badge tone="amber">synthetic source</Badge>}{j.needsYou && <Badge tone="amber">needs you</Badge>}<Badge tone={TONE[j.status]} className="ml-auto">{j.status}</Badge></div>
                  <div className="text-[14px] text-muted break-words">{j.title}</div>
                  <div className="text-[13px] text-muted mono">{j.progress ? `${j.progress.done} of ${j.progress.total}` : j.stage ?? ""}{j.delegatedBy ? ` · from ${j.delegatedBy}` : ""}</div></button></li>))}
              {jobs.length === 0 && <li className="text-[14.5px] text-muted px-1">Nobody is working. Capture something below to watch it move.</li>}
            </ul></section>
          <PixelAgentsNote />
        </div>
        {selected && <aside ref={inspectorRef} className="xl:sticky xl:top-4 self-start max-sm:order-first scroll-mt-20">
          <Inspector selected={selected} templates={o.templates} resultId={resultId} onClose={() => setSel(null)} onOpenDecision={(id) => open("decision", id)} />
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
          {receipt && <div className="rounded-xl border border-accent-dim bg-accent-soft p-3 space-y-2 text-sm" data-testid="capture-receipt">
            <div className="flex items-center gap-2 flex-wrap"><b className="font-medium">Receipt</b>{receipt.synthetic && <Badge tone="amber">SYNTHETIC SOURCE EVENT</Badge>}{receipt.duplicate && <Badge>duplicate: nothing new</Badge>}{receipt.undone && <Badge>undone</Badge>}</div>
            <p data-testid="receipt-message">{receipt.message ?? (receipt.parsed?.action ? `Saved: you owe ${receipt.parsed.owedTo} ${receipt.parsed.action}.` : "Saved.")}</p>
            <p className="text-[13px] text-muted">Source: {receipt.source}. Capture <Mono>{receipt.id}</Mono></p>
            <div className="flex gap-2 flex-wrap">{receipt.commitmentId && !receipt.undone && <Link className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[14px] bg-surface2 border border-line" href={receipt.path} data-testid="receipt-open"><ExternalLink className="size-3.5" />Open the commitment</Link>}
              {!receipt.undone && <Button size="sm" variant="ghost" busy={undo.busy} onClick={() => undo.run(receipt.id)} data-testid="capture-undo"><Undo2 className="size-3.5" />Undo</Button>}</div>
          </div>}
        </Card></section>
    </div>
  );
}

/** One line, always. Idle: it says so. Active: who handed it to whom, who is working, who needs you. All from saved job rows. */
function StatusLine({ o, jobs, active, onSelect, onOpenDecision }: { o: any; jobs: any[]; active: any[]; onSelect: (id: string) => void; onOpenDecision: (id: string) => void }) {
  const workers = jobs.filter((j) => j.area !== "supervisor");
  const assigned = workers.filter((j) => j.parentId && !["done", "cancelled", "failed"].includes(j.status)).sort((a, b) => (a.createdAgoMs ?? 0) - (b.createdAgoMs ?? 0))[0];
  const working = workers.filter((j) => ["running", "waiting", "queued"].includes(j.status) && !j.needsYou);
  const needs = jobs.filter((j) => j.needsYou);
  const latest = jobs.flatMap((j) => (j.events ?? []).map((e: any) => ({ ...e, who: displayName(j.area) }))).sort((a: any, b: any) => b.at - a.at)[0];
  const quiet = active.length === 0 && needs.length === 0;
  return (
    <section aria-label="Status" aria-live="polite" className={cx("rounded-xl border px-3.5 py-2.5 flex items-center gap-x-4 gap-y-1.5 flex-wrap text-[14.5px] min-h-[46px]", !quiet && "max-sm:hidden", needs.length ? "border-amber-dim bg-amber-soft" : "border-line bg-surface")} data-testid="handoff-strip">
      <span data-testid="office-runner" className="flex items-center gap-2 min-w-0">
        <span className={cx("size-2 rounded-full shrink-0", quiet ? "bg-muted" : "bg-accent")} aria-hidden />
        {quiet ? <span>{jobs.length ? "All desks idle." : "All desks idle."} <span className="text-muted">Idle desks make zero model calls.</span></span> : <span className="text-muted">{active.length} active · model calls so far: {o.modelCalls}</span>}
      </span>
      {assigned && <button className="max-sm:hidden text-left" onClick={() => onSelect(assigned.id)} data-testid="handoff-assigned"><b className="font-medium">{assigned.parentRole === "Supervisor" || !assigned.parentRole ? "Jarvis" : assigned.parentRole}</b> <span aria-hidden>→</span><span className="sr-only">assigned</span> <b className="font-medium text-accent">{displayName(assigned.area)}</b> <span className="text-muted">{ago(assigned.createdAgoMs ?? 0)}</span></button>}
      {working.length > 0 && <span className="max-sm:hidden flex items-center gap-3 flex-wrap" data-testid="handoff-working">{working.map((j) => <button key={j.id} className="text-left" onClick={() => onSelect(j.id)}><b className="font-medium">{displayName(j.area)}</b> <span className="text-muted">{j.status === "queued" ? "has just arrived" : j.status === "waiting" ? "is waiting on helpers" : j.progress ? `step ${j.progress.done} of ${j.progress.total}` : (j.stage ?? "working").toLowerCase()}</span></button>)}</span>}
      {needs.length > 0 && <span className="max-sm:hidden flex items-center gap-3 flex-wrap" data-testid="handoff-needs">{needs.map((j) => <span key={j.id} className="flex items-center gap-2"><Hourglass className="size-3.5 text-amber" aria-hidden /><b className="font-medium">{displayName(j.area)}</b> <span className="text-muted break-words">needs you: {j.needsYou.text.replace(/^Proposed: /, "")}</span>{j.needsYou.decisionId ? <Button size="sm" variant="primary" onClick={() => onOpenDecision(j.needsYou.decisionId)}>Open decision</Button> : <Button size="sm" variant="amber" onClick={() => onSelect(j.id)}>Answer</Button>}</span>)}</span>}
      {!quiet && latest && <span className="ml-auto text-[13px] text-muted max-lg:hidden truncate max-w-[30ch]" title={latest.summary}>{latest.who}: {latest.summary}</span>}
      {quiet && o.runner?.message && <span className="ml-auto text-[13px] text-muted max-sm:hidden">{o.runner.message}</span>}
    </section>
  );
}

/** On a phone the room is hidden, so the one thing worth seeing comes first: the decision waiting, or the agent working. */
function PhoneNow({ jobs, active, onSelect, onOpenDecision }: { jobs: any[]; active: any[]; onSelect: (id: string) => void; onOpenDecision: (id: string) => void }) {
  const needs = jobs.find((j) => j.needsYou);
  const working = needs ? null : active.filter((j) => j.area !== "supervisor").sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1))[0] ?? active[0];
  if (!needs && !working) return null;
  if (needs) return (
    <section className="sm:hidden rounded-2xl border border-amber-dim bg-amber-soft p-4 space-y-3" aria-label="Waiting for you" data-testid="phone-now" data-kind="needs">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-amber"><Hourglass className="size-3.5" aria-hidden />{displayName(needs.area)} is waiting for you</div>
      <p className="text-[17px] leading-snug font-medium break-words">{needs.needsYou.text.replace(/^Proposed: /, "")}</p>
      <div className="flex gap-2 flex-wrap">
        {needs.needsYou.decisionId ? <Button variant="primary" onClick={() => onOpenDecision(needs.needsYou.decisionId)} className="flex-1">Review and decide <ArrowRight className="size-4" aria-hidden /></Button> : <Button variant="amber" onClick={() => onSelect(needs.id)} className="flex-1">Answer</Button>}
        <Button onClick={() => onSelect(needs.id)}>Details</Button>
      </div>
    </section>
  );
  return (
    <section className="sm:hidden rounded-2xl border border-line bg-surface p-4 space-y-2 lift" aria-label="Working now" data-testid="phone-now" data-kind="working">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-accent"><span className="size-2 rounded-full bg-accent settle" aria-hidden />{displayName(working.area)} is working</div>
      <p className="text-[16px] leading-snug font-medium break-words">{working.title}</p>
      <p className="text-[14px] text-muted">{doingNow(working)}</p>
      <Button size="sm" onClick={() => onSelect(working.id)}>See what it is doing</Button>
    </section>
  );
}

function ExtLink() { return <ExternalLink className="size-4" aria-hidden />; }
export { Link, Mono, ExtLink };

function PixelAgentsNote() {
  return (
    <details className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px]" data-testid="pixel-agents-note">
      <summary className="cursor-pointer flex items-center gap-2"><ExternalLink className="size-4" aria-hidden /><span className="font-medium">Open Pixel Agents</span><span className="text-muted">for your Claude Code terminals</span></summary>
      <div className="mt-2 space-y-2 text-muted">
        <p>Pixel Agents (by Pablo De Lucca) is a separate app that watches Claude Code terminal sessions on this computer. This room does not show those, and Pixel Agents does not show Jarvis&apos;s background workers. It has no documented way for another app to feed it jobs, so the two are kept apart.</p>
        <p>Start it next to Jarvis on its own local port. In a terminal:</p>
        <pre className="mono text-[14px] rounded-lg bg-bg border border-line px-3 py-2 overflow-x-auto select-all">npx pixel-agents --host 127.0.0.1 --port 3100</pre>
        <p>It prints an address ending in <span className="mono">?token=</span>. Open that address. Keep it private: whoever has it can launch agents. Jarvis never stores or logs it.</p>
        <a className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[14px] bg-surface2 border border-line text-fg" href="http://127.0.0.1:3100/" target="_blank" rel="noreferrer noopener" data-testid="open-pixel-agents"><ExternalLink className="size-4" aria-hidden />Open Pixel Agents on port 3100</a>
        <p className="text-[14px]">Not run in this build environment: it reads your Claude Code session files and edits hooks under your home folder, so it needs your own Mac and your say-so. Code license: MIT. Character art is credited to other authors; check it before bundling anything.</p>
      </div>
    </details>
  );
}
