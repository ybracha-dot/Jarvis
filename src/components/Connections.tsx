"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { api, useQuery, useAction } from "./api";
import { Button, Badge, Drawer, Notice, ErrorBox, Spinner, SectionTitle, Mono, cx } from "./ui";
import { fmtDateTime } from "@/lib/time";

const STATE: Record<string, { label: string; tone: "accent" | "amber" | "neutral" | "danger" }> = {
  ok: { label: "Working", tone: "accent" }, needs_connection: { label: "Needs connection", tone: "amber" }, failed: { label: "Failed", tone: "danger" }, import_only: { label: "Import only", tone: "neutral" }, off: { label: "Off", tone: "neutral" },
};

export const CHECKLIST = [
  { id: "syllabus", text: "Import one real syllabus", detail: "Sources and import, choose a .md or .txt file, pick the course, preview, then import.", href: "/sources" },
  { id: "calendar", text: "Connect or import your calendar", detail: "Import an .ics file now. For a live read-only feed, set JARVIS_ICS_URL in .env.", href: "/sources" },
  { id: "bb", text: "Enable Blackboard email notifications, or use a browser path you authorize", detail: "Turn on email notifications in your Blackboard profile. Sign in and complete Duo yourself in BU's official flow. Never share the password with Jarvis.", href: "/sources" },
  { id: "claude", text: "Configure the Claude provider if you want it", detail: "Put ANTHROPIC_API_KEY in .env, then set a daily budget in Settings. Paid AI stays off until you do.", href: "/settings" },
  { id: "worker", text: "Set worker hours and quiet periods", detail: "Settings: check times (default 08:00 and 16:00), quiet hours, protected intervals you enter. Then run npm run worker.", href: "/settings" },
  { id: "mobile", text: "Enable mobile delivery", detail: "Optional. Needs a configured provider and a recipient you confirm. Claude's own mobile notifications are a separate path.", href: "/settings" },
  { id: "test", text: "Test with a single benign change", detail: "Drop one harmless announcement into the watched folder and press Run now. Check Today.", href: "/" },
];

export function ConnectionChecklist() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem("jarvis_checklist") ?? "{}")); } catch { /* storage unavailable */ } }, []);
  const toggle = (id: string) => setDone((d) => { const n = { ...d, [id]: !d[id] }; try { localStorage.setItem("jarvis_checklist", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  return <ol className="space-y-2" data-testid="connection-checklist">{CHECKLIST.map((c, i) => (
    <li key={c.id} className="rounded-lg border border-line p-3 flex gap-3">
      <button onClick={() => toggle(c.id)} aria-label={`${done[c.id] ? "Unmark" : "Mark"} step ${i + 1}`} aria-pressed={!!done[c.id]} className="mt-0.5 shrink-0">{done[c.id] ? <CheckCircle2 className="size-5 text-accent" /> : <Circle className="size-5 text-muted" />}</button>
      <div className="min-w-0"><div className={cx("text-sm font-medium", done[c.id] && "text-muted line-through")}>{i + 1}. {c.text}</div><p className="text-[13px] text-muted mt-0.5">{c.detail} <Link href={c.href} className="text-accent">Open</Link></p></div>
    </li>))}</ol>;
}

export function ConnectionsDrawer({ onClose }: { onClose: () => void }) {
  const q = useQuery<any>("/connections");
  const router = useQuery<any>("/router");
  const sched = useQuery<any>("/scheduler");
  const [open, setOpen] = useState<string | null>(null);
  const [checked, setChecked] = useState<any>(null);
  const check = useAction(async () => { setChecked(await api("/connections/check", { body: {} })); });
  const list = (checked ?? q.data)?.connections;
  return (
    <Drawer title="Connections" subtitle="What is connected, and how recently it was verified" onClose={onClose} wide
      footer={<div className="flex items-center gap-3"><Button variant="primary" busy={check.busy} onClick={() => check.run()}><RefreshCw className="size-4" />Run health check</Button><span className="text-[12px] text-muted">Local checks only. A check never proves a live account.</span></div>}>
      {q.loading && !q.data && <Spinner />}{q.error && !q.data && <ErrorBox error={q.error} onRetry={q.reload} />}{check.error && <ErrorBox error={check.error} />}
      {checked && <Notice tone="accent">Checked {fmtDateTime(checked.checkedAt)}. {checked.note}</Notice>}
      <ul className="space-y-2" data-testid="connections-list">{list?.map((c: any) => (
        <li key={c.id} className="rounded-xl border border-line p-3">
          <button onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id} className="w-full flex items-center gap-2 text-left">
            {open === c.id ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}<span className="text-sm font-medium flex-1">{c.label}</span>
            <Badge tone={STATE[c.state]?.tone}>{STATE[c.state]?.label}</Badge>{c.liveVerified ? <Badge tone="accent">live verified</Badge> : <Badge>not live verified</Badge>}
          </button>
          <p className="text-[13px] text-muted mt-1.5 break-words pl-6">{c.message}</p>
          {open === c.id && <div className="pl-6 mt-2 space-y-2 text-[13px]"><p><span className="text-muted">Does:</span> {c.capability}</p><p><span className="text-muted">Runs on:</span> {c.surface}</p>{c.steps.length > 0 && <ol className="list-decimal pl-5 space-y-0.5">{c.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>}</div>}
        </li>))}</ul>
      {sched.data && <section><SectionTitle>Scheduler</SectionTitle><p className="text-sm">{sched.data.message}</p></section>}
      {router.data && <section><SectionTitle>Claude routing</SectionTitle>
        <p className="text-[13px] text-muted mb-2">Provider: {router.data.provider}. Budget today: ${router.data.spentTodayUsd.toFixed(4)} of ${router.data.dailyBudgetUsd.toFixed(2)} (estimates). Deterministic work never calls a model.</p>
        <ul className="space-y-1">{router.data.roles.map((r: any) => <li key={r.role} className="flex items-center gap-2 text-[13px]"><Mono className="w-32 text-muted">{r.role}</Mono><Mono className="flex-1 truncate">{r.model} · {r.effort}</Mono><Badge tone={r.status === "ready" ? "accent" : "neutral"}>{r.status.replace("_", " ")}</Badge></li>)}</ul></section>}
      <section><SectionTitle>Set up for real use</SectionTitle><ConnectionChecklist /></section>
    </Drawer>
  );
}
