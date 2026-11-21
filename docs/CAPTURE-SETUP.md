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

## Activating the connector in your Claude account (the exact step)

Anthropic documents fixed request headers for custom connectors as a limited beta ("Authenticate with request headers" in the custom-connector guide). Whether your account shows that option cannot be known from here.

1. In Claude: Settings → Connectors → add a custom connector. Name: `Jarvis`. URL: `https://<your host>/mcp` (see `deploy/README.md`).
2. **If the dialog shows "Request headers":** add the header `Authorization` with the full value `Bearer <token>` (the word Bearer, a space, then the token you created on the Connections page). Do not paste the token into a chat, a screenshot or a URL.
3. **If it does not:** use the supported local path instead. Claude Desktop with the local connector (`npm run mcp`, config below) works today. Regular Claude on the web would need Jarvis to speak OAuth, which is **not built**: that is the remaining work for that path.
4. Check it: Connections → "Run the two-way check". It turns green only after a real write from Claude, an edit in Jarvis, and a fresh read from Claude.
5. For results: in Claude say "Use Jarvis to get me ready for tomorrow", then in a **new** chat "Show me my latest Jarvis result". Paste the Project instruction from the Connections page into the Claude Project you use.

Account verification is **pending**: tests use the official MCP client against the authenticated route, which proves the code path, not your account.

## Blackboard (read-only calendar feed)
Connections → Blackboard. Open Blackboard in your browser (the official site, signed in with Duo), find the calendar link Blackboard offers for your calendar (the menu wording varies by school, and some schools turn it off), copy it, paste it into Jarvis and press **Check the link**, then **Save and read now**. The link is a secret: it is stored only on this computer, never shown again, never logged. Jarvis shows *connected* only after a read succeeds, rechecks every 15 minutes while `npm run worker` runs (a conditional request, so an unchanged calendar costs nothing), and tells you exactly what it covers: dated events and their descriptions, not rubrics, instructions or grades. If the link stops working you get a *needs your sign-in* item in the Office: sign in on Blackboard, copy a fresh link, press **Read again**, and the requests that were waiting on Blackboard are re-run under the same result links. If your school disables the link, forward Blackboard's notification emails or export a file and import them under Connections.

## Round trip with Claude (the proof for your own account)
Connections → *Prove the round trip with your Claude account*. It gives you three exact messages: save a project decision from a Claude chat, change it in Jarvis, read it back from a **new** chat. Each step gets a timestamp and the client name the connector reported. If the name looks like Claude the receipt says both ends *reported themselves as Claude* (Jarvis cannot verify an account from a self-reported name); if it is a test client it says so and does not count as your account.
