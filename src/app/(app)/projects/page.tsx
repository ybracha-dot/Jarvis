"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, ArrowRight } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, Spinner, ErrorBox, Field, inputCls, cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

export const ORIGIN: Record<string, string> = { claude: "Claude conversation", "jarvis-ui": "Edited in Jarvis", import: "Import", test: "Test" };

export default function ProjectsPage() {
  const q = useQuery<any>("/projects", { poll: 4000 });
  const [name, setName] = useState(""); const [kind, setKind] = useState("project");
  const create = useAction(async () => { await api("/projects", { body: { name, kind } }); setName(""); });
  if (q.loading && !q.data) return <Spinner label="Opening projects" />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} offline={q.error.status === 0} />;
  const list: any[] = q.data.projects;
  return (
    <div className="space-y-6">
      <header><h1 className="t-title">Projects</h1><p className="text-[15px] text-muted mt-1 max-w-2xl">A project is where Claude and Jarvis keep the same decisions. Plan something in Claude, and what you settled shows up here with where it came from.</p></header>
      {list.length === 0 ? (
        <Card className="p-6 metal space-y-3" data-testid="projects-empty">
          <h2 className="text-lg font-medium">No projects yet</h2>
          <p className="text-[15px] text-muted max-w-xl">Start one here, or in ordinary Claude say: <span className="text-fg">&ldquo;Use Jarvis to start a project called Maple Court project, and note that we picked June 14 to 21.&rdquo;</span> Claude needs the Jarvis connector for that. Open Connections to set it up.</p>
          <Link href="/connections" className="inline-flex items-center gap-1.5 text-accent text-[15px]">Open Connections <ArrowRight className="size-4" /></Link>
        </Card>
      ) : (
        <ul className="grid md:grid-cols-2 gap-4" data-testid="project-list">
          {list.map((p) => (
            <li key={p.id}><Link href={`/projects/${p.id}`} className="block rounded-2xl border border-line bg-surface p-5 lift hover:border-line-strong transition-colors h-full" data-testid="project-card">
              <div className="flex items-center gap-2 flex-wrap"><h2 className="text-[19px] font-semibold tracking-tight">{p.name}</h2><Badge>{p.kind}</Badge>{p.counts.suggestions > 0 && <Badge tone="amber">{p.counts.suggestions} to confirm</Badge>}<ArrowRight className="size-4 text-muted ml-auto" aria-hidden /></div>
              {p.headline ? <div className="mt-3" data-testid="project-headline"><div className="text-[12px] uppercase tracking-wider text-muted">{p.headline.key.replace(/-/g, " ")}</div><p className="text-[16.5px] leading-snug font-medium break-words">{p.headline.text}</p>{p.headline.changed && <p className="text-[13px] text-muted">Changed from an earlier decision</p>}</div> : <p className="text-[14.5px] text-muted mt-3">{p.counts.current} current decision{p.counts.current === 1 ? "" : "s"}.</p>}
              <div className="mt-3 pt-3 border-t border-line flex flex-wrap gap-x-5 gap-y-1 text-[13.5px] text-muted">
                <span><b className="text-fg font-medium tnum">{p.owe}</b> to do or owed</span>
                <span>{p.draft ? <>Latest draft: <b className="text-fg font-medium">{p.draft.title}</b></> : "No draft yet"}</span>
                <span className="ml-auto">{p.last_origin ? `${ORIGIN[p.last_origin] ?? p.last_origin}, ${fmtDateTime(p.updated_at)}` : "No updates yet"}</span>
              </div>
            </Link></li>))}
        </ul>
      )}
      <Card className="p-5 space-y-3">
        <h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium">Start a project</h2>
        <div className="grid sm:grid-cols-[1fr_160px_auto] gap-3 items-end">
          <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Maple Court project" data-testid="project-name" /></Field>
          <Field label="Kind"><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>{["trip", "course", "club", "project", "other"].map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Button variant="primary" busy={create.busy} disabled={name.trim().length < 1} onClick={() => create.run()} data-testid="project-create"><Plus className="size-4" />Create</Button>
        </div>
        {create.error && <ErrorBox error={create.error} />}
      </Card>
    </div>
  );
}
export { cx };
