#!/usr/bin/env node
/* Claude Desktop setup for the private workspace. Plain Node, nothing to install.
   It resolves every path on THIS computer, prints a separate, plainly named "jarvis-personal" server entry, and can merge it into Claude Desktop's config
   without touching anything else in that file (your other servers, including the example one, stay exactly as they are). A backup is written first.

     node scripts/desktop-config.mjs                 show the entry and the merged file, change nothing
     node scripts/desktop-config.mjs --write         back up the config, then add or replace only mcpServers["jarvis-personal"]
     node scripts/desktop-config.mjs --check         start the personal connector for a moment and list its tools (no Claude needed)
     options: --data <dir> (default <this folder>/data, the folder your app and worker already use), --config <path> (default: Claude Desktop's config on macOS) */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2); const flag = (n) => args.includes(n); const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const dataDir = path.resolve(opt("--data", process.env.JARVIS_DATA_DIR || path.join(repo, "data")));
const configPath = path.resolve(opt("--config", path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")));
const loader = path.join(repo, "node_modules", "tsx", "dist", "loader.mjs"); const server = path.join(repo, "scripts", "mcp-server.ts"); const tsconfig = path.join(repo, "tsconfig.json");
const problems = [];
for (const [what, p] of [["the tsx loader (run npm ci in this folder first)", loader], ["the connector script", server], ["tsconfig.json", tsconfig]]) if (!fs.existsSync(p)) problems.push(`Missing ${what}: ${p}`);
const entry = { command: process.execPath, args: ["--import", pathToFileURL(loader).href, server], env: { JARVIS_MCP_MODE: "personal", JARVIS_DATA_DIR: dataDir, TSX_TSCONFIG_PATH: tsconfig } };
const db = path.join(dataDir, "personal", "jarvis.db");
console.log("Jarvis personal connector, resolved on this computer\n");
console.log(`  folder        ${repo}`); console.log(`  node          ${process.execPath}`); console.log(`  data folder   ${dataDir}`);
console.log(`  private data  ${fs.existsSync(db) ? `found (${db})` : `not created yet. It appears the first time you open the private workspace in the app (${db})`}`);
console.log(`  config file   ${configPath}${fs.existsSync(configPath) ? "" : " (does not exist yet; it will be created)"}\n`);
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
if (!process.env.JARVIS_DATA_DIR) console.log("  Note: your app and worker use this same folder when you start them from here with plain `npm run dev` and `npm run worker`.\n  If you start them with JARVIS_DATA_DIR set to somewhere else, pass that folder here with --data.\n");

let existing = {}; let raw = null;
if (fs.existsSync(configPath)) { raw = fs.readFileSync(configPath, "utf8"); try { existing = raw.trim() ? JSON.parse(raw) : {}; } catch (e) { console.error(`Your Claude Desktop config is not valid JSON, so nothing was touched: ${e.message}`); process.exit(1); } }
const merged = { ...existing, mcpServers: { ...(existing.mcpServers ?? {}), "jarvis-personal": entry } };
const others = Object.keys(existing.mcpServers ?? {}).filter((k) => k !== "jarvis-personal");

if (flag("--check")) {
  const child = spawn(entry.command, entry.args, { env: { ...process.env, ...entry.env }, stdio: ["pipe", "pipe", "pipe"] }); let buf = ""; let err = ""; const done = (ok, msg) => { try { child.kill(); } catch {} console.log(ok ? `OK: ${msg}` : `FAILED: ${msg}`); process.exit(ok ? 0 : 1); };
  child.stderr.on("data", (d) => (err += d)); child.stdout.on("data", (d) => { buf += d; for (const line of buf.split("\n")) { if (!line.trim()) continue; try { const m = JSON.parse(line); if (m.id === 2 && m.result) { const names = m.result.tools.map((t) => t.name); const need = ["get_result", "submit_goal", "get_reader_task", "submit_reader_result"].filter((n) => !names.includes(n)); done(!need.length, need.length ? `connector started but is missing tools: ${need.join(", ")}` : `the personal connector started and offers ${names.length} tools (${names.slice(0, 6).join(", ")}, …). Mode: private workspace.`); } } catch { /* partial line */ } } });
  child.on("exit", (c) => done(false, `the connector stopped (${c}). ${err.slice(-400)}`)); setTimeout(() => done(false, `no answer in 20 seconds. ${err.slice(-400)}`), 20000);
  const send = (o) => child.stdin.write(JSON.stringify(o) + "\n"); send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "jarvis-desktop-config-check", version: "1" } } });
  setTimeout(() => { send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }); }, 1500);
} else if (flag("--write")) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let backup = null; if (raw !== null) { backup = `${configPath}.bak-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`; fs.writeFileSync(backup, raw); }
  const tmp = `${configPath}.tmp-${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n"); fs.renameSync(tmp, configPath);
  console.log(backup ? `Backed up your config to ${backup}` : "There was no config yet; created one."); console.log(`Added mcpServers["jarvis-personal"]. Left alone: ${others.length ? others.join(", ") : "(no other servers)"} and every other setting.`);
  console.log("\nNow quit Claude Desktop completely (⌘Q) and open it again. Then run: node scripts/desktop-config.mjs --check   (optional)");
} else {
  console.log('Add this to the "mcpServers" object in Claude Desktop (or run again with --write to have it merged for you, with a backup):\n');
  console.log(JSON.stringify({ "jarvis-personal": entry }, null, 2));
  console.log(`\nYour other servers stay as they are: ${others.length ? others.join(", ") : "(none found)"}.`);
  console.log("Nothing was changed. Use --write to apply it, or --check to test the connector first.");
}
