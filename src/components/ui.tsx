"use client";
import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Loader2, X, AlertTriangle, WifiOff, Inbox } from "lucide-react";

export const cx = clsx;

export function Button({ variant = "secondary", size = "md", busy, className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "amber"; size?: "sm" | "md"; busy?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || busy}
      className={clsx("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none",
        size === "sm" ? "px-2.5 py-1.5 text-[14px]" : "px-3.5 py-2 text-sm min-h-9",
        variant === "primary" && "bg-accent text-[#04141e] hover:bg-[#8fdcff]",
        variant === "secondary" && "bg-surface2 text-fg border border-line hover:bg-[#222831]",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-surface2",
        variant === "amber" && "bg-amber text-[#2a1c04] hover:bg-[#f7c36c]",
        variant === "danger" && "bg-transparent text-danger border border-[#4a2723] hover:bg-[#2a1614]", className)}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}{children}
    </button>
  );
}

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={clsx("rounded-xl border border-line bg-surface", className)}>{children}</div>;
}
export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return <div className="flex items-center justify-between mb-2"><h2 className="text-[12px] uppercase tracking-[0.12em] text-muted font-medium">{children}</h2>{right}</div>;
}
export function Badge({ tone = "neutral", children, className, ...rest }: { tone?: "neutral" | "accent" | "amber" | "danger"; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...rest} className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium border", className,
    tone === "neutral" && "border-line text-muted", tone === "accent" && "border-accent-dim text-accent bg-[#0b1c29]", tone === "amber" && "border-amber-dim text-amber bg-[#1f180a]", tone === "danger" && "border-[#4a2723] text-danger bg-[#241211]")}>{children}</span>;
}
export const Mono = ({ children, className, ...rest }: { children?: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) => <span {...rest} className={clsx("mono", className)}>{children}</span>;

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div role="status" className="flex items-center gap-2 text-muted text-sm py-6"><Loader2 className="size-4 animate-spin" aria-hidden />{label}</div>;
}
export function Empty({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return <div className="text-center py-8 px-4"><Inbox className="size-5 mx-auto text-muted mb-2" aria-hidden /><p className="text-sm text-fg">{title}</p>{hint && <p className="text-[14px] text-muted mt-1">{hint}</p>}{children && <div className="mt-3">{children}</div>}</div>;
}
export function ErrorBox({ error, onRetry, offline }: { error: { message: string; status?: number } | string; onRetry?: () => void; offline?: boolean }) {
  const msg = typeof error === "string" ? error : error.message;
  return (
    <div role="alert" className="rounded-lg border border-[#4a2723] bg-[#1c1110] text-sm p-3 flex items-start gap-2">
      {offline ? <WifiOff className="size-4 mt-0.5 text-danger shrink-0" aria-hidden /> : <AlertTriangle className="size-4 mt-0.5 text-danger shrink-0" aria-hidden />}
      <div className="flex-1 min-w-0 break-words">{msg}</div>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
export function Notice({ tone = "amber", children }: { tone?: "amber" | "accent" | "neutral"; children: React.ReactNode }) {
  return <div className={clsx("rounded-lg border px-3 py-2 text-[14px] leading-snug", tone === "amber" && "border-amber-dim bg-[#1a1508] text-[#f6d7a1]", tone === "accent" && "border-accent-dim bg-[#0b1c29] text-[#cdeeff]", tone === "neutral" && "border-line bg-surface2 text-muted")}>{children}</div>;
}

export function Drawer({ title, subtitle, onClose, children, wide, footer }: { title: string; subtitle?: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return; const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="overlay absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={clsx("drawer relative h-dvh bg-surface border-l border-line flex flex-col w-full outline-none", wide ? "max-w-[640px]" : "max-w-[520px]")}>
        <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-line">
          <div className="min-w-0 flex-1"><h2 className="text-base font-semibold leading-snug break-words">{title}</h2>{subtitle && <div className="text-[14px] text-muted mt-0.5">{subtitle}</div>}</div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-muted hover:text-fg hover:bg-surface2"><X className="size-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-4 space-y-5">{children}</div>
        {footer && <footer className="border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block text-[14px]"><span className="block text-muted mb-1">{label}</span>{children}{hint && <span className="block text-[13px] text-muted mt-1">{hint}</span>}</label>;
}
export const inputCls = "w-full rounded-lg bg-bg border border-line px-3 py-2 text-sm text-fg placeholder:text-[#7d8691] focus:border-accent outline-none";

export function Quote({ children, source }: { children: React.ReactNode; source?: React.ReactNode }) {
  return <blockquote className="border-l-2 border-amber pl-3 text-sm leading-relaxed text-fg break-words">{children}{source && <footer className="mt-1 text-[13px] text-muted mono">{source}</footer>}</blockquote>;
}
