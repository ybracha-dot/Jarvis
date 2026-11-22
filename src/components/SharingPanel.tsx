"use client";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, ErrorBox } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

/** What Claude may read, what it has been shown, and how to take it back. Deny by default. */
export function SharingPanel() {
  const q = useQuery<any>("/sharing", { poll: 15000 });
  const src = useAction(async (id: string, share: boolean) => { await api(`/sharing/sources/${id}`, { body: { share } }); });
  const prj = useAction(async (id: string, share: boolean) => { await api(`/sharing/projects/${id}`, { body: { share } }); });
  const res = useAction(async (id: string, share: boolean) => { await api(`/sharing/results/${id}`, { body: { share } }); });
  const d = q.data; if (!d) return null;
  return <section id="sharing" data-testid="sharing-panel" className="space-y-3"><SectionTitle>What Claude can read</SectionTitle>
    <Card className="p-4 space-y-3">
      <p className="text-[14px] text-muted">In your private workspace Claude sees nothing unless you share it. Local-only notes never leave this computer. Taking something back works on Claude's very next request.</p>
      <div><h3 className="text-[13px] uppercase tracking-wider text-muted mb-1">Sources</h3><ul className="space-y-1.5" data-testid="sharing-sources">{d.sources.filter((s: any) => !s.revoked && s.items > 0).map((s: any) => <li key={s.id} className="flex items-center gap-2 flex-wrap text-[14px]"><span className="min-w-0 break-words flex-1">{s.label} <span className="text-muted">({s.items} item{s.items === 1 ? "" : "s"})</span></span><Badge tone={s.shared ? "accent" : "neutral"}>{s.shared ? "Claude can read" : "local-only"}</Badge><Button size="sm" onClick={() => src.run(s.id, !s.shared)} data-testid="sharing-source-toggle">{s.shared ? "Take back" : "Let Claude read"}</Button></li>)}{d.sources.filter((s: any) => s.items > 0).length === 0 && <li className="text-muted text-[14px]">No notes yet.</li>}</ul></div>
      <div><h3 className="text-[13px] uppercase tracking-wider text-muted mb-1">Project context (decisions Claude may read or write)</h3><ul className="space-y-1.5">{d.projects.map((p: any) => <li key={p.id} className="flex items-center gap-2 flex-wrap text-[14px]"><span className="flex-1 min-w-0 break-words">{p.name}</span><Badge tone={p.shared ? "accent" : "neutral"}>{p.shared ? "shared" : "private"}</Badge><Button size="sm" onClick={() => prj.run(p.id, !p.shared)}>{p.shared ? "Take back" : "Share"}</Button></li>)}{d.projects.length === 0 && <li className="text-muted text-[14px]">No projects.</li>}</ul></div>
      <div><h3 className="text-[13px] uppercase tracking-wider text-muted mb-1">Results Claude can open</h3><ul className="space-y-1.5" data-testid="sharing-results">{d.results.filter((r: any) => r.claudeCanRead).map((r: any) => <li key={r.id} className="flex items-center gap-2 flex-wrap text-[14px]"><a className="underline min-w-0 break-words flex-1" href={`/results/${r.id}`}>{r.title}</a><Badge tone="accent">{r.via === "approved" ? "you approved it" : "built only from shared notes"}</Badge>{r.via === "approved" && <Button size="sm" onClick={() => res.run(r.id, false)}>Take back</Button>}</li>)}{d.results.filter((r: any) => r.claudeCanRead).length === 0 && <li className="text-muted text-[14px]">None.</li>}</ul></div>
      <div><h3 className="text-[13px] uppercase tracking-wider text-muted mb-1">What Claude was shown</h3><ul className="space-y-1 text-[13px]" data-testid="sharing-log">{d.log.slice(0, 12).map((l: any, i: number) => <li key={i} className="break-words"><Mono className="text-muted">{fmtDateTime(l.at)}</Mono> {l.event.replace(/_/g, " ")}{l.tool ? ` via ${l.tool}` : ""}{l.client ? ` (${l.client})` : ""}{l.detail ? `: ${l.detail}` : ""}</li>)}{d.log.length === 0 && <li className="text-muted">Nothing yet.</li>}</ul></div>
      {(src.error || prj.error || res.error) && <ErrorBox error={(src.error || prj.error || res.error)!} />}
    </Card></section>;
}
