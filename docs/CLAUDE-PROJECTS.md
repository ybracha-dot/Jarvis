# Ordinary Claude and one project (private workspace)

Claude sees nothing of your private workspace unless you share it. This is the one path.

## The path (in Jarvis)
1. **Choose.** Open **Projects → the project** (for example TAMID). The *Share TAMID with Claude* panel is on its page.
2. **Preview.** The panel lists exactly what Claude would receive: the project's decisions and to-dos, each source of notes (with the titles of this project's notes and a warning if the source also holds notes from other projects), and each draft. The right column says what Claude will **not** see: local-only notes, your calendar and work blocks, your private brief, and notes from other projects.
3. **Share.** Tick the sources and drafts you want. Press **Share TAMID with Claude**. A draft that cites a local-only note cannot be ticked, and the panel names the note that stops it. Sharing a source is what makes its notes readable; sharing the project alone gives Claude only the decisions.
4. **Reopen in a new Claude chat.** The panel prints one prompt to paste: *Use my jarvis-personal connector: call get_project_context for "TAMID", then get_result for ID res_…*. A new chat knows nothing until you do this; it reads the same decisions and the same draft (every version, by its id).
5. **Take it all back.** **Stop sharing everything** closes the project's decisions, every result of the project (all versions at once) and every source that was shared through this panel. Nothing is deleted. The next call from any Claude chat is refused.

## A pitch request, from either side
"Pick up where we left off on the TAMID sponsor pitch and draft my follow-up." gives a draft email with its sources (each opens the original with the quote highlighted), flags (an earlier proposal that was replaced; a figure with only one source is left out), and **one next action** ("Read the draft, check the flag, then send it yourself. Jarvis sent nothing."). Asking Jarvis to "use the Wednesday decision and keep it to three sentences", from the result page or from Claude (`revise_goal`), makes **version 2** of the same result. Earlier Claude conversations are used only when you hand an excerpt over (`share_excerpt`) or import a thread.

## What is proven here, and how
- `tests/project-share.test.ts` (3 tests) drives the real MCP route with a fresh client each time (invented notes): a local-only note and a similarly named note in another project never appear in `search_evidence`, `get_result` or `get_project_context`; the preview equals what a new client can read; the pitch draft is cited; the correction makes version 2; after one revoke every version, by result id or request id, is refused.
- `E2E_ONLY=share npm run e2e` does the same through the browser (the panel, a new MCP client, screenshots `docs/screenshots/share/` are `70`–`73` in `docs/screenshots/`).

## What is evidence, and what is still pending
- **Evidence (unchanged):** the example workspace with the `jarvis-reader-demo` connector, as recorded in `MORNING.md` ("For Yonathan (the pilot you already have)"). Nothing here replaced it.
- **Pending, needs your Mac and your Claude account:** the *private* pilot with the `jarvis-personal` connector in Claude Desktop. It has been exercised only against an in-process emulator of Claude over the real authenticated route, never your real Claude account. It stays labelled **pending** until you run the steps below.

## The minimum live Mac steps (about five minutes)
1. `node scripts/jarvis.mjs` (starts the app and the worker, opens private Today; see `docs/LAUNCH.md`).
2. `node scripts/desktop-config.mjs --write`, quit Claude Desktop with ⌘Q, open it again.
3. In Jarvis: add one real note under a project, open **Projects → that project**, tick its source, **Share**.
4. In a **new** Claude Desktop chat paste the prompt the panel shows. Confirm Claude names the decision and opens the draft.
5. Back in Jarvis press **Stop sharing everything**; in another new chat paste the same prompt and confirm Claude is refused.
