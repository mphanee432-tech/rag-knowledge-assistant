-- TEST ONLY: fresh disposable PostgreSQL, never an existing Supabase database.
-- The repo contains upgrade migrations, so model their legacy prerequisites here.
-- Cron/Vault/HTTP adapters support migration creation; they do not test those services.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
create schema extensions;
create schema vault;
create schema cron;
create schema net;
create extension vector with schema extensions;
-- Keep the disposable Auth stub aligned with the columns used by signup migrations.
create table auth.users(
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb
);
create function auth.uid() returns uuid language sql as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
-- TEST ONLY: emulate Supabase auth.jwt() for disposable PostgreSQL CI tests.
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
create table public.projects(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users,
  name text, suggested_queries jsonb, created_at timestamptz default now());
create table public.documents(id uuid primary key default gen_random_uuid(), project_id uuid references public.projects,
  storage_path text, status text, created_at timestamptz default now());
create table public.document_chunks(id uuid primary key default gen_random_uuid(), document_id uuid references public.documents,
  project_id uuid references public.projects, content text, metadata jsonb, embedding extensions.vector(1536),
  fts tsvector generated always as (to_tsvector('simple', content)) stored);
create table public.interactions(id uuid primary key default gen_random_uuid(), project_id uuid references public.projects,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating text, issue_tag text, user_comment text, query_text text, response_markdown text, retrieved_chunk_ids uuid[], latency_ms integer);
create table storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
insert into storage.buckets(id, public) values ('documents', true);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text);
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public, storage to anon, authenticated, service_role;
-- Deliberately permissive legacy policies: hardening must still prevent cross-user access.
create policy legacy_all on storage.objects for all to public using (true) with check (true);
create policy legacy_all on public.projects for all to public using (true) with check (true);
create policy legacy_all on public.documents for all to public using (true) with check (true);
create policy legacy_all on public.document_chunks for all to public using (true) with check (true);
create policy "Interactions tenant isolation policy" on public.interactions for all to public using (true) with check (true);
-- Representative legacy SECURITY DEFINER RPC; tests cover its grants, not search ranking.
create function public.match_chunks_hybrid_rrf(query_embedding extensions.vector, query_text text,
  target_project_id uuid, match_count integer default 5, rrf_k integer default 60) returns setof public.document_chunks
language sql security definer as $$ select * from public.document_chunks where project_id = target_project_id limit match_count $$;
create table vault.decrypted_secrets(id uuid primary key default gen_random_uuid(), name text unique, decrypted_secret text);
create function vault.create_secret(secret text, name text) returns uuid language sql as $$
  insert into vault.decrypted_secrets(name, decrypted_secret) values(name, secret) returning id $$;
create function vault.update_secret(secret_id uuid, secret text) returns void language sql as $$
  update vault.decrypted_secrets set decrypted_secret = secret where id = secret_id $$;
create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, job_schedule text, job_command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values(job_name, job_schedule, job_command) returning jobid $$;
create table net.http_request_queue(id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds integer);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 2000) returns bigint language sql as $$
  insert into net.http_request_queue(url, body, headers, timeout_milliseconds) values(url, body, headers, timeout_milliseconds) returning id $$;
