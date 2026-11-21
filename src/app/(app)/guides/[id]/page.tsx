"use client";
import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { FileDown, ListChecks, Eye, EyeOff, Trash2, Plus, Check, X } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Notice, Field, inputCls, cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

const TABS = ["Practice", "Edit", "Answer key", "Versions"] as const;
export default function GuidePage({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <Suspense fallback={<Spinner />}><Guide id={id} /></Suspense>; }

function Guide({ id }: { id: string }) {
  const sp = useSearchParams(); const router = useRouter();
  const ver = sp.get("version");
  const q = useQuery<any>(`/documents/${id}${ver ? `?version=${ver}` : ""}`);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Practice");
  const [attempt, setAttempt] = useState<string | null>(sp.get("attempt"));
  const start = useAction(async (mode: "all" | "missed") => { const r = await api("/quiz/start", { body: { docId: id, mode } }); setAttempt(r.attemptId); setTab("Practice"); });
  useEffect(() => { if (sp.get("quiz") === "all" && !attempt && q.data && !start.busy) { start.run("all"); router.replace(`/guides/${id}`); } }, [sp, q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.loading && !q.data) return <Spinner label="Opening the guide" />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data; const c = d.content; const latest = d.doc.current_version;
  return <div className="space-y-5">
    <div><div className="text-[12px] text-muted mono">{d.doc.course} / {d.doc.folder}</div>
      <div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-semibold tracking-tight" data-testid="guide-title">{c.title}</h1><Badge data-testid="guide-version">v{d.version}</Badge>{d.version !== latest && <Badge tone="amber">older version. Latest is v{latest}</Badge>}{d.doc.synthetic ? <Badge tone="amber">synthetic</Badge> : null}</div></div>
    <div className="flex gap-2 flex-wrap items-center">
      <Button variant="primary" busy={start.busy} onClick={() => start.run("all")} data-testid="start-quiz"><ListChecks className="size-4" />Quiz me</Button>
      <Button busy={start.busy} disabled={d.missed.length === 0} onClick={() => start.run("missed")} data-testid="quiz-missed">Quiz me on what I missed{d.missed.length ? ` (${d.missed.length})` : ""}</Button>
      <a className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm bg-surface2 border border-line hover:bg-[#222831]" href={`/api/documents/${id}/pdf?version=${d.version}`} target="_blank" rel="noreferrer" data-testid="pdf-practice"><FileDown className="size-4" />Export PDF</a>
      <a className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm bg-surface2 border border-line hover:bg-[#222831]" href={`/api/documents/${id}/pdf?version=${d.version}&answers=1`} target="_blank" rel="noreferrer" data-testid="pdf-key"><FileDown className="size-4" />PDF with answer key</a>
    </div>
    {start.error && <ErrorBox error={start.error} />}
    <div role="tablist" className="flex gap-1 p-1 rounded-lg bg-surface border border-line w-fit max-w-full overflow-x-auto">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("px-3.5 py-1.5 rounded-md text-sm whitespace-nowrap", tab === t ? "bg-surface2 text-fg" : "text-muted")}>{t}</button>)}</div>
    {tab === "Practice" && (attempt ? <Quiz attemptId={attempt} docId={id} onDone={() => { setAttempt(null); q.reload(); }} onAgain={(m) => start.run(m)} /> : <Practice d={d} />)}
    {tab === "Edit" && <Edit d={d} onSaved={(v) => { router.replace(`/guides/${id}`); q.reload(); void v; }} />}
    {tab === "Answer key" && <Key d={d} />}
    {tab === "Versions" && <Versions d={d} id={id} />}
  </div>;
}

function Provenance({ c }: { c: any }) {
  return <Card className="p-4 space-y-2 text-sm" data-testid="provenance">
    {c.coverage.provisional && <Notice><span data-testid="provisional">Coverage is provisional. {c.coverage.basis}</span></Notice>}
    {c.generator && <p className="text-[13px] text-muted" data-testid="generator-note">{c.generator.note}</p>}
    {c.keyCheck && <p className="text-[13px]" data-testid="key-check">Answer key check: {c.keyCheck.supported} of {c.keyCheck.checked} questions supported by your course materials.{c.keyCheck.removed.length ? ` ${c.keyCheck.removed.length} dropped for failing the check.` : ""}{c.keyCheck.unverified.length ? ` ${c.keyCheck.unverified.length} could not be verified and are flagged.` : ""}</p>}
    <div className="text-[13px] space-y-1"><div><span className="text-muted">Format from:</span> {c.sources.format ?? "none"}</div>
      <div><span className="text-muted">Question style from photos:</span> {c.sources.photos.length ? <ul className="list-disc pl-5">{c.sources.photos.map((p: any, i: number) => <li key={i}>{p.name}: {p.status}</li>)}</ul> : "no photos attached"}</div>
      <div><span className="text-muted">Topics:</span> {c.coverage.topics.join(", ") || "none"}</div></div></Card>;
}

function Practice({ d }: { d: any }) {
  const c = d.content;
  return <div className="space-y-4"><Provenance c={c} />
    <p className="text-[13px] text-muted">Practice view. Answers and explanations are hidden. Use Quiz me, or open the Answer key tab.</p>
    <ol className="space-y-3" data-testid="practice-list">{c.questions.map((q: any, i: number) => <li key={q.id}><Card className="p-4 space-y-2"><div className="text-sm font-medium break-words"><Mono className="text-muted mr-2">{i + 1}.</Mono>{q.stem}</div>{q.flag && <Badge tone="amber">{q.flag}</Badge>}<ul className="space-y-1 text-sm">{q.choices.map((ch: any) => <li key={ch.key} className="flex gap-2"><Mono className="text-muted w-5">{ch.key}.</Mono><span className="break-words">{ch.text}</span></li>)}</ul></Card></li>)}</ol></div>;
}

function Quiz({ attemptId, docId, onDone, onAgain }: { attemptId: string; docId: string; onDone: () => void; onAgain: (m: "all" | "missed") => void }) {
  const q = useQuery<any>(`/quiz/${attemptId}`);
  const [res, setRes] = useState<any>(null);
  const ans = useAction(async (questionId: string, chosen: string) => { setRes(await api(`/quiz/${attemptId}/answer`, { body: { questionId, chosen } })); });
  const s = q.data;
  if (q.loading && !s) return <Spinner />; if (q.error && !s) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (s.finished && !res) return <Done s={s} onDone={onDone} onAgain={onAgain} />;
  const cur = res ? s.question ?? null : s.question;
  const showing = res ? { ...(q.data.question ?? {}), id: res.questionId } : null; void showing;
  return <Card className="p-5 space-y-4" data-testid="quiz">
    <div className="flex items-center gap-2 text-[13px] text-muted"><Badge>{s.mode === "missed" ? "Missed questions" : "Full quiz"}</Badge><span>Guide v{s.version}</span><span className="ml-auto mono" data-testid="quiz-progress">{Math.min(s.answered + (res ? 0 : 1), s.total)} of {s.total}</span></div>
    {!res && cur && <>
      <p className="text-[15px] font-medium break-words" data-testid="quiz-stem">{cur.stem}</p>
      <ul className="space-y-2" role="radiogroup" aria-label="Choices">{cur.choices.map((ch: any) => <li key={ch.key}><button role="radio" aria-checked={false} disabled={ans.busy} onClick={() => ans.run(cur.id, ch.key)} data-testid={`choice-${ch.key}`} className="w-full text-left rounded-lg border border-line bg-bg hover:border-accent px-3 py-2.5 text-sm flex gap-3"><Mono className="text-muted">{ch.key}</Mono><span className="break-words">{ch.text}</span></button></li>)}</ul></>}
    {ans.error && <ErrorBox error={ans.error} />}
    {res && <div className="space-y-3" data-testid="quiz-result"><div className={cx("flex items-center gap-2 text-sm font-medium", res.correct ? "text-accent" : "text-amber")}>{res.correct ? <Check className="size-4" /> : <X className="size-4" />}{res.correct ? "Correct" : `Not quite. You chose ${res.chosen}. The answer is ${res.answer}.`}</div><p className="text-sm break-words">{res.rationale}</p>
      <Button variant="primary" onClick={() => { setRes(null); q.reload(); }} data-testid="quiz-next">{res.finished ? "See results" : "Next question"}</Button></div>}
  </Card>;
}
function Done({ s, onDone, onAgain }: { s: any; onDone: () => void; onAgain: (m: "all" | "missed") => void }) {
  return <Card className="p-5 space-y-3" data-testid="quiz-done"><h2 className="text-base font-medium">Quiz finished: {s.score} of {s.total}</h2>
    {s.missed.length > 0 ? <p className="text-sm">You missed {s.missed.length}. They are saved against guide v{s.version}. Say “quiz me on what I missed” any time.</p> : <p className="text-sm">No misses.</p>}
    <div className="flex gap-2 flex-wrap">{s.missed.length > 0 && <Button variant="primary" onClick={() => onAgain("missed")}>Quiz me on what I missed</Button>}<Button onClick={() => onAgain("all")}>Full quiz again</Button><Button variant="ghost" onClick={onDone}>Back to the guide</Button></div></Card>;
}

function Key({ d }: { d: any }) {
  const [show, setShow] = useState(false);
  return <div className="space-y-3"><Button onClick={() => setShow(!show)} data-testid="toggle-key">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}{show ? "Hide the answer key" : "Show the answer key"}</Button>
    {show && <ol className="space-y-2" data-testid="answer-key">{d.content.questions.map((q: any, i: number) => <li key={q.id} className="rounded-lg border border-line bg-surface p-3 text-sm"><div className="flex gap-2"><Mono className="text-muted">{i + 1}.</Mono><b className="font-medium">{q.answer}</b><span className="break-words">{q.rationale}</span></div>{q.flag && <div className="text-[12px] text-amber mt-1">{q.flag}</div>}</li>)}</ol>}</div>;
}

function Edit({ d, onSaved }: { d: any; onSaved: (v: number) => void }) {
  const [c, setC] = useState<any>(d.content); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setC(d.content); }, [d.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, patch: any) => setC({ ...c, questions: c.questions.map((q: any, j: number) => (j === i ? { ...q, ...patch } : q)) });
  const save = useAction(async () => { const r = await api(`/documents/${d.doc.id}`, { method: "PUT", body: { content: c, baseVersion: d.version } }); setMsg(`Saved as version ${r.version}. The earlier version is kept.`); onSaved(r.version); });
  const latest = d.version === d.doc.current_version;
  return <div className="space-y-4">
    {!latest && <Notice>You are looking at an older version. Open the latest to edit.</Notice>}
    <Field label="Title"><input className={inputCls} value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} /></Field>
    <ol className="space-y-3">{c.questions.map((q: any, i: number) => <li key={q.id}><Card className="p-4 space-y-2" data-testid="edit-question">
      <div className="flex items-center gap-2"><Mono className="text-muted">{i + 1}.</Mono><span className="text-[12px] text-muted">{q.topic}</span><button aria-label={`Delete question ${i + 1}`} className="ml-auto text-muted hover:text-danger" onClick={() => setC({ ...c, questions: c.questions.filter((_: any, j: number) => j !== i) })}><Trash2 className="size-4" /></button></div>
      <Field label="Question"><textarea className={cx(inputCls, "min-h-14")} value={q.stem} onChange={(e) => set(i, { stem: e.target.value })} data-testid={`stem-${i}`} /></Field>
      {q.choices.map((ch: any, k: number) => <div key={ch.key} className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-[13px] w-24 shrink-0"><input type="radio" className="accent-[#5fe3c7]" name={`ans-${q.id}`} checked={q.answer === ch.key} onChange={() => set(i, { answer: ch.key })} aria-label={`${ch.key} is the answer`} />{ch.key}</label><input aria-label={`Choice ${ch.key} of question ${i + 1}`} className={inputCls} value={ch.text} onChange={(e) => set(i, { choices: q.choices.map((x: any, m: number) => (m === k ? { ...x, text: e.target.value } : x)) })} /></div>)}
      <Field label="Why that answer"><input className={inputCls} value={q.rationale} onChange={(e) => set(i, { rationale: e.target.value })} /></Field></Card></li>)}</ol>
    {save.error && <ErrorBox error={save.error} />}{msg && <Notice tone="accent"><span data-testid="saved-msg">{msg}</span></Notice>}
    <Button variant="primary" busy={save.busy} disabled={!latest} onClick={() => save.run()} data-testid="save-guide">Save as a new version</Button>
    <p className="text-[12px] text-muted">Saving checks every answer against your course materials again. Quiz attempts stay tied to the version they used.</p></div>;
}

function Versions({ d, id }: { d: any; id: string }) {
  return <ul className="space-y-2" data-testid="versions">{d.versions.map((v: any) => <li key={v.version} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm flex items-center gap-2 flex-wrap"><Badge>v{v.version}</Badge><span className="break-words">{v.note}</span><Mono className="text-[11px] text-muted">{fmtDateTime(v.created_at)}</Mono><Link className="ml-auto text-accent underline underline-offset-2" href={`/guides/${id}?version=${v.version}`}>{v.version === d.version ? "Viewing" : "View"}</Link></li>)}
    {d.history.length > 0 && <li className="text-[13px] text-muted pt-2">Quiz attempts: {d.history.map((h: any) => `v${h.version} ${h.mode}`).join(", ")}</li>}</ul>;
}
export { Link };
