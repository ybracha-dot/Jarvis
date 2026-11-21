"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button, Notice } from "./ui";

/** Hold-to-talk using the browser's speech service. Disclosure first. Capture stops when the component unmounts. */
export function useSpeechInput(onText: (t: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<any>(null);
  useEffect(() => { setSupported(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)); return () => { try { rec.current?.abort(); } catch { /* ignore */ } }; }, []);
  const start = useCallback(() => {
    const R = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!R) { setError("This browser has no speech recognition. Type instead."); return; }
    const r = new R(); r.lang = "en-US"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e: any) => onText(Array.from(e.results).map((x: any) => x[0].transcript).join(" "));
    r.onerror = (e: any) => { setError(e.error === "not-allowed" ? "Microphone permission was denied." : `Speech input stopped: ${e.error}`); setListening(false); };
    r.onend = () => setListening(false);
    rec.current = r; setError(null);
    try { r.start(); setListening(true); } catch (e: any) { setError(e.message); }
  }, [onText]);
  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* ignore */ } setListening(false); }, []);
  return { supported, listening, error, start, stop };
}

export function HoldToTalk({ onText }: { onText: (t: string) => void }) {
  const s = useSpeechInput(onText);
  const [agreed, setAgreed] = useState(false);
  if (!s.supported) return <p className="text-[13px] text-muted">Voice input is not available in this browser. Type instead. Playback may still work.</p>;
  if (!agreed) return <div className="space-y-2"><Notice tone="neutral">Voice input uses your browser's speech service. In Chrome that sends audio to Google to turn it into text. Jarvis does not record or keep audio. Nothing starts until you hold the button.</Notice><Button size="sm" onClick={() => setAgreed(true)}>I understand, enable hold-to-talk</Button></div>;
  return <div className="space-y-1"><button onPointerDown={s.start} onPointerUp={s.stop} onPointerLeave={() => s.listening && s.stop()} onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !s.listening) { e.preventDefault(); s.start(); } }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") s.stop(); }}
    aria-pressed={s.listening} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm select-none ${s.listening ? "border-accent bg-[#12324a] text-accent" : "border-line bg-surface2"}`}>{s.listening ? <Square className="size-4" /> : <Mic className="size-4" />}{s.listening ? "Listening. Release to stop" : "Hold to talk"}</button>
    {s.error && <p role="alert" className="text-[13px] text-danger">{s.error}</p>}</div>;
}
