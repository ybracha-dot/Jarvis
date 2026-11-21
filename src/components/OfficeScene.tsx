"use client";
// Jarvis-owned pixel-art room. Original sprites and layout, drawn from scratch in SVG. Nothing here is copied from Pixel Agents.
// Layout follows the owner's art direction: warm plank floor, navy perimeter, paired workstations with plants and monitors, oversized
// characters, compact nameplates, and an open center aisle for delegation. Everything moves only because a saved job row changed.
// This room covers Jarvis background jobs. Claude Code terminals belong to Pixel Agents (see the Open Pixel Agents action).
import { useEffect, useRef, useState } from "react";

export interface OfficeJob {
  id: string; title: string; role: string; area: string; status: string; stage: string | null; depth: number; progress: { done: number; total: number } | null; finishedAgoMs: number | null; synthetic: boolean;
  parentId?: string | null; createdAgoMs?: number; needsYou?: { kind: "question" | "decision"; text: string; decisionId?: string } | null;
}
export interface PendingDecision { id: string; title: string }

const W = 960, H = 640, AISLE_X = 480;
const ZONES: Record<string, { x: number; y: number; w: number; h: number; label: string; near: "right" | "left"; rug: string }> = {
  intake: { x: 40, y: 40, w: 352, h: 262, label: "INTAKE", near: "right", rug: "#8a5f3a" },
  research: { x: 568, y: 40, w: 352, h: 262, label: "RESEARCH", near: "left", rug: "#6e4d6e" },
  planning: { x: 40, y: 330, w: 352, h: 262, label: "PLANNER", near: "right", rug: "#8a5f3a" },
  review: { x: 568, y: 330, w: 352, h: 262, label: "REVIEWER", near: "left", rug: "#4f6b66" },
};
const ZONE_OF = (area: string) => (area === "decisions" ? "review" : area);
export const DISPLAY: Record<string, string> = { supervisor: "Jarvis", intake: "Intake", research: "Research", planning: "Planner", review: "Reviewer", decisions: "Reviewer" };
export const displayName = (area: string) => DISPLAY[area] ?? "Helper";
const SHIRT: Record<string, string> = { supervisor: "#2f6fe0", intake: "#2fa27a", research: "#8a52d6", planning: "#e08a2f", review: "#d6527a", decisions: "#d6527a" };
const HAIR: Record<string, string> = { supervisor: "#1c1c24", intake: "#6b3d1f", research: "#e8d38a", planning: "#a8321f", review: "#2a2a2a", decisions: "#2a2a2a" };
const SUP = { x: AISLE_X, y: 156 };           // supervisor seat (feet)
const YOU = { x: AISLE_X, y: 500 };           // your desk
const DOOR = { x: AISLE_X, y: 612 };

const seat = (area: string, i: number) => {
  const z = ZONES[ZONE_OF(area)] ?? ZONES.intake;
  const nearCol = z.near === "right" ? z.x + 264 : z.x + 88, farCol = z.near === "right" ? z.x + 88 : z.x + 264;
  const col = i % 2 === 0 ? nearCol : farCol; const row = Math.floor(i / 2) % 2;
  const dy = z.y + 96 + row * 124;
  return { dx: col, dy, x: col, y: dy + 6 };
};
const waitSpot = (k: number) => ({ x: AISLE_X + (k % 2 ? 26 : -26), y: YOU.y - 50 - k * 92 });
const doorSpot = (k: number) => ({ x: DOOR.x - 52 + (k % 3) * 52, y: DOOR.y - 12 - Math.floor(k / 3) * 30 });

type Pt = { x: number; y: number };
type Pose = "type" | "read" | "stand" | "ask" | "carry" | "idle";
export interface Placed { waitIndex: number; j: OfficeJob; pos: Pt; pose: Pose; seated: boolean; visible: boolean; label: string; sub: string; zone: string; fresh: boolean }

const READING = /read|scan|search|look|check|find|list/i;
export function place(jobs: OfficeJob[]): Placed[] {
  const next: Record<string, number> = {}; let waitK = 0, doorK = 0;
  return jobs.map((j) => {
    const zone = ZONE_OF(j.area);
    const progress = j.progress ? ` · ${j.progress.done} of ${j.progress.total}` : "";
    const fresh = (j.createdAgoMs ?? 1e9) < 2600;
    if (j.area === "supervisor") {
      const active = !["done", "cancelled", "failed"].includes(j.status);
      return { waitIndex: -1, j, pos: { x: SUP.x, y: SUP.y }, pose: (active ? (j.status === "waiting" ? "idle" : "type") : "idle") as Pose, seated: true, visible: active, label: "Jarvis", sub: active ? (j.status === "waiting" ? "waiting on helpers" : (j.stage ?? "working").slice(0, 26)) : "idle", zone: "supervisor", fresh };
    }
    if (j.needsYou) { const wi = waitK++; const pos = waitSpot(wi); return { waitIndex: wi, j, pos, pose: (j.needsYou.kind === "question" ? "ask" : "carry") as Pose, seated: false, visible: true, label: displayName(j.area), sub: j.needsYou.kind === "question" ? "needs your answer" : "needs your decision", zone, fresh }; }
    if (j.status === "queued") return { waitIndex: -1, j, pos: doorSpot(doorK++), pose: "stand" as Pose, seated: false, visible: true, label: displayName(j.area), sub: "just arrived", zone, fresh };
    if (["done", "cancelled", "failed"].includes(j.status)) {
      const recent = j.status === "done" && (j.finishedAgoMs ?? 1e9) < 4000;
      const s = seat(j.area, next[zone] ?? 0);
      return { waitIndex: -1, j, pos: recent ? { x: s.x, y: s.y } : doorSpot(doorK), pose: "idle" as Pose, seated: recent, visible: recent, label: displayName(j.area), sub: j.status === "done" ? "finished" : j.status, zone, fresh: false };
    }
    const i = next[zone] ?? 0; next[zone] = i + 1; const s = seat(j.area, i);
    const reading = READING.test(j.stage ?? "") && j.status === "running";
    return { waitIndex: -1, j, pos: { x: s.x, y: s.y }, pose: (j.status === "running" ? (reading ? "read" : "type") : "idle") as Pose, seated: true, visible: true, label: displayName(j.area),
      sub: j.status === "waiting" ? "waiting on helpers" : `${reading ? "reading" : "typing"}${progress}`, zone, fresh };
  });
}

/** Walk along the aisle: out to the aisle, along it, then into the room. Jump when the user prefers reduced motion. */
function useWalk(target: Pt, reduce: boolean) {
  const [pos, setPos] = useState<Pt>(target); const [walking, setWalking] = useState(false); const cur = useRef<Pt>(target); const timers = useRef<number[]>([]);
  useEffect(() => {
    timers.current.forEach(clearTimeout); timers.current = [];
    const from = cur.current; if (from.x === target.x && from.y === target.y) return;
    if (reduce) { cur.current = target; setPos(target); return; }
    const inAisle = (q: Pt) => Math.abs(q.x - AISLE_X) <= 70; const legs: Pt[] = [];
    if (!inAisle(from)) legs.push({ x: AISLE_X, y: from.y });
    if (!(inAisle(from) && inAisle(target))) legs.push({ x: AISLE_X, y: target.y });
    legs.push(target);
    setWalking(true); let t = 0;
    legs.forEach((p, i) => { timers.current.push(window.setTimeout(() => { cur.current = p; setPos(p); }, t)); t += 420; if (i === legs.length - 1) timers.current.push(window.setTimeout(() => setWalking(false), t)); });
    return () => timers.current.forEach(clearTimeout);
  }, [target.x, target.y, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return { pos, walking };
}

function Sprite({ area, pose, walking, synthetic }: { area: string; pose: Pose; walking: boolean; synthetic: boolean }) {
  const skin = "#f0c9a0", shirt = SHIRT[area] ?? "#2fa27a", hair = HAIR[area] ?? "#2a2a2a", pants = "#2a3350", u = 3;
  const typing = pose === "type" && !walking, reading = pose === "read" && !walking, up = pose === "ask" || pose === "carry";
  return (
    <g shapeRendering="crispEdges" transform={`scale(${u})`} className={`${walking ? "oc-walk" : ""} ${typing ? "oc-type" : ""} ${reading ? "oc-read" : ""}`}>
      <rect className="oc-legL" x="-4" y="-4" width="3" height="4" fill={pants} /><rect className="oc-legR" x="1" y="-4" width="3" height="4" fill={pants} />
      <rect x="-5" y="-1" width="4" height="1" fill="#15151c" /><rect x="1" y="-1" width="4" height="1" fill="#15151c" />
      <g className="oc-body">
        <rect x="-5" y="-12" width="10" height="9" fill={shirt} /><rect x="-5" y="-12" width="10" height="2" fill="#ffffff" opacity="0.18" />
        {area === "supervisor" && <rect x="-1" y="-12" width="2" height="6" fill="#f4f1e8" />}
        {up ? <><rect x="-7" y="-17" width="2" height="7" fill={shirt} /><rect x="-7" y="-19" width="2" height="2" fill={skin} /><rect x="5" y="-11" width="2" height="6" fill={shirt} /><rect x="5" y="-6" width="2" height="2" fill={skin} /></>
          : <><rect className="oc-armL" x="-7" y="-11" width="2" height="6" fill={shirt} /><rect className="oc-armL" x="-7" y="-6" width="2" height="2" fill={skin} /><rect className="oc-armR" x="5" y="-11" width="2" height="6" fill={shirt} /><rect className="oc-armR" x="5" y="-6" width="2" height="2" fill={skin} /></>}
        {pose === "carry" && <g><rect x="3" y="-10" width="6" height="7" fill="#f4f1e8" stroke="#8a8478" strokeWidth="0.5" /><rect x="4" y="-8" width="4" height="1" fill="#8a8478" /><rect x="4" y="-6" width="4" height="1" fill="#8a8478" /></g>}
        <g className="oc-head">
          <rect x="-5" y="-21" width="10" height="9" fill={hair} /><rect x="-4" y="-18" width="8" height="7" fill={skin} /><rect x="-4" y="-19" width="8" height="2" fill={hair} />
          <rect x="-2" y="-15" width="1" height="2" fill="#1a1a1a" /><rect x="1" y="-15" width="1" height="2" fill="#1a1a1a" />
          {area === "supervisor" && <><rect x="-3" y="-16" width="3" height="3" fill="none" stroke="#dfe6ee" strokeWidth="0.6" /><rect x="0" y="-16" width="3" height="3" fill="none" stroke="#dfe6ee" strokeWidth="0.6" /></>}
        </g>
      </g>
      {synthetic && <rect x="-6" y="-23" width="12" height="1.5" fill="#f3b24b" />}
    </g>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  return <g shapeRendering="crispEdges"><rect x={x - 9} y={y} width="18" height="14" fill="#a0603a" /><rect x={x - 9} y={y} width="18" height="3" fill="#c07848" /><rect x={x - 12} y={y - 14} width="8" height="14" fill="#2f8a4a" /><rect x={x - 4} y={y - 22} width="9" height="22" fill="#3fa85c" /><rect x={x + 4} y={y - 12} width="8" height="12" fill="#2f8a4a" /></g>;
}
function DeskBack({ x, y }: { x: number; y: number }) { return <g shapeRendering="crispEdges"><rect x={x - 17} y={y - 34} width="34" height="30" fill="#2a3350" /><rect x={x - 17} y={y - 34} width="34" height="4" fill="#3a4568" /></g>; }  // chair back
function DeskFront({ x, y, label, sub, glow, tone, selected }: { x: number; y: number; label: string; sub: string; glow: boolean; tone: string; selected: boolean }) {
  return (
    <g shapeRendering="crispEdges">
      <rect x={x - 58} y={y} width="116" height="10" fill="#d9b68a" /><rect x={x - 58} y={y + 10} width="116" height="40" fill="#8d6a46" />
      <rect x={x - 54} y={y + 2} width="8" height="3" fill="#e8cfa8" opacity="0.8" />
      {/* monitor and keyboard on the desk top */}
      <rect x={x - 52} y={y - 16} width="30" height="20" fill="#1b2433" /><rect x={x - 49} y={y - 13} width="24" height="13" fill={glow ? "#39c0f0" : "#2a3d52"} />{glow && <rect x={x - 46} y={y - 10} width="12" height="2" fill="#bdeaff" />}
      <rect x={x - 17} y={y + 2} width="34" height="5" fill="#3b4455" /><rect x={x + 30} y={y - 4} width="8" height="9" fill="#f4f1e8" /><rect x={x + 38} y={y - 2} width="3" height="5" fill="#f4f1e8" />
      {/* nameplate: compact, high contrast */}
      <rect x={x - 54} y={y + 15} width="108" height="31" rx="2" fill="#0b1630" stroke={selected ? "#67d4ff" : tone} strokeWidth={selected ? 3 : 2} />
      <text x={x} y={y + 29} textAnchor="middle" fill="#f6f1e6" fontSize="14" fontWeight="700" letterSpacing="1" fontFamily="var(--font-geist-sans), system-ui, sans-serif">{label.toUpperCase()}</text>
      <text x={x} y={y + 42} textAnchor="middle" fill="#bcd0ee" fontSize="12" fontFamily="var(--font-geist-sans), system-ui, sans-serif">{sub.length > 19 ? `${sub.slice(0, 18)}…` : sub}</text>
    </g>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Worker({ p, selected, reduce, onSelect }: { p: Placed; selected: boolean; reduce: boolean; onSelect: (id: string) => void }) {
  const { pos, walking } = useWalk(p.pos, reduce);
  return (
    <g className="oc-actor" transform={`translate(${pos.x} ${pos.y})`} style={{ transition: reduce ? "none" : "transform 420ms linear, opacity 500ms", opacity: p.visible ? 1 : 0, pointerEvents: p.visible ? "auto" : "none", cursor: "pointer" }}
      tabIndex={p.visible ? 0 : -1} role="button" aria-label={`${p.label}: ${p.j.title}. ${p.sub}.${p.j.needsYou ? ` Needs you: ${p.j.needsYou.text}` : ""}`} data-testid="office-worker" data-area={p.zone} data-status={p.j.status} data-needs-you={p.j.needsYou ? "1" : "0"}
      onClick={() => onSelect(p.j.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(p.j.id))}>
      <ellipse cx="0" cy="0" rx="22" ry="5" fill="#000" opacity="0.28" />
      {selected && <ellipse cx="0" cy="1" rx="30" ry="9" fill="none" stroke="#67d4ff" strokeWidth="3" />}
      <Sprite area={p.zone} pose={p.pose} walking={walking} synthetic={p.j.synthetic} />
      {p.fresh && <g className="oc-pop"><circle cx="0" cy="-34" r="26" fill="none" stroke="#67d4ff" strokeWidth="3" /><circle cx="0" cy="-34" r="14" fill="none" stroke="#bdeaff" strokeWidth="2" /></g>}
      {p.j.needsYou && p.waitIndex > 0 && <g className="oc-ask" data-testid="ask-badge"><circle cx="0" cy="-74" r="13" fill="#fff7e0" stroke="#f3b24b" strokeWidth="3" /><text x="0" y="-67" textAnchor="middle" fill="#8a4a00" fontSize="20" fontWeight="800">?</text></g>}
      {p.j.needsYou && p.waitIndex === 0 && (
        <g className="oc-ask" data-testid="ask-bubble">
          <g transform={`translate(${AISLE_X - pos.x} 0)`}>
            <rect x="-69" y="-124" width="138" height="48" rx="8" fill="#fff7e0" stroke="#f3b24b" strokeWidth="3" />
            <path d={`M${Math.max(-50, Math.min(50, pos.x - AISLE_X)) - 8} -76 l8 14 l8 -14 z`} fill="#fff7e0" stroke="#f3b24b" strokeWidth="3" strokeLinejoin="round" /><rect x={Math.max(-50, Math.min(50, pos.x - AISLE_X)) - 6} y="-79" width="12" height="5" fill="#fff7e0" />
            <text x="-58" y="-92" fill="#8a4a00" fontSize="26" fontWeight="800">?</text>
            <text x="-38" y="-103" fill="#2a2208" fontSize="14" fontWeight="700" fontFamily="var(--font-geist-sans), system-ui, sans-serif">Needs you</text>
            <text x="-38" y="-86" fill="#2a2208" fontSize="12.5" fontFamily="var(--font-geist-sans), system-ui, sans-serif">{trunc(p.j.needsYou.text.replace(/^Proposed: /, ""), 15)}</text>
          </g>
        </g>
      )}
    </g>
  );
}

/** Orthogonal route along the aisle from the assigner to the worker's desk. */
function route(from: Pt, to: Pt): Pt[] {
  const pts: Pt[] = [from]; const a: Pt = { x: AISLE_X, y: from.y };
  if (from.x !== AISLE_X) pts.push(a);
  pts.push({ x: AISLE_X, y: to.y });
  if (Math.abs(to.x - AISLE_X) > 1) pts.push(to);
  return pts;
}

export function OfficeScene({ jobs, pendingDecisions, selected, onSelect, onOpenDecision }: { jobs: OfficeJob[]; pendingDecisions: PendingDecision[]; selected: string | null; onSelect: (id: string) => void; onOpenDecision: (id: string) => void }) {
  const [reduce, setReduce] = useState(false);
  useEffect(() => { const m = window.matchMedia?.("(prefers-reduced-motion: reduce)"); if (!m) return; setReduce(m.matches); const f = () => setReduce(m.matches); m.addEventListener?.("change", f); return () => m.removeEventListener?.("change", f); }, []);
  const placed = place(jobs);
  const byId = new Map(placed.map((p) => [p.j.id, p]));
  const supJob = placed.find((p) => p.zone === "supervisor" && p.visible);
  const needing = placed.filter((p) => p.j.needsYou);
  const youCount = Math.max(pendingDecisions.length, needing.length);

  // Cyan: a brief bright trace right after the assignment, then a quiet tether while the worker is still on it.
  const traces = placed.filter((p) => p.j.parentId && p.zone !== "supervisor" && !p.j.needsYou && !["done", "cancelled", "failed", "queued"].includes(p.j.status) || (p.j.parentId && p.j.status === "queued"))
    .map((p) => {
      const parent = byId.get(p.j.parentId!); const from: Pt = parent && parent.zone !== "supervisor" ? { x: parent.pos.x, y: parent.pos.y - 24 } : { x: SUP.x, y: SUP.y + 52 };
      const to = p.j.status === "queued" ? { x: p.pos.x, y: p.pos.y - 30 } : { x: seat(p.j.area, 0).dx === p.pos.x ? p.pos.x + (ZONES[p.zone]?.near === "right" ? -4 : 4) : p.pos.x, y: p.pos.y - 24 };
      return { id: p.j.id, pts: route(from, to), bright: (p.j.createdAgoMs ?? 1e9) < 7000 };
    });
  const needLines = needing.map((p) => ({ id: p.j.id, pts: [{ x: p.pos.x, y: p.pos.y + 4 }, { x: YOU.x, y: YOU.y - 6 }] }));
  const pathD = (pts: Pt[]) => pts.map((q, i) => `${i ? "L" : "M"}${q.x} ${q.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-xl border border-[#0a1228]" role="group" aria-label="The Jarvis office. Cyan lines show who assigned work, nameplates say who is working, and amber question bubbles show who needs you. The same workers are listed below." data-testid="office-scene">
      <defs>
        <pattern id="planks" width="64" height="24" patternUnits="userSpaceOnUse"><rect width="64" height="24" fill="#c4915a" /><rect width="64" height="2" fill="#a97a47" /><rect x="0" y="12" width="64" height="12" fill="#cd9a63" /><rect x="31" y="12" width="2" height="12" fill="#a97a47" /><rect x="15" y="0" width="2" height="12" fill="#a97a47" /><rect y="12" width="64" height="2" fill="#a97a47" /></pattern>
      </defs>
      <rect width={W} height={H} fill="#13244d" />
      <rect x="20" y="20" width={W - 40} height={H - 40} fill="url(#planks)" stroke="#0a1228" strokeWidth="4" />
      <rect x="20" y="20" width={W - 40} height="12" fill="#1c346e" /><rect x="20" y="20" width="12" height={H - 40} fill="#1c346e" /><rect x={W - 32} y="20" width="12" height={H - 40} fill="#1c346e" /><rect x="20" y={H - 32} width={W - 40} height="12" fill="#1c346e" />
      <rect x={DOOR.x - 40} y={H - 34} width="80" height="16" fill="#3a2a1a" /><rect x={DOOR.x - 40} y={H - 34} width="80" height="4" fill="#6a4a2a" />
      <text x={DOOR.x} y={H - 5} textAnchor="middle" fill="#8fa6d8" fontSize="11" letterSpacing="3" fontFamily="var(--font-geist-mono), monospace">DOOR</text>
      {/* center aisle */}
      <rect x={AISLE_X - 76} y="34" width="152" height={H - 70} fill="#344f9a" opacity="0.55" /><rect x={AISLE_X - 76} y="34" width="4" height={H - 70} fill="#0f1d44" opacity="0.6" /><rect x={AISLE_X + 72} y="34" width="4" height={H - 70} fill="#0f1d44" opacity="0.6" />
      {Object.entries(ZONES).map(([k, z]) => (
        <g key={k}>
          <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="4" fill={z.rug} opacity="0.32" />
          <rect x={z.x} y={z.y} width={z.w} height="26" fill="#0b1630" opacity="0.82" />
          <text x={z.x + 14} y={z.y + 18} fill="#f6f1e6" fontSize="14" fontWeight="700" letterSpacing="3" fontFamily="var(--font-geist-mono), monospace">{z.label}</text>
          <Plant x={z.near === "right" ? z.x + 22 : z.x + z.w - 22} y={z.y + z.h - 44} />
          {[0, 1, 2, 3].map((i) => { const s = seat(k, i); return <DeskBack key={i} x={s.dx} y={s.dy} />; })}
        </g>
      ))}
      {/* supervisor's desk and your desk sit in the aisle */}
      <DeskBack x={SUP.x} y={SUP.y - 6} />
      {/* assignments (under the workers, above the floor) */}
      {traces.map((t) => <g key={t.id} data-testid="handoff-path" data-bright={t.bright ? "1" : "0"}><path d={pathD(t.pts)} fill="none" stroke="#0a1228" strokeWidth={t.bright ? 9 : 6} strokeLinejoin="round" opacity="0.35" /><path className={t.bright ? "oc-flow" : "oc-tick"} d={pathD(t.pts)} fill="none" stroke="#67d4ff" strokeWidth={t.bright ? 5 : 3} strokeLinejoin="round" strokeLinecap="round" opacity={t.bright ? 1 : 0.7} strokeDasharray={t.bright ? undefined : "2 8"} /><circle cx={t.pts[t.pts.length - 1].x} cy={t.pts[t.pts.length - 1].y} r={t.bright ? 8 : 5} fill="#67d4ff" stroke="#0a1228" strokeWidth="2" /></g>)}
      {needLines.map((t) => <path key={t.id} d={pathD(t.pts)} fill="none" stroke="#f3b24b" strokeWidth="3" strokeDasharray="3 7" strokeLinecap="round" opacity="0.9" />)}
      {/* characters */}
      {!supJob && <g aria-hidden transform={`translate(${SUP.x} ${SUP.y})`}><ellipse rx="22" ry="5" fill="#000" opacity="0.28" /><Sprite area="supervisor" pose="idle" walking={false} synthetic={false} /></g>}
      {placed.map((p) => <Worker key={p.j.id} p={p} selected={selected === p.j.id} reduce={reduce} onSelect={onSelect} />)}
      {/* desk fronts hide the legs of seated workers */}
      {Object.keys(ZONES).flatMap((k) => [0, 1, 2, 3].map((i) => {
        const s = seat(k, i); const occ = placed.find((p) => p.zone === k && p.seated && p.visible && p.pos.x === s.x && p.pos.y === s.y);
        return <DeskFront key={`${k}${i}`} x={s.dx} y={s.dy} label={occ ? occ.label : ZONES[k].label.charAt(0) + ZONES[k].label.slice(1).toLowerCase()} sub={occ ? occ.sub : "free desk"} glow={!!occ && occ.pose !== "idle"} tone={occ ? (occ.j.needsYou ? "#f3b24b" : "#4d6fb8") : "#243a72"} selected={!!occ && occ.j.id === selected} />;
      }))}
      <DeskFront x={SUP.x} y={SUP.y} label="Jarvis" sub={supJob ? supJob.sub : "idle"} glow={!!supJob && supJob.pose !== "idle"} tone="#67d4ff" selected={!!supJob && supJob.j.id === selected} />
      {supJob && <rect x={SUP.x - 34} y={SUP.y - 60} width="68" height="64" fill="transparent" tabIndex={0} role="button" aria-label="Open the supervisor" data-testid="office-supervisor" style={{ cursor: "pointer" }} onClick={() => onSelect(supJob.j.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(supJob.j.id))} />}
      {/* your desk */}
      <g data-testid="you-desk">
        <rect x={YOU.x - 66} y={YOU.y} width="132" height="10" fill="#d9b68a" /><rect x={YOU.x - 66} y={YOU.y + 10} width="132" height="36" fill="#8d6a46" />
        <rect x={YOU.x - 60} y={YOU.y + 14} width="120" height="28" rx="2" fill={youCount ? "#3a2a08" : "#0b1630"} stroke={youCount ? "#f3b24b" : "#4d6fb8"} strokeWidth="2.5" />
        <text x={YOU.x} y={YOU.y + 27} textAnchor="middle" fill="#f6f1e6" fontSize="14" fontWeight="700" letterSpacing="1" fontFamily="var(--font-geist-sans), system-ui, sans-serif">YOU</text>
        <text x={YOU.x} y={YOU.y + 40} textAnchor="middle" fill={youCount ? "#ffd78a" : "#bcd0ee"} fontSize="12" fontFamily="var(--font-geist-sans), system-ui, sans-serif">{youCount ? `${youCount} waiting` : "nothing waiting"}</text>
        {pendingDecisions.slice(0, 4).map((d, i) => (
          <g key={d.id} tabIndex={0} role="button" aria-label={`Open decision: ${d.title}`} data-testid="decision-paper" style={{ cursor: "pointer" }} onClick={() => onOpenDecision(d.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpenDecision(d.id))}>
            <rect x={YOU.x - 52 + i * 28} y={YOU.y - 22} width="24" height="28" fill="#f4f1e8" stroke="#f3b24b" strokeWidth="2.5" /><rect x={YOU.x - 47 + i * 28} y={YOU.y - 14} width="14" height="2.5" fill="#7a746a" /><rect x={YOU.x - 47 + i * 28} y={YOU.y - 8} width="14" height="2.5" fill="#7a746a" /><rect x={YOU.x - 47 + i * 28} y={YOU.y - 2} width="9" height="2.5" fill="#7a746a" />
          </g>
        ))}
      </g>
    </svg>
  );
}
