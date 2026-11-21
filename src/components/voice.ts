"use client";
// Browser speech helpers. Playback only starts from a user action. Raw audio is never recorded or kept by Jarvis.
export const hasSynth = () => typeof window !== "undefined" && "speechSynthesis" in window;
export const hasRecognition = () => typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

const BRITISH = /(daniel|serena|kate|oliver|arthur|martha|google uk english (female|male)|british)/i;
/** Prefer a calm British English voice if the device has one. Otherwise any English voice. */
export function pickVoice(voices: SpeechSynthesisVoice[], preferred?: string | null): SpeechSynthesisVoice | null {
  if (preferred) { const p = voices.find((v) => v.name === preferred); if (p) return p; }
  const gb = voices.filter((v) => /^en[-_]GB/i.test(v.lang));
  return gb.find((v) => BRITISH.test(v.name)) ?? gb[0] ?? voices.find((v) => /^en/i.test(v.lang)) ?? voices[0] ?? null;
}
export const englishVoices = (voices: SpeechSynthesisVoice[]) => voices.filter((v) => /^en/i.test(v.lang));

export function speak(text: string, o: { voice?: SpeechSynthesisVoice | null; rate?: number; onEnd?: () => void; onStart?: () => void }) {
  if (!hasSynth()) { o.onEnd?.(); return false; }
  const synth = window.speechSynthesis; synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (o.voice) { u.voice = o.voice; u.lang = o.voice.lang; }
  u.rate = o.rate ?? 0.92; u.pitch = 1; u.volume = 1;      // a measured pace
  u.onstart = () => o.onStart?.(); u.onend = () => o.onEnd?.(); u.onerror = () => o.onEnd?.();
  synth.speak(u); return true;
}
export const stopSpeaking = () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } };

/** Downscale big phone photos before upload. Small PNG and JPEG files are sent untouched. */
export async function prepareImage(file: File): Promise<{ name: string; dataBase64: string }> {
  const direct = (file.type === "image/png" || file.type === "image/jpeg") && file.size <= 1_500_000;
  const toB64 = (buf: ArrayBuffer) => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  if (direct) return { name: file.name, dataBase64: toB64(await file.arrayBuffer()) };
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error(`${file.name}: this browser cannot read that image type. Share it as a JPEG or PNG.`); }
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not shrink the photo"))), "image/jpeg", 0.85));
  return { name: file.name.replace(/\.\w+$/, "") + ".jpg", dataBase64: toB64(await blob.arrayBuffer()) };
}
