# PROGRESS

State: the overnight build and the morning addendum are complete for everything that does not need Yonathan's accounts, devices or keys. See MORNING.md.

- Launch: `npm install && npm run dev` (http://127.0.0.1:3000). Production: `npm run build && npm run start`. Unattended: `npm run worker`.
- Verify: `npm run verify` (typecheck, 118 tests, build). Browser journeys: `npm run e2e` (199 checks, needs a build). One journey: `E2E_ONLY=office|study|mcp npm run e2e`.
- Last working milestone: Live Office, capture and connector, spoken BI107 guide with versions, quizzes and PDF.
- Next test: none failing. Next work: `docs/MAC-CHECKLIST.md` (mic, speaker, live Claude), then the Needs Yonathan list in MORNING.md.
- Outstanding dependencies: microphone and speaker on a Mac, Anthropic key and budget, connector added to a Claude account, Blackboard sign-in, push provider, hosted MCP with auth.
- Not built: Claude conversation export import, Gmail OAuth, WhatsApp Business webhook, Apple Messages import.
- Continuation command: "Read PROGRESS.md and MORNING.md, inspect the current diff, run npm run verify and npm run e2e, then continue from the first item under Pending."
