"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, GitBranchPlus, Search, FolderDown, FolderUp, Lock } from "lucide-react";
import { api, useQuery, useAction, invalidate } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Empty, Notice, Field, inputCls, cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

const TABS = ["Memory", "Map", "Timeline", "Vault", "Private room"] as const;
const KIND_LABEL: Record<string, string> = { preference: "Stated preference", habit: "Observed habit", inference: "Inference", project_fact: "Project fact", commitment_dated: "Dated commitment", person: "Person", course: "Course", decision: "Decision", inbox: "Inbox", skill: "Skill" };

export default function MemoryPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Memory");
  const [sel, setSel] = useState<string | null>(null);
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold tracking-tight">Memory</h1><p className="text-[15px] text-muted mt-1">What Jarvis believes right now, and why. Everything here can be changed or forgotten.</p></header>
    <div role="tablist" className="flex gap-1 p-1 rounded-lg bg-surface border border-line w-fit max-w-full overflow-x-auto">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("px-3 py-1.5 rounded-md text-sm whitespace-nowrap", tab === t ? "bg-surface2 text-fg" : "text-muted")}>{t}</button>)}</div>
    {tab === "Memory" && <Overview sel={sel} setSel={setSel} />}
    {tab === "Map" && <MapView sel={sel} setSel={setSel} />}
    {tab === "Timeline" && <Timeline onPick={(id) => { setSel(id); setTab("Memory"); }} />}
    {tab === "Vault" && <Vault />}
    {tab === "Private room" && <Private />}
  </div>;
}

function Notes({ sel, setSel }: { sel: string | null; setSel: (s: string | null) => void }) {
  const [q, setQ] = useState(""); const [creating, setCreating] = useState(false);
  const list = useQuery<any>(q.trim() ? `/memory/search?q=${encodeURIComponent(q)}` : "/memory/notes");
  const items: any[] = list.data?.results ?? list.data?.notes ?? [];
  const folders = [...new Set(items.map((n) => n.folder))].sort();
  return <div className="grid md:grid-cols-5 gap-5">
    <div className="md:col-span-2 space-y-3">
      <div className="flex gap-2"><div className="relative flex-1"><Search className="size-4 absolute left-3 top-2.5 text-muted" aria-hidden /><input aria-label="Search notes" className={cx(inputCls, "pl-9")} placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} /></div><Button onClick={() => setCreating(true)} aria-label="New note"><Plus className="size-4" /></Button></div>
      {creating && <NewNote onDone={(id) => { setCreating(false); if (id) setSel(id); }} />}
      {list.loading && !list.data && <Spinner />}{list.error && !list.data && <ErrorBox error={list.error} onRetry={list.reload} />}
      {items.length === 0 && !list.loading && <Card><Empty title={q ? "No matches" : "No notes yet"} /></Card>}
      {folders.map((f) => <div key={f}><div className="text-[12px] uppercase tracking-wider text-muted mb-1">{f}</div><ul className="space-y-1">{items.filter((n) => n.folder === f).map((n) => (
        <li key={n.id}><button onClick={() => setSel(n.id)} className={cx("w-full text-left rounded-lg px-3 py-2 text-sm border", sel === n.id ? "border-accent-dim bg-[#0b1c29]" : "border-line bg-surface hover:border-[#37404a]")}>
          <div className="flex items-center gap-2"><span className="font-medium break-words min-w-0">{n.title}</span>{n.provisional ? <Badge tone="amber">provisional</Badge> : null}</div><div className="text-[13px] text-muted">{KIND_LABEL[n.kind] ?? n.kind} · {n.scope}</div></button></li>))}</ul></div>)}
    </div>
    <div className="md:col-span-3">{sel ? <Editor id={sel} onGone={() => setSel(null)} onPick={setSel} /> : <Card><Empty title="Pick a note" hint="Notes are Markdown with frontmatter and [[wikilinks]]. They export to an Obsidian vault." /></Card>}</div>
  </div>;
}

function NoteRow({ n, sel, setSel }: { n: any; sel: string | null; setSel: (s: string | null) => void }) {
  return <li><button onClick={() => setSel(sel === n.id ? null : n.id)} aria-pressed={sel === n.id} data-testid="memory-row" className={cx("w-full text-left rounded-xl border p-4 transition-colors", sel === n.id ? "border-accent bg-[#0b1c29]" : "border-line bg-surface hover:border-[#3b434e]")}>
    <div className="flex items-center gap-2 flex-wrap"><b className="text-[16px] font-medium break-words min-w-0">{n.title}</b>{n.pinned && <Badge tone="amber">pinned</Badge>}{n.provisional ? <Badge tone="amber">to confirm</Badge> : null}{n.project_name && <Badge tone="accent">{n.project_name}</Badge>}</div>
    {n.body && <p className="text-[15px] text-muted mt-1 line-clamp-2 break-words">{String(n.body).replace(/\s+/g, " ").slice(0, 200)}</p>}
    <p className="text-[13px] text-muted mt-1.5">{KIND_LABEL[n.kind] ?? n.kind} · from {n.source} · {fmtDateTime(n.updated_at)}</p></button></li>;
}
function Overview({ sel, setSel }: { sel: string | null; setSel: (s: string | null) => void }) {
  const [q, setQ] = useState(""); const [creating, setCreating] = useState(false);
  const ov = useQuery<any>("/memory/overview", { poll: 5000 });
  const ans = useQuery<any>(q.trim().length >= 2 ? `/memory/answer?q=${encodeURIComponent(q.trim())}` : null);
  if (ov.loading && !ov.data) return <Spinner label="Opening memory" />;
  if (ov.error && !ov.data) return <ErrorBox error={ov.error} onRetry={ov.reload} offline={ov.error.status === 0} />;
  const o = ov.data; const total = o.pinned.length + o.review.length + o.known.length + o.inbox.length;
  const Group = ({ title, items }: { title: string; items: any[] }) => items.length ? <section aria-label={title}><SectionTitle>{title}</SectionTitle><ul className="space-y-2.5">{items.map((n) => <NoteRow key={n.id} n={n} sel={sel} setSel={setSel} />)}</ul></section> : null;
  return <div className={cx("grid gap-6", sel ? "xl:grid-cols-[minmax(0,1fr)_420px]" : "")}>
    <div className="space-y-6 min-w-0">
      <div className="space-y-3"><div className="flex gap-2"><div className="relative flex-1"><Search className="size-4 absolute left-3.5 top-3.5 text-muted" aria-hidden /><input aria-label="Ask memory" className={cx(inputCls, "pl-10 py-2.5 text-[16px]")} placeholder="What does Jarvis think about… (dates, lodging, how I study)" value={q} onChange={(e) => setQ(e.target.value)} data-testid="memory-ask" /></div><Button onClick={() => setCreating((v) => !v)}><Plus className="size-4" />New note</Button></div>
        {q.trim().length >= 2 && ans.data && <section className="rounded-2xl border border-line bg-surface metal p-5" data-testid="memory-answer" aria-live="polite">
          {ans.data.answer ? <><h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium mb-1">Current answer</h2><p className="text-[17px] font-medium break-words">{ans.data.answer.title}</p><p className="text-[16px] mt-1 break-words">{ans.data.answer.text}</p><p className="text-[14px] text-muted mt-2"><b className="text-fg font-medium">Why:</b> {ans.data.answer.why} <a className="text-accent" href={ans.data.answer.href}>Open</a></p>
            {ans.data.alternatives.length > 0 && <details className="mt-2 text-[14px]"><summary className="cursor-pointer text-muted">Also related ({ans.data.alternatives.length})</summary><ul className="mt-1 space-y-1">{ans.data.alternatives.map((a: any, i: number) => <li key={i}><b className="font-medium">{a.title}</b> <span className="text-muted">{a.text}</span></li>)}</ul></details>}</> : <p className="text-[15px] text-muted">{ans.data.none} Jarvis only knows what was saved, imported or decided in a project.</p>}</section>}
        {creating && <NewNote onDone={(id) => { setCreating(false); if (id) setSel(id); }} />}</div>
      {o.projects.length > 0 && <section aria-label="Project memory"><SectionTitle>Project decisions</SectionTitle><ul className="grid sm:grid-cols-2 gap-2.5">{o.projects.map((p: any) => <li key={p.id}><a href={`/projects/${p.id}`} className="block rounded-xl border border-line bg-surface hover:border-[#3b434e] p-4"><b className="text-[16px] font-medium">{p.name}</b><p className="text-[14px] text-muted">{p.n} current decision{p.n === 1 ? "" : "s"}</p></a></li>)}</ul></section>}
      {total === 0 && <Card className="p-6"><Empty title="Nothing remembered yet" hint="Say “Remember for Jarvis: …” in ordinary Claude, save a note here, or let a project collect your decisions." /></Card>}
      <Group title="Pinned" items={o.pinned} /><Group title="To confirm" items={o.review} /><Group title="What Jarvis knows" items={o.known} /><Group title="Saved from Claude and imports, not sorted yet" items={o.inbox} />
    </div>
    {sel && <aside aria-label="Memory inspector" className="xl:sticky xl:top-16 self-start min-w-0"><Editor id={sel} onGone={() => setSel(null)} onPick={setSel} /></aside>}
  </div>;
}

function NewNote({ onDone }: { onDone: (id?: string) => void }) {
  const [f, setF] = useState({ title: "", body: "", kind: "preference", scope: "global" });
  const save = useAction(async () => { const r = await api("/memory/notes", { body: f }); onDone(r.id); });
  return <Card className="p-3 space-y-2"><Field label="Title"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Kind"><select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field><Field label="Scope" hint="global, course:id or task:id"><input className={inputCls} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></Field></div>
    <Field label="Body"><textarea className={cx(inputCls, "min-h-24")} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Use [[Another note]] to link" /></Field>
    {save.error && <ErrorBox error={save.error} />}<div className="flex gap-2"><Button variant="primary" busy={save.busy} disabled={!f.title} onClick={() => save.run()}>Create</Button><Button variant="ghost" onClick={() => onDone()}>Cancel</Button></div></Card>;
}

function Editor({ id, onGone, onPick }: { id: string; onGone: () => void; onPick: (id: string) => void }) {
  const q = useQuery<any>(`/memory/notes/${id}`);
  const n = q.data?.note;
  const [f, setF] = useState<any>(null); const [confirm, setConfirm] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (n) { setF({ title: n.title, body: n.body, scope: n.scope, confidence: n.confidence, effectiveTo: n.effective_to?.slice(0, 10) ?? "" }); setConfirm(false); setMsg(null); } }, [n?.id, n?.updated_at]);
  const save = useAction(async () => { await api(`/memory/notes/${id}`, { method: "PATCH", body: { title: f.title, body: f.body, scope: f.scope, confidence: Number(f.confidence), effectiveTo: f.effectiveTo ? new Date(f.effectiveTo).toISOString() : null } }); setMsg("Saved."); });
  const supersede = useAction(async () => { const r = await api(`/memory/notes/${id}/supersede`, { body: { body: f.body } }); setMsg("Superseded. The old version is kept for history."); onPick(r.id); });
  const del = useAction(async () => { await api(`/memory/notes/${id}`, { method: "DELETE", noInvalidate: true }); onGone(); setTimeout(invalidate, 100); });
  const projects = useQuery<any>("/projects"); const allNotes = useQuery<any>("/memory/notes");
  const [moveTo, setMoveTo] = useState(""); const [mergeInto, setMergeInto] = useState("");
  const pin = useAction(async (v: boolean) => { await api(`/memory/notes/${id}/pin`, { body: { pinned: v } }); });
  const move = useAction(async () => { await api(`/memory/notes/${id}/move`, { body: moveTo === "global" ? { scope: "global", projectId: null } : { projectId: moveTo } }); setMsg("Moved. Undo puts it back."); });
  const merge = useAction(async () => { await api(`/memory/notes/${id}/merge`, { body: { intoId: mergeInto } }); setMsg("Merged into the other note. The old one moved to history."); onPick(mergeInto); });
  const undo = useAction(async () => { await api(`/memory/notes/${id}/undo`, { body: {} }); setMsg("Undone."); });
  const autolearn = useAction(async (v: boolean) => { await api(`/memory/notes/${id}`, { method: "PATCH", body: { autoLearn: v } }); });
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!n || !f) return null;
  const err = save.error || supersede.error || del.error || pin.error || move.error || merge.error || undo.error;
  return <Card className="p-4 space-y-4" data-testid="note-editor">
    <div className="flex items-center gap-2 flex-wrap"><Badge tone="accent">{KIND_LABEL[n.kind] ?? n.kind}</Badge><Badge>{n.source}</Badge>{n.provisional ? <Badge tone="amber">provisional</Badge> : null}<Mono className="text-[12px] text-muted ml-auto">{n.id}</Mono></div>
    {n.conflict && <Notice>This note changed in the vault and in Jarvis. The Jarvis copy was kept. Open Vault to choose.</Notice>}
    <Field label="Title"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
    <Field label="Body"><textarea className={cx(inputCls, "min-h-36 font-mono text-[14px]")} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
    <div className="grid grid-cols-3 gap-2"><Field label="Scope"><input className={inputCls} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} /></Field>
      <Field label="Confidence"><input type="number" min={0} max={1} step={0.1} className={inputCls} value={f.confidence} onChange={(e) => setF({ ...f, confidence: e.target.value })} /></Field>
      <Field label="Expires"><input type="date" className={inputCls} value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} /></Field></div>
    <div className="flex flex-wrap gap-2 items-end" data-testid="memory-actions">
      <Button size="sm" busy={pin.busy} onClick={() => pin.run(!n.pinned)}>{n.pinned ? "Unpin" : "Pin"}</Button>
      {n.prev && <Button size="sm" busy={undo.busy} onClick={() => undo.run()} data-testid="memory-undo">Undo last change</Button>}
      <select aria-label="Move to" className={cx(inputCls, "w-auto")} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}><option value="">Move to…</option><option value="global">Everywhere</option>{projects.data?.projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      {moveTo && <Button size="sm" busy={move.busy} onClick={() => move.run()}>Move</Button>}
      <select aria-label="Merge into" className={cx(inputCls, "w-auto max-w-48")} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}><option value="">Merge into…</option>{allNotes.data?.notes.filter((x: any) => x.id !== id).map((x: any) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
      {mergeInto && <Button size="sm" busy={merge.busy} onClick={() => merge.run()}>Merge</Button>}</div>
    <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" className="accent-[#67d4ff]" checked={!!n.auto_learn} onChange={(e) => autolearn.run(e.target.checked)} />Let Jarvis learn automatically on this topic</label>
    {err && <ErrorBox error={err} />}{msg && <Notice tone="accent">{msg}</Notice>}
    <div className="flex flex-wrap gap-2"><Button variant="primary" busy={save.busy} onClick={() => save.run()}>Save</Button><Button busy={supersede.busy} onClick={() => supersede.run()}><GitBranchPlus className="size-4" />Save as new version</Button>
      {!confirm ? <Button variant="danger" onClick={() => setConfirm(true)}><Trash2 className="size-4" />Forget</Button> : <Button variant="danger" busy={del.busy} onClick={() => del.run()}>Confirm: remove from search, vault and exports</Button>}</div>
    <div className="grid sm:grid-cols-2 gap-4 pt-3 border-t border-line text-[14px]">
      <div><div className="text-[12px] uppercase tracking-wider text-muted mb-1">Links</div>{q.data.links.length ? <ul className="space-y-0.5">{q.data.links.map((l: any) => <li key={l.title}>{l.id ? <button className="text-accent hover:underline" onClick={() => onPick(l.id)}>{l.title}</button> : <span className="text-muted">{l.title} (no note)</span>}</li>)}</ul> : <span className="text-muted">None</span>}</div>
      <div><div className="text-[12px] uppercase tracking-wider text-muted mb-1">Backlinks</div>{q.data.backlinks.length ? <ul className="space-y-0.5">{q.data.backlinks.map((b: any) => <li key={b.id}><button className="text-accent hover:underline" onClick={() => onPick(b.id)}>{b.title}</button></li>)}</ul> : <span className="text-muted">None</span>}</div>
    </div>
    <p className="text-[13px] text-muted">Why this exists: source {n.source}{n.source_ref ? ` (${n.source_ref})` : ""}, created {fmtDateTime(n.created_at)}{n.user_edited ? ", edited by you" : ""}.</p>
  </Card>;
}

function MapView({ sel, setSel }: { sel: string | null; setSel: (s: string) => void }) {
  const list = useQuery<any>("/memory/notes");
  const center = sel ?? list.data?.notes?.[0]?.id ?? null;
  const g = useQuery<any>(center ? `/memory/graph/${center}` : null);
  if (list.loading && !list.data) return <Spinner />;
  if (!center) return <Card><Empty title="No notes to map" /></Card>;
  const nodes: any[] = g.data?.nodes ?? []; const others = nodes.filter((n) => !n.center); const c = nodes.find((n) => n.center);
  const W = 560, H = 360, cx0 = W / 2, cy0 = H / 2;
  const pos = (i: number) => { const a = (i / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2; return { x: cx0 + Math.cos(a) * 190, y: cy0 + Math.sin(a) * 125 }; };
  return <div className="space-y-4">
    <Field label="Centered on"><select className={inputCls} value={center} onChange={(e) => setSel(e.target.value)}>{list.data.notes.map((n: any) => <option key={n.id} value={n.id}>{n.title}</option>)}</select></Field>
    {g.data && <Card className="p-2 overflow-x-auto"><svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px] max-h-[380px]" role="img" aria-label={`Map around ${c?.title}. ${others.length} neighbors. A text list follows.`}>
      {g.data.edges.map((e: any, i: number) => { const a = e.from === c?.id ? { x: cx0, y: cy0 } : pos(others.findIndex((n) => n.id === e.from)); const b = e.to === c?.id ? { x: cx0, y: cy0 } : pos(others.findIndex((n) => n.id === e.to)); return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2f3640" strokeWidth={1.2} />; })}
      {c && <g><circle cx={cx0} cy={cy0} r={34} fill="#12324a" stroke="#67d4ff" /><text x={cx0} y={cy0 + 4} textAnchor="middle" fill="#eceef0" fontSize="12">{c.title.length > 14 ? c.title.slice(0, 13) + "…" : c.title}</text></g>}
      {others.map((n, i) => { const p = pos(i); return <g key={n.id} onClick={() => setSel(n.id)} className="cursor-pointer" tabIndex={0} role="button" aria-label={`Center on ${n.title}`} onKeyDown={(e) => e.key === "Enter" && setSel(n.id)}><circle cx={p.x} cy={p.y} r={26} fill="#1a1e23" stroke="#3a424d" /><text x={p.x} y={p.y + 4} textAnchor="middle" fill="#cfd3d8" fontSize="11">{n.title.length > 12 ? n.title.slice(0, 11) + "…" : n.title}</text></g>; })}
    </svg></Card>}
    <section><SectionTitle>As a list</SectionTitle>{g.data && <ul className="text-sm space-y-1">{others.length === 0 ? <li className="text-muted">No links yet. Add [[wikilinks]] to a note.</li> : g.data.edges.map((e: any, i: number) => { const a = nodes.find((n) => n.id === e.from), b = nodes.find((n) => n.id === e.to); return <li key={i}><button className="text-accent hover:underline" onClick={() => setSel(a.id)}>{a.title}</button> <span className="text-muted">links to</span> <button className="text-accent hover:underline" onClick={() => setSel(b.id)}>{b.title}</button></li>; })}</ul>}</section>
  </div>;
}

function Timeline({ onPick }: { onPick: (id: string) => void }) {
  const q = useQuery<any>("/memory/timeline");
  if (q.loading && !q.data) return <Spinner />;
  return <ol className="space-y-2 border-l border-line pl-4 ml-1">{q.data?.notes.map((n: any) => <li key={n.id}><Mono className="text-[12px] text-muted block">{fmtDateTime(n.created_at)} · {n.source}</Mono><button className="text-sm hover:underline text-left" onClick={() => onPick(n.id)}>{n.title}</button> <Badge>{n.folder}</Badge>{n.superseded_by && <Badge tone="amber" className="ml-1">superseded</Badge>}</li>)}</ol>;
}

function Learned({ onPick }: { onPick: (id: string) => void }) {
  const q = useQuery<any>("/memory/learned");
  const confirm = useAction(async (id: string) => { await api(`/memory/notes/${id}`, { method: "PATCH", body: { confidence: 1, provisional: false } }); });
  const del = useAction(async (id: string) => { await api(`/memory/notes/${id}`, { method: "DELETE" }); });
  if (q.loading && !q.data) return <Spinner />;
  return <div className="space-y-3"><Notice tone="neutral">Things Jarvis noticed or inferred, not things you wrote. Uncertain ones stay provisional and are never used until you confirm them.</Notice>
    {q.data?.notes.length === 0 && <Card><Empty title="Nothing learned yet" /></Card>}
    {q.data?.notes.map((n: any) => <Card key={n.id} className="p-3.5 space-y-1.5"><div className="flex items-center gap-2 flex-wrap"><button className="text-sm font-medium hover:underline" onClick={() => onPick(n.id)}>{n.title}</button><Badge>{KIND_LABEL[n.kind]}</Badge><Badge tone={n.provisional ? "amber" : "accent"}>{n.provisional ? "provisional" : "in use"}</Badge><Mono className="ml-auto text-[13px] text-muted">confidence {n.confidence}</Mono></div>
      <p className="text-[14px] text-muted break-words">{n.body}</p><div className="flex gap-2"><Button size="sm" onClick={() => confirm.run(n.id)}>Confirm</Button><Button size="sm" variant="danger" onClick={() => del.run(n.id)}>Forget</Button></div></Card>)}</div>;
}

function Vault() {
  const [rep, setRep] = useState<any>(null);
  const exp = useAction(async () => { setRep({ kind: "export", ...(await api("/memory/export", { body: {} })) }); });
  const imp = useAction(async () => { setRep({ kind: "import", ...(await api("/memory/import", { body: {} })) }); });
  const q = useQuery<any>("/memory/notes");
  const conflicts = (q.data?.notes ?? []).filter((n: any) => n.conflict);
  const resolve = useAction(async (id: string, keep: string) => { await api("/memory/conflict", { body: { id, keep } }); });
  return <div className="space-y-4"><Notice tone="neutral">The vault is a folder of Markdown files you can open in Obsidian. Jarvis only writes inside it and never follows links out of it. Syncing a vault on a sleeping Mac is not something a cloud worker can do.</Notice>
    <div className="flex gap-2 flex-wrap"><Button busy={exp.busy} onClick={() => exp.run()}><FolderUp className="size-4" />Export to vault</Button><Button busy={imp.busy} onClick={() => imp.run()}><FolderDown className="size-4" />Import changes from vault</Button></div>
    {(exp.error || imp.error) && <ErrorBox error={(exp.error || imp.error)!} />}
    {rep?.kind === "export" && <Notice tone="accent">Exported {rep.written} notes to <Mono>{rep.root}</Mono>. Also wrote Jarvis memory.base and Jarvis map.canvas.</Notice>}
    {rep?.kind === "import" && <Card className="p-3 text-sm space-y-1" data-testid="import-report"><div>Updated: {rep.updated.length ? rep.updated.join(", ") : "none"}</div><div>Created: {rep.created.length ? rep.created.join(", ") : "none"}</div><div>Unchanged: {rep.unchanged}</div>{rep.conflicts.length > 0 && <div className="text-amber">Conflicts: {rep.conflicts.join(", ")}</div>}{rep.rejected.map((r: any, i: number) => <div key={i} className="text-danger">Rejected {r.file}: {r.reason}</div>)}</Card>}
    {conflicts.map((n: any) => <Card key={n.id} className="p-3 space-y-2"><div className="text-sm font-medium">Conflict: {n.title}</div><pre className="text-[13px] whitespace-pre-wrap bg-bg border border-line rounded-lg p-2 max-h-32 overflow-auto">{n.conflict.fileBody}</pre><div className="flex gap-2"><Button size="sm" onClick={() => resolve.run(n.id, "app")}>Keep Jarvis copy</Button><Button size="sm" onClick={() => resolve.run(n.id, "file")}>Use vault copy</Button></div></Card>)}
  </div>;
}

function Private() {
  const [on, setOn] = useState(false); const [msg, setMsg] = useState(""); const [log, setLog] = useState<{ who: string; text: string }[]>([]);
  const [save, setSave] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  const send = useAction(async () => { const m = msg; setMsg(""); const [a, b] = await Promise.all([api("/reflect", { body: { message: m, perspective: "A" } }), api("/reflect", { body: { message: m, perspective: "B" } })]); setLog((l) => [...l, { who: "You", text: m }, { who: "A", text: a.reply }, { who: "B", text: b.reply }]); });
  const keep = useAction(async () => { await api("/reflect/save", { body: { takeaway: save } }); setSaved(true); });
  return <div className="space-y-4 max-w-2xl">
    <Notice>Two AI perspectives to help you think and prepare questions for a licensed professional. They are not a therapist, do not diagnose, and do not give medication advice.</Notice>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="accent-[#67d4ff] size-4" checked={on} onChange={(e) => { setOn(e.target.checked); if (!e.target.checked) { setLog([]); setSave(null); } }} /><Lock className="size-4 text-muted" aria-hidden />Start a private session. Text only. Nothing is saved, logged or searchable.</label>
    {on && <>
      <ul className="space-y-2" data-testid="reflection-log">{log.map((l, i) => <li key={i} className={cx("rounded-lg px-3 py-2 text-sm border", l.who === "You" ? "border-line bg-surface2" : "border-line bg-surface")}><span className="text-[12px] uppercase text-muted mr-2">{l.who === "You" ? "You" : `Perspective ${l.who}`}</span>{l.text}{l.who !== "You" && <button className="block text-[13px] text-accent mt-1" onClick={() => { setSave(l.text); setSaved(false); }}>Select this to save</button>}</li>)}</ul>
      <div className="flex gap-2"><textarea aria-label="Message" className={cx(inputCls, "min-h-16")} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="What is on your mind?" /><Button variant="primary" busy={send.busy} disabled={!msg.trim()} onClick={() => send.run()}>Send</Button></div>
      {send.error && <ErrorBox error={send.error} />}
      {save && <Card className="p-3 space-y-2"><div className="text-[14px] text-muted">Save this one takeaway to memory (private, never exported):</div><textarea className={cx(inputCls, "min-h-16")} value={save} onChange={(e) => setSave(e.target.value)} /><Button size="sm" busy={keep.busy} disabled={saved} onClick={() => keep.run()}>{saved ? "Saved" : "Save this takeaway"}</Button></Card>}
      <p className="text-[13px] text-muted">Leaving this page ends the session. The transcript is gone.</p></>}
  </div>;
}
