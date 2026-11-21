# Redesign notes

## Visual references: what was and was not used
- **Owner's Office screenshot: not received.** No image reached this session (no upload in the conversation or the attachment folder). The Office scene follows the brief's written description of it instead: warm plank floor, navy perimeter, paired workstations with plants and monitors, oversized characters, compact high-contrast nameplates, a clear center aisle. The comparison "populated desktop screenshot against the reference at the same scale" **could not be done**. When the image arrives, colors, sprites and desk layout are constants at the top of `src/components/OfficeScene.tsx` and are meant to be revised.
- No Jarvis character image was supplied. The assistant light is original (`src/components/Orb.tsx`, tokens in `globals.css`).
- Cues adopted from the written direction: *composition* (aisle in the middle, rooms either side), *materials* (plank floor, navy wall, brushed-metal highlight in the app chrome), *contrast* (nameplates are off-white on navy), *motion* (walk along the aisle, tap/read poses, a cyan trace on assignment, an amber question bubble), *silhouette* (large heads, flat shirt colors per role).

## Pixel Agents (Pablo De Lucca): what was evaluated
- Listing: `pablodelucca.pixel-agents` on the VS Code Marketplace; the same project ships a standalone browser edition as the npm package `pixel-agents` (v1.6.0 at the time of reading, Node 20+). Code license: MIT (read from the repository's LICENSE). **Art license was not verified.** The character art credits a third-party pack (JIK-A-4, Metro City). Nothing from Pixel Agents is bundled or copied here; the Jarvis scene is drawn from scratch in SVG.
- The marketplace page itself could not be fetched from the build environment (network policy). The README and npm metadata were used.
- **Not run here.** The standalone edition reads Claude Code session files and installs hook configuration under `~/.claude` on the machine it runs on. The build environment's permission check refused that, correctly, so it was not worked around. The "real Claude Code session appearing in the official office" proof is **pending on the Mac**: steps are in `MORNING.md`.
- **Integration point for Jarvis jobs: none found.** The documented surface is Claude Code hooks and transcripts. There is no documented way for another app to publish its own jobs. So, as the brief allows: the Office page is a Jarvis-owned scene for Jarvis background workers, and an **Open Pixel Agents** panel on the same page explains how to launch the official office for terminal sessions on its own loopback port (`npx pixel-agents --host 127.0.0.1 --port 3100`). The two views are labeled with what they cover. A Jarvis job is never presented as a Claude Code terminal.
- The access token Pixel Agents prints (`?token=`) is never stored or logged by Jarvis.

## Handoff: how the room answers the three questions
Everything is derived from saved job rows (`officeState` in `src/lib/jobs.ts`), polled once a second.
- **Who assigned it:** a bright cyan trace runs from the Jarvis desk down the aisle to the assigned desk for about seven seconds after the job is created (`createdAgoMs`), then settles to a thin dotted tether while the worker is still on it. A ring pops at the worker the moment it is created. The strip above the room says "Jarvis → Planner" in words.
- **Who is working:** a seated character at a desk with a nameplate (role and live step, such as "typing · 2 of 4" or "reading"). Idle desks say "free desk"; an idle office is quiet and makes zero model calls.
- **Who needs you:** a character stands at the YOU desk holding a paper with an amber question bubble; an amber dashed line joins them to your desk; your nameplate says how many are waiting; the strip lists them with an action button. "Needs you" is only ever a blocked question or an unanswered decision.
- Reduced motion keeps all of this and drops the movement. The scene has a text equivalent (strip and roster) and labeled, keyboard-focusable characters.

## Verification loop
Capture handling is now observe → delegate → verify → complete / retry once / hand to you. The supervisor assigns a Planner; when it finishes, a Reviewer checks the artifact (commitment exists once, work item and due date, plan against the calendar) and only then raises the single decision, with the checks attached as evidence. A gap sends the work back once; a gap that survives is handed to you in plain words. Two rounds at most; deterministic, zero model calls.
