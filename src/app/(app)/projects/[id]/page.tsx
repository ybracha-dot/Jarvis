"use client";
import { Suspense, use, useState } from "react";
import Link from "next/link";
import { Pin, PinOff, Pencil, Trash2, Check, X, Undo2, ArrowLeft, Plug } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Notice, Field, inputCls, cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { ORIGIN } from "../page";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <Suspense fallback={<Spinner />}><Project id={id} /></Suspense>; }
const KIND: Record<string, string> = { decision: "Decided", fact: "Fact", action: "To do", question: "Open question", option: "Option" };

function Project({ id }: { id: string }) {
  const q = useQuery<any>(`/projects/${id}`, { poll: 3000 });
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [add, setAdd] = useState({ op: "decide", key: "", text: "" });
  const results = useQuery<any>(`/results?project=${id}`, { poll: 4000 });
  const edit = useAction(async (f: any, text: string) => { await api(`/projects/facts/${f.id}/edit`, { body: { text, expectedRevision: q.data.project.revision } }); setEditing(null); setMsg(null); });
  const forget = useAction(async (fid: string) => { await api(`/projects/facts/${fid}/forget`, { body: { confirm: true } }); setSel(null); });
  const pin = useAction(async (fid: string, pinned: boolean) => { await api(`/projects/facts/${fid}/pin`, { body: { pinned } }); });
  const resolve = useAction(async (fid: string, accept: boolean) => { await api(`/projects/facts/${fid}/resolve`, { body: { accept } }); });
  const undo = useAction(async (eid: string) => { await api(`/projects/events/${eid}/undo`, { body: {} }); });
  const decide = useAction(async (o: any) => { await api(`/projects/${id}/update`, { body: { eventId: `ui-${crypto.randomUUID()}`, expectedRevision: q.data.project.revision, changes: [{ op: "decide", key: o.key, text: o.text }] } }); });
  const addItem = useAction(async () => { const r = await api(`/projects/${id}/update`, { body: { eventId: `ui-${crypto.randomUUID()}`, expectedRevision: q.data.project.revision, changes: [{ op: add.op, key: add.key || add.text.slice(0, 40), text: add.text }] } }); if (r.conflict) throw new Error("Something changed while you were typing. Review the page and add it again."); setAdd({ ...add, text: "", key: "" }); });
  if (q.loading && !q.data) return <Spinner label="Opening the project" />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} offline={q.error.status === 0} />;
  const d = q.data; const all = [...d.current, ...d.options, ...d.suggestions, ...d.actions, ...d.questions, ...d.history];
  const f = all.find((x: any) => x.id === sel) ?? null;
  const latest = d.events.find((e: any) => !e.undone_at);
  const err = [edit.error, forget.error, undo.error, decide.error, addItem.error, resolve.error].find(Boolean);

  const Row = ({ x, children }: { x: any; children?: React.ReactNode }) => (
    <li className={cx("rounded-xl border p-4", sel === x.id ? "border-accent bg-accent-soft" : "border-line bg-surface")} data-testid="project-fact" data-key={x.key}>
      <button className="text-left w-full" onClick={() => setSel(x.id === sel ? null : x.id)} aria-pressed={sel === x.id}>
        <div className="flex items-center gap-2 flex-wrap mb-1"><Badge tone={x.kind === "decision" ? "accent" : "neutral"}>{KIND[x.kind] ?? x.kind}</Badge><span className="text-[13px] text-muted uppercase tracking-wider">{x.key.replace(/-/g, " ")}</span>{x.pinned && <Badge tone="amber">pinned</Badge>}</div>
        {editing?.id === x.id ? null : <p className="text-[16px] leading-snug break-words">{x.text}</p>}
        <p className="text-[13px] text-muted mt-1.5">{ORIGIN[x.origin] ?? x.origin} · {fmtDateTime(x.asOf)}</p>
      </button>
      {editing && editing.id === x.id && <div className="mt-2 space-y-2"><textarea className={cx(inputCls, "min-h-16")} value={editing.text} onChange={(e) => setEditing({ id: x.id, text: e.target.value })} aria-label="Edit text" /><div className="flex gap-2"><Button size="sm" variant="primary" busy={edit.busy} onClick={() => edit.run(x, editing.text)}><Check className="size-4" />Save</Button><Button size="sm" onClick={() => setEditing(null)}><X className="size-4" />Cancel</Button></div></div>}
      {children}
    </li>
  );
  const Actions = ({ x }: { x: any }) => (
    <div className="mt-3 flex gap-1.5 flex-wrap">
      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: x.id, text: x.text })}><Pencil className="size-4" />Edit</Button>
      <Button size="sm" variant="ghost" onClick={() => pin.run(x.id, !x.pinned)}>{x.pinned ? <><PinOff className="size-4" />Unpin</> : <><Pin className="size-4" />Pin</>}</Button>
      <Button size="sm" variant="ghost" busy={forget.busy} onClick={() => { if (window.confirm("Forget this? The text is erased from Jarvis and from what Claude can read.")) forget.run(x.id); }}><Trash2 className="size-4" />Forget</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href="/projects" className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-fg"><ArrowLeft className="size-4" />Projects</Link>
      <header className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0"><h1 className="text-2xl font-semibold tracking-tight" data-testid="project-title">{d.project.name}</h1>
          <p className="text-[14px] text-muted mt-1">{d.project.lastOrigin ? <>Last update <b className="text-fg font-medium">{ORIGIN[d.project.lastOrigin] ?? d.project.lastOrigin}</b>, {fmtDateTime(d.project.updatedAt)}. </> : "No updates yet. "}<Mono className="text-[13px]">revision {d.project.revision} · {d.workspace.id}</Mono></p></div>
        {latest && <Button size="sm" busy={undo.busy} onClick={() => undo.run(latest.event_id)} data-testid="project-undo"><Undo2 className="size-4" />Undo last update</Button>}
      </header>
      {err && <ErrorBox error={err as any} />}{msg && <Notice>{msg}</Notice>}

      <section aria-label="Current answer" className="rounded-2xl border border-line bg-surface metal p-5" data-testid="project-answer">
        <h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium mb-2">What we decided</h2>
        <p className="text-[17px] leading-relaxed break-words">{d.answer}</p>
        <p className="text-[13px] text-muted mt-3">Open this in Claude with <Mono>get_project_context</Mono>. Claude will read this same page.</p>
      </section>

      <div className={cx("grid gap-6", f ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "")}>
        <div className="space-y-6 min-w-0">
          {d.suggestions.length > 0 && <section aria-label="Waiting for you"><SectionTitle>Waiting for your confirmation</SectionTitle><ul className="space-y-3">{d.suggestions.map((x: any) => <Row key={x.id} x={x}><div className="mt-3 flex gap-2"><Button size="sm" variant="primary" onClick={() => resolve.run(x.id, true)}>Confirm as decided</Button><Button size="sm" onClick={() => resolve.run(x.id, false)}>Not this</Button></div></Row>)}</ul></section>}
          <section aria-label="Decided"><SectionTitle>Decided and known</SectionTitle>
            {d.current.length === 0 ? <p className="text-[15px] text-muted">Nothing decided yet.</p> : <ul className="space-y-3">{d.current.map((x: any) => <Row key={x.id} x={x}>{sel === x.id && <Actions x={x} />}</Row>)}</ul>}</section>
          {d.options.length > 0 && <section aria-label="Open options"><SectionTitle>Still deciding</SectionTitle><ul className="space-y-3">{d.options.map((x: any) => <Row key={x.id} x={x}><div className="mt-3 flex gap-1.5 flex-wrap"><Button size="sm" variant="primary" busy={decide.busy} onClick={() => decide.run(x)}>Choose this</Button>{sel === x.id && <Actions x={x} />}</div></Row>)}</ul></section>}
          {(d.actions.length > 0 || d.questions.length > 0) && <section aria-label="To do and questions"><SectionTitle>To do and open questions</SectionTitle><ul className="space-y-3">{[...d.actions, ...d.questions].map((x: any) => <Row key={x.id} x={x}>{sel === x.id && <Actions x={x} />}</Row>)}</ul></section>}
          <section aria-label="Add"><SectionTitle>Add something</SectionTitle><Card className="p-4 space-y-3">
            <div className="grid sm:grid-cols-[150px_1fr] gap-3"><Field label="Kind"><select className={inputCls} value={add.op} onChange={(e) => setAdd({ ...add, op: e.target.value })}>{[["decide", "Decision"], ["fact", "Fact"], ["option", "Option"], ["action", "To do"], ["question", "Question"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Topic" hint="Same topic replaces the earlier decision."><input className={inputCls} value={add.key} onChange={(e) => setAdd({ ...add, key: e.target.value })} placeholder="dates, lodging, budget" /></Field></div>
            <Field label="Text"><textarea className={cx(inputCls, "min-h-16")} value={add.text} onChange={(e) => setAdd({ ...add, text: e.target.value })} data-testid="add-text" /></Field>
            <Button variant="primary" busy={addItem.busy} disabled={add.text.trim().length < 1} onClick={() => addItem.run()} data-testid="add-save">Save to {d.project.name}</Button></Card></section>
          {d.history.length > 0 && <section aria-label="History"><SectionTitle>History, kept for reference</SectionTitle><ul className="space-y-2">{d.history.map((x: any) => <li key={x.id}><button onClick={() => setSel(x.id)} className="w-full text-left rounded-lg border border-line px-3.5 py-2.5 text-[14px] text-muted"><span className="line-through decoration-line-strong">{x.text || "(forgotten)"}</span> <span className="text-[13px]">· {x.status === "retracted" ? "withdrawn" : "replaced"} · {ORIGIN[x.origin] ?? x.origin}, {fmtDateTime(x.asOf)}</span></button></li>)}</ul></section>}
          {results.data?.results?.length > 0 && <section aria-label="Results"><SectionTitle>Drafts, briefs and answers for this project</SectionTitle><ul className="space-y-2" data-testid="project-results">{results.data.results.map((r: any) => <li key={r.id}><Link href={r.link} className="block rounded-xl border border-line bg-surface hover:border-line-strong p-3.5"><div className="flex items-center gap-2 flex-wrap"><Badge tone="accent">{r.kind}</Badge><b className="text-[15px] font-medium break-words min-w-0">{r.title}</b><span className="text-[13px] text-muted ml-auto">v{r.version}{r.state === "stale" ? " · out of date" : ""}</span></div>{r.summary && <p className="text-[14px] text-muted mt-1 break-words">{r.summary}</p>}</Link></li>)}</ul></section>}
          <section aria-label="Updates"><SectionTitle>Updates</SectionTitle><ol className="space-y-1.5 text-[14px]">{d.events.map((e: any) => <li key={e.event_id} className={cx("flex gap-2 flex-wrap", e.undone_at && "text-muted line-through")}><Mono className="text-[13px] text-muted">r{e.rev}</Mono><span>{ORIGIN[e.origin] ?? e.origin}</span><span className="text-muted">{fmtDateTime(e.at)}{e.client ? ` · ${e.client}` : ""}{e.undone_at ? " · undone" : ""}</span></li>)}{d.events.length === 0 && <li className="text-muted">None yet.</li>}</ol></section>
        </div>
        {f && <aside aria-label="Evidence" className="xl:sticky xl:top-16 self-start"><Card className="p-4 space-y-3" data-testid="project-inspector">
          <div className="flex items-center gap-2"><b className="text-[15px]">Where this came from</b><Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSel(null)} aria-label="Close"><X className="size-4" /></Button></div>
          <p className="text-[15px] break-words">{f.text || "(forgotten)"}</p>
          <dl className="grid grid-cols-[96px_1fr] gap-y-1.5 text-[14px]"><dt className="text-muted">Source</dt><dd>{f.source ?? ORIGIN[f.origin]}</dd><dt className="text-muted">Recorded</dt><dd>{fmtDateTime(f.recordedAt)}</dd><dt className="text-muted">As of</dt><dd>{fmtDateTime(f.asOf)}</dd><dt className="text-muted">Revision</dt><dd><Mono>{f.revision}</Mono></dd><dt className="text-muted">Event</dt><dd className="break-all"><Mono className="text-[13px]">{f.eventId}</Mono></dd>{f.locator && <><dt className="text-muted">Locator</dt><dd className="break-all">{f.locator}</dd></>}{f.note && <><dt className="text-muted">Note</dt><dd>{f.note}</dd></>}{f.supersedes && <><dt className="text-muted">Replaced</dt><dd>an earlier version</dd></>}</dl>
        </Card></aside>}
      </div>
      <p className="text-[13px] text-muted flex items-center gap-1.5"><Plug className="size-4" />Claude reads and writes this project through the Jarvis connector. See <Link href="/connections" className="text-accent">Connections</Link>.</p>
    </div>
  );
}
