"use client";
// An original pixel-art office, drawn in SVG. Characters are driven only by persisted job state and events.
// Design reference: the Pixel Agents project (pixel-agents-hq/pixel-agents). No code or art was copied: the sprites and layout here are drawn from scratch.

const AREAS: Record<string, { x: number; y: number; w: number; h: number; label: string; tint: string }> = {
  intake: { x: 16, y: 16, w: 312, h: 176, label: "Intake", tint: "#161c22" },
  research: { x: 392, y: 16, w: 312, h: 176, label: "Research", tint: "#171a24" },
  planning: { x: 16, y: 256, w: 312, h: 176, label: "Planning", tint: "#1e1b16" },
  decisions: { x: 392, y: 256, w: 312, h: 176, label: "Decisions", tint: "#20171a" },
};
const COLORS: Record<string, string> = { supervisor: "#5fe3c7", intake: "#8aa4c8", research: "#b79ad6", planning: "#e0b162", decisions: "#e58b7a" };
const DOOR = { x: 360, y: 440 };
const SUP = { x: 374, y: 214 };
const slot = (area: string, i: number) => { const a = AREAS[area] ?? AREAS.intake; return { x: a.x + 50 + (i % 3) * 104, y: a.y + 72 + Math.floor(i / 3) * 70 }; };

export interface OfficeJob { id: string; title: string; role: string; area: string; status: string; stage: string | null; depth: number; progress: { done: number; total: number } | null; finishedAgoMs: number | null; synthetic: boolean }

export function place(jobs: OfficeJob[]) {
  const slots: Record<string, number> = {};
  return jobs.map((j) => {
    const sup = j.area === "supervisor";
    let pos: { x: number; y: number }; let visible = true; let mood = "work";
    if (j.status === "queued") { pos = { x: DOOR.x + (jobs.indexOf(j) % 3) * 22 - 22, y: DOOR.y }; mood = "arriving"; }
    else if (["done"].includes(j.status)) {
      const recent = (j.finishedAgoMs ?? 1e9) < 5000;
      if (recent) { pos = slot("decisions", (slots.decisions = (slots.decisions ?? 0) + 1) - 1); mood = "handoff"; }
      else { pos = { x: DOOR.x, y: DOOR.y + 20 }; visible = false; mood = "left"; }
    } else if (j.status === "cancelled") { pos = { x: DOOR.x, y: DOOR.y + 20 }; visible = false; mood = "left"; }
    else if (sup) { pos = { x: SUP.x - 14 + (slots.sup = (slots.sup ?? 0) + 1) * 0, y: SUP.y }; mood = j.status; }
    else { const i = slots[j.area] ?? 0; slots[j.area] = i + 1; pos = slot(j.area, i); mood = j.status; }
    return { j, pos, visible, mood };
  });
}

function Sprite({ color, mood, synthetic }: { color: string; mood: string; synthetic: boolean }) {
  const skin = "#e8c9a6", hair = "#3a3027";
  return (
    <g shapeRendering="crispEdges" transform="scale(1.6)">
      <rect x="-5" y="-22" width="10" height="3" fill={hair} /><rect x="-5" y="-19" width="10" height="8" fill={skin} />
      <rect x="-3" y="-16" width="2" height="2" fill="#1a1a1a" /><rect x="1" y="-16" width="2" height="2" fill="#1a1a1a" />
      <rect x="-6" y="-11" width="12" height="11" fill={color} /><rect x="-8" y="-10" width="2" height="8" fill={color} /><rect x="6" y="-10" width="2" height="8" fill={color} />
      <rect x="-5" y="0" width="4" height="6" fill="#2b3340" /><rect x="1" y="0" width="4" height="6" fill="#2b3340" />
      {mood === "failed" && <text x="9" y="-18" fill="#f0766b" fontSize="14" fontWeight="700">x</text>}
      {mood === "blocked" && <text x="9" y="-18" fill="#f3b24b" fontSize="14" fontWeight="700">!</text>}
      {mood === "waiting" && <text x="8" y="-20" fill="#9ba3ad" fontSize="11">zz</text>}
      {mood === "handoff" && <rect x="-3" y="-8" width="6" height="7" fill="#f4f1e8" />}
      {synthetic && <rect x="-7" y="-24" width="14" height="2" fill="#f3b24b" />}
    </g>
  );
}

export function OfficeScene({ jobs, pendingDecisions, selected, onSelect, onOpenDecision }: { jobs: OfficeJob[]; pendingDecisions: { id: string; title: string }[]; selected: string | null; onSelect: (id: string) => void; onOpenDecision: (id: string) => void }) {
  const placed = place(jobs);
  return (
    <svg viewBox="0 0 720 480" className="w-full h-auto rounded-xl border border-line bg-[#0f1216]" role="group" aria-label="Live office. A list of the same workers follows.">
      {Object.entries(AREAS).map(([k, a]) => (
        <g key={k}>
          <rect x={a.x} y={a.y} width={a.w} height={a.h} rx="6" fill={a.tint} stroke="#2a313a" strokeWidth="2" />
          {Array.from({ length: 24 }).map((_, i) => <rect key={i} x={a.x + 8 + (i % 8) * 40} y={a.y + 120 + Math.floor(i / 8) * 18} width="38" height="16" fill="#ffffff" opacity="0.012" />)}
          <text x={a.x + 12} y={a.y + 22} fill="#9ba3ad" fontSize="12" letterSpacing="2" fontFamily="var(--font-geist-mono)">{a.label.toUpperCase()}</text>
          {[0, 1, 2].map((i) => { const s = slot(k, i); return <g key={i}><rect x={s.x - 26} y={s.y + 6} width="52" height="20" rx="2" fill="#2b3139" /><rect x={s.x - 10} y={s.y + 8} width="20" height="9" fill="#10151a" /><rect x={s.x - 8} y={s.y + 10} width="16" height="5" fill="#1d4a42" opacity="0.7" /></g>; })}
        </g>
      ))}
      {/* supervisor desk, centre corridor */}
      <rect x={SUP.x - 34} y={SUP.y + 6} width="68" height="20" rx="2" fill="#2b3139" /><rect x={SUP.x - 14} y={SUP.y + 8} width="28" height="9" fill="#10151a" />
      <text x={SUP.x} y={SUP.y + 44} textAnchor="middle" fill="#9ba3ad" fontSize="10" letterSpacing="2" fontFamily="var(--font-geist-mono)">SUPERVISOR</text>
      <rect x={DOOR.x - 28} y={DOOR.y + 10} width="56" height="8" fill="#2a313a" /><text x={DOOR.x} y={DOOR.y + 36} textAnchor="middle" fill="#6d7681" fontSize="10" letterSpacing="2" fontFamily="var(--font-geist-mono)">DOOR</text>
      {/* the persistent supervisor is always at its desk. idle means zero model calls. */}
      {!jobs.some((j) => j.area === "supervisor" && !["done", "cancelled"].includes(j.status)) && (
        <g transform={`translate(${SUP.x - 14} ${SUP.y})`}><Sprite color={COLORS.supervisor} mood="idle" synthetic={false} /><text x="0" y="-44" textAnchor="middle" fill="#9ba3ad" fontSize="11">idle</text></g>
      )}
      {/* decision papers */}
      {pendingDecisions.slice(0, 4).map((d, i) => (
        <g key={d.id} tabIndex={0} role="button" aria-label={`Open decision: ${d.title}`} className="cursor-pointer" onClick={() => onOpenDecision(d.id)} onKeyDown={(e) => e.key === "Enter" && onOpenDecision(d.id)}>
          <rect x={AREAS.decisions.x + 240 + i * 24} y={AREAS.decisions.y + 140} width="18" height="22" fill="#f4f1e8" stroke="#f3b24b" strokeWidth="2" /><rect x={AREAS.decisions.x + 244 + i * 24} y={AREAS.decisions.y + 146} width="10" height="2" fill="#7a746a" /><rect x={AREAS.decisions.x + 244 + i * 24} y={AREAS.decisions.y + 151} width="10" height="2" fill="#7a746a" />
        </g>
      ))}
      {placed.map(({ j, pos, visible, mood }) => {
        const color = COLORS[j.area] ?? COLORS.intake;
        const bubble = j.stage && ["running", "waiting", "blocked"].includes(j.status) ? (j.progress ? `${j.progress.done} of ${j.progress.total}` : j.stage.length > 20 ? j.stage.slice(0, 19) + "…" : j.stage) : null;
        return (
          <g key={j.id} className="office-char" style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, opacity: visible ? 1 : 0 }} tabIndex={visible ? 0 : -1} role="button" aria-label={`${j.role}: ${j.title}, ${j.status}`}
            onClick={() => onSelect(j.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(j.id)}>
            {selected === j.id && <ellipse cx="0" cy="8" rx="14" ry="5" fill="none" stroke="#5fe3c7" strokeWidth="2" />}
            <Sprite color={color} mood={mood} synthetic={j.synthetic} />
            {bubble && <g><rect x="-58" y="-68" width="116" height="20" rx="3" fill="#0d0f12" stroke="#2f3640" /><text x="0" y="-54" textAnchor="middle" fill="#e0e3e7" fontSize="11">{bubble}</text></g>}
          </g>
        );
      })}
    </svg>
  );
}
