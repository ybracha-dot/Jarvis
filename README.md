# Jarvis

A general-purpose chief of staff. You say or type an outcome (for example "Get me ready for tomorrow" or "Pick up where we left off on the pitch and draft my follow-up"), close the screen, and come back to a finished, checked result: one job, one result link, every claim tied to a source you can open, and nothing sent anywhere.

## Try it now

```bash
npm install
npm run dev          # http://127.0.0.1:3000
npm run worker       # in a second terminal: runs the background jobs
```

1. **Connections** → **Load the sample workspace** (synthetic club, meetings, emails, a calendar and a changed notice, all labelled *fixture*).
2. **Today** → in **Ask Jarvis** type or say: *Pick up where we left off on the pitch and draft my follow-up.* Open the result link it gives you at once.
3. On the result page read the draft, **Check these**, **Where each claim came from** (click a source to see the original with the quote highlighted) and **What Jarvis read for this**. Then ask *Get me ready for tomorrow*.

From ordinary Claude (after the connector is set up, `docs/CAPTURE-SETUP.md`): *Use Jarvis to get me ready for tomorrow*, then in a new chat *Show me my latest Jarvis result*. Results are never sent: they are drafts and briefs saved in Jarvis.

`MORNING.md` has the full handoff: what is verified locally, what needs your accounts, and how to upgrade a ZIP-installed copy without losing data.

---

## About

Originally a private chief of staff for a student who guards uninterrupted work blocks. It watches sources you give it, notices when a deadline or requirement changes, and asks you for one decision with the evidence attached.

The example workspace is fictional and has a demo clock. The private workspace is blank and uses your real clock. They use separate folders and cannot see each other.

## Run it (macOS or Linux)

Needs Node 22.13 or newer. No native build step: SQLite is the one built into Node.

```bash
npm install
npm run seed        # optional: the first open of the example workspace seeds it anyway
npm run dev         # http://127.0.0.1:3000
```

For a production run:

```bash
npm run build
npm run start       # http://127.0.0.1:3000
```

The server binds to loopback only. It rejects other hosts and other origins on every change.

## First five clicks

1. **Today**. Under Sources, click **Replay update**. One decision appears: "Argument and primary sources: Moved up 2 days".
2. Click that decision. Read the quote, both dates, the print requirement for articles 4, 13, 16 and 31, and **Both versions and copies**.
3. Click **Reserve**. Two local blocks are created. They are not on Google Calendar.
4. Refresh. The decision stays decided. Click **Replay update** again: nothing changes.
5. Open **Office**, press **Send as synthetic Claude message**, and watch a supervisor assign a helper and put one decision on your desk. Replay it: nothing doubles.
6. Back on Today, use **Ask Jarvis**: tap the mic (or type), attach the two photos from `fixtures/bi107/`, send. See `docs/MAC-CHECKLIST.md`.
7. Open **Council**, **Load the sample essay**, **Bring in the council**. Then type "You missed the printed excerpt last time." under **Correct Jarvis** and look at **Skills**.

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | typecheck, all tests, production build |
| `npm test` | 118 tests: domain, API boundary, imports, scheduler, router, council, skills, jobs and Office, capture, study guides and quizzes, MCP over stdio and HTTP, Postgres RLS |
| `npm run e2e` | real-browser journey (needs `npm run build` first). Saves screenshots to `docs/screenshots/` |
| `npm run worker` | unattended scheduler and job runner with a heartbeat (checks 08:00 and 16:00 New York, weekly Sunday 15:00; runs Office jobs) |
| `npm run mcp:smoke -- <url> <token>` | smoke test for an authorized MCP connector (see docs/CAPTURE-SETUP.md) |
| `npm run fixtures` | rewrite the two synthetic BI107 test photos in `fixtures/bi107/` |
| `npm run mcp` | opt-in local MCP server over stdio |
| `npm run reset-demo` | resets the example workspace only |

## What is real and what is a fixture

See `MORNING.md` for the capability table. Short version: everything runs locally with no accounts. Nothing here has been verified against a live Blackboard, Google Calendar, mailbox, Claude API key or push provider. Fixture and replay output is always labeled as such.

## Where things run

See `docs/SURFACES.md`.

## Files

- `JARVIS-MASTER.md` the build brief
- `PROGRESS.md` build state and the continuation command
- `UPSTREAM.md` what was read from the pinned references
- `supabase/migrations/` optional hosted schema with row level security (tested on an in-process Postgres)
- `.env.example` configuration names
