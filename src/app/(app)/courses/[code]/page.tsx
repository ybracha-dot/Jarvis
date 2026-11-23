"use client";
import { use } from "react";
import Link from "next/link";
import { FileText, Image as ImageIcon, FolderOpen } from "lucide-react";
import { useQuery } from "@/components/api";
import { Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Notice } from "@/components/ui";
import { VoiceDock } from "@/components/VoiceDock";
import { fmtDateTime } from "@/lib/time";

export default function CoursePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const q = useQuery<any>(`/courses/${code}`, { poll: 4000 });
  if (q.loading && !q.data) return <Spinner label="Opening the course" />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data; const c = d.course;
  const byFolder = new Map<string, any[]>(); for (const doc of d.documents) byFolder.set(doc.folder, [...(byFolder.get(doc.folder) ?? []), doc]);
  return <div className="space-y-6">
    <div><div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-semibold tracking-tight">{c.code}</h1>{d.synthetic && <Badge tone="amber">example data</Badge>}</div><p className="text-sm text-muted mt-1">{c.name}</p></div>
    <VoiceDock course={c.code} title="Ask for this course" />
    <section><SectionTitle>Study guides</SectionTitle>
      {d.documents.length === 0 ? <Card className="p-4 text-sm text-muted">No guides yet. Ask for one above, or paste an earlier guide when Jarvis asks.</Card> :
        <div className="space-y-3" data-testid="guide-folders">{[...byFolder.entries()].map(([folder, docs]) => <div key={folder}><div className="text-[13px] text-muted mono flex items-center gap-1.5 mb-1.5"><FolderOpen className="size-3.5" aria-hidden />{c.code} / {folder}</div>
          <ul className="space-y-2">{docs.map((x: any) => <li key={x.id}><Link href={`/guides/${x.id}`} className="flex items-center gap-2 rounded-lg border border-line bg-surface hover:border-line-strong px-3 py-2.5 text-sm" data-testid="guide-link"><FileText className="size-4 text-muted" aria-hidden /><span className="font-medium break-words min-w-0">{x.title}</span><Badge>v{x.current_version}</Badge>{x.synthetic ? <Badge tone="amber">synthetic</Badge> : null}<Mono className="ml-auto text-[12px] text-muted">{fmtDateTime(x.updated_at)}</Mono></Link></li>)}</ul></div>)}</div>}</section>
    <div className="grid md:grid-cols-2 gap-5">
      <section><SectionTitle>What the final covers</SectionTitle><Card className="p-4 space-y-2 text-sm">
        {d.coverage.provisional && <Notice>Coverage is provisional. {d.coverage.basis}</Notice>}
        {d.coverage.topics.length ? <ul className="list-disc pl-5 space-y-0.5">{d.coverage.topics.map((t: string) => <li key={t}>{t}</li>)}</ul> : <p className="text-muted">No topics found.</p>}
        {!d.coverage.provisional && <p className="text-[13px] text-muted">From: {d.coverage.basis}</p>}</Card></section>
      <section><SectionTitle>Course materials</SectionTitle><Card className="p-4"><ul className="space-y-1.5 text-sm">{d.materials.map((m: any) => <li key={m.title} className="flex items-center gap-2"><Badge>{m.kind}</Badge><span className="break-words min-w-0">{m.title}</span></li>)}{d.materials.length === 0 && <li className="text-muted">None imported.</li>}</ul></Card></section>
    </div>
    <section><SectionTitle>Your photos (private to you and this course)</SectionTitle>
      {d.attachments.length === 0 ? <Card className="p-4 text-sm text-muted">No photos yet. Attach them in the box above.</Card> : <ul className="grid sm:grid-cols-2 gap-3" data-testid="photo-list">{d.attachments.map((a: any) => <li key={a.id} className="rounded-xl border border-line bg-surface p-3 flex gap-3"><img src={`/api/attachments/${a.id}/raw`} alt={a.name} className="size-16 rounded object-cover border border-line" /><div className="min-w-0 text-[14px]"><div className="flex items-center gap-1.5 font-medium break-words"><ImageIcon className="size-3.5 text-muted shrink-0" aria-hidden />{a.name}</div><div className="text-muted">Job: {a.role === "style" ? "question style" : a.role}</div><div className={a.quality.overall === "ok" ? "text-accent" : "text-amber"}>{a.quality.note}</div><div className="text-muted">{a.reading ? "Read." : "Not read yet."}</div></div></li>)}</ul>}</section>
  </div>;
}
