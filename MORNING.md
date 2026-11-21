# MORNING

Branch `claude/upbeat-cannon-wf5kxf`. No pull request. This file has three parts: **Redesign build** (this round), **Addendum build**, then **Overnight build** (both unchanged, further down).

# Redesign build: Claude and Jarvis share projects, and the Office shows the handoff

## Launch
```bash
git fetch origin claude/upbeat-cannon-wf5kxf && git checkout claude/upbeat-cannon-wf5kxf
npm install && npm run dev
```
Open **http://127.0.0.1:3000**. (If you installed from a ZIP, use the upgrade steps below instead of `git`.)

## The first three clicks
1. **Office** → **Send as synthetic Claude message**. Look only at the room. A cyan line runs from the Jarvis desk down the aisle to the **Planner**, who types at a desk (who assigned it, who is working). The **Reviewer** then checks the plan and walks to the **YOU** desk with a paper and an amber question bubble (who needs you). The strip above the room says the same in words.
2. **Projects** → open a project. This is the page Claude reads and writes through the connector. Every item says where it came from.
3. **Connections** → run the two-way check. This is the only thing that proves your own Claude account reaches Jarvis.

## Was live ordinary Claude used? No.
Nothing in this round touched a Claude account, a live model, a microphone or a public server. The connector is tested with the official MCP SDK client, in process and against the running production server, using a real token created in the UI. That proves the code path. **It does not prove your account can reach your Jarvis.** The exact pending steps are under "Needs Yonathan" below.

## Upgrade your existing ZIP-installed Mac copy without losing data
Pulling the branch on GitHub does not change the folder you downloaded. Pick one.

**Data-preserving upgrade (recommended).** Download the new ZIP, unzip it **next to** the old folder, then:
```bash
cd ~/Downloads/Jarvis-new            # the newly unzipped folder
npm install
npm run backup -- adopt ~/Downloads/Jarvis-old/data
npm run dev
```
`adopt` reads the old folder (it is never modified), copies your personal and example data and your vault files, upgrades the copy's database, runs an integrity check and prints what it kept. If this folder already holds personal data it stops and tells you; `--force` keeps the existing data aside first. Keep the old folder until you have looked around.

**Back up first, any time:**
```bash
npm run backup                              # writes ../jarvis-backups/jarvis-<time>/ and verifies it
npm run backup -- verify ../jarvis-backups/jarvis-<time>
npm run backup -- restore ../jarvis-backups/jarvis-<time>   # copies what is there aside first
```

**Clean start (throw away the example data, keep nothing):** unzip the new ZIP somewhere new, `npm install`, `npm run dev`. The private workspace starts empty.

If your old copy is the original ZIP and you cannot find a `data` folder inside it, you never saved anything privately; a clean start loses nothing.

## What changed
- **Projects (Claude ↔ Jarvis).** Two new connector tools: `get_project_context` and `apply_project_update`. A project keeps current decisions, open options, open questions and dated history apart. Every write is an event with an id, origin, expected revision and a receipt that names the workspace. Replays return the same receipt and write nothing. A stale update (you edited since Claude read) is refused and returns the current state instead of overwriting you. An out-of-order older message never replaces a newer decision. Similar project names are never merged; an ambiguous or unknown name is refused. Tentative wording waits for your confirmation. "Off the record" saves nothing. Forgetting erases the text from everything Claude can read.
- **Golden Iceland scenario** is a regression test (`tests/projects.test.ts`, `tests/connect.test.ts`): options, a decision that settles them, a changed mind, replay, out-of-order, stale patch, a second similar project, forget, new Claude session, your edit read back.
- **Connector security.** Tokens are created in Jarvis, shown once, stored only as a hash, scoped (read, or read + save), optionally expiring, rotatable and revocable (a revoked token stops working inside an open session). Rate limited. Never in a URL, the database, logs or the API list. `JARVIS_MCP_TOKEN` still works.
- **Hosted connector files.** `deploy/` (Dockerfile, compose, Caddyfile, README) puts only `/mcp` and `/healthz` on the internet over HTTPS; the app returns 404 for everything else (`JARVIS_PUBLIC_MODE=mcp-only`, `src/proxy.ts`), and the private app stays on loopback. One database serves both. **Not deployed or run against a server.**
- **Office.** A new Jarvis-owned pixel room (plank floor, navy walls, paired desks, plants, aisle), characters that walk the aisle to desks, type or read, a cyan assignment trace, an arrival ring, an amber question bubble, a YOU desk. Plus the handoff strip, a contextual inspector and a mobile roster. Details and the Pixel Agents evaluation: `docs/REDESIGN-NOTES.md`.
- **Reviewer + verification loop.** Planner finishes, Reviewer verifies, then one decision with the checks attached. One retry, then plain words to you.
- **Shell.** Four places: Today, Projects, Office, Memory. Everything else under More and in the command palette (⌘K). The permanent right panel is gone; Today shows decisions beside it only when something needs you. Ink background, warm off-white text, a single cool signal color, a restrained metal highlight, Geist + IBM Plex Mono, working text at least 14px. The assistant light (idle / listening / speaking) follows the real microphone and speech playback.
- **Today** answers "what matters, what are the agents doing, where did the output go". **Activity and outcomes** lists goal → result → receipt; Completed is linked from there and keeps its address.
- **Memory** gives a current answer and why, then pin, edit, move, merge, supersede, one-step undo and forget.

## Verification
| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **142 tests**, all pass (was 118) |
| `npm run build` | passes |
| `npm run e2e` | **229 checks, 0 problems** (was 199): real Chromium on the production server, including the handoff, Projects, the connector, the two-way check, revoke, and axe-core on every page |
| Upgrade | a schema-3 database with real rows is adopted: rows, search index and vault files preserved, old folder byte-for-byte unchanged |
| Contrast | AA on the new tokens (`tests/contrast.test.ts`); axe-core on every page, desktop and phone |

Screenshots: `docs/screenshots/` (after, from the browser suite), `docs/screenshots/before/` (the previous release) and `docs/screenshots/sizes/` (13-inch 1280x800, wide 1920x1080 and a 390px phone: Today, Office, Projects, Memory, Connections). I looked at them for overlap, tiny characters and stranded controls. Findings fixed: the YOU desk fell below the fold at 13-inch (the room now fits the viewport height) and stacked question bubbles overlapped (only the first waiting worker shows a bubble; the rest show a "?" badge). Known: on a phone the pixel room is replaced by the handoff strip and roster, because characters would be unreadably small there.

## Needs Yonathan
1. **Your Office screenshot did not arrive.** I built from the written description and say so. Send it and I will compare at the same scale and adjust.
2. **See real Claude Code sessions in the official Pixel Agents office.** In a terminal on your Mac: `npx pixel-agents --host 127.0.0.1 --port 3100`, open the printed address (it has a secret `?token=`; do not share it), then start `claude` in another terminal. It edits hook configuration under `~/.claude` (it says so); that is why I did not run it for you. Jarvis's own background workers will not appear there. That is expected and labeled.
3. **Prove ordinary Claude reaches Jarvis.** Deploy `deploy/` (or use Claude Desktop with `npm run mcp`), add the connector, run Connections → the two-way check. Whether your Claude plan accepts a fixed `Authorization` header on a custom connector is not confirmed.
4. Hosting, domain, any cost, and any public exposure are yours to decide.
5. Paid model calls remain off. Nothing here needs a key.


# Addendum build: Office, capture, and the spoken BI107 guide

## First thing to open

```bash
git fetch origin claude/upbeat-cannon-wf5kxf && git checkout claude/upbeat-cannon-wf5kxf
npm install && npm run dev
```

Open **http://127.0.0.1:3000/office** and press **Send as synthetic Claude message**. Watch the supervisor assign a Capacity specialist, click the helper to see its task, evidence, step and heartbeat, and watch one decision arrive in the right panel. Press **Replay the same message**: nothing doubles.

Then **Today → Ask Jarvis** for the BI107 voice journey. `docs/MAC-CHECKLIST.md` is the short list for the microphone, audible replies and the live Claude call.

## One clickable path per journey

| Journey | Path |
|---|---|
| Capture → Office → one decision | `/office` → Send as synthetic Claude message → click the Capacity specialist → open the decision in the right panel |
| Replay and Undo | same page → Replay the same message (shows "duplicate: nothing new") → Undo on the receipt |
| Kill the worker mid-job | `npm run worker` in one terminal, capture something, press Ctrl+C or `kill -9` the worker mid-run, start it again. The job finishes once. (The e2e does exactly this with a real process kill) |
| Spoken BI107 guide | Today → Ask Jarvis → Tap to talk (or type) → Attach photos (`fixtures/bi107/`, one is partly blurred) → Send → hear the acknowledgment → leave to Office → come back to `/courses/BI107` → Open guide |
| Edit and versions | guide → Edit → Save as a new version → Versions |
| Quiz and "what I missed" | guide → Quiz me, miss some → say or type "Quiz me on what I missed" |
| PDF | guide → Export PDF, or PDF with answer key |
| Connector | `docs/CAPTURE-SETUP.md`, then `npm run mcp:smoke -- <url> <token>` |

## What was built

- **Capture**: one handler for every route (Office box, MCP tools `save_to_jarvis` and `recall_from_jarvis` over stdio and over an authenticated HTTP `/mcp` route, voice). Stable dedup key, receipt with a deep link, Undo. Recall searches saved Jarvis records only and says exactly what to share when nothing matches. It does not claim to read your Claude chats.
- **Deadline watch**: an email that brings a deadline forward for a commitment you already have updates that commitment once and raises one decision. Replays and later dates change nothing. It never sends anything.
- **Durable job engine** (`src/lib/jobs.ts`): leases, memoized steps, idempotent delegation, depth and concurrency bounds, children inherit a subset of the parent's tools and budget, cancellation cascades, a restarted worker recovers expired jobs. Idle desks make zero model calls.
- **Live Office** (`/office`): an original SVG pixel office with Intake, Research, Planning and Decisions rooms, driven only by saved job events, with a roster, an inspector, a mobile roster, and reduced motion. Synthetic source events are labeled.
- **Voice front door** on Today and the course workspace: tap-to-talk, visible microphone state, disclosure of the external speech service before first use, editable transcript, text fallback, photo attach with a per-photo quality check, voice picker preferring British English at a measured pace, preview, mute, stop, interrupt-by-talking, and a spoken completion even if you were on another screen.
- **BI107 study guide**: previous guide found by course and type (asks only for competing matches, or to paste one once), format read from it, photos checked on real pixels, coverage read from the final announcement (marked provisional if missing), answer key checked against course materials (including recomputing Hardy-Weinberg arithmetic), saved as an editable, versioned document under BI107 → Study Guides → Final, quizzes pinned to the exact version, missed-question retrieval, PDF export.

## Verification: live, fixture, pending

**Live verified: nothing in this round.** No Claude account, API key, microphone, speaker or real photo was used here.

**Tested with fixtures and fakes (what actually ran):**

| Check | How |
|---|---|
| `npm run verify` | typecheck, **118 tests**, production build: all pass |
| Full browser suite `npm run e2e` | **199 checks, 0 problems**, real Chromium on the production server, run again from the clean checkout state each time |
| Capture → one commitment, one helper, one decision; replay; Undo | unit tests and e2e |
| Worker killed mid-job, replaced, still one commitment and one decision | **real process kill (SIGKILL)** in e2e, plus unit tests that crash before and after a step |
| Office reconnect | page reload rebuilds from saved state |
| MCP connector | official SDK client over stdio and over HTTP (in process and against the running server), bad or missing token refused |
| Spoken journey | **fake speech engines** injected into the browser. This tests the app's logic (voice choice, pace, interruption, announcement, speaking once), not real audio or real speech recognition |
| Photos | two synthetic images: the local check flags exactly "bottom right" on the partly blurred one and passes the sharp one. Reading what they say uses a **labeled fixture reading** that exists only for those two images |
| Claude image reading and question writing | tested with a mock transport (image block sent, style notes and materials in the writer prompt, invalid questions dropped). **Never run against the live API** |
| Guide edit, versions, stale-edit refusal, quiz, missed items, restart persistence, duplicate request, cancel | unit tests and e2e, including a real server restart |
| PDF | text extracted from the generated PDF: practice copy has no answers, key copy has them |
| axe-core on every page including Office, Courses, the course workspace and a guide | no serious or critical issues, desktop and phone |
| Hosted-backend RLS | unchanged from the overnight build |

**Pending, needs a device, account or key:** real microphone capture and real audible playback (steps 2 and 3 of the Mac checklist), a real Claude image read of your actual test photos and Claude-written questions (step 5), adding the connector to your Claude account, and anything on the list below.

## Screenshots (`docs/screenshots/`)

Office: `15-office-desktop.png`, `15b-office-after-restart-desktop.png`, `17-office-study-desktop.png`, `16-office-mobile.png`. Finished guide: `18-guide-desktop.png` (v1 from your two photos), `19-guide-mobile.png` (a later version without photos), `20-voice-dock-desktop.png`, `21-course-workspace-desktop.png`, `22-course-workspace-mobile.png`. A sample answer-key PDF: `BI107-final-study-guide-sample.pdf`.

## Bugs found and fixed this round

1. The decisions panel never refreshed when a background helper raised a decision. It now polls.
2. The API never exported `PUT`, so saving a guide edit silently failed.
3. A cancel that arrived while the supervisor was mid-run was ignored once it began waiting on a helper, leaving a "waiting" supervisor and a stray blocked helper. Fixed in the engine, with a regression test.
4. "Reset demo" did not clear the new tables (jobs, captures, documents, photos), so a reset left old guides behind. Fixed, with a test.
5. A helper that stops to ask which earlier guide to match had no way to be answered in the UI. The question now appears in the conversation, is spoken, and can be answered there or in the Office.
6. The completion message was suppressed by the acknowledgment sharing a job id (found by a unit test).
7. Re-opening BI107 after deleting its guides silently re-created them (found by a unit test).
8. Cosmetic: "partly unclear: Partly unclear", "Fixture: Fixture generator", a doubled supervisor row, small Office sprites, a parser that split "the smoke-test team" wrongly.
9. Test harness: Chromium has a native `SpeechRecognition` that bypassed my fake until I defined both names.

## Known gaps in this round

- **The fixture question bank ignores the photos.** In the example workspace, photo readings are recorded and shown, but the fixture writer picks from a built-in bank for the synthetic BI107 notes. Only the Claude writer uses your photo style. The guide labels which one ran.
- **Photos you upload are only read with a Claude key.** Without one they are quality-checked, kept, and the guide says "not read (needs a Claude provider)". Nothing is made up.
- **Not built:** importing a selected Claude conversation export, Gmail OAuth watching, WhatsApp Business webhook, Apple Messages. WhatsApp and Messages work as reviewed paste only. Table in `docs/CAPTURE-SETUP.md`.
- **Connector auth is a static bearer token.** If claude.ai requires OAuth for remote connectors on your plan, that is not built, and a localhost URL cannot serve Claude mobile.
- PDF uses a built-in Latin font. Non-Latin text (for example Hebrew) would not render. Diagrams appear as a caption, and photos are not embedded.
- Office specialist templates have a minimal approve flow. Recurring schedules for them are not offered.
- Speech: Firefox has no speech recognition. The dock says so and typing works. A voice is your device's own. I did not test Safari or a real British voice.
- One screenshot (`19`) is the third guide version, which had no photos attached.

## Smallest remaining setup

1. Mac checklist steps 2 and 3 (microphone, speaker): about five minutes, no account.
2. Step 5: `ANTHROPIC_API_KEY` in `.env`, a small daily budget in Settings, **Test Claude**, then repeat the journey with your real photos.
3. Connector: `docs/CAPTURE-SETUP.md`. Option A (Claude Desktop, stdio) needs no deployment.
4. Everything in "Needs Yonathan" below, unchanged.

---

# Overnight build (unchanged)

The counts and screenshots in this part are from the first build. Current counts are in the addendum above.

## Launch

The build ran in a cloud container, so there is no public preview link. That is deliberate: nothing here is hosted or exposed. To open it on your Mac (Node 22.13 or newer):

```bash
git fetch origin claude/upbeat-cannon-wf5kxf && git checkout claude/upbeat-cannon-wf5kxf
npm install
npm run dev          # then open http://127.0.0.1:3000
```

Production mode: `npm run build && npm run start`. Unattended scheduler: `npm run worker`. The server binds to loopback only. I could not run it on a Mac. I ran the same commands on Linux, including from a fresh `git clone` and `npm ci` (8 s install, then typecheck, tests and build in about 15 s).

**First thing to click:** Today, then **Replay update** (under Sources). One decision appears. Click it, read the evidence, press **Reserve**, refresh.

## First five clicks

1. Today → **Replay update**. Right panel: one decision, "Moved up 2 days".
2. Open it. Quote, old and new due dates, the print requirement (articles 4, 13, 16, 31), **Both versions and copies**.
3. **Reserve**. Two local blocks. They are not on Google Calendar.
4. Refresh, then **Replay update** again. Nothing changes.
5. Council → **Load the sample essay** → **Bring in the council**. Then **Correct Jarvis** ("You missed the printed excerpt last time.") and open Skills.

## Results (actual commands)

| Check | Result |
|---|---|
| `npm run verify` (typecheck, tests, production build) | pass: 84 tests in 7 files |
| `npm run e2e` (real Chromium, production server) | pass: 123 checks, 0 problems. Run three times, plus once from a clean clone |
| axe-core WCAG 2 A and AA on 11 pages, desktop and 390 px, plus the decision drawer | 0 serious or critical after fixes |
| Contrast tests on the design tokens | pass |
| Hosted schema with row level security, on an in-process Postgres (PGlite) | pass: cross-user read, write, delete, forged owner, child rows and storage objects all denied |
| MCP server over stdio with the official SDK client | pass |

**Skipped, not tested:** every live provider. Nothing was checked against a real Blackboard, Google Calendar, mailbox, Anthropic API key or push provider. The Claude client was tested against a local stub server only. Fixture and replay output is labeled as such in the app.

Screenshots from the running app are in `docs/screenshots/`: `01` to `09`, `13`, `14` are desktop at 1440×900, `10` to `12` are phone at 390×844. Start with `02-decision-drawer-desktop.png` and `11-decision-drawer-mobile.png`.

## Bugs found by exercising the app, and fixed

Real defects, each reproduced and re-checked:

1. **Skill evaluation exposed an extraction bug.** The sentence splitter merged "5 p.m. Bring a printed excerpt..." into one sentence, so quotes were not exact. Fixed.
2. "No paper copies" was never recognized as a print waiver (regex needed a space that is not there). Fixed.
3. `.ics` `DURATION:PT30M` events were dropped as ending before they start. Fixed.
4. Scheduler: a wrong placeholder count broke missed-cycle recording, and Run now created a duplicate brief on every click. Fixed.
5. Next's Turbopack could not bundle `node:sqlite` loaded through `createRequire`. Now loaded with `process.getBuiltinModule`.
6. Changes this week showed two rows for the one updated assignment. Now one row per task.
7. Import: a stale PDF error hid the "file over 2 MB" message. Fixed.
8. The command palette stayed open after a navigation command. Fixed.
9. Phone header showed "Open private workspace" and wrapped the badge. Fixed.
10. Council "Earlier sessions" kept showing a finished session as running. Fixed.
11. Forgetting a note made a stray 404 request. Fixed.
12. axe: the file input had no label (critical) and checklist links relied on color alone (serious). Fixed.
13. Raw id `example-library` was shown as a source name. Fixed.
14. After reading the current API reference: the Claude client did not send effort (`output_config.effort`), `max_tokens` ceilings had no room for thinking tokens, a truncated or refused reply would have been retried and paid for three times, and my placeholder rates were too high. Fixed. Rates now come from the reference table cached 2026-11-03, still estimates.

Test-harness problems (not app bugs): an orphaned server from my own e2e script, `data-testid` not forwarded by two small components, a keypress before hydration, and an RLS stub that lacked the RLS Supabase ships with.

## Known issues and gaps

- No live connection of any kind (see table). Blackboard has no adapter beyond an interface.
- PDF import is unsupported and says so. No parser is installed.
- Voice: browser speech synthesis and recognition are feature-detected but were not exercised (headless Chromium has neither). Interrupting "naturally" is simplified to choosing the next speaker.
- Claude-written skill candidates and the Claude council path are built but only tested with mock transports. The skill candidate is a labeled local transformation.
- Pitch and founder council presets change seats and prompts only. There are no structured fields for company-reported vs external vs assumed inputs.
- Goals: milestone and outcome goals exist in the data model, but the UI only creates count goals.
- No UI to change time zone or travel. Daylight saving is tested for the check schedule across the fall change, not the spring one.
- Obsidian: `.base` and `.canvas` files are checked structurally, not opened in Obsidian. Syncing a vault on a sleeping Mac is not claimed.
- Hosted backend is a schema and policies only. The app still runs on local SQLite.
- Node prints an ExperimentalWarning for `node:sqlite`. Harmless.
- RTK v1.2.1 could not be installed: GitHub access in this session was scoped to the Jarvis repo, so I used scoped test output instead. I have no RTK reduction figure and no token total to report.
- Fable and any premium usage were never enabled. No paid model call was made.

## Capability table

| Capability | Status | Next dependency |
|---|---|---|
| Today, decisions, evidence drawer, reserve, defer, handled | works locally, tested with fixture | none |
| Change detection, supersede vs conflict, duplicate and stale sources | works locally, tested with fixture | none |
| Capacity planner, shortfall, protected intervals | works locally | your own protected times (Settings) |
| Study plan and practice results | tested with fixture | none |
| Follow-ups, student record, accountability | tested with fixture | none |
| Goals, resume, "I have N minutes" | works locally | none |
| Memory, search, backlinks, forget, private room | works locally | none |
| Obsidian vault export, import, conflicts | works locally (not opened in Obsidian) | your vault folder |
| Skill loop with rollback | tested with fixture | none |
| Council | sample replay and rubric checklist work locally. Claude path: implemented, needs connection | Anthropic key and budget |
| Model router, budget, premium gate | tested with mocks and a local stub | Anthropic key and budget |
| File import (.json, .ics, .eml, .md, .txt, .html) | works locally | none |
| Watched folder, scheduler, outbox, quiet hours | works locally. Worker: implemented | `npm run worker` on an always-on machine |
| Calendar read (iCal feed) | implemented, needs connection | `JARVIS_ICS_URL` |
| Notification email, Blackboard | implemented, needs connection (import path works) | your sign-in and Duo, or email export |
| Push and SMS | unfinished (off) | provider and recipient |
| MCP server (stdio) | tested with fixture | add to Claude Desktop config (docs/SURFACES.md) |
| Remote MCP for Claude mobile | unfinished | hosted, authenticated deployment |
| Supabase schema with RLS | tested on in-process Postgres | a Supabase project, if wanted |
| Voice room | works locally (text). Speech: untested | a real browser with a microphone |
| PDF import | unfinished | parser dependency |

## Needs Yonathan

1. **Blackboard.** Sign in through BU's flow and complete Duo yourself, or turn on Blackboard email notifications and drop the `.eml` files into the watched folder. Jarvis never asks for your password.
2. **Claude API key and a daily budget.** Paid AI is off. Set `ANTHROPIC_API_KEY` in `.env`, then a budget above 0 in Settings. Decide separately whether premium deep review (Fable) may ever run.
3. **Google Calendar.** Paste the secret iCal address into `JARVIS_ICS_URL` for read-only. Writing events to Google Calendar is not built and needs your approval first.
4. **Phone alerts.** Choose a provider and confirm a recipient. Native Claude mobile notifications are a separate path.
5. **Turn on schedules** for the private workspace (off by default), and decide where the worker runs: your Mac while awake, or a Cowork scheduled task.
6. **Your protected times.** Enter Shabbat and prayer intervals yourself. The demo uses made-up ones.
7. **Real data.** Import one real syllabus when you are ready. Nothing real has been loaded.
8. **Remote access.** A Claude mobile connector needs an authenticated hosted MCP. Say if you want that built.
9. **PDF support and a Supabase project** are optional dependencies you can approve or skip.

## Stopping condition

Stopped because the independent work was done, not because of a limit. Everything left needs one of the items above. To continue: "Read PROGRESS.md, inspect the current diff, run `npm run verify` and `npm run e2e`, then work through the Needs Yonathan list."
