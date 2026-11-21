"use client";
import { useEffect, useState } from "react";
import { Volume2, VolumeX, Square, FlaskConical, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Empty, Notice, Field, inputCls, cx, Quote } from "@/components/ui";
import { HoldToTalk } from "@/components/speech";

const LBL: Record<string, "accent" | "amber" | "neutral" | "danger"> = { "Direct quotation": "accent", Paraphrase: "neutral", "Jarvis application": "neutral", "Missing evidence": "amber" };

export default function VoicePage() {
  const q = useQuery<any>("/advisors");
  const [picked, setPicked] = useState<string[]>(["offer"]); const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<any[]>([]); const [next, setNext] = useState<string>("offer"); const [muted, setMuted] = useState(false); const [speaking, setSpeaking] = useState<number | null>(null);
  const [showSrc, setShowSrc] = useState(false); const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => { setCanSpeak("speechSynthesis" in window); return () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }; }, []);
  useEffect(() => { if (!picked.includes(next)) setNext(picked[0] ?? ""); }, [picked, next]);
  const ask = useAction(async () => { const r = await api("/advisors/turn", { body: { lens: next, question } }); setTurns((t) => [...t, { ...r, question, name: q.data.lenses.find((l: any) => l.id === next)?.name }]); });
  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1], id] : [...p, id]);
  const say = (i: number) => {
    if (muted || !canSpeak) return; const t = turns[i]; window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t.segments.map((s: any) => s.label === "Direct quotation" ? `Quote: ${s.text}` : s.text).join(" ")); u.onend = () => setSpeaking(null); setSpeaking(i); window.speechSynthesis.speak(u);
  };
  const stop = () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } setSpeaking(null); };
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const lenses: any[] = q.data.lenses;
  const sources: any[] = turns.flatMap((t) => t.segments.filter((s: any) => s.source).map((s: any) => s.source));
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold tracking-tight">Advisor room</h1><p className="text-sm text-muted mt-1">Pick one or two lenses and ask. One lens speaks at a time. Quotations come only from sources you imported, with where to find them.</p></div>
    <section><SectionTitle>Lenses</SectionTitle><div className="flex flex-wrap gap-2" role="group" aria-label="Lenses">{lenses.map((l) => <button key={l.id} onClick={() => toggle(l.id)} aria-pressed={picked.includes(l.id)} className={cx("rounded-lg border px-3 py-2 text-sm text-left", picked.includes(l.id) ? "border-accent bg-[#0b1c29]" : "border-line bg-surface hover:border-[#37404a]")}>{l.name}<span className="block text-[12px] text-muted">{l.note}</span></button>)}</div>
      {picked.includes("hormozi") && q.data.sources.filter((s: any) => /hormozi/i.test(s.speaker)).length === 0 && <div className="mt-2"><Notice>No verified Hormozi sources are imported. Add a public interview, an article or your own notes below. Until then this lens says so, and the generic offer lens is available.</Notice></div>}</section>
    <section><SectionTitle>Ask</SectionTitle><Card className="p-4 space-y-3">
      <Field label="Your question (typing works the same as speaking)"><textarea className={cx(inputCls, "min-h-16")} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How should I price a tutoring offer?" data-testid="voice-question" /></Field>
      <HoldToTalk onText={(t) => setQuestion((x) => (x ? x + " " : "") + t)} /><p className="text-[13px] text-muted">You can correct the transcript above before asking.</p>
      <div className="flex flex-wrap items-center gap-3"><fieldset className="flex gap-3 text-[14px] items-center"><legend className="sr-only">Who answers next</legend><span className="text-muted">Next speaker:</span>{picked.map((p) => <label key={p} className="flex items-center gap-1.5"><input type="radio" name="next" className="accent-[#67d4ff]" checked={next === p} onChange={() => setNext(p)} />{lenses.find((l) => l.id === p)?.name}</label>)}</fieldset>
        <Button variant="primary" busy={ask.busy} disabled={question.trim().length < 2 || !next} onClick={() => ask.run()} data-testid="voice-ask">Ask</Button></div>
      {ask.error && <ErrorBox error={ask.error} />}</Card></section>
    <section><SectionTitle right={<div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => { setMuted(!muted); stop(); }} aria-pressed={muted}>{muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}{muted ? "Unmute" : "Mute"}</Button><Button size="sm" variant="ghost" onClick={stop}><Square className="size-3.5" />Stop</Button></div>}>Transcript</SectionTitle>
      {turns.length === 0 && <Card><Empty title="No turns yet" hint="Ask a question. Playback uses your browser's voice and starts only when you press Speak." /></Card>}
      <ol className="space-y-3" data-testid="transcript">{turns.map((t, i) => <li key={i}><Card className="p-4 space-y-2"><div className="flex items-center gap-2 flex-wrap"><Badge tone="accent">{t.name}</Badge><span className="text-[13px] text-muted break-words flex-1">asked: {t.question}</span>{canSpeak ? <Button size="sm" onClick={() => say(i)} disabled={muted}><Volume2 className="size-3.5" />{speaking === i ? "Speaking" : "Speak"}</Button> : <span className="text-[13px] text-muted">Playback unavailable here</span>}</div>
        {speaking === i && <p className="text-[13px] text-muted">Browser voice, not a real person.</p>}
        {t.segments.map((s: any, k: number) => <div key={k} className="space-y-1"><Badge tone={LBL[s.label]}>{s.label}</Badge>{s.label === "Direct quotation" ? <Quote source={s.source ? `${s.source.title}${s.source.locator ? ` · ${s.source.locator}` : ""}` : undefined}>{s.text}</Quote> : <p className="text-sm break-words">{s.text}</p>}</div>)}
        <div className="rounded-lg border border-accent-dim bg-[#0b1c29] p-2.5 text-[14px] flex items-start gap-2"><FlaskConical className="size-4 text-accent mt-0.5 shrink-0" aria-hidden /><span><b className="font-medium">Turn that disagreement into a test:</b> {t.test}</span></div></Card></li>)}</ol>
      {sources.length > 0 && <div className="mt-3"><button onClick={() => setShowSrc(!showSrc)} className="text-[14px] text-accent flex items-center gap-1" aria-expanded={showSrc}>{showSrc ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Sources used ({sources.length})</button>{showSrc && <ul className="mt-2 text-[14px] space-y-1">{sources.map((s, i) => <li key={i}>{s.title}{s.locator ? ` · ${s.locator}` : ""}{s.url ? <> · <a className="text-accent underline break-all" href={s.url} target="_blank" rel="noreferrer noopener">{s.url}</a></> : ""}</li>)}</ul>}</div>}
      <p className="text-[13px] text-muted mt-3">Claude mobile voice is a separate path: use Claude's voice mode in the Claude app. A web page like this one cannot control that app. To reach Jarvis data from Claude, deploy the Jarvis MCP server behind authentication (see docs/SURFACES.md).</p></section>
    <Library data={q.data} />
  </div>;
}

function Library({ data }: { data: any }) {
  const [f, setF] = useState({ title: "", speaker: "", published: "", url: "", locator: "", rights: "user-notes", excerpt: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const add = useAction(async () => { const r = await api("/advisors/sources", { body: { ...f, url: f.url || undefined, locator: f.locator || undefined, published: f.published || undefined } }); setMsg(r.status === "gap" ? `Added with gaps: ${r.gaps.join(" ")}` : "Added."); setF({ ...f, title: "", excerpt: "", locator: "", url: "" }); });
  const del = useAction(async (id: string) => { await api(`/advisors/sources/${id}`, { method: "DELETE" }); });
  return <section><SectionTitle>Advisor library</SectionTitle><Card className="p-4 space-y-3">
    <p className="text-[14px] text-muted">Add only public, lawfully accessible material, or your own notes. Store a short excerpt with where it came from. Do not paste paywalled or private copies.</p>
    <div className="grid sm:grid-cols-2 gap-3"><Field label="Title"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field><Field label="Speaker"><input className={inputCls} value={f.speaker} onChange={(e) => setF({ ...f, speaker: e.target.value })} /></Field>
      <Field label="Date"><input className={inputCls} value={f.published} onChange={(e) => setF({ ...f, published: e.target.value })} placeholder="2024-01-15" /></Field><Field label="Locator or timestamp"><input className={inputCls} value={f.locator} onChange={(e) => setF({ ...f, locator: e.target.value })} placeholder="12:31 or p. 4" /></Field>
      <Field label="URL"><input className={inputCls} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" /></Field><Field label="Usage rights"><select className={inputCls} value={f.rights} onChange={(e) => setF({ ...f, rights: e.target.value })}><option value="user-notes">My own notes</option><option value="public-domain">Public domain</option><option value="licensed">Licensed for this use</option><option value="fair-use-excerpt">Short excerpt, fair use</option></select></Field></div>
    <Field label="Excerpt (short, exact)"><textarea className={cx(inputCls, "min-h-20")} value={f.excerpt} onChange={(e) => setF({ ...f, excerpt: e.target.value })} /></Field>
    {add.error && <ErrorBox error={add.error} />}{msg && <Notice tone="accent">{msg}</Notice>}
    <Button busy={add.busy} disabled={!f.title || !f.speaker || f.excerpt.length < 10} onClick={() => add.run()}>Add source</Button>
    <ul className="space-y-2 pt-2 border-t border-line">{data.sources.length === 0 && <li className="text-[14px] text-muted">Library is empty.</li>}{data.sources.map((s: any) => <li key={s.id} className="text-[14px] flex gap-2 items-start"><div className="min-w-0 flex-1"><b className="font-medium">{s.title}</b> · {s.speaker} {s.status === "gap" && <Badge tone="amber">gap</Badge>}<p className="text-muted break-words">“{s.excerpt}”</p>{s.note && <p className="text-[13px] text-amber">{s.note}</p>}</div><button aria-label={`Remove ${s.title}`} onClick={() => del.run(s.id)} className="p-1 text-muted hover:text-danger"><Trash2 className="size-4" /></button></li>)}</ul></Card></section>;
}
