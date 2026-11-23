"use client";
import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { MessageSquareText, Send, Reply, FilePenLine, CheckCircle2, Undo2 } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Empty, Notice, Field, inputCls, cx } from "@/components/ui";
import { useDrawerParams } from "@/components/Shell";
import { fmtDateTime } from "@/lib/time";

export default function TasksPage() { return <Suspense fallback={<Spinner />}><Tasks /></Suspense>; }

function Tasks() {
  const sp = useSearchParams(); const router = useRouter();
  const tab = sp.get("tab") ?? "tasks";
  const set = (t: string) => router.push(t === "tasks" ? "/tasks" : `/tasks?tab=${t}`);
  return (
    <div className="space-y-5">
      <h1 className="t-title">Tasks</h1>
      <div role="tablist" className="flex gap-1 p-1 rounded-lg bg-surface border border-line w-fit">
        {[["tasks", "Tasks"], ["followups", "Follow-ups"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => set(k)} className={cx("px-3.5 py-1.5 rounded-md text-sm", tab === k ? "bg-surface2 text-fg" : "text-muted")}>{l}</button>)}
      </div>
      {tab === "followups" ? <FollowUps /> : <TaskList />}
    </div>
  );
}

function TaskList() {
  const [course, setCourse] = useState("");
  const q = useQuery<any>(`/tasks?status=open${course ? `&course=${course}` : ""}`);
  const { open } = useDrawerParams();
  const courses = Array.from(new Map((q.data?.tasks ?? []).map((t: any) => [t.course_ext, t.course_code])).entries());
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const groups: Record<string, any[]> = { Open: [], Blocked: [], Deferred: [] };
  for (const t of q.data.tasks) { if (t.kind === "practice") continue; groups[t.status === "blocked" ? "Blocked" : t.status === "deferred" ? "Deferred" : "Open"].push(t); }
  const practice = q.data.tasks.filter((t: any) => t.kind === "practice");
  return <div className="space-y-6">
    {courses.length > 1 && <div className="flex gap-2 flex-wrap" aria-label="Filter by course"><Button size="sm" variant={!course ? "primary" : "secondary"} onClick={() => setCourse("")}>All</Button>{courses.map(([k, l]: any) => <Button key={k} size="sm" variant={course === k ? "primary" : "secondary"} onClick={() => setCourse(k)}>{l}</Button>)}</div>}
    {Object.entries(groups).map(([name, rows]) => rows.length > 0 && <section key={name}><SectionTitle>{name}</SectionTitle>
      <ul className="space-y-2">{rows.map((t) => <TaskRow key={t.id} t={t} onOpen={() => open("task", t.id)} />)}</ul></section>)}
    {Object.values(groups).every((g) => g.length === 0) && <Card><Empty title="No open tasks" hint="Import a syllabus or replay an update on Today." /></Card>}
    {practice.length > 0 && <section><SectionTitle>Study sessions</SectionTitle><ul className="space-y-2">{practice.map((t: any) => <TaskRow key={t.id} t={t} onOpen={() => open("task", t.id)} />)}</ul></section>}
  </div>;
}
function TaskRow({ t, onOpen }: { t: any; onOpen: () => void }) {
  return <li><button onClick={onOpen} className="w-full text-left rounded-xl border border-line bg-surface hover:border-line-strong p-3.5">
    <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-medium break-words min-w-0">{t.title}</span><Badge>{t.course_code}</Badge>{t.kind === "exam" && <Badge tone="amber">exam</Badge>}{t.requirements.filter((r: any) => r.kind === "bring_print").map((r: any, i: number) => <Badge key={i} tone={r.mandatory ? "amber" : "neutral"}>print{r.mandatory ? "" : " (optional)"}</Badge>)}
      <Mono className="ml-auto text-[13px] text-muted">{t.due_at ? `due ${fmtDateTime(t.due_at)}` : "no date"}</Mono></div>
    {t.milestone && <p className="text-[14px] text-muted mt-1 break-words">{t.milestone}</p>}
    {t.status === "deferred" && <p className="text-[13px] text-amber mt-1">Deferred until {fmtDateTime(t.deferred_until)}. Original promise: {fmtDateTime(t.original_due_at)}</p>}
  </button></li>;
}

const EV: Record<string, string> = { promise: "Promise", draft: "Draft prepared", send_ack: "Delivery acknowledged", reply: "Reply received", correction: "Correction", resolved: "Resolved", reopened: "Reopened" };
function FollowUps() {
  const q = useQuery<any>("/commitments");
  const sess = useQuery<any>("/session");
  const demo = sess.data?.mode !== "personal";
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const list = q.data.commitments;
  return <div className="space-y-4">
    {list.length === 0 && <Card><Empty title="Nobody owes you anything" hint="Capture a promise from the Today screen, or import an email that contains one." /></Card>}
    {list.map((c: any) => <Commitment key={c.id} c={c} demo={demo} />)}
    {q.data.record.length > 0 && <section><SectionTitle>Student record</SectionTitle><Card className="p-3 space-y-2">{q.data.record.map((r: any) => <div key={r.key} className="text-sm"><span className="text-muted">{r.key.replace(/_/g, " ")}:</span> <b data-testid="record-value">{r.value}</b>{r.history.map((h: any, i: number) => <div key={i} className="text-[13px] text-muted mono">was {h.value} until {fmtDateTime(h.until)} ({h.why})</div>)}</div>)}</Card></section>}
  </div>;
}
function Commitment({ c, demo }: { c: any; demo: boolean }) {
  const [evidence, setEvidence] = useState(""); const [draft, setDraft] = useState<any>(null);
  const followup = useAction(async () => { setDraft(await api(`/commitments/${c.id}/followup`, { body: {} })); });
  const sim = useAction(async (event: string) => { await api(`/commitments/${c.id}/simulate`, { body: { event } }); });
  const resolve = useAction(async () => { await api(`/commitments/${c.id}/resolve`, { body: { evidence } }); setEvidence(""); });
  const reopen = useAction(async () => { await api(`/commitments/${c.id}/reopen`, { body: {} }); });
  const err = followup.error || sim.error || resolve.error || reopen.error;
  const open = c.status !== "resolved";
  return <Card className="p-4 space-y-3" data-testid="commitment">
    <div className="flex items-start gap-2 flex-wrap"><div className="min-w-0 flex-1"><div className="text-sm font-medium break-words">{c.who}: {c.action}</div><div className="text-[13px] text-muted">owes {c.owed_to}{c.due_date ? ` · by ${c.due_date}` : ""}</div></div>
      <Badge tone={c.status === "resolved" ? "accent" : c.status === "reply_received" ? "amber" : "neutral"} data-testid="commitment-status">{c.status === "reply_received" ? "Reply received, still open" : c.status === "resolved" ? "Resolved" : "Open"}</Badge>
      {c.delivery !== "none" && <Badge>{c.delivery === "sent_ack" ? "Sent, acknowledged" : c.delivery === "draft" ? "Draft, not sent" : c.delivery}</Badge>}</div>
    <ol className="space-y-1.5 border-l border-line pl-3 ml-1">{c.events.map((e: any, i: number) => <li key={i} className="text-[14px]"><Mono className="text-[12px] text-muted block">{fmtDateTime(e.at)} · {EV[e.kind] ?? e.kind}</Mono><span className="break-words whitespace-pre-wrap">{e.text}</span></li>)}</ol>
    {err && <ErrorBox error={err} />}
    {draft && <div className="rounded-lg border border-line bg-bg p-3 text-[14px] space-y-1"><div className="text-muted">{draft.note} Objective: {draft.objective}</div><pre className="whitespace-pre-wrap font-sans">{draft.draft}</pre><div className="text-muted">Ask: {draft.questions.join(" ")}</div></div>}
    {open && <div className="flex flex-wrap gap-2 items-center">
      <Button size="sm" busy={followup.busy} onClick={() => followup.run()}><FilePenLine className="size-3.5" />Prepare follow-up draft</Button>
      {demo && <><Button size="sm" variant="ghost" busy={sim.busy} onClick={() => sim.run("send_ack")}><Send className="size-3.5" />Fixture: delivery acknowledged</Button>
        <Button size="sm" variant="ghost" onClick={() => sim.run("reply")}><Reply className="size-3.5" />Fixture: reply arrives</Button>
        <Button size="sm" variant="ghost" onClick={() => sim.run("correction")}><MessageSquareText className="size-3.5" />Fixture: correction</Button></>}
    </div>}
    {open ? <div className="flex gap-2 items-end"><div className="flex-1"><Field label="Resolve with evidence" hint="A reply is not a resolution. Say what proves it is settled."><input className={inputCls} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Registrar confirmed 8 credits in the portal" /></Field></div><Button size="sm" variant="primary" busy={resolve.busy} onClick={() => resolve.run()}><CheckCircle2 className="size-3.5" />Resolve</Button></div>
      : <div className="flex items-center gap-2"><span className="text-[14px] text-muted">Evidence: {c.resolution_evidence}</span><Button size="sm" variant="ghost" onClick={() => reopen.run()}><Undo2 className="size-3.5" />Reopen</Button></div>}
  </Card>;
}
