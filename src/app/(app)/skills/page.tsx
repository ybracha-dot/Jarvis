"use client";
import { useState } from "react";
import { Check, X, Undo2, ChevronDown, ChevronRight } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Empty, Notice, Field, inputCls, cx } from "@/components/ui";
import { HoldToTalk } from "@/components/speech";
import { fmtDateTime } from "@/lib/time";

const STATUS_TONE: Record<string, "accent" | "amber" | "neutral" | "danger"> = { active: "accent", candidate: "amber", quarantined: "danger", rolled_back: "neutral", superseded: "neutral" };

export default function SkillsPage() {
  const q = useQuery<any>("/skills");
  const tasks = useQuery<any>("/tasks?status=open&kind=assignment");
  const [text, setText] = useState(""); const [taskId, setTaskId] = useState(""); const [out, setOut] = useState<any>(null);
  const teach = useAction(async () => { setOut(await api("/skills/teach", { body: { text, taskId: taskId || undefined, via: "text" } })); setText(""); });
  const rollback = useAction(async () => { await api("/skills/rollback", { body: {} }); });
  const promote = useAction(async (version: number) => { await api("/skills/promote", { body: { version } }); });
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const skills: any[] = q.data.skills;
  const active = skills.find((s) => s.status === "active");
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold tracking-tight">Skills</h1><p className="text-sm text-muted mt-1">Skills are versioned instructions. A correction becomes a candidate, runs against fixed cases, and is promoted only if it fixes the new case without breaking old ones.</p></div>
    <section><SectionTitle>Teach Jarvis once</SectionTitle>
      <Card className="p-4 space-y-3">
        <Field label="What should Jarvis do differently?"><textarea className={cx(inputCls, "min-h-16")} value={text} onChange={(e) => setText(e.target.value)} placeholder="You missed that this needs printing." /></Field>
        <div className="flex flex-wrap items-end gap-3"><Field label="About this task (optional)"><select className={inputCls} value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">No task</option>{tasks.data?.tasks.map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
          <Button variant="primary" busy={teach.busy} disabled={text.trim().length < 4} onClick={() => teach.run()}>Teach</Button></div>
        <HoldToTalk onText={(t) => setText((x) => (x ? x + " " : "") + t)} />
        {teach.error && <ErrorBox error={teach.error} />}
        {out && <div className="rounded-xl border border-accent-dim bg-accent-soft p-3 text-[14px] space-y-1" data-testid="teach-result"><div className="font-medium text-accent">{out.duplicate ? "Already handled" : `Outcome: ${out.outcome}`}</div>{out.steps.map((s: string, i: number) => <p key={i}>{s}</p>)}
          {out.before && out.after && out.outcome === "promote" && <p className="text-fg">Brief materials before: {out.before.materials.length}. After: {out.after.materials.length}.</p>}</div>}
      </Card></section>
    <section><SectionTitle right={active?.parentVersion != null ? <Button size="sm" variant="ghost" busy={rollback.busy} onClick={() => rollback.run()}><Undo2 className="size-3.5" />Roll back to v{active.parentVersion}</Button> : null}>Versions</SectionTitle>
      {(rollback.error || promote.error) && <ErrorBox error={(rollback.error || promote.error)!} />}
      <ul className="space-y-3">{[...skills].reverse().map((s) => <Version key={s.id} s={s} onPromote={() => promote.run(s.version)} />)}</ul></section>
  </div>;
}

function Version({ s, onPromote }: { s: any; onPromote: () => void }) {
  const [open, setOpen] = useState(s.status === "active" && s.eval);
  return <li><Card className="p-4 space-y-2" data-testid="skill-version">
    <div className="flex items-center gap-2 flex-wrap"><span className="font-medium text-sm">{s.name} <Mono>v{s.version}</Mono></span><Badge tone={STATUS_TONE[s.status]}>{s.status.replace("_", " ")}</Badge><Badge>{s.origin}</Badge>{s.features.map((f: string) => <Badge key={f} tone="accent">{f.replace("_", " ")}</Badge>)}
      {s.status === "candidate" && <Button size="sm" className="ml-auto" onClick={onPromote}>Promote manually</Button>}</div>
    <p className="text-[14px] text-muted break-words">Trigger: {s.trigger}</p>
    <div className="text-[13px] text-muted flex flex-wrap gap-x-4 gap-y-1"><span>Capabilities: <Mono>{s.capabilities.join(", ")}</Mono></span><span>Ran {s.uses}×{s.lastUsed ? `, last ${fmtDateTime(s.lastUsed)}` : ""}</span><span>Corrected {s.correctionCount}×{s.lastCorrected ? `, last ${fmtDateTime(s.lastCorrected)}` : ""}</span>{s.correctionsPerUse != null && <span>{s.correctionsPerUse} corrections per use</span>}</div>
    {s.lastReason && <p className="text-[13px] text-muted">Last ran because: {s.lastReason}</p>}
    {(s.diff.length > 0 || s.eval) && <button className="text-[14px] text-accent flex items-center gap-1" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}What changed and how it scored</button>}
    {open && <div className="space-y-3 pt-1">
      {s.diff.length > 0 && <pre className="text-[13px] bg-bg border border-line rounded-lg p-2 overflow-auto whitespace-pre-wrap" aria-label="Diff from previous version">{s.diff.map((d: any, i: number) => <div key={i} className={d.sign === "+" ? "text-accent" : "text-danger"}>{d.sign} {d.line}</div>)}</pre>}
      {s.eval && <EvalTable ev={s.eval} />}</div>}
  </Card></li>;
}

function EvalTable({ ev }: { ev: any }) {
  const cell = (g: any) => g.pass ? <Check className="size-4 text-accent" aria-label="pass" /> : <X className="size-4 text-danger" aria-label="fail" />;
  return <div className="space-y-2"><div className="overflow-x-auto"><table className="w-full text-[14px]"><thead><tr className="text-left text-muted text-[12px] uppercase tracking-wider"><th className="py-1 pr-3 font-medium">Case</th><th className="px-2 font-medium">Baseline</th><th className="px-2 font-medium">Candidate</th></tr></thead>
    <tbody>{ev.cases.map((c: any) => <tr key={c.id} className="border-t border-line"><td className="py-1.5 pr-3 break-words">{c.id === "a" ? "New: " : ""}{c.name}</td><td className="px-2">{cell(c.baseline)}</td><td className="px-2">{cell(c.candidate)}</td></tr>)}</tbody></table></div>
    <p className="text-[13px] text-muted">Score {Math.round(ev.scores.baseline * 100)}% to {Math.round(ev.scores.candidate * 100)}%. Verdict: <b className="text-fg">{ev.verdict}</b>. {ev.reason}</p>
    {ev.regressions.length > 0 && <p className="text-[13px] text-danger">Regressions: {ev.regressions.join(", ")}</p>}{ev.falsePositives.length > 0 && <p className="text-[13px] text-amber">False positives: {ev.falsePositives.join(", ")}</p>}</div>;
}
