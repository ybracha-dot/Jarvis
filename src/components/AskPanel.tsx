"use client";
import { useState } from "react";
import { api, useAction } from "./api";
import { Button, ErrorBox, inputCls, cx } from "./ui";

/** A helper stopped to ask something only you can answer: which earlier guide to match, or the text of one. */
export function AskPanel({ jobId, ask }: { jobId: string; ask: { question: string; handoff?: string; choices?: { id?: string; guideId?: string; label: string }[]; importText?: boolean } }) {
  const [text, setText] = useState(""); const [done, setDone] = useState(false);
  const answer = useAction(async (body: any) => { await api(`/office/jobs/${jobId}/answer`, { body }); setDone(true); });
  if (done) return <p className="text-[14px] text-accent" data-testid="ask-answered">Thanks. Resuming.</p>;
  return (
    <div className="space-y-2 mt-2" data-testid="ask-panel">
      {ask.handoff && <div className="space-y-1"><div className="text-[13px] text-muted">Send this to Claude (it uses its own past-chat search):</div><pre className="mono text-[13px] whitespace-pre-wrap rounded-lg bg-bg border border-line p-2.5 select-all" data-testid="ask-handoff">{ask.handoff}</pre><Button size="sm" onClick={() => { try { navigator.clipboard.writeText(ask.handoff!); } catch { /* blocked */ } }}>Copy</Button></div>}
      {ask.choices && <div className="flex flex-wrap gap-2">{ask.choices.map((c) => <Button key={c.id ?? c.guideId} size="sm" busy={answer.busy} onClick={() => answer.run(c.id ? { choice: c.id } : { guideId: c.guideId })} data-testid="ask-choice">{c.label}</Button>)}</div>}
      {ask.importText && <><textarea aria-label="Paste your earlier guide" className={cx(inputCls, "min-h-24 font-mono text-[13px]")} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1. Question text\nA) choice\nB) choice\nAnswer: B\nWhy: reason"} /><Button size="sm" variant="primary" busy={answer.busy} disabled={text.trim().length < 20} onClick={() => answer.run({ importText: text, importTitle: "Pasted earlier guide" })}>Use this guide once</Button></>}
      {answer.error && <ErrorBox error={answer.error} />}
    </div>
  );
}
