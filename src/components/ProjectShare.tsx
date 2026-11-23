"use client";
// One project, shared on purpose. Choose it (you are on its page), see exactly what Claude would receive, share, reopen it in any new Claude chat, and take all of it back at once.
import { useEffect, useState } from "react";
import { Copy, Check, ShieldCheck, Lock } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Badge, ErrorBox, cx } from "@/components/ui";

export function ProjectShare({ id }: { id: string }) {
  const sess = useQuery<any>("/session");
  const q = useQuery<any>(`/sharing/projects/${id}/plan`, { poll: 8000 });
  const [src, setSrc] = useState<Set<string>>(new Set()); const [res, setRes] = useState<Set<string>>(new Set()); const [copied, setCopied] = useState(false);
  const share = useAction(async () => { await api(`/sharing/projects/${id}/share`, { body: { sources: [...src], results: [...res] } }); setSrc(new Set()); setRes(new Set()); });
  const revoke = useAction(async () => { await api(`/sharing/projects/${id}/revoke-all`, { body: {} }); });
  const d = q.data;
  useEffect(() => { setCopied(false); }, [d?.project?.shared]);
  if (sess.data && sess.data.mode !== "personal") return null;
  if (!d) return null;
  const toggle = (set: Set<string>, k: string, f: (s: Set<string>) => void) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); f(n); };
  const anyShared = d.project.shared || d.sources.some((s: any) => s.shared) || d.results.some((r: any) => r.shared);
  const draft = d.results.find((r: any) => r.shared) ?? d.results.find((r: any) => r.kind === "draft");
  const prompt = `Use my jarvis-personal connector: call get_project_context for "${d.project.name}"${draft ? `, then get_result for ID ${draft.id}` : ""}, and tell me what we decided and what I owe next.`;
  const copy = async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ } };
  return (
    <section aria-label="Share with Claude" data-testid="project-share" className="rounded-2xl border border-line bg-surface p-5 lift space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1"><h2 className="text-[19px] font-semibold tracking-tight">Share {d.project.name} with Claude</h2><p className="t-meta mt-0.5 max-w-[44rem]">Nothing is shared until you press the button. This is the whole list of what Claude would receive.</p></div>
        <Badge tone={anyShared ? "accent" : "neutral"} data-testid="share-state">{anyShared ? (d.project.shared ? "Shared with Claude" : "Partly shared") : "Not shared"}</Badge>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5">
        <div className="space-y-4" data-testid="share-sees">
          <div><h3 className="t-meta uppercase tracking-[0.1em] font-medium flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden />Claude will see</h3>
            <div className="mt-2 space-y-3">
              <div><p className="text-[14px] font-medium">Decisions and to-dos ({d.decisions.length})</p>{d.decisions.length ? <ul className="text-[14.5px] text-muted list-disc pl-5" data-testid="share-decisions">{d.decisions.slice(0, 5).map((x: any, i: number) => <li key={i}><span className="text-fg">{x.key.replace(/-/g, " ")}:</span> {x.text}</li>)}{d.decisions.length > 5 && <li>and {d.decisions.length - 5} more</li>}</ul> : <p className="t-meta">None yet.</p>}</div>
              <div><p className="text-[14px] font-medium">Notes</p>
                {d.sources.length === 0 && <p className="t-meta">This project has no notes.</p>}
                <ul className="space-y-2.5 mt-1">{d.sources.map((s: any) => (
                  <li key={s.id} className="rounded-xl border border-line p-3" data-testid="share-source">
                    <label className="flex items-start gap-2.5 text-[14.5px]"><input type="checkbox" className="mt-1 size-4 accent-[var(--color-accent)]" checked={s.shared || src.has(s.id)} disabled={s.shared || share.busy} onChange={() => toggle(src, s.id, setSrc)} aria-label={`Let Claude read ${s.label}`} data-testid="share-source-check" />
                      <span className="min-w-0"><b className="font-medium">{s.label}</b> {s.shared ? <Badge tone="accent">shared</Badge> : <Badge>local-only</Badge>}<span className="block t-meta">{s.notes.map((n: any) => n.title).join(" · ")}</span></span></label>
                    {s.alsoInSource.length > 0 && <p className="t-meta text-amber mt-1.5 pl-6" data-testid="share-collateral">This source also holds {s.alsoInSource.length} note{s.alsoInSource.length === 1 ? "" : "s"} from other projects ({s.alsoInSource.slice(0, 3).map((n: any) => n.title).join(", ")}). Sharing it shares those too.</p>}
                  </li>))}</ul></div>
              <div><p className="text-[14px] font-medium">Drafts and answers</p>
                {d.results.length === 0 && <p className="t-meta">No result for this project yet.</p>}
                <ul className="space-y-1.5 mt-1">{d.results.map((r: any) => (
                  <li key={r.id} data-testid="share-result"><label className={cx("flex items-start gap-2.5 text-[14.5px]", !r.canShare && "opacity-80")}><input type="checkbox" className="mt-1 size-4 accent-[var(--color-accent)]" checked={r.shared || res.has(r.id)} disabled={r.shared || !r.canShare || share.busy} onChange={() => toggle(res, r.id, setRes)} aria-label={`Let Claude open ${r.title}`} data-testid="share-result-check" />
                    <span className="min-w-0"><b className="font-medium">{r.title}</b> <span className="t-meta">version {r.version}, every version</span>{r.shared && <> <Badge tone="accent">shared</Badge></>}{!r.canShare && !r.shared && <span className="block t-meta text-amber">Cannot be shared yet: {r.blockedBy.join(", ")} {r.blockedBy.length === 1 ? "is" : "are"} local-only.</span>}</span></label></li>))}</ul></div>
            </div>
          </div>
        </div>
        <div data-testid="share-never"><h3 className="t-meta uppercase tracking-[0.1em] font-medium flex items-center gap-1.5"><Lock className="size-3.5" aria-hidden />Claude will not see</h3>
          <ul className="mt-2 space-y-1.5 text-[14.5px] text-muted list-disc pl-5">
            {d.kept.localOnlyNotes > 0 && <li><b className="text-fg font-medium tnum">{d.kept.localOnlyNotes}</b> local-only note{d.kept.localOnlyNotes === 1 ? "" : "s"} of this project</li>}
            {d.kept.always.map((x: string) => <li key={x}>{x}</li>)}
          </ul></div>
      </div>

      {(share.error || revoke.error) && <ErrorBox error={(share.error || revoke.error)!} />}
      <div className="flex gap-2 flex-wrap items-center pt-1">
        <Button variant="primary" busy={share.busy} disabled={d.project.shared && src.size === 0 && res.size === 0} onClick={() => share.run()} data-testid="share-confirm">{d.project.shared ? "Share the ticked items too" : `Share ${d.project.name} with Claude`}</Button>
        {anyShared && <Button variant="danger" busy={revoke.busy} onClick={() => revoke.run()} data-testid="share-revoke-all">Stop sharing everything</Button>}
        <span className="t-meta">{src.size + res.size > 0 ? `${src.size} source${src.size === 1 ? "" : "s"} and ${res.size} result${res.size === 1 ? "" : "s"} ticked.` : d.project.shared ? "" : "Nothing ticked: Claude would see only the decisions."}</span>
      </div>

      {d.project.shared && (
        <div className="rounded-xl border border-accent-dim bg-accent-soft p-3.5 space-y-2" data-testid="share-reopen">
          <p className="text-[14.5px] font-medium">Open it in any new Claude chat</p>
          <p className="text-[14px] text-muted">A new chat knows nothing until you ask. Paste this once:</p>
          <pre className="mono text-[13px] whitespace-pre-wrap rounded-lg bg-surface border border-line p-2.5 select-all" data-testid="share-prompt">{prompt}</pre>
          <Button size="sm" onClick={copy}>{copied ? <><Check className="size-4" aria-hidden />Copied</> : <><Copy className="size-4" aria-hidden />Copy</>}</Button>
        </div>)}
    </section>
  );
}
