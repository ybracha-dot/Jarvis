# Capture from ordinary Claude, and the connector

What this does: you say "Remember for Jarvis: I owe the TAMID team three pitch angles by Thursday." in Claude. Claude calls `save_to_jarvis`. Jarvis saves the commitment at once, returns a receipt with a link, and wakes the supervisor in the Office, which assigns a specialist and puts one decision on your desk. Say it twice and nothing is duplicated.

## Honest limits

- A connector gives Claude two tools. It is **not** a feed of your Claude chats. Jarvis only knows what you asked it to remember, pasted, imported or attached. If you ask for something old and it is missing, Jarvis says exactly what to share.
- General chats: "Remember for Jarvis" is the explicit trigger. Claude Project auto-save is opt-in and is a Project instruction (below), not something Jarvis can switch on for you.
- This build ships the connector and tested it with the official MCP client. It has **not** been connected to a real Claude account from here. See "What only you can verify".

## Option A: Claude Desktop on your Mac (stdio, no deployment)

1. Install and set up Jarvis (`npm install`).
2. In Claude Desktop, open the MCP config and add:
   ```json
   { "mcpServers": { "jarvis": { "command": "npx", "args": ["tsx", "/ABSOLUTE/PATH/TO/Jarvis/scripts/mcp-server.ts"], "env": { "JARVIS_MCP_MODE": "demo", "JARVIS_DATA_DIR": "/ABSOLUTE/PATH/TO/Jarvis/data" } } } }
   ```
   Use `"personal"` to write to your private workspace. Restart Claude Desktop.
3. Keep `npm run dev` (or `npm run worker`) running. The stdio server saves captures, and whichever runner is up does the Office work.
4. In a Claude chat say: `Remember for Jarvis: I owe the TAMID team three pitch angles by Thursday.` Claude should show a `save_to_jarvis` tool call and a receipt with a link.

## Option B: an authenticated HTTP connector (for claude.ai or anything remote)

1. Pick a long random token and start Jarvis with it:
   ```bash
   JARVIS_MCP_TOKEN="$(openssl rand -hex 24)" npm run start
   ```
2. The endpoint is `POST /mcp` (stateless Streamable HTTP). Every request needs `Authorization: Bearer <token>`. Without the env var it answers 503, with a wrong token 401. It accepts loopback hosts only unless you list yours in `JARVIS_MCP_ALLOWED_HOSTS`.
3. **Run the smoke test first** (this is the one real check of an authorized connector path):
   ```bash
   npm run mcp:smoke -- http://127.0.0.1:3000/mcp "$JARVIS_MCP_TOKEN"
   ```
   It saves one synthetic capture, replays it to prove deduplication, and recalls it.
4. To reach it from claude.ai or the phone you must put it behind HTTPS on a host you control. A localhost URL cannot serve Claude mobile. **Check the current Claude custom-connector documentation for which authentication it accepts.** This build supports a static bearer token only. If your Claude plan requires OAuth for remote connectors, that is not built.

## Claude Project that saves confirmed decisions (opt in)

Create a Project and add this to its instructions:

> When I clearly confirm a decision or a commitment I owe someone, call `save_to_jarvis` once with a one-sentence statement that starts with "Remember for Jarvis:". Do not save anything I have not confirmed. Never save private reflections. If a save returns `duplicate: true`, say it was already saved.

In ordinary chats outside that Project, nothing is saved unless you say "Remember for Jarvis".

## Undo

Office → the receipt → **Undo**. It removes the commitment, the work item and the decision, cancels the jobs, and a replay of the same words will not bring them back.

## Other sources, and their status

| Source | Status here |
|---|---|
| Pasted text, Office capture box | works, tested |
| Connector tools (stdio and HTTP) | works, tested with the official MCP client |
| Email that brings a deadline forward for a commitment | works, tested (updates once, one decision, never sends) |
| Selected Claude conversation export or share | not built |
| Gmail with OAuth, label watching, renewal | not built (needs your Google OAuth app) |
| WhatsApp or Apple Messages | reviewed paste or forward only, via capture. No account access |
| WhatsApp Business signed webhook | not built |
| Calendar feed, Blackboard | as in the first handoff |

## What only you can verify

Adding the connector in your own Claude account and seeing a real `save_to_jarvis` call. Nothing in this repo has touched a Claude account.
