"use client";
import { useState } from "react";
import { KeyRound, RefreshCw, Ban, Copy, Check, ShieldCheck, CircleDashed, CircleCheck } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Badge, Mono, SectionTitle, Spinner, ErrorBox, Notice, Field, inputCls, cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return <li className="rounded-xl border border-line bg-surface p-4 flex gap-3"><span className={cx("mt-0.5 shrink-0", done ? "text-accent" : "text-muted")} aria-hidden>{done ? <CircleCheck className="size-5" /> : <CircleDashed className="size-5" />}</span>
    <div className="min-w-0 flex-1 space-y-2"><h3 className="text-[16px] font-medium">{n}. {title} <span className="sr-only">{done ? "(done)" : "(not done)"}</span></h3>{children}</div></li>;
}
const CopyBtn = ({ text, label = "Copy" }: { text: string; label?: string }) => { const [ok, setOk] = useState(false); return <Button size="sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* clipboard blocked */ } }}>{ok ? <Check className="size-4" /> : <Copy className="size-4" />}{ok ? "Copied" : label}</Button>; };

export default function ConnectionsPage() {
  const q = useQuery<any>("/connector", { poll: 2500 });
  const [label, setLabel] = useState("Claude on my Mac"); const [access, setAccess] = useState("write"); const [days, setDays] = useState("90");
  const [fresh, setFresh] = useState<any>(null);
  const create = useAction(async () => { setFresh(await api("/connector/tokens", { body: { label, scopes: access === "read" ? ["read"] : ["read", "write"], expiresInDays: days === "never" ? null : Number(days) } })); });
  const revoke = useAction(async (id: string) => { await api(`/connector/tokens/${id}/revoke`, { body: {} }); });
  const rotate = useAction(async (id: string) => { setFresh(await api(`/connector/tokens/${id}/rotate`, { body: {} })); });
  const start = useAction(async () => { await api("/connector/probe", { body: {} }); });
  const edit = useAction(async (id: string) => { await api(`/connector/probe/${id}/edit`, { body: {} }); });
  if (q.loading && !q.data) return <Spinner label="Checking connections" />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} offline={q.error.status === 0} />;
  const d = q.data; const p = d.probe; const active = d.tokens.filter((t: any) => t.status === "active");
  const url = `${d.publicUrl ?? "https://YOUR-HOST"}/mcp`;
  const err = [create.error, revoke.error, rotate.error, start.error, edit.error].find(Boolean);
  return (
    <div className="space-y-6 max-w-3xl">
      <header><h1 className="text-2xl font-semibold tracking-tight">Connections</h1><p className="text-[15px] text-muted mt-1">Let ordinary Claude read and update your projects, and prove it works in both directions.</p></header>
      <section aria-label="Status" className={cx("rounded-2xl border p-5 metal", p?.complete ? "border-accent-dim bg-[#0b1c29]" : "border-line bg-surface")} data-testid="connection-status">
        <div className="flex items-center gap-2"><ShieldCheck className={cx("size-5", p?.complete ? "text-accent" : "text-muted")} aria-hidden /><h2 className="text-[17px] font-medium">{p?.complete ? "Ordinary Claude is connected and verified" : "Not verified with ordinary Claude yet"}</h2></div>
        <p className="text-[14px] text-muted mt-1.5">{p?.complete ? `Claude saved a note, you edited it in Jarvis, and Claude read your edit back (${fmtDateTime(p.read.at)}).` : "Local tests and the example workspace prove the connector code. Only the check below proves that your own Claude account can reach this Jarvis."}</p>
      </section>
      {err && <ErrorBox error={err as any} />}
      <ol className="space-y-3">
        <Step n={1} done={active.length > 0} title="Create a connector token">
          <p className="text-[14px] text-muted">The token is shown once, stored only as a hash, and can be revoked. It never goes in a link.</p>
          <div className="grid sm:grid-cols-[1fr_150px_130px_auto] gap-3 items-end">
            <Field label="Name"><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            <Field label="Access"><select className={inputCls} value={access} onChange={(e) => setAccess(e.target.value)}><option value="write">Read and save</option><option value="read">Read only</option></select></Field>
            <Field label="Expires"><select className={inputCls} value={days} onChange={(e) => setDays(e.target.value)}><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="never">Never</option></select></Field>
            <Button variant="primary" busy={create.busy} disabled={!label.trim()} onClick={() => create.run()} data-testid="token-create"><KeyRound className="size-4" />Create</Button>
          </div>
          {fresh && <div className="rounded-lg border border-amber-dim bg-[#1a1508] p-3 space-y-2" data-testid="token-fresh"><p className="text-[14px] text-[#f6d7a1]">Copy this now. It will not be shown again.</p><div className="flex gap-2 items-center flex-wrap"><code className="mono text-[13px] break-all bg-bg rounded px-2 py-1 border border-line flex-1 min-w-0" data-testid="token-value">{fresh.token}</code><CopyBtn text={fresh.token} /><Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Hide</Button></div></div>}
          {d.tokens.length > 0 && <ul className="space-y-2" data-testid="token-list">{d.tokens.map((t: any) => <li key={t.id} className="flex items-center gap-2 flex-wrap rounded-lg border border-line px-3 py-2 text-[14px]"><b className="font-medium">{t.label}</b><Badge tone={t.status === "active" ? "accent" : "neutral"}>{t.status}</Badge><Badge>{t.scopes.includes("write") ? "read + save" : "read only"}</Badge><span className="text-muted text-[13px]">{t.lastUsedAt ? `used ${fmtDateTime(t.lastUsedAt)}` : "never used"}{t.expiresAt ? ` · expires ${fmtDateTime(t.expiresAt)}` : ""}</span>
            {t.status === "active" && <span className="ml-auto flex gap-1.5"><Button size="sm" busy={rotate.busy} onClick={() => rotate.run(t.id)}><RefreshCw className="size-4" />Rotate</Button><Button size="sm" variant="danger" busy={revoke.busy} onClick={() => revoke.run(t.id)}><Ban className="size-4" />Revoke</Button></span>}</li>)}</ul>}
        </Step>
        <Step n={2} done={!!p?.written} title="Add Jarvis to Claude as a connector">
          <p className="text-[14px] text-muted">Claude can only reach a Jarvis that is on the internet at an https address. A link to <Mono>localhost</Mono> will not work from Claude on the web or phone. Deploy first (<Mono>deploy/README.md</Mono>), then in Claude open Settings, Connectors, and add a custom connector:</p>
          <dl className="grid grid-cols-[110px_1fr] gap-y-2 gap-x-3 text-[14px]"><dt className="text-muted">URL</dt><dd className="flex gap-2 items-center flex-wrap"><Mono className="break-all">{url}</Mono><CopyBtn text={url} /></dd><dt className="text-muted">Header</dt><dd><Mono>Authorization: Bearer &lt;your token&gt;</Mono></dd></dl>
          <Notice tone="neutral">Whether your Claude plan and app accept a fixed header on a custom connector is not confirmed here. If it does not, use Claude Desktop with the local connector (<Mono>npm run mcp</Mono>) or an <Mono>mcp-remote</Mono> bridge. Both are in <Mono>docs/CAPTURE-SETUP.md</Mono>. Ingress now: <b>{d.ingress === "mcp-only" ? "connector only. The rest of Jarvis is not reachable from outside." : "full app. Do not expose this to the internet. Use the connector-only deployment."}</b></Notice>
        </Step>
        <Step n={3} done={!!p?.complete} title="Run the two-way check">
          {!p && <Button variant="primary" busy={start.busy} onClick={() => start.run()} data-testid="probe-start">Start the check</Button>}
          {p && <div className="space-y-3" data-testid="probe">
            <p className="text-[14px] text-muted">Check code <Mono className="text-fg">{p.code}</Mono></p>
            <ol className="space-y-3 text-[14px]">
              <li className="flex gap-2"><span aria-hidden>{p.written ? "✔" : "○"}</span><div className="flex-1 min-w-0"><b className="font-medium">Claude writes to Jarvis.</b> In ordinary Claude, say: <span className="text-fg">&ldquo;{p.say.write}&rdquo;</span> <CopyBtn text={p.say.write} />{p.written && <p className="text-accent">Received {fmtDateTime(p.written.at)} via {p.written.via ?? "connector"}.</p>}</div></li>
              <li className="flex gap-2"><span aria-hidden>{p.edited ? "✔" : "○"}</span><div className="flex-1 min-w-0"><b className="font-medium">Jarvis changes it.</b> Adds a marker word to the saved note.<div className="mt-1.5"><Button size="sm" busy={edit.busy} disabled={!p.written || !!p.edited} onClick={() => edit.run(p.id)} data-testid="probe-edit">Add the marker</Button></div>{p.edited && <p className="text-accent">Marker added {fmtDateTime(p.edited.at)}.</p>}</div></li>
              <li className="flex gap-2"><span aria-hidden>{p.read ? "✔" : "○"}</span><div className="flex-1 min-w-0"><b className="font-medium">Claude reads it back.</b> In the same Claude, say: <span className="text-fg">&ldquo;{p.say.read}&rdquo;</span> <CopyBtn text={p.say.read} />{p.read ? <p className="text-accent">{p.read.sawMarker ? `Claude read your edit back ${fmtDateTime(p.read.at)}.` : "Read, but the marker was not in it."}</p> : <p className="text-muted">The marker word it names should match the one you added.</p>}</div></li>
            </ol>
            <Button size="sm" busy={start.busy} onClick={() => start.run()}>Start a new check</Button>
          </div>}
        </Step>
      </ol>
      <section aria-label="Disconnect"><SectionTitle>Disconnect</SectionTitle><Card className="p-4 text-[14px] space-y-1.5"><p>Revoke the token above. It stops working immediately, even in a Claude conversation that is already open.</p><p>Then remove the connector in Claude: Settings, Connectors, Jarvis, Remove. What was saved stays in Jarvis until you forget it.</p></Card></section>
    </div>
  );
}
