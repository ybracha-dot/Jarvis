"use client";
import { useState } from "react";
import Link from "next/link";
import { RefreshCw, Check, X, Share2, Pencil, ChevronDown, ArrowRight, CalendarPlus, FileText, TriangleAlert, Settings2 } from "lucide-react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Badge, ErrorBox, Spinner, cx } from "@/components/ui";
import { zonedToUtc } from "@/lib/time";

// ---------- time in the user's own words ----------
const F = (tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o });
const clock = (iso: string, tz: string) => F(tz, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dayKey = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
const shortDay = (iso: string, tz: string) => F(tz, { weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
const when = (iso: string, tz: string) => `${shortDay(iso, tz)}, ${clock(iso, tz)}`;
function relDay(iso: string, nowIso: string, tz: string) {
  const d = dayKey(iso, tz), n = dayKey(nowIso, tz); const diff = Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${n}T12:00:00Z`)) / 86400000);
  return diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff > 1 && diff < 7 ? `on ${F(tz, { weekday: "long" }).format(new Date(iso))}` : `on ${shortDay(iso, tz)}`;
}
const dueWords = (iso: string, nowIso: string, tz: string, assumed: boolean) => assumed ? `${relDay(iso, nowIso, tz)} (no time stated)` : `${relDay(iso, nowIso, tz)} at ${clock(iso, tz)}`;
/** "Tonight 7:30–8:30 PM, then 8:45–9:00 PM to print." One sentence, days named the way you would say them. */
function blockWords(blocks: any[], tz: string, now: string) {
  const parts: string[] = []; let last = "";
  for (const b of blocks) { const dk = dayKey(b.start, tz); const hour = Number(F(tz, { hour: "numeric", hourCycle: "h23" }).format(new Date(b.start))); const word = relDay(b.start, now, tz) === "today" ? (hour >= 17 ? "tonight" : "today") : relDay(b.start, now, tz).replace(/^on /, ""); const span = `${clock(b.start, tz)}–${clock(b.end, tz)}${b.step === "print" ? " to print" : ""}`;
    parts.push(dk === last ? `then ${span}` : `${word.charAt(0).toUpperCase()}${word.slice(1)} ${span}`); last = dk; }
  return parts.join(", ");
}
const srcName = (label: string) => label.replace(/\s*\((?:deadline|requirement|calendar|superseded deadline)\)\s*$/, "");

/** The lead in plain language. A moved deadline names the previous and the current one. When nothing material changed, the next action leads. */
function leadOf(a: any, tz: string, now: string) {
  const p0 = a.priorities[0]; const l = a.lead; const mine = l ? a.priorities.find((p: any) => p.key === l.key) : null;
  const next = (p: any) => p ? { text: p.next, source: p.evidence.find((e: any) => e.role === "requirement") ?? p.evidence[0] ?? null } : null;
  if (l && l.type === "due_moved" && l.due) return { eyebrow: "What changed", head: `${l.title} is due ${dueWords(l.due, now, tz, !!mine?.due?.assumedTime)}.`, was: l.previousDue ? { prev: when(l.previousDue, tz), now: when(l.due, tz), days: l.days } : null, next: next(mine ?? p0), key: l.key, source: l.source, sub: null };
  if (l && l.type === "requirement_added") return { eyebrow: "What changed", head: `New for ${l.title}: ${(mine?.next ?? l.text).replace(/\.$/, "")}.`, was: null, next: next(mine ?? p0), key: l.key, source: l.source, sub: null };
  if (l && l.type === "conflict") return { eyebrow: "What changed", head: `Two sources disagree about when ${l.title} is due.`, was: null, next: next(mine ?? p0), key: l.key, source: l.source, sub: null };
  if (l) return { eyebrow: "What changed", head: l.text, was: null, next: next(mine ?? p0), key: l.key, source: l.source, sub: null };
  if (p0) return { eyebrow: a.baseline ? "Your first brief, a baseline" : "Nothing material changed", head: `${p0.next.replace(/[.]$/, "")}.`, was: null, next: null, key: p0.key, source: null, sub: `${p0.title}${p0.due ? `, due ${dueWords(p0.due.at, now, tz, p0.due.assumedTime)}` : ""}` };
  return { eyebrow: a.baseline ? "Your first brief, a baseline" : "Nothing material changed", head: "Nothing is due soon in the sources Jarvis can read.", was: null, next: null, key: null, source: null, sub: null };
}

/** The first screen of the day: what changed, what to do, and the one action worth taking. Everything on it opens its source. */
export function BriefCard() {
  const q = useQuery<any>("/brief", { poll: 20000 });
  const run = useAction(async () => { await api("/brief/run", { body: {} }); });
  const d = q.data;
  if (q.loading && !d) return <Spinner label="Loading your brief" />;
  if (q.error && !d) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!d) return null;
  const a = d.analysis; const tz: string = d.tz; const now: string = d.now;
  const date = F(tz, { weekday: "long", month: "long", day: "numeric" }).format(new Date(now));
  return (
    <section aria-labelledby="today-h" data-testid="brief-card" className="min-w-0">
      <header className="flex items-start gap-3 mb-3 md:mb-5">
        <div className="min-w-0 flex-1">
          <h1 id="today-h" className="t-title">Today</h1>
          <p className="t-meta mt-1" data-testid="today-date">{date}</p>
        </div>
        <div className="flex items-center gap-1 pt-1" data-testid="brief-toolbar">
          {a && <Button size="sm" variant="secondary" busy={run.busy} onClick={() => run.run()} data-testid="brief-build" aria-label="Rebuild the brief"><RefreshCw className="size-4" aria-hidden /><span className="hidden sm:inline">Rebuild</span></Button>}
          <Link href="/settings#brief" aria-label="Brief settings" className="touch grid place-items-center rounded-lg text-muted hover:text-fg hover:bg-surface2" data-testid="brief-settings-link"><Settings2 className="size-[18px]" aria-hidden /></Link>
        </div>
      </header>
      {run.error && <div className="mb-4"><ErrorBox error={run.error} /></div>}
      <Machinery d={d} tz={tz} />

      <div className={cx("mt-4 md:mt-7", a && "lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10")}>
        <div className="min-w-0 space-y-7">
          {!a ? <FirstLaunch d={d} run={run} /> : <>
            <Lead a={a} d={d} tz={tz} now={now} />
            <Priorities a={a} tz={tz} now={now} />
            <Secondary a={a} tz={tz} resultId={d.resultId} />
          </>}
          <ClaudeRow d={d} />
        </div>
        {a && <aside className="hidden lg:block min-w-0 lg:sticky lg:top-8 self-start max-h-[calc(100dvh-8rem)] overflow-y-auto scroll-thin pr-1" aria-label="Agenda" data-testid="brief-agenda"><Agenda d={d} tz={tz} /></aside>}
        {a && <details className="lg:hidden mt-7 border-t border-line pt-3" data-testid="brief-agenda-phone"><summary className="disc touch cursor-pointer text-[16px] font-semibold flex items-center">Agenda<span className="t-meta ml-2 font-normal">today and what is coming</span></summary><div className="mt-3"><Agenda d={d} tz={tz} /></div></details>}
      </div>
    </section>
  );
}

// ---------- the compact scheduled-run line, with details on demand ----------
function Machinery({ d, tz }: { d: any; tz: string }) {
  const sch = d.scheduler; const a = d.analysis; const w = d.scheduleWarning;
  const nextText = sch.enabled && !sch.paused && sch.nextRun ? when(sch.nextRun.at, tz) : sch.paused ? "paused" : "off";
  return (
    <div data-testid="brief-status" className="space-y-2">
      {w && <div role="alert" className="flex gap-2 items-start rounded-xl border border-amber-dim bg-amber-soft px-3 py-2 text-[14px] sm:text-[14.5px]" data-testid="brief-warning"><TriangleAlert className="size-4 mt-0.5 shrink-0 text-amber" aria-hidden /><p className="min-w-0 line-clamp-3 sm:line-clamp-none"><b className="font-semibold text-amber">Attention: </b>{w.text} <span className="text-fg">{w.fix}</span></p></div>}
      {d.recentMisses.length > 0 && <div className="rounded-xl border border-amber-dim bg-amber-soft px-3 py-2 text-[14px] sm:text-[14.5px]" data-testid="brief-gaps"><p className="line-clamp-2 sm:line-clamp-none"><b className="font-semibold text-amber">A gap is visible. </b>{d.recentMisses.slice(0, 2).map((m: any) => `${shortDay(m.scheduledFor, tz)} ${clock(m.scheduledFor, tz)}: ${m.detail ?? m.status}`).join(" ")}</p></div>}
      {a?.gaps?.length > 0 && <div className="rounded-xl border border-amber-dim bg-amber-soft px-3 py-2 text-[14px] sm:text-[14.5px]" data-testid="brief-input-gaps"><p className="font-semibold text-amber inline sm:block">What I could not check </p><p className="sm:hidden inline line-clamp-2">{a.gaps.join(" · ")}</p><ul className="hidden sm:block list-disc pl-5 mt-0.5">{a.gaps.map((g: string, i: number) => <li key={i} className="break-words">{g}</li>)}</ul></div>}
      <details className="group" data-testid="brief-machinery">
        <summary className="t-meta cursor-pointer list-none flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-8 [&::-webkit-details-marker]:hidden">
          <span className={cx("size-2 rounded-full", sch.workerActive ? "bg-accent" : "bg-amber-solid")} aria-hidden />
          <span data-testid="brief-worker">Worker <span className={cx("font-medium", sch.workerActive ? "text-fg" : "text-amber")}>{sch.workerActive ? "running" : "not running"}</span></span>
          <span aria-hidden className="hidden sm:inline">·</span><span className="hidden sm:inline">Last check <b className="font-medium text-fg tnum" data-testid="brief-last">{d.lastSuccessAt ? when(d.lastSuccessAt, tz) : "never"}</b></span>
          <span aria-hidden className="hidden sm:inline">·</span><span className="hidden sm:inline">Next <b className="font-medium text-fg tnum" data-testid="brief-next-check">{nextText === "off" ? "none: private schedules are off" : nextText}</b></span>
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden /><span className="sr-only">Details</span>
        </summary>
        <div className="mt-2 rounded-xl border border-line bg-surface px-4 py-3 text-[14px] space-y-2">
          <p className="sm:hidden">Last check {d.lastSuccessAt ? when(d.lastSuccessAt, tz) : "never"}. Next {nextText === "off" ? "none: private schedules are off" : nextText}.</p>
          {sch.workerActive ? <p>The worker's heartbeat was {when(sch.lastHeartbeat, tz)}.</p> : <p>A worker runs scheduled briefs. Start one in Terminal with <span className="mono">npm run worker</span>.</p>}
          {!sch.enabled && <p>Private schedules are off until you choose. <Link href="/settings#brief" className="text-accent underline underline-offset-2">Turn them on</Link>.</p>}
          {sch.quietNow && <p>Quiet time you set, until {when(sch.quietNow, tz)}. Scheduled work waits.</p>}
          {a?.inputs?.length > 0 && <ul className="space-y-1" data-testid="brief-inputs">{a.inputs.map((i: any, k: number) => <li key={k} className="flex gap-2 items-baseline min-w-0"><Badge tone={i.state === "live" ? "accent" : i.state === "unavailable" ? "danger" : i.state === "stale" ? "amber" : "neutral"}>{i.state}</Badge><span className="break-words min-w-0">{i.label}<span className="t-meta"> · {i.detail}</span></span></li>)}</ul>}
        </div>
      </details>
    </div>
  );
}

// ---------- first launch ----------
function FirstLaunch({ d, run }: { d: any; run: any }) {
  return (
    <div data-testid="brief-empty" className="max-w-[34rem]">
      <p className="t-lead">{d.hasNotes ? "Your note is saved. Build your first brief." : "Start with one note about something due this week."}</p>
      <p className="t-body text-muted mt-3">{d.hasNotes ? "The first brief is a baseline: it shows what you owe now. From the next one it can say what changed." : "Paste an assignment or a project note. It stays on this computer, and the first brief is a baseline you can check against it."}</p>
      <div className="mt-6 flex items-center gap-4 flex-wrap">
        {d.hasNotes ? <Button variant="primary" busy={run.busy} onClick={() => run.run()} data-testid="brief-build" className="min-h-11 px-5 text-base"><RefreshCw className="size-4" aria-hidden />Build my first brief</Button>
          : <Link href="/try" data-testid="brief-add-note" className="touch inline-flex items-center gap-2 rounded-lg bg-accent text-on-accent font-medium px-5 min-h-11 text-base hover:brightness-110">Add your first note</Link>}
        {!d.hasCalendar && <Link href="/sources" className="text-[15px] text-accent underline underline-offset-4" data-testid="brief-add-calendar">Connect a calendar</Link>}
      </div>
    </div>
  );
}

// ---------- the lead and the one action ----------
function Lead({ a, d, tz, now }: { a: any; d: any; tz: string; now: string }) {
  const L = leadOf(a, tz, now); const p: any = a.priorities.find((x: any) => x.key === L.key) ?? a.priorities[0] ?? null;
  const reserve = useAction(async () => { await api("/brief/reserve", { body: { key: p.key, blocks: p.blocks.map((b: any) => ({ start: b.start, end: b.end })) } }); });
  const minutes = p ? p.blocks.reduce((n: number, b: any) => n + b.minutes, 0) : 0;
  const ev = p?.evidence.find((e: any) => e.role === "requirement") ?? p?.evidence[0];
  return (
    <div data-testid="brief-lead" className="space-y-3 max-w-[40rem]">
      <p className="t-meta uppercase tracking-[0.1em] font-medium" data-testid="brief-eyebrow">{L.eyebrow}</p>
      <h2 className="t-lead break-words" data-testid="brief-headline">{L.head}</h2>
      {L.sub && <p className="t-body text-muted">{L.sub}</p>}
      {L.was && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15.5px] tnum" data-testid="brief-was"><dt className="text-muted">Previously</dt><dd className="line-through decoration-line-strong text-muted">{L.was.prev}</dd><dt className="text-muted">Now</dt><dd className="font-semibold">{L.was.now}{L.was.days ? <span className="font-normal text-muted"> · {Math.abs(L.was.days)} day{Math.abs(L.was.days) === 1 ? "" : "s"} {L.was.days < 0 ? "earlier" : "later"}</span> : null}</dd></dl>}
      {L.next && <p className="t-body" data-testid="brief-lead-next"><span className="text-muted">Next: </span><b className="font-semibold">{L.next.text}.</b>{L.next.source && <> <Link href={L.next.source.href} className="text-accent underline underline-offset-4 whitespace-nowrap" data-testid="brief-lead-source">{srcName(L.next.source.label)}</Link></>}</p>}
      {!L.next && L.source && <p className="t-body"><Link href={L.source.itemId?.startsWith("task:") ? `/?drawer=task&id=${L.source.itemId.slice(5)}` : `/evidence/${L.source.itemId}?q=${encodeURIComponent((L.source.quote ?? "").slice(0, 80))}`} className="text-accent underline underline-offset-4" data-testid="brief-lead-source">Open the source: {L.source.title}</Link></p>}
      {p && <div className="pt-2 flex items-center gap-x-4 gap-y-2 flex-wrap" data-testid="brief-action">
        {p.reserved.length > 0
          ? <><p className="inline-flex items-center gap-2 text-[16px] font-semibold settle" data-testid="brief-reserved"><Check className="size-5 text-accent" aria-hidden />Reserved, {p.reserved.map((b: any) => `${clock(b.start, tz)}–${clock(b.end, tz)}`).join(" and ")}</p>{ev && <Link href={ev.href} className="touch inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 font-medium hover:bg-surface2" data-testid="brief-open"><FileText className="size-4" aria-hidden />Open the assignment</Link>}</>
          : p.blocks.length > 0
            ? <><Button variant="primary" busy={reserve.busy} onClick={() => reserve.run()} data-testid="brief-reserve" className="min-h-11 px-5 text-base">Reserve {minutes} min</Button><p className="t-meta max-w-[22rem]" data-testid="brief-when-note"><span className="font-medium text-fg">Suggested: </span>{blockWords(p.blocks, tz, now)}. {reserve.busy ? "Saving the reservation…" : "Nothing is reserved until you press the button, and a reservation stays on this computer."}</p></>
            : !d.hasCalendar
              ? <><Link href="/sources" className="touch inline-flex items-center gap-2 rounded-lg bg-accent text-on-accent font-medium px-5 min-h-11 text-base hover:brightness-110" data-testid="brief-add-calendar"><CalendarPlus className="size-4" aria-hidden />Add a calendar</Link><p className="t-meta max-w-[22rem]" data-testid="brief-no-block">No time is proposed: no calendar has been read, so open time would be a guess.</p></>
              : <>{ev && <Link href={ev.href} className="touch inline-flex items-center gap-2 rounded-lg bg-accent text-on-accent font-medium px-5 min-h-11 text-base hover:brightness-110" data-testid="brief-open"><FileText className="size-4" aria-hidden />Open the assignment</Link>}<p className="t-meta max-w-[24rem]" data-testid="brief-no-block">No time proposed. {p.blockNote ?? ""}</p></>}
      </div>}
      {reserve.error && <ErrorBox error={reserve.error} />}
    </div>
  );
}

// ---------- up to three priorities ----------
function Priorities({ a, tz, now }: { a: any; tz: string; now: string }) {
  if (!a.priorities.length) return <div data-testid="brief-owed" className="t-meta">{a.owedBeforeTomorrow} due before tomorrow ends.</div>;
  return (
    <div data-testid="brief-owed">
      <h2 className="t-meta uppercase tracking-[0.1em] font-medium mb-1">Do these <span className="normal-case tracking-normal">· {a.owedBeforeTomorrow} due before tomorrow ends</span></h2>
      <ol className="border-t border-line" data-testid="brief-priorities">{a.priorities.map((p: any, i: number) => <Row key={p.key} p={p} tz={tz} now={now} a={a} leadKey={leadOf(a, tz, now).key} first={i === 0} />)}</ol>
    </div>
  );
}
function Row({ p, tz, a, now, leadKey }: { p: any; tz: string; now: string; a: any; leadKey: string | null; first: boolean }) {
  const isLead = p.key === leadKey;
  const [open, setOpen] = useState(false); const [fix, setFix] = useState(false); const [due, setDue] = useState(""); const [est, setEst] = useState("");
  const reserve = useAction(async () => { await api("/brief/reserve", { body: { key: p.key, blocks: p.blocks.map((b: any) => ({ start: b.start, end: b.end })) } }); });
  const dismiss = useAction(async () => { await api("/brief/feedback", { body: { key: p.key, kind: "dismiss" } }); });
  const correct = useAction(async () => {
    if (due) { const [dt, tm] = due.split("T"); const [y, mo, dd] = dt.split("-").map(Number); const [h, mi] = tm.split(":").map(Number); await api("/brief/feedback", { body: { key: p.key, kind: "due", value: zonedToUtc(y, mo, dd, h, mi, tz).toISOString(), note: "Corrected in the brief" } }); }
    if (est) await api("/brief/feedback", { body: { key: p.key, kind: "estimate", value: Number(est) } }); setFix(false); setDue(""); setEst("");
  });
  const src = p.evidence.find((e: any) => e.role === "deadline") ?? p.evidence[0]; const id = `row-${p.key.replace(/\W/g, "")}`; const minutes = p.blocks.reduce((n: number, b: any) => n + b.minutes, 0);
  return (
    <li className="border-b border-line" data-testid="brief-priority" data-key={p.key}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id} className="w-full text-left py-3.5 flex gap-3 items-start min-h-[56px] hover:bg-surface2/60 -mx-2 px-2 rounded-lg" data-testid="brief-row-toggle">
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold leading-snug break-words" data-testid="brief-next">{isLead ? p.title : p.next}</span>
          <span className="block t-meta mt-0.5 break-words"><span data-testid="brief-title">{isLead ? "Details, sources and corrections" : p.title}</span>{p.changed.length > 0 && <> · <span className="text-amber font-medium">changed</span></>}{p.conflicts.length > 0 && <> · <span className="text-danger font-medium">sources disagree</span></>}</span>
        </span>
        <span className="text-right shrink-0 tnum" data-testid="brief-due"><span className="block text-[15.5px] font-medium">{p.due ? `${F(tz, { weekday: "short" }).format(new Date(p.due.at))} ${p.due.assumedTime ? "" : clock(p.due.at, tz)}` : "no date"}</span><span className="block t-meta">{p.due ? p.due.relative : ""}</span></span>
        <ChevronDown className={cx("size-4 mt-1.5 text-muted transition-transform shrink-0", open && "rotate-180")} aria-hidden />
      </button>
      {src && <p className="-mt-1.5 mb-2.5 text-[14px]"><Link href={src.href} className="text-accent underline underline-offset-4" data-testid="brief-evidence-short">{srcName(src.label)}</Link></p>}
      <div id={id} className="reveal" data-open={open} role="region" aria-label={`Details for ${p.title}`}>
        <div><div className="pb-4 space-y-3 text-[15px]" data-testid="brief-detail">
          <ul className="space-y-1.5">{p.evidence.map((e: any, i: number) => <li key={i} className="break-words"><Link href={e.href} className="text-accent underline underline-offset-4" data-testid="brief-evidence">{e.label}</Link><span className="block text-muted pl-3 border-l-2 border-line-strong mt-0.5">“{e.quote}”</span></li>)}</ul>
          {p.deadlineHistory.map((h: any, i: number) => <p key={i} className="t-meta break-words" data-testid="brief-history"><Link href={h.href} className="underline underline-offset-4">{h.label}</Link></p>)}
          {p.conflicts.map((c: any, i: number) => <p key={i} className="text-[14px] text-danger break-words"><b>Conflict. </b><Link href={c.href} className="underline underline-offset-4">{c.label}</Link> The earlier date is used until you decide.</p>)}
          {p.why.filter((w: string) => !/^Moved up|^Pushed back|^Replaced the earlier/.test(w)).map((w: string, i: number) => <p key={i} className="t-meta break-words">{w}</p>)}
          {p.asks.map((x: string, i: number) => <p key={i} className="rounded-lg border border-amber-dim bg-amber-soft px-3 py-2 text-[14px]">{x} <Link href="/try" className="underline underline-offset-4">Add it</Link></p>)}
          <p className="t-meta" data-testid="brief-estimate">Time estimate: {p.estimate.label}</p>
          {p.blocks.length > 0 && p.key !== a.priorities[0]?.key && <div className="flex items-center gap-3 flex-wrap"><Button size="sm" variant="secondary" busy={reserve.busy} onClick={() => reserve.run()} data-testid="brief-reserve-row">Reserve {minutes} min</Button><span className="t-meta">{blockWords(p.blocks, tz, now)}</span></div>}
          {p.reserved.length > 0 && p.key !== a.priorities[0]?.key && <p className="text-[14.5px] font-medium inline-flex items-center gap-1.5"><Check className="size-4 text-accent" aria-hidden />Reserved, {p.reserved.map((b: any) => `${shortDay(b.start, tz)} ${clock(b.start, tz)}–${clock(b.end, tz)}`).join(" and ")}</p>}
          {!p.blocks.length && !p.reserved.length && <p className="t-meta" data-testid="brief-no-block-row">No time proposed. {p.blockNote ?? ""}</p>}
          <div className="flex gap-2 flex-wrap"><Button size="sm" onClick={() => setFix((v) => !v)} aria-expanded={fix} data-testid="brief-correct"><Pencil className="size-3.5" aria-hidden />Correct</Button><Button size="sm" busy={dismiss.busy} onClick={() => dismiss.run()} data-testid="brief-dismiss"><X className="size-3.5" aria-hidden />Dismiss</Button></div>
          {fix && <div className="rounded-xl border border-line bg-surface p-3.5 space-y-2.5 settle" data-testid="brief-correct-form">
            <p className="t-meta">Tell Jarvis what is wrong. Your correction sits above every source, and the next brief says you made it.</p>
            <label className="block text-[14px]">Correct deadline<input type="datetime-local" className="block mt-1 w-full rounded-lg bg-bg border border-line px-3 py-2 text-[15px]" value={due} onChange={(e) => setDue(e.target.value)} data-testid="brief-fix-due" /></label>
            <label className="block text-[14px]">Correct estimate (minutes)<input type="number" min={5} max={1200} className="block mt-1 w-full rounded-lg bg-bg border border-line px-3 py-2 text-[15px]" value={est} onChange={(e) => setEst(e.target.value)} data-testid="brief-fix-est" /></label>
            <Button size="sm" variant="primary" busy={correct.busy} disabled={!due && !est} onClick={() => correct.run()} data-testid="brief-fix-save">Save and rebuild</Button>{correct.error && <ErrorBox error={correct.error} />}</div>}
          {(dismiss.error || reserve.error) && <ErrorBox error={(dismiss.error || reserve.error)!} />}
        </div></div>
      </div>
    </li>
  );
}
function Secondary({ a, tz, resultId }: { a: any; tz: string; resultId: string | null }) {
  return (
    <div className="space-y-3">
      {a.alsoDue.length > 0 && <details data-testid="brief-also-due"><summary className="disc touch cursor-pointer text-[15px] font-medium flex items-center">Also due <span className="t-meta ml-2 font-normal">{a.alsoDue.length + a.alsoDueMore} more</span></summary><ul className="mt-1 divide-y divide-line border-t border-line">{a.alsoDue.map((o: any) => <li key={o.key} className="py-2.5 flex gap-3 items-baseline min-w-0"><span className="min-w-0 flex-1 break-words">{o.href ? <Link className="underline underline-offset-4" href={o.href}>{o.title}</Link> : o.title}</span><span className="t-meta tnum shrink-0">{o.label}</span><DismissOnly k={o.key} /></li>)}{a.alsoDueMore > 0 && <li className="py-2.5 t-meta">…and {a.alsoDueMore} more</li>}</ul></details>}
      {a.dismissed.length > 0 && <p className="t-meta" data-testid="brief-dismissed">Dismissed: {a.dismissed.map((x: any) => x.title).join("; ")}. <UndoDismiss keys={a.dismissed.map((x: any) => x.key)} /></p>}
      {a.leftOut?.length > 0 && <p className="t-meta">Left out: {a.leftOut.join(" ")}</p>}
      <p className="t-meta" data-testid="brief-built">Built {when(a.builtAt, tz)} · {a.kind === "scheduled" ? "scheduled run" : "on request"}{a.baseline ? " · baseline" : ""} · no model was called{resultId && <> · <Link href={`/results/${resultId}`} className="text-accent underline underline-offset-4">Open the saved brief</Link></>}</p>
    </div>
  );
}
function DismissOnly({ k }: { k: string }) { const d = useAction(async () => { await api("/brief/feedback", { body: { key: k, kind: "dismiss" } }); }); return <button className="touch text-[13px] text-muted underline underline-offset-4" onClick={() => d.run()}>dismiss</button>; }
function UndoDismiss({ keys }: { keys: string[] }) { const u = useAction(async () => { for (const k of keys) await api("/brief/feedback", { body: { key: k, kind: "undismiss" } }); }); return <button className="underline underline-offset-4 text-accent" onClick={() => u.run()} data-testid="brief-undo-dismiss">Undo</button>; }

// ---------- the agenda: real busy time, deadlines, suggestions and reservations, each distinct ----------
const KIND: Record<string, { label: string; cls: string; bar: string }> = {
  busy: { label: "Busy", cls: "text-muted", bar: "bg-line-strong" }, class: { label: "Class", cls: "text-muted", bar: "bg-line-strong" }, quiet: { label: "Quiet", cls: "text-muted", bar: "bg-line-strong" },
  deadline: { label: "Due", cls: "text-danger", bar: "bg-danger" }, proposed: { label: "Suggested", cls: "text-accent", bar: "border border-dashed border-accent bg-transparent" }, reserved: { label: "Reserved", cls: "text-accent", bar: "bg-accent" },
};
function Agenda({ d, tz }: { d: any; tz: string }) {
  const ag = d.agenda; if (!ag) return null;
  return (
    <div className="space-y-5" data-testid="brief-agenda-body">
      <h2 className="t-meta uppercase tracking-[0.1em] font-medium hidden lg:block">Agenda</h2>
      {ag.days.map((day: any) => (
        <section key={day.day} aria-label={day.name}>
          <div className="flex items-baseline gap-2 border-b border-line pb-1.5"><h3 className="text-[15px] font-semibold">{day.name}</h3><span className={cx("t-meta ml-auto", !day.covered && "text-amber font-medium")} data-testid={day.covered ? "agenda-day-known" : "agenda-day-unknown"}>{day.confirmedByYou ? "You confirmed" : day.covered ? "Calendar read" : "Calendar unknown"}</span></div>
          {day.items.length === 0 ? <p className="t-meta py-2">{day.covered ? "Nothing on your calendar." : day.coverageNote}</p> :
            <ul className="divide-y divide-line">{day.items.map((it: any) => { const k = KIND[it.kind]; return (
              <li key={it.id} className="py-2 flex gap-3 items-start" data-testid={`agenda-${it.kind}`}>
                <span className="w-[4.6rem] shrink-0 text-[13.5px] tnum text-muted pt-px">{clock(it.start, tz)}{it.end && <><br />{clock(it.end, tz)}</>}</span>
                <span className={cx("w-1 self-stretch rounded-full shrink-0", k.bar)} aria-hidden />
                <span className="min-w-0 flex-1"><span className="block text-[15px] leading-snug break-words">{it.href ? <Link href={it.href} className="underline underline-offset-4">{it.label}</Link> : it.label}</span><span className={cx("block text-[12.5px] font-medium", k.cls)}>{k.label}<span className="font-normal text-muted"> · {it.detail}</span></span></span>
              </li>); })}</ul>}
          {day.items.length > 0 && !day.covered && <p className="t-meta pt-1.5 text-amber">{day.coverageNote}</p>}
          {!day.covered && d.hasCalendar && <ConfirmDay day={day} />}
          {day.confirmedByYou && <ConfirmDay day={day} undo />}
        </section>))}
      <details className="t-meta" data-testid="agenda-coverage"><summary className="disc cursor-pointer min-h-8 flex items-center">How Jarvis knows what is free</summary><ul className="mt-1 space-y-1">{ag.coverage.length ? ag.coverage.map((c: string, i: number) => <li key={i}>{c}</li>) : <li>No calendar has been read. Open time is unknown, not free.</li>}</ul></details>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted" aria-label="Legend">{["deadline", "proposed", "reserved", "busy"].map((k) => <li key={k} className="flex items-center gap-1.5"><span className={cx("w-1 h-3 rounded-full", KIND[k].bar)} aria-hidden />{KIND[k].label === "Due" ? "Instructor's deadline" : KIND[k].label}</li>)}</ul>
    </div>
  );
}

function ConfirmDay({ day, undo }: { day: any; undo?: boolean }) {
  const go = useAction(async () => { await api("/brief/coverage", { body: { day: day.day, confirmed: !undo } }); });
  return <div className="pt-1.5">{go.error && <ErrorBox error={go.error} />}<button type="button" onClick={() => go.run()} disabled={go.busy} aria-label={undo ? `Take back my confirmation for ${day.name}` : `Confirm ${day.name} is open`} data-testid={undo ? "agenda-unconfirm" : "agenda-confirm"} className="touch text-[13.5px] text-accent underline underline-offset-4 disabled:opacity-50">{undo ? "Take back my confirmation" : `I know ${day.name} is open: confirm it`}</button></div>;
}

// ---------- Claude, quietly ----------
function ClaudeRow({ d }: { d: any }) {
  const share = useAction(async (on: boolean, id: string) => { await api(`/sharing/results/${id}`, { body: { share: on } }); });
  const prev = useQuery<any>(d.resultId ? "/sharing/brief-preview" : null);
  if (!d.analysis || !d.resultId) return null;
  const p = prev.data;
  return (
    <div className="border-t border-line pt-4 space-y-2" data-testid="brief-share">
      <div className="flex gap-x-4 gap-y-2 items-center flex-wrap">
        <p className="text-[15px] flex items-center gap-2 min-w-0"><Share2 className="size-4 text-muted shrink-0" aria-hidden />{d.sharedClaudeCanRead ? <span data-testid="brief-shared-state" className="font-medium">Claude can read a shared version</span> : <span>Claude cannot see this brief</span>}</p>
        {d.sharedClaudeCanRead ? <><Link className="text-[14px] text-accent underline underline-offset-4" href={`/results/${d.sharedResultId}`}>Open it</Link><span className="t-meta">ID <b className="mono text-fg select-all font-medium" data-testid="brief-shared-id">{d.sharedResultId}</b></span><Button size="sm" busy={share.busy} onClick={() => share.run(false, d.resultId)} data-testid="brief-unshare">Take it back</Button></>
          : <Button size="sm" busy={share.busy} onClick={() => share.run(true, d.resultId)} data-testid="brief-share-btn"><Share2 className="size-3.5" aria-hidden />Share a Claude-safe view</Button>}
        <Link className="text-[14px] text-accent inline-flex items-center gap-1 ml-auto" href="/connections#sharing">What Claude can read <ArrowRight className="size-3.5" aria-hidden /></Link>
      </div>
      {p && <details className="t-meta" data-testid="brief-share-preview"><summary className="disc cursor-pointer min-h-8 flex items-center">Preview what Claude would receive</summary>
        <div className="mt-1 space-y-1"><p>{p.included.length ? <>Included: {p.included.map((x: any) => `${x.title}${x.due ? ` (due ${x.due})` : ""}`).join("; ")}.</> : "Nothing yet: none of your notes are shared with Claude."}</p><p>Never included: your calendar, work blocks, course records, promises, and any note marked local-only.{p.withheld ? ` ${p.withheld} item${p.withheld === 1 ? " is" : "s are"} kept out because ${p.withheld === 1 ? "it comes" : "they come"} from local-only notes.` : ""}</p></div></details>}
      {share.error && <ErrorBox error={share.error} />}
    </div>
  );
}
export { cx };
