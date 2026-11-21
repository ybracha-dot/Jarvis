# Which surface runs what

These are different products with different credentials, schedules and usage. Mixing them up is the main way this setup goes wrong.

| Surface | What it is | What it does for Jarvis | What it cannot do |
|---|---|---|---|
| **Claude Code** | The coding agent that built this app | Builds and edits the repo, runs tests. Cloud sessions run in an isolated container. | It is not the running app. It does not hold the app's API key, schedule or data. |
| **This app (Next.js server + worker)** | `npm run dev` or `npm run start`, plus `npm run worker` | Dashboard, SQLite store, ingestion, planning, scheduler, outbox. Calls the Claude API only if `ANTHROPIC_API_KEY` is set and a daily budget is above 0. | Cannot read a sleeping Mac or another device. Cannot use your Claude chat login. |
| **Claude API (standalone)** | Pay per use, billed separately | Optional: council reviews, briefs, interpretation of ambiguous notices. Routed by role, budget reserved before each call. | Never called at boot, on an unchanged scan, or without a budget. |
| **Claude chat / Claude Desktop** | Conversational front door | Ask Claude about your day if you add the Jarvis MCP server (below). | A signed-in Claude account is not a credential this app can borrow. |
| **Claude Cowork scheduled tasks** | Schedules that run inside your Claude account | Can run a recurring prompt with the connectors you attach (for example Gmail) and write results to a folder Jarvis watches. | Account-level connectors are not available to this app's Node process. Check the current Cowork docs for what a scheduled task can reach. |
| **Claude mobile / Dispatch** | Native Claude notifications and voice | Separate from this app's notification channel. Claude's own voice mode is the supported voice path on the phone. | A custom web page cannot control the Claude app. There is no Jarvis-specific Dispatch API in this build and none is faked. |

## Using Claude as the front door (concise setup)

1. Run the local MCP server. In Claude Desktop's MCP config add:
   ```json
   { "mcpServers": { "jarvis": { "command": "npx", "args": ["tsx", "/ABSOLUTE/PATH/TO/jarvis/scripts/mcp-server.ts"], "env": { "JARVIS_MCP_MODE": "demo" } } } }
   ```
   Use `"personal"` only when you want it to read your private workspace.
2. Tools exposed: `today`, `changed_tasks`, `source_status`, `get_evidence` (read only) and `propose_decision` (creates a proposal you must review, at most 3 per day).
3. Transport is stdio, tested with the official SDK client (`tests/api.test.ts`). A localhost server cannot serve Claude mobile. A remote MCP deployment needs authentication and an explicit deployment and is **not built**.

## Unattended operation

- **Real process:** `npm run worker`. It writes a heartbeat. The app says "Worker running" only while that heartbeat is fresh, and says "No worker is running" otherwise.
- **Cowork alternative:** create a scheduled task that checks your mail connector and saves new Blackboard notification emails as `.eml` files into the watched folder shown on the Sources page. The worker or **Run now** then ingests them. This setup is described, not tested here.
- An in-browser timer is not used and would not count.

## Where the Office and its jobs run (added)

| Piece | Where it runs | Needs a connected device? |
|---|---|---|
| Job queue and leases | the SQLite file in `data/<workspace>/` | No. It is just a file. |
| **App-server runner** | inside `npm run dev` / `npm run start` | Only while that process is alive, which means your Mac awake and the app running. It writes a heartbeat the Office shows. |
| **Worker** (`npm run worker`) | a separate process, any always-on machine with the repo and the same data folder | Yes: that machine must be on. For all-day use run it there. It also runs the 08:00 and 16:00 checks. |
| Recovery | a restarted runner re-queues any job whose lease expired (default 15 s) and finishes it. Completed steps are not repeated | n/a |
| Cowork / cloud | **not** used for the Office. A cloud session or a sleeping Mac cannot run these jobs or read your local data | n/a |

Two runners can be up together. Leases stop them taking the same job. If neither is running, jobs wait and the Office says "No runner active".

Voice and photos run in your browser plus this app's server. The server calls Claude directly for image reading and question writing (when a key and budget exist). Regular Claude Voice is a separate front door that can reach Jarvis only through the connector tools in `docs/CAPTURE-SETUP.md`. It was not tested here.
