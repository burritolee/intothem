-- 나는학교 공개 이메일 가입 전환
-- Supabase SQL Editor에서 프런트엔드 변경보다 먼저 실행합니다.

begin;

-- 이메일 링크를 실제로 확인하고 나는학교에 들어온 사용자만 기본 그룹에 가입시킵니다.
-- auth.users 전역 트리거를 사용하지 않아 같은 Auth를 쓰는 다른 서비스와 분리됩니다.
create or replace function public.ensure_naneun_school_membership()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_membership_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;

  if not exists (
    select 1
    from auth.users as users
    where users.id = v_user_id
      and users.email is not null
      and users.email_confirmed_at is not null
  ) then
    raise exception 'verified email required'
      using errcode = '28000';
  end if;

  select groups.id
  into v_group_id
  from public.school_groups as groups
  join public.school_projects as projects
    on projects.id = groups.project_id
  where projects.slug = 'naneun-school'
    and projects.is_active = true
    and groups.slug = 'cohort-1'
    and groups.is_active = true;

  if v_group_id is null then
    raise exception 'default school group is unavailable'
      using errcode = 'P0002';
  end if;

  insert into public.school_memberships as memberships (
    user_id,
    group_id,
    real_name,
    nickname,
    role,
    status,
    joined_at
  )
  values (
    v_user_id,
    v_group_id,
    '가입 후 입력',
    '새회원-' || pg_catalog.substr(pg_catalog.replace(v_user_id::text, '-', ''), 1, 6),
    'member',
    'active',
    pg_catalog.now()
  )
  on conflict (user_id, group_id) do update
  set status = 'active',
      joined_at = coalesce(memberships.joined_at, excluded.joined_at),
      updated_at = pg_catalog.now()
  -- 초대 상태만 활성화합니다. 정지·탈퇴 사용자는 스스로 복구할 수 없습니다.
  where memberships.status = 'invited'
  returning memberships.id into v_membership_id;

  if v_membership_id is null then
    select memberships.id
    into v_membership_id
    from public.school_memberships as memberships
    where memberships.user_id = v_user_id
      and memberships.group_id = v_group_id;
  end if;

  return v_membership_id;
end;
$$;

revoke all on function public.ensure_naneun_school_membership() from public, anon;
grant execute on function public.ensure_naneun_school_membership() to authenticated;

-- 일반 회원에게 멤버십 행 전체 UPDATE를 열지 않고 본인의 이름만 바꾸게 합니다.
create or replace function public.update_own_school_profile(
  p_membership_id uuid,
  p_real_name text,
  p_nickname text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_real_name text := pg_catalog.btrim(p_real_name);
  v_nickname text := pg_catalog.btrim(p_nickname);
  v_membership_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;

  if v_real_name is null or pg_catalog.char_length(v_real_name) not between 2 and 30 then
    raise exception 'invalid real name'
      using errcode = '22023';
  end if;

  if v_nickname is null or pg_catalog.char_length(v_nickname) not between 1 and 20 then
    raise exception 'invalid nickname'
      using errcode = '22023';
  end if;

  update public.school_memberships
  set real_name = v_real_name,
      nickname = v_nickname,
      updated_at = pg_catalog.now()
  where id = p_membership_id
    and user_id = v_user_id
    and status = 'active'
  returning id into v_membership_id;

  if v_membership_id is null then
    raise exception 'active membership not found'
      using errcode = '42501';
  end if;

  return v_membership_id;
end;
$$;

revoke all on function public.update_own_school_profile(uuid, text, text) from public, anon;
grant execute on function public.update_own_school_profile(uuid, text, text) to authenticated;

-- 작성자가 API로 시스템 필드와 정렬 시간을 바꾸지 못하게 고정합니다.
create or replace function public.enforce_school_post_system_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.now();
  else
    new.group_id := old.group_id;
    new.author_membership_id := old.author_membership_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists enforce_school_post_system_fields on public.school_posts;
create trigger enforce_school_post_system_fields
before insert or update on public.school_posts
for each row execute function public.enforce_school_post_system_fields();

create or replace function public.enforce_school_comment_system_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.now();
  else
    new.post_id := old.post_id;
    new.author_membership_id := old.author_membership_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists enforce_school_comment_system_fields on public.school_comments;
create trigger enforce_school_comment_system_fields
before insert or update on public.school_comments
for each row execute function public.enforce_school_comment_system_fields();

-- 공개 가입 전환 후 일반 회원이 API로 공지·고정·숨김 상태를 위조하지 못하게 합니다.
drop policy if exists "active members create own posts" on public.school_posts;
create policy "active members create own posts"
on public.school_posts for insert to authenticated
with check (
  public.is_active_school_member(group_id)
  and author_membership_id = public.current_school_membership(group_id)
  and is_hidden = false
  and hidden_by is null
  and hidden_reason is null
  and hidden_at is null
  and (
    public.can_manage_school_group(group_id)
    or (category <> 'notice' and is_pinned = false)
  )
);

drop policy if exists "authors update own posts" on public.school_posts;
create policy "authors update own posts"
on public.school_posts for update to authenticated
using (
  author_membership_id = public.current_school_membership(group_id)
  and is_hidden = false
)
with check (
  author_membership_id = public.current_school_membership(group_id)
  and (
    public.can_manage_school_group(group_id)
    or (
      category <> 'notice'
      and is_pinned = false
      and is_hidden = false
      and hidden_by is null
      and hidden_reason is null
      and hidden_at is null
    )
  )
);

drop policy if exists "members create own comments" on public.school_comments;
create policy "members create own comments"
on public.school_comments for insert to authenticated
with check (
  is_hidden = false
  and hidden_by is null
  and hidden_reason is null
  and hidden_at is null
  and exists (
    select 1
    from public.school_posts as posts
    where posts.id = school_comments.post_id
      and posts.is_hidden = false
      and school_comments.author_membership_id = public.current_school_membership(posts.group_id)
  )
);

drop policy if exists "authors manage own comments" on public.school_comments;
drop policy if exists "authors update own comments" on public.school_comments;
create policy "authors update own comments"
on public.school_comments for update to authenticated
using (
  exists (
    select 1
    from public.school_posts as posts
    where posts.id = school_comments.post_id
      and school_comments.author_membership_id = public.current_school_membership(posts.group_id)
  )
)
with check (
  is_hidden = false
  and hidden_by is null
  and hidden_reason is null
  and hidden_at is null
  and exists (
    select 1
    from public.school_posts as posts
    where posts.id = school_comments.post_id
      and school_comments.author_membership_id = public.current_school_membership(posts.group_id)
  )
);

drop policy if exists "authors delete own comments" on public.school_comments;
create policy "authors delete own comments"
on public.school_comments for delete to authenticated
using (
  exists (
    select 1
    from public.school_posts as posts
    where posts.id = school_comments.post_id
      and school_comments.author_membership_id = public.current_school_membership(posts.group_id)
  )
);

-- Storage 경로(group_id/post_id/file)가 접근 가능한 실제 글을 가리키는지 확인합니다.
-- UUID 캐스트를 피해서 다른 버킷의 임의 경로도 정책 평가 중 오류를 만들지 않게 합니다.
drop policy if exists "members download group resources" on storage.objects;
create policy "members download group resources"
on storage.objects for select to authenticated
using (
  bucket_id = 'school-resources'
  and pg_catalog.cardinality(storage.foldername(name)) = 2
  and exists (
    select 1
    from public.school_posts as posts
    where posts.id::text = (storage.foldername(name))[2]
      and posts.group_id::text = (storage.foldername(name))[1]
      and posts.is_hidden = false
      and (
        public.is_active_school_member(posts.group_id)
        or (
          posts.visibility = 'project'
          and public.is_project_school_member(posts.group_id)
        )
      )
  )
);

drop policy if exists "members upload group resources" on storage.objects;
create policy "members upload group resources"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'school-resources'
  and pg_catalog.cardinality(storage.foldername(name)) = 2
  and exists (
    select 1
    from public.school_posts as posts
    where posts.id::text = (storage.foldername(name))[2]
      and posts.group_id::text = (storage.foldername(name))[1]
      and posts.is_hidden = false
      and posts.author_membership_id = public.current_school_membership(posts.group_id)
  )
);

drop policy if exists "members delete own uploaded resources" on storage.objects;
create policy "members delete own uploaded resources"
on storage.objects for delete to authenticated
using (
  bucket_id = 'school-resources'
  and owner_id = auth.uid()::text
);

commit;
