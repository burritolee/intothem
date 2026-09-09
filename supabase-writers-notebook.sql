-- 작가 계정은 scripts/writers-bootstrap.mjs가 숨은 Supabase Auth 사용자로
-- 생성/재사용합니다. 해당 UUID를 writer_profiles에 연결하고, PIN digest는
-- service_role만 실행할 수 있는 configure_writer_pin()으로 설정합니다.
--
-- PIN digest 계약:
--   HMAC-SHA-256(key = WRITER_PIN_PEPPER,
--               message = "writer-pin:v1:" || 네 자리 PIN)
--   결과는 lowercase hex 64자로 전달합니다.
-- PIN 원문과 WRITER_PIN_PEPPER는 이 SQL이나 공개 클라이언트에 넣지 않습니다.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists public.writer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(30) not null check (char_length(trim(display_name)) between 1 and 30),
  slot_number smallint not null unique check (slot_number between 1 and 5),
  public_slug varchar(64),
  bio varchar(200) not null default '',
  created_at timestamptz not null default now()
);

alter table public.writer_profiles add column if not exists public_slug varchar(64);

-- 기존 프로필도 안정적인 공개 식별자를 갖게 합니다. 운영에 이미 공유된 별칭이
-- 있다면 이 SQL 실행 전후에 원하는 public_slug로 명시적으로 교체할 수 있습니다.
update public.writer_profiles
set public_slug = case
  when slot_number = 1 then 'burrito-static'
  else 'writer-' || lpad(slot_number::text, 2, '0')
end
where public_slug is null;

alter table public.writer_profiles alter column public_slug set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'writer_profiles_public_slug_format_check'
      and conrelid = 'public.writer_profiles'::regclass
  ) then
    alter table public.writer_profiles
      add constraint writer_profiles_public_slug_format_check
      check (public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  end if;
end
$$;

create unique index if not exists writer_profiles_public_slug_key
  on public.writer_profiles (public_slug);

create table if not exists public.writer_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.writer_profiles(user_id) on delete cascade,
  slug varchar(120) not null default ('note-' || replace(gen_random_uuid()::text, '-', '')),
  title varchar(100) not null check (char_length(trim(title)) between 1 and 100),
  content varchar(5000) not null check (char_length(trim(content)) between 1 and 5000),
  is_public boolean not null default false,
  is_hidden boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.writer_notes add column if not exists slug varchar(120);
alter table public.writer_notes add column if not exists published_at timestamptz;
alter table public.writer_notes
  alter column slug set default ('note-' || replace(gen_random_uuid()::text, '-', ''));

-- Legacy/new metadata triggers are paused during one-time backfill so an existing
-- updated_at value is not rewritten merely because schema metadata was added.
drop trigger if exists writer_notes_set_updated_at on public.writer_notes;
drop trigger if exists writer_notes_set_metadata on public.writer_notes;

-- 기존 UUID 글은 UUID 문자열을 slug로 사용해 충돌 없이 backfill합니다.
update public.writer_notes set slug = id::text where slug is null;
update public.writer_notes set published_at = created_at where is_public = true and published_at is null;
update public.writer_notes set published_at = null where is_public = false and published_at is not null;

alter table public.writer_notes alter column slug set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'writer_notes_slug_format_check'
      and conrelid = 'public.writer_notes'::regclass
  ) then
    alter table public.writer_notes
      add constraint writer_notes_slug_format_check
      check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'writer_notes_publication_state_check'
      and conrelid = 'public.writer_notes'::regclass
  ) then
    alter table public.writer_notes
      add constraint writer_notes_publication_state_check
      check (
        (is_public = true and published_at is not null)
        or (is_public = false and published_at is null)
      );
  end if;
end
$$;

create unique index if not exists writer_notes_slug_key
  on public.writer_notes (slug);
drop index if exists public.writer_notes_public_latest_idx;
create index if not exists writer_notes_public_published_latest_idx
  on public.writer_notes (published_at desc, created_at desc)
  where is_public = true and is_hidden = false;
create index if not exists writer_notes_author_latest_idx
  on public.writer_notes (author_id, updated_at desc);

create or replace function public.set_writer_note_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at = now();
  end if;

  if new.is_public = true then
    if tg_op = 'INSERT' or old.is_public = false then
      new.published_at = coalesce(new.published_at, now());
    elsif new.published_at is null then
      new.published_at = old.published_at;
    end if;
  else
    new.published_at = null;
  end if;

  return new;
end;
$$;

drop function if exists public.set_writer_note_updated_at();
create trigger writer_notes_set_metadata
before insert or update on public.writer_notes
for each row execute function public.set_writer_note_metadata();
revoke all on function public.set_writer_note_metadata() from public, anon, authenticated;

-- PIN credential과 rate-limit 상태는 PostgREST에 공개하지 않습니다. 두 테이블은
-- RLS와 권한 회수를 함께 적용하고 SECURITY DEFINER RPC를 통해서만 접근합니다.
create table if not exists private.writer_pin_credentials (
  writer_id uuid primary key references public.writer_profiles(user_id) on delete cascade,
  pin_digest text not null unique
    check (pin_digest ~ '^[0-9a-f]{64}$'),
  is_enabled boolean not null default true,
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.writer_pin_rate_limits (
  rate_key text primary key
    check (rate_key ~ '^[0-9a-f]{64}$'),
  short_window_started_at timestamptz not null,
  short_attempt_count integer not null check (short_attempt_count >= 0),
  daily_window_started_at timestamptz not null,
  daily_attempt_count integer not null check (daily_attempt_count >= 0),
  updated_at timestamptz not null
);

create index if not exists writer_pin_rate_limits_updated_at_idx
  on private.writer_pin_rate_limits (updated_at);

alter table private.writer_pin_credentials enable row level security;
alter table private.writer_pin_rate_limits enable row level security;

revoke all on table private.writer_pin_credentials from public, anon, authenticated, service_role;
revoke all on table private.writer_pin_rate_limits from public, anon, authenticated, service_role;

create or replace function public.configure_writer_pin(
  p_writer_id uuid,
  p_pin_digest text,
  p_is_enabled boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_writer_id is null or not exists (
    select 1
    from public.writer_profiles as profiles
    where profiles.user_id = p_writer_id
  ) then
    raise exception 'unknown writer profile' using errcode = '22023';
  end if;

  if p_pin_digest is null or p_pin_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid PIN digest' using errcode = '22023';
  end if;

  insert into private.writer_pin_credentials as credentials (
    writer_id,
    pin_digest,
    is_enabled,
    configured_at,
    updated_at
  )
  values (p_writer_id, p_pin_digest, p_is_enabled, now(), now())
  on conflict (writer_id) do update
  set pin_digest = excluded.pin_digest,
      is_enabled = excluded.is_enabled,
      configured_at = excluded.configured_at,
      updated_at = excluded.updated_at;
end;
$$;

-- PIN 확인과 두 rate-limit window 갱신을 한 트랜잭션/한 row lock에서 처리합니다.
-- 모든 요청(성공 포함)을 15분 5회, 24시간 20회로 제한합니다.
create or replace function public.claim_writer_pin(
  p_pin_digest text,
  p_rate_key text
)
returns table (
  writer_id uuid,
  is_allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_short_started_at timestamptz;
  v_short_attempt_count integer;
  v_daily_started_at timestamptz;
  v_daily_attempt_count integer;
  v_writer_id uuid;
  v_retry_after_seconds integer;
begin
  if p_pin_digest is null or p_pin_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid PIN digest' using errcode = '22023';
  end if;

  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid rate key' using errcode = '22023';
  end if;

  insert into private.writer_pin_rate_limits as limits (
    rate_key,
    short_window_started_at,
    short_attempt_count,
    daily_window_started_at,
    daily_attempt_count,
    updated_at
  )
  values (p_rate_key, v_now, 1, v_now, 1, v_now)
  on conflict (rate_key) do update
  set short_window_started_at = case
        when limits.short_window_started_at + interval '15 minutes' <= v_now then v_now
        else limits.short_window_started_at
      end,
      short_attempt_count = case
        when limits.short_window_started_at + interval '15 minutes' <= v_now then 1
        else limits.short_attempt_count + 1
      end,
      daily_window_started_at = case
        when limits.daily_window_started_at + interval '24 hours' <= v_now then v_now
        else limits.daily_window_started_at
      end,
      daily_attempt_count = case
        when limits.daily_window_started_at + interval '24 hours' <= v_now then 1
        else limits.daily_attempt_count + 1
      end,
      updated_at = v_now
  returning
    limits.short_window_started_at,
    limits.short_attempt_count,
    limits.daily_window_started_at,
    limits.daily_attempt_count
  into
    v_short_started_at,
    v_short_attempt_count,
    v_daily_started_at,
    v_daily_attempt_count;

  if v_short_attempt_count > 5 or v_daily_attempt_count > 20 then
    v_retry_after_seconds := ceil(greatest(
      case
        when v_short_attempt_count > 5
          then extract(epoch from (v_short_started_at + interval '15 minutes' - v_now))
        else 0
      end,
      case
        when v_daily_attempt_count > 20
          then extract(epoch from (v_daily_started_at + interval '24 hours' - v_now))
        else 0
      end,
      1
    ))::integer;

    return query select null::uuid, false, v_retry_after_seconds;
    return;
  end if;

  select credentials.writer_id
  into v_writer_id
  from private.writer_pin_credentials as credentials
  where credentials.pin_digest = p_pin_digest
    and credentials.is_enabled = true;

  return query select v_writer_id, true, 0;
end;
$$;

revoke all on function public.configure_writer_pin(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.claim_writer_pin(text, text)
  from public, anon, authenticated;
grant execute on function public.configure_writer_pin(uuid, text, boolean)
  to service_role;
grant execute on function public.claim_writer_pin(text, text)
  to service_role;

alter table public.writer_profiles enable row level security;
alter table public.writer_notes enable row level security;

drop policy if exists "anyone can read writer profiles" on public.writer_profiles;
create policy "anyone can read writer profiles"
on public.writer_profiles for select to anon, authenticated
using (true);

drop policy if exists "public or owner can read writer notes" on public.writer_notes;
create policy "public or owner can read writer notes"
on public.writer_notes for select to anon, authenticated
using (is_hidden = false and (is_public = true or auth.uid() = author_id));

drop policy if exists "registered writer can create own notes" on public.writer_notes;
create policy "registered writer can create own notes"
on public.writer_notes for insert to authenticated
with check (
  auth.uid() = author_id
  and exists (
    select 1
    from public.writer_profiles as profiles
    where profiles.user_id = auth.uid()
  )
);

drop policy if exists "writer can update own visible notes" on public.writer_notes;
create policy "writer can update own visible notes"
on public.writer_notes for update to authenticated
using (auth.uid() = author_id and is_hidden = false)
with check (auth.uid() = author_id and is_hidden = false);

drop policy if exists "writer can delete own notes" on public.writer_notes;
create policy "writer can delete own notes"
on public.writer_notes for delete to authenticated
using (auth.uid() = author_id);

revoke all on table public.writer_profiles from public, anon, authenticated;
grant select (user_id, display_name, slot_number, public_slug, bio, created_at)
  on public.writer_profiles to anon, authenticated;
grant all on table public.writer_profiles to service_role;

revoke all on table public.writer_notes from public, anon, authenticated;
grant select (
  id,
  author_id,
  slug,
  title,
  content,
  is_public,
  published_at,
  created_at,
  updated_at
) on public.writer_notes to anon, authenticated;
grant insert (author_id, title, content, is_public)
  on public.writer_notes to authenticated;
grant update (title, content, is_public)
  on public.writer_notes to authenticated;
grant delete on public.writer_notes to authenticated;
grant all on table public.writer_notes to service_role;

-- 예시(실제 UUID, PIN 또는 digest를 저장소에 기록하지 마세요):
-- insert into public.writer_profiles
--   (user_id, display_name, slot_number, public_slug, bio)
-- values
--   ('AUTH-USER-UUID', '작가 이름', 1, 'public-writer-slug', '짧은 작가 소개');
-- select public.configure_writer_pin('AUTH-USER-UUID', 'LOWERCASE-HMAC-HEX');

commit;
