#!/usr/bin/env node
/* One entry point for Jarvis on a Mac (or any Unix). Plain Node, no dependencies, so it works before `npm ci`.

     node scripts/jarvis.mjs                  start the app AND its worker, check both, open private Today
     node scripts/jarvis.mjs status           is it running, which build, are app and worker on the same workspace
     node scripts/jarvis.mjs stop             stop only the app and worker THIS install started
     node scripts/jarvis.mjs restart          stop, then start
     node scripts/jarvis.mjs doctor           check everything without starting anything
     node scripts/jarvis.mjs upgrade --from <old Jarvis folder>   bring an older install's data here (the old folder is only read)

   Options: --port N (default 3000), --data DIR, --no-open, --no-install, --no-build, --force (with upgrade: keep what is here aside)

   Rules it keeps: it never signals a process it did not start and cannot prove is its own; a busy port is never taken from
   another app or another Jarvis (it picks the next free one and says so); an older database is backed up before it is migrated. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "start";
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const DATA = path.resolve(opt("data") ?? process.env.JARVIS_DATA_DIR ?? path.join(ROOT, "data"));
const RUN = path.join(DATA, "run");
const STATE = path.join(RUN, "launcher.json");
const PREFERRED = Number(opt("port") ?? process.env.PORT ?? 3000);
const NODE = process.execPath;
const say = (s = "") => console.log(s);
const warn = (s) => console.log(`  ! ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- small helpers ----------
function nodeOk() { const [a, b] = process.versions.node.split(".").map(Number); return a > 22 || (a === 22 && b >= 13); }
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return null; } };
const writeState = (s) => { fs.mkdirSync(RUN, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
function commandOf(pid) { const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : ""; }
/** Next retitles its server "next-server (v16...)", so the command line alone is not enough: also read the process's working folder. */
function cwdOf(pid) {
  try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { /* not Linux */ }
  const r = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout.split("\n").find((l) => l.startsWith("n")) ?? "").slice(1) : "";
}
/** A process is ours only if we recorded its pid AND it still runs from this install's folder. Anything else is left alone. */
const provablyOurs = (pid) => alive(pid) && (commandOf(pid).includes(ROOT) || path.resolve(cwdOf(pid) || "/nonexistent") === ROOT);

function getJson(port, p = "/api/health", ms = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: p, timeout: ms, headers: { accept: "application/json" } }, (res) => {
      let b = ""; res.on("data", (c) => { b += c; if (b.length > 200000) req.destroy(); });
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); }); req.on("error", () => resolve(null));
  });
}
function portFree(port) { return new Promise((resolve) => { const s = net.createServer(); s.once("error", () => resolve(false)); s.once("listening", () => s.close(() => resolve(true))); s.listen(port, "127.0.0.1"); }); }
/** free | jarvis(info) | other. A port that answers with something that is not Jarvis is never touched. */
async function probe(port) {
  if (await portFree(port)) return { kind: "free" };
  const r = await getJson(port);
  if (r?.json?.app === "jarvis") return { kind: "jarvis", info: r.json };
  return { kind: "other" };
}
const sameInstall = (info) => info && path.resolve(info.root ?? "") === ROOT && path.resolve(info.dataRoot ?? "") === DATA;

function newestMtime(dir, skip = new Set()) { let m = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (skip.has(e.name)) continue; const p = path.join(dir, e.name); m = Math.max(m, e.isDirectory() ? newestMtime(p, skip) : fs.statSync(p).mtimeMs); } return m; }
function buildState() {
  const id = path.join(ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(id)) return "missing";
  const built = fs.statSync(id).mtimeMs;
  const src = Math.max(newestMtime(path.join(ROOT, "src")), ...["package.json", "next.config.ts", "package-lock.json"].map((f) => fs.existsSync(path.join(ROOT, f)) ? fs.statSync(path.join(ROOT, f)).mtimeMs : 0));
  return src > built + 1000 ? "stale" : "fresh";
}
function runCmd(file, args, o = {}) { return spawnSync(file, args, { cwd: ROOT, stdio: "inherit", ...o }); }
const tsx = () => path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// ---------- checks shared by start and doctor ----------
async function checks({ install, build }) {
  const problems = [];
  say(`Jarvis folder: ${ROOT}`); say(`Data folder:   ${DATA}`);
  if (!nodeOk()) { problems.push(`Node ${process.versions.node} is too old. Jarvis needs Node 22.13 or newer. Install it from https://nodejs.org (or: brew install node), then run this again.`); return problems; }
  say(`Node ${process.versions.node}: ok`);
  const hasDeps = fs.existsSync(path.join(ROOT, "node_modules", "next", "package.json")) && fs.existsSync(tsx());
  if (!hasDeps) {
    if (!install) problems.push("Dependencies are not installed. Run: npm ci   (then run this again)");
    else { say("Installing dependencies (npm ci). This needs the internet once and takes a minute..."); const r = runCmd("npm", ["ci"]); if (r.status !== 0) problems.push("npm ci failed. Check your internet connection and run: npm ci"); }
  } else say("Dependencies: ok");
  if (problems.length) return problems;
  try { fs.mkdirSync(RUN, { recursive: true }); fs.accessSync(RUN, fs.constants.W_OK); say("Data folder is writable: ok"); } catch { problems.push(`Cannot write to ${DATA}. Check its permissions.`); return problems; }
  const b = buildState();
  if (b === "fresh") say("Build: up to date");
  else if (!build) problems.push(`The app is ${b === "missing" ? "not built yet" : "older than its source"}. Run: npm run build`);
  else { say(b === "missing" ? "Building the app (first run, about a minute)..." : "The source is newer than the last build. Rebuilding (about a minute)..."); const r = runCmd("npm", ["run", "build"], { env: { ...process.env, JARVIS_DATA_DIR: DATA } }); if (r.status !== 0) problems.push("The build failed. The output above says why."); }
  return problems;
}

function preflight() {
  const r = spawnSync(NODE, [tsx(), path.join(ROOT, "scripts", "preflight.ts")], { cwd: ROOT, encoding: "utf8", env: { ...process.env, JARVIS_DATA_DIR: DATA } });
  try { return JSON.parse(r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop()); } catch { return null; }
}
/** Migration is never silent: an older database is copied first, and the copy is named. */
function guardMigration() {
  const pf = preflight(); if (!pf) return;
  const old = pf.workspaces.filter((w) => w.exists && w.version < pf.latest);
  if (!old.length) return;
  say(`Your data is on an older schema (${old.map((w) => `${w.mode} v${w.version}`).join(", ")}); this version needs v${pf.latest}.`);
  const r = spawnSync(NODE, [tsx(), path.join(ROOT, "scripts", "backup.ts")], { cwd: ROOT, encoding: "utf8", env: { ...process.env, JARVIS_DATA_DIR: DATA } });
  if (r.status !== 0) { say(`Could not make a backup first, so nothing was migrated.\n${r.stderr || r.stdout}`); process.exit(1); }
  say(`Backed up before migrating: ${r.stdout.trim().split("\n")[0]}`);
  say("It will now migrate the database in place, one step at a time. To go back: npm run backup -- restore <that folder>");
}

// ---------- start ----------
function spawnLogged(name, file, args, env) {
  fs.mkdirSync(RUN, { recursive: true });
  const out = fs.openSync(path.join(RUN, `${name}.log`), "a");
  const child = spawn(file, args, { cwd: ROOT, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", out, out] });
  child.unref(); return child.pid;
}

async function summary(port) {
  const r = await getJson(port); const h = r?.json;
  if (!h) return null;
  const w = h.workspaces?.personal?.worker;
  return { h, w, same: sameInstall(h) && w?.running && w.sameDataFolder !== false };
}
function printSummary(port, st, s) {
  const w = s.w;
  say("");
  say(`Jarvis is running.   build ${s.h.build}${s.h.builtAt ? `  (built ${new Date(s.h.builtAt).toLocaleString()})` : ""}`);
  say(`  App        pid ${st?.app?.pid ?? s.h.pid}   http://127.0.0.1:${port}   healthy`);
  say(`  Worker     ${w?.running ? `pid ${w.pid}   heartbeat ${w.ageSec} s ago   healthy` : "NOT RUNNING (checks only run when you press Run now)"}`);
  const ws = s.h.workspaces?.personal?.id;
  say(`  Workspace  ${ws ?? "(created on first open)"}   ${s.same ? "app and worker are on the same workspace" : "!! the worker is not on this app's data folder"}`);
  say(`  Data       ${DATA}`);
  say(`  Logs       ${RUN}`);
}

function openBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(opener, args, { detached: true, stdio: "ignore" }).on("error", () => say(`Open this in your browser: ${url}`)).unref(); } catch { say(`Open this in your browser: ${url}`); }
}

async function start() {
  say("Starting Jarvis");
  const problems = await checks({ install: !flag("no-install"), build: !flag("no-build") });
  if (problems.length) { say(""); for (const p of problems) warn(p); process.exit(1); }

  // Already running from this install? Then this is just a relaunch: make sure the worker is there, open Today.
  let st = readState();
  if (st && !(provablyOurs(st.app?.pid))) st = null;
  let port = st?.port ?? null;
  if (port) { const p = await probe(port); if (p.kind === "jarvis" && sameInstall(p.info)) { say(`Already running on port ${port}; checking it instead of starting a second copy.`); } else { st = null; port = null; } }

  if (!st) {
    guardMigration();
    // Find a port without ever taking one that is in use.
    let chosen = null;
    for (let p = PREFERRED; p < PREFERRED + 10; p++) {
      const pr = await probe(p);
      if (pr.kind === "free") { chosen = p; break; }
      if (pr.kind === "jarvis" && sameInstall(pr.info)) { chosen = p; st = { port: p, adopted: true, app: { pid: pr.info.pid } }; break; }
      if (pr.kind === "jarvis") say(`Port ${p} is another Jarvis (${pr.info.root}, build ${pr.info.build}). Leaving it running and using the next port.`);
      else say(`Port ${p} is in use by another app. Leaving it alone and using the next port.`);
    }
    if (!chosen) { warn(`No free port from ${PREFERRED} to ${PREFERRED + 9}. Close something or pass --port.`); process.exit(1); }
    port = chosen;
    if (!st) {
      const env = { JARVIS_DATA_DIR: DATA, JARVIS_PUBLIC_URL: `http://127.0.0.1:${port}`, JARVIS_INAPP_RUNNER: "0" };
      const appPid = spawnLogged("app", NODE, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], env);
      st = { schema: 1, root: ROOT, data: DATA, port, startedAt: new Date().toISOString(), app: { pid: appPid }, worker: null };
      writeState(st);
    }
  }

  // Wait for the app, then make sure exactly one worker for this data folder is beating.
  let s = null;
  for (let i = 0; i < 90 && !s; i++) { await sleep(700); const r = await getJson(port); if (r?.json?.app === "jarvis") s = await summary(port); if (!alive(st.app?.pid) && !st.adopted) break; }
  if (!s) { warn(`The app did not answer on port ${port}. Its log: ${path.join(RUN, "app.log")}`); const t = spawnSync("tail", ["-n", "15", path.join(RUN, "app.log")], { encoding: "utf8" }); say(t.stdout); process.exit(1); }
  if (!s.w?.running || s.w.sameDataFolder === false) {
    if (st.worker && provablyOurs(st.worker.pid) && s.w?.running === false) { /* ours but silent: give it a moment below */ }
    else {
      const pid = spawnLogged("worker", NODE, [tsx(), path.join(ROOT, "scripts", "worker.ts")], { JARVIS_DATA_DIR: DATA, JARVIS_PUBLIC_URL: `http://127.0.0.1:${port}`, NEXT_PUBLIC_JARVIS_BUILD: s.h.build });
      st.worker = { pid, startedAt: new Date().toISOString() }; writeState(st);
    }
    for (let i = 0; i < 60; i++) { await sleep(700); s = await summary(port); if (s?.w?.running) break; }
  }
  st.build = s?.h.build; writeState(st);
  printSummary(port, st, s);
  if (!s?.w?.running) { warn(`The worker did not report in. Its log: ${path.join(RUN, "worker.log")}`); process.exit(1); }
  const url = `http://127.0.0.1:${port}/open/private`;
  say(`  Today      ${url}`);
  say("\nStop it with:   node scripts/jarvis.mjs stop        Status:   node scripts/jarvis.mjs status");
  if (!flag("no-open")) openBrowser(url);
}

// ---------- stop / status ----------
async function terminateGroup(pid, label) {
  if (!pid) return;
  if (!provablyOurs(pid)) { say(`  ${label}: pid ${pid} is not running (or is not this install's process). Left alone.`); return; }
  try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(250);
  if (alive(pid) && provablyOurs(pid)) { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } for (let i = 0; i < 12 && alive(pid); i++) await sleep(250); say(`  ${label}: did not stop gracefully in 10 s; ended.`); }
  else say(`  ${label}: stopped.`);
}
async function stop() {
  const st = readState();
  if (!st) {
    // No record (state file lost, or started by hand). If a Jarvis of THIS install and THIS data folder answers, it is ours to stop.
    const p = await probe(PREFERRED);
    if (p.kind === "jarvis" && sameInstall(p.info) && provablyOurs(p.info.pid)) {
      say("Stopping Jarvis (found by its health answer; the launcher's record was missing)");
      const hb = p.info.workspaces?.personal?.worker; if (hb?.running && hb.pid && provablyOurs(hb.pid)) await terminateGroup(hb.pid, "Worker");
      await terminateGroup(p.info.pid, "App"); return;
    }
    if (p.kind === "jarvis" && !sameInstall(p.info)) say(`The Jarvis on port ${PREFERRED} belongs to ${p.info.root} (data ${p.info.dataRoot}). Stop it from there.`);
    else say("Nothing from this launcher is running.");
    return;
  }
  say("Stopping Jarvis");
  await terminateGroup(st.worker?.pid, "Worker");
  await terminateGroup(st.app?.pid, "App");
  if (st.adopted) say("  (The app on this port was not started by this launcher, so it was left running.)");
  try { fs.rmSync(STATE); } catch { /* none */ }
}
async function status() {
  const st = readState();
  const port = st?.port ?? PREFERRED;
  const s = await summary(port);
  if (s && s.h) { printSummary(port, st, s); return; }
  const p = await probe(port);
  if (p.kind === "other") say(`Not running here. Port ${port} is used by another app.`);
  else if (p.kind === "jarvis") say(`Port ${port} is a different Jarvis (${p.info.root}, build ${p.info.build}).`);
  else say(`Jarvis is not running (port ${port} is free). Start it with: node scripts/jarvis.mjs`);
}

// ---------- upgrade ----------
async function upgrade() {
  const from = opt("from"); if (!from) { say("Usage: node scripts/jarvis.mjs upgrade --from <your older Jarvis folder>"); process.exit(2); }
  let src = path.resolve(from);
  if (fs.existsSync(path.join(src, "data"))) src = path.join(src, "data");
  if (!fs.existsSync(path.join(src, "personal")) && !fs.existsSync(path.join(src, "demo"))) { warn(`No Jarvis data found in ${from} (looked for a data folder with personal or demo inside).`); process.exit(1); }
  if (path.resolve(src) === DATA) { warn("That is this install's own data folder. Nothing to bring over."); process.exit(1); }
  const st = readState();
  if (st && provablyOurs(st.app?.pid)) { say("This Jarvis is running. Stopping it first so its database is not in use."); await stop(); }
  const problems = await checks({ install: !flag("no-install"), build: false });
  if (problems.length && !problems.every((p) => /not built|older than its source/.test(p))) { for (const p of problems) warn(p); process.exit(1); }
  say(`\nStep 1 of 3. Back up the OLD data (the old folder is only read; the copy is written beside THIS install).`);
  const b = spawnSync(NODE, [tsx(), path.join(ROOT, "scripts", "backup.ts")], { cwd: ROOT, encoding: "utf8", env: { ...process.env, JARVIS_DATA_DIR: src, JARVIS_BACKUP_DIR: path.join(DATA, "..", "jarvis-backups") } });
  if (b.status !== 0) { warn(`Backup failed, so nothing was changed.\n${b.stderr || b.stdout}`); process.exit(1); }
  say(b.stdout.trim().split("\n").slice(0, 2).join("\n"));
  say(`\nStep 2 of 3. Bring it into this install (any data already here is saved aside first).`);
  const a = spawnSync(NODE, [tsx(), path.join(ROOT, "scripts", "backup.ts"), "adopt", src, ...(flag("force") ? ["--force"] : [])], { cwd: ROOT, encoding: "utf8", env: { ...process.env, JARVIS_DATA_DIR: DATA } });
  say((a.stdout + a.stderr).replace(/\(node:\d+\)[^\n]*\n?|\(Use `node --trace[^\n]*\n?/g, "").trim());
  if (a.status !== 0) { warn("Nothing was migrated. The old folder is unchanged and so is this one."); process.exit(1); }
  say(`\nStep 3 of 3. Start it:   node scripts/jarvis.mjs`);
  say("The old install keeps working from its own folder; you can run both, one at a time or on different ports.");
}

// ---------- doctor ----------
async function doctor() {
  const problems = await checks({ install: false, build: false });
  const pf = fs.existsSync(tsx()) ? preflight() : null;
  if (pf) for (const w of pf.workspaces) say(`${w.mode} workspace: ${w.exists ? `schema v${w.version} of v${pf.latest}, ${w.records} records` : "not created yet"}`);
  const p = await probe(PREFERRED);
  say(`Port ${PREFERRED}: ${p.kind === "free" ? "free" : p.kind === "other" ? "used by another app (Jarvis will use the next port)" : `another Jarvis (${p.info.root}, build ${p.info.build})`}`);
  for (const x of problems) warn(x);
  process.exit(problems.length ? 1 : 0);
}

const table = { start, stop, status, doctor, upgrade, restart: async () => { await stop(); await start(); } };
if (!table[cmd]) { say(`Unknown command "${cmd}". Use: start, stop, restart, status, doctor, upgrade --from <folder>`); process.exit(2); }
table[cmd]().catch((e) => { console.error(`Stopped: ${e?.message ?? e}`); process.exit(1); });
