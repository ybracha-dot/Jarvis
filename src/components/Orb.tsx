"use client";
// The assistant's light: a restrained form with three distinct states that mirror the real microphone and speech playback.
// idle: slow ambient glow. listening: bright, tight, breathing ring. speaking: wide ripples that follow playback. Reduced motion keeps the shape and drops the movement.
import { useVoiceState } from "./voice-state";
import { cx } from "./ui";

export function Orb({ size = 36, className }: { size?: number; className?: string }) {
  const s = useVoiceState();
  return (
    <span role="img" aria-label={s === "listening" ? "Jarvis is listening" : s === "speaking" ? "Jarvis is speaking" : "Jarvis is idle"} data-testid="orb" data-state={s}
      className={cx("orb relative inline-grid place-items-center rounded-full shrink-0", className)} style={{ width: size, height: size }}>
      <span className="orb-halo absolute inset-0 rounded-full" aria-hidden />
      <span className="orb-ring absolute inset-[14%] rounded-full" aria-hidden />
      <span className="orb-core relative rounded-full" style={{ width: size * 0.32, height: size * 0.32 }} aria-hidden />
    </span>
  );
}
