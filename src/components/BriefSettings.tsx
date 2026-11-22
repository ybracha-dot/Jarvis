"use client";
import { useEffect, useState } from "react";
import { api, useQuery, useAction } from "@/components/api";
import { Button, Card, Notice, ErrorBox, Field, inputCls, SectionTitle } from "@/components/ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Slot = { label: string; days: number[]; start: string; end: string };
const blank = (label = ""): Slot => ({ label, days: [1, 2, 3, 4, 5], start: "10:00", end: "11:15" });

/** Times the user supplies. Jarvis computes no prayer or Shabbat time and uses only these boundaries. */
export function BriefSettings() {
  const q = useQuery<any>("/brief/config"); const [f, setF] = useState<any>(null); const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data && !f) setF(q.data); }, [q.data, f]);
  const save = useAction(async () => { await api("/brief/config", { body: { enabled: f.enabled, time: f.time, tz: f.tz, dayStart: f.dayStart, dayEnd: f.dayEnd, classes: f.classes, prayers: f.prayers, shabbat: f.shabbat, calendarDeclared: f.calendarDeclared } }); setSaved(true); });
  if (!f) return null;
  const upd = (k: string, v: any) => { setF({ ...f, [k]: v }); setSaved(false); };
  const slots = (key: "classes" | "prayers", title: string, hint: string) => (
    <div className="space-y-2" data-testid={`brief-${key}`}><div className="text-[14px] font-medium">{title}</div><p className="text-[13px] text-muted">{hint}</p>
      {(f[key] as Slot[]).map((c, i) => <div key={i} className="rounded-lg border border-line p-2.5 space-y-2">
        <div className="grid grid-cols-[1fr_auto] gap-2"><input aria-label="Label" placeholder="Name" className={inputCls} value={c.label} onChange={(e) => upd(key, f[key].map((x: Slot, j: number) => (j === i ? { ...x, label: e.target.value } : x)))} /><Button size="sm" onClick={() => upd(key, f[key].filter((_: any, j: number) => j !== i))}>Remove</Button></div>
        <div className="flex gap-1 flex-wrap">{DAYS.map((d, n) => <label key={d} className="text-[12px] flex items-center gap-1 border border-line rounded px-1.5 py-0.5"><input type="checkbox" checked={c.days.includes(n)} onChange={(e) => upd(key, f[key].map((x: Slot, j: number) => (j === i ? { ...x, days: e.target.checked ? [...x.days, n].sort() : x.days.filter((y) => y !== n) } : x)))} />{d}</label>)}</div>
        <div className="grid grid-cols-2 gap-2"><Field label="From"><input type="time" className={inputCls} value={c.start} onChange={(e) => upd(key, f[key].map((x: Slot, j: number) => (j === i ? { ...x, start: e.target.value } : x)))} /></Field><Field label="Until"><input type="time" className={inputCls} value={c.end} onChange={(e) => upd(key, f[key].map((x: Slot, j: number) => (j === i ? { ...x, end: e.target.value } : x)))} /></Field></div></div>)}
      <Button size="sm" onClick={() => upd(key, [...f[key], blank(key === "prayers" ? "Prayer" : "")])} data-testid={`brief-add-${key}`}>Add {key === "classes" ? "a class" : "an interval"}</Button></div>);
  const sh = f.shabbat;
  return <section id="brief" data-testid="brief-settings"><SectionTitle>Morning brief</SectionTitle>
    <Card className="p-4 space-y-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#67d4ff]" checked={f.enabled} onChange={(e) => upd("enabled", e.target.checked)} data-testid="brief-enable" />Build my brief automatically each morning (private schedules). Off until you turn it on. A worker must be running: <span className="mono">npm run worker</span></label>
      <div className="grid sm:grid-cols-3 gap-3"><Field label="Brief time (local)"><input type="time" className={inputCls} value={f.time} onChange={(e) => upd("time", e.target.value)} data-testid="brief-time" /></Field><Field label="Time zone"><input className={inputCls} value={f.tz} onChange={(e) => upd("tz", e.target.value)} /></Field>
        <Field label="Work day"><div className="flex gap-2"><input type="time" className={inputCls} value={f.dayStart} onChange={(e) => upd("dayStart", e.target.value)} /><input type="time" className={inputCls} value={f.dayEnd} onChange={(e) => upd("dayEnd", e.target.value)} /></div></Field></div>
      {slots("classes", "Classes", "Jarvis treats these as busy every week and never proposes work then.")}
      {slots("prayers", "Prayer or other quiet intervals (optional)", "Scheduled work and alerts wait until these end. Times are yours; Jarvis does not look any up.")}
      <div className="space-y-2" data-testid="brief-shabbat"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!sh} onChange={(e) => upd("shabbat", e.target.checked ? { label: "Shabbat", startDay: 5, start: "17:00", endDay: 6, end: "20:00" } : null)} data-testid="brief-shabbat-on" />Shabbat quiet interval (optional)</label>
        {sh && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Field label="Starts on"><select className={inputCls} value={sh.startDay} onChange={(e) => upd("shabbat", { ...sh, startDay: Number(e.target.value) })}>{DAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}</select></Field><Field label="At"><input type="time" className={inputCls} value={sh.start} onChange={(e) => upd("shabbat", { ...sh, start: e.target.value })} /></Field>
          <Field label="Ends on"><select className={inputCls} value={sh.endDay} onChange={(e) => upd("shabbat", { ...sh, endDay: Number(e.target.value) })}>{DAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}</select></Field><Field label="At"><input type="time" className={inputCls} value={sh.end} onChange={(e) => upd("shabbat", { ...sh, end: e.target.value })} /></Field></div>}
        <p className="text-[13px] text-muted">Enter the exact times you keep. Jarvis uses only these.</p></div>
      <div className="flex gap-2 flex-wrap items-center"><Button variant="primary" busy={save.busy} onClick={() => save.run()} data-testid="brief-config-save">Save</Button>{saved && <span className="text-[14px] text-accent" data-testid="brief-config-saved">Saved.</span>}</div>
      {save.error && <ErrorBox error={save.error} />}
      <Notice tone="accent">Reads, drafts and proposed work blocks can happen on their own. Sending a message, submitting coursework or changing another calendar always waits for you.</Notice>
    </Card></section>;
}
