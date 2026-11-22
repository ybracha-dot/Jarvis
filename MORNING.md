# MORNING

Branch `claude/upbeat-cannon-wf5kxf`. No pull request. Sections, newest first: **Reader field check: quantities and who submitted** (this round), **Let Claude read the notes, and make completion verifiable**, **Project scope fix and the handoff table**, **Field test: finish the calculation before drafting**, **From finding evidence to finishing the job**, **Next build: a general assistant**, **Redesign build**, **Addendum build**, **Overnight build**.

# Reader field check: quantities and who submitted (latest)

Baseline `48a54b7` (the commit the field check reproduced on; the tip was unchanged when I started). Paid model calls stayed off (zero model calls). Everything here is synthetic.

## Fix 1. A real quote could accompany an invented number
- **Before (first output, saved):** two isolated copies of the rooftop project, a REAL local stdio connector process, a second client reopening the result. Input A “Print the programmes” and input B “Print 400 programmes” (same real quote, no count anywhere): **both accepted, both Finished**, and the 400 stayed in the saved row. (`/tmp/claude-0/readerfix/repro-FIRST.json`.)
- **After:** B is rejected with ““Print 400 programmes” says 400, but none of the passages you cited states 400 programmes for Mateus Oliveira. Remove the number from the action, or cite the passage that states it.” Nothing from it is saved; A is accepted and Finished; a second client reopens the same result with the two rows. In the app, the saved result contains no “400”.
- **The rule (independent of printing, names and projects):** a number in an action or blocker must be stated by a passage that update cites, for the same unit (“400 programmes”, “12 pallet racks”, “Room 12”), about the same owner (a passage naming someone else does not count), and not replaced by a later passage. A number elsewhere in the project gives no support (the message says so). “400”, “four hundred”, “1,200”, “a dozen”, “twenty-five” are equivalent; dates, times and years are not quantities. Rejected content never reaches a saved row; an earlier accepted version is kept when a later submission fails.
- **Paired regressions** (`tests/reader-quantity.test.ts`): omitted, supported (five phrasings), invented, a number belonging to a different item or a different person, a later correction replacing an earlier quantity (stale rejected, new accepted), a number in a blocker, and preservation after a failed submission. The real connector run is `tests/reader-connector.test.ts`; a browser journey step checks the rejection and that the result never shows it.
- **New project, wording and numbers unlike the fixtures** (`tests/reader-fresh.test.ts`), expected results written before the run: 6 of 6 matched on the first valid run (accepted: “forty-eight folding chairs” citing the correction, “Print the menus”, “Rent 2 marquees” for “two marquees”; rejected: the replaced 36, an invented 60 menus, a chair number attributed to the wrong person). My first harness reused one project for all six, so five were masked by duplicate handling and I did not count them; the valid run used a fresh project per reading. These cases are now regressions, not measurements.

## Fix 2. Report what the connector actually observed
- **Before:** an accepted reading from a local SDK client was reported as “A Claude chat has submitted a reading that Jarvis accepted.”, stored client null; the card repeated it.
- **After:** three separate observations on the Connections card, and the result page, mode and result metadata use the same words:
  1. **Tool call**, as Jarvis saw it: “Reading accepted through the local connector.” (stdio) or “…through the HTTP connector.”, plus “The client reports itself as “X” (self-reported)” or “reported no name”, plus “That name looks like a test client” when it does. The app's test endpoint says “a simulation, not the connector”; automated tests say “a simulation”; rows saved before this change say “origin not recorded”.
  2. **Your confirmation**: empty until you press **I ran this in my own Claude Desktop** (offered only for a connector reading; a simulation or unknown origin cannot be confirmed).
  3. **Saved reading**: Jarvis's own result of the notes (Finished / partial, per-part detail).
- Migration 10 adds the origin, transport and confirmation columns; nothing in older rows is rewritten. The connector now carries the transport and the client's initialize name into tool calls, for stdio and HTTP.
- Verified through the real app: a running server, a REAL stdio connector process (client name “claude-desktop-stand-in”), then the browser on Connections and on the saved result (`/tmp/claude-0/readerfix/app-connector.json`): the rows, “Finished”, the self-reported name, no “Claude account” claim, no 400, the confirm button, and the confirmation appearing separately after the click.

## What ran
- 340 unit tests (30 files), typecheck, production build, and the full browser suite: 338 checks, 0 problems. Real-process checks: the stdio connector (unit test) and the stdio-plus-browser run above. The HTTP connector route has its own test. Not run: anything in your Claude account.

## Still needs you (live pilot, pending)
Steps are in the field-check note you pasted (new build, `npm ci && npm run dev` plus `npm run worker`, the `jarvis-reader-demo` entry in Claude Desktop's config, the example workspace). Then: Connections → Let Claude read your notes → Create a shareable test project; send the prompt in an ordinary Claude Desktop chat; open the returned link; in a fresh chat ask `get_result` for the same ID. *A passing pilot:* the card says “Reading accepted through the local connector” with a client name Claude reports, the two correct rows, no programme count, the power-plan blocker cleared, both chats showing the same result. Press **I ran this in my own Claude Desktop** to record your confirmation; until you do, Jarvis will not call it your account. The earlier frozen baseline stays: 3 of 6 usable first attempts on the simulated Claude path.

# Let Claude read the notes, and make completion verifiable (previous)

Baseline `507c465`. Paid model calls stayed off in every run (zero model calls). Everything below is synthetic.

## Your first prompt for your own Claude account (the live test is **pending** until you run it)
Open **Connections → Let Claude read your notes → Create a shareable test project** (two invented notes, marked shareable; your own notes are untouched), then paste the card's prompt into a Claude chat that has the Jarvis connector. It reads:

> Use my Jarvis connector. I want a handoff for the Jarvis project “Claude reader test: rooftop concert”: what does my team still owe? Do this in order. (1) Call submit_goal with project “Claude reader test: rooftop concert” and the text “What does my team still owe? One row per open item with Owner, Next action and Blocker. Leave closed items out.” and note the requestId it returns. (2) Call get_reader_task with that requestId and read every passage; the newest note corrects the older one. (3) Call submit_reader_result with your updates (owner, action, status, blocker, exact quotes with their spanId) and a coverage entry for every passage. (4) If Jarvis rejects anything, fix it and resubmit; never invent a quote. (5) Reply with the Jarvis result link and the table Jarvis saved.

*Success looks like:* the card flips from “Live test pending” to “A Claude chat submitted a reading that Jarvis accepted (time, client name)” with a link; the result opens from **Today** with two rows (Ilse Brandt: set up the sound desk; Mateus Oliveira: print the programmes; both blockers cleared), a source link on each row, the mode “Claude-assisted”, and **Finished**. Tobias Quist’s lights and the stage barriers are shown as left out. The same link opens in a fresh chat via `get_result`. The client name is self-reported, so the card says “accepted a reading”, never “verified account”. If the connector is not added yet, add it first (Settings → Connectors) with the token on the same page.

## What was built
- **Local notes stay local.** Only notes imported as explicitly **shareable** are ever offered to Claude; local-only notes are withheld (the reply says how many, never what they say). Your existing notes keep their privacy setting. A new import option makes a shareable source.
- **Two connector tools** (existing auth): `get_reader_task` gives one request revision’s shareable notes as numbered passages with stable ids and a snapshot id; `submit_reader_result` takes structured updates (owner, action, status, blocker, due, how it changed, confidence, exact quotes with passage ids) plus what was done with every passage. `submit_goal` tells Claude the reader is available.
- **Jarvis keeps the authority to save.** It rejects (saving nothing, keeping any earlier result) a wrong schema, a stale request revision, notes that changed after the reading, an unissued passage, a quote that is not in its passage, a quote about someone else, a passage with no coverage entry, a passage set aside that describes work for someone with no update, a blocker a later passage clears, an item a later passage closes, duplicates, and a different second reading for the same revision. A replay returns the same version. It renders the table itself and saves it as a new version of the **same** result id; the earlier version is kept. Anything Claude marks uncertain or unresolved makes the result an honest partial, with the passage shown above the table.
- **Offline path.** A sentence that names someone who owns a task, or any passage in a correction that names a person, can no longer be skipped silently; it is listed and the job says it finished partly. The supplied regression (`tests/independent-showcase.test.ts`) fails on `507c465` and passes now with both rows, each cited to the correction.
- **Handoff offered where it helps:** a result the local reader could not finish shows either the exact prompt (shareable notes) or why Claude cannot be used (local-only notes) and what would resolve it.

## Verification
- **Written before any output was seen, in code:** the supplied regression; the Signal Hall scenario with a shareable source through a simulated connector: the correct two-row reading is accepted and reopened through the normal result page; a candidate that drops Leila, one that keeps her old blocker and one that attaches Amara’s quote to Leila are each rejected, with the earlier result untouched. Replay, stale revision, stale notes, invented quotes and local-only isolation each have a test.
- **Checks run:** 328 unit tests; the full browser suite on the final build, 336 checks, 0 problems, including a new journey (entry point, a rejected reading that saves nothing, an accepted one opened from Today, a local-only project that issues no task); typecheck; production build.
- **One real bug found by that browser run and fixed:** `/try` stamped the first note at noon of the chosen day and the correction at the server clock, so before noon the correction was dated before the original and was applied first. The first note now uses the current time when the date is today.

## Frozen evaluation on fresh notes (read once, before any tuning)
An independent agent wrote six fresh cases and their expected rows first, ran the same notes on both paths, and played the part of the Claude chat on path B. **This is not your Claude account and not Claude Desktop.** First attempts:

| | USABLE | HONEST PARTIAL | FALSE “FINISHED” | REJECTED by Jarvis |
|---|---|---|---|---|
| Path A, local reader (6 cases) | 0 | 3 | 3 (one stale row; one next action “Not stated”; two firm rows right but ambiguous items dropped silently) | – |
| Path B, an LLM reading, Jarvis validating (6 cases) | 3 | 1 (ambiguity surfaced honestly) | 0 among accepted results | 2, **both rejections wrong** |

- Path B’s two wrong rejections: a passage that only names a person with no task was refused as “unrelated”; and “delivery confirmed for Monday but nothing has arrived yet” was read as clearing a blocker. After one resubmit all six matched the expected rows, but one of those resubmits added an invented item to get past the first rule.
- **Tuned afterwards, so not re-measured:** both false rejections (a passage naming a non-assignee is now accepted with a visible note; negated or future “arrived/confirmed” does not clear a blocker), verb forms like “rewrite”, a trailing “but”, due dates shown in the Next action cell when there is no due column, and unplaced “needs to be set / maybe / TBD” passages now flagged. Regression tests cover each.
- **Honest reading of the numbers:** the local reader is still wording-limited (0 of 6 first attempts usable; it never invented a row but twice presented a stale one as final). The Claude path read all six correctly once Jarvis’s own rules stopped getting in the way. That is evidence about the validator, **not** about how well Claude reads your notes; only a live Claude chat can show that.

## Still needs you
1. Run the prompt above in your Claude account and tell me whether the card flips and the table is right.
2. Then try one of your real notes: import a **shareable** copy for the Claude path; the original stays local.
3. Real Blackboard and the earlier owner trial remain pending.

# Project scope fix and the handoff table (previous)

Baseline `4a3a7a4`. Paid model calls stayed off in every run (zero model calls).

**1. The project fix from the outside tester: applied as given.** The patch applied cleanly (`git apply --check`), with its four regression tests (all pass) and migration 8 (replay keys are scoped to the project; request and result IDs and links unchanged). The same words asked in two projects now give two requests, two results and two read logs; an unknown project name is an error before a request exists. Proven through the normal UI (`/try`, desktop) in the browser journey `handoff`: Lantern exhibit and Maple exhibit, same question text, both results opened, reloaded and reopened, each with its own table and sources, neither mentioning the other.

**2. The missing handoff table: reproduced, then repaired.** First failed result (kept, `/tmp` copy not committed): the answer quoted only the original note about Mara, left out Inez, was a paragraph, the read log listed one note, `outcomes` was empty and the receipt said **Finished**. Causes: retrieval ignored the linked correction (it shares no search words with the question), and no “table” outcome existed to verify.
- Linked corrections are followed in both directions and added to the read log (“added: your later correction …”); for “turn these notes into a table” the selected project’s notes are the material.
- The table is a requested outcome with its own check (columns as asked, every open task has a cited row, nothing completed or cancelled is in a row, no silently dropped sentence). **Finished** is only said when that check passes. Otherwise: *“Finished, but only partly done: …”*, with the part, the reason and what is missing. A sentence that names a person or task but cannot be read is listed under “Check these” and a banner above the table says the rows may be stale.
- Lantern now gives exactly: Mara | Send the proof | Waiting for the final photo credits; Inez | Book the label printer | None reported, each row linking both notes; Theo and the finished wall work are in “Left out or changed”.
- Same for the ordinary Claude connector’s local test client: `get_result` returns the table, per-row sources, the per-part status and the draft.

**3. Independent QA, four rounds, new people and wording each time. Honest tally of the FIRST attempt in each round:** round 1: 0 of 7 usable; round 2: 0 of 6; round 3: 1 of 12; round 4: 0 of 10. Each round’s wrong-or-stale findings were turned into regression tests and repaired (general verbs, “now with / handed to / falls to / taking over / covering for / swapped”, passive voice, cancellations, changed deadlines, shared owners, full and non-English names, unblocking and completion, “status table”, “numbered list by deadline”, “what’s on X’s plate”, “who is responsible for …”, an email-ready summary built from the list). The tests built from QA’s own notes pass, but they are **tuned**, so they prove those cases, not the general reader.
- **What this means:** the reader is rule-based and wording-limited. On wording it does not know, it now says so (“could not be read”, “partly done”, “none of the requested parts could be done”, a banner above any table built from partly read notes) instead of presenting stale rows. It will still miss tasks written in unfamiliar shapes. Round 4 showed it again. I stopped iterating on phrasings rather than keep tuning to each tester.
- **Known remaining gaps:** quantity changes (“now 14, not 12”), “only starts after X” dependencies, an ambiguous pronoun (“she will take it”), a task stated twice in different words, times of day as deadlines, and unrelated notes in the same project (they are read as project material: the answer lists “Built from these notes” so you can see it).
- **The realistic route to wider coverage** is a model-assisted reader for the same artifact, validated by the same checks. It is off (no key, no budget) and I did not build it.

**4. Checks actually run.** 310 unit tests; the full browser suite on the final build: 322 checks, 0 problems, including the two-project journey; typecheck and production build. The QA rounds ran against a disposable server and worker through the API; none opened the browser pages, which the `handoff` journey covers.

**5. Still needs you / not verified live.** (a) Run one real note with a correction at `/try`, ask for a table, and tell me which rows are wrong. (b) A person outside this session should try one more unfamiliar wording; I could not make my own QA rounds independent once I tuned to them. (c) Real Claude account round trip and real Blackboard remain pending as before. Synthetic, real-account and paid-model results are separate: this entry is synthetic only.

# Field test: finish the calculation before drafting (previous)

Checked against `f4f316c`, the commit the independent tester used. Both failures reproduced there exactly.

**First failed results (kept as regressions).** Request: *“Can one van get everyone to the archive by 10:30? Show when the last group arrives and draft a short reply to Jo.”*
- With the draft request: routed to the pitch-draft template. Result `kind: draft`, “To: (recipient not identified)”, “Hi there”, “the sources do not yet settle a date”, 0 sources, no calculation, marked ready.
- Without it: an extractive digest that quoted 08:40 → 09:00 but gave no last arrival and no feasibility answer.

**New result.** “No: 1 vehicle leaving 09:00 misses 10:30 by 10 minutes. The groups arrive at 09:20, 10:00, 10:40 (8, 8, 7 people), so the last 7 arrive at 10:40. Two ways to fix it: leave at 08:50 or earlier; or add another vehicle (the last group would arrive 10:00).” Three outbound legs and two returns; no final return is counted. The draft is addressed to **Jo** and uses those computed figures; nothing is sent. Changing only the departure to 08:50 gives an on-time 10:30.

**What changed, in general.**
- *Outcomes are tracked.* “Work out X and draft Y” is now split into parts (answer, figure, draft). Each part gets a status (done, partly done, not done) checked against the saved result: a draft counts as done only if it goes to the person named and carries the verified figures. The result page lists them under **What you asked for**, the job status says *“Finished, but only partly done: 1 of 3 …”*, and ordinary Claude’s `get_result` returns the same statuses and the draft.
- *Corrections apply to the fact they change.* The 09:00 update replaces only the departure; seats, drive times and the deadline keep their original citations. Number words (“eight seats”) work.
- *Missing input:* with the drive-back time removed everywhere, the answer is conditional (“works only if the drive back takes 15 minutes or less”), the draft asks for that number instead of stating one, and all three parts show *partly done*.
- *Unsupported kind of calculation:* quotes the sources and says exactly what is missing; nothing is invented.
- New solver in the existing planner for vehicle trips; the planner also gained a sequence solver (items in a booked window) after the fresh example below; a time span is no longer misread as a capacity.

**Cited inputs (shuttle).** People 23, deadline 10:30, seats 8, drive out 20, drive back 20, no loading time: original note. Departure 09:00: the correction (08:40 shown as replaced). Each shows its quote on the result page.

**Fresh, non-transport examples (chosen and run by me, NOT independent; the independent tester step is still open).** Results recorded before tuning:
1. *Agenda against a room booking* (four items, a coffee break, a later correction making one item 50 minutes, ask for a pasteable list). **First result: failed.** It misread “takes 40 minutes” as a kiln-style capacity and said “proposal now: 1 run needed…”, and silently dropped the list request. Repaired (guard against time spans as capacities, “write … as a list” counts as a requested part, new sequence solver). Now: runs until 16:10, 10 minutes past the 16:00 end; per-item starts and ends; pasteable list. This example is tuned, so it is a regression, not a generalization test.
2. *Bake sale with two ovens and a one-time preheat* (rates, parallel resources, a start-up time). **First result: partial, no invented figures.** It quoted the correction (96 → 120 cookies) and nothing else. After a wording fix it says “Jarvis has no calculation for this kind of question yet…” and marks both parts *not done*. **Not supported**; I did not tune for it.

**Checks actually run.** 259 unit tests (new: `tests/shuttle.test.ts`, a connector test in `tests/connect.test.ts`); the browser journey `shuttle` through `/try` on Chromium (shuttle, missing return time, agenda, unsupported oven; desktop and phone width); the full browser suite: 309 checks, 0 problems, run on the final build. The ordinary-Claude path was exercised with the **local test client only**. Room, kiln, decision, source-forgetting and quiz tests all still pass. Zero model calls. Migration 7 adds one column (`result_versions.outcomes`); older results show no parts.

**Still open (live, needs you or an outsider).** (1) Run the shuttle note and correction yourself at `/try`. (2) A person who did not build this should choose a fresh example with a different deliverable; I recorded mine but cannot call it independent. (3) A real Claude account round trip. Synthetic, real-account and paid-model results remain separate; paid model stays off.

**Found on the way (verified).** Asking the identical question text in a second project returns the first request (a duplicate), so it keeps the first project and its sources. Fine when you ask once, surprising if you reuse a question across projects; I did not change it. (Re-importing identical text after forgetting it does bring it back, as revision 2.)

# From finding evidence to finishing the job

## Try it on your Mac

**Update your ZIP-installed copy without losing data** (the old folder is only read, never modified):
```bash
# unzip the new download NEXT TO the old folder, then:
cd ~/Downloads/Jarvis-new
npm install
npm run backup -- adopt ~/Downloads/Jarvis-old/data     # copies your data, upgrades the copy's database, checks it, prints what it kept
```
Two terminals, from the new folder:
```bash
npm run dev        # terminal 1: the app at http://127.0.0.1:3000
npm run worker     # terminal 2: background jobs, Blackboard checks every 15 minutes, the morning brief
```
Worker offline? Today says so and names the command. Requests made while it is off wait and run when it comes back; nothing is lost. **Nothing runs while the Mac sleeps or the worker is stopped**: no Blackboard checks, no brief, no jobs. The connector only answers while the app is running.

**Your first three clicks (about three minutes; stays on this Mac; no key, no login, no model):**
1. Open **http://127.0.0.1:3000/try** (Today also shows a *Try Jarvis with one real note* card). If it offers *Open the private workspace*, press it.
2. Paste **one real note you choose** (a project name, a title, the text) and press **Save the note**. Type a **later correction** (a new date or amount) and press **Save the correction**.
3. Press **Ask** (the question is prefilled, or say it), then **Open the cited answer**.

**One sentence to repeat privately:** *“What is the current plan for my project, and what changed since my first note?”*

**Where the answer is saved:** `/results/<id>` (a stable link), listed under your project at `/projects/<id>` and on Today. Data lives in `data/personal/`. Click any source on the answer to see your original wording with the quote highlighted; **What Jarvis read** is on the same page.

**Success looks like:** the answer names the corrected date or amount, says the first was *replaced by your later correction*, and the sources panel says *original wording, replaced* beside a link to your first note. Connections shows *Notes I imported · imported by you · local-only · last read <time>*.

An **owner trial stays “pending” until you run it.** I have only run these steps with invented, non-personal notes. No real owner material, token or transcript is in any commit, example or screenshot.

## What worked, on what, and what still needs you

Six separate statuses. Nothing is marked connected just because configuration exists.

| | Status | Evidence |
|---|---|---|
| **Synthetic fixtures** | **Worked** | Unit tests (232 pass) and the full browser suite (290 checks, 0 problems, run on the final build) on invented notes: the decision workflow (four plumber outcomes), the new time and capacity planner, private-import flow, Blackboard feed (a local test server speaking the real protocol), the Claude round-trip card with a local test client, the quiz fix. |
| **Owner-imported** | **Pending: needs you** | I never saw any real note of yours. Run the three clicks above with one note you choose. |
| **Mock model** | **Worked** | The model-synthesis path was exercised with a mock transport: off, budget exhausted, failure, rejected citations or numbers, local-only source. Each falls back to the rules answer and labels the mode. |
| **Paid model** | **Off, never called** | No key, no budget. Every browser run reports `modelCalls 0`. Premium and Fable stay off. |
| **Real Claude account** | **Pending: needs you** | The connector, the token and the receipt work against a local test client, which the card labels as a test client (it proves the connector, not your account). The round trip on your account is the test below. |
| **Real Blackboard account** | **Pending: needs you** | Everything but your login: the feed reader, the sign-in handoff and resume, and “connected only after a successful read”. I have not seen a real Blackboard calendar link or your school's menu, so the exact menu wording is unverified. |

## Exact steps only you can do (each says what you will see)

**1. Blackboard (one read path, about two minutes).** Open Blackboard in your own browser and sign in with Duo. Find the calendar link Blackboard offers (wording varies by school; some schools turn it off). Copy it. In Jarvis open **Connections → Blackboard**, paste it, press **Check the link**, then **Save and read now**.
*Success:* the card says **connected: last read succeeded** with a time and a count of events. If the link later stops working, the Office shows *needs your sign-in*; sign in, copy a fresh link, press **Read again**, and the requests that were waiting re-run under the same result links. The link is stored only on this Mac, never shown again, never in a URL or log. If your school disables the link, forward Blackboard notification emails or import a file instead.

**2. Claude round trip (about three minutes, needs the connector added in Claude: Settings → Connectors → add the Jarvis URL and token from Connections).** Open **Connections → Prove the round trip with your Claude account**. It gives you three exact messages with a fresh code:
  1. in a Claude chat with the connector, send the first message (it asks Claude to record a decision on a project and show the receipt);
  2. press **Change the decision** in Jarvis;
  3. in a **new** Claude chat, send the second message. Claude should quote the changed decision and say it was edited in Jarvis.
*Success:* each step shows a tick with a timestamp and the client name the connector reported. If the name looks like Claude the receipt says both ends *reported themselves as Claude*. Jarvis cannot verify an account from a self-reported name, so the receipt says exactly that and no more. If Claude cannot see a long excerpt, it relays it through `share_excerpt` and the answer is revised under the same link.

**3. A real unfamiliar question (one minute).** Ask Jarvis something about time or capacity that you have notes for (a room and a headcount, a batch and a deadline). *Success:* the answer opens with a recommendation and next step, the calculation lists each figure with its quote, and anything replaced or unrelated is listed as set aside with the reason. If an input is missing it asks one precise question.

**Paid model:** leave it off. Nothing above needs it.

## What I built this round

- **Decision workflow** (done, last checkpoint): option terms with source and revision, confirmed vs estimate, included vs extra, start vs finish dates, code-computed totals in integer cents, no double counting, an unknown component kept visible, a recommendation or one precise question, an expandable calculation and a ready-to-edit local draft.
- **Time and capacity planner (new, from the QA failures below):** reads the notes that state numbers, windows and dates even when they share no words with the question; picks the latest statement and shows the replaced one; sets aside another date's limit, another person's batch and another process, with the reason; computes sessions per room (people ÷ seats, session length, breaks, availability windows) or runs per resource (quantity ÷ capacity, cycle time, load and unload windows, deadline); when two readings give different answers it asks which one applies, with the numbers for each; drafts the next step to the right person from the request.
- **Blackboard read path, Claude round-trip card, owner import trial:** as described above.

## Independent QA of an unfamiliar request

I asked an independent agent to choose a goal that is not about price, with a distractor, a later correction and a reason to ask. It chose two: the time and room for a 20-person safety training (rooms of different sizes and times, a trainer window and breaks, a registration count that was corrected from 14 to 20, another training in another room on another date) and getting 50 pottery pieces fired and unloaded before a craft fair (kiln capacity, firing length, load and unload windows, a load-in date that moved a day earlier, another person's kiln figures, a raku figure for a different kiln, and a kiln slot that was either 09:00 or 15:00 depending on someone's schedule).

**First observed results (kept, not rewritten): FAIL.**
- The kiln request that also asked for a draft went down the pitch-draft path and produced a garbled draft addressed to the right person but saying nothing about kilns.
- The kiln and safety-training answers were extractive digests: no division, no schedule, no recommendation. The room notes were not even read, because they share no words with the question.
- The digest paired the raku figures with the big kiln as “replaced”, which is wrong.
- It did not ask whether the Tuesday slot was 09:00 or 15:00, and that question decides the answer.

**Repair (by me, with regression tests built from the recorded data):** the planner above. First-pass success is **not** claimed: these are repairs after a failed first attempt. After the repair the same two requests give: Room C, Thu Nov 19, 12:30 to 14:00, one session seats all 20 (Room B would need two, Room A is booked, the earlier 14 flips it to Room B); and 3 runs (24 + 24 + 2), yes if the 09:00 slot is confirmed (last unload Fri Nov 20 09:00, 3 hours before the 12:00 load-in), 3 hours too late with 15:00, one question asking which slot, a draft to Priya listing the starts and unloads.

**What is not done: a fresh independent re-test.** The QA agent was stopped by a platform safeguards error before it could try a second, unseen request. I did not run that test myself and call it independent. The two requests above are the same data it recorded; a different one is yours to try (step 3).

## The intermittent browser failure (voice quiz)

- **Cause:** after an answer was submitted, the page still showed the question just answered until the server replied with the next one. On a slow response a second tap in that window answered the same question again, which scrambled the order and the score. It depended on network timing, so it came and went.
- **Reproduction:** the browser suite delays the quiz answer response (0 ms and 700 ms) and taps through every question. A second tap during the gap reproduced it.
- **Fix:** the question just answered is hidden, with a visible *Loading the next question* status, until the server has moved on (`src/app/(app)/guides/[id]/page.tsx`).
- **Evidence:** regression journey `quizlatency` (every question shown once, score 5 of 8, at both delays). Earlier repeated full runs on the unfixed build did not fail on their own, so I do not claim the failure rate fell from a measurement: the cause was found by reasoning and reproduced with the injected delay.

## What does not exist yet

Gmail, Slack, Notion and CRM adapters; Obsidian vault mapping and overnight consolidation; skill learning and rollback; routines beyond the morning brief; a Blackboard portal reader (only the calendar feed exists); changes to Claude Code itself. The Pixel Agents Mac smoke test stays pending. The Office reference image was only compared last round. `JARVIS_PUBLIC_URL` is needed only if you later expose the connector; this build does not deploy anywhere.

## Build-process notes (from the second brief)

- Ponytail, Graphify and OmniRoute were **not trialed**: no repeated-navigation cost justified Graphify, Ponytail needs a controlled A/B that this cloud host cannot measure (savings are **unmeasured**), and OmniRoute is skipped because it would switch providers automatically. The Jarvis runtime depends on none of them.
- Debugging method used for the quiz failure: reproduce, isolate, repair, keep the regression. Full test logs are on disk in this environment and not committed.
- Late catch by the full browser run: the Connections page crashed after loading (a data hook sat below an early return, which breaks React's hook order). Fixed, and the suite's Connections check now passes. This is why the whole suite was re-run on the final build.

---

# Next build: a general assistant (previous round)

# Next build: a general assistant, not a school app

## Try it now (the first three clicks, one spoken test, one Claude prompt)
```bash
git fetch origin claude/upbeat-cannon-wf5kxf && git checkout claude/upbeat-cannon-wf5kxf
npm install
npm run dev        # http://127.0.0.1:3000
npm run worker     # second terminal. Background work runs here. Today shows when it is not running.
```
1. **Connections** → **Load the sample workspace** (a synthetic club, meetings, emails, a calendar and a changed notice; every item is labelled *fixture*).
2. **Today** → **Ask Jarvis** → type, or tap the mic and say: **“Pick up where we left off on the pitch and draft my follow-up.”** A result link appears at once. Open it.
3. On the result page: the **draft**, **Check these**, **Where each claim came from** (click a source: the original opens with the quote highlighted) and **What Jarvis read for this**. Then ask **“Get me ready for tomorrow.”**

From ordinary Claude (after the connector is set up): *“Use Jarvis to get me ready for tomorrow.”* Then, in a **new** chat: *“Show me my latest Jarvis result.”* (`submit_goal`, `get_goal`, `get_result`.) To change it from Claude: *“Use the Wednesday decision and keep it to three sentences.”* (`revise_goal`).

**Does the worker have to be running?** Yes for anything that takes more than a moment. Today shows the last worker check-in and says so plainly when work is waiting and no worker has picked it up. Closing the tab does not stop a job; closing the worker does until you start it again, and nothing is lost.

## What I traced first (the first deliverable)
Typing the pitch request into the normal Ask Jarvis box did **not** create a job: it matched only the remember, quiz and study-guide patterns, then fell through to a local command matcher that answered “I did not recognize that”. No job, no retrieval, no draft. The first missing link was a general intake, so I built one path for every request:

**Ask Jarvis / voice / connector → one durable request and job → understand (time, project, deliverable) → Research reads only what is connected and authorized → Writer composes → Reviewer checks every cited source and quote → versioned result with a stable link and a log of what was read.**

It routes on verbs, time words and what the sources contain, not on example names. Tests run the same code against a different invented project to prove it.

## Results, separated: fixture, locally tested, live

| Behavior | Fixture or local test (what ran) | Live account |
|---|---|---|
| Pitch request: finds the later Wednesday decision, marks Monday as the older proposal, quotes the reason from the transcript, flags the `$12,000` figure that only one email states, links the confirming email, uses no other owner's look-alike | **Passes** in unit tests, through the authenticated MCP route, and in a real browser (`npm run e2e`) | **Not run.** No live mail, transcript or Claude account was used |
| “Get me ready for tomorrow”: calendar, a changed notice, a prior Claude outline, ranked to at most three things, an unverified rubric reported not invented, Blackboard listed as unread; changing the calendar changes the brief | **Passes** (same three layers) | **Not run** |
| Third and fourth requests chosen by an independent QA agent | **First attempts FAILED, then repaired.** See “QA” below | Not run |
| Same work from ordinary Claude: submit, receipt at once, fresh chat retrieves the result, revise, cancel | **Passes** with the official MCP client over the authenticated route (this simulates Claude) | **Pending: your account.** Needs the connector activated (below) |
| Start by voice, close the tab, change it from Claude, one job and one current draft, a late result from the old instruction refused | **Passes** with a *simulated microphone* and a *simulated Claude client* | Pending |
| Revoked source drops out; a result that cited it is flagged out of date; forgetting erases text, facts, search entries | **Passes** | n/a |
| Worker killed after saving, before returning its receipt: one version, one message | **Passes** (crash injected after the save step) | n/a |
| Morning brief as a scheduled goal; a day with nothing to say stays quiet (no notification) | **Passes** in a test | Not run on a real schedule |
| Model calls | **Zero.** All of the above is deterministic. No key, no budget used | n/a |

### Source status
| Source | Status |
|---|---|
| Meeting transcripts, mail, course notices, Claude excerpts in the sample workspace | **Fixture** (synthetic). Imports you paste are labelled **imported by you** |
| Calendar events in the brief | **Fixture** in the sample workspace; in your private workspace they come from the calendar feed you already import |
| Excerpts handed over by Claude (`share_excerpt`) | **Locally tested**; live use pending |
| Blackboard portal | **Awaiting sign-in / unavailable.** Reading the portal needs a signed-in session with Duo that only you can start, and that reader is not built. Today it works through notification emails, the course calendar file or an export you paste |
| Gmail, Slack, CRM, Notion | **Not built.** Import is by paste or file; there are no live adapters yet |

### A run where a source was unavailable and Jarvis still delivered
“Get me ready for tomorrow” with Blackboard needing sign-in: the brief still lists the calendar, the changed notice (from the notification email), and the earlier outline; names Blackboard under *What Jarvis could not read* with the reason; says the rubric is mentioned but its contents are unavailable, so the requirements are **unverified**; and offers **Check again** once you import something. (`tests/assistant.test.ts`, `scripts/e2e.ts`.)

## What it read, what it produced, where to open each
- **Result page** `/results/<id>` is the stable link (also what Claude returns). It shows the deliverable, flags, sources with role and fixture label, **What Jarvis read** (including what was skipped and why), your instruction history and earlier versions.
- **Evidence page** `/evidence/<id>` opens the original with the quote highlighted, the extracted facts, and a Forget button.
- **Office**: select the Jarvis desk (or any worker) → **Open what it produced**.
- **Projects** → a project lists its drafts, briefs and answers. **Today** → *Where the output went* lists finished results. **Connections** shows every source, how it got here, and revoke/authorize.

## QA: a request I did not choose
After implementing, I gave an independent QA agent a disposable workspace and told it to pick its own unseen request and data, write the expected result first (with a trap), and record the first attempt before any retry. It did not see the code or tests.

| | Request it chose | First attempt | What was wrong |
|---|---|---|---|
| 1 | “What's confirmed and what's still unbooked for my Lisbon trip in December?” (flight, a hotel booking later changed, a conference note with open to-dos, a same-word dental distractor) | **FAIL** | Ask Jarvis did not even make it a job; run directly it answered “No meeting transcript is saved yet” and read nothing. The answer path was a meetings-only pipeline, so the assistant was not general-purpose |
| 2 | “Where did we land on the apartment lease renewal and what do I still have to do?” (a revised rent, a note with to-dos, a same-name coworker) | **FAIL** | Same cause |
| 3 | Same QA run: “What did my accountant say about my Q4 estimated tax payment?” | **FAIL** | A transcript existed, so the question was turned into “Promises after <meeting>”, never stated the $3,200, and assumed the speaker “Alex” was someone else because it had “Yonathan” hardcoded as you |
| 4 | After repair, a fresh one: “Which plumber should I go with for the bathroom re-pipe, and what will it really cost?” | **PARTIAL** | Found the right sources, ignored the pizzeria distractor, tracked the superseded quote. But it set aside your own budget note, dropped the “permit not included” caveat, showed availability as promises with a due date (“Sons”, “We”), had a garbled title and a noisy not-found flag |
| 5 | Missing data: “What did the school say about the field trip permission slip deadline?” with only plumbing data | **PASS** | Said exactly what was missing, invented nothing |

Every failure is kept as a regression test (`tests/assistant.test.ts`, “QA regression”) and the causes are fixed: one general answer path over every authorized source (what the sources say, what changed, what is still open), any outcome-shaped request becomes a job, currency and unit extraction, promises are listed by speaker when your name cannot be found (set it in Settings), your own notes are not set aside as someone else's, availability is not a promise, titles read as sentences. After the fixes all five pass as tests.

**What it still cannot do, said plainly:** QA also expected a recommendation (“go with Okafor”) and a computed all-in total ($5,350 plus about $400 permit). Without a model Jarvis extracts, compares same-sender figures and reports changes; it does **not** weigh options, add up figures across sources, or recommend. Those need a configured Claude model, which stays off until you approve it. The result says so on every answer. It also cannot always tell a same-word distractor from your subject: it uses shared vocabulary and ignores nothing you wrote yourself, which worked on the dental email and the pizzeria quote but is a heuristic.

## Needs Yonathan
1. **Activate the connector in your Claude account.** In Claude → Settings → Connectors → add custom connector (`https://<host>/mcp`). If the dialog shows **Request headers**, add `Authorization` = `Bearer <token>` (token from Connections; keep it out of chat and screenshots). If it does not, use Claude Desktop with `npm run mcp` today; regular Claude on the web would need OAuth in Jarvis, which is **not built**. Then run **Connections → two-way check**. Details: `docs/CAPTURE-SETUP.md`.
2. **Blackboard sign-in** (Duo) is yours; there is no reader to hand it to yet. Paste notification emails or import the calendar file meanwhile.
3. **Pixel Agents smoke test** stays pending until it can run on your Mac (see the redesign section).
4. Publishing, hosting and any paid model use remain off until you say.

## Test status
`npm run verify` passes: typecheck, **171 unit tests** (was 142), production build. `npm run e2e`: **251 checks, 0 problems** on the last full run. Two earlier full runs had one intermittent failure in the *voice-study quiz* step (“the quiz records 5 of 8 with 3 missed”); it did not reproduce when that journey ran alone, with the Office journey before it, or in the next full run. I could not find a cause, so treat that check as flaky until proven otherwise.

Known: connector result URLs use `JARVIS_PUBLIC_URL` (default `http://127.0.0.1:3000`), so on another port set that variable.

## What I did not build this round (honest list)
Slack / Gmail / Notion / CRM live adapters and cursors; the overnight consolidation job and Obsidian vault mapping (`People/`, `Decisions/`, `user.md`…); learned-skill staging, evaluation and rollback for the follow-up procedure; plain-language routines beyond the morning brief; a Blackboard portal reader; Claude Code mods. The evidence store, retrieval, the shared executor, revisions, the connector tools and the interface are in place for those to build on.

## Office compared with your reference image
The reference is open floor with large characters, floating all-caps name tags, cyan double-headed assignment arrows, speech bubbles that name the action ("SEARCH WEB"), a "NEW HIRE!" tag and "?" bubbles. Mismatches I found against my first version and fixed: characters were about 40% too small; the assignment line had a dot instead of an arrow; nothing said what a worker was doing; the arrival cue had no label; the floor was a duller brown. Now: larger characters, an arrowhead on the trace, an action bubble taken from the worker's real current step, a **NEW HIRE** tag on arrival, a more saturated plank floor. Not matched: the reference has no zone labels or aisle rug and groups desks in back-to-back pairs with partitions; I kept labelled rooms and a center aisle because the aisle is what carries the delegation line.

---

# Redesign build (previous round)

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
