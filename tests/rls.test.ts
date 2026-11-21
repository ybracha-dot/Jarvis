import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Real Postgres (WASM). Supabase's auth and storage helpers are stubbed the way Supabase defines them.
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
let db: PGlite;
const as = async (uid: string | null) => {
  await db.exec("reset role");
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  await db.exec(uid ? "set role authenticated" : "set role anon");
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth; create schema storage;
    create role anon nologin; create role authenticated nologin;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;   -- Supabase ships this table with RLS on
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    grant usage on schema auth, storage, public to anon, authenticated;
    grant execute on all functions in schema auth, storage to anon, authenticated;
    grant all on storage.objects to authenticated;
  `);
  await db.exec(fs.readFileSync(path.resolve("supabase/migrations/0001_jarvis.sql"), "utf8"));
  await db.exec("grant all on all tables in schema public to authenticated");
});

describe("hosted backend row level security", () => {
  it("every public table has RLS forced and four policies", async () => {
    const t = await db.query<any>(`select c.relname, c.relrowsecurity rls, c.relforcerowsecurity f, (select count(*) from pg_policies p where p.tablename=c.relname) n
      from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' order by 1`);
    expect(t.rows.length).toBe(11);
    for (const r of t.rows) { expect(r.rls, r.relname).toBe(true); expect(r.f, r.relname).toBe(true); expect(Number(r.n), r.relname).toBeGreaterThanOrEqual(4); }
  });

  it("user B cannot read, change or delete user A's rows; owner defaults to the caller", async () => {
    await as(A);
    const c = await db.query<any>("insert into courses(external_id, code, name) values ('ss201','SS201','Example') returning id, owner_id");
    expect(c.rows[0].owner_id).toBe(A);
    const t = await db.query<any>("insert into tasks(course_id, external_id, title) values ($1,'essay-2','Essay 2') returning id", [c.rows[0].id]);
    await db.query("insert into notes(kind, folder, title, body) values ('preference','Preferences','Secret plan','alpha beta')");
    await as(B);
    expect((await db.query("select * from tasks")).rows).toHaveLength(0);
    expect((await db.query("select * from notes")).rows).toHaveLength(0);
    expect((await db.query("select * from notes where search @@ to_tsquery('english','alpha')")).rows).toHaveLength(0);
    expect((await db.query("update tasks set title='hacked' where id=$1 returning id", [t.rows[0].id])).rows).toHaveLength(0);
    expect((await db.query("delete from tasks where id=$1 returning id", [t.rows[0].id])).rows).toHaveLength(0);
    await as(A);
    expect((await db.query<any>("select title from tasks")).rows[0].title).toBe("Essay 2");
  });

  it("B cannot insert a row claiming to be A's, nor attach children to A's task", async () => {
    await as(A);
    const task = (await db.query<any>("select id from tasks")).rows[0].id;
    await as(B);
    await expect(db.query("insert into notes(owner_id, kind, folder, title) values ($1,'inbox','Inbox','forged')", [A])).rejects.toThrow(/row-level security/);
    await expect(db.query("insert into requirements(task_id, kind, text, quote) values ($1,'bring_print','x','y')", [task])).rejects.toThrow(/row-level security/);
    await expect(db.query("insert into task_due_history(task_id, due_at, kind) values ($1, now(), 'moved')", [task])).rejects.toThrow(/row-level security/);
    await expect(db.query("insert into blocks(start_at,end_at,tz,kind,title,task_id) values (now(), now()+interval '1h','America/New_York','proposed','x',$1)", [task])).rejects.toThrow(/row-level security/);
    await as(A);
    await db.query("insert into requirements(task_id, kind, text, quote) values ($1,'bring_print','Bring a printed copy','Bring a printed excerpt')", [task]);
  });

  it("unique indexes are per user: the same external id works for two users, a duplicate for one user does not", async () => {
    await as(B);
    const c = (await db.query<any>("insert into courses(external_id, code, name) values ('ss201','SS201','Mine') returning id")).rows[0].id;
    await db.query("insert into tasks(course_id, external_id, title) values ($1,'essay-2','Essay 2')", [c]);
    await expect(db.query("insert into tasks(course_id, external_id, title) values ($1,'essay-2','Essay 2 again')", [c])).rejects.toThrow(/duplicate key/);
    await db.query("insert into decisions(dedup_key, kind, title, summary) values ('due:t:1','deadline_moved','t','s')");
    await expect(db.query("insert into decisions(dedup_key, kind, title, summary) values ('due:t:1','deadline_moved','t','s')")).rejects.toThrow(/duplicate key/);
    await as(A);
    await db.query("insert into decisions(dedup_key, kind, title, summary) values ('due:t:1','deadline_moved','t','s')");   // same key, other user: fine
  });

  it("one reservation per idempotency key; end must follow start", async () => {
    await as(A);
    await db.query("insert into blocks(start_at,end_at,tz,kind,title,idempotency_key) values ('2026-11-16T15:00Z','2026-11-16T16:00Z','America/New_York','proposed','w','reserve:d:0')");
    await expect(db.query("insert into blocks(start_at,end_at,tz,kind,title,idempotency_key) values ('2026-11-16T15:00Z','2026-11-16T16:00Z','America/New_York','proposed','w','reserve:d:0')")).rejects.toThrow(/duplicate key/);
    await expect(db.query("insert into blocks(start_at,end_at,tz,kind,title) values ('2026-11-16T16:00Z','2026-11-16T15:00Z','America/New_York','proposed','w')")).rejects.toThrow(/check/);
  });

  it("anonymous callers see nothing; storage objects are confined to the owner's folder", async () => {
    await as(null);
    // Supabase grants anon table access by default; with no anon policy the result is empty. Either outcome is safe.
    const anon = await db.query("select * from tasks").catch(() => ({ rows: [] as unknown[] }));
    expect(anon.rows).toHaveLength(0);
    await expect(db.query("insert into notes(owner_id, kind, folder, title) values ($1,'inbox','Inbox','anon')", [A])).rejects.toThrow();
    await as(A);
    await db.query("insert into storage.objects(bucket_id, name) values ('vault', $1)", [`${A}/Inbox/idea.md`]);
    await expect(db.query("insert into storage.objects(bucket_id, name) values ('vault', $1)", [`${B}/Inbox/forged.md`])).rejects.toThrow(/row-level security/);
    await as(B);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(0);
    expect((await db.query("delete from storage.objects returning id")).rows).toHaveLength(0);
  });
});
