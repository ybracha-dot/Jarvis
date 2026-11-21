# JARVIS · Overnight build brief for Claude Code

## Start here, Yonathan

Use Claude Code in a dedicated private Jarvis repository. For an overnight run, use a Claude Code cloud session with a writable repository and package registry access. A local Claude Code session also works while the Mac is awake and the session is running. Ordinary chat can discuss this file; the build needs a workspace that can edit files and run tests. Put this file at the repo root as JARVIS-MASTER.md. An empty repository with an initial commit containing this file is sufficient. If your interface accepts a file attachment, you can attach it in a writable coding session instead. Keep your real school records and credentials out of the repo.

### Model and effort settings for this build

Start the main Claude Code session on Sonnet 5.5 at high effort. In the web session send `/model claude-sonnet-5-5`, then `/effort high` as a separate command. Use a Sonnet medium-effort worker for straightforward UI and fixture work when delegation saves time. Use Haiku 5.5 low for narrowly bounded read-only lookups. Set each custom subagent's model and effort explicitly where supported. Keep changes and test results in the main workspace.

Optional premium reviewer: Fable 5.2 at high effort for a cross-cutting bug that survives two substantive repair attempts, or one final architectural review of the diff and failing tests. Give the reviewer only the relevant evidence and request the smallest testable fix. Default premium calls to off unless Yonathan explicitly enables Fable for this run with an acceptable usage budget. If unavailable, continue on Sonnet and document unresolved findings. Use ordinary repository tests to verify any recommendation. Do not silently enable credits, raise plan limits or switch the whole session to max effort.

### Conserve Claude Code tokens during the overnight build

In the coding environment, use the command-output filtering feature of [RTK v1.2.1](https://github.com/rtk-ai/rtk/releases/tag/v1.2.1). Check for an existing compatible rtk-ai binary. Otherwise use an official release for the build host in a workspace-local tools directory if available. Use explicit commands such as `rtk git status` and `rtk git diff --stat`, plus supported test and lint commands. Skip global hooks, API proxies and changes to user credentials. If installation is blocked, use scoped git diffs, targeted tests and concise native reporters and continue. Jarvis itself has no dependency on RTK.

Read the full brief once. Keep a short PROGRESS.md with acceptance-test IDs, changed paths and the next failing test. Give each delegated worker its specific task, source paths and acceptance criteria. Read the relevant diff or function on follow-up. Run targeted checks while iterating, then the full verification suite at the appropriate milestone. Keep original exit codes and inspect the unfiltered failure details when diagnosing errors. Use the actual diff for final review. At handoff, report RTK's estimated reduction in command output if available; only report total build spend or actual tokens when the coding platform supplies those figures.

### Model routing inside the finished app

Implement one server-side router with configurable role-to-model defaults. Resolve support at startup, record the actual model and effort used, and give an actionable status for unavailable roles. The code-building session and the app's API spend have separate budgets.

| Runtime job | Default |
|---|---|
| Timers, source hashes, deduplication, calendar math, quiet hours, unchanged scans | Deterministic code. Zero model calls. |
| Short changed notices, tags, simple field extraction | Haiku 5.5 low. Validate the structure and evidence excerpt. Route ambiguous language to Sonnet. |
| Daily brief, study plan, advisor dialogue, skill candidate or ordinary essay review | Sonnet 5.5 medium. Use high for conflicting evidence or synthesis across reviewers. |
| Explicit deep review of a consequential disagreement | Fable 5.2 high on the disputed passage and primary sources only. Use once when enabled. |

Avoid sending the full vault or rerunning completed reviews on unchanged input. Reserve estimated cost against the user's configured daily budget before dispatch, accounting for parallel council seats; reconcile actual usage afterward. Gate premium usage separately. When the budget is exhausted, keep deterministic functions available and label deferred AI work. Include tests for zero calls on an unchanged scan, ordinary work staying on the standard route, and blocking premium calls without opt-in. Compare quality on the supplied fixtures before adopting more expensive defaults.

**Send this message once:**

> Read JARVIS-MASTER.md in full and execute it as my build brief. Build the app in this workspace now. Start with the morning acceptance journey, use the pinned upstream references, and continue through the remaining milestones while you have capacity. Run the app and exercise it. Save progress after each working slice. If a personal connection needs me, keep building against the supplied fixtures and record the exact connection step in MORNING.md. Finish with a preview or launch command, test results, and the first thing I should click.

Before stepping away, check that Claude has actually created the first project files or run its first command. Set the session's usage budget to your preference. Keep paid application runs off until you enable a budget. A Claude Code build session and the future Jarvis app have separate credentials, permissions, schedules and usage. If a session ends early, send: “Read PROGRESS.md, inspect the current diff, run the last passing smoke test, and continue from the first unfinished acceptance journey in JARVIS-MASTER.md.”

---

## 1. Build mandate

You are the implementing engineer and product designer for Yonathan Bracha. Deliver working software in the selected workspace. Make routine decisions autonomously. Prefer a working vertical slice to a screen full of disabled promises. Preserve existing user changes. If the selected repo already has an app, inspect its conventions before adding files. If the repo is unrelated, work in an isolated jarvis/ directory. Use one package manager, one lockfile, one command to launch. Make the product easy to run a second time.

Jarvis is a personal chief of staff for a Boston University student, aspiring Questrom finance/FinTech founder, TAMID analyst and student consultant. His scarce resource is an uninterrupted work block. His most frequent questions are “What do I have for class?”, “What changed?”, “Who owes me what?”, “What can I finish before my next commitment?” and “What should I fix before I submit this?” He wants a visual command center, a single conversational interface, an inspectable memory and specialists that do useful work before he asks. He makes decisions. Never hard-code current enrollment, GPA, financial records or historical due dates as live facts. Use the supplied fictional examples for demonstration.

Product language is direct and short. Avoid em dashes and promotional copy. Use dates, named sources, concrete work and actionable verbs. The app itself should feel quiet when everything is on track. Most actions should require one or two clicks. Ship morning deliverables in this order:

1. A polished and persistent dashboard with a working source-change-to-decision flow.
2. Real planning, accountability, follow-up and resume behavior, accessible from the dashboard.
3. Memory, review council and tested skills with one complete learning loop.
4. A Claude provider and integrations with honest connection states. Advance each as far as the environment permits.
5. Voice advisor room, richer automation and finishing touches. Keep going after the first milestone if resources permit.

**Finish line for the night.** From a clean checkout I can install, launch, open Today, replay a new bulletin, see exactly one updated assignment, inspect why it moved, accept or defer one recommendation, refresh, and see my decision preserved. I can test the rest of the system without linking personal accounts. If credentials are available and authorized, separately demonstrate one read-only live journey. Never describe fixture or replay output as a live check.

## 2. Architecture and how to spend the night

Use React, strict TypeScript, Tailwind, shadcn/ui where helpful, Lucide, Zod, and server-side application logic. Default for a new repo: Next.js App Router with a Node runtime, using route handlers and a small worker sharing domain functions. If an existing React/Vite app has a server, keep it. Claude is the only generative AI provider in scope. The dashboard may run locally in a browser. Also supply concise setup instructions for using Claude as its conversational front door. Claude Code builds Jarvis. Cowork schedules, account-level connectors, Claude mobile, and a standalone application's API are different surfaces. Document which surface runs each capability.

Use a durable, local SQLite store for the zero-account build. Verify the chosen driver against the installed Node version. Local text search and Markdown links work before embeddings. Keep live persistence behind the same domain operations so an optional Supabase/Postgres backend can reuse semantics. Prefer implementing and verifying the Supabase migration and RLS policies after the local end-to-end flow works. Use unique per-user indexes and ownership policies for all operations, including join tables and storage objects if used. Scope every server query and mutation to the authenticated owner. Keep service credentials server-side. In local single-user mode bind to loopback and reject unexpected origins on mutations. Any remotely shared preview uses synthetic data only until authentication and isolation are tested. Pick a separate data directory per mode. Default demo reset touches demo data exclusively.

Start the app early and keep it runnable. First build one task, one versioned source, one decision and a real action button. Then flesh out the design. Add each specialist to the same data model. Treat fixture providers as implementations of the same input contracts as live providers. An offline council can replay an explicitly labeled sample for the fixture essay. If a user pastes a new essay with no Claude provider, show the exact missing setup and offer a real rubric checklist; a canned verdict on arbitrary text is a bug.

Maintain PROGRESS.md with the current command, last working milestone, next test and outstanding dependency. At major milestones run typecheck and a targeted test; periodically run the production build and browser journey. Preserve partial progress in files if context compacts or the session hits a limit. Use feature branches if the existing workflow warrants it. Deliver local modifications or use the coding platform's normal private task branch. No public hosting, purchases, external messages or real student submissions as part of the overnight build.

## 3. Pinned upstream references, selected for this build

These three checkouts were downloaded and their relevant directories inspected when this brief was prepared. Fetch just the selected paths into a temporary directory outside the project. Keep upstream code, licenses and origin information identifiable wherever code is reused. Inspect per-directory licensing. Add a short UPSTREAM.md listing what was actually read or adapted, the pinned commit, license where applicable, destination and local changes. Some demo code is educational and uses older SDK defaults. Let installed TypeScript definitions and current official docs govern implementation.

| Source and exact revision | Inspect | Jarvis adaptation |
|---|---|---|
| [Anthropic Agent SDK demos](https://github.com/anthropics/claude-agent-sdk-demos/tree/826b268506a5f3707623c9e6140b200befcbebae) | hello-world/hello-world.ts, simple-chatapp/server/, research-agent/README.md | Learn the request/stream/session boundary and specialist delegation. Implement a typed server-only adapter with domain tools. The demos include powerful shell/edit permissions and an in-development mail assistant. Give the Blackboard monitor only scoped read tools. Research-agent is a Python reference in this revision; keep the product TypeScript. No repo-wide license was visible at this revision. Use architecture as a reference and write original implementation unless permission to reuse specific files is established. |
| [Anthropic Skills](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator) | skills/skill-creator/SKILL.md, references/schemas.md, LICENSE.txt | Reuse the evaluation structure and compare baseline vs candidate. Use Jarvis-specific triggers, fixtures and capability restrictions. Read the skill's own license. Do not ingest unrelated document-processing skills. |
| [Obsidian Skills](https://github.com/obsidianmd/obsidian-skills/tree/b110b2f8e9eb1f287892f937050dfd40af862cbb/plugins/obsidian/skills) | obsidian-markdown, obsidian-bases, json-canvas under plugins/obsidian/skills/ | Adopt interoperable frontmatter, wikilinks, Bases and Canvas conventions. Write a Jarvis vault exporter and round-trip tests. The app works without the Obsidian desktop app or a paid sync account. Keep the MIT notice for reused material. |

**Reproducible fetch.** Execute this shell block from the coding environment if GitHub is reachable. It creates a fresh temporary workspace per invocation. Use the printed directory only as a reference. Do not execute downloaded hooks, demo environments, or skill scripts just to inspect them. When GitHub access fails, proceed with the contracts in this document.

```bash
set -eu
refdir="$(mktemp -d)"
fetch_reference() {
  slug="$1"
  rev="$2"
  shift 2
  dest="$refdir/${slug##*/}"
  git init -q "$dest"
  git -C "$dest" remote add origin "https://github.com/$slug.git"
  git -C "$dest" sparse-checkout init --cone
  git -C "$dest" sparse-checkout set "$@"
  git -C "$dest" fetch -q --depth=1 origin "$rev"
  git -C "$dest" checkout -q --detach FETCH_HEAD
  test "$(git -C "$dest" rev-parse HEAD)" = "$rev"
}
fetch_reference anthropics/claude-agent-sdk-demos 826b268506a5f3707623c9e6140b200befcbebae hello-world simple-chatapp/server research-agent
fetch_reference anthropics/skills e4bb5d960d87126ff3b3a8af1a104b7db67560ba skills/skill-creator
fetch_reference obsidianmd/obsidian-skills b110b2f8e9eb1f287892f937050dfd40af862cbb plugins/obsidian/skills/obsidian-markdown plugins/obsidian/skills/obsidian-bases plugins/obsidian/skills/json-canvas
printf 'Pinned references available under %s\n' "$refdir"
```

Additional implementation references: [chief-of-staff cookbook](https://platform.claude.com/cookbook/claude-agent-sdk-01-the-chief-of-staff-agent), [Agent SDK for TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript), [skill authoring and evals](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), [Anthropic multi-agent architecture](https://www.anthropic.com/engineering/multi-agent-research-system), [Obsidian storage](https://obsidian.md/help/data-storage), [BU Blackboard notification settings](https://www.bu.edu/tech/services/teaching/lms/blackboard/ultra/blackboard-profile-and-personal-settings/), [Cowork scheduling](https://support.claude.com/en/articles/13854387), [Claude Dispatch](https://support.claude.com/en/articles/13947068), [Claude Voice](https://support.claude.com/en/articles/11101966), [Claude Code cloud](https://code.claude.com/docs/en/claude-code-on-the-web). Check docs before making capability claims. Skip framework shopping once the core choices are made.

## 4. The first five minutes with Jarvis

Create a clearly labeled example workspace with a controllable demonstration clock and a blank private workspace for real use. Allow switching without data leakage. Use a reproducible fictional term week, timezone America/New_York. Provide a small “Replay update” control under the source status, or a first-run guided action, that uses the normal import pipeline.

1. At 08:00 on Monday, November 16, 2026, the fictional SS201 assignment “Argument and primary sources” is due Friday at 17:00 Boston time. A syllabus reference identifies the assignment. Two demo class events and one team meeting occupy part of the week. No assignment is submitted.
2. Replay an explicit instructor announcement posted Monday at 09:10. It moves the same essay to Wednesday, November 18 at 17:00 and requires a printed excerpt of articles 4, 13, 16 and 31. One obsolete syllabus and a duplicate copy of the notification remain available.
3. The change detector updates the same assignment, preserves both dates and both source versions, creates one decision, and shows “Moved up 2 days.” Add a synthetic bibliography source and requirement to bring the excerpt. Replaying twice changes no counts.
4. In the recommendation drawer, show the old/new due date, source quote, impact on existing plans, best available work block and one alternative. “Reserve” creates a local proposed or confirmed block depending on the explicit action and integration mode. Distinguish a local block from a Google Calendar event. “Defer” asks when. “Already handled” preserves the evidence trail.
5. The student opens the essay, requests ideas, chooses one direction and invokes Council. Show evidence, disagreement and one prioritized revision. Student says, “You missed the printed excerpt last time.” Run the learning workflow described below. Save progress and resume after reload.
6. A second fixture is a biology exam announced 18 days in advance. Assume two known weak areas, carrier-frequency problems and X-linked crosses. Schedule spaced practice and retrieval checks around existing commitments. A practice result changes the next milestone and stays visible in history.
7. A third fixture is a registrar email promising an answer by Friday. Send status is a fixture event. The follow-up remains open while the outcome is pending. Simulate a reply in the same thread, then a correction visible in the student record. Show the difference between receipt of a reply and resolution of the issue.

## 5. Interface direction and interaction design

Build a cohesive private workspace with dark graphite surfaces, off-white text, one restrained cyan or mint accent, and amber for changes needing attention. Use typography and alignment for hierarchy. Pick one readable sans such as Geist or Inter, and a narrow use of monospace for times and source metadata. A tasteful faint orbital motif on the active Jarvis control is enough. Keep data displays crisp. No neon on every card, filler badges, stock dashboards or wall of identical tiles.

Desktop: compact navigation rail on the left, main timeline and current action in the center, decisions panel on the right. Suggested order: Today, Tasks, Goals, Completed, Memory, Skills, Council; group settings, sources and activity in a secondary menu. Follow-up and meeting views can live under Tasks. Mobile: prioritize Today, Decisions, Capture and a More menu. Decisions remain reachable within one tap. Use drawers or dedicated detail routes with browser Back support. Command palette opens with Cmd/Ctrl+K. Keyboard focus is visible. All drag actions have button alternatives. Honor reduced motion, use meaningful labels on icons, and test contrast.

Today should lead with the next useful block, suggested task, available minutes and one primary action. Below: today's calendar as a vertical timeline, then changes since the last verified scan. Show a source-health line with separate timestamps per source. Show loading, empty, denied, offline, stale, running, partial and retry states where relevant. Every visible enabled control must perform an observable action. Persist edits and confirmations across refresh. Give long-running actions progress, cancellation or a way to leave and return.

Goals: show actual progress, target-to-date and deadline side by side. Example “4/10 conversations · 5 planned by today · 6 weeks left.” Support count, milestone and outcome goals. Define pace from the goal's own milestones, or label a linear estimate explicitly. Completed: group by date, filter by course and show what evidence closed the item. A draft, a user's completion and a submission receipt are distinct events. Reopening is supported.

Add quick actions for “I have 20 minutes,” “Resume,” “What changed?”, “Bring in the council,” and “Capture a promise.” Keep the home screen calm by hiding rare controls behind relevant details. Build a small connection drawer showing verified capabilities and a one-click health check.

## 6. Domain and persistence contracts

Design the minimum tables needed around these records. Merge tables when the lifecycle and ownership are identical. Use durable IDs and migrations, referential integrity, UTC instants plus IANA zones and explicit all-day dates. Preserve original timezone and source timestamps. A fake clock makes all seed journeys deterministic.

| Record | Data and invariant |
|---|---|
| Source and revision | Owner, provider, external ID, canonical URI, version/hash, observed time, published time, pointer to evidence, freshness and scope. Imported content is untrusted data. |
| Assignment/task | Stable task ID, project/course, origin mapping, status, due history, estimated effort, earliest/latest start, next step, completion evidence. Assignment title alone cannot establish identity across courses. |
| Schedule block | Start, end, timezone, protected/available/proposed/booked, source and revision. Check collisions again just before reserve. |
| Decision | Trigger and dedup key, affected task, options, evidence, urgency, expiration, action state. Double-clicks and retries cannot duplicate writes. |
| Commitment | Who owes whom, original agreement, due date, last contact, next check and resolution evidence. |
| Run and delivery | Initiator, run ID, role, input revision, started/finished, provider mode, usage, status, failure reason and retry key. Notification delivery gets a unique event/channel key. |
| Memory | Note ID, owner, kind, scope, source, effective dates, sensitivity, confidence, superseded-by, explicit user edits and tombstone. |
| Skill and evaluation | Version, trigger, permitted capability IDs, baseline, candidate, fixture inputs, score, last activation and rollback target. |
| Council session | Question, rubric/source bundle, review responses, final findings, evidence for each point and outstanding disagreements. |
| Goal and checkpoint | Target, unit, start/deadline and pace model; track observations separately from commitments. A resume checkpoint stores document, section, unresolved question and next step. |

Use typed inputs and validated outputs for import, run, review, decide, learn, recall, export and delete operations. Treat timeouts and cancellations as first-class. Atomic writes must cover source reconciliation and decision emission. Use an outbox or equivalent to recover pending delivery. A failed source fetch cannot overwrite its last successful snapshot with an empty result. If two sources conflict, distinguish “explicit later announcement changes this date” from “two records disagree.” Ask the user to resolve the latter. Keep source excerpts short and relevant.

## 7. Chief of staff and specialist responsibilities

One conversation with Jarvis. One persisted record for each piece of work. The coordinator may delegate independent reasoning tasks and route results to the next specialist by ID. Specialists return findings, evidence, decisions required, proposed changes and cost metadata. A validated domain service owns database writes. Avoid letting agents freely message each other indefinitely. Recurring scans and simple scheduling calculations are deterministic. Invoke Claude when interpretation, drafting, synthesis or critique adds value.

- **Blackboard monitor.** Ingest exported announcements, calendars, assignment text/attachments and authorized email notifications. Compare revisions, detect new tasks and moved deadlines, flag physical deliverables and bring/print/sign/upload instructions. Link back to course and source. Add a read-only live route when supported. A partial check updates the corresponding source status only.
- **Academic planner.** Convert each rubric into required deliverables and checkpoints. With 18 days, propose diagnostic practice, targeted sessions, a timed mixed set and a last review. Make milestones demonstrable (“solve five carrier problems unaided”). Changes in measured mastery or available time update remaining milestones. For essays, offer two one-sentence thesis directions with evidence needed, an outline and optional rough drafting consistent with applicable course instructions. Show unknown requirements and ask about drafting when appropriate. Submission remains the student's action.
- **Capacity planner.** Find feasible blocks using duration, priority, dependency, deadline, buffer and protected events. Calculate latest safe start by allocating effort backward into actual free blocks. If work cannot fit, show the shortfall. Before accepting a new commitment, surface the displaced work and two realistic alternatives. Include commute/setup buffer where configured. Keep the calendar flexible.
- **Goals and accountability.** Record only promises the user accepts. Compare planned versus actual duration, start and completion. Allow “blocked,” “deferred,” “estimate was low,” and user-entered reasons. Keep original plans when revising. Weekly review highlights one adjustment backed by evidence. Do not invent effort from a calendar block.
- **Follow-up and meetings.** Find promises in authorized threads and user debriefs. Link replies and track owner. Prepare a brief from the last exchange, one objective and two questions. After a debrief propose owned actions, due dates and exact follow-up text. Default to drafting. Never claim a sent message without delivery acknowledgment.
- **Resume and blind spots.** Save a checkpoint when a task pauses. A 22-minute request returns the exact document and section plus one finishable step. Weekly scan connects neglected goals, deadlines with no feasible preparation blocks, and unanswered commitments. One source and one feasible next move per finding.
- **TAMID/consulting/founder routing.** Use the same records for team dependencies, investment theses, outreach and product experiments. Investment reviews distinguish company-reported inputs, external estimates and assumptions; include period, unit and source. Startup advice ends in a falsifiable experiment. Avoid adding separate apps or duplicating workflows.

## 8. Memory that grows with Yonathan

A person should be able to inspect why Jarvis remembered something and remove it. Store durable knowledge in portable Markdown with frontmatter and wikilinks. Standard folders: Inbox, People, Projects, Courses, Decisions, Preferences and Skills. Keep sources, short evidence pointers and stable IDs. Render Map, Timeline and “What Jarvis learned.” Center maps on the selected topic; let users traverse neighbors, inspect backlinks and search. Provide a text list alternative to the graph.

Distinguish explicitly stated preference, observed habit, inference, project fact and date-sensitive commitment. “Protect Shabbat” can be a persistent cross-project scheduling preference. “Leaning Sydney” is a dated preference. “One sentence per outline point” is scoped to the relevant assignment. Uncertain inferences stay provisional. Explicit corrections override inferences. A changed preference supersedes earlier versions so historical decisions still make sense. Users can edit scope, expiration and confidence or disable automatic learning for a topic.

Use simple filename/title/alias and full-text lookup first. Rank by scope, recency where relevant and source quality. Include a “Why did you use this?” drawer on recommendations. Introduce Pinecone only behind an optional index if it improves held-out retrieval on actual questions. The vault/source store remains authoritative. Handle updates, deletion from all derived indexes and failed index rebuilds. Record timestamps and support a private session toggle before recording. Private reflection sessions default to ephemeral; exclude content from logs, analytics, searches and skill generation unless the user explicitly selects something to save.

Implement a round trip: create note in app, export or write an Obsidian vault, edit Markdown outside app, import it back, preserve ID and backlinks. Detect conflicting edits. Constrain vault writes to the configured directory, including symlinks. A generated .base or .canvas overview is a useful addition after Markdown and backlinks work. If using cloud Jarvis with a local vault, expose the exact sync/bridge state. Avoid claiming cloud workers can read a sleeping Mac.

## 9. The skill that writes better skills

After each completed task or explicit correction, launch a cheap reflection: did the user supply a one-off fact, correct the source record, or teach a reusable procedure? Fix the current task first. Store facts as memories. For recurring procedures, prefer a new version of the most relevant skill. Each candidate defines its narrow trigger, required sources, allowed tools, instructions, desired outputs, evaluation fixtures, and exclusions. Keep generated skills as versioned text instructions in an application-managed directory. Initial capability list is immutable across automatic revisions. New executable code, broader permissions and outbound actions require separate review. Source documents cannot authorize new skills.

Build one full automatic improvement loop for “pre-class brief.” On correction “You missed that this needs printing,” generate a candidate that checks required materials. With no model, support this as a labeled deterministic local transformation. Test it against (a) explicit printed excerpt with four article numbers, (b) upload-only submission, (c) optional print suggestion, and (d) a later announcement waiving the print requirement. Add one unrelated task to catch an over-broad trigger. Run baseline and candidate on the same cases. Score exact quoted requirement, correct mandatory/optional status, source pointer and false positives. Promote automatically only for a scoped, capability-preserving candidate that passes the new case and has no regressions on previously passing cases. On ties or mixed results keep it as a candidate. Record versions, scores, failures and rollback. Repeat the original task and verify changed behavior on its normal entry point.

Show which skills ran, why, what changed since the last version and when Yonathan last corrected them. If it helps, expose a compact diff. Track corrections per use over comparable tasks. A count of generated skills is a diagnostic, not a productivity outcome. Keep faulting candidate skills quarantined and avoid self-triggering reflection loops. Implement “Teach Jarvis once” from a task and from voice/text capture.

## 10. Council, advisor library and voice

An essay review can use five seats: Advocate, Skeptic, Rubric Reader, Evidence Checker and Editor. First four see the same draft, instructions and source excerpts independently; they cannot read one another's first pass. Each returns the passage, finding, severity, evidence pointer and suggested change. Advocate identifies the strongest defensible reasoning. Skeptic identifies the most vulnerable inference and what would rescue it. Rubric Reader maps explicit requirements to passages. Evidence Checker verifies what the attached sources can establish. None is required to invent praise or criticism. Editor receives anonymized findings and resolves them by evidence, preserves material disagreements, then shows a decision: strongest passage, highest-impact fix, uncertainty and best use of the user's available minutes. Collapse debate under “Hear disagreement.” If human feedback comes back, compare it to the original findings and test any proposed improvement.

Council presets: essay, investment pitch and founder decision. For pitches, replace rubric with valuation and ask about sensitivity, unit consistency and input dates. For founder decisions, use customer, operator and skeptic lenses. Limit rounds, runtime and tokens per turn. Stop if sources are insufficient or repeated rounds add nothing. Agreeing outputs from a single model do not establish independent factual corroboration. Support interrupt/cancel with partial results clearly marked.

Advisor library: begin with user-selected, lawfully accessible primary sources, such as a public interview, authored article or user-provided notes. Track title, speaker, date, source URL, excerpt locator or timestamp and usage rights. Show ingestion failures, duplicates and transcript gaps. Store short relevant excerpts and source pointers. Avoid indiscriminate scraping, private/paywalled copying and fabricated quotations. A Hormozi-inspired offer advisor is an analytical lens on published work. Clearly label direct quotations, paraphrases, Jarvis's application and missing evidence. If there are no verified Hormozi sources, invite import and ship a generic offer-design lens with original sample material in the meantime.

Design a voice room in which Yonathan chooses one or two lenses, asks a question and interrupts naturally. One speaker at a time, short turns, source drawer, transcript, stop, mute, choose-next-speaker, and “turn that disagreement into a test.” Provide text parity. Try browser speech synthesis first for labeled playback, with explicit user initiation. If capture uses a browser speech service, disclose the service/data path before microphone access; feature-detect availability, provide hold-to-talk, stop tracks when the room closes, and allow transcript correction. No automatic recording or voice imitation. Claude mobile voice is an alternative front door when available; a custom web room cannot silently control the Claude app. Write out the supported path.

Private reflection room: two clearly identified AI perspectives can support reflection and help organize questions for a licensed professional. No impersonation, diagnosis, medication recommendations or claims to provide therapy. Default the room to transient text and no saved audio. No automatic writeback to long-term memory or council history. “Save this one takeaway” requires deliberate selection.

## 11. Connections, schedule and notification delivery

Build the imports first so the product is useful with existing files. Include plain text and Markdown, a documented JSON source bundle, calendar .ics import with timezones and explicit unsupported cases, and a practical notification email import (.eml or pasted text). Handle malformed data, attachments without text, duplicate IDs and oversized uploads. Preview parsed results before commit. For PDF or HTML support use existing well-maintained parsers, extract inert content and preserve page or section pointers. Display unsupported formats visibly.

Model live adapters separately: calendar read; notification email read; Blackboard authenticated browser read when available; Claude inference; optional push or messaging. Each must have a connection test and source-specific freshness. Implement a usable read-only connector when authorized credentials exist. Otherwise provide a working import path, exact minimum setup steps and a tested adapter contract. Never treat a signed-in Claude connector as a credential automatically available to arbitrary Node code. If exposing Jarvis to Claude, offer a small opt-in local MCP server with typed read tools such as today, changed_tasks, source_status and get_evidence, and a bounded propose_decision tool. Support an SDK/client smoke test and document an actually supported transport. A remote MCP deployment requires authentication and explicit deployment. A localhost URL by itself cannot serve as a public mobile connector.

Blackboard: use BU's supported sign-in. Yonathan enters credentials and completes any Duo challenge in the official flow. Do not ask for his password in chat, write it into a vault or scrape/export browser cookies. A fresh sign-in pauses only that adapter. Use calendar, notification email, hand-selected exports or a user-authorized browser session as available. Source-specific success matters: “Email checked 08:00; Blackboard last verified yesterday 16:05.” Never infer that checking mail establishes all coursework was checked.

Schedule morning and afternoon checks at configurable defaults 08:00 and 16:00 America/New_York. Weekly review can be Sunday afternoon. Treat dates in the user's current configured location, account for DST, prayer blocks, Shabbat boundaries and travel. Let the user enter verified protected intervals; when local Shabbat times are unknown, support user-entered quiet periods and avoid claiming precise religious times. Queue quiet-period updates for later. Surface missed cycles, catch up once after downtime, deduplicate by source revision and local scheduled occurrence. Implement and test “Run now,” pause and simulation with injected time. For unattended operation provide a real process command using persistent storage, or a documented Cowork scheduled-task setup bound to the appropriate connectors. An in-browser interval does not count as unattended execution. Only mark scheduler active when a worker heartbeat or verified platform schedule supports that claim.

Three delivery levels: interrupt now if the decision expires before the next brief, include in next brief, or update silently. Explain each urgent classification. Add “That could have waited” with narrowly scoped learning. Prefer a single morning brief and delta-only afternoon update. The in-app inbox must work offline. Describe native Claude Dispatch/mobile notifications for supported Claude sessions separately from a custom app notification channel. Do not fabricate a Dispatch API. For actual SMS or Web Push, implement opt-in with a configured provider, explicit recipient confirmation and a test-send action initiated by Yonathan. Record delivery receipt when available. Do not send test messages while developing. Use a local capture sink for automated tests.

## 12. Contracts, reliability, and test data

Practical command intents to support via buttons plus plain-language input: today, what changed, time available, resume project, teach correction, recall source, prepare meeting, capture promise, review with council, discuss with advisors, show pace and forget. With no model, a small deterministic dispatcher for documented commands is sufficient if the UI labels its mode. In Claude mode validate typed tool arguments and recheck ownership. Do not send the user's entire vault to every agent. Assemble the smallest relevant source bundle. Separate quoted data from instructions. Persist identifiers and short decision explanations; omit raw private conversations from operational logs.

Use bounded retry with jitter, timeouts, rate-limit handling, cancellation and per-run turn/token limits. Read application cost limits from configuration. Avoid infinite loops, boot-time paid model calls or repeated council runs on a duplicate import. Provide per-run provider, elapsed time, model when known and measured usage when supplied. If cost is an estimate, label it. Unsupported credentials should leave the app launchable. Validate all request and connector payloads with Zod; handle network disconnect and stale versions explicitly. Store secrets in environment/approved secret storage. Include .env.example containing variable names and descriptions, with no real values.

Use this **synthetic input bundle** as a canonical fixture. Map it through your normal ingestion code. IDs, relative logic and expected outcomes must remain reproducible independently of the actual date when the app opens.

```json
{
  "schemaVersion": 1,
  "mode": "example",
  "timezone": "America/New_York",
  "clock": "2026-11-16T10:00:00-05:00",
  "assignment": {
    "courseId": "example-ss201",
    "externalId": "essay-2",
    "title": "Argument and primary sources",
    "originalDue": "2026-11-20T17:00:00-05:00",
    "effortMinutes": 120
  },
  "revisions": [
    {
      "id": "syllabus-v1",
      "publishedAt": "2026-11-01T08:00:00-05:00",
      "text": "Essay 2 is due Friday, November 20 at 5 p.m."
    },
    {
      "id": "announcement-17",
      "publishedAt": "2026-11-16T09:10:00-05:00",
      "text": "Essay 2 is now due Wednesday, November 18 at 5 p.m. Bring a printed excerpt of articles 4, 13, 16 and 31."
    }
  ],
  "calendar": [
    {"title":"Spanish class","start":"2026-11-17T09:00:00-05:00","end":"2026-11-17T10:00:00-05:00"},
    {"title":"Science class","start":"2026-11-17T10:45:00-05:00","end":"2026-11-17T12:00:00-05:00"},
    {"title":"SM team meeting","start":"2026-11-18T15:00:00-05:00","end":"2026-11-18T16:00:00-05:00"}
  ],
  "promise": {"who":"Example advisor","owedTo":"Yonathan","action":"Check transfer credit","dueDate":"2026-11-20"},
  "goal": {"name":"Networking conversations","completed":4,"targetToday":5,"targetTotal":10}
}
```

Include a seed-once command, deliberate demo reset, export/backup and tested reload behavior. Keep demo and personal environments visibly distinct. A source event must be traceable from the evidence drawer through decision, approved action and resulting task history. Use concise, anonymized fixture content for screenshots.

## 13. Verification and definition of done

Implement tests through the normal domain and UI entry points. Provide one repeatable verification command. Prioritize the core path before optional features, then extend coverage. Report actual commands, failures, repairs and any untested surface. A mocked provider can establish application behavior, never real-account connectivity.

| Test journey | Passing behavior |
|---|---|
| Boot on clean machine | Documented package install, migration, seed and launch work without personal accounts; production build succeeds. |
| Repeated or concurrent scan | Apply the same announcement twice or via email and source import. Exactly one changed task and one pending decision. Original source and revision history retained. |
| Competing/withdrawn info | Explicit correction supersedes old requirement. Ambiguous conflicting date stays unresolved with both sources visible. |
| Approve and retry | Double-click reserve, refresh, retry. One block only. A new conflict detected before write sends the user back to choose a slot. |
| Deadline planner | Split 120 minutes over valid blocks. A protected interval stays empty. When insufficient time remains, display real shortfall. |
| Accountability | A deferred task keeps the original promise. A replied-to ticket stays open until resolution. A draft cannot generate a submission receipt. |
| Memory round trip | Create, link, export, externally edit, reimport, supersede and delete. Search and backlinks update. Private-room content is absent from search and logs. |
| Council | Four independent initial reviews plus editor; each material claim has source support or an uncertainty label. Cancellation and missing-source states work. |
| Skill creation | User correction fixes current task. Candidate beats baseline on the new case, passes regression cases, activates narrowly; rollback restores prior behavior. |
| Notifications and scheduling | Quiet hours defer delivery. Retry sends once. A failed Blackboard check retains its previous successful verification time. App closed with worker running still allows schedule execution; if no worker, status says so. |
| Ownership and storage | Cross-user access denied in hosted backend tests; local demo reset cannot touch personal files. Reject invalid paths and malformed payloads. |
| Visual QA | Exercise desktop around 1440×900 and phone around 390×844. Check task detail, right drawer, keyboard navigation, scroll, long excerpts and text overflow. Save screenshots from the running app. |
| End-user usability | Navigate Today → changed essay → evidence → reserve → resume → council → correction → skill history entirely through the UI. Verify each working state after refresh. |

Budget time for a real browser walkthrough. Use Playwright or available browser tooling and inspect at least one desktop and one mobile screenshot. If browser tooling is genuinely unavailable, run server/API tests, record the gap and avoid claiming visual verification. Fix visible defects before adding features. A screenshot, static design, feature list or successful typecheck alone does not establish end-to-end behavior.

## 14. Morning handoff and recovery

Leave a concise MORNING.md at repo root with verified location of the app/branch, install and launch commands for macOS, localhost URL or authorized private preview, screenshot paths, first five clicks, source status, and stopping condition. Include a capability table labeling each feature as “works locally,” “tested with fixture,” “live verified,” “implemented, needs connection,” or “unfinished.” State exactly which tests passed and which provider checks were skipped. Include the next dependency for each incomplete feature. Make the app's first screen usable even when a user never opens MORNING.md.

Include one connection checklist with actual steps in the built app: import one real syllabus; connect or import calendar; enable Blackboard email notifications or use an authorized browser path; configure the Claude model provider if desired; configure worker hours and quiet periods; enable mobile delivery; test with a single benign change. Include disconnect, pause and erase/export controls. Schedules and outbound alerts should remain off for real accounts until deliberately enabled. A demo clock can run immediately.

End your build response with (1) where to open it, (2) the first action to try, (3) verified outcomes, and (4) the few things requiring Yonathan's account or decision. If stopped by limits, preserve a runnable core and leave an exact continuation command. Do the implementation and checks before writing the handoff.
