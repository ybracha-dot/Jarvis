import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// node:sqlite is a Node >=22.13 builtin. Loaded at runtime so bundlers do not try to resolve it.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
export type DB = InstanceType<typeof DatabaseSync>;

export type Mode = "demo" | "personal";
export const OWNER = "local";

export function dataRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.JARVIS_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data"));
}
export function modeDir(mode: Mode): string {
  return path.join(/*turbopackIgnore: true*/ dataRoot(), mode);
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
}
export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${crypto.createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 12)}`;
}
export function sha(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

const MIGRATIONS: string[] = [
  /* 1 core */ `
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE courses(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, external_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
  UNIQUE(owner_id, external_id));
CREATE TABLE sources(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, provider TEXT NOT NULL, external_id TEXT NOT NULL, uri TEXT,
  title TEXT NOT NULL, course_id TEXT REFERENCES courses(id), kind TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'course',
  first_seen_at TEXT NOT NULL, UNIQUE(owner_id, provider, external_id));
CREATE TABLE source_revisions(
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  hash TEXT NOT NULL, content_hash TEXT NOT NULL, text TEXT NOT NULL, published_at TEXT NOT NULL, observed_at TEXT NOT NULL,
  duplicate_of TEXT, stale INTEGER NOT NULL DEFAULT 0, UNIQUE(source_id, hash));
CREATE TABLE source_status(
  owner_id TEXT NOT NULL, provider TEXT NOT NULL, label TEXT NOT NULL, state TEXT NOT NULL,
  last_attempt_at TEXT, last_success_at TEXT, message TEXT, PRIMARY KEY(owner_id, provider));
CREATE TABLE tasks(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, course_id TEXT REFERENCES courses(id), external_id TEXT NOT NULL,
  title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'assignment', status TEXT NOT NULL DEFAULT 'open',
  effort_minutes INTEGER NOT NULL DEFAULT 60, due_at TEXT, due_tz TEXT NOT NULL DEFAULT 'America/New_York',
  original_due_at TEXT, next_step TEXT, parent_id TEXT REFERENCES tasks(id), milestone TEXT,
  meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, completed_at TEXT, deferred_until TEXT, status_reason TEXT,
  UNIQUE(owner_id, course_id, external_id));
CREATE TABLE task_due_history(
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, due_at TEXT NOT NULL,
  revision_id TEXT REFERENCES source_revisions(id), recorded_at TEXT NOT NULL, kind TEXT NOT NULL, note TEXT);
CREATE TABLE task_events(
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, at TEXT NOT NULL,
  kind TEXT NOT NULL, summary TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '{}');
CREATE TABLE requirements(
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision_id TEXT REFERENCES source_revisions(id), kind TEXT NOT NULL, text TEXT NOT NULL, quote TEXT NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active', detail TEXT NOT NULL DEFAULT '{}',
  waived_by TEXT, created_at TEXT NOT NULL, UNIQUE(task_id, kind, text));
CREATE TABLE blocks(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, tz TEXT NOT NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, task_id TEXT REFERENCES tasks(id), decision_id TEXT,
  source TEXT NOT NULL DEFAULT 'local', revision_id TEXT, idempotency_key TEXT UNIQUE,
  sync TEXT NOT NULL DEFAULT 'local-only', state TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
CREATE INDEX blocks_time ON blocks(owner_id, start_at, end_at);
CREATE TABLE decisions(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, dedup_key TEXT NOT NULL, task_id TEXT REFERENCES tasks(id),
  kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]',
  evidence TEXT NOT NULL DEFAULT '{}', urgency TEXT NOT NULL DEFAULT 'next_brief', urgency_reason TEXT,
  expires_at TEXT, state TEXT NOT NULL DEFAULT 'pending', resolution TEXT, created_at TEXT NOT NULL, resolved_at TEXT,
  UNIQUE(owner_id, dedup_key));
CREATE TABLE commitments(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, who TEXT NOT NULL, owed_to TEXT NOT NULL, action TEXT NOT NULL,
  agreement TEXT, due_date TEXT, status TEXT NOT NULL DEFAULT 'open', thread_id TEXT, delivery TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL, last_contact_at TEXT, next_check_at TEXT, resolution_evidence TEXT, accepted INTEGER NOT NULL DEFAULT 1);
CREATE TABLE commitment_events(
  id TEXT PRIMARY KEY, commitment_id TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE, at TEXT NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL, idempotency_key TEXT UNIQUE);
CREATE TABLE student_record(
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, history TEXT NOT NULL DEFAULT '[]');
CREATE TABLE runs(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, role TEXT NOT NULL, initiator TEXT NOT NULL, input_hash TEXT,
  provider_mode TEXT NOT NULL, model TEXT, effort TEXT, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
  usage TEXT, cost_estimate_usd REAL, failure TEXT, retry_key TEXT UNIQUE);
CREATE TABLE deliveries(
  id TEXT PRIMARY KEY, event_key TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, deliver_after TEXT, sent_at TEXT, receipt TEXT,
  UNIQUE(event_key, channel));
CREATE TABLE inbox(
  id TEXT PRIMARY KEY, at TEXT NOT NULL, level TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  decision_id TEXT, read INTEGER NOT NULL DEFAULT 0, event_key TEXT UNIQUE);
CREATE TABLE activity(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, summary TEXT NOT NULL);
CREATE TABLE schedule_runs(
  occurrence_key TEXT PRIMARY KEY, kind TEXT NOT NULL, scheduled_for TEXT NOT NULL, ran_at TEXT NOT NULL,
  status TEXT NOT NULL, summary TEXT, missed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE import_previews(token TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL);
`,
  /* 2 memory, skills, council, goals */ `
CREATE TABLE notes(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, folder TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global', source TEXT NOT NULL DEFAULT 'user', source_ref TEXT,
  effective_from TEXT, effective_to TEXT, sensitivity TEXT NOT NULL DEFAULT 'normal', confidence REAL NOT NULL DEFAULT 1,
  superseded_by TEXT, supersedes TEXT, tombstone INTEGER NOT NULL DEFAULT 0, user_edited INTEGER NOT NULL DEFAULT 0,
  auto_learn INTEGER NOT NULL DEFAULT 1, provisional INTEGER NOT NULL DEFAULT 0, aliases TEXT NOT NULL DEFAULT '[]',
  vault_hash TEXT, conflict TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, id UNINDEXED);
CREATE TABLE skills(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
  trigger_text TEXT NOT NULL, capabilities TEXT NOT NULL, instructions TEXT NOT NULL, features TEXT NOT NULL DEFAULT '[]',
  exclusions TEXT NOT NULL DEFAULT '[]', parent_version INTEGER, origin TEXT NOT NULL, correction_id TEXT,
  eval TEXT, created_at TEXT NOT NULL, promoted_at TEXT, UNIQUE(owner_id, name, version));
CREATE TABLE skill_uses(
  id TEXT PRIMARY KEY, skill_name TEXT NOT NULL, version INTEGER NOT NULL, task_id TEXT, at TEXT NOT NULL, reason TEXT NOT NULL,
  output_hash TEXT);
CREATE TABLE skill_corrections(
  id TEXT PRIMARY KEY, skill_name TEXT NOT NULL, version INTEGER, task_id TEXT, text TEXT NOT NULL, at TEXT NOT NULL,
  classification TEXT NOT NULL, outcome TEXT, UNIQUE(task_id, text));
CREATE TABLE council_sessions(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, preset TEXT NOT NULL, question TEXT NOT NULL, task_id TEXT, status TEXT NOT NULL,
  mode TEXT NOT NULL, input_hash TEXT NOT NULL, bundle TEXT NOT NULL, seats TEXT NOT NULL DEFAULT '[]', editor TEXT,
  notice TEXT, created_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE goals(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'count',
  completed REAL NOT NULL DEFAULT 0, target_total REAL NOT NULL, start_date TEXT NOT NULL, deadline TEXT NOT NULL,
  milestones TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', outcome TEXT, created_at TEXT NOT NULL);
CREATE TABLE goal_observations(id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE, at TEXT NOT NULL, value REAL NOT NULL, note TEXT);
CREATE TABLE checkpoints(
  id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), doc TEXT NOT NULL, section TEXT NOT NULL, question TEXT,
  next_step TEXT NOT NULL, est_minutes INTEGER NOT NULL DEFAULT 20, at TEXT NOT NULL);
CREATE TABLE practice_results(
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, area TEXT NOT NULL,
  correct INTEGER NOT NULL, total INTEGER NOT NULL, at TEXT NOT NULL, note TEXT);
CREATE TABLE time_logs(
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, planned_minutes INTEGER, actual_minutes INTEGER,
  started_at TEXT, ended_at TEXT, reason TEXT, flag TEXT, at TEXT NOT NULL);
CREATE TABLE advisor_sources(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, speaker TEXT NOT NULL, published TEXT, url TEXT,
  locator TEXT, rights TEXT NOT NULL, excerpt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ok', note TEXT, hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL);
`,
];

const cache = new Map<string, DB>();

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const row = db.prepare("SELECT MAX(version) v FROM schema_migrations").get() as { v: number | null };
  let v = row.v ?? 0;
  while (v < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.prepare("INSERT INTO schema_migrations VALUES(?, ?)").run(v + 1, new Date().toISOString());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    v++;
  }
}

export function getDb(mode: Mode): DB {
  const key = `${dataRoot()}::${mode}`;
  let db = cache.get(key);
  if (!db) {
    db = openDb(path.join(modeDir(mode), "jarvis.db"));
    cache.set(key, db);
  }
  return db;
}

export function closeDb(mode: Mode): void {
  const key = `${dataRoot()}::${mode}`;
  cache.get(key)?.close();
  cache.delete(key);
}

const depth = new WeakMap<object, number>();
/** Atomic block. Nested calls become savepoints, so domain functions can compose. */
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  const sp = `sp_${d}`;
  db.exec(d === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const out = fn();
    depth.set(db, d);
    db.exec(d === 0 ? "COMMIT" : `RELEASE ${sp}`);
    return out;
  } catch (e) {
    depth.set(db, d);
    db.exec(d === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export type Row = Record<string, any>;
export const all = (db: DB, sql: string, ...p: any[]): Row[] => db.prepare(sql).all(...p) as Row[];
export const get = (db: DB, sql: string, ...p: any[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;
export const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);

export function getSetting<T = string>(db: DB, key: string, fallback: T): T {
  const r = get(db, "SELECT value FROM settings WHERE key=?", key);
  if (!r) return fallback;
  try { return JSON.parse(r.value) as T; } catch { return fallback; }
}
export function setSetting(db: DB, key: string, value: unknown): void {
  run(db, "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JSON.stringify(value));
}

export interface Ctx { db: DB; mode: Mode; owner: string; now: () => Date; }

/** Context. In demo mode the clock is the stored demo clock. In personal mode it is the real clock. */
export function makeCtx(mode: Mode, opts: { db?: DB; owner?: string; now?: () => Date } = {}): Ctx {
  const db = opts.db ?? getDb(mode);
  const now = opts.now ?? (() => {
    if (mode === "demo") {
      const c = getSetting<string | null>(db, "demo_clock", null);
      if (c) return new Date(c);
    }
    return new Date();
  });
  return { db, mode, owner: opts.owner ?? OWNER, now };
}

export function logActivity(ctx: Ctx, kind: string, ref: string | null, summary: string): void {
  run(ctx.db, "INSERT INTO activity(at,kind,ref,summary) VALUES(?,?,?,?)", ctx.now().toISOString(), kind, ref, summary);
}
