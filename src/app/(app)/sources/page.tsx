"use client";
import { useRef, useState } from "react";
import { Upload, ChevronDown, ChevronRight } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Empty, Notice, Field, inputCls, cx } from "@/components/ui";
import { ConnectionChecklist } from "@/components/Connections";
import { fmtDateTime } from "@/lib/time";

export default function SourcesPage() {
  const q = useQuery<any>("/sources");
  const settings = useQuery<any>("/settings");
  const [openId, setOpenId] = useState<string | null>(null);
  const scan = useAction(async () => api("/scheduler/run-now", { body: {} }));
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold tracking-tight">Sources and import</h1><p className="text-sm text-muted mt-1">Everything Jarvis knows came from a source you can open. Imported text is treated as data, never as instructions.</p></div>
    <Importer />
    <section><SectionTitle>Watched folder</SectionTitle><Card className="p-4 space-y-2 text-sm">
      <p>Drop <Mono>.json</Mono>, <Mono>.ics</Mono> or <Mono>.eml</Mono> files here. The worker or Run now reads them. Unchanged files change nothing.</p>
      <p className="text-[13px]"><Mono className="break-all">{settings.data?.inboxDir}</Mono></p>
      <Button size="sm" busy={scan.busy} onClick={async () => { const r = await scan.run(); if (r) setScanMsg(`${r.scan.files} file(s) checked. ${r.message}`); }}>Run now</Button>{scanMsg && <Notice tone="accent">{scanMsg}</Notice>}{scan.error && <ErrorBox error={scan.error} />}</Card></section>
    <section><SectionTitle>Sources</SectionTitle>
      {q.loading && !q.data && <Spinner />}{q.error && !q.data && <ErrorBox error={q.error} onRetry={q.reload} />}
      {q.data?.sources.length === 0 && <Card><Empty title="No sources yet" hint="Import a file above." /></Card>}
      <ul className="space-y-2">{q.data?.sources.map((s: any) => <li key={s.id}><Card className="p-3"><button className="w-full flex items-center gap-2 text-left" onClick={() => setOpenId(openId === s.id ? null : s.id)} aria-expanded={openId === s.id}>{openId === s.id ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}<span className="text-sm font-medium break-words min-w-0 flex-1">{s.title}</span><Badge>{s.course}</Badge><Badge>{s.kind}</Badge><Mono className="text-[11px] text-muted">{s.revisions} rev</Mono></button>{openId === s.id && <Revisions id={s.id} />}</Card></li>)}</ul></section>
    <section><SectionTitle>Connect for real use</SectionTitle><ConnectionChecklist /></section>
  </div>;
}

function Revisions({ id }: { id: string }) {
  const q = useQuery<any>(`/sources/${id}`);
  if (q.loading && !q.data) return <Spinner />;
  return <ul className="mt-3 space-y-2 pl-6">{q.data?.revisions.map((r: any) => <li key={r.id} className="rounded-lg border border-line p-2.5 text-[13px]"><div className="flex items-center gap-2 flex-wrap"><Mono className="text-[11px] text-muted">posted {fmtDateTime(r.published_at)}</Mono>{r.duplicate_of && <Badge>duplicate copy</Badge>}{r.stale ? <Badge tone="amber">older, ignored</Badge> : null}</div><p className="mt-1 break-words text-muted">{r.text}</p></li>)}</ul>;
}

function Importer() {
  const courses = useQuery<any>("/completed");
  const [name, setName] = useState("announcement.md"); const [text, setText] = useState(""); const [course, setCourse] = useState(""); const [kind, setKind] = useState("announcement");
  const [prev, setPrev] = useState<any>(null); const [done, setDone] = useState<any>(null); const file = useRef<HTMLInputElement>(null);
  const preview = useAction(async () => { setDone(null); setPrev(await api("/import/preview", { body: { filename: name, content: text, courseExternalId: course || undefined, kind } })); });
  const commit = useAction(async () => { const r = await api("/import/commit", { body: { token: prev.token, courseExternalId: course || undefined } }); setDone(r); setPrev(null); setText(""); });
  const onFile = async (f: File | undefined) => {
    if (!f) return; setPrev(null); setDone(null); setName(f.name);
    if (f.size > 2 * 1024 * 1024) { setText(""); setPrevErr(`${f.name} is ${(f.size / 1048576).toFixed(1)} MB. The limit is 2 MB.`); return; }
    setPrevErr(null); setText(await f.text());
  };
  const [prevErr, setPrevErr] = useState<string | null>(null);
  const needsCourse = prev?.needs?.includes("courseExternalId") && !course;
  return <section><SectionTitle>Import</SectionTitle><Card className="p-4 space-y-3">
    <div className="flex gap-2 flex-wrap items-end"><div><input ref={file} type="file" accept=".md,.txt,.html,.htm,.ics,.eml,.json,.pdf" className="sr-only" id="file" onChange={(e) => onFile(e.target.files?.[0])} /><Button onClick={() => file.current?.click()}><Upload className="size-4" />Choose a file</Button></div>
      <span className="text-[12px] text-muted pb-2">.md .txt .html .ics .eml or a JSON bundle. PDF is not supported yet.</span></div>
    <div className="grid sm:grid-cols-3 gap-3"><Field label="File name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Course"><select className={inputCls} value={course} onChange={(e) => setCourse(e.target.value)}><option value="">Detect from text</option>{courses.data?.courses.map((c: any) => <option key={c.external_id} value={c.external_id}>{c.code}</option>)}</select></Field>
      <Field label="Kind"><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>{["announcement", "syllabus", "email", "assignment", "reference", "receipt"].map((k) => <option key={k}>{k}</option>)}</select></Field></div>
    <Field label="Or paste the content"><textarea className={cx(inputCls, "min-h-28 font-mono text-[13px]")} value={text} onChange={(e) => { setText(e.target.value); setPrev(null); }} placeholder="Paste an announcement, an email, an .ics file or a JSON bundle" data-testid="import-text" /></Field>
    <Button variant="primary" busy={preview.busy} disabled={!text.trim()} onClick={() => preview.run()} data-testid="import-preview">Preview</Button>
    {(preview.error || prevErr) && <ErrorBox error={(preview.error || prevErr)!} />}
    {prev && <div className="rounded-xl border border-line bg-bg p-3 space-y-2" data-testid="import-preview-result"><div className="text-sm font-medium">{prev.format}: {prev.summary}. Nothing is saved until you import.</div>
      <ul className="space-y-1">{prev.items.slice(0, 8).map((i: any, k: number) => <li key={k} className="text-[13px]"><Badge>{i.kind}</Badge> <b className="font-medium">{i.label}</b> <span className="text-muted break-words">{i.detail}</span></li>)}</ul>
      {prev.items.length > 8 && <p className="text-[12px] text-muted">and {prev.items.length - 8} more</p>}
      {prev.warnings.map((w: string, i: number) => <Notice key={i}>{w}</Notice>)}{prev.unsupported.length > 0 && <Notice tone="neutral"><b>Not imported:</b> {prev.unsupported.join(" · ")}</Notice>}
      {needsCourse && <Notice>Choose a course above first. Jarvis could not tell which course this belongs to.</Notice>}
      <Button variant="primary" busy={commit.busy} disabled={needsCourse} onClick={() => commit.run()} data-testid="import-commit">Import</Button>{commit.error && <ErrorBox error={commit.error} />}</div>}
    {done && <Notice tone="accent"><span data-testid="import-done">Imported: {done.sources} new source{done.sources === 1 ? "" : "s"}, {done.duplicates} duplicate, {done.unchanged} unchanged, {done.calendarAdded} calendar event{done.calendarAdded === 1 ? "" : "s"} added, {done.decisions} decision{done.decisions === 1 ? "" : "s"}.</span></Notice>}
  </Card></section>;
}
