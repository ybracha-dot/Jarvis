# The private morning brief

One screen, once a day, from your own notes and calendar, on your own computer. No model is called. Nothing is sent, submitted or changed outside Jarvis.

It answers three questions: **what changed since my last brief, what do I owe before tomorrow, and when can I do it.**

## What is on the screen

1. **What changed**: the single most consequential change, with the sentence that says so and a link that opens it. The first brief is labelled a **baseline** because there is nothing earlier to compare with. When nothing material changed it says exactly that.
2. **What you owe**: at most three priorities, each with a concrete next action, its deadline, a link to each source it relies on, and (only when your calendar supports it) a proposed time. Other due items are under **Also due**.
3. **When**: a proposed work block appears only when (a) a calendar you imported or connected covers those days and was read successfully, and (b) there is an estimate for how long the work takes. The estimate is labelled as Jarvis's default or as yours. Your classes, prayer and Shabbat intervals are busy time you typed in; Jarvis computes none of them. A day the calendar says nothing about is *unknown*, never free. **One click reserves the block on this computer only.**
4. **The machinery**: the last successful check, the next scheduled check, whether a worker is actually running (a heartbeat, not a setting), any missed or late run, and which inputs were live, imported, stale or unavailable.
5. **Correct / Dismiss**: fix a deadline or an estimate, or dismiss an item. The next brief says you made the correction. A dismissed item comes back if its deadline moves earlier.

The instructor's deadline and your proposed work block are always shown separately.

## Five-minute live check on your Mac

You need: this folder, Node 22, Terminal, Claude Desktop. Your private notes stay in `data/` (not in git).

**1. Start the app and the worker (two Terminal tabs, in this folder)**
```bash
npm ci
npm run dev
```
```bash
npm run worker
```
Open http://127.0.0.1:3000 and press **Open private workspace**. The Today screen shows **Morning brief**. Under *The machinery behind it* the worker should say **running** within a minute.

**2. Give it three things**
- **A note you choose.** Today → *Build my first brief* explains it; or go to **Try Jarvis with one real note**. Paste one assignment or project note with its deadline. It is saved **local-only**.
- **A calendar.** Export `.ics` from Apple Calendar or Google Calendar → **Sources** → choose the file → Preview → Import. (Or paste your Blackboard calendar link under **Connections**. That link gives deadlines only, not your free time, and never appears on screen again.)
- **Your week.** **Settings → Morning brief**: tick *Build my brief automatically*, set the time, add your classes, and, only if you want them, prayer and Shabbat intervals. Jarvis uses exactly the times you type.

**3. Build the first brief.** Press **Build my first brief**. It must say **baseline**. Check the deadline against your note by pressing the source link.

**4. A later change.** Open the note (any source link) → **Something changed since?** → paste what the instructor now says (for example a new date and "bring a printed outline") → **Save as a correction**. Back on Today press **Rebuild now**. Expect: the new deadline leads, with the sentence quoted; the old deadline is shown as replaced; the requirement is the next action; if your calendar covers the days, a proposed block and a print step appear. Press **Reserve** and reload: it stays reserved.

**5. Claude (optional, two minutes)**
```bash
node scripts/desktop-config.mjs
```
prints a separate **`jarvis-personal`** entry with every path resolved on your Mac (the folder your app and worker already use). To add it without touching anything else in Claude Desktop's config (your `jarvis-reader-demo` entry stays exactly as it is, and a dated backup is written first):
```bash
node scripts/desktop-config.mjs --write
```
Then quit Claude Desktop with ⌘Q, open it again, and check the connector starts:
```bash
node scripts/desktop-config.mjs --check
```
On Today press **Share a Claude-safe view**. In a new Claude Desktop chat: *"Use my jarvis-personal connector: call get_result for ID `<the id from the Claude-safe view's link>` and show me the brief."* A fresh chat must show the same brief. Then press **Take it back**; asking again must be refused.

Claude sees nothing else: your notes stay local-only unless you press **Let Claude read** next to a source (Connections → *What Claude can read*), and the brief Claude opens is built only from sources you shared, with no calendar and no course records.

**6. The next morning.** With the worker running and private schedules on, the brief builds itself at your time. If the computer was asleep, it runs once when the worker wakes and Today shows the gap ("Ran 2 h 12 min after its slot…"). If you set a Shabbat or prayer interval, scheduled work waits until it ends.

## What was tested here and what only you can check

- Tested on invented material on this machine: the builder, deadline supersession, requirements, calendar coverage, reservations, corrections and dismissals; the worker (scheduled run, duplicate delivery, claimed-then-died run, restart, catch-up, quiet intervals, failed build retried); the connector boundary through two fresh clients; the browser journey at laptop and phone width; the Mac setup helper against a copy of a config file.
- **Not tested, needs you:** your Blackboard calendar link and Duo; your own notes and calendar export; Claude Desktop with the `jarvis-personal` entry. The live pilot stays **pending** until you have run it.

## Safety rules the brief follows

Reads, local drafts and proposed work blocks can happen on their own. Sending a message, submitting coursework or changing an external calendar always waits for you. Passwords, Duo codes, private feed links and tokens are never shown or logged. An input that is down is named, and everything that can still be supported is still finished.
