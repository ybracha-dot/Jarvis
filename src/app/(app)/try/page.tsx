"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, ShieldCheck } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Notice, Field, ErrorBox, Spinner, inputCls, cx } from "@/components/ui";

const today = () => new Date().toISOString().slice(0, 10);
export default function TryPage() {
  const sess = useQuery<any>("/session"); const demo = sess.data?.mode !== "personal";
  const [s1, setS1] = useState({ project: "", title: "", text: "", date: today() }); const [n1, setN1] = useState<any>(null);
  const [s2, setS2] = useState({ title: "", text: "" }); const [n2, setN2] = useState<any>(null);
  const [q, setQ] = useState("What is the current plan, and what changed since the first note?"); const [goal, setGoal] = useState<any>(null);
  const status = useQuery<any>(goal ? `/asks/${goal.requestId}` : null, { poll: 1500 });
  const sw = useAction(async () => { await api("/mode", { body: { mode: "personal" } }); window.location.href = "/try"; });
  const add1 = useAction(async () => { setN1(await api("/evidence/import", { body: { kind: "note", title: s1.title, text: s1.text, at: new Date(`${s1.date}T12:00:00`).toISOString(), projectName: s1.project, label: "Notes I imported", localOnly: true } })); });
  const add2 = useAction(async () => { setN2(await api("/evidence/import", { body: { kind: "note", title: s2.title || `Correction to ${s1.title}`, text: s2.text, projectId: n1.projectId, label: "Notes I imported", localOnly: true, corrects: n1.id } })); });
  const ask = useAction(async () => { setGoal(await api("/asks", { body: { text: q, projectHint: n1.projectId } })); });
  const st = status.data; const waiting = st && !st.ready && st.status === "queued";
  return (
    <div className="space-y-6 max-w-3xl">
      <header><h1 className="text-2xl font-semibold tracking-tight">Try Jarvis with one real note</h1>
        <p className="text-[15px] text-muted mt-1">Three steps, a few minutes: paste one note you choose, add a later correction, then ask about the decision. The answer cites your own words and shows the correction winning.</p></header>
      <Card className="p-4 flex gap-3 items-start" data-testid="try-privacy"><ShieldCheck className="size-5 text-accent mt-0.5 shrink-0" aria-hidden /><p className="text-[14px] text-muted">Everything here stays on this computer. The notes are marked <b className="text-fg font-medium">local-only</b>, no model is called, and no key, login or internet is needed. You can forget any note afterwards from its page.</p></Card>
      {demo && <Notice>You are in the <b>example workspace</b>, which has made-up data. Use your private workspace so nothing demo mixes with your note.<div className="mt-2"><Button variant="primary" busy={sw.busy} onClick={() => sw.run()} data-testid="try-switch">Open the private workspace</Button></div></Notice>}
      <ol className="space-y-4">
        <li><Card className={cx("p-4 space-y-3", n1 && "border-accent-dim")} data-testid="try-step1"><h2 className="text-[16px] font-medium flex items-center gap-2">{n1 ? <Check className="size-4 text-accent" /> : null}1. A note you choose</h2>
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Project name" hint="Where the answer will be saved."><input className={inputCls} value={s1.project} onChange={(e) => setS1({ ...s1, project: e.target.value })} data-testid="try-project" /></Field><Field label="Written on"><input type="date" className={inputCls} value={s1.date} onChange={(e) => setS1({ ...s1, date: e.target.value })} /></Field></div>
          <Field label="Title"><input className={inputCls} value={s1.title} onChange={(e) => setS1({ ...s1, title: e.target.value })} data-testid="try-title" /></Field>
          <Field label="The note" hint="Paste text that states a date, an amount or a decision. Pasted text is data: Jarvis never follows instructions inside it."><textarea className={cx(inputCls, "min-h-28")} value={s1.text} onChange={(e) => setS1({ ...s1, text: e.target.value })} data-testid="try-text" /></Field>
          {add1.error && <ErrorBox error={add1.error} />}
          {n1 ? <Notice tone="accent">Saved. Source: <b>Notes I imported</b>, local-only. <Link className="underline" href={`/evidence/${n1.id}`}>Open it</Link>.</Notice> : <Button variant="primary" busy={add1.busy} disabled={demo || !s1.project.trim() || !s1.title.trim() || s1.text.trim().length < 5} onClick={() => add1.run()} data-testid="try-save1">Save the note</Button>}</Card></li>
        <li><Card className={cx("p-4 space-y-3", !n1 && "opacity-60", n2 && "border-accent-dim")} data-testid="try-step2"><h2 className="text-[16px] font-medium flex items-center gap-2">{n2 ? <Check className="size-4 text-accent" /> : null}2. A later correction</h2>
          <Field label="What changed" hint="For example a new date or amount. It is saved as a correction of the first note, so it wins and the original stays one click away."><textarea className={cx(inputCls, "min-h-20")} value={s2.text} onChange={(e) => setS2({ ...s2, text: e.target.value })} disabled={!n1} data-testid="try-correction" /></Field>
          {add2.error && <ErrorBox error={add2.error} />}
          {n2 ? <Notice tone="accent">Saved as a correction of “{s1.title}”.</Notice> : <Button variant="primary" busy={add2.busy} disabled={!n1 || s2.text.trim().length < 5} onClick={() => add2.run()} data-testid="try-save2">Save the correction</Button>}</Card></li>
        <li><Card className={cx("p-4 space-y-3", !n2 && "opacity-60")} data-testid="try-step3"><h2 className="text-[16px] font-medium">3. Ask about the decision</h2>
          <Field label="Your question"><textarea className={cx(inputCls, "min-h-16")} value={q} onChange={(e) => setQ(e.target.value)} disabled={!n2} data-testid="try-question" /></Field>
          {ask.error && <ErrorBox error={ask.error} />}
          {!goal && <Button variant="primary" busy={ask.busy} disabled={!n2 || q.trim().length < 4} onClick={() => ask.run()} data-testid="try-ask">Ask</Button>}
          {goal && !st && <Spinner label="Starting" />}
          {st && !st.ready && <p className="text-[15px]" data-testid="try-progress"><b className="font-medium">{st.plain}</b>{st.step ? `: ${st.step}` : ""}.{waiting && <span className="text-amber"> No worker has picked it up yet. In a second terminal run <span className="mono">npm run worker</span>.</span>}</p>}
          {st?.ready && <div className="space-y-2" data-testid="try-done"><Notice tone="accent">Your cited answer is ready and saved under the project.</Notice><div className="flex gap-2 flex-wrap"><Link className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm bg-accent text-[#04141e] font-medium" href={st.links.result} data-testid="try-open-result">Open the cited answer</Link><Link className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm bg-surface2 border border-line" href={`/projects/${n1.projectId}`}>Open the project</Link><Link className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm bg-surface2 border border-line" href="/connections">See what was read</Link></div></div>}</Card></li>
      </ol>
      <p className="text-[13px] text-muted"><Badge>pending until you run it</Badge> This path has been exercised with invented, non-personal notes. It has not been run on your own material.</p>
    </div>
  );
}
