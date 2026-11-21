"use client";
import { Suspense, use, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Notice, cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

const MODE: Record<string, string> = { live: "Live", imported: "Imported by you", fixture: "Fixture (synthetic)", simulated: "Simulated", unavailable: "Unavailable" };
export default function EvidencePage({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <Suspense fallback={<Spinner />}><Evidence id={id} /></Suspense>; }

function Evidence({ id }: { id: string }) {
  const q = useQuery<any>(`/evidence/items/${id}`); const sp = useSearchParams(); const router = useRouter(); const [confirm, setConfirm] = useState(false);
  const quote = sp.get("q") ?? "";
  const forget = useAction(async () => { await api(`/evidence/items/${id}/forget`, { body: { confirm: true } }); router.refresh(); q.reload(); });
  const parts = useMemo(() => { const d = q.data; if (!d?.body) return null; const at = quote ? d.body.indexOf(quote) : -1; return at < 0 ? [d.body, "", ""] : [d.body.slice(0, at), quote, d.body.slice(at + quote.length)]; }, [q.data, quote]);
  if (q.loading && !q.data) return <Spinner label="Opening the source" />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data;
  if (d.forgotten) return <div className="space-y-3 max-w-2xl"><Link href="/" className="inline-flex items-center gap-1.5 text-[14px] text-muted"><ArrowLeft className="size-4" />Today</Link><Notice tone="neutral">This item was forgotten. Its text, facts and search entries are gone. Results that cited it are marked out of date.</Notice></div>;
  if (d.revoked) return <div className="space-y-3 max-w-2xl"><Link href="/" className="inline-flex items-center gap-1.5 text-[14px] text-muted"><ArrowLeft className="size-4" />Today</Link><Notice>“{d.title}” comes from “{d.sourceLabel}”, which you revoked. It is not read or searched until you authorize that source again in <Link className="underline" href="/connections">Connections</Link>.</Notice></div>;
  return (
    <div className="space-y-5 max-w-3xl">
      <Link href="/" className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-fg"><ArrowLeft className="size-4" />Back</Link>
      <header className="space-y-1.5"><div className="flex items-center gap-2 flex-wrap"><Badge>{d.kind}</Badge><Badge tone={d.mode === "fixture" || d.mode === "simulated" ? "amber" : "accent"}>{d.sourceLabel} · {MODE[d.mode] ?? d.mode}</Badge><Badge>revision {d.revision}</Badge></div>
        <h1 className="text-2xl font-semibold tracking-tight break-words" data-testid="evidence-title">{d.title}</h1>
        <p className="text-[14px] text-muted">{d.author ? `${d.author} · ` : ""}{fmtDateTime(d.at)}{d.participants.length ? ` · ${d.participants.join(", ")}` : ""}</p></header>
      <section className="rounded-2xl border border-line bg-surface p-5 metal" aria-label="Original text"><h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium mb-2">Original</h2>
        <p className="text-[16px] leading-relaxed whitespace-pre-wrap break-words" data-testid="evidence-body">{parts![0]}{parts![1] && <mark className="bg-[#24485e] text-fg rounded px-0.5" data-testid="evidence-quote">{parts![1]}</mark>}{parts![2]}</p></section>
      {d.facts.length > 0 && <section aria-label="Extracted facts"><SectionTitle>What was extracted (each points at a quote)</SectionTitle><ul className="space-y-1.5" data-testid="evidence-facts">{d.facts.filter((f: any) => ["date", "commitment", "decision", "proposal", "figure"].includes(f.kind)).map((f: any) => <li key={f.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-[14px]"><Badge tone={f.status === "superseded" ? "amber" : f.status === "confirmed" ? "accent" : "neutral"} className="mr-2">{f.status === "superseded" ? "superseded" : f.kind === "date" || f.kind === "figure" ? `${f.kind}: ${f.value}` : f.kind}</Badge>{f.who && <b className="font-medium">{f.who}: </b>}<span className="text-muted">“{f.quote}”</span>{f.stamp && <Mono className="text-[12px] text-muted"> at {f.stamp}</Mono>}</li>)}</ul></section>}
      <section aria-label="Forget"><Card className="p-4 flex items-center gap-3 flex-wrap"><p className="text-[14px] text-muted flex-1 min-w-48">Forgetting erases this text, its facts and its search entries. Results that cited it are marked out of date.</p>{!confirm ? <Button variant="danger" onClick={() => setConfirm(true)}><Trash2 className="size-4" />Forget this</Button> : <Button variant="danger" busy={forget.busy} onClick={() => forget.run()}>Confirm: erase it</Button>}</Card>{forget.error && <ErrorBox error={forget.error} />}</section>
    </div>
  );
}
export { cx };
