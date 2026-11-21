"use client";
// The assistant light follows this, and only this: the real microphone session and real speech playback reported by VoiceDock.
import { useSyncExternalStore } from "react";
export type VoiceState = "idle" | "listening" | "speaking";
let state: VoiceState = "idle"; let mic = false, speak = false; const subs = new Set<() => void>();
const recompute = () => { const n: VoiceState = mic ? "listening" : speak ? "speaking" : "idle"; if (n !== state) { state = n; subs.forEach((f) => f()); } };
export const reportMic = (on: boolean) => { mic = on; recompute(); };
export const reportSpeaking = (on: boolean) => { speak = on; recompute(); };
export const useVoiceState = (): VoiceState => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => "idle" as VoiceState);
