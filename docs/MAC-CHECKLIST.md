# Mac checklist: microphone, audible replies, live Claude

Do these in order. Each is a few minutes. Nothing here spends money until step 5.

## 1. Launch
```bash
git fetch origin claude/upbeat-cannon-wf5kxf && git checkout claude/upbeat-cannon-wf5kxf
npm install
npm run dev
```
Open http://127.0.0.1:3000 in **Chrome or Safari**. (Voice input uses the browser's speech service. Firefox has none.)

## 2. Microphone (Today → Ask Jarvis)
- [ ] Read the disclosure (it names Google, Microsoft or Apple as the speech service). Click **I understand**.
- [ ] Click **Tap to talk**. The browser asks for the microphone. Allow it.
- [ ] The pill says **Microphone on, listening**. Say: "Make me a study guide like the last one you did for bio."
- [ ] Your words appear in the transcript box. They are **not** sent. Edit one word.
- [ ] Click **Tap to stop**. The pill says **Microphone off**. Check the macOS menu bar: the orange mic dot is gone.
- [ ] Leave the page. The dot must not come back.
If it says permission denied: System Settings → Privacy & Security → Microphone → enable your browser, then reload.

## 3. Audible replies
- [ ] Open **Voice and playback**. Pick a voice. The default prefers a British English one (Daniel, Serena, Kate). **Preview** plays it.
- [ ] If you have no British voice: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, download "Daniel" or "Serena (Enhanced)", reload.
- [ ] Attach two photos (any two pictures; the sample ones are in `fixtures/bi107/`), choose **BI107**, **Send**. You hear a one or two sentence acknowledgment.
- [ ] While it speaks, tap **Tap to talk**: it should stop talking. **Stop talking** and **Mute** also work.
- [ ] Open **Office** (left rail). Watch Intake, Research and Planning helpers work. Click one.
- [ ] When the guide is ready you hear: "…Want me to open it, or shall I ask the first question?" Even if you were on another page.

## 4. The guide
- [ ] **Open guide**: answers are hidden. **Quiz me**, miss a few. Say "Quiz me on what I missed."
- [ ] **Export PDF** and **PDF with answer key** open in a tab.
Note: the sample photos are synthetic, so the example workspace reads them with a labeled fixture reading. Your own photos need step 5 to be read.

## 5. Live Claude (the only step that spends money)
1. Create `.env` in the repo root (copy `.env.example`): `ANTHROPIC_API_KEY=your key`.
2. Restart `npm run dev`. Open **Settings → Claude model provider**, set **Daily budget** to something small like 1, save.
3. Click **Test Claude**. Expect "Claude responded on claude-haiku-5-5 (low)". That one call is the only live verification of the API path.
4. Repeat step 3 of the checklist with **your real test photos**. The research helper now sends each photo to Claude (one call per photo) and the writer makes one call. In the Office inspector the helper shows its model calls. Check the guide's "Question style from photos" says **read**, and the generator says **claude**, not fixture.
5. Check the guide's answer-key check line. Skim a few questions against your notes. Jarvis flags what the notes do not support, but you are the final check.
Premium (Fable) stays off. It needs three separate opt-ins.

## 6. Optional: the connector
See `docs/CAPTURE-SETUP.md`. The smoke test is `npm run mcp:smoke -- <url> <token>`.

## What this checklist cannot cover
Claude's own voice mode on your phone is a separate product and does not drive this app.
