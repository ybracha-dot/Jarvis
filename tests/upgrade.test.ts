import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { openDb, SCHEMA_VERSION } from "@/lib/db";
import { backup, verifyBackup, restore, adopt } from "@/lib/backup";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-upg-"));
const treeHash = (dir: string) => { const h = crypto.createHash("sha256"); const w = (d: string) => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((e) => e.isDirectory() ? w(path.join(d, e.name)) : h.update(e.name).update(fs.readFileSync(path.join(d, e.name)))); w(dir); return h.digest("hex"); };
/** An installation as it was before this release: schema version 3, with the owner's real data. */
function oldInstall() {
  const root = tmp(); const dir = path.join(root, "data", "personal"); fs.mkdirSync(path.join(dir, "vault", "Preferences"), { recursive: true });
  const db = openDb(path.join(dir, "jarvis.db"), 3);
  db.prepare("INSERT INTO notes(id,owner_id,kind,folder,title,body,scope,source,sensitivity,confidence,provisional,aliases,user_edited,created_at,updated_at) VALUES('n1','owner','preference','Preferences','Study spot','Library, quiet floor','global','user','normal',1,0,'[]',1,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run();
  db.prepare("INSERT INTO notes_fts(id,title,body) VALUES('n1','Study spot','Library, quiet floor')").run();
  db.prepare("INSERT INTO commitments(id,owner_id,who,owed_to,action,status,created_at) VALUES('c1','owner','Yonathan','TAMID team','three pitch angles','open','2026-11-02T00:00:00Z')").run();
  db.close(); fs.writeFileSync(path.join(dir, "vault", "Preferences", "Study spot.md"), "---\nid: n1\n---\nLibrary, quiet floor\n");
  return path.join(root, "data");
}

describe("upgrade from the previous release", () => {
  it("adopts old data into a fresh folder: migrates the copy, keeps every record, and never touches the old folder", () => {
    const old = oldInstall(); const before = treeHash(old); const fresh = path.join(tmp(), "data");
    const r = adopt(old, fresh);
    expect(r.reports[0]).toMatchObject({ mode: "personal", schemaBefore: 3, schemaAfter: SCHEMA_VERSION(), integrity: "ok", counts: { notes: 1, commitments: 1 } });
    expect(treeHash(old)).toBe(before);                                                              // the old folder is byte-for-byte unchanged
    const db = openDb(path.join(fresh, "personal", "jarvis.db"));
    expect((db.prepare("SELECT body, project_id, pinned FROM notes WHERE id='n1'").get() as any)).toMatchObject({ body: "Library, quiet floor", project_id: null, pinned: 0 });
    expect((db.prepare("SELECT COUNT(*) n FROM notes_fts WHERE notes_fts MATCH 'quiet'").get() as any).n).toBe(1);   // search still works
    expect((db.prepare("SELECT action FROM commitments").get() as any).action).toBe("three pitch angles");
    expect((db.prepare("SELECT COUNT(*) n FROM projects").get() as any).n).toBe(0); db.close();
    expect(fs.existsSync(path.join(fresh, "personal", "vault", "Preferences", "Study spot.md"))).toBe(true);
  });
  it("refuses to overwrite existing personal data unless forced, and then keeps it aside", () => {
    const old = oldInstall(); const fresh = path.join(tmp(), "data");
    adopt(old, fresh);
    expect(() => adopt(old, fresh)).toThrow(/already has personal data/);
    const r = adopt(old, fresh, { force: true }); expect(r.savedAside && fs.existsSync(path.join(r.savedAside, "personal", "jarvis.db"))).toBe(true);
  });
  it("opening the old database in place also upgrades it without losing rows (the data-preserving path)", () => {
    const old = oldInstall(); const db = openDb(path.join(old, "personal", "jarvis.db"));
    expect((db.prepare("SELECT MAX(version) v FROM schema_migrations").get() as any).v).toBe(SCHEMA_VERSION());
    expect((db.prepare("SELECT COUNT(*) n FROM notes").get() as any).n).toBe(1); db.close();
  });
});

describe("backup and restore", () => {
  it("snapshots a live database, verifies it, detects tampering, and restores with a safety copy", () => {
    const data = oldInstall(); const out = path.join(tmp(), "backups");
    const b = backup(data, out); expect(verifyBackup(b.dir)).toMatchObject({ ok: true });
    fs.writeFileSync(path.join(data, "personal", "vault", "Preferences", "Study spot.md"), "changed after the backup");
    const r = restore(b.dir, data); expect(r.savedAside && fs.readFileSync(path.join(r.savedAside, "personal", "vault", "Preferences", "Study spot.md"), "utf8")).toBe("changed after the backup");
    expect(fs.readFileSync(path.join(data, "personal", "vault", "Preferences", "Study spot.md"), "utf8")).toMatch(/Library/);
    fs.appendFileSync(path.join(b.dir, "personal", "vault", "Preferences", "Study spot.md"), "tamper");
    expect(verifyBackup(b.dir).ok).toBe(false); expect(() => restore(b.dir, data)).toThrow(/not safe to restore/);
  });
});
