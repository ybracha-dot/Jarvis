# MORNING

Branch: `claude/upbeat-cannon-wf5kxf` in the private `Jarvis` repo. No pull request was opened.

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
