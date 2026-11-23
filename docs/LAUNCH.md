# Start Jarvis on your Mac (one command)

You need Node 22.13 or newer (`node -v`). Everything else is done for you.

```bash
cd "/path/to/the/Jarvis folder"      # quotes matter if the path has spaces
node scripts/jarvis.mjs
```

Or double-click **`Jarvis.command`** in Finder (the first time: right-click it, choose Open, then Open).

It will, in order: check Node, install dependencies if they are missing (`npm ci`, needs the internet once), build the app if it is new or its source changed, **back up your data before migrating it if the database is older**, start the app and the worker on `127.0.0.1`, wait until both answer, and open **private Today**. Then it prints:

```
Jarvis is running.   build dd8499a  (built 11/23/2026, 5:28 AM)
  App        pid 540   http://127.0.0.1:3000   healthy
  Worker     pid 568   heartbeat 0 s ago   healthy
  Workspace  ws_b88d9a6ca79e   app and worker are on the same workspace
  Data       /path/to/Jarvis folder/data
```

From a downloaded ZIP (no git) the identifier is `src-` plus a fingerprint of the code, so two different ZIPs never look alike. It is also on screen: bottom of the sidebar (and under More on a phone), next to "Worker running".

| Do this | Command |
|---|---|
| Check it | `node scripts/jarvis.mjs status` |
| Stop it (graceful) | `node scripts/jarvis.mjs stop` |
| Restart it | `node scripts/jarvis.mjs restart` |
| Check everything without starting | `node scripts/jarvis.mjs doctor` |
| Bring an older install's data over | `node scripts/jarvis.mjs upgrade --from "/path/to/older Jarvis folder"` |

Options: `--port 3001`, `--data /other/folder`, `--no-open`, `--no-install`, `--no-build`.

## What it will not do
- It never ends a process it did not start. `stop` signals only the app and worker this install recorded, and only after checking that they still run from this folder.
- **Port 3000 busy?** If another app has it, or an earlier Jarvis does, that one is left running and the next free port is used. The message names which.
- Running it twice is harmless: the second run finds the first and just checks it.
- If the worker is missing or on a different data folder, the summary says so instead of showing a green tick.

## Upgrading from a previous ZIP
1. Unzip the new version somewhere new. Leave the old folder where it is.
2. In the new folder: `node scripts/jarvis.mjs upgrade --from "/path/to/old folder"`.
   - Step 1 backs up the old data **beside the new install** (`jarvis-backups/`), hash-verified. The old folder is only read.
   - Step 2 copies the data in and migrates **the copy**, then prints the schema change ("v9 -> v11"), the integrity check and record counts. Anything already in the new install is saved aside first (`jarvis-before-adopt-*`). If the new install already has real private data it stops and asks for `--force`.
   - Step 3 is `node scripts/jarvis.mjs`.
3. Saved results keep their links. The example workspace is carried over too. The old install keeps working from its own folder.
4. To go back: `npm run backup -- restore <the backup folder>`.

If you start a newer version directly on older data (no upgrade step), the launcher first backs the data up and says what it is about to migrate.

## Claude Desktop (optional, after Jarvis is running)
`node scripts/desktop-config.mjs` shows the separate `jarvis-personal` connector entry with every path resolved on your Mac; `--write` adds it, `--check` starts it for a moment and lists its tools. That helper is unchanged.

## Tested
`npx tsx scripts/launch-qa.ts` builds disposable installs under paths with spaces and runs: start, relaunch, restart, stop, an unrelated app on the port, an earlier Jarvis on the port, missing dependencies, a stale build, and an upgrade of a schema-v9 install that holds a saved result (the old folder is hashed before and after and must not change). It never touches your `data/`.
