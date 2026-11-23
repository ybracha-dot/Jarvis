"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, ListChecks, Target, CheckCheck, Brain, Sparkles, Users, MoreHorizontal, Search, Plus, Inbox, Settings, Plug, Mic, FolderInput, Activity, Bell, Command as CmdIcon, WifiOff, GitCompareArrows, Building2, GraduationCap, FolderKanban } from "lucide-react";
import { api, useQuery, useAction, ApiError } from "./api";
import { Button, Badge, Drawer, Field, inputCls, cx, Mono, Notice, ErrorBox, Spinner, Empty } from "./ui";
import { DecisionDrawer, DecisionList } from "./DecisionDrawer";
import { TaskDrawer } from "./TaskDrawer";
import { ConnectionsDrawer } from "./Connections";
import { Orb } from "./Orb";
import { VoiceDock } from "./VoiceDock";
import { fmtDateTime, localHM } from "@/lib/time";

// Four places you live in. Everything else stays one tap away under More, and in the command palette.
const NAV = [
  { href: "/", label: "Today", icon: CalendarClock },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/office", label: "Office", icon: Building2 },
  { href: "/memory", label: "Memory", icon: Brain },
];
const MORE = [
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/activity", label: "Activity and outcomes", icon: Activity },
  { href: "/completed", label: "Completed", icon: CheckCheck },
  { href: "/skills", label: "Skills", icon: Sparkles },
  { href: "/council", label: "Council", icon: Users },
  { href: "/courses", label: "Courses", icon: GraduationCap },
  { href: "/sources", label: "Sources and import", icon: FolderInput },
  { href: "/voice", label: "Advisor room", icon: Mic },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function useDrawerParams() {
  const sp = useSearchParams(); const router = useRouter(); const pathname = usePathname();
  const open = useCallback((key: "decision" | "task" | "connections" | "capture" | "quick", id: string = "1") => {
    const q = new URLSearchParams(sp.toString()); for (const k of ["decision", "task", "connections", "capture", "quick"]) q.delete(k); q.set(key, id); router.push(`${pathname}?${q.toString()}`, { scroll: false });
  }, [sp, router, pathname]);
  const close = useCallback((key: string) => {
    const q = new URLSearchParams(sp.toString()); q.delete(key); const s = q.toString(); router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);
  return { sp, open, close };
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="p-6"><Spinner /></div>}><ShellInner>{children}</ShellInner></Suspense>;
}

const MAIN_ROUTES = ["/", "/projects", "/memory", "/office"];
function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sp, open, close } = useDrawerParams();
  const session = useQuery<any>("/session");
  const today = useQuery<any>("/today", { poll: 5000 });
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const [online, setOnline] = useState(true);
  const [kb, setKb] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null); const moreBtnMobile = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); } };
    window.addEventListener("keydown", k);
    // The software keyboard: the tab bar steps aside and the composer rides above the keyboard.
    const vv = window.visualViewport; const onVv = () => { if (!vv) return; const covered = window.innerHeight - vv.height - vv.offsetTop; document.documentElement.style.setProperty("--kb", `${Math.max(0, covered)}px`); setKb(covered > 120); };
    vv?.addEventListener("resize", onVv); vv?.addEventListener("scroll", onVv);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("keydown", k); vv?.removeEventListener("resize", onVv); vv?.removeEventListener("scroll", onVv); };
  }, []);
  useEffect(() => { setMore(false); }, [pathname]);
  // Closing a panel returns focus to what opened it.
  const closeMore = (to?: React.RefObject<HTMLButtonElement | null>) => { setMore(false); setTimeout(() => to?.current?.focus(), 0); };
  useEffect(() => { if (!more) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setMore(false); (window.matchMedia("(min-width: 768px)").matches ? moreBtn : moreBtnMobile).current?.focus(); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [more]);

  const s = session.data; const t = today.data;
  const demo = s?.mode !== "personal";
  const pending = t?.decisionsPending ?? 0;
  const decisionId = sp.get("decision"); const taskId = sp.get("task");
  const isMain = MAIN_ROUTES.some((r) => (r === "/" ? pathname === "/" : pathname.startsWith(r)));
  const switchMode = useAction(async () => { await api("/mode", { body: { mode: demo ? "personal" : "demo" } }); window.location.href = "/"; });
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:m-2 focus:rounded-md focus:bg-accent focus:text-on-accent focus:px-3 focus:py-2">Skip to content</a>

      <aside className="hidden md:flex w-[216px] shrink-0 flex-col sticky top-0 h-dvh border-r border-line px-3 pt-5 pb-4 bg-bg" aria-label="Sidebar">
        <Link href="/" aria-label="Jarvis home" className="flex items-center gap-2.5 px-2 mb-6"><Orb size={34} /><span className="text-[20px] font-semibold tracking-tight">Jarvis</span></Link>
        <nav aria-label="Main" className="space-y-0.5">
          {NAV.map((n) => <SideLink key={n.href} {...n} active={active(n.href)} badge={n.href === "/" ? pending : 0} />)}
        </nav>
        <button onClick={() => setPalette(true)} aria-label="Open command palette" className="mt-4 touch flex items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[14.5px] text-muted hover:text-fg min-h-10">
          <Search className="size-4" aria-hidden />Ask or search<span className="ml-auto mono text-[12px] flex items-center gap-0.5"><CmdIcon className="size-3" aria-hidden />K</span>
        </button>
        <div className="flex-1" />
        <div className="relative">
          <button ref={moreBtn} onClick={() => (more ? closeMore(moreBtn) : setMore(true))} aria-label="More" aria-expanded={more} className="touch w-full flex items-center gap-3 rounded-lg px-3 text-[15px] text-muted hover:text-fg hover:bg-surface2 min-h-10"><MoreHorizontal className="size-[18px]" aria-hidden />More</button>
          {more && <MoreMenu className="absolute left-0 bottom-12" onPick={() => setMore(false)} />}
        </div>
        <Link href="/connections" aria-label="Connections" className="touch flex items-center gap-3 rounded-lg px-3 text-[15px] text-muted hover:text-fg hover:bg-surface2 min-h-10"><Plug className="size-[18px]" aria-hidden />Connections</Link>
        <div className="mt-3 pt-3 border-t border-line space-y-2 px-1" data-testid="workspace-badge">
          {demo ? <Badge tone="amber" className="whitespace-nowrap">EXAMPLE WORKSPACE</Badge> : <Badge tone="accent" className="whitespace-nowrap">PRIVATE WORKSPACE</Badge>}
          {t && <Mono className="block text-[12.5px] text-muted tnum">{demo ? "Demo clock " : ""}{fmtDateTime(t.now)}</Mono>}
          <Button size="sm" variant="ghost" busy={switchMode.busy} onClick={() => switchMode.run()} className="-ml-2">{demo ? "Open private workspace" : "Back to example"}</Button>
          <RunBadge demo={demo} />
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-dvh">
        {!online && <div role="status" className="bg-amber-dim text-amber text-[14px] px-4 py-1.5 flex items-center gap-2"><WifiOff className="size-3.5" aria-hidden />Offline. Showing what was last loaded. Changes will fail until you reconnect.</div>}
        <header className="md:hidden h-14 shrink-0 border-b border-line flex items-center gap-3 px-4 glass sticky top-0 z-30 pt-[env(safe-area-inset-top)] box-content">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="Jarvis home"><Orb size={30} />Jarvis</Link>
          <div className="flex items-center gap-2 min-w-0 ml-1" data-testid="workspace-badge-phone">
            {demo ? <Badge tone="amber" className="whitespace-nowrap">EXAMPLE</Badge> : <Badge tone="accent" className="whitespace-nowrap">PRIVATE</Badge>}
            {t && <Mono className="text-[13px] text-muted whitespace-nowrap tnum">{localHM(t.now)}</Mono>}
          </div>
          <div className="flex-1" />
          <button onClick={() => setPalette(true)} aria-label="Open command palette" className="touch grid place-items-center text-muted"><Search className="size-5" aria-hidden /></button>
        </header>

        <main id="main" tabIndex={-1} className={cx("flex-1 min-w-0 px-4 md:px-10 pt-5 md:pt-10 w-full max-w-[1240px] mx-auto outline-none", isMain ? "pb-44 md:pb-10" : "pb-28 md:pb-10")}>
          {children}
        </main>

        {isMain && <div className={cx("z-30 px-3 md:px-10 pointer-events-none fixed inset-x-0 md:sticky md:bottom-0 md:pb-4", kb ? "bottom-[var(--kb)]" : "bottom-[calc(4.4rem+env(safe-area-inset-bottom))] md:bottom-0")} data-testid="composer-wrap">
          <div className="w-full max-w-[1240px] mx-auto pointer-events-none relative"><div aria-hidden className="absolute -inset-x-3 md:-inset-x-10 -top-6 -bottom-0 md:-bottom-4 bg-gradient-to-t from-bg from-55% to-transparent" /><div className="relative max-w-[46rem] pointer-events-auto pb-2 md:pb-0"><VoiceDock variant="bar" /></div></div></div>}
      </div>

      {!kb && <nav aria-label="Primary mobile" className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line glass grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        <MobTab href="/" label="Today" icon={CalendarClock} active={pathname === "/"} badge={pending} />
        <MobTab href="/projects" label="Projects" icon={FolderKanban} active={pathname.startsWith("/projects")} />
        <MobTab href="/office" label="Office" icon={Building2} active={pathname.startsWith("/office")} />
        <MobTab href="/memory" label="Memory" icon={Brain} active={pathname.startsWith("/memory")} />
        <button ref={moreBtnMobile} onClick={() => setMore(true)} aria-expanded={more} aria-label="More" className="touch flex flex-col items-center justify-center gap-0.5 py-1.5 text-muted min-h-[56px]"><MoreHorizontal className="size-5" aria-hidden /><span className="text-[12px]">More</span></button>
      </nav>}
      {more && <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More">
        <div className="absolute inset-0 bg-black/50 overlay" onClick={() => closeMore(moreBtnMobile)} />
        <div className="absolute bottom-0 inset-x-0 bg-surface border-t border-line rounded-t-2xl p-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-h-[80dvh] overflow-y-auto lift drawer">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setMore(false); open("capture"); }} data-testid="mobile-capture" className="touch flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-3 text-[15px] col-span-2 font-medium"><Plus className="size-4" aria-hidden />Capture a promise or note</button>
            {MORE.map((n) => <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="touch flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-3 text-[15px]"><n.icon className="size-4 text-muted" aria-hidden />{n.label}</Link>)}
            <Link href="/decisions" onClick={() => setMore(false)} className="touch flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-3 text-[15px]"><GitCompareArrows className="size-4 text-muted" aria-hidden />Decisions{pending ? ` (${pending})` : ""}</Link>
            <button onClick={() => switchMode.run()} className="touch flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-3 text-[15px] col-span-2">{demo ? "Open private workspace" : "Back to example workspace"}</button>
            <div className="col-span-2 px-1"><RunBadge demo={demo} /></div>
          </div>
        </div>
      </div>}

      {decisionId && <DecisionDrawer id={decisionId} onClose={() => close("decision")} />}
      {taskId && <TaskDrawer id={taskId} onClose={() => close("task")} />}
      {sp.get("connections") && <ConnectionsDrawer onClose={() => close("connections")} />}
      {sp.get("capture") && <CaptureDrawer onClose={() => close("capture")} />}
      {sp.get("quick") && <QuickDrawer kind={sp.get("quick")!} onClose={() => close("quick")} />}
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

/** Which build is serving, and whether a worker is beating on this workspace. Small, always there, never alarming when everything is fine. */
function RunBadge({ demo }: { demo: boolean }) {
  const h = useQuery<any>("/health", { poll: 15000 });
  const d = h.data; if (!d) return null;
  const w = d.workspaces?.[demo ? "demo" : "personal"]?.worker;
  const ok = !!w?.running && w.sameDataFolder !== false;
  return <div className="text-[12px] text-muted leading-snug" data-testid="run-badge" title={d.builtAt ? `Built ${new Date(d.builtAt).toLocaleString()}` : undefined}>
    <div className="flex items-center gap-1.5"><span className={cx("size-1.5 rounded-full", ok ? "bg-accent" : "bg-amber-solid")} aria-hidden /><span data-testid="worker-state">{ok ? "Worker running" : "No worker on this workspace"}</span></div>
    <div className="mono" data-testid="build-id">build {d.build}</div>
  </div>;
}
function SideLink({ href, label, icon: Icon, active, badge }: { href: string; label: string; icon: any; active: boolean; badge?: number }) {
  return (
    <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={cx("relative touch flex items-center gap-3 rounded-lg px-3 min-h-10 text-[15.5px] transition-colors", active ? "bg-surface text-fg font-semibold lift" : "text-muted hover:text-fg hover:bg-surface2")}>
      <Icon className={cx("size-[18px]", active && "text-accent")} aria-hidden />{label}
      {!!badge && <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-amber-solid text-[12px] font-semibold text-on-amber grid place-items-center">{badge}</span>}
    </Link>
  );
}
function MobTab({ href, label, icon: Icon, active, badge }: { href: string; label: string; icon: any; active: boolean; badge?: number }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cx("relative touch flex flex-col items-center justify-center gap-0.5 py-1.5 min-h-[56px]", active ? "text-accent font-semibold" : "text-muted")}>
      <Icon className="size-5" aria-hidden /><span className="text-[12px]">{label}</span>
      {!!badge && <span className="absolute top-1 left-1/2 ml-2 min-w-5 h-5 px-1 rounded-full bg-amber-solid text-[12px] font-semibold text-on-amber grid place-items-center">{badge}</span>}
    </Link>
  );
}
function MoreMenu({ className, onPick }: { className?: string; onPick?: () => void }) {
  return <div className={cx("z-50 w-60 rounded-xl border border-line bg-surface p-1 lift", className)}>{MORE.map((m) => <Link key={m.href} href={m.href} onClick={onPick} className="touch flex items-center gap-2 px-3 py-2 rounded-lg text-[15px] hover:bg-surface2"><m.icon className="size-4 text-muted" aria-hidden />{m.label}</Link>)}</div>;
}

function CaptureDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"promise" | "note">("promise");
  const [f, setF] = useState({ who: "", owedTo: "Yonathan", action: "", dueDate: "" });
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const save = useAction(async () => {
    if (tab === "promise") { await api("/commitments", { body: { who: f.who, owedTo: f.owedTo, action: f.action, dueDate: f.dueDate || null } }); setDone("Promise saved. It is open under Tasks, Follow-ups."); setF({ who: "", owedTo: "Yonathan", action: "", dueDate: "" }); }
    else { await api("/capture", { body: { text: note } }); setDone("Saved to your Inbox note folder."); setNote(""); }
  });
  return (
    <Drawer title="Capture" subtitle="Only promises you accept are tracked." onClose={onClose}>
      <div className="flex gap-1 p-1 rounded-lg bg-bg border border-line w-fit" role="tablist">
        {(["promise", "note"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setDone(null); }} className={cx("px-3 py-1.5 rounded-md text-sm", tab === k ? "bg-surface2 text-fg" : "text-muted")}>{k === "promise" ? "A promise" : "A note"}</button>)}
      </div>
      {tab === "promise" ? <div className="space-y-3">
        <Field label="Who owes"><input className={inputCls} value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} placeholder="Example advisor" /></Field>
        <Field label="Owed to"><input className={inputCls} value={f.owedTo} onChange={(e) => setF({ ...f, owedTo: e.target.value })} /></Field>
        <Field label="What was promised"><input className={inputCls} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="Check transfer credit" /></Field>
        <Field label="Due date (optional)"><input type="date" className={inputCls} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
      </div> : <Field label="Note"><textarea className={cx(inputCls, "min-h-28")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="One idea per note" /></Field>}
      {save.error && <ErrorBox error={save.error} />}
      {done && <Notice tone="accent">{done}</Notice>}
      <Button variant="primary" busy={save.busy} disabled={tab === "promise" ? !(f.who && f.action) : note.trim().length < 2} onClick={() => save.run()}>Save</Button>
    </Drawer>
  );
}

function QuickDrawer({ kind, onClose }: { kind: string; onClose: () => void }) {
  const [mins, setMins] = useState(kind === "minutes" ? 20 : 22);
  const q = useQuery<any>(`/resume?minutes=${kind === "resume" ? 240 : mins}`);
  const { open } = useDrawerParams();
  const sug = q.data?.suggestion;
  return (
    <Drawer title={kind === "resume" ? "Resume" : "I have some minutes"} subtitle={kind === "resume" ? "Where you stopped" : "One finishable step"} onClose={onClose}>
      {kind !== "resume" && <Field label="Minutes available"><div className="flex gap-2 flex-wrap">{[10, 20, 22, 45, 90].map((m) => <Button key={m} size="sm" variant={m === mins ? "primary" : "secondary"} onClick={() => setMins(m)}>{m}</Button>)}</div></Field>}
      {q.loading && <Spinner />}
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {sug && <div className="rounded-xl border border-line bg-bg p-4 space-y-2" data-testid="resume-card">
        {sug.kind === "none" ? <p className="text-sm">{sug.step}</p> : <>
          <div className="text-[13px] text-muted uppercase tracking-wider">{sug.task}</div>
          {sug.doc && <div className="text-sm"><Mono>{sug.doc}</Mono> <span className="text-muted">·</span> <span>{sug.section}</span></div>}
          <p className="text-[15px] font-medium leading-snug">{sug.step}</p>
          {sug.question && <p className="text-[14px] text-muted">Open question: {sug.question}</p>}
          <p className="text-[13px] text-muted">About {sug.estMinutes} min.</p>
          {sug.taskId && <Button size="sm" variant="primary" onClick={() => { onClose(); setTimeout(() => open("task", sug.taskId), 50); }}>Open task</Button>}
        </>}
      </div>}
    </Drawer>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter(); const { open } = useDrawerParams();
  const [q, setQ] = useState(""); const [sel, setSel] = useState(0); const [touched, setTouched] = useState(false);
  const [reply, setReply] = useState<any>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const items = useMemo(() => [
    ...NAV.map((n) => ({ label: `Go to ${n.label}`, run: () => router.push(n.href) })),
    ...MORE.map((n) => ({ label: `Go to ${n.label}`, run: () => router.push(n.href) })),
    { label: "Try Jarvis with one real note", run: () => router.push("/try") }, { label: "I have 20 minutes", run: () => open("quick", "minutes") }, { label: "Resume", run: () => open("quick", "resume") },
    { label: "Capture a promise", run: () => open("capture") }, { label: "What changed?", run: () => router.push("/#changes") },
    { label: "Bring in the council", run: () => router.push("/council") }, { label: "Source health", run: () => open("connections") },
  ], [router, open]);
  const filtered = items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
  const ask = useAction(async () => { const r = await api("/command", { body: { text: q } }); setReply(r); if (r.navigate && !r.confirm) { if (r.navigate.startsWith("?")) open("capture"); else router.push(r.navigate); onClose(); } });
  const confirmForget = useAction(async (id: string) => { await api(`/memory/notes/${id}`, { method: "DELETE" }); setReply({ reply: "Forgotten. Removed from search, vault and exports." }); });
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-3" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/60 overlay" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden">
        <input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); setTouched(false); setReply(null); }} placeholder="Go to a page, run an action, or type a command"
          aria-label="Command"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setTouched(true); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setTouched(true); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); if ((touched || !q.trim()) && filtered[sel]) { filtered[sel].run(); onClose(); } else if (q.trim()) ask.run(); }
          }}
          className="w-full bg-transparent px-4 py-3.5 text-[15px] outline-none border-b border-line placeholder:text-muted" />
        <div className="max-h-[50dvh] overflow-y-auto p-1.5 scroll-thin">
          {reply && <div className="m-1.5 rounded-lg bg-bg border border-line p-3 text-sm whitespace-pre-wrap" data-testid="command-reply">
            <div className="text-[12px] text-muted mb-1 uppercase tracking-wider">{reply.mode ? `${reply.intent} · ${reply.mode}` : "Done"}</div>{reply.reply}
            {reply.confirm && <div className="mt-2"><Button size="sm" variant="danger" busy={confirmForget.busy} onClick={() => confirmForget.run(reply.confirm.noteId)}>{reply.confirm.label}</Button></div>}
          </div>}
          {ask.error && <div className="m-1.5"><ErrorBox error={ask.error} /></div>}
          {filtered.map((i, n) => <button key={i.label} onMouseEnter={() => setSel(n)} onClick={() => { i.run(); onClose(); }} className={cx("w-full text-left px-3 py-2 rounded-lg text-sm", n === sel ? "bg-surface2 text-fg" : "text-muted")}>{i.label}</button>)}
          {q.trim() && <button onClick={() => ask.run()} className="w-full text-left px-3 py-2 rounded-lg text-sm text-accent hover:bg-surface2">Ask Jarvis: “{q}” <span className="text-[12px] text-muted">(local command matcher, no model)</span></button>}
        </div>
      </div>
    </div>
  );
}
export { Bell, Inbox, ApiError, localHM, Empty };
