# PROGRESS (overnight release, Monday November 23)

Branch `claude/upbeat-cannon-wf5kxf`. Start commit `dd8499a`. No PR, no deploy, no paid model calls, no external sends, no private-account connections. All inputs invented.

## Work queue (in order)
- [x] 1. One-command Mac launch: app + worker + open private Today, health, same-workspace check, ports, stop/restart, build id, upgrade with backup/adopt
- [x] 2. Private intake: blank -> one note + optional calendar -> cited corrected brief; unclassified sentences reviewable; catch-up once; last successful check
- [x] 3. Claude/project continuity: share one project, preview, reopen, revoke all; privacy proofs; pitch draft versioned from a correction
- [ ] 4. Feedback and memory: feedback tied to source/project/result; why the next brief changed; one narrow skill proposal with before/after
- [ ] 5. Release QA/design: Connections detach repro, Study flake, WebKit check, visual inspection; `npm run verify` + `npm run e2e` from a clean checkout; MORNING.md top

## Latest pushed checkpoint
`dd8499a` (start); item 1 committed locally, pushed with the next checkpoint. Tests at start: typecheck clean, 413 unit tests, full e2e 437 checks 0 problems (Chromium).

## Tests run tonight
- Item 1: `npx tsx scripts/launch-qa.ts` 35 checks, 0 problems (disposable installs, paths with spaces; unrelated app and earlier Jarvis on the port; missing deps; stale build; upgrade v9->v11 with a saved result, old folder byte-identical). Real `npm ci`+build+start from a bare copy: ok. 413 unit tests pass.
- Item 2: tests/brief-review.test.ts (6) + review flow in the brief browser journey (70 checks 0 problems) + launch-qa restart catch-up (39 checks 0 problems); 419 unit tests pass.
- Item 3: tests/project-share.test.ts (3, real MCP route, fresh clients) + `E2E_ONLY=share` browser journey (20 checks, 0 problems); screenshots 70-73. 422 unit tests expected.

## Next unchecked item
4

## Dependencies on Yonathan's account/device (recorded, never blocking)
- Mac: run the launcher once, Claude Desktop connector, Blackboard sign-in, real notes/calendar.
- Live Claude pilot stays **pending**. Safari/WebKit coverage depends on whether WebKit is installed here.

## Continuation command
"Read PROGRESS.md and MORNING.md, inspect `git status`, run the focused tests for the first unchecked item, then continue."

