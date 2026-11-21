"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, Square, Send, Camera, VolumeX, Volume2, X, FileDown, ListChecks, BookOpen, ExternalLink, Play } from "lucide-react";
import { api, useQuery, useAction } from "./api";
import { Button, Badge, Card, Notice, ErrorBox, Mono, Field, inputCls, cx } from "./ui";
import { AskPanel } from "./AskPanel";
import { hasRecognition, hasSynth, pickVoice, englishVoices, speak, stopSpeaking, prepareImage } from "./voice";

interface Photo { id: string; name: string; note: string; tone: "accent" | "amber" | "danger" }
const LS = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };

/** Push-to-talk, photos, a spoken acknowledgment and the conversation. Typing works the same as speaking. */
export function VoiceDock({ course, title = "Ask Jarvis" }: { course?: string | null; title?: string }) {
  const courses = useQuery<any>("/courses");
  const [selCourse, setSelCourse] = useState<string>(course ?? LS.get("jarvis_course") ?? "");
  const activeCourse = course ?? (selCourse || null);
  const conv = useQuery<any>(`/assistant/conversation${activeCourse ? `?course=${activeCourse}` : ""}`, { poll: 2000 });
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [mic, setMic] = useState<"off" | "listening">("off");
  const [micError, setMicError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [supportsMic, setSupportsMic] = useState(false);
  const [supportsSynth, setSupportsSynth] = useState(false);
  const rec = useRef<any>(null);
  const spoken = useRef<Set<string>>(new Set());
  const ready = useRef(false);
  const usedMic = useRef(false);

  useEffect(() => {
    setSupportsMic(hasRecognition()); setSupportsSynth(hasSynth());
    setAgreed(LS.get("jarvis_mic_ok") === "1"); setVoiceName(LS.get("jarvis_voice"));
    try { JSON.parse(sessionStorage.getItem("jarvis_spoken") ?? "[]").forEach((i: string) => spoken.current.add(i)); } catch { /* ignore */ }
    if (hasSynth()) { const load = () => setVoices(window.speechSynthesis.getVoices()); load(); window.speechSynthesis.addEventListener?.("voiceschanged", load); return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load); }
  }, []);
  useEffect(() => () => { try { rec.current?.abort(); } catch { /* ignore */ } stopSpeaking(); }, []);   // closing the screen stops the microphone and playback
  useEffect(() => { if (!selCourse && courses.data?.courses?.length && !course) setSelCourse(courses.data.courses.find((c: any) => c.code === "BI107")?.code ?? courses.data.courses[0].code); }, [courses.data, selCourse, course]);

  const voice = pickVoice(voices, voiceName);
  const sayIt = useCallback((t: string) => { if (muted) return; speak(t, { voice, onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) }); }, [muted, voice]);

  // Speak a finished-work message once, including one that finished while you were on another screen of this tab.
  const msgs: any[] = conv.data?.messages ?? [];
  useEffect(() => {
    if (!conv.data) return;
    const save = () => { try { sessionStorage.setItem("jarvis_spoken", JSON.stringify([...spoken.current])); } catch { /* ignore */ } };
    let first = false; try { first = sessionStorage.getItem("jarvis_dock_seen") !== "1"; sessionStorage.setItem("jarvis_dock_seen", "1"); } catch { /* ignore */ }
    if (!ready.current && first) { ready.current = true; msgs.forEach((m) => spoken.current.add(m.id)); save(); return; }   // a fresh tab does not replay old results
    ready.current = true;
    for (const m of msgs) if (m.role === "jarvis" && (m.kind === "result" || (m.kind === "question" && !m.data?.answered)) && !spoken.current.has(m.id)) { spoken.current.add(m.id); save(); sayIt(m.data?.spoken ?? m.text); }
  }, [conv.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const startMic = () => {
    stopSpeaking(); setSpeaking(false);                       // talking over Jarvis interrupts it
    const R = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!R) { setMicError("This browser has no speech recognition. Type instead."); return; }
    const r = new R(); r.lang = "en-US"; r.interimResults = true; r.continuous = true; rec.current = r; setMicError(null);
    let finalText = text ? text + " " : "";
    r.onresult = (e: any) => { let interim = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t + " "; else interim += t; } setText((finalText + interim).trim()); };
    r.onerror = (e: any) => { setMicError(e.error === "not-allowed" ? "Microphone permission was denied. Allow it in the browser address bar, or type instead." : e.error === "no-speech" ? "I did not hear anything. Tap the mic and try again." : `Speech input stopped: ${e.error}`); setMic("off"); };
    r.onend = () => setMic("off");
    try { r.start(); usedMic.current = true; setMic("listening"); } catch (e: any) { setMicError(e.message); setMic("off"); }
  };
  const stopMic = () => { try { rec.current?.stop(); } catch { /* ignore */ } setMic("off"); };
  const toggleMic = () => { if (mic === "listening") stopMic(); else if (!agreed) return; else startMic(); };

  const attach = useAction(async (files: FileList | null) => {
    if (!files?.length) return;
    const code = activeCourse; if (!code) throw new Error("Choose a course for these photos first.");
    for (const f of Array.from(files).slice(0, 6)) {
      const img = await prepareImage(f);
      const r = await api("/attachments", { body: { course: code, name: img.name, dataBase64: img.dataBase64 } });
      const q = r.quality; const unclear = q.overall !== "ok";
      setPhotos((p) => p.some((x) => x.id === r.id) ? p : [...p, { id: r.id, name: r.name, note: r.duplicate ? "already attached" : q.overall === "ok" ? "sharp" : q.overall === "partial" ? `partly unclear: ${q.issues.map((i: any) => i.region).join(", ")}` : "too blurry, retake", tone: q.overall === "ok" ? "accent" : q.overall === "partial" ? "amber" : "danger" }]);
      void unclear;
    }
  });
  const send = useAction(async () => {
    const t = text.trim(); if (!t) return;
    stopMic();
    const r = await api("/assistant/message", { body: { text: t, conversationId: conv.data?.conversation?.id, course: activeCourse ?? undefined, attachmentIds: photos.map((p) => p.id), via: usedMic.current ? "voice" : "text" } });
    usedMic.current = false;
    spoken.current.add(r.reply.id); sayIt(r.reply.spoken);
    setText(""); setPhotos([]); conv.reload();
  });
  const preview = () => sayIt("Good morning. This is how I will sound when I read you an update.");
  const stopAll = () => { stopSpeaking(); setSpeaking(false); };
  const evs = englishVoices(voices);
  const british = voice && /^en[-_]GB/i.test(voice.lang);

  return (
    <Card className="p-4 md:p-5 space-y-4" data-testid="voice-dock" aria-label={title}>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium flex-1">{title}{activeCourse ? ` · ${activeCourse}` : ""}</h2>
        <span data-testid="mic-state" role="status" aria-live="polite" className={cx("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px]", mic === "listening" ? "border-[#6b2b25] text-danger bg-[#241211]" : "border-line text-muted")}>
          <span className={cx("size-2 rounded-full", mic === "listening" ? "bg-danger animate-pulse" : "bg-muted")} aria-hidden />{mic === "listening" ? "Microphone on, listening" : "Microphone off"}
        </span>
      </div>

      {supportsMic && !agreed && <div className="space-y-2"><Notice tone="neutral">Voice input uses your browser's speech service. In Chrome and Edge that sends audio to Google or Microsoft to turn it into text, and Safari may use Apple's. Jarvis does not record audio and keeps only the text you see. Nothing listens until you tap the mic.</Notice><Button size="sm" onClick={() => { setAgreed(true); LS.set("jarvis_mic_ok", "1"); }} data-testid="mic-consent">I understand. Enable the mic button</Button></div>}
      {!supportsMic && <p className="text-[12px] text-muted">Voice input is not available in this browser, so type below. Everything else works the same.</p>}

      <ol className="space-y-2 max-h-[320px] overflow-y-auto scroll-thin pr-1" data-testid="conversation" aria-label="Conversation" aria-live="polite">
        {msgs.length === 0 && <li className="text-sm text-muted">Try: “Make me a study guide like the last one you did for bio.” Attach photos of your last test first.</li>}
        {msgs.map((m) => <Message key={m.id} m={m} />)}
      </ol>

      {photos.length > 0 && <ul className="flex flex-wrap gap-2" data-testid="attached">{photos.map((p) => <li key={p.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg pl-1 pr-2 py-1 text-[12px]"><img src={`/api/attachments/${p.id}/raw`} alt="" className="size-8 rounded object-cover" /><span className="max-w-32 truncate">{p.name}</span><Badge tone={p.tone}>{p.note}</Badge><button aria-label={`Remove ${p.name}`} onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))} className="text-muted"><X className="size-3.5" /></button></li>)}</ul>}

      <Field label="What you want. Edit the transcript before sending."><textarea data-testid="transcript" className={cx(inputCls, "min-h-16")} value={text} onChange={(e) => setText(e.target.value)} placeholder="Speak with the mic, or type here"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.run(); } }} /></Field>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={toggleMic} disabled={!supportsMic || !agreed} aria-pressed={mic === "listening"} data-testid="mic-button"
          className={cx("inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium border disabled:opacity-40", mic === "listening" ? "bg-[#3a1512] border-danger text-danger" : "bg-surface2 border-line hover:bg-[#222831]")}>
          {mic === "listening" ? <Square className="size-4" /> : <Mic className="size-4" />}{mic === "listening" ? "Tap to stop" : "Tap to talk"}
        </button>
        <label className={cx("inline-flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm cursor-pointer hover:bg-[#222831]", attach.busy && "opacity-60")}>
          <Camera className="size-4" aria-hidden />Attach photos
          <input type="file" accept="image/*" multiple capture="environment" className="sr-only" aria-label="Attach photos" data-testid="photo-input" onChange={(e) => { attach.run(e.target.files); e.target.value = ""; }} />
        </label>
        {!course && courses.data?.courses?.length > 1 && <select aria-label="Course for these photos" className={cx(inputCls, "w-auto")} value={selCourse} onChange={(e) => { setSelCourse(e.target.value); LS.set("jarvis_course", e.target.value); }}>{courses.data.courses.map((c: any) => <option key={c.code} value={c.code}>{c.code}</option>)}</select>}
        <Button variant="primary" busy={send.busy} disabled={!text.trim()} onClick={() => send.run()} data-testid="send"><Send className="size-4" />Send</Button>
        {speaking && <Button onClick={stopAll} data-testid="stop-speaking"><Square className="size-4" />Stop talking</Button>}
      </div>
      {(micError || send.error || attach.error) && <ErrorBox error={(micError || send.error || attach.error)!} />}

      <details className="text-[13px]"><summary className="cursor-pointer text-muted">Voice and playback</summary>
        <div className="mt-2 space-y-2">
          {!supportsSynth ? <p className="text-muted">This browser cannot speak. Replies stay on screen.</p> : <>
            <div className="flex items-end gap-2 flex-wrap"><Field label="Voice"><select className={cx(inputCls, "w-64")} value={voice?.name ?? ""} onChange={(e) => { setVoiceName(e.target.value); LS.set("jarvis_voice", e.target.value); }} data-testid="voice-select">{evs.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}</select></Field>
              <Button size="sm" onClick={preview} data-testid="voice-preview"><Play className="size-3.5" />Preview</Button>
              <Button size="sm" variant={muted ? "amber" : "ghost"} aria-pressed={muted} onClick={() => { setMuted(!muted); stopAll(); }} data-testid="mute">{muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}{muted ? "Unmute" : "Mute"}</Button></div>
            <p className="text-muted" data-testid="voice-note">{voice ? (british ? `Using ${voice.name}, a British English voice, at a measured pace.` : `No British English voice on this device. Using ${voice.name}.`) : "No English voice found. Replies stay on screen."} The voice is your device's own. Jarvis does not imitate anyone.</p></>}
        </div></details>
    </Card>
  );
}

function Message({ m }: { m: any }) {
  const user = m.role === "user"; const links = m.data?.links;
  return (
    <li className={cx("rounded-xl px-3 py-2 text-sm max-w-[92%] break-words", user ? "ml-auto bg-surface2 border border-line" : "bg-[#0f2420] border border-accent-dim")} data-testid={user ? "msg-user" : `msg-${m.kind}`}>
      <div className="whitespace-pre-wrap">{m.text}</div>
      {user && m.data?.attachmentIds?.length > 0 && <div className="flex gap-1.5 mt-1.5 flex-wrap">{m.data.attachmentIds.map((id: string) => <img key={id} src={`/api/attachments/${id}/raw`} alt="attached photo" className="size-10 rounded object-cover border border-line" />)}</div>}
      {links && <div className="flex gap-2 mt-2 flex-wrap" data-testid="result-actions">
        <Link href={links.open} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] bg-accent text-[#06201b] font-medium" data-testid="open-guide"><BookOpen className="size-3.5" />Open guide</Link>
        <Link href={links.quiz} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] bg-surface2 border border-line" data-testid="quiz-me"><ListChecks className="size-3.5" />Quiz me</Link>
        <a href={links.pdf} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] bg-surface2 border border-line" data-testid="export-pdf"><FileDown className="size-3.5" />Export PDF</a></div>}
      {m.kind === "question" && !m.data?.answered && <AskPanel jobId={m.data.jobId} ask={m.data.ask} />}
      {m.kind === "ack" && <Link href="/office" className="inline-flex items-center gap-1 mt-1.5 text-[12px] text-accent underline underline-offset-2"><ExternalLink className="size-3" />Watch it work in the Office</Link>}
      {(m.kind === "quiz" || m.kind === "capture") && m.data?.path && <Link href={m.data.path} className="inline-flex items-center gap-1 mt-1.5 text-[12px] text-accent underline underline-offset-2"><ExternalLink className="size-3" />{m.kind === "quiz" ? "Open the quiz" : "Open it"}</Link>}
      <div className="mt-1 text-[11px] text-muted mono">{user ? (m.data?.via === "voice" ? "you · voice" : "you") : "Jarvis"}</div>
    </li>
  );
}
export { Mono };
