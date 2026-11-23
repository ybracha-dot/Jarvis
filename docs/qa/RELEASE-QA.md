# Release QA (Monday, November 23 overnight run)

All data is invented. Only Chromium was available.

## Connections button "detached" after the long journey
- **First evidence** (kept as recorded): `docs/qa/connections-detach-first-evidence.txt`. In the full run, after the long assistant journey, a click on the Connections "Load the sample" button reported *element was detached from the DOM* and timed out.
- **Reproduced through the real UI**, deterministically: the source list answers 1.5 s late (what a busy worker causes) and the DOM is sampled every 40 ms for 6 s. **Before the fix: the button was added 1 time and removed 1 time** (`E2E_ONLY=detach npm run e2e`, FAIL). The page drew the button as soon as its main data arrived, before it knew whether the sample was already loaded (the demo reset keeps it), then removed it when the source list answered.
- **Fix** (`src/app/(app)/connections/page.tsx`): the button is drawn only once both the session and the source list have answered. It is also never drawn in the private workspace.
- **After the fix: added 0, removed 0**, and the private workspace never offers the button. The journey `detach` is kept in the suite.

## The Study flake
- The reported intermittent failure was the voice-study quiz ("5 of 8 with 3 missed"). Its cause was found earlier (a second tap in the gap before the next question arrived) and fixed; `quizlatency` is its regression.
- Rechecked tonight: **three runs of the study journey (49 checks each, 0 problems) and three runs of `quizlatency` (4 checks each, 0 problems)**, back to back. **Not reproduced.** The one Study failure I did see tonight was not a flake: my own change to the Office roster order made a test click the wrong job; fixed in the same hour and covered by the full run.

## WebKit / Safari
Not tested. WebKit is not installed here and cannot be downloaded (`npx playwright install webkit` fails: the download is blocked by this environment's network policy). Everything below is Chromium (Playwright's bundled build), with phone views as touch emulation, not an iPhone.

## Inspection of the screens that matter
`npx tsx scripts/qa-inspect.ts` (report: `docs/qa/inspect-report.md`, screenshots: `docs/screenshots/qa/`). Five screens (private first run, a meaningful deadline change, an agent blocked on a question, the project page with its latest draft, the draft with its sources and next action), each in light and dark at laptop (1440x900) and phone (390x844): 20 views. Per view it checks serious/critical axe violations (WCAG 2.1 AA, including contrast), that the last control is not covered by the composer or the tab bar and can be hit, no horizontal scroll, small touch targets, and that keyboard focus is drawn. **Result: 0 problems.**
What I looked at and changed because of it:
- The blocked agent's question offered a paste box labelled and worded for **study guides** ("Use this guide once"). It now says what it is: paste the relevant part of the earlier chat, **Use this excerpt**, or **Finish with what is available**; the "send this to Claude" message sits in a closed "Or have Claude send it" disclosure instead of leading. The message no longer contains `project ""` when there is no project.
- The "needs you" moment (who is waiting, what, where to press) has no setup instructions in it.

## Not covered
Real-device software keyboard; Safari; the Claude Desktop app; your Mac. See the top of `MORNING.md`.
