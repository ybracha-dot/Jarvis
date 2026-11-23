"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cx } from "./ui";

type Choice = "system" | "light" | "dark";
const read = (): Choice => { try { const t = localStorage.getItem("jarvis_theme"); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; } };
export function applyTheme(c: Choice) {
  try { if (c === "system") localStorage.removeItem("jarvis_theme"); else localStorage.setItem("jarvis_theme", c); } catch { /* storage unavailable: the choice lasts for this tab only */ }
  if (c === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", c);
}
/** System follows the OS; Light and Dark are the user's explicit choice and are kept. */
export function Appearance() {
  const [c, setC] = useState<Choice>("system"); useEffect(() => setC(read()), []);
  const opts: { id: Choice; label: string; icon: any }[] = [{ id: "system", label: "System", icon: Monitor }, { id: "light", label: "Light", icon: Sun }, { id: "dark", label: "Dark", icon: Moon }];
  return <div role="radiogroup" aria-label="Appearance" className="inline-flex rounded-xl border border-line bg-surface2 p-1 gap-1" data-testid="appearance">
    {opts.map((o) => <button key={o.id} role="radio" aria-checked={c === o.id} onClick={() => { setC(o.id); applyTheme(o.id); }} data-testid={`appearance-${o.id}`} className={cx("touch inline-flex items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium", c === o.id ? "bg-surface text-fg lift" : "text-muted hover:text-fg")}><o.icon className="size-4" aria-hidden />{o.label}</button>)}
  </div>;
}
