"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, Spinner, ErrorBox, Empty, Field, inputCls, cx } from "@/components/ui";

export default function GoalsPage() {
  const q = useQuery<any>("/goals");
  const [form, setForm] = useState(false);
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  return <div className="space-y-5">
    <div className="flex items-center"><h1 className="text-xl font-semibold tracking-tight flex-1">Goals</h1><Button size="sm" onClick={() => setForm((v) => !v)}><Plus className="size-3.5" />New goal</Button></div>
    {form && <NewGoal onDone={() => setForm(false)} />}
    {q.data.goals.length === 0 && !form && <Card><Empty title="No goals yet" hint="A goal has a target, a unit and a deadline. Pace comes from your own milestones." /></Card>}
    {q.data.goals.map((g: any) => <Goal key={g.id} g={g} />)}
  </div>;
}

function Goal({ g }: { g: any }) {
  const [v, setV] = useState(String(g.completed));
  const obs = useAction(async (value: number) => { await api(`/goals/${g.id}/observe`, { body: { value } }); });
  const pct = Math.min(100, (g.completed / g.targetTotal) * 100), plan = Math.min(100, (g.plannedByToday / g.targetTotal) * 100);
  return <Card className="p-5 space-y-4" data-testid="goal">
    <div className="flex items-center gap-2 flex-wrap"><h2 className="text-base font-medium">{g.name}</h2><Badge tone={g.status === "behind" ? "amber" : "accent"}>{g.status.replace("_", " ")}</Badge><Badge>{g.kind}</Badge></div>
    <div className="grid grid-cols-3 gap-3 text-center">
      <div className="rounded-lg bg-bg border border-line p-3"><div className="text-[12px] uppercase tracking-wider text-muted">Actual</div><Mono className="text-2xl font-semibold block">{g.completed}</Mono><div className="text-[13px] text-muted">of {g.targetTotal} {g.unit}</div></div>
      <div className="rounded-lg bg-bg border border-line p-3"><div className="text-[12px] uppercase tracking-wider text-muted">Planned by today</div><Mono className="text-2xl font-semibold block text-amber">{g.plannedByToday}</Mono><div className="text-[13px] text-muted">target to date</div></div>
      <div className="rounded-lg bg-bg border border-line p-3"><div className="text-[12px] uppercase tracking-wider text-muted">Deadline</div><Mono className="text-2xl font-semibold block">{g.weeksLeft}w</Mono><div className="text-[13px] text-muted">{g.deadline}</div></div>
    </div>
    <div aria-label={`${g.completed} of ${g.targetTotal}, planned ${g.plannedByToday}`} role="img" className="relative h-2.5 rounded-full bg-surface2 overflow-hidden"><div className="absolute inset-y-0 left-0 bg-accent rounded-full" style={{ width: `${pct}%` }} /><div className="absolute inset-y-0 w-0.5 bg-amber-solid" style={{ left: `${plan}%` }} /></div>
    <p className="text-sm"><Mono data-testid="goal-line">{g.line}</Mono></p>
    <p className="text-[13px] text-muted">{g.paceLabel}.</p>
    <div className="flex items-end gap-2 flex-wrap"><Field label="Set actual"><input type="number" min={0} className={cx(inputCls, "w-28")} value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <Button size="sm" variant="primary" busy={obs.busy} onClick={() => obs.run(Number(v))}>Save</Button><Button size="sm" onClick={() => { setV(String(g.completed + 1)); obs.run(g.completed + 1); }}>+1</Button></div>
    {obs.error && <ErrorBox error={obs.error} />}
    {g.observations.length > 0 && <ul className="text-[13px] text-muted mono space-y-0.5">{g.observations.slice(-4).map((o: any, i: number) => <li key={i}>{o.at.slice(0, 16).replace("T", " ")} · {o.value}</li>)}</ul>}
  </Card>;
}

function NewGoal({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", unit: "items", targetTotal: "10", startDate: new Date().toISOString().slice(0, 10), deadline: "", milestone: "" });
  const save = useAction(async () => { await api("/goals", { body: { name: f.name, unit: f.unit, targetTotal: Number(f.targetTotal), startDate: f.startDate, deadline: f.deadline, milestones: [] } }); onDone(); });
  return <Card className="p-4 space-y-3"><div className="grid sm:grid-cols-2 gap-3">
    <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Unit"><input className={inputCls} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
    <Field label="Target"><input type="number" className={inputCls} value={f.targetTotal} onChange={(e) => setF({ ...f, targetTotal: e.target.value })} /></Field><Field label="Start"><input type="date" className={inputCls} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
    <Field label="Deadline"><input type="date" className={inputCls} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field></div>
    <p className="text-[13px] text-muted">With no milestones, pace is a labeled linear estimate.</p>{save.error && <ErrorBox error={save.error} />}
    <Button variant="primary" busy={save.busy} disabled={!f.name || !f.deadline} onClick={() => save.run()}>Create</Button></Card>;
}
