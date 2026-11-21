"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error { constructor(msg: string, public status: number, public body: any) { super(msg); } }

const listeners = new Set<() => void>();
export const invalidate = () => listeners.forEach((l) => l());

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  let res: Response;
  try {
    res = await fetch("/api" + path, { method, headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, cache: "no-store" });
  } catch {
    throw new ApiError("Cannot reach Jarvis. Is the server running? Check your connection and retry.", 0, null);
  }
  const j = await res.json().catch(() => ({ error: `Unexpected response (${res.status})` }));
  if (!res.ok) throw new ApiError(j.error ?? res.statusText, res.status, j);
  if (method !== "GET") invalidate();
  return j as T;
}

export function useQuery<T = any>(path: string | null, opts: { poll?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    try { const d = await api<T>(path); if (n === seq.current) { setData(d); setError(null); } }
    catch (e) { if (n === seq.current) setError(e as ApiError); }
    finally { if (n === seq.current) setLoading(false); }
  }, [path]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { listeners.add(load); return () => { listeners.delete(load); }; }, [load]);
  useEffect(() => { if (!opts.poll) return; const t = setInterval(load, opts.poll); return () => clearInterval(t); }, [load, opts.poll]);
  return { data, error, loading, reload: load, stale: !!error && !!data };
}

/** Runs a mutation with busy and error state. The same function cannot run twice at once. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const run = useCallback(async (...a: A): Promise<R | undefined> => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { return await fn(...a); }
    catch (e: any) { setError(e.message ?? "Failed"); }
    finally { lock.current = false; setBusy(false); }
  }, [fn]);
  return { run, busy, error, clear: () => setError(null) };
}
