/* What the launcher needs to know before it starts anything: how new the code's schema is and how old each workspace's database is.
   Opens databases READ-ONLY, so looking never migrates. Prints one JSON line. */
import fs from "node:fs";
import path from "node:path";
import { dataRoot, SCHEMA_VERSION } from "../src/lib/db";
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
const root = dataRoot();
const workspaces = (["personal", "demo"] as const).map((mode) => {
  const file = path.join(root, mode, "jarvis.db");
  if (!fs.existsSync(file)) return { mode, exists: false, version: 0, records: 0 };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const version = ((db.prepare("SELECT MAX(version) v FROM schema_migrations").get() as any)?.v ?? 0) as number;
    const n = (t: string) => { try { return ((db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n as number) || 0; } catch { return 0; } };
    return { mode, exists: true, version, records: n("notes") + n("tasks") + n("commitments") + n("results") };
  } finally { db.close(); }
});
console.log(JSON.stringify({ latest: SCHEMA_VERSION(), root, workspaces }));
