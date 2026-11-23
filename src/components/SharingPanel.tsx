"use client";
import { useState } from "react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, ErrorBox, cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

const ACCESS = (s: any) => s.revoked ? { label: "Revoked", tone: "danger" as const } : s.shared ? { label: "Shared with Claude", tone: "accent" as const } : s.mode === "fixture" || s.mode === "simulated" ? { label: "Example data", tone: "amber" as const } : { label: "Local-only", tone: "neutral" as const };

/** Every source with its access, its last successful read and the one next action. What Claude would receive is one tap away, before anything is shared. */
function SourceRow({ s, onToggle, busy }: { s: any; onToggle: (id: string, share: boolean) => void; busy: boolean }) {
  const [open, setOpen] = useState(false); const prev = useQuery<any>(open ? `/sharing/sources/${s.id}/preview` : null); const a = ACCESS(s);
  const trouble = ["needs_signin", "failed", "stale"].includes(s.state);
  return (
    <li className="py-3.5 border-b border-line last:border-0" data-testid="sharing-source">
      <div className="flex gap-x-3 gap-y-1.5 items-start flex-wrap">
        <div className="min-w-0 flex-1 basis-56"><p className="text-[16px] font-semibold break-words">{s.label}</p>
          <p className="t-meta mt-0.5">{s.items} item{s.items === 1 ? "" : "s"} · {s.lastSuccessAt ? `Last read ${fmtDateTime(s.lastSuccessAt)}` : "Never read"}{trouble && <span className="text-amber font-medium"> · {s.state === "needs_signin" ? "needs your sign-in" : s.state}</span>}</p></div>
        <Badge tone={a.tone}>{a.label}</Badge>
        {!s.revoked && s.items > 0 && <Button size="sm" variant={s.shared ? "secondary" : "primary"} busy={busy} onClick={() => onToggle(s.id, !s.shared)} data-testid="sharing-source-toggle">{s.shared ? "Take back" : "Let Claude read"}</Button>}
      </div>
      {s.items > 0 && <details className="mt-1" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}><summary className="disc t-meta cursor-pointer min-h-8 flex items-center">{s.shared ? "What Claude can receive" : "Preview what Claude would receive"}</summary>
        <div className="mt-1 t-meta space-y-1">{!prev.data ? <p>Loading…</p> : <><p>{prev.data.receives}</p><ul className="list-disc pl-5">{prev.data.titles.map((t: any, i: number) => <li key={i}>{t.title}</li>)}{prev.data.more > 0 && <li>…and {prev.data.more} more</li>}</ul><p>Never: {prev.data.never}</p></>}</div></details>}
    </li>
  );
}

/** What Claude may read, what it has been shown, and how to take it back. Deny by default. */
export function SharingPanel() {
  const q = useQuery<any>("/sharing", { poll: 15000 });
  const src = useAction(async (id: string, share: boolean) => { await api(`/sharing/sources/${id}`, { body: { share } }); });
  const prj = useAction(async (id: string, share: boolean) => { await api(`/sharing/projects/${id}`, { body: { share } }); });
  const res = useAction(async (id: string, share: boolean) => { await api(`/sharing/results/${id}`, { body: { share } }); });
  const d = q.data; if (!d) return null;
  const sources = d.sources.filter((s: any) => !(s.items === 0 && s.mode === "unavailable"));
  return <section id="sharing" data-testid="sharing-panel" className="space-y-4">
    <div><h2 className="text-[22px] font-semibold tracking-tight">What Claude can read</h2><p className="t-meta mt-1 max-w-[40rem]">In your private workspace Claude sees nothing unless you share it. Local-only notes never leave this computer. Taking something back works on Claude's very next request.</p></div>
    <Card className="px-4 py-1"><ul data-testid="sharing-sources">{sources.map((s: any) => <SourceRow key={s.id} s={s} busy={src.busy} onToggle={(id, share) => src.run(id, share)} />)}{sources.length === 0 && <li className="py-3 t-meta">No notes yet.</li>}</ul></Card>
    <details className="group"><summary className="disc touch cursor-pointer text-[15px] font-medium flex items-center">Projects, approved results and what Claude was shown</summary>
      <div className="mt-2 space-y-4">
        <div><h3 className="t-meta uppercase tracking-[0.1em] font-medium mb-1">Project context (decisions Claude may read or write)</h3><ul className="divide-y divide-line border-t border-line">{d.projects.map((p: any) => <li key={p.id} className="flex items-center gap-2 flex-wrap py-2.5 text-[15px]"><span className="flex-1 min-w-0 break-words">{p.name}</span><Badge tone={p.shared ? "accent" : "neutral"}>{p.shared ? "Shared with Claude" : "Private"}</Badge><Button size="sm" onClick={() => prj.run(p.id, !p.shared)}>{p.shared ? "Take back" : "Share"}</Button></li>)}{d.projects.length === 0 && <li className="py-2.5 t-meta">No projects.</li>}</ul></div>
        <div><h3 className="t-meta uppercase tracking-[0.1em] font-medium mb-1">Results Claude can open</h3><ul className="divide-y divide-line border-t border-line" data-testid="sharing-results">{d.results.filter((r: any) => r.claudeCanRead).map((r: any) => <li key={r.id} className="flex items-center gap-2 flex-wrap py-2.5 text-[15px]"><a className="underline underline-offset-4 min-w-0 break-words flex-1" href={`/results/${r.id}`}>{r.title}</a><Badge tone="accent">{r.via === "approved" ? "You approved it" : "Built only from shared notes"}</Badge>{r.via === "approved" && <Button size="sm" onClick={() => res.run(r.id, false)}>Take back</Button>}</li>)}{d.results.filter((r: any) => r.claudeCanRead).length === 0 && <li className="py-2.5 t-meta">None.</li>}</ul></div>
        <div><h3 className="t-meta uppercase tracking-[0.1em] font-medium mb-1">What Claude was shown</h3><ul className="space-y-1 text-[14px]" data-testid="sharing-log">{d.log.slice(0, 12).map((l: any, i: number) => <li key={i} className="break-words"><Mono className="text-muted tnum">{fmtDateTime(l.at)}</Mono> {l.event.replace(/_/g, " ")}{l.tool ? ` via ${l.tool}` : ""}{l.client ? ` (${l.client})` : ""}{l.detail ? `: ${l.detail}` : ""}</li>)}{d.log.length === 0 && <li className="t-meta">Nothing yet.</li>}</ul></div>
      </div></details>
    {(src.error || prj.error || res.error) && <ErrorBox error={(src.error || prj.error || res.error)!} />}
  </section>;
}
export { cx };
