/* Back up, verify, restore and adopt Jarvis data. Never deletes without saving a copy first.
   npm run backup                       snapshot to ../jarvis-backups/jarvis-<time>/
   npm run backup -- verify <folder>    check a snapshot
   npm run backup -- restore <folder>   restore (what is there now is copied aside first)
   npm run backup -- adopt <old data>   bring an older Jarvis folder's data here (the old folder is only read) [--force] */
import path from "node:path";
import { backup, verifyBackup, restore, adopt } from "../src/lib/backup";
const root = path.resolve(process.env.JARVIS_DATA_DIR || path.join(process.cwd(), "data"));
const [cmd, arg, ...rest] = process.argv.slice(2);
try {
  if (!cmd || cmd === "create") { const r = backup(root, process.env.JARVIS_BACKUP_DIR ? path.resolve(process.env.JARVIS_BACKUP_DIR) : undefined); const n = r.manifest.modes.reduce((a, m) => a + m.files.length, 0); const v = verifyBackup(r.dir); console.log(`Backup written: ${r.dir}\n${n} files, schema v${r.manifest.schemaVersion}. Verified: ${v.ok ? "yes" : "NO: " + v.problems.join("; ")}`); process.exit(v.ok ? 0 : 1); }
  else if (cmd === "verify" && arg) { const v = verifyBackup(path.resolve(arg)); console.log(v.ok ? "Backup is intact." : `Problems: ${v.problems.join("; ")}`); process.exit(v.ok ? 0 : 1); }
  else if (cmd === "restore" && arg) { const r = restore(path.resolve(arg), root); console.log(`Restored: ${r.restored.join(", ")}.${r.savedAside ? ` What was here is saved at ${r.savedAside}.` : ""}`); }
  else if (cmd === "adopt" && arg) { const r = adopt(path.resolve(arg), root, { force: rest.includes("--force") }); for (const x of r.reports) console.log(`${x.mode}: schema v${x.schemaBefore} -> v${x.schemaAfter}, integrity ${x.integrity}. ${Object.entries(x.counts).map(([k, v]) => `${v} ${k}`).join(", ")}.`); console.log(`The old folder was not changed.${r.savedAside ? ` Existing data here was saved at ${r.savedAside}.` : ""}`); }
  else { console.error("Usage: npm run backup [-- verify <folder> | restore <folder> | adopt <old data folder> [--force]]"); process.exit(2); }
} catch (e: any) { console.error(`Stopped: ${e.message}`); process.exit(1); }
