"use client";
import { useState } from "react";
import Link from "next/link";
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
  const srcs = useQuery<any>("/evidence/sources", { poll: 4000 });
  const sess = useQuery<any>("/session");
  const [label, setLabel] = useState("Claude on my Mac"); const [access, setAccess] = useState("write"); const [days, setDays] = useState("90");
  const [fresh, setFresh] = useState<any>(null);
  const create = useAction(async () => { setFresh(await api("/connector/tokens", { body: { label, scopes: access === "read" ? ["read"] : ["read", "write"], expiresInDays: days === "never" ? null : Number(days) } })); });
  const revoke = useAction(async (id: string) => { await api(`/connector/tokens/${id}/revoke`, { body: {} }); });
  const rotate = useAction(async (id: string) => { setFresh(await api(`/connector/tokens/${id}/rotate`, { body: {} })); });
  const start = useAction(async () => { await api("/connector/probe", { body: {} }); });
  const edit = useAction(async (id: string) => { await api(`/connector/probe/${id}/edit`, { body: {} }); });
  const rtq = useQuery<any>("/roundtrip", { poll: 4000 });   // hooks stay above every early return
  if (q.loading && !q.data) return <Spinner label="Checking connections" />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} offline={q.error.status === 0} />;
  const d = q.data; const p = d.probe; const rt = rtq.data?.trip; const claudeVerified = !!((rt?.complete && rt.written?.kind === "claude" && rt.read?.kind === "claude") || (p?.complete && p.written?.kind === "claude" && p.read?.kind === "claude")); const testOnly = !claudeVerified && !!(rt?.complete || p?.complete); const active = d.tokens.filter((t: any) => t.status === "active");
  const url = `${d.publicUrl ?? "https://YOUR-HOST"}/mcp`;
  const err = [create.error, revoke.error, rotate.error, start.error, edit.error].find(Boolean);
  return (
    <div className="space-y-6 max-w-3xl">
      <header><h1 className="text-2xl font-semibold tracking-tight">Connections</h1><p className="text-[15px] text-muted mt-1">Let ordinary Claude read and update your projects, and prove it works in both directions.</p></header>
      <nav aria-label="On this page" className="flex gap-3 flex-wrap text-[14px]"><a className="text-accent underline underline-offset-2" href="#reader">Let Claude read your notes</a><a className="text-accent underline underline-offset-2" href="#roundtrip">Prove it with Claude</a><a className="text-accent underline underline-offset-2" href="#blackboard">Blackboard</a><a className="text-accent underline underline-offset-2" href="#sources">What Jarvis can read</a></nav>
      <section aria-label="Status" className={cx("rounded-2xl border p-5 metal", claudeVerified ? "border-accent-dim bg-[#0b1c29]" : "border-line bg-surface")} data-testid="connection-status">
        <div className="flex items-center gap-2"><ShieldCheck className={cx("size-5", claudeVerified ? "text-accent" : "text-muted")} aria-hidden /><h2 className="text-[17px] font-medium">{claudeVerified ? "A round trip finished with clients that reported themselves as Claude" : testOnly ? "The connector works. It has only been tested with a local test client" : "Not verified with ordinary Claude yet"}</h2></div>
        <p className="text-[14px] text-muted mt-1.5">{claudeVerified ? "Jarvis cannot verify an account from a self-reported client name, but this is the write, change and fresh read you asked for. Details and timestamps are under the round trip." : testOnly ? "A test client proves the connector code works. It does not prove your own Claude account can reach this Jarvis. Run the round trip below from Claude." : "Local tests and the example workspace prove the connector code. Only a round trip from your own Claude account proves it reaches this Jarvis."}</p>
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
          {d.tokens.length > 0 && <ul className="space-y-2" data-testid="token-list">{d.tokens.map((t: any) => <li key={t.id} className="flex items-center gap-2 flex-wrap rounded-lg border border-line px-3 py-2 text-[14px]"><b className="font-medium">{t.label}</b><Badge tone={t.status === "active" ? "accent" : "neutral"}>{t.status}</Badge><Badge>{t.scopes.includes("write") ? "read + save" : "read only"}</Badge><span className="text-muted text-[13px]">{t.lastUsedAt ? `used ${fmtDateTime(t.lastUsedAt)}` : "never used"}{t.lastClient ? ` · client says it is ${t.lastClient}` : ""}{t.expiresAt ? ` · expires ${fmtDateTime(t.expiresAt)}` : ""}</span>
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
      <section aria-label="Claude Project instruction"><SectionTitle>For Claude: a Project instruction</SectionTitle><Card className="p-4 space-y-2" data-testid="project-instruction">
        <p className="text-[14px] text-muted">Paste this into the instructions of the Claude Project you use with Jarvis. It makes Claude look through its own past chats first, hand Jarvis only the excerpt that matters, and read results back.</p>
        <pre className="mono text-[13px] whitespace-pre-wrap rounded-lg bg-bg border border-line p-3 select-all">{PROJECT_INSTRUCTION}</pre><CopyBtn text={PROJECT_INSTRUCTION} label="Copy the instruction" /></Card></section>
      <section aria-label="Sources Jarvis can read" data-testid="sources-panel" id="sources"><SectionTitle>What Jarvis can read</SectionTitle>
        <p className="text-[14px] text-muted mb-2">Every source says how it got here. Fixture and simulated sources are synthetic. A source that needs you is skipped, and results say so.</p>
        <ul className="space-y-2">{srcs.data?.sources.map((s: any) => <SourceRow key={s.id} s={s} />)}{srcs.data?.sources.length === 0 && <li className="text-[15px] text-muted">Nothing connected yet. Import a note, a transcript or an email below{sess.data?.mode !== "personal" ? ", or load the sample workspace" : ""}.</li>}</ul>
        {sess.data?.mode !== "personal" && !srcs.data?.sources.some((s: any) => s.mode === "fixture") && <div className="mt-3"><SampleLoader /></div>}
        <ImportForm /></section>
      <ReaderCard />
      <BlackboardCard />
      <RoundTripCard />
      <section aria-label="Disconnect"><SectionTitle>Disconnect</SectionTitle><Card className="p-4 text-[14px] space-y-1.5"><p>Revoke the token above. It stops working immediately, even in a Claude conversation that is already open.</p><p>Then remove the connector in Claude: Settings, Connectors, Jarvis, Remove. What was saved stays in Jarvis until you forget it.</p></Card></section>
    </div>
  );
}

const MODE: Record<string, { label: string; tone: "accent" | "amber" | "neutral" }> = { live: { label: "live", tone: "accent" }, imported: { label: "imported by you", tone: "neutral" }, fixture: { label: "fixture (synthetic)", tone: "amber" }, simulated: { label: "simulated", tone: "amber" }, unavailable: { label: "unavailable", tone: "neutral" } };
function SourceRow({ s }: { s: any }) {
  const revoke = useAction(async () => { await api(`/evidence/sources/${s.id}/revoke`, { body: {} }); }); const auth = useAction(async () => { await api(`/evidence/sources/${s.id}/authorize`, { body: {} }); });
  return <li className="rounded-xl border border-line bg-surface p-3.5" data-testid="source-row" data-state={s.state}><div className="flex items-center gap-2 flex-wrap"><b className="text-[15px] font-medium">{s.label}</b><Badge tone={MODE[s.mode]?.tone}>{MODE[s.mode]?.label ?? s.mode}</Badge><Badge tone={s.state === "ok" ? "accent" : s.state === "revoked" || s.state === "failed" ? "danger" : "amber"}>{s.state === "needs_signin" ? "needs your sign-in" : s.state}</Badge><span className="text-[13px] text-muted">{s.items} item{s.items === 1 ? "" : "s"}{s.lastSuccessAt ? ` · last read ${fmtDateTime(s.lastSuccessAt)}` : " · never read"}</span>
    {s.items > 0 || s.revokedAt ? <span className="ml-auto">{s.revokedAt ? <Button size="sm" busy={auth.busy} onClick={() => auth.run()}>Authorize again</Button> : <Button size="sm" variant="danger" busy={revoke.busy} onClick={() => revoke.run()} data-testid="source-revoke">Revoke</Button>}</span> : null}</div>{s.message && <p className="text-[14px] text-muted mt-1.5">{s.message}</p>}</li>;
}
function SampleLoader() { const go = useAction(async () => { await api("/evidence/fixtures", { body: {} }); }); return <div className="flex items-center gap-3 flex-wrap rounded-xl border border-line bg-surface p-3.5"><p className="text-[14px] text-muted flex-1 min-w-48">The example workspace has no sources yet. Load a synthetic sample (a club, two meetings, emails, a calendar and a changed notice) to try the assistant. Everything is labelled fixture.</p><Button variant="primary" busy={go.busy} onClick={() => go.run()} data-testid="load-sample">Load the sample workspace</Button>{go.error && <ErrorBox error={go.error} />}</div>; }
function ImportForm() {
  const [f, setF] = useState({ kind: "email", title: "", text: "" }); const [done, setDone] = useState<string | null>(null);
  const imp = useAction(async () => { const r = await api("/evidence/import", { body: { kind: f.kind, title: f.title, text: f.text } }); setDone(r.unchanged ? "Already imported. Nothing changed." : r.revised ? `Updated to revision ${r.revision}.` : "Imported. It is searchable now, and labelled as imported by you."); setF({ ...f, title: "", text: "" }); });
  return <Card className="p-4 mt-3 space-y-3" data-testid="import-form"><h3 className="text-[15px] font-medium">Import something you choose</h3>
    <div className="grid sm:grid-cols-[150px_1fr] gap-3"><Field label="What is it"><select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{[["email", "Email"], ["transcript", "Meeting transcript"], ["notice", "Course notice"], ["note", "Note"], ["claude", "Claude conversation excerpt"], ["export", "Export"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Title"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="import-title" /></Field></div>
    <Field label="Text" hint="Pasted text is data. Jarvis reads it as a source and never follows instructions inside it."><textarea className={cx(inputCls, "min-h-28")} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} data-testid="import-body" /></Field>
    {imp.error && <ErrorBox error={imp.error} />}{done && <Notice tone="accent">{done}</Notice>}
    <Button variant="primary" busy={imp.busy} disabled={!f.title.trim() || !f.text.trim()} onClick={() => imp.run()} data-testid="import-save">Import</Button></Card>;
}

const PROJECT_INSTRUCTION = `When I ask for something that depends on earlier work (for example "pick up where we left off on X"), do this:
1. If you can, search my past chats first (Claude's own past-chat search) for the relevant conversation.
2. Call Jarvis's share_excerpt with only the minimum relevant excerpt, where it came from (chat title and date), and what I want it for.
3. Call submit_goal with my request in my own words and a stable dedupKey. Tell me the receipt. Do not wait for it to finish.
4. Later, or in a fresh chat, call get_goal and get_result and show me the result with its source links. If I want it changed, call revise_goal.
Jarvis can only read what I have authorized. Never send anything on my behalf; Jarvis drafts, I decide.`;

const BB_STATE: Record<string, { label: string; tone: "accent" | "amber" | "danger" | "neutral" }> = { ok: { label: "connected: last read succeeded", tone: "accent" }, needs_signin: { label: "needs your sign-in", tone: "amber" }, stale: { label: "stale", tone: "amber" }, failed: { label: "could not read", tone: "danger" }, pending: { label: "saved, not read yet", tone: "neutral" }, not_configured: { label: "not connected", tone: "neutral" } };
function ReaderCard() {
  const q = useQuery<any>("/reader/test", { poll: 4000 }); const [copied, setCopied] = useState(false);
  const make = useAction(async () => { await api("/reader/test", { body: {} }); });
  const confirm = useAction(async () => { await api("/reader/confirm", { body: {} }); });
  const st = q.data; if (!st) return null;
  return (
    <section aria-label="Let Claude read your notes" data-testid="reader-card" id="reader"><SectionTitle>Let Claude read your notes</SectionTitle>
      <Card className="p-4 space-y-3">
        <p className="text-[14px] text-muted">In a normal Claude chat with the Jarvis connector, ask what your team still owes. Claude reads the project's <b className="text-fg font-medium">shareable</b> notes and sends back owners, next actions, blockers and exact quotes. Jarvis checks every quote, whom it is about, the correction chain and that no passage was skipped, then writes the result itself and gives you a link. <b className="text-fg font-medium">Local-only notes are never sent to Claude.</b> No paid API is used.</p>
        {!st.exists ? <div className="flex items-center gap-3 flex-wrap"><Button variant="primary" busy={make.busy} onClick={() => make.run()} data-testid="reader-create">Create a shareable test project</Button><span className="text-[14px] text-muted">Two invented notes, marked shareable. Your own notes are not touched.</span></div>
          : <>
            <p className="text-[14px]" data-testid="reader-state">Test project <b className="font-medium">{st.project}</b>: {st.shareableNotes} shareable notes, {st.passages} passages.{st.rejectedAttempts > 0 && <span className="text-muted"> Jarvis rejected {st.rejectedAttempts} attempt{st.rejectedAttempts === 1 ? "" : "s"} and saved nothing from {st.rejectedAttempts === 1 ? "it" : "them"}.</span>}</p>
            <ul className="space-y-2 text-[14px]" data-testid="reader-observations">
              <li data-testid="reader-tool">{st.toolAccepted ? <><b className="font-medium">Tool call:</b> <span className={st.toolAccepted.viaConnector ? "text-accent" : "text-amber"} data-testid="reader-live">{st.toolAccepted.label}</span> <span className="text-muted">({fmtDateTime(st.toolAccepted.at)}) </span><Link className="underline underline-offset-2" href={st.toolAccepted.link}>Open the saved result</Link></> : <><b className="font-medium">Tool call:</b> <span className="text-amber" data-testid="reader-live">None yet. The live test is pending.</span></>}</li>
              <li data-testid="reader-confirmed"><b className="font-medium">Your confirmation:</b> {st.userConfirmed ? <span className="text-accent">You confirmed on {fmtDateTime(st.userConfirmed.at)} that you ran this in your own Claude account.{st.userConfirmed.note ? ` “${st.userConfirmed.note}”` : ""}</span> : <span className="text-muted">Not confirmed by you. Jarvis cannot tell from a tool call whether it came from your Claude account.{st.toolAccepted?.viaConnector && <> <Button size="sm" busy={confirm.busy} onClick={() => confirm.run()} data-testid="reader-confirm">I ran this in my own Claude Desktop</Button></>}</span>}</li>
              <li data-testid="reader-quality"><b className="font-medium">Saved reading:</b> {st.reading ? <span>{st.reading.status}. {st.reading.parts.map((x: any) => `${x.status === "done" ? "done" : x.status === "partial" ? "partly done" : "not done"}: ${x.detail}`).join(" ")}</span> : <span className="text-muted">Nothing saved yet.</span>} <span className="text-muted">This is Jarvis's own check of the notes, separate from the two lines above.</span></li>
            </ul>
            <div><b className="text-[14px] font-medium">Paste this into a Claude chat that has the Jarvis connector:</b><pre className="mono text-[13px] whitespace-pre-wrap rounded-lg bg-bg border border-line p-2.5 mt-1 select-all" data-testid="reader-prompt">{st.prompt}</pre>
              <Button size="sm" onClick={async () => { try { await navigator.clipboard.writeText(st.prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy the prompt"}</Button></div>
            <p className="text-[13px] text-muted">The connector must be added in Claude first (Settings → Connectors) with the token from this page. A client name is metadata the client chose to report. This card states what Jarvis observed and what you confirmed, never a verified account.</p>
          </>}
        {make.error && <ErrorBox error={make.error} />}{confirm.error && <ErrorBox error={confirm.error} />}
      </Card></section>
  );
}
function BlackboardCard() {
  const q = useQuery<any>("/blackboard", { poll: 4000 }); const [url, setUrl] = useState(""); const [check, setCheck] = useState<any>(null); const [msg, setMsg] = useState<string | null>(null);
  const test = useAction(async () => { setCheck(await api("/blackboard/check", { body: { url } })); });
  const save = useAction(async () => { const r = await api("/blackboard/save", { body: { url } }); setCheck(r.check); setMsg(r.saved ? `Saved and read. ${r.read?.message ?? ""}` : null); if (r.saved) setUrl(""); });
  const read = useAction(async () => { const r = await api("/blackboard/read", { body: {} }); setMsg(r.message); });
  const remove = useAction(async () => { await api("/blackboard/remove", { body: {} }); setMsg("The link was removed from this computer."); });
  const st = q.data; const bs = BB_STATE[st?.state ?? "not_configured"] ?? BB_STATE.pending;
  return (
    <section aria-label="Blackboard" data-testid="blackboard-card" id="blackboard"><SectionTitle>Blackboard</SectionTitle>
      <Card className="p-4 space-y-3 text-[15px]">
        <div className="flex items-center gap-2 flex-wrap"><Badge tone={bs.tone} data-testid="bb-state">{bs.label}</Badge>{st?.linkHint && <span className="mono text-[13px] text-muted">{st.linkHint}</span>}<span className="text-[13px] text-muted">{st?.lastSuccessAt ? `last successful read ${fmtDateTime(st.lastSuccessAt)}` : "never read"}{st?.lastAttemptAt && st.lastAttemptAt !== st.lastSuccessAt ? ` · last attempt ${fmtDateTime(st.lastAttemptAt)}` : ""}</span></div>
        {st?.message && <Notice>{st.message}</Notice>}
        <p className="text-[14px] text-muted"><b className="text-fg font-medium">What this reads:</b> {st?.coverage} It uses the read-only calendar link that Blackboard gives a signed-in student. Jarvis never sees your password or Duo, and a saved link alone does not mean connected: it shows connected only after a read succeeds.</p>
        <ol className="text-[14px] text-muted list-decimal pl-5 space-y-0.5"><li>In Blackboard (the official site, signed in with Duo), open Calendar and copy the calendar link.</li><li>Paste it below and press <b className="text-fg font-medium">Check the link</b>. Nothing is saved yet.</li><li>Press <b className="text-fg font-medium">Save and read now</b>. Jarvis then rechecks every 15 minutes while the worker runs.</li></ol>
        <Field label="Calendar link" hint="Treat it like a password: anyone with it can read your calendar. It is stored only on this computer and never shown again."><input className={inputCls} type="password" autoComplete="off" value={url} onChange={(e) => { setUrl(e.target.value); setCheck(null); }} data-testid="bb-url" placeholder="https://…" /></Field>
        <div className="flex gap-2 flex-wrap"><Button busy={test.busy} disabled={url.trim().length < 12} onClick={() => test.run()} data-testid="bb-check">Check the link</Button><Button variant="primary" busy={save.busy} disabled={url.trim().length < 12} onClick={() => save.run()} data-testid="bb-save">Save and read now</Button>
          {st?.configured && <Button busy={read.busy} onClick={() => read.run()} data-testid="bb-read">{st.state === "needs_signin" ? "I pasted a fresh link. Read again" : "Read now"}</Button>}{st?.configured && <Button variant="ghost" busy={remove.busy} onClick={() => remove.run()}>Disconnect</Button>}</div>
        {(test.error || save.error || read.error) && <ErrorBox error={(test.error || save.error || read.error)!} />}
        {check && <Notice tone={check.ok ? "accent" : "amber"}><span data-testid="bb-check-result">{check.message}</span></Notice>}{msg && <Notice tone="accent">{msg}</Notice>}
        <p className="text-[13px] text-muted">Your own Blackboard account: <b className="font-medium">{st?.ownerAccount ?? "pending"}</b>. Until then Jarvis uses notification emails or files you import below.</p>
      </Card></section>
  );
}
function RoundTripCard() {
  const q = useQuery<any>("/roundtrip", { poll: 2500 }); const [project, setProject] = useState("Round-trip check");
  const start = useAction(async () => { await api("/roundtrip", { body: { project } }); });
  const edit = useAction(async (id: string) => { await api(`/roundtrip/${id}/edit`, { body: {} }); });
  const t = q.data?.trip;
  return (
    <section aria-label="Round trip with Claude" data-testid="roundtrip" id="roundtrip"><SectionTitle>Prove the round trip with your Claude account</SectionTitle>
      <Card className="p-4 space-y-3">
        <p className="text-[14px] text-muted">Three messages. Claude saves a project decision, you change it in Jarvis, and a <b className="text-fg font-medium">new</b> Claude chat reads the changed decision with its source. Each step gets a timestamp and the client name it reported. A local test client is labelled as one: it proves the connector, not your account.</p>
        {!t || t.complete ? <div className="flex gap-2 items-end flex-wrap"><Field label="Project for the check"><input className={inputCls} value={project} onChange={(e) => setProject(e.target.value)} data-testid="rt-project" /></Field><Button variant="primary" busy={start.busy} disabled={project.trim().length < 2} onClick={() => start.run()} data-testid="rt-start">{t ? "Run it again" : "Start the round trip"}</Button></div> : null}
        {start.error && <ErrorBox error={start.error} />}
        {t && <ol className="space-y-3 text-[14px]" data-testid="rt-steps">
          <li className="flex gap-2"><span aria-hidden>{t.written ? "✔" : "○"}</span><div className="min-w-0 flex-1"><b className="font-medium">1. In a Claude chat with the Jarvis connector, send:</b><pre className="mono text-[13px] whitespace-pre-wrap rounded-lg bg-bg border border-line p-2.5 mt-1 select-all" data-testid="rt-say-write">{t.say.write}</pre>{t.written && <p className="text-accent mt-1">Received {fmtDateTime(t.written.at)} from {t.written.client}.</p>}</div></li>
          <li className="flex gap-2"><span aria-hidden>{t.edited ? "✔" : "○"}</span><div className="min-w-0 flex-1"><b className="font-medium">2. Change it in Jarvis.</b> This replaces the decision with <span className="mono">{t.valueB}</span>.<div className="mt-1"><Button size="sm" busy={edit.busy} disabled={!t.written || !!t.edited} onClick={() => edit.run(t.id)} data-testid="rt-edit">Change the decision</Button> <Link className="text-accent underline underline-offset-2 ml-2" href={`/projects/${t.projectId}`}>Open the project</Link></div>{t.edited && <p className="text-accent mt-1">Changed {fmtDateTime(t.edited.at)}.</p>}{edit.error && <ErrorBox error={edit.error} />}</div></li>
          <li className="flex gap-2"><span aria-hidden>{t.read ? "✔" : "○"}</span><div className="min-w-0 flex-1"><b className="font-medium">3. Open a new Claude chat and send:</b><pre className="mono text-[13px] whitespace-pre-wrap rounded-lg bg-bg border border-line p-2.5 mt-1 select-all" data-testid="rt-say-read">{t.say.read}</pre>{t.read ? <p className={t.read.sawChange ? "text-accent mt-1" : "text-amber mt-1"}>{t.read.sawChange ? `Read ${fmtDateTime(t.read.at)} by ${t.read.client}, and it saw your change (${t.read.origin === "jarvis-ui" ? "edited in Jarvis" : t.read.origin}).` : "Read, but it did not see your change."}</p> : <p className="text-muted mt-1">Claude should quote <span className="mono">{t.valueB}</span> and say it was edited in Jarvis.</p>}</div></li>
        </ol>}
        {t?.complete && <Notice tone="accent"><span data-testid="rt-verdict">{t.verdict}</span></Notice>}
      </Card></section>
  );
}
