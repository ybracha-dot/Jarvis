"use client";
import { useEffect, useState } from "react";
import { Square, ChevronDown, ChevronRight, Lightbulb, Plus, X } from "lucide-react";
import { api, useQuery, useAction, invalidate } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Empty, Notice, Field, inputCls, cx, Quote } from "@/components/ui";

const SEV: Record<string, "danger" | "amber" | "neutral" | "accent"> = { high: "danger", medium: "amber", low: "neutral", info: "accent" };

export default function CouncilPage() {
  const info = useQuery<any>("/council");
  const tasks = useQuery<any>("/tasks?status=open&kind=assignment");
  const [preset, setPreset] = useState("essay"); const [question, setQuestion] = useState("What is the one fix that matters most with 25 minutes left?");
  const [draft, setDraft] = useState(""); const [sources, setSources] = useState<{ id: string; title: string; text: string }[]>([]); const [rubric, setRubric] = useState("");
  const [sid, setSid] = useState<string | null>(null); const [taskId, setTaskId] = useState("");
  const [dir, setDir] = useState<number | null>(null);
  const start = useAction(async (force?: boolean) => {
    const r = await api("/council/start", { body: { preset, question, draft, sources: sources.filter((s) => s.text.trim()), rubric: rubric.split("\n").map((x) => x.trim()).filter(Boolean), taskId: taskId || undefined, requiredArticles: [4, 13, 16, 31], force } });
    setSid(r.id);
  });
  const loadSample = () => { const s = info.data.sample; setDraft(s.draft); setSources(s.sources); setRubric(s.rubric.join("\n")); setPreset("essay"); };
  const essay = tasks.data?.tasks?.[0];
  if (info.loading && !info.data) return <Spinner />;
  if (info.error && !info.data) return <ErrorBox error={info.error} onRetry={info.reload} />;
  const router = info.data.router;
  const directions = [
    { t: "Article 13 shows the framers designed dissent into the republic.", need: "Text of article 13 and one source on why assembly was protected." },
    { t: "Articles 4 and 31 show power was limited by procedure, not by trust.", need: "Text of articles 4 and 31 and one source on the framers' reasons." },
  ];
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold tracking-tight">Council</h1><p className="text-sm text-muted mt-1">Four reviewers read your draft separately. An editor sees their findings with the names removed.</p></div>

    <section><SectionTitle>1. Ideas{essay ? `: ${essay.title}` : ""}</SectionTitle>
      <Card className="p-4 space-y-3"><p className="text-[12px] text-muted flex items-center gap-1.5"><Lightbulb className="size-3.5" aria-hidden />Template directions built from your task requirements. A Claude provider would write these for you.</p>
        <div className="grid sm:grid-cols-2 gap-3">{directions.map((d, i) => <button key={i} onClick={() => { setDir(i); setQuestion(`Review my draft for this thesis direction: "${d.t}" What is the one fix that matters most?`); }} aria-pressed={dir === i} className={cx("text-left rounded-xl border p-3", dir === i ? "border-accent bg-[#0f2420]" : "border-line bg-bg hover:border-[#37404a]")}><div className="text-sm font-medium break-words">{d.t}</div><div className="text-[12px] text-muted mt-1">Evidence needed: {d.need}</div></button>)}</div>
        {dir != null && <Notice tone="accent">Direction {dir + 1} chosen. The question below now mentions it.</Notice>}</Card></section>

    <section><SectionTitle>2. Bring in the council</SectionTitle>
      <Card className="p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Preset"><select className={inputCls} value={preset} onChange={(e) => setPreset(e.target.value)}>{Object.entries(info.data.presets).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="About task (optional)"><select className={inputCls} value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">None</option>{tasks.data?.tasks.map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field></div>
        <Field label="Question"><input className={inputCls} value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
        <Field label="Draft"><textarea className={cx(inputCls, "min-h-40")} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste your draft" data-testid="draft" /></Field>
        <div className="space-y-2"><div className="flex items-center"><span className="text-[13px] text-muted flex-1">Sources the reviewers may rely on</span><Button size="sm" variant="ghost" onClick={() => setSources([...sources, { id: `src-${sources.length + 1}`, title: "", text: "" }])}><Plus className="size-3.5" />Add</Button></div>
          {sources.map((s, i) => <div key={i} className="grid gap-2 rounded-lg border border-line p-2"><div className="flex gap-2"><input aria-label="Source title" className={inputCls} placeholder="Title" value={s.title} onChange={(e) => setSources(sources.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} /><button aria-label="Remove source" onClick={() => setSources(sources.filter((_, j) => j !== i))} className="p-2 text-muted"><X className="size-4" /></button></div><textarea aria-label="Source text" className={cx(inputCls, "min-h-16")} placeholder="Excerpt text" value={s.text} onChange={(e) => setSources(sources.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} /></div>)}
          {sources.length === 0 && <p className="text-[12px] text-muted">No sources attached. The Evidence Checker will say what it cannot establish.</p>}</div>
        <Field label="Requirements, one per line (optional)"><textarea className={cx(inputCls, "min-h-16")} value={rubric} onChange={(e) => setRubric(e.target.value)} /></Field>
        <div className="flex items-center gap-2 flex-wrap"><Button variant="primary" busy={start.busy} disabled={draft.trim().length < 20} onClick={() => start.run()} data-testid="start-council">Bring in the council</Button><Button variant="ghost" onClick={loadSample}>Load the sample essay</Button></div>
        <p className="text-[12px] text-muted" data-testid="router-status">{router.status === "ready" ? `Claude ready: ${router.model} at ${router.effort} effort.` : `Claude is not active. ${router.message} Without it, only the sample essay has a labeled replay. Any other text gets a rubric checklist.`}</p>
        {start.error && <ErrorBox error={start.error} />}</Card></section>

    {sid && <Session id={sid} onRerun={() => start.run(true)} />}

    <section><SectionTitle>Earlier sessions</SectionTitle>
      {info.data.sessions.length === 0 ? <p className="text-[13px] text-muted">None yet.</p> : <ul className="space-y-1.5">{info.data.sessions.map((s: any) => <li key={s.id}><button onClick={() => setSid(s.id)} className="w-full text-left rounded-lg border border-line bg-surface hover:border-[#37404a] px-3 py-2 text-[13px] flex items-center gap-2"><span className="break-words min-w-0 flex-1">{s.question}</span><Badge>{s.mode}</Badge><Badge tone={s.status === "done" ? "accent" : "amber"}>{s.status}</Badge></button></li>)}</ul>}</section>

    <Correction />
  </div>;
}

function Correction() {
  const [t, setT] = useState("You missed the printed excerpt last time."); const [out, setOut] = useState<any>(null);
  const tasks = useQuery<any>("/tasks?status=open&kind=assignment");
  const go = useAction(async () => { setOut(await api("/skills/teach", { body: { text: t, taskId: tasks.data?.tasks?.[0]?.id, via: "text" } })); });
  return <section><SectionTitle>3. Correct Jarvis</SectionTitle><Card className="p-4 space-y-3">
    <Field label="You say" hint="This runs the learning workflow on the open assignment, then you can see the skill history."><input className={inputCls} value={t} onChange={(e) => setT(e.target.value)} /></Field>
    <Button busy={go.busy} disabled={t.trim().length < 4} onClick={() => go.run()}>Teach Jarvis</Button>{go.error && <ErrorBox error={go.error} />}
    {out && <div className="rounded-xl border border-accent-dim bg-[#0e1f1c] p-3 text-[13px] space-y-1" data-testid="council-teach-result"><div className="font-medium text-accent">{out.duplicate ? "Already handled" : `Outcome: ${out.outcome}`}</div>{out.steps.map((s: string, i: number) => <p key={i}>{s}</p>)}<a href="/skills" className="text-accent underline">See skill history</a></div>}</Card></section>;
}

function Session({ id, onRerun }: { id: string; onRerun: () => void }) {
  const [live, setLive] = useState(true);
  const q = useQuery<any>(`/council/${id}`, { poll: live ? 600 : 0 });
  const cancel = useAction(async () => { await api(`/council/${id}/cancel`, { body: {} }); });
  const s = q.data;
  useEffect(() => { if (s && s.status !== "running") { setLive(false); invalidate(); } else if (s) setLive(true); }, [s?.status, s?.id]);
  const [hear, setHear] = useState(false);
  if (q.loading && !s) return <Spinner label="Starting council" />;
  if (q.error && !s) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!s) return null;
  const sample = s.mode === "replay-sample";
  return <section aria-live="polite" data-testid="council-session"><SectionTitle right={s.status === "running" ? <Button size="sm" variant="danger" busy={cancel.busy} onClick={() => cancel.run()}><Square className="size-3.5" />Cancel</Button> : <Button size="sm" variant="ghost" onClick={onRerun}>Run again</Button>}>Result <Badge tone={s.status === "done" ? "accent" : s.status === "running" ? "amber" : "neutral"} className="ml-2" data-testid="council-status">{s.status}</Badge></SectionTitle>
    {s.notice && <div className="mb-3"><Notice tone={sample ? "amber" : "neutral"}><span data-testid="council-notice">{s.notice}</span></Notice></div>}
    {s.mode === "checklist" && <Card className="p-4"><div className="text-sm font-medium mb-2">Rubric checklist ({s.bundle.checklist.words} words)</div><ul className="space-y-2">{s.bundle.checklist.items.map((i: any, k: number) => <li key={k} className="text-[13px] flex gap-2"><Badge tone={i.pass === true ? "accent" : i.pass === false ? "amber" : "neutral"}>{i.pass === true ? "met" : i.pass === false ? "not met" : "needs reader"}</Badge><span><b className="font-medium">{i.item}.</b> <span className="text-muted">{i.evidence}</span></span></li>)}</ul></Card>}
    {s.mode !== "checklist" && <>
      <div className="grid sm:grid-cols-2 gap-3">{s.seats.map((seat: any) => <Card key={seat.seat} className="p-3.5 space-y-2" data-testid="council-seat">
        <div className="flex items-center gap-2"><span className="text-sm font-medium">{seat.seat}</span><Badge tone={seat.status === "ok" ? "accent" : seat.status === "failed" ? "danger" : "neutral"} className="ml-auto">{seat.status === "not_run" ? "waiting" : seat.status}</Badge></div>
        {seat.status === "ok" && seat.findings.map((f: any, i: number) => <div key={i} className="space-y-1.5 text-[13px]"><div className="flex gap-2 items-center"><Badge tone={SEV[f.severity]}>{f.severity}</Badge>{f.uncertain ? <Badge tone="amber">uncertain: not found in sources</Badge> : <Badge tone="accent">supported</Badge>}</div><Quote>{f.passage}</Quote><p>{f.finding}</p>{f.evidence && <p className="text-[12px] text-muted"><Mono>{f.evidence.pointer}</Mono>: “{f.evidence.excerpt}”</p>}<p className="text-accent">Change: {f.suggestedChange}</p></div>)}
        {seat.error && <p className="text-[12px] text-muted">{seat.error}</p>}</Card>)}</div>
      {s.editor && <Card className="p-4 mt-4 space-y-3" data-testid="council-editor"><div className="text-[11px] uppercase tracking-wider text-muted">Editor decision</div>
        <div><div className="text-[12px] text-muted">Highest-impact fix</div><p className="text-[15px] font-medium">{s.editor.highestImpactFix}</p></div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm"><div><div className="text-[12px] text-muted">Strongest passage</div>{s.editor.strongestPassage}</div><div><div className="text-[12px] text-muted">Uncertainty</div>{s.editor.uncertainty}</div></div>
        <div><div className="text-[12px] text-muted mb-1">Your minutes</div><ol className="space-y-1">{s.editor.minutesPlan.map((m: any, i: number) => <li key={i} className="text-sm flex gap-2"><Mono className="w-14 text-muted">{m.minutes} min</Mono>{m.step}</li>)}</ol></div>
        {s.editor.disagreements.length > 0 && <div><button onClick={() => setHear(!hear)} aria-expanded={hear} className="text-[13px] text-accent flex items-center gap-1">{hear ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Hear disagreement</button>
          {hear && <div className="mt-2 space-y-3">{s.editor.disagreements.map((d: any, i: number) => <div key={i} className="rounded-lg border border-line p-2.5"><div className="text-sm font-medium mb-1">{d.topic}</div>{d.positions.map((p: any, j: number) => { const l = s.editor.labelMap[p.findingId]; return <p key={j} className="text-[13px]"><b className="font-medium">{l?.seat ?? p.findingId}:</b> {p.stance}</p>; })}<p className="text-[12px] text-muted mt-1">Both views are kept. Agreement between reviewers that are the same model is not independent proof.</p></div>)}</div>}</div>}
      </Card>}</>}
  </section>;
}
