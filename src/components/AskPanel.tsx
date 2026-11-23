"use client";
import { useState } from "react";
import { api, useAction } from "./api";
import { Button, ErrorBox, inputCls, cx } from "./ui";

/** A helper stopped to ask something only you can answer: which earlier guide to match, or the text of one. */
export function AskPanel({ jobId, ask }: { jobId: string; ask: { kind?: string; question: string; handoff?: string; choices?: { id?: string; guideId?: string; label: string }[]; importText?: boolean } }) {
  const [text, setText] = useState(""); const [done, setDone] = useState(false);
  const answer = useAction(async (body: any) => { await api(`/office/jobs/${jobId}/answer`, { body }); setDone(true); });
  const excerpt = ask.kind === "excerpt";
  if (done) return <p className="text-[14px] text-accent" data-testid="ask-answered">Thanks. Resuming.</p>;
  return (
    <div className="space-y-2 mt-2" data-testid="ask-panel">
      {ask.choices && !ask.importText && <div className="flex flex-wrap gap-2">{ask.choices.map((c) => <Button key={c.id ?? c.guideId} size="sm" busy={answer.busy} onClick={() => answer.run(c.id ? { choice: c.id } : { guideId: c.guideId })} data-testid="ask-choice">{c.label}</Button>)}</div>}
      {ask.importText && <>
        <textarea aria-label={excerpt ? "Paste the relevant part of the earlier chat" : "Paste your earlier guide"} className={cx(inputCls, "min-h-24", !excerpt && "font-mono text-[13px]")} value={text} onChange={(e) => setText(e.target.value)} data-testid="ask-paste"
          placeholder={excerpt ? "Paste only the part that matters, for example: We decided Wednesday because Priya is out." : "1. Question text\nA) choice\nB) choice\nAnswer: B\nWhy: reason"} />
        <div className="flex gap-2 flex-wrap items-center"><Button size="sm" variant="primary" busy={answer.busy} disabled={text.trim().length < 20} onClick={() => answer.run({ importText: text, importTitle: excerpt ? "Pasted from an earlier Claude chat" : "Pasted earlier guide" })} data-testid="ask-paste-send">{excerpt ? "Use this excerpt" : "Use this guide once"}</Button>
          {ask.choices?.map((c) => <Button key={c.id ?? c.guideId} size="sm" busy={answer.busy} onClick={() => answer.run(c.id ? { choice: c.id } : { guideId: c.guideId })} data-testid="ask-choice">{c.label}</Button>)}</div></>}
      {ask.handoff && <details className="text-[13.5px]" data-testid="ask-handoff-details"><summary className="cursor-pointer text-muted min-h-8 flex items-center">Or have Claude send it: copy this message</summary><div className="space-y-1.5 mt-1"><pre className="mono text-[13px] whitespace-pre-wrap rounded-lg bg-bg border border-line p-2.5 select-all" data-testid="ask-handoff">{ask.handoff}</pre><Button size="sm" onClick={() => { try { navigator.clipboard.writeText(ask.handoff!); } catch { /* blocked */ } }}>Copy</Button></div></details>}
      {answer.error && <ErrorBox error={answer.error} />}
    </div>
  );
}
