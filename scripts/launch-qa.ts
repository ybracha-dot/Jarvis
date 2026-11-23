/* Launcher QA on DISPOSABLE installs (paths with spaces), never touching a real data folder.
   Run: npx tsx scripts/launch-qa.ts      (needs a build: npm run build)
   Covers: start, relaunch, status/same-workspace/build id, stop and restart, an unrelated app on the port, an earlier Jarvis on the port,
   missing dependencies, a stale build, and an upgrade of an older install that holds a saved result (old folder byte-identical). */
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.cwd());
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis launch qa "));
const NEW = path.join(BASE, "Jarvis New (this one)"), OLD = path.join(BASE, "Jarvis Old ZIP");
let pass = 0; const problems: string[] = [];
const ok = (c: unknown, m: string) => { if (c) { pass++; console.log(`  ok   ${m}`); } else { problems.push(m); console.log(`  FAIL ${m}`); } };
const step = (s: string) => console.log(`\n# ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bystanders: ChildProcess[] = [];
const servers: http.Server[] = [];

function copyInstall(dest: string, deps = true) {
  fs.cpSync(ROOT, dest, { recursive: true, preserveTimestamps: true, filter: (src) => { const rel = path.relative(ROOT, src); return !/^(node_modules|\.git|data|docs[\\/]screenshots|tsconfig\.tsbuildinfo)(\/|$)/.test(rel); } });
  if (deps) fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dest, "node_modules"));
}
function launcher(install: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [path.join(install, "scripts", "jarvis.mjs"), ...args], { cwd: install, encoding: "utf8", env: { ...process.env, ...env }, timeout: 240000 });
  return { out: `${r.stdout}${r.stderr}`, code: r.status ?? -1 };
}
const health = async (port: number) => { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) }); return (await r.json()) as any; } catch { return null; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const portOf = (out: string) => Number(/http:\/\/127\.0\.0\.1:(\d+)\s+healthy/.exec(out)?.[1] ?? 0);
const pidsOf = (out: string) => ({ app: Number(/App\s+pid (\d+)/.exec(out)?.[1] ?? 0), worker: Number(/Worker\s+pid (\d+)/.exec(out)?.[1] ?? 0) });
function treeHash(dir: string, skip = /\/run(\/|$)/) { const h = crypto.createHash("sha256"); const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (skip.test(p)) continue; if (e.isDirectory()) walk(p); else if (!/-(wal|shm)$/.test(e.name)) { h.update(path.relative(dir, p)); h.update(fs.readFileSync(p)); } } }; walk(dir); return h.digest("hex"); }
const git = spawnSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();

async function main() {
  console.log(`Disposable installs in: ${BASE}`);
  copyInstall(NEW); copyInstall(OLD);
  const P = 3400;

  step("Start: app and worker, one command, a path with spaces");
  const a = launcher(NEW, ["--no-open", "--port", String(P)]);
  ok(a.code === 0, `start exits 0 (${a.code})`);
  const first = pidsOf(a.out);
  ok(portOf(a.out) === P && first.app > 0 && first.worker > 0, `reports app pid ${first.app}, worker pid ${first.worker} on port ${P}`);
  ok(/app and worker are on the same workspace/.test(a.out), "says the app and worker are on the same workspace");
  ok(/build [0-9a-f]{7}\+?/.test(a.out), "shows a short build identifier");
  const h = await health(P);
  ok(h?.app === "jarvis" && /Jarvis New/.test(h.root) && h.workspaces.personal.worker.running && h.workspaces.personal.worker.sameDataFolder === true, "/api/health agrees: this install, worker beating on the same data folder");
  ok(/\/open\/private/.test(a.out), "prints the private Today address");
  const open = await fetch(`http://127.0.0.1:${P}/open/private`, { redirect: "manual" });
  ok(open.status === 303 && /jarvis_mode=personal/.test(open.headers.get("set-cookie") ?? "") && new URL(open.headers.get("location")!).pathname === "/", "the private-Today address selects the private workspace and lands on Today");
  const cross = await fetch(`http://127.0.0.1:${P}/open/private`, { redirect: "manual", headers: { "sec-fetch-site": "cross-site" } });
  ok(cross.status === 403, "another website cannot use that address to switch the workspace");

  step("Relaunch while running: no second copy, same processes");
  const b = launcher(NEW, ["--no-open", "--port", String(P)]);
  const second = pidsOf(b.out);
  ok(b.code === 0 && /Already running/.test(b.out) && second.app === first.app && second.worker === first.worker, "a second launch reuses the running app and worker");
  const st = launcher(NEW, ["status", "--port", String(P)]);
  ok(/Jarvis is running/.test(st.out) && st.code === 0, "status reports it running");

  step("Restart and graceful stop");
  const r = launcher(NEW, ["restart", "--no-open", "--port", String(P)]);
  const third = pidsOf(r.out);
  ok(r.code === 0 && third.app !== first.app && third.worker !== first.worker && portOf(r.out) === P, "restart replaces both processes and keeps the port");
  ok(!alive(first.app) && !alive(first.worker), "the old processes are gone");
  const s = launcher(NEW, ["stop", "--port", String(P)]);
  await sleep(500);
  ok(/App: stopped/.test(s.out) && /Worker: stopped/.test(s.out) && !alive(third.app) && !alive(third.worker) && !(await health(P)), "stop ends the app and the worker and frees the port");
  const s2 = launcher(NEW, ["stop", "--port", String(P)]); ok(s2.code === 0 && /Nothing from this launcher/.test(s2.out), "stopping twice is harmless");

  step("Port occupied by another app: never touched");
  const other = http.createServer((_q, res) => res.end("not jarvis")); servers.push(other); await new Promise<void>((res) => other.listen(3410, "127.0.0.1", res));
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" }); bystanders.push(unrelated);
  const c = launcher(NEW, ["--no-open", "--port", "3410"]);
  ok(c.code === 0 && portOf(c.out) === 3411 && /another app/.test(c.out), `uses 3411 and says 3410 belongs to another app (${portOf(c.out)})`);
  ok((await (await fetch("http://127.0.0.1:3410/")).text()) === "not jarvis", "the other app on 3410 is still answering");
  launcher(NEW, ["stop", "--port", "3410"]); await sleep(300);
  ok((await (await fetch("http://127.0.0.1:3410/")).text()) === "not jarvis" && alive(unrelated.pid!), "stop left the other app and an unrelated process alone");

  step("Port occupied by an earlier Jarvis: left running, a different port is used");
  const o = launcher(OLD, ["--no-open", "--port", "3420"]); const oldPids = pidsOf(o.out);
  ok(o.code === 0 && portOf(o.out) === 3420, "the earlier install runs on 3420");
  const n = launcher(NEW, ["--no-open", "--port", "3420"]);
  ok(n.code === 0 && portOf(n.out) === 3421 && /another Jarvis/.test(n.out) && /Jarvis Old ZIP/.test(n.out), "the new install names the earlier one and uses 3421");
  const hOld = await health(3420); ok(hOld?.pid === oldPids.app && /Jarvis Old ZIP/.test(hOld.root), "the earlier Jarvis is the same process, unharmed");
  launcher(NEW, ["stop", "--port", "3420"]); await sleep(500);
  ok(alive(oldPids.app) && !!(await health(3420)), "stopping the new install did not stop the earlier Jarvis");
  const wrong = launcher(NEW, ["stop", "--port", "3420", "--data", path.join(NEW, "data")]);
  ok(/belongs to/.test(wrong.out) && alive(oldPids.app), "asked to stop a Jarvis that belongs to another folder, it refuses and says where it lives");
  launcher(OLD, ["stop", "--port", "3420"]); await sleep(500);
  ok(!alive(oldPids.app), "the earlier install stops from its own folder");

  step("Missing dependencies and a stale build");
  const bare = path.join(BASE, "Jarvis bare"); copyInstall(bare, false);
  const m = launcher(bare, ["--no-open", "--no-install", "--port", "3440"]);
  ok(m.code === 1 && /npm ci/.test(m.out) && !(await health(3440)), "no node_modules: it says exactly what to run and starts nothing");
  const stale = path.join(BASE, "Jarvis stale"); copyInstall(stale); fs.utimesSync(path.join(stale, "src", "lib", "db.ts"), new Date(Date.now() + 60000), new Date(Date.now() + 60000));
  const t = launcher(stale, ["--no-open", "--no-build", "--port", "3450"]);
  ok(t.code === 1 && /older than its source/.test(t.out) && !(await health(3450)), "source newer than the build: it says to rebuild and does not run stale code");
  const dr = launcher(NEW, ["doctor", "--port", "3460"]); ok(dr.code === 0 && /Node .* ok/.test(dr.out) && /Port 3460: free/.test(dr.out), "doctor checks without starting anything");

  step("A missed scheduled brief catches up once after a restart, and Today shows the last successful check");
  const catchData = path.join(BASE, "catchup-data"); fs.mkdirSync(catchData, { recursive: true });
  { // an install whose private schedule was due at 00:01 today while nothing was running (cursor set to yesterday)
    const first = launcher(NEW, ["--no-open", "--port", "3480", "--data", catchData]); const pids0 = pidsOf(first.out); launcher(NEW, ["stop", "--port", "3480", "--data", catchData]); await sleep(800);
    const dbp = path.join(catchData, "personal", "jarvis.db"); const { DatabaseSync: DS } = await import("node:sqlite"); const cdb = new DS(dbp);
    const put = (k: string, v: unknown) => cdb.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").run(k, JSON.stringify(v));
    put("brief_enabled", true); put("scheduler_enabled", true); put("check_times", ["00:01", "16:00"]); put("scheduler_cursor", new Date(Date.now() - 36 * 3600_000).toISOString()); cdb.close();
    void pids0;
    const again = launcher(NEW, ["--no-open", "--port", "3480", "--data", catchData]); ok(again.code === 0, "restart on the data that missed its morning slot");
    let today: any = null; for (let i = 0; i < 60 && !today?.lastSuccessAt; i++) { await sleep(1000); today = await (await fetch("http://127.0.0.1:3480/api/brief", { headers: { cookie: "jarvis_mode=personal" } })).json().catch(() => null); }
    ok(!!today?.lastSuccessAt && /^morning:/.test(today.occurrenceKey ?? ""), `the worker ran the missed morning brief on restart (${today?.occurrenceKey})`);
    ok(today?.recentMisses?.some((m: any) => /after its|Nothing ran for this slot/.test(m.detail ?? "")), "Today shows the gap instead of a silent success");
    launcher(NEW, ["stop", "--port", "3480", "--data", catchData]); await sleep(800);
    const count1 = ((new DS(dbp, { readOnly: true })).prepare("SELECT COUNT(*) n FROM brief_runs WHERE kind='scheduled'").get() as any).n;
    launcher(NEW, ["--no-open", "--port", "3480", "--data", catchData]); await sleep(12000); launcher(NEW, ["stop", "--port", "3480", "--data", catchData]); await sleep(800);
    const count2 = ((new DS(dbp, { readOnly: true })).prepare("SELECT COUNT(*) n FROM brief_runs WHERE kind='scheduled'").get() as any).n;
    ok(count1 === 1 && count2 === 1, `restarting again makes no second brief for the same slot (${count1} then ${count2})`);
  }

  step("Upgrade: an older install with a saved result, migrated explicitly, the old folder untouched");
  const old = launcher(OLD, ["--no-open", "--port", "3430"]); ok(old.code === 0, "the older install starts");
  const cookie = "jarvis_mode=personal"; const post = (p: string, body: unknown) => fetch(`http://127.0.0.1:3430/api${p}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3430", cookie }, body: JSON.stringify(body) });
  const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await post("/evidence/import", { kind: "note", title: "Essay 2 outline", text: `Essay 2 outline is due ${new Date(due + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })} at 11:59 PM. Bring a printed outline.`, at: new Date().toISOString(), label: "Notes" });
  const run = await (await post("/brief/run", {})).json(); ok(!run.error, "a brief (a saved result) is built in the older install");
  const results = (await (await fetch("http://127.0.0.1:3430/api/results", { headers: { cookie } })).json()).results as any[];
  const saved = results[0]; ok(!!saved?.id, `the older install holds a saved result (${saved?.id})`);
  const before = await (await fetch(`http://127.0.0.1:3430/api/results/${saved.id}`, { headers: { cookie } })).json();
  launcher(OLD, ["stop", "--port", "3430"]); await sleep(800);
  // Make the older database genuinely older: schema v9 (before the morning brief tables), as an earlier ZIP would hold.
  const oldDb = path.join(OLD, "data", "personal", "jarvis.db"); const { DatabaseSync } = await import("node:sqlite"); const dbh = new DatabaseSync(oldDb);
  for (const sql of ["DROP TABLE brief_runs", "DROP TABLE brief_feedback", "DROP TABLE claude_grants", "DROP TABLE share_log", "ALTER TABLE schedule_runs DROP COLUMN attempts", "ALTER TABLE schedule_runs DROP COLUMN detail", "ALTER TABLE reader_submissions DROP COLUMN origin", "ALTER TABLE reader_submissions DROP COLUMN transport", "ALTER TABLE reader_submissions DROP COLUMN confirmed_at", "ALTER TABLE reader_submissions DROP COLUMN confirmed_note", "DELETE FROM schema_migrations WHERE version>9"]) dbh.exec(sql);
  dbh.exec("PRAGMA wal_checkpoint(TRUNCATE)"); dbh.close();
  const oldHash = treeHash(path.join(OLD, "data")); const oldFolderHash = treeHash(OLD, /\/(run|node_modules|\.next)(\/|$)/);
  const up = launcher(NEW, ["upgrade", "--from", OLD]);
  ok(up.code === 0 && /Step 1 of 3/.test(up.out) && /schema v9 -> v1\d/.test(up.out) && /integrity ok/i.test(up.out), `upgrade reports the migration explicitly (${/schema v\d+ -> v\d+/.exec(up.out)?.[0]})`);
  ok(treeHash(path.join(OLD, "data")) === oldHash && treeHash(OLD, /\/(run|node_modules|\.next)(\/|$)/) === oldFolderHash, "the old ZIP folder and its database are byte-for-byte unchanged (backups were written beside the new install)");
  ok(fs.readdirSync(path.join(BASE, "Jarvis New (this one)", "jarvis-backups")).length >= 1 || fs.existsSync(path.join(NEW, "jarvis-backups")), "a hash-verified backup of the old data exists");
  const nu = launcher(NEW, ["--no-open", "--port", "3430"]); ok(nu.code === 0, "the new install starts on the migrated data");
  const after = await fetch(`http://127.0.0.1:3430/api/results/${saved.id}`, { headers: { cookie } }); const afterJson: any = await after.json();
  ok(after.status === 200 && afterJson.body === before.body && afterJson.title === before.title, "the saved result opens in the new install with the same body and title");
  launcher(NEW, ["stop", "--port", "3430"]);

  step("Example workspace stays intact");
  const demoOld = path.join(OLD, "data", "demo"); ok(fs.existsSync(path.join(demoOld, "jarvis.db")) && fs.existsSync(path.join(NEW, "data", "demo", "jarvis.db")), "the example workspace exists in both installs after the upgrade");
}

main().catch((e) => { problems.push(`crashed: ${e?.stack ?? e}`); console.log(e); }).finally(async () => {
  for (const i of [NEW, OLD]) launcher(i, ["stop"]);
  for (const sv of servers) sv.close(); for (const b of bystanders) { try { b.kill(); } catch { /* gone */ } }
  fs.rmSync(BASE, { recursive: true, force: true });
  console.log(`\n${pass} checks passed, ${problems.length} problems`); for (const p of problems) console.log(`  PROBLEM ${p}`);
  process.exit(problems.length ? 1 : 0);
});
void git;
