-- Jarvis hosted backend (optional). Mirrors the local SQLite domain model.
-- Every row has an owner. Row level security is on for every table, including join-style child tables and storage objects.
-- Service-role credentials stay server-side. The browser only ever holds a user JWT.
-- Verified against an in-process Postgres in tests/rls.test.ts. Not verified against a hosted Supabase project.

create table courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  external_id text not null, code text not null, name text not null
);
create unique index courses_owner_external on courses(owner_id, external_id);

create table sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  provider text not null, external_id text not null, uri text, title text not null,
  course_id uuid references courses(id) on delete set null, kind text not null,
  first_seen_at timestamptz not null default now()
);
create unique index sources_owner_provider_external on sources(owner_id, provider, external_id);

create table source_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  source_id uuid not null references sources(id) on delete cascade,
  hash text not null, content_hash text not null, body text not null,
  published_at timestamptz not null, observed_at timestamptz not null default now(),
  duplicate_of uuid references source_revisions(id), stale boolean not null default false
);
create unique index revisions_owner_source_hash on source_revisions(owner_id, source_id, hash);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  course_id uuid references courses(id), external_id text not null, title text not null, kind text not null default 'assignment',
  status text not null default 'open', effort_minutes int not null default 60, due_at timestamptz, due_tz text not null default 'America/New_York',
  original_due_at timestamptz, next_step text, parent_id uuid references tasks(id), created_at timestamptz not null default now(), completed_at timestamptz
);
-- Identity is course plus external id, never the title.
create unique index tasks_owner_course_external on tasks(owner_id, course_id, external_id);

create table task_due_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  task_id uuid not null references tasks(id) on delete cascade,
  due_at timestamptz not null, revision_id uuid references source_revisions(id), kind text not null, recorded_at timestamptz not null default now()
);

create table requirements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  task_id uuid not null references tasks(id) on delete cascade,
  revision_id uuid references source_revisions(id), kind text not null, text text not null, quote text not null,
  mandatory boolean not null default true, status text not null default 'active'
);
create unique index requirements_owner_task_kind_text on requirements(owner_id, task_id, kind, text);

create table blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  start_at timestamptz not null, end_at timestamptz not null, tz text not null, kind text not null, title text not null,
  task_id uuid references tasks(id), decision_id uuid, idempotency_key text, sync text not null default 'local-only', state text not null default 'active',
  check (end_at > start_at)
);
create unique index blocks_owner_idempotency on blocks(owner_id, idempotency_key) where idempotency_key is not null;

create table decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  dedup_key text not null, task_id uuid references tasks(id), kind text not null, title text not null, summary text not null,
  evidence jsonb not null default '{}', urgency text not null default 'brief', state text not null default 'pending', resolution jsonb, created_at timestamptz not null default now()
);
create unique index decisions_owner_dedup on decisions(owner_id, dedup_key);

create table commitments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  who text not null, owed_to text not null, action text not null, due_date date, status text not null default 'open', resolution_evidence text
);
create table commitment_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  commitment_id uuid not null references commitments(id) on delete cascade, at timestamptz not null default now(), kind text not null, text text not null
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  kind text not null, folder text not null, title text not null, body text not null default '', scope text not null default 'global',
  sensitivity text not null default 'normal', confidence real not null default 1, superseded_by uuid references notes(id), tombstone boolean not null default false,
  search tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))) stored
);
create index notes_search on notes using gin(search);

-- ---- Row level security ----
do $$
declare t text;
begin
  foreach t in array array['courses','sources','source_revisions','tasks','task_due_history','requirements','blocks','decisions','commitments','commitment_events','notes']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for select to authenticated using (owner_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (owner_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (owner_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;

-- Child tables must also point at a parent the same user owns. Without this, a user could attach rows to someone else's task.
create policy task_due_history_parent on task_due_history as restrictive for insert to authenticated with check (exists (select 1 from tasks p where p.id = task_id and p.owner_id = auth.uid()));
create policy requirements_parent on requirements as restrictive for insert to authenticated with check (exists (select 1 from tasks p where p.id = task_id and p.owner_id = auth.uid()));
create policy revisions_parent on source_revisions as restrictive for insert to authenticated with check (exists (select 1 from sources p where p.id = source_id and p.owner_id = auth.uid()));
create policy commitment_events_parent on commitment_events as restrictive for insert to authenticated with check (exists (select 1 from commitments p where p.id = commitment_id and p.owner_id = auth.uid()));
create policy blocks_parent on blocks as restrictive for insert to authenticated with check (task_id is null or exists (select 1 from tasks p where p.id = task_id and p.owner_id = auth.uid()));

-- ---- Storage: the vault bucket. Objects live under <user id>/... and only that user can touch them. ----
-- (Supabase creates storage.objects. The policies below are the part Jarvis adds.)
create policy vault_select on storage.objects for select to authenticated using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy vault_insert on storage.objects for insert to authenticated with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy vault_update on storage.objects for update to authenticated using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy vault_delete on storage.objects for delete to authenticated using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
