# Upstream references

Three pinned checkouts were fetched with the brief's sparse-checkout block into a temporary directory outside this repo. All three fetches succeeded and each `HEAD` matched the pinned revision. **No upstream source file was copied into this repository.** What was read is listed below, with what it informed. Where a pattern is reused, the Jarvis code is original.

## anthropics/claude-agent-sdk-demos @ `826b268506a5f3707623c9e6140b200befcbebae`

- **License:** no repo-wide license file was present at this revision. The only `LICENSE*` found in the fetched paths is `research-agent/.claude/skills/pdf/LICENSE.txt`, which belongs to an unrelated document skill and was not read or used. So no code is reused. Architecture only.
- **Read:** `hello-world/hello-world.ts` (first 40 lines), `simple-chatapp/server/session.ts` (first 60 lines), `simple-chatapp/server/ai-client.ts` (first 25 lines), `research-agent/README.md` (first 30 lines). Not read in full: `chat-store.ts`, `server.ts`, `types.ts`.
- **What it informed:** the request, stream and session boundary (a long-lived session with a message queue and an output stream), and specialist delegation as a lead agent that spawns narrow subagents.
- **Destination:** `src/lib/agent.ts` (role-scoped tool allowlists, bounded turns, validated tool arguments) and `scripts/mcp-server.ts`.
- **Local changes and deliberate differences:** the demos grant broad shell, edit and write tools. Jarvis grants none. The Blackboard monitor gets only `source_status`, `changed_tasks` and `get_evidence`. The adapter runs over the app's own router (budget, premium gate, run records) with a JSON tool protocol and a turn limit, not the Agent SDK's `query()`. The Agent SDK package is not a dependency. `research-agent` is Python in this revision and was not ported.

## anthropics/skills @ `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` (skills/skill-creator)

- **License:** Apache License 2.0 (`skills/skill-creator/LICENSE.txt`, header read).
- **Read:** `SKILL.md` (first 40 lines), `references/schemas.md` (first 60 lines: `evals.json`, `history.json`). Not read: `agents/`, `assets/`, `eval-viewer/`, `scripts/` (not executed either).
- **What it informed:** the evaluation structure: fixed cases with expectations, running a baseline and a candidate on the same cases, per-case grading, and a version history that records the current best.
- **Destination:** `src/lib/skills.ts` (`EVAL_CASES`, `gradeCase`, `evaluate`, versioned skill files under `data/<mode>/skills/`).
- **Local changes:** Jarvis-specific cases (explicit print requirement, upload-only, optional print, waiver, unrelated task), a scoring rubric (exact quote, mandatory or optional, source pointer, false positives), a capability list that automatic revisions cannot change, and automatic promotion only on a clean pass. No Apache-licensed text or code is included, so no NOTICE is required. If you later copy any of it, keep the license and mark changes.

## obsidianmd/obsidian-skills @ `b110b2f8e9eb1f287892f937050dfd40af862cbb` (plugins/obsidian/skills)

- **License:** MIT, Copyright (c) 2026 Steph Ango (@kepano). Present at `LICENSE` and `plugins/obsidian/LICENSE`.
- **Read:** `obsidian-bases/SKILL.md` (first 80 lines), `json-canvas/SKILL.md` (first 60 lines), `obsidian-markdown/references/PROPERTIES.md` (first 50 lines). Not read: `FUNCTIONS_REFERENCE.md`, `EXAMPLES.md`, `CALLOUTS.md`, `EMBEDS.md`.
- **What it informed:** YAML properties with quoted wikilinks, `aliases` and `tags`; the `.base` file shape (`filters`, `properties`, `views`); the `.canvas` shape (`nodes`, `edges`, 16-hex ids, `fromNode` and `toNode` that must exist).
- **Destination:** `src/lib/memory.ts` (`serialize`, `parseFrontmatter`, `exportOverview`).
- **Local changes:** original exporter and importer, round-trip conflict detection, vault path confinement. The generated files were checked structurally (canvas edges reference real nodes, in `tests/modules.test.ts`). They were **not** opened in the Obsidian desktop app, so rendering there is untested.
- **Notice:** the MIT notice for the Obsidian skills is retained here. No MIT-licensed text is bundled in the repo.

## Additional references (documentation only, not fetched into the repo)

Chief-of-staff cookbook, Agent SDK for TypeScript, skill authoring best practices, Anthropic multi-agent architecture, Obsidian storage, BU Blackboard notification settings, Cowork scheduling, Claude Dispatch, Claude Voice, Claude Code cloud. Capability claims about these surfaces are written as setup guidance in `docs/SURFACES.md` and were not verified live from this build environment.
