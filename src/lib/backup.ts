// Backup, restore and adoption of a data folder. Plain files, hash-verified, never destructive:
// a backup copies, a restore first saves what it is about to replace, and adopting an old folder never touches that folder.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { openDb, SCHEMA_VERSION } from "./db";

const MODES = ["personal", "demo"] as const;
const DIRS = ["vault", "attachments", "skills"];
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const sha256 = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function walk(dir: string, base = dir): string[] { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]); }
function copyDir(from: string, to: string) { for (const rel of walk(from)) { fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true }); fs.copyFileSync(path.join(from, rel), path.join(to, rel)); } }

export interface Manifest { format: 1; createdAt: string; schemaVersion: number; modes: { mode: string; files: { path: string; sha256: string; bytes: number }[] }[] }

/** A consistent snapshot of every workspace in the data folder. SQLite is copied with VACUUM INTO so a running app cannot tear it. */
export function backup(dataRoot: string, outRoot = path.join(dataRoot, "..", "jarvis-backups")): { dir: string; manifest: Manifest } {
  const dir = path.join(outRoot, `jarvis-${stamp()}`); fs.mkdirSync(dir, { recursive: true });
  const manifest: Manifest = { format: 1, createdAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION(), modes: [] };
  for (const mode of MODES) {
    const src = path.join(dataRoot, mode); if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, mode); fs.mkdirSync(dst, { recursive: true });
    const dbFile = path.join(src, "jarvis.db");
    if (fs.existsSync(dbFile)) { const db = readOnly(dbFile); try { db.exec(`VACUUM INTO '${path.join(dst, "jarvis.db").replace(/'/g, "''")}'`); } finally { db.close(); } }
    for (const d of DIRS) copyDir(path.join(src, d), path.join(dst, d));
    manifest.modes.push({ mode, files: walk(dst).map((p) => ({ path: p, sha256: sha256(path.join(dst, p)), bytes: fs.statSync(path.join(dst, p)).size })) });
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { dir, manifest };
}

export function verifyBackup(dir: string): { ok: boolean; problems: string[]; manifest?: Manifest } {
  const mf = path.join(dir, "manifest.json"); if (!fs.existsSync(mf)) return { ok: false, problems: ["manifest.json is missing"] };
  const manifest = JSON.parse(fs.readFileSync(mf, "utf8")) as Manifest; const problems: string[] = [];
  for (const m of manifest.modes) for (const f of m.files) { const p = path.join(dir, m.mode, f.path); if (!fs.existsSync(p)) problems.push(`missing ${m.mode}/${f.path}`); else if (sha256(p) !== f.sha256) problems.push(`changed ${m.mode}/${f.path}`); }
  for (const m of manifest.modes) { const db = path.join(dir, m.mode, "jarvis.db"); if (fs.existsSync(db)) { const c = readOnly(db); try { const r = (c.prepare("PRAGMA integrity_check").get() as any).integrity_check; if (r !== "ok") problems.push(`${m.mode} database failed its integrity check`); } finally { c.close(); } } }
  return { ok: problems.length === 0, problems, manifest };
}

/** Restore replaces the chosen workspaces. What is there now is first copied aside, so a restore can itself be undone. */
export function restore(backupDir: string, dataRoot: string, modes: string[] = [...MODES]): { savedAside: string | null; restored: string[] } {
  const v = verifyBackup(backupDir); if (!v.ok) throw new Error(`Backup is not safe to restore: ${v.problems.join("; ")}`);
  const aside = path.join(dataRoot, "..", `jarvis-before-restore-${stamp()}`); let used = false; const restored: string[] = [];
  for (const m of v.manifest!.modes.filter((x) => modes.includes(x.mode))) {
    const cur = path.join(dataRoot, m.mode); if (fs.existsSync(cur)) { fs.mkdirSync(aside, { recursive: true }); fs.cpSync(cur, path.join(aside, m.mode), { recursive: true }); used = true; fs.rmSync(cur, { recursive: true, force: true }); }
    fs.mkdirSync(cur, { recursive: true }); copyDir(path.join(backupDir, m.mode), cur); restored.push(m.mode);
  }
  return { savedAside: used ? aside : null, restored };
}

export interface AdoptReport { mode: string; schemaBefore: number; schemaAfter: number; counts: Record<string, number>; integrity: string }
/** Bring an older Jarvis folder's data into this installation. The old folder is only read. The copy is migrated and checked. */
export function adopt(oldData: string, dataRoot: string, o: { force?: boolean } = {}): { reports: AdoptReport[]; savedAside: string | null } {
  if (!fs.existsSync(oldData)) throw new Error(`No data folder at ${oldData}`);
  if (path.resolve(oldData) === path.resolve(dataRoot)) throw new Error("That is already this installation's data folder. Nothing to adopt.");
  const reports: AdoptReport[] = []; let aside: string | null = null;
  const present = MODES.filter((m) => fs.existsSync(path.join(oldData, m)));
  if (present.length === 0) throw new Error("That folder has no personal or demo data inside.");
  for (const mode of present) {
    const dst = path.join(dataRoot, mode); const hasData = fs.existsSync(path.join(dst, "jarvis.db"));
    if (hasData && !o.force) {
      const c = openDb(path.join(dst, "jarvis.db")); const n = (c.prepare("SELECT (SELECT COUNT(*) FROM notes)+(SELECT COUNT(*) FROM commitments)+(SELECT COUNT(*) FROM tasks) n").get() as any).n; c.close();
      if (n > 0 && mode === "personal") throw new Error(`This installation already has personal data (${n} records). Re-run with --force to keep it aside and adopt the old data instead.`);
    }
    if (hasData) { aside = aside ?? path.join(dataRoot, "..", `jarvis-before-adopt-${stamp()}`); fs.mkdirSync(aside, { recursive: true }); fs.cpSync(dst, path.join(aside, mode), { recursive: true }); fs.rmSync(dst, { recursive: true, force: true }); }
    fs.mkdirSync(dst, { recursive: true });
    const src = path.join(oldData, mode); const srcDb = path.join(src, "jarvis.db");
    let before = 0;
    if (fs.existsSync(srcDb)) {
      // Never open the original: work on a private copy of its files (including an unfinished WAL), so the old folder stays byte-for-byte unchanged.
      const work = fs.mkdtempSync(path.join(dataRoot, "..", ".jarvis-adopt-")); const wdb = path.join(work, "jarvis.db");
      try {
        for (const ext of ["", "-wal"]) if (fs.existsSync(srcDb + ext)) fs.copyFileSync(srcDb + ext, wdb + ext);
        const c = new (Sqlite())(wdb); try { before = ((c.prepare("SELECT MAX(version) v FROM schema_migrations").get() as any).v ?? 0) as number; c.exec(`VACUUM INTO '${path.join(dst, "jarvis.db").replace(/'/g, "''")}'`); } finally { c.close(); }
      } finally { fs.rmSync(work, { recursive: true, force: true }); }
    }
    for (const d of DIRS) copyDir(path.join(src, d), path.join(dst, d));
    const db = openDb(path.join(dst, "jarvis.db")); // runs any missing migrations on the COPY
    try {
      const count = (t: string) => ((db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n as number);
      const integrity = (db.prepare("PRAGMA integrity_check").get() as any).integrity_check as string;
      const after = ((db.prepare("SELECT MAX(version) v FROM schema_migrations").get() as any).v ?? 0) as number;
      reports.push({ mode, schemaBefore: before, schemaAfter: after, integrity, counts: { notes: count("notes"), commitments: count("commitments"), tasks: count("tasks"), captures: count("captures"), documents: count("documents") } });
    } finally { db.close(); }
  }
  return { reports, savedAside: aside };
}
const Sqlite = (): typeof import("node:sqlite").DatabaseSync => (process as any).getBuiltinModule("node:sqlite").DatabaseSync;
const readOnly = (file: string) => new (Sqlite())(file, { readOnly: true });
