# Put the Jarvis connector on the internet (optional, your decision)

Claude on the web and phone can only reach an `https://` address. This folder deploys Jarvis so that **only the connector** is public. Nothing here has been run against a real server or a real Claude account. Public exposure, DNS, hosting cost and your Claude plan's support for a custom connector are yours to decide and verify.

## What gets exposed
- `https://YOUR-DOMAIN/mcp`, protected by a bearer token you create, hashed in the database, revocable, optionally expiring.
- `https://YOUR-DOMAIN/healthz`, which only says `{"ok":true}`.
- Nothing else. The pages and the API return 404 on this door. The private app stays on `127.0.0.1:3000` of the server.

## Steps
1. A small server with Docker and a domain whose DNS points at it. Ports 80 and 443 open.
2. `cd deploy && JARVIS_DOMAIN=jarvis.example.com docker compose up -d --build`
3. Make a token (shown once, never put it in a URL):
   ```bash
   docker compose exec connector npm run token -- create "Claude" --days 90
   ```
4. In Claude: Settings, Connectors, add a custom connector with URL `https://jarvis.example.com/mcp` and the header `Authorization: Bearer <token>`. If your plan or app does not accept a fixed header, use Claude Desktop with the local connector or an `mcp-remote` bridge (`docs/CAPTURE-SETUP.md`).
5. Prove it: open Jarvis (`ssh -L 3000:127.0.0.1:3000 you@server`, then http://127.0.0.1:3000/connections) and run the two-way check.
6. From any computer: `npm run mcp:smoke -- https://jarvis.example.com/mcp <token>`.

## Disconnect
`docker compose exec connector npm run token -- list`, then `... revoke <id>`. It stops at once. `docker compose down` takes the whole thing offline. Your data stays in the `jarvis-data` volume.

## Back up
`docker compose exec ui npm run backup` writes a verified archive into the volume's `backups/` folder.
