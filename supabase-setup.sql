-- Supabase > SQL Editor > New query > paste > replace YOUR_EMAIL (1 place, bottom) > Run.
-- Safe to run again. Fixes: "Could not find the table 'public.reviewers' in the schema cache".

create table if not exists public.reviewers (
  id text primary key, title text not null, subject text not null default 'Unsorted',
  text text not null default '', size integer not null default 0, added bigint not null, html text not null
);
create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(), title text not null, day date not null,
  color text not null default '#8b9bff', created_at timestamptz default now()
);
create table if not exists public.study_log (
  id bigint generated always as identity primary key, user_id uuid not null default auth.uid(),
  reviewer_id text, subject text not null default 'Unsorted', seconds integer not null, at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

alter table public.reviewers enable row level security;
alter table public.admins    enable row level security;
alter table public.events    enable row level security;
alter table public.study_log enable row level security;

drop policy if exists "anyone can read" on public.reviewers;
drop policy if exists "owner can insert" on public.reviewers;
drop policy if exists "owner can update" on public.reviewers;
drop policy if exists "owner can delete" on public.reviewers;
drop policy if exists "signed-in read" on public.reviewers;
drop policy if exists "admin write" on public.reviewers;
create policy "signed-in read" on public.reviewers for select to authenticated using (true);
create policy "admin write" on public.reviewers for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read own admin row" on public.admins;
create policy "read own admin row" on public.admins for select to authenticated using (user_id = auth.uid());

drop policy if exists "signed-in read" on public.events;
drop policy if exists "admin write" on public.events;
create policy "signed-in read" on public.events for select to authenticated using (true);
create policy "admin write" on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own read" on public.study_log;
drop policy if exists "own insert" on public.study_log;
create policy "own read" on public.study_log for select to authenticated using (user_id = auth.uid());
create policy "own insert" on public.study_log for insert to authenticated with check (user_id = auth.uid());

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(), message text not null, created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists "signed-in read" on public.announcements;
drop policy if exists "admin write" on public.announcements;
create policy "signed-in read" on public.announcements for select to authenticated using (true);
create policy "admin write" on public.announcements for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- live updates (toast when an admin posts an event or announcement)
do $$ begin alter publication supabase_realtime add table public.events; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.announcements; exception when others then null; end $$;

alter table public.events        add column if not exists kind  text not null default 'event';
alter table public.announcements add column if not exists title text not null default '';

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid(), display_name text not null default '', weekly_goal integer not null default 5
);
alter table public.profiles enable row level security;
drop policy if exists "own profile read" on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile read"   on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "own profile insert" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists onboarded boolean not null default false;

-- avatar pictures: public read, each user writes only inside their own folder (avatars/<user-id>/...)
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
drop policy if exists "avatars public read" on storage.objects;
drop policy if exists "avatars own insert" on storage.objects;
drop policy if exists "avatars own update" on storage.objects;
drop policy if exists "avatars own delete" on storage.objects;
create policy "avatars public read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars own insert" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars own update" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars own delete" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== Requests, generated reviewers, usage =====
alter table public.reviewers add column if not exists owner_id  uuid;
alter table public.reviewers add column if not exists template  text;
alter table public.reviewers add column if not exists theme     text;
alter table public.reviewers add column if not exists content   jsonb;
alter table public.reviewers add column if not exists is_public boolean not null default true;

drop policy if exists "signed-in read" on public.reviewers;
drop policy if exists "owner update own" on public.reviewers;
create policy "signed-in read" on public.reviewers for select to authenticated using (is_public or owner_id = auth.uid() or public.is_admin());
create policy "owner update own" on public.reviewers for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "admin read profiles" on public.profiles;
create policy "admin read profiles" on public.profiles for select to authenticated using (public.is_admin());

create table if not exists public.reviewer_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text not null, subject text not null default 'Unsorted', topic text not null default '', coverage text not null default '',
  template text not null default 'classic', theme text not null default 'indigo',
  files jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending','approved','rejected','generating','done','failed')),
  admin_note text, error text, reviewer_id text,
  created_at timestamptz not null default now(), reviewed_at timestamptz
);
alter table public.reviewer_requests enable row level security;
drop policy if exists "own read" on public.reviewer_requests;
drop policy if exists "own insert max 2 pending" on public.reviewer_requests;
drop policy if exists "admin all" on public.reviewer_requests;
create policy "own read" on public.reviewer_requests for select to authenticated using (user_id = auth.uid());
create policy "own insert max 2 pending" on public.reviewer_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and (select count(*) from public.reviewer_requests r where r.user_id = auth.uid() and r.status = 'pending') < 2);
create policy "admin all" on public.reviewer_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- usage log: written only by the server (service role); users can read their own
create table if not exists public.usage (
  id bigint generated always as identity primary key, user_id uuid not null, request_id uuid, tokens integer not null default 0, at timestamptz not null default now()
);
alter table public.usage enable row level security;
drop policy if exists "own usage read" on public.usage;
create policy "own usage read" on public.usage for select to authenticated using (user_id = auth.uid());

-- private bucket for uploaded notes: owner (own folder) and admins can read; only owner writes
insert into storage.buckets (id, name, public) values ('notes', 'notes', false) on conflict (id) do nothing;
drop policy if exists "notes own insert" on storage.objects;
drop policy if exists "notes own or admin read" on storage.objects;
drop policy if exists "notes own delete" on storage.objects;
create policy "notes own insert" on storage.objects for insert to authenticated with check (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "notes own or admin read" on storage.objects for select to authenticated using (bucket_id = 'notes' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "notes own delete" on storage.objects for delete to authenticated using (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text);

do $$ begin alter publication supabase_realtime add table public.reviewer_requests; exception when others then null; end $$;


-- =====================================================================
-- ===== v3: NEWSFEED (posts, reactions, comments, shared stats) =======
-- =====================================================================

-- profile: students can hide their stats from other people's view of their profile
alter table public.profiles add column if not exists show_stats boolean not null default true;

-- everyone signed in may see names + photos (needed to show authors in the feed)
drop policy if exists "own profile read" on public.profiles;
drop policy if exists "admin read profiles" on public.profiles;
drop policy if exists "signed-in read profiles" on public.profiles;
create policy "signed-in read profiles" on public.profiles for select to authenticated using (true);

-- hardening: cap name length and only allow avatars that live in OUR storage bucket and carry the owner's id
-- (stops people pointing their avatar at a tracking URL that every student's browser would load)
do $$ begin
  alter table public.profiles add constraint profiles_name_len check (char_length(display_name) <= 60) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_avatar_ours check (
    avatar_url is null or (avatar_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/' and position(user_id::text in avatar_url) > 0)
  ) not valid;
exception when duplicate_object then null; end $$;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  stats jsonb,                                   -- frozen snapshot, filled in by the server (cannot be faked)
  is_share boolean not null default false,       -- true for reposts (stays true even if the original is deleted)
  shared_from uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint posts_not_empty check (is_share or stats is not null or char_length(btrim(body, E' \t\r\n')) > 0)
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_user_idx    on public.posts (user_id, created_at desc);
create index if not exists posts_shared_idx  on public.posts (shared_from);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  body text not null check (char_length(btrim(body, E' \t\r\n')) between 1 and 1000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists comments_post_idx on public.post_comments (post_id, created_at);

create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  emoji text not null check (emoji in ('like','love','fire','clap','wow')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)                 -- one reaction per person per post (they can change it)
);
create index if not exists reactions_post_idx on public.post_reactions (post_id);

-- ---- study stats, computed on the server from study_log (so a shared snapshot is trustworthy) ----
create or replace function public.compute_stats(_uid uuid, _tz text default 'UTC') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := coalesce(nullif(_tz, ''), 'UTC'); today date;
begin
  if not exists (select 1 from pg_timezone_names where name = tz) then tz := 'UTC'; end if;
  today := (now() at time zone tz)::date;
  return jsonb_build_object(
    'tz', tz,
    'total', coalesce((select sum(seconds) from public.study_log where user_id = _uid), 0),
    'week',  coalesce((select sum(seconds) from public.study_log where user_id = _uid and "at" > now() - interval '7 days'), 0),
    'streak', coalesce((
      with days as (select distinct ((l."at" at time zone tz)::date) as d from public.study_log l where l.user_id = _uid),
           grp  as (select d, d - (row_number() over (order by d))::int as g from days),
           runs as (select max(d) as e, count(*) as n from grp group by g)
      select n from runs where e >= today - 1 order by e desc limit 1), 0),
    'top_subject', (select subject from public.study_log where user_id = _uid group by subject order by sum(seconds) desc limit 1),
    'goal',   coalesce((select weekly_goal from public.profiles where user_id = _uid), 5),
    'opened', (select count(distinct reviewer_id) from public.study_log where user_id = _uid and reviewer_id is not null),
    'days', (select jsonb_agg(jsonb_build_object('day', to_char(x.d, 'YYYY-MM-DD'),
                'secs', coalesce((select sum(l.seconds) from public.study_log l where l.user_id = _uid and ((l."at" at time zone tz)::date) = x.d), 0)) order by x.d)
             from (select today - 6 + i as d from generate_series(0, 6) i) x),
    'subjects', coalesce((select jsonb_agg(s) from (select subject, sum(seconds)::int as secs from public.study_log where user_id = _uid group by subject order by 2 desc limit 6) s), '[]'::jsonb)
  );
end $$;
revoke all on function public.compute_stats(uuid, text) from public, anon, authenticated;

-- what the app calls: your own stats always; someone else's only if they left "show my stats" on
create or replace function public.get_user_stats(_uid uuid, _tz text default 'UTC') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if _uid = auth.uid() or coalesce((select show_stats from public.profiles where user_id = _uid), false) then
    return public.compute_stats(_uid, _tz);
  end if;
  return null;
end $$;
revoke all on function public.get_user_stats(uuid, text) from public, anon;
grant execute on function public.get_user_stats(uuid, text) to authenticated;

-- ---- guard rails run inside the database, so they hold even if someone calls the API directly ----
create or replace function public.posts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare root uuid;
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.edited_at := null; new.body := btrim(new.body, E' \t\r\n');
    if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
      raise exception 'You are posting too fast. Please wait a bit.';
    end if;
    if new.stats is not null then new.stats := public.compute_stats(new.user_id, new.stats ->> 'tz'); end if;  -- never trust client numbers
    if new.shared_from is not null then
      select coalesce(p.shared_from, p.id) into root from public.posts p where p.id = new.shared_from;   -- always point at the original
      if root is null then raise exception 'That post no longer exists.'; end if;
      new.shared_from := root; new.is_share := true;
    else
      new.is_share := false;
    end if;
  else
    -- edits can only change the text; ownership, stats, share link and dates are locked
    new.user_id := old.user_id; new.stats := old.stats; new.is_share := old.is_share; new.created_at := old.created_at;
    new.shared_from := case when new.shared_from is null then null else old.shared_from end;  -- null is allowed: "original deleted"
    new.body := btrim(new.body, E' \t\r\n');
    new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  end if;
  return new;
end $$;
drop trigger if exists posts_guard_trg on public.posts;
create trigger posts_guard_trg before insert or update on public.posts for each row execute function public.posts_guard();

create or replace function public.comments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.edited_at := null; new.body := btrim(new.body, E' \t\r\n');
    if (select count(*) from public.post_comments where user_id = new.user_id and created_at > now() - interval '1 hour') >= 60 then
      raise exception 'You are commenting too fast. Please wait a bit.';
    end if;
  else
    new.post_id := old.post_id; new.user_id := old.user_id; new.created_at := old.created_at; new.body := btrim(new.body, E' \t\r\n');
    new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  end if;
  return new;
end $$;
drop trigger if exists comments_guard_trg on public.post_comments;
create trigger comments_guard_trg before insert or update on public.post_comments for each row execute function public.comments_guard();

-- study time can't be inflated: each entry max 4h, and at most 16h per rolling day
do $$ begin
  alter table public.study_log add constraint study_log_seconds_chk check (seconds between 1 and 14400) not valid;
exception when duplicate_object then null; end $$;
create or replace function public.study_log_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select coalesce(sum(seconds), 0) from public.study_log where user_id = new.user_id and "at" > now() - interval '24 hours') + new.seconds > 57600 then
    raise exception 'Daily study log limit reached.';
  end if;
  new.at := now();
  return new;
end $$;
drop trigger if exists study_log_guard_trg on public.study_log;
create trigger study_log_guard_trg before insert on public.study_log for each row execute function public.study_log_guard();

-- request form limits enforced server-side too (the browser checks are only for convenience)
do $$ begin
  alter table public.reviewer_requests add constraint rr_limits check (
    char_length(title) <= 120 and char_length(subject) <= 60 and char_length(topic) <= 120 and char_length(coverage) <= 800
    and char_length(template) <= 60 and char_length(theme) <= 30
    and jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 8) not valid;
exception when duplicate_object then null; end $$;

-- ---- row level security ----
alter table public.posts          enable row level security;
alter table public.post_comments  enable row level security;
alter table public.post_reactions enable row level security;

drop policy if exists "posts read"   on public.posts;
drop policy if exists "posts insert" on public.posts;
drop policy if exists "posts update" on public.posts;
drop policy if exists "posts delete" on public.posts;
create policy "posts read"   on public.posts for select to authenticated using (true);
create policy "posts insert" on public.posts for insert to authenticated with check (user_id = auth.uid());
create policy "posts update" on public.posts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "posts delete" on public.posts for delete to authenticated using (user_id = auth.uid() or public.is_admin());   -- admins can moderate

drop policy if exists "comments read"   on public.post_comments;
drop policy if exists "comments insert" on public.post_comments;
drop policy if exists "comments update" on public.post_comments;
drop policy if exists "comments delete" on public.post_comments;
create policy "comments read"   on public.post_comments for select to authenticated using (true);
create policy "comments insert" on public.post_comments for insert to authenticated with check (user_id = auth.uid());
create policy "comments update" on public.post_comments for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "comments delete" on public.post_comments for delete to authenticated using (
  user_id = auth.uid() or public.is_admin() or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));  -- author, post owner or admin

drop policy if exists "reactions read"   on public.post_reactions;
drop policy if exists "reactions insert" on public.post_reactions;
drop policy if exists "reactions update" on public.post_reactions;
drop policy if exists "reactions delete" on public.post_reactions;
create policy "reactions read"   on public.post_reactions for select to authenticated using (true);
create policy "reactions insert" on public.post_reactions for insert to authenticated with check (user_id = auth.uid());
create policy "reactions update" on public.post_reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reactions delete" on public.post_reactions for delete to authenticated using (user_id = auth.uid());

do $$ begin alter publication supabase_realtime add table public.posts;          exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.post_comments;  exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.post_reactions; exception when others then null; end $$;

-- which AI model produced each reviewer (auto-detected, so it is useful to see)
alter table public.usage add column if not exists model text;


-- =====================================================================
-- ===== v4: school, anonymous posts/comments, stats layouts, images,
-- =====     flags on incomplete reviewers, University Astra guides ====
-- =====================================================================

-- ---- school on every profile ----
alter table public.profiles add column if not exists school text not null default '';
do $$ begin
  alter table public.profiles add constraint profiles_school_len check (char_length(school) <= 80) not valid;
exception when duplicate_object then null; end $$;

-- ---- new post columns ----
alter table public.posts add column if not exists is_anonymous boolean not null default false;
alter table public.posts add column if not exists stats_layout text not null default 'compact';
alter table public.posts add column if not exists images text[] not null default '{}';
do $$ begin
  alter table public.posts add constraint posts_layout_chk check (stats_layout in ('compact','rings','weekly','subjects')) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.posts add constraint posts_images_chk check (cardinality(images) <= 4) not valid;
exception when duplicate_object then null; end $$;
-- a post may now be "photos only"
alter table public.posts drop constraint if exists posts_not_empty;
alter table public.posts add constraint posts_not_empty check (is_share or stats is not null or cardinality(images) > 0 or char_length(btrim(body, E' \t\r\n')) > 0) not valid;

alter table public.post_comments add column if not exists is_anonymous boolean not null default false;

-- ---- guard: also validates photo URLs (must be OUR bucket + the author's folder) and locks the new columns on edit ----
create or replace function public.posts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare root uuid; img text;
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.edited_at := null; new.body := btrim(new.body, E' \t\r\n');
    if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
      raise exception 'You are posting too fast. Please wait a bit.';
    end if;
    foreach img in array new.images loop
      if img !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/post-images/' or position(new.user_id::text in img) = 0 then
        raise exception 'Invalid image.';
      end if;
    end loop;
    if new.stats is not null then new.stats := public.compute_stats(new.user_id, new.stats ->> 'tz'); end if;
    if new.stats_layout not in ('compact','rings','weekly','subjects') then new.stats_layout := 'compact'; end if;
    if new.shared_from is not null then
      select coalesce(p.shared_from, p.id) into root from public.posts p where p.id = new.shared_from;
      if root is null then raise exception 'That post no longer exists.'; end if;
      new.shared_from := root; new.is_share := true;
    else
      new.is_share := false;
    end if;
  else
    new.user_id := old.user_id; new.stats := old.stats; new.is_share := old.is_share; new.created_at := old.created_at;
    new.is_anonymous := old.is_anonymous; new.stats_layout := old.stats_layout; new.images := old.images;
    new.shared_from := case when new.shared_from is null then null else old.shared_from end;
    new.body := btrim(new.body, E' \t\r\n');
    new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  end if;
  return new;
end $$;

create or replace function public.comments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.edited_at := null; new.body := btrim(new.body, E' \t\r\n');
    if (select count(*) from public.post_comments where user_id = new.user_id and created_at > now() - interval '1 hour') >= 60 then
      raise exception 'You are commenting too fast. Please wait a bit.';
    end if;
  else
    new.post_id := old.post_id; new.user_id := old.user_id; new.created_at := old.created_at; new.is_anonymous := old.is_anonymous;
    new.body := btrim(new.body, E' \t\r\n');
    new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  end if;
  return new;
end $$;

-- ---- ANONYMITY: nobody but the author (and admins, for moderation) can read the real user_id of an anonymous post/comment.
-- The base tables hide anonymous rows from everyone else; the app reads through these two views, which blank out user_id.
-- (The views run with the owner's rights on purpose: that is what lets them show the post while hiding who wrote it.)
drop policy if exists "posts read" on public.posts;
create policy "posts read" on public.posts for select to authenticated using (not is_anonymous or user_id = auth.uid() or public.is_admin());
drop policy if exists "comments read" on public.post_comments;
create policy "comments read" on public.post_comments for select to authenticated using (not is_anonymous or user_id = auth.uid() or public.is_admin());

drop view if exists public.posts_feed;  -- re-runs: the later v16 definition has extra columns, and CREATE OR REPLACE can't drop them
create or replace view public.posts_feed as
select p.id,
       case when p.is_anonymous and p.user_id <> auth.uid() and not public.is_admin() then null else p.user_id end as user_id,
       p.body, p.stats, p.stats_layout, p.images, p.is_share, p.shared_from, p.is_anonymous, p.created_at, p.edited_at,
       (p.user_id = auth.uid()) as is_mine
from public.posts p;
drop view if exists public.post_comments_feed;  -- re-runs: the later v50 definition has extra columns, and CREATE OR REPLACE can't drop them
create or replace view public.post_comments_feed as
select c.id, c.post_id,
       case when c.is_anonymous and c.user_id <> auth.uid() and not public.is_admin() then null else c.user_id end as user_id,
       c.body, c.is_anonymous, c.created_at, c.edited_at, (c.user_id = auth.uid()) as is_mine
from public.post_comments c;
revoke all on public.posts_feed, public.post_comments_feed from public, anon;
grant select on public.posts_feed, public.post_comments_feed to authenticated;

-- the post owner may delete any comment on their post, even an anonymous one they can't see the author of
create or replace function public.delete_comment(_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return false; end if;
  delete from public.post_comments c
   where c.id = _id and (c.user_id = auth.uid() or public.is_admin() or exists (select 1 from public.posts p where p.id = c.post_id and p.user_id = auth.uid()));
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.delete_comment(uuid) from public, anon;
grant execute on function public.delete_comment(uuid) to authenticated;

-- ---- post photos (public read, each student writes only in their own folder, 5 MB max, images only) ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "postimg public read" on storage.objects;
drop policy if exists "postimg own insert" on storage.objects;
drop policy if exists "postimg own delete" on storage.objects;
create policy "postimg public read" on storage.objects for select using (bucket_id = 'post-images');
create policy "postimg own insert" on storage.objects for insert to authenticated with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "postimg own delete" on storage.objects for delete to authenticated using (bucket_id = 'post-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---- students flag incomplete / wrong reviewers ----
create table if not exists public.reviewer_flags (
  id uuid primary key default gen_random_uuid(),
  reviewer_id text not null references public.reviewers(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  reason text not null check (reason in ('missing_topics','wrong_info','broken','other')),
  note text not null default '' check (char_length(note) <= 300),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (reviewer_id, user_id)
);
create index if not exists flags_reviewer_idx on public.reviewer_flags (reviewer_id) where not resolved;
alter table public.reviewer_flags enable row level security;
drop policy if exists "flags read" on public.reviewer_flags;
drop policy if exists "flags insert" on public.reviewer_flags;
drop policy if exists "flags update" on public.reviewer_flags;
drop policy if exists "flags delete" on public.reviewer_flags;
create policy "flags read" on public.reviewer_flags for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or exists (select 1 from public.reviewers r where r.id = reviewer_id and r.owner_id = auth.uid()));
create policy "flags insert" on public.reviewer_flags for insert to authenticated with check (user_id = auth.uid() and not resolved);
create policy "flags update" on public.reviewer_flags for update to authenticated using (public.is_admin() or user_id = auth.uid()) with check (public.is_admin() or (user_id = auth.uid() and not resolved));
create policy "flags delete" on public.reviewer_flags for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---- University Astra: a guide per school, written by admins, read by everyone ----
create table if not exists public.astra_guides (
  id uuid primary key default gen_random_uuid(),
  school text not null check (char_length(btrim(school)) between 1 and 80),
  category text not null default 'tips' check (category in ('enrollment','programs','scholarships','campus','tips','contacts')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 4000),
  link text not null default '' check (char_length(link) <= 300 and (link = '' or link ~* '^https?://')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists astra_school_idx on public.astra_guides (lower(school));
alter table public.astra_guides enable row level security;
drop policy if exists "astra read" on public.astra_guides;
drop policy if exists "astra admin write" on public.astra_guides;
create policy "astra read" on public.astra_guides for select to authenticated using (true);
create policy "astra admin write" on public.astra_guides for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- =====================================================================
-- ===== v5: UNIVERSITY ASTRA MODERATORS (assigned by admin, per school)
-- =====     review flags + reviewer requests of their school,
-- =====     file ban reports WITH EVIDENCE for the admin to decide ====
-- =====================================================================

alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists ban_reason text not null default '';

create or replace function public.is_banned() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select banned from public.profiles where user_id = auth.uid()), false) $$;

create or replace function public.school_of(_uid uuid) returns text
language sql stable security definer set search_path = public
as $$ select lower(btrim(school)) from public.profiles where user_id = _uid and btrim(school) <> '' $$;

create table if not exists public.astra_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 80),
  assigned_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.astra_members enable row level security;
drop policy if exists "astra member read" on public.astra_members;
drop policy if exists "astra member admin write" on public.astra_members;
create policy "astra member read" on public.astra_members for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "astra member admin write" on public.astra_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- true when the caller is an Astra member of the same school as student _uid
create or replace function public.is_astra_for(_uid uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.astra_members m where m.user_id = auth.uid() and lower(btrim(m.school)) = public.school_of(_uid)) $$;

-- only an admin can ban/unban: a student can never edit their own ban flag
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then new.banned := false; new.ban_reason := ''; end if;
  elsif not public.is_admin() then
    new.banned := old.banned; new.ban_reason := old.ban_reason;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before insert or update on public.profiles for each row execute function public.profiles_guard();

-- banned students can no longer post, comment, react, flag or request reviewers
drop policy if exists "posts insert" on public.posts;
create policy "posts insert" on public.posts for insert to authenticated with check (user_id = auth.uid() and not public.is_banned());
drop policy if exists "comments insert" on public.post_comments;
create policy "comments insert" on public.post_comments for insert to authenticated with check (user_id = auth.uid() and not public.is_banned());
drop policy if exists "reactions insert" on public.post_reactions;
create policy "reactions insert" on public.post_reactions for insert to authenticated with check (user_id = auth.uid() and not public.is_banned());
drop policy if exists "flags insert" on public.reviewer_flags;
create policy "flags insert" on public.reviewer_flags for insert to authenticated with check (user_id = auth.uid() and not resolved and not public.is_banned());
drop policy if exists "own insert max 2 pending" on public.reviewer_requests;
create policy "own insert max 2 pending" on public.reviewer_requests for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned() and status = 'pending' and (select count(*) from public.reviewer_requests r where r.user_id = auth.uid() and r.status = 'pending') < 2);

-- ---- Astra reviews flags from students of their own school ----
alter table public.reviewer_flags add column if not exists astra_verdict text;
alter table public.reviewer_flags add column if not exists astra_by uuid;
do $$ begin
  alter table public.reviewer_flags add constraint flags_verdict_chk check (astra_verdict is null or astra_verdict in ('valid','dismissed')) not valid;
exception when duplicate_object then null; end $$;
drop policy if exists "flags astra read" on public.reviewer_flags;
drop policy if exists "flags astra update" on public.reviewer_flags;
create policy "flags astra read" on public.reviewer_flags for select to authenticated using (public.is_astra_for(user_id));
create policy "flags astra update" on public.reviewer_flags for update to authenticated using (public.is_astra_for(user_id)) with check (public.is_astra_for(user_id));
create or replace function public.flags_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and auth.uid() <> old.user_id and not public.is_admin() then   -- Astra may only record a verdict / resolve
    new.reviewer_id := old.reviewer_id; new.user_id := old.user_id; new.reason := old.reason; new.note := old.note; new.created_at := old.created_at;
    new.astra_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists flags_guard_trg on public.reviewer_flags;
create trigger flags_guard_trg before update on public.reviewer_flags for each row execute function public.flags_guard();

-- ---- Astra approves / rejects reviewer requests from their school. Approving generates and publishes the reviewer (v12). ----
alter table public.reviewer_requests add column if not exists reviewed_by uuid;
drop policy if exists "astra read requests" on public.reviewer_requests;
drop policy if exists "astra review requests" on public.reviewer_requests;
create policy "astra read requests" on public.reviewer_requests for select to authenticated using (public.is_astra_for(user_id));
create policy "astra review requests" on public.reviewer_requests for update to authenticated
  using (status = 'pending' and public.is_astra_for(user_id))
  with check (status in ('approved','rejected') and public.is_astra_for(user_id));
create or replace function public.rr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then    -- the server (service role) and admins are not limited
    new.user_id := old.user_id; new.title := old.title; new.subject := old.subject; new.topic := old.topic; new.coverage := old.coverage;
    new.template := old.template; new.theme := old.theme; new.files := old.files; new.created_at := old.created_at;
    new.error := old.error; new.reviewer_id := old.reviewer_id; new.reviewed_by := auth.uid(); new.reviewed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists rr_guard_trg on public.reviewer_requests;
create trigger rr_guard_trg before update on public.reviewer_requests for each row execute function public.rr_guard();

drop policy if exists "notes astra read" on storage.objects;
create policy "notes astra read" on storage.objects for select to authenticated
  using (bucket_id = 'notes' and public.is_astra_for(((storage.foldername(name))[1])::uuid));

-- ---- Astra writes the University Astra guide of their own school ----
drop policy if exists "astra school write" on public.astra_guides;
create policy "astra school write" on public.astra_guides for all to authenticated
  using (exists (select 1 from public.astra_members m where m.user_id = auth.uid() and lower(btrim(m.school)) = lower(btrim(school))))
  with check (exists (select 1 from public.astra_members m where m.user_id = auth.uid() and lower(btrim(m.school)) = lower(btrim(school))));

-- ---- ban reports: Astra must attach evidence; only the admin decides ----
create table if not exists public.ban_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid(),
  target_id uuid not null references auth.users(id) on delete cascade,
  school text not null default '',
  category text not null check (category in ('bad_words','harassment','unethical','other')),
  details text not null check (char_length(btrim(details)) between 20 and 1500),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) between 1 and 10),
  status text not null default 'pending' check (status in ('pending','banned','dismissed')),
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists ban_reports_status_idx on public.ban_reports (status, created_at desc);
alter table public.ban_reports enable row level security;
drop policy if exists "ban reports read" on public.ban_reports;
drop policy if exists "ban reports insert" on public.ban_reports;
drop policy if exists "ban reports admin" on public.ban_reports;
create policy "ban reports read" on public.ban_reports for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
create policy "ban reports insert" on public.ban_reports for insert to authenticated
  with check (reporter_id = auth.uid() and target_id <> auth.uid() and public.is_astra_for(target_id)
              and not exists (select 1 from public.admins a where a.user_id = target_id));
create policy "ban reports admin" on public.ban_reports for all to authenticated using (public.is_admin()) with check (public.is_admin());
create or replace function public.ban_reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending'; new.admin_note := ''; new.decided_at := null; new.created_at := now();
    new.school := coalesce(public.school_of(new.target_id), '');
    if (select count(*) from public.ban_reports where reporter_id = new.reporter_id and created_at > now() - interval '1 day') >= 10 then
      raise exception 'Too many reports today. Please wait.';
    end if;
    if exists (select 1 from public.ban_reports where reporter_id = new.reporter_id and target_id = new.target_id and status = 'pending') then
      raise exception 'You already have a pending report on this student.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ban_reports_guard_trg on public.ban_reports;
create trigger ban_reports_guard_trg before insert on public.ban_reports for each row execute function public.ban_reports_guard();

create or replace function public.decide_ban(_id uuid, _ban boolean, _note text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.ban_reports set status = case when _ban then 'banned' else 'dismissed' end, admin_note = left(coalesce(_note, ''), 300), decided_at = now()
   where id = _id and status = 'pending' returning target_id into t;
  if t is null then return false; end if;
  if _ban then update public.profiles set banned = true, ban_reason = left(coalesce(nullif(btrim(_note), ''), 'Broke the community rules.'), 300) where user_id = t; end if;
  return true;
end $$;
revoke all on function public.decide_ban(uuid, boolean, text) from public, anon;
grant execute on function public.decide_ban(uuid, boolean, text) to authenticated;

create or replace function public.unban_user(_uid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.profiles set banned = false, ban_reason = '' where user_id = _uid;
  return found;
end $$;
revoke all on function public.unban_user(uuid) from public, anon;
grant execute on function public.unban_user(uuid) to authenticated;

do $$ begin alter publication supabase_realtime add table public.ban_reports; exception when others then null; end $$;


-- =====================================================================
-- ===== v6: student IDs, state universities only, public Astra badge ===
-- =====================================================================

create table if not exists public.state_universities (name text primary key);
insert into public.state_universities (name) values
  ('University of the Philippines Diliman'),
  ('University of the Philippines Manila'),
  ('University of the Philippines Los Baños'),
  ('University of the Philippines Visayas'),
  ('University of the Philippines Cebu'),
  ('University of the Philippines Mindanao'),
  ('University of the Philippines Baguio'),
  ('Polytechnic University of the Philippines'),
  ('Polytechnic University of the Philippines Taguig'),
  ('Technological University of the Philippines'),
  ('Pamantasan ng Lungsod ng Maynila'),
  ('Pamantasan ng Lungsod ng Taguig'),
  ('Rizal Technological University'),
  ('Philippine Normal University'),
  ('Bulacan State University'),
  ('Cavite State University'),
  ('Batangas State University'),
  ('Laguna State Polytechnic University'),
  ('Bicol University'),
  ('Central Luzon State University'),
  ('Pampanga State Agricultural University'),
  ('Tarlac State University'),
  ('Pangasinan State University'),
  ('Mariano Marcos State University'),
  ('Benguet State University'),
  ('Isabela State University'),
  ('Cagayan State University'),
  ('Mindanao State University'),
  ('Mindoro State University'),
  ('Palawan State University'),
  ('West Visayas State University'),
  ('Iloilo Science and Technology University'),
  ('Cebu Technological University'),
  ('Eastern Visayas State University'),
  ('Leyte Normal University'),
  ('Visayas State University'),
  ('University of Southeastern Philippines'),
  ('Caraga State University'),
  ('Central Mindanao University'),
  ('Davao del Norte State College')
on conflict do nothing;
alter table public.state_universities enable row level security;
drop policy if exists "state unis read" on public.state_universities;
create policy "state unis read" on public.state_universities for select to authenticated using (true);
create or replace function public.is_state_uni(_s text) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.state_universities where lower(name) = lower(btrim(_s))) $$;

-- every student gets a unique ID like S26-000123
create sequence if not exists public.student_no_seq;
create or replace function public.next_student_no() returns text
language sql volatile set search_path = public
as $$ select 'S' || to_char(now(), 'YY') || '-' || lpad(nextval('public.student_no_seq')::text, 6, '0') $$;
alter table public.profiles add column if not exists student_no text;

create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then new.banned := false; new.ban_reason := ''; end if;
    new.student_no := public.next_student_no();
    if btrim(new.school) <> '' and not public.is_state_uni(new.school) then raise exception 'Only state universities are supported.'; end if;
  else
    if not public.is_admin() then new.banned := old.banned; new.ban_reason := old.ban_reason; end if;
    if old.student_no is not null then new.student_no := old.student_no; end if;   -- the ID never changes
    if new.school is distinct from old.school and btrim(new.school) <> '' and not public.is_state_uni(new.school) then
      raise exception 'Only state universities are supported.';
    end if;
  end if;
  return new;
end $$;
update public.profiles set student_no = public.next_student_no() where student_no is null;
create unique index if not exists profiles_student_no_idx on public.profiles (student_no);

-- anyone signed in can see who is Astra (shown as a badge) ; the school of an Astra member / guide must be a state university
drop policy if exists "astra member read" on public.astra_members;
create policy "astra member read" on public.astra_members for select to authenticated using (true);
create or replace function public.school_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_state_uni(new.school) then raise exception 'Only state universities are supported.'; end if;
  new.school := btrim(new.school);
  return new;
end $$;
drop trigger if exists astra_members_school_trg on public.astra_members;
create trigger astra_members_school_trg before insert or update of school on public.astra_members for each row execute function public.school_guard();
drop trigger if exists astra_guides_school_trg on public.astra_guides;
create trigger astra_guides_school_trg before insert or update of school on public.astra_guides for each row execute function public.school_guard();


-- =====================================================================
-- ===== v7: universities kept up to date by an API (admin can switch on/off) ===
-- =====================================================================
alter table public.state_universities add column if not exists active boolean not null default true;
alter table public.state_universities add column if not exists source text not null default 'seed';
alter table public.state_universities add column if not exists added_at timestamptz not null default now();
create or replace function public.is_state_uni(_s text) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.state_universities where active and lower(name) = lower(btrim(_s))) $$;
drop policy if exists "state unis admin write" on public.state_universities;
create policy "state unis admin write" on public.state_universities for all to authenticated using (public.is_admin()) with check (public.is_admin());
do $$ begin alter table public.state_universities add constraint state_uni_len check (char_length(btrim(name)) between 3 and 80) not valid; exception when duplicate_object then null; end $$;


-- ===== v8: students can delete their own reviewer requests (so the list doesn't pile up) =====
drop policy if exists "own delete request" on public.reviewer_requests;
create policy "own delete request" on public.reviewer_requests for delete to authenticated using (user_id = auth.uid() and status <> 'generating');


-- ===== v9: flags can have several points, each with files ======================
alter table public.reviewer_flags add column if not exists points jsonb not null default '[]';
do $$ begin
  alter table public.reviewer_flags add constraint flags_points_chk check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) <= 5) not valid;
exception when duplicate_object then null; end $$;
create or replace function public.flags_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if auth.uid() = old.user_id then
      new.astra_verdict := null; new.astra_by := null;      -- the writer can't forge Astra's verdict; editing a flag reopens it
    else                                                    -- Astra may only record a verdict / resolve
      new.reviewer_id := old.reviewer_id; new.user_id := old.user_id; new.reason := old.reason; new.note := old.note; new.points := old.points; new.created_at := old.created_at;
      new.astra_by := auth.uid();
    end if;
  end if;
  return new;
end $$;


-- ===== v10: students can remove files from their own PENDING request; nobody can approve their own request =====
drop policy if exists "own edit pending request" on public.reviewer_requests;
create policy "own edit pending request" on public.reviewer_requests for update to authenticated
  using (user_id = auth.uid() and status = 'pending') with check (user_id = auth.uid() and status = 'pending');
create or replace function public.rr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then          -- the server (service role) and admins are not limited
    new.user_id := old.user_id; new.title := old.title; new.subject := old.subject; new.topic := old.topic; new.coverage := old.coverage;
    new.template := old.template; new.theme := old.theme; new.created_at := old.created_at;
    new.error := old.error; new.reviewer_id := old.reviewer_id;
    if auth.uid() = old.user_id then                                -- the owner may only change the file list, and stays pending
      new.status := old.status; new.admin_note := old.admin_note; new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    else                                                            -- Astra may only decide
      new.files := old.files; new.reviewed_by := auth.uid(); new.reviewed_at := now();
    end if;
  end if;
  return new;
end $$;

-- ===== v11: Astra can attach photos / videos / PDFs to their school's guides =====
alter table public.astra_guides add column if not exists files jsonb not null default '[]';
do $$ begin
  alter table public.astra_guides add constraint astra_files_shape
    check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 8) not valid;
exception when duplicate_object then null; end $$;

-- Private bucket: every signed-in student can view guide attachments (guides are
-- readable by everyone), but only an Astra member or admin can upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('astra-files', 'astra-files', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "astra files read" on storage.objects;
drop policy if exists "astra files insert" on storage.objects;
drop policy if exists "astra files update" on storage.objects;
drop policy if exists "astra files delete" on storage.objects;
create policy "astra files read" on storage.objects for select to authenticated using (bucket_id = 'astra-files');
create policy "astra files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'astra-files' and (storage.foldername(name))[1] = auth.uid()::text
              and (storage.foldername(name))[2] = 'astra'
              and (public.is_admin() or exists (select 1 from public.astra_members m where m.user_id = auth.uid())));
create policy "astra files update" on storage.objects for update to authenticated
  using (bucket_id = 'astra-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'astra-files' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[2] = 'astra');
create policy "astra files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'astra-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- =====================================================================
-- ===== v12: contribution points (reviewers + study time + accepted flags)
-- =====================================================================
alter table public.profiles add column if not exists show_contributions boolean not null default true;

-- Counts only. Points are computed in one place so every screen agrees:
--   50 per contributed reviewer + 10 per study hour (1 per 6 min) + 25 per accepted flag
create or replace function public.compute_contributions(_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select count(*)::int n from public.reviewers where owner_id = _uid),
       s as (select coalesce(sum(seconds), 0)::bigint secs from public.study_log where user_id = _uid),
       f as (select count(*)::int n from public.reviewer_flags
              where user_id = _uid and (astra_verdict = 'valid' or (resolved and coalesce(astra_verdict, '') <> 'dismissed')))
  select jsonb_build_object(
    'reviewers', r.n, 'seconds', s.secs, 'flags', f.n,
    'reviewer_points', r.n * 50,
    'study_points', floor(s.secs / 360.0)::int,
    'flag_points', f.n * 25,
    'points', r.n * 50 + floor(s.secs / 360.0)::int + f.n * 25
  ) from r, s, f
$$;
revoke all on function public.compute_contributions(uuid) from public, anon, authenticated;

-- Your own contributions always; someone else's only if they left "show my contributions" on.
create or replace function public.get_user_contributions(_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if _uid = auth.uid() or coalesce((select show_contributions from public.profiles where user_id = _uid), false) then
    return public.compute_contributions(_uid);
  end if;
  return null;
end $$;
revoke all on function public.get_user_contributions(uuid) from public, anon;
grant execute on function public.get_user_contributions(uuid) to authenticated;

-- Make yourself admin (you must have signed in with Google at least once)
insert into public.admins (user_id) select id from auth.users where email = 'YOUR_EMAIL@gmail.com' on conflict do nothing;

notify pgrst, 'reload schema';


-- v13: flag edits. The flagger (or the AI) proposes an edited reviewer; student, Astra and admin compare original vs proposed.
alter table public.reviewer_flags add column if not exists original jsonb;
alter table public.reviewer_flags add column if not exists proposed jsonb;
alter table public.reviewer_flags add column if not exists fixed_by text check (fixed_by in ('ai','person'));

-- v14: Astra can TEMPORARILY ban a student because of a post. The admin then keeps it, bans completely, or lifts it.
alter table public.profiles add column if not exists temp_ban_until timestamptz;
alter table public.ban_reports add column if not exists post_id uuid;
alter table public.ban_reports add column if not exists temp_until timestamptz;
alter table public.ban_reports drop constraint if exists ban_reports_status_check;
alter table public.ban_reports add constraint ban_reports_status_check check (status in ('pending','banned','dismissed','confirmed'));

create or replace function public.is_banned() returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select banned or coalesce(temp_ban_until > now(), false) from public.profiles where user_id = auth.uid()), false) $$;

-- a student can never edit ban fields; trusted functions below set app.bypass_guard for their own transaction
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.bypass_guard', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if not public.is_admin() then new.banned := false; new.ban_reason := ''; new.temp_ban_until := null; end if;
  elsif not public.is_admin() then
    new.banned := old.banned; new.ban_reason := old.ban_reason; new.temp_ban_until := old.temp_ban_until;
  end if;
  return new;
end $$;

create or replace function public.astra_temp_ban(_post uuid, _days int, _reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare t uuid; b text; u timestamptz;
begin
  select user_id, body into t, b from public.posts where id = _post;
  if t is null then raise exception 'Post not found.'; end if;
  if t = auth.uid() then raise exception 'You cannot ban yourself.'; end if;
  if not public.is_astra_for(t) then raise exception 'You can only act on students of your own school.'; end if;
  if exists (select 1 from public.admins a where a.user_id = t) then raise exception 'You cannot ban an admin.'; end if;
  if _days not in (1, 3, 7) then raise exception 'Pick 1, 3 or 7 days.'; end if;
  if char_length(btrim(coalesce(_reason, ''))) < 20 then raise exception 'Explain the reason (at least 20 characters).'; end if;
  u := now() + make_interval(days => _days);
  insert into public.ban_reports (reporter_id, target_id, school, category, details, evidence, post_id, temp_until)
  values (auth.uid(), t, coalesce(public.school_of(t), ''), 'other', left(btrim(_reason), 1500),
          jsonb_build_array(jsonb_build_object('kind', 'post', 'text', left(coalesce(b, ''), 500), 'ref', 'post ' || _post::text)), _post, u);
  perform set_config('app.bypass_guard', '1', true);
  -- the post that caused the ban is taken down too (hidden from others; the admin can restore it if the ban was wrong)
  update public.posts set removed_at = coalesce(removed_at, now()), removed_reason = coalesce(removed_reason, left('Temporary ban: ' || btrim(_reason), 500)) where id = _post;
  update public.profiles set temp_ban_until = u where user_id = t;
  return true;
end $$;
revoke all on function public.astra_temp_ban(uuid, int, text) from public, anon;
grant execute on function public.astra_temp_ban(uuid, int, text) to authenticated;

-- admin: 'keep' (temp ban stands), 'ban' (ban completely), 'lift' (it was wrong, lift it now)
create or replace function public.decide_temp_ban(_id uuid, _action text, _note text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare t uuid; pid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if _action not in ('keep', 'ban', 'lift') then raise exception 'Bad action.'; end if;
  update public.ban_reports set status = case _action when 'keep' then 'confirmed' when 'ban' then 'banned' else 'dismissed' end,
         admin_note = left(coalesce(_note, ''), 300), decided_at = now()
   where id = _id and status = 'pending' and (_action <> 'keep' or temp_until is not null) returning target_id, post_id into t, pid;
  if t is null then return false; end if;
  perform set_config('app.bypass_guard', '1', true);
  if _action = 'ban' then
    update public.profiles set banned = true, temp_ban_until = null, ban_reason = left(coalesce(nullif(btrim(_note), ''), 'Broke the community rules.'), 300) where user_id = t;
  elsif _action = 'lift' then
    update public.profiles set temp_ban_until = null where user_id = t;
    if pid is not null then update public.posts set removed_at = null, removed_reason = null where id = pid; end if;   -- the ban was wrong: the post comes back
  end if;
  return true;
end $$;
revoke all on function public.decide_temp_ban(uuid, text, text) from public, anon;
grant execute on function public.decide_temp_ban(uuid, text, text) to authenticated;

create or replace function public.unban_user(_uid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  perform set_config('app.bypass_guard', '1', true);
  update public.profiles set banned = false, ban_reason = '', temp_ban_until = null where user_id = _uid;
  update public.posts set removed_at = null, removed_reason = null where user_id = _uid and removed_reason like 'Temporary ban:%';   -- bring back the post that caused a temp ban
  return true;
end $$;

-- v15: authors can hide their name on a published reviewer; students whose flag was accepted are credited on the card.
alter table public.reviewers add column if not exists hide_author boolean not null default false;
create or replace function public.reviewer_helpers() returns table(reviewer_id text, user_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct f.reviewer_id, f.user_id
    from public.reviewer_flags f join public.profiles p on p.user_id = f.user_id
   where (f.astra_verdict = 'valid' or (f.resolved and coalesce(f.astra_verdict, '') <> 'dismissed'))
     and coalesce(p.show_contributions, true) and not coalesce(p.banned, false)
$$;
revoke all on function public.reviewer_helpers() from public, anon;
grant execute on function public.reviewer_helpers() to authenticated;

-- v16: ranking + Astra can remove a post with a reason (hidden at once, admin keeps / restores / deletes it)
create or replace function public.school_leaderboard(_school text default null, _limit int default 30)
returns table(user_id uuid, display_name text, avatar_url text, school text, points int)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, p.avatar_url, p.school, (public.compute_contributions(p.user_id) ->> 'points')::int as pts
    from public.profiles p
   where (_school is null or lower(btrim(p.school)) = lower(btrim(_school)))
     and coalesce(p.show_contributions, true) and not coalesce(p.banned, false)
     and not exists (select 1 from public.admins a where a.user_id = p.user_id)
   order by pts desc, p.display_name
   limit least(greatest(coalesce(_limit, 30), 1), 50)
$$;
revoke all on function public.school_leaderboard(text, int) from public, anon;
grant execute on function public.school_leaderboard(text, int) to authenticated;

alter table public.posts add column if not exists removed_at timestamptz;
alter table public.posts add column if not exists removed_reason text;

create or replace function public.posts_removed_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.bypass_guard', true), '') = '1' or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then new.removed_at := null; new.removed_reason := null;
  else new.removed_at := old.removed_at; new.removed_reason := old.removed_reason; end if;
  return new;
end $$;
drop trigger if exists posts_removed_guard_trg on public.posts;
create trigger posts_removed_guard_trg before insert or update on public.posts for each row execute function public.posts_removed_guard();

drop policy if exists "posts read" on public.posts;
create policy "posts read" on public.posts for select to authenticated
  using ((not is_anonymous or user_id = auth.uid() or public.is_admin()) and (removed_at is null or user_id = auth.uid() or public.is_admin()));

create or replace view public.posts_feed as
select p.id,
       case when p.is_anonymous and p.user_id <> auth.uid() and not public.is_admin() then null else p.user_id end as user_id,
       p.body, p.stats, p.stats_layout, p.images, p.is_share, p.shared_from, p.is_anonymous, p.created_at, p.edited_at,
       (p.user_id = auth.uid()) as is_mine,
       p.removed_at, p.removed_reason
from public.posts p
where p.removed_at is null or p.user_id = auth.uid() or public.is_admin();

create table if not exists public.post_removals (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  author_id uuid not null,
  remover_id uuid not null default auth.uid(),
  school text not null default '',
  reason text not null,
  body text not null default '',
  status text not null default 'pending' check (status in ('pending','confirmed','restored','deleted')),
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.post_removals enable row level security;
drop policy if exists "post removals read" on public.post_removals;
create policy "post removals read" on public.post_removals for select to authenticated using (remover_id = auth.uid() or public.is_admin());

create or replace function public.astra_remove_post(_post uuid, _reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare t uuid; b text;
begin
  select user_id, body into t, b from public.posts where id = _post and removed_at is null;
  if t is null then raise exception 'Post not found or already removed.'; end if;
  if t = auth.uid() then raise exception 'You cannot remove your own post this way.'; end if;
  if not public.is_astra_for(t) then raise exception 'You can only act on students of your own school.'; end if;
  if exists (select 1 from public.admins a where a.user_id = t) then raise exception 'You cannot remove an admin''s post.'; end if;
  if char_length(btrim(coalesce(_reason, ''))) < 20 then raise exception 'Explain the reason (at least 20 characters).'; end if;
  perform set_config('app.bypass_guard', '1', true);
  update public.posts set removed_at = now(), removed_reason = left(btrim(_reason), 500) where id = _post;
  insert into public.post_removals (post_id, author_id, remover_id, school, reason, body)
  values (_post, t, auth.uid(), coalesce(public.school_of(t), ''), left(btrim(_reason), 500), left(coalesce(b, ''), 2000));
  return true;
end $$;
revoke all on function public.astra_remove_post(uuid, text) from public, anon;
grant execute on function public.astra_remove_post(uuid, text) to authenticated;

-- admin: 'keep' (stays hidden), 'restore' (it was wrong), 'delete' (delete the post for good)
create or replace function public.decide_post_removal(_id uuid, _action text, _note text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if _action not in ('keep', 'restore', 'delete') then raise exception 'Bad action.'; end if;
  update public.post_removals set status = case _action when 'keep' then 'confirmed' when 'restore' then 'restored' else 'deleted' end,
         admin_note = left(coalesce(_note, ''), 300), decided_at = now()
   where id = _id and status = 'pending' returning post_id into pid;
  if pid is null then return false; end if;
  perform set_config('app.bypass_guard', '1', true);
  if _action = 'restore' then update public.posts set removed_at = null, removed_reason = null where id = pid;
  elsif _action = 'delete' then delete from public.posts where id = pid; end if;
  return true;
end $$;
revoke all on function public.decide_post_removal(uuid, text, text) from public, anon;
grant execute on function public.decide_post_removal(uuid, text, text) to authenticated;

-- v17: the Astra of the school can bring a temporarily banned student back (the admin can too, with unban_user).
-- Only the admin can ban completely.
create or replace function public.astra_lift_temp_ban(_report uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare t uuid; pid uuid;
begin
  select target_id, post_id into t, pid from public.ban_reports where id = _report and temp_until is not null and status in ('pending', 'confirmed');
  if t is null then raise exception 'Nothing to lift.'; end if;
  if not public.is_astra_for(t) then raise exception 'Only the Astra of this student''s school can do this.'; end if;
  if exists (select 1 from public.profiles where user_id = t and banned) then raise exception 'The admin banned this student completely.'; end if;
  perform set_config('app.bypass_guard', '1', true);
  update public.ban_reports set status = 'dismissed', admin_note = 'Lifted by Astra', decided_at = now() where id = _report;
  update public.profiles set temp_ban_until = null where user_id = t;
  if pid is not null then update public.posts set removed_at = null, removed_reason = null where id = pid; end if;
  return true;
end $$;
revoke all on function public.astra_lift_temp_ban(uuid) from public, anon;
grant execute on function public.astra_lift_temp_ban(uuid) to authenticated;

-- v18: the author can delete their own reviewer (flags on it are deleted with it)
drop policy if exists "owner delete own" on public.reviewers;
create policy "owner delete own" on public.reviewers for delete to authenticated using (owner_id = auth.uid());

-- v19: "Upcoming" is personal. Every student keeps their own exams / quizzes / deadlines; nobody else (not even the admin) sees them.
-- The old shared public.events table is left untouched (old rows are kept) but the app no longer reads it.
create table if not exists public.personal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  day date not null,
  kind text not null default 'exam' check (kind in ('exam', 'quiz', 'deadline', 'event')),
  color text not null default '#e8788a',
  created_at timestamptz not null default now()
);
create index if not exists personal_events_user_day on public.personal_events (user_id, day);
alter table public.personal_events enable row level security;
drop policy if exists "own events read"   on public.personal_events;
drop policy if exists "own events insert" on public.personal_events;
drop policy if exists "own events update" on public.personal_events;
drop policy if exists "own events delete" on public.personal_events;
create policy "own events read"   on public.personal_events for select to authenticated using (user_id = auth.uid());
create policy "own events insert" on public.personal_events for insert to authenticated with check (user_id = auth.uid() and not public.is_banned());
create policy "own events update" on public.personal_events for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own events delete" on public.personal_events for delete to authenticated using (user_id = auth.uid());

-- v22: APPLY AS ASTRA. The admin can still assign Astra directly (Moderation > Astra members).
-- Students can also apply, but the bar rises with every Astra member the school already has.
-- Change the numbers in astra_requirements() below to make it easier or harder.
--   n = Astra members the school has now     ->  account age: 60 + 30n days (max 365)
--                                                points:      1000 + 500n
--                                                reviewers published: 5 + 2n
--                                                accepted flags:      5 + 2n
create table if not exists public.astra_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  school text not null,
  message text not null check (char_length(btrim(message)) between 50 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  snapshot jsonb not null default '{}',
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create unique index if not exists astra_app_one_pending on public.astra_applications (user_id) where status = 'pending';
alter table public.astra_applications enable row level security;
drop policy if exists "astra app read" on public.astra_applications;
create policy "astra app read" on public.astra_applications for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- no insert/update/delete policies on purpose: everything goes through the functions below

create or replace function public.astra_requirements(_school text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'astra_count', n.c,
    'days',        least(60 + 30 * n.c, 365),
    'points',      1000 + 500 * n.c,
    'reviewers',   5 + 2 * n.c,
    'flags',       5 + 2 * n.c)
  from (select count(*)::int as c from public.astra_members where lower(btrim(school)) = lower(btrim(coalesce(_school, '')))) n
$$;
revoke all on function public.astra_requirements(text) from public, anon;
grant execute on function public.astra_requirements(text) to authenticated;

-- What a student has earned. Study time is self-reported, so it only counts up to 30 points (3 study hours) per day of account age;
-- published reviewers and accepted flags (verified by Astra/admin) count in full.
create or replace function public.astra_stats(_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'days', d.days,
    'reviewers', (x.c ->> 'reviewers')::int,
    'flags', (x.c ->> 'flags')::int,
    'points', (x.c ->> 'reviewer_points')::int + (x.c ->> 'flag_points')::int + least((x.c ->> 'study_points')::int, 30 * d.days))
  from (select public.compute_contributions(_uid) as c) x,
       (select greatest(0, floor(extract(epoch from (now() - coalesce((select created_at from auth.users where id = _uid), now()))) / 86400))::int as days) d
$$;
revoke all on function public.astra_stats(uuid) from public, anon, authenticated;

create or replace function public.astra_eligibility() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  sch text; req jsonb; mine jsonb; met jsonb; ok boolean;
  blockers text[] := '{}';
  pend record; lastdone record;
begin
  if uid is null then return null; end if;
  if public.is_admin() or exists (select 1 from public.astra_members where user_id = uid) then
    return jsonb_build_object('hidden', true);
  end if;
  select btrim(school) into sch from public.profiles where user_id = uid;
  req := public.astra_requirements(coalesce(sch, ''));
  mine := public.astra_stats(uid);
  met := jsonb_build_object(
    'days',      (mine ->> 'days')::int      >= (req ->> 'days')::int,
    'points',    (mine ->> 'points')::int    >= (req ->> 'points')::int,
    'reviewers', (mine ->> 'reviewers')::int >= (req ->> 'reviewers')::int,
    'flags',     (mine ->> 'flags')::int     >= (req ->> 'flags')::int);
  ok := (met ->> 'days')::boolean and (met ->> 'points')::boolean and (met ->> 'reviewers')::boolean and (met ->> 'flags')::boolean;
  if coalesce(sch, '') = '' then blockers := array_append(blockers, 'Set your school in your profile first.'); end if;
  if public.is_banned() then blockers := array_append(blockers, 'Your account is banned or temporarily banned.'); end if;
  select id, created_at into pend from public.astra_applications where user_id = uid and status = 'pending';
  select status, admin_note, decided_at into lastdone from public.astra_applications
   where user_id = uid and status in ('approved', 'rejected') order by decided_at desc nulls last limit 1;
  if lastdone.status = 'rejected' and lastdone.decided_at > now() - interval '30 days' then
    blockers := array_append(blockers, 'You can apply again on ' || to_char(lastdone.decided_at + interval '30 days', 'Mon DD, YYYY') || '.');
  end if;
  return jsonb_build_object(
    'school', sch, 'requirements', req, 'mine', mine, 'met', met, 'all_met', ok,
    'blockers', to_jsonb(blockers),
    'pending', case when pend.id is null then null else jsonb_build_object('id', pend.id, 'created_at', pend.created_at) end,
    'last', case when lastdone.status is null then null else jsonb_build_object('status', lastdone.status, 'admin_note', lastdone.admin_note, 'decided_at', lastdone.decided_at) end,
    'can_apply', ok and cardinality(blockers) = 0 and pend.id is null);
end $$;
revoke all on function public.astra_eligibility() from public, anon;
grant execute on function public.astra_eligibility() to authenticated;

create or replace function public.astra_apply(_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e jsonb := public.astra_eligibility(); m text := btrim(coalesce(_message, '')); new_id uuid;
begin
  if e is null then raise exception 'Please sign in again.'; end if;
  if coalesce((e ->> 'hidden')::boolean, false) then raise exception 'You are already an Astra member or an admin.'; end if;
  if jsonb_typeof(e -> 'pending') = 'object' then raise exception 'You already have a pending application.'; end if;
  if jsonb_array_length(e -> 'blockers') > 0 then raise exception '%', e -> 'blockers' ->> 0; end if;
  if not (e ->> 'all_met')::boolean then raise exception 'You do not meet the requirements yet.'; end if;
  if char_length(m) < 50 then raise exception 'Tell us why you want to be Astra (at least 50 characters).'; end if;
  insert into public.astra_applications (user_id, school, message, snapshot)
  values (auth.uid(), e ->> 'school', left(m, 1000), jsonb_build_object('mine', e -> 'mine', 'requirements', e -> 'requirements'))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.astra_apply(text) from public, anon;
grant execute on function public.astra_apply(text) to authenticated;

create or replace function public.astra_withdraw(_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.astra_applications set status = 'withdrawn', decided_at = now()
   where id = _id and user_id = auth.uid() and status = 'pending';
  return found;
end $$;
revoke all on function public.astra_withdraw(uuid) from public, anon;
grant execute on function public.astra_withdraw(uuid) to authenticated;

-- admin: approve (makes them Astra for their school) or reject. Requirements are checked AGAIN at approval time,
-- because they rise when someone else was approved first. To override, use Astra members > Assign.
create or replace function public.decide_astra_application(_id uuid, _approve boolean, _note text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare a record; sch text; req jsonb; mine jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into a from public.astra_applications where id = _id and status = 'pending' for update;
  if not found then return false; end if;
  if _approve then
    select btrim(school) into sch from public.profiles where user_id = a.user_id;
    if lower(coalesce(sch, '')) <> lower(btrim(a.school)) then raise exception 'The student changed school after applying. Reject this application.'; end if;
    if coalesce((select banned or coalesce(temp_ban_until > now(), false) from public.profiles where user_id = a.user_id), false) then raise exception 'This student is banned.'; end if;
    req := public.astra_requirements(a.school);
    mine := public.astra_stats(a.user_id);
    if (mine ->> 'days')::int < (req ->> 'days')::int or (mine ->> 'points')::int < (req ->> 'points')::int
       or (mine ->> 'reviewers')::int < (req ->> 'reviewers')::int or (mine ->> 'flags')::int < (req ->> 'flags')::int then
      raise exception 'They no longer meet the requirements (they rose to % days, % points, % reviewers, % flags). Reject, or add them from Astra members.',
        req ->> 'days', req ->> 'points', req ->> 'reviewers', req ->> 'flags';
    end if;
    insert into public.astra_members (user_id, school, assigned_by) values (a.user_id, a.school, auth.uid())
    on conflict (user_id) do update set school = excluded.school;
  end if;
  update public.astra_applications
     set status = case when _approve then 'approved' else 'rejected' end,
         admin_note = left(coalesce(_note, ''), 300), decided_at = now(), decided_by = auth.uid()
   where id = _id;
  return true;
end $$;
revoke all on function public.decide_astra_application(uuid, boolean, text) from public, anon;
grant execute on function public.decide_astra_application(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';

-- v23: STUDY STRATEGY. A request can ask for extra study aids (abbreviations, mnemonics, comparison tables, timeline,
-- cheat sheet, common mistakes, examples). Stored as a list of ids like ["abbreviations","keyFacts"].
alter table public.reviewer_requests add column if not exists aids jsonb not null default '[]';
do $$ begin
  alter table public.reviewer_requests add constraint rr_aids_chk check (jsonb_typeof(aids) = 'array' and jsonb_array_length(aids) <= 8) not valid;
exception when duplicate_object then null; end $$;
-- same guard as v10, plus: only the admin can change the chosen aids after the request was sent
create or replace function public.rr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then          -- the server (service role) and admins are not limited
    new.user_id := old.user_id; new.title := old.title; new.subject := old.subject; new.topic := old.topic; new.coverage := old.coverage;
    new.template := old.template; new.theme := old.theme; new.aids := old.aids; new.created_at := old.created_at;
    new.error := old.error; new.reviewer_id := old.reviewer_id;
    if auth.uid() = old.user_id then                                -- the owner may only change the file list, and stays pending
      new.status := old.status; new.admin_note := old.admin_note; new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    else                                                            -- Astra may only decide
      new.files := old.files; new.reviewed_by := auth.uid(); new.reviewed_at := now();
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';


-- ===== v24: FOLLOW + NOTIFICATIONS (+ re-assert that every signed-in student can read profiles) =====
-- If other students' names/profiles did not show, an old "own profile read" policy was still active. This fixes it.
drop policy if exists "own profile read" on public.profiles;
drop policy if exists "admin read profiles" on public.profiles;
drop policy if exists "signed-in read profiles" on public.profiles;
create policy "signed-in read profiles" on public.profiles for select to authenticated using (true);

create table if not exists public.follows (
  follower uuid not null references public.profiles(user_id) on delete cascade,
  followee uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee), check (follower <> followee)
);
create index if not exists follows_followee_idx on public.follows (followee);
alter table public.follows enable row level security;
drop policy if exists "follows read" on public.follows;
drop policy if exists "follows add" on public.follows;
drop policy if exists "follows remove" on public.follows;
create policy "follows read"   on public.follows for select to authenticated using (true);
create policy "follows add"    on public.follows for insert to authenticated with check (follower = auth.uid());
create policy "follows remove" on public.follows for delete to authenticated using (follower = auth.uid());

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null, text text not null, ref text, actor_id uuid,
  created_at timestamptz not null default now(), read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "notif read" on public.notifications;
drop policy if exists "notif update" on public.notifications;
drop policy if exists "notif delete" on public.notifications;
create policy "notif read"   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notif update" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notif delete" on public.notifications for delete to authenticated using (user_id = auth.uid());
do $$ begin alter publication supabase_realtime add table public.notifications; exception when others then null; end $$;

create or replace function public.display_of(_uid uuid) returns text language sql stable security definer set search_path = public
as $$ select coalesce(nullif(btrim((select display_name from public.profiles where user_id = _uid)), ''), 'A student') $$;

-- one notification per person (never the actor, max 300 people per event)
create or replace function public.notify_many(_ids uuid[], _kind text, _text text, _ref text, _actor uuid) returns void
language sql security definer set search_path = public
as $$ insert into public.notifications (user_id, kind, text, ref, actor_id)
   select distinct u, _kind, _text, _ref, _actor from (select unnest(_ids) u limit 300) t where u is not null and u is distinct from _actor $$;

-- someone follows you
create or replace function public.trg_follow_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.notify_many(array[new.followee], 'follow', public.display_of(new.follower) || ' started following you', new.follower::text, new.follower); return new; end $$;
drop trigger if exists follow_notify_trg on public.follows;
create trigger follow_notify_trg after insert on public.follows for each row execute function public.trg_follow_notify();

-- a reviewer is published: tell the author's followers, and students whose most-studied subject matches
create or replace function public.trg_reviewer_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare fol uuid[]; fans uuid[];
begin
  if not new.is_public then return new; end if;
  select coalesce(array_agg(follower), '{}') into fol from public.follows where followee = new.owner_id;
  select coalesce(array_agg(user_id), '{}') into fans from (
    select user_id, subject, count(*) c, row_number() over (partition by user_id order by count(*) desc, max(at) desc) rn
    from public.study_log where at > now() - interval '60 days' group by user_id, subject) t
    where rn = 1 and c >= 3 and lower(subject) = lower(new.subject);
  perform public.notify_many(fol, 'publish', public.display_of(new.owner_id) || ' published “' || new.title || '”', new.id, new.owner_id);
  perform public.notify_many(array(select unnest(fans) except select unnest(fol)), 'field', 'New in ' || new.subject || ': “' || new.title || '”', new.id, new.owner_id);
  return new;
end $$;
drop trigger if exists reviewer_notify_trg on public.reviewers;
create trigger reviewer_notify_trg after insert on public.reviewers for each row execute function public.trg_reviewer_notify();

-- a reviewer you studied was fixed / updated
create or replace function public.trg_reviewer_updated() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.content is distinct from new.content then
    perform public.notify_many(array(select distinct user_id from public.study_log where reviewer_id = new.id limit 200), 'updated', '“' || new.title || '” was updated', new.id, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists reviewer_updated_trg on public.reviewers;
create trigger reviewer_updated_trg after update on public.reviewers for each row execute function public.trg_reviewer_updated();

-- flags: the author hears when their reviewer is flagged; the flagger hears when it is resolved
create or replace function public.trg_flag_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare t text; o uuid;
begin
  select title, owner_id into t, o from public.reviewers where id = new.reviewer_id;
  if tg_op = 'INSERT' then
    perform public.notify_many(array[o], 'flag', 'A student flagged “' || coalesce(t, 'your reviewer') || '”', new.reviewer_id, new.user_id);
  elsif new.resolved and not old.resolved then
    perform public.notify_many(array[new.user_id], 'flag_fixed', 'Your flag on “' || coalesce(t, 'a reviewer') || '” was resolved', new.reviewer_id, null);
  end if;
  return new;
end $$;
drop trigger if exists flag_notify_trg on public.reviewer_flags;
create trigger flag_notify_trg after insert or update of resolved on public.reviewer_flags for each row execute function public.trg_flag_notify();

-- a student you follow posts (anonymous posts never notify)
create or replace function public.trg_post_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(to_jsonb(new)->>'is_anonymous', 'false') = 'true' then return new; end if;
  perform public.notify_many(array(select follower from public.follows where followee = new.user_id), 'post', public.display_of(new.user_id) || ' posted in the feed', new.id::text, new.user_id);
  return new;
end $$;
drop trigger if exists post_notify_trg on public.posts;
create trigger post_notify_trg after insert on public.posts for each row execute function public.trg_post_notify();

notify pgrst, 'reload schema';

-- ===== v25: ABOUT YOU (bio, program, college/institute) + MANDATORY ACCOUNT SETUP + "My university" people list =====
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists program text not null default '';
alter table public.profiles add column if not exists institute text not null default '';
do $$ begin
  alter table public.profiles add constraint profiles_about_len check (char_length(bio) <= 200 and char_length(program) <= 100 and char_length(institute) <= 100) not valid;
exception when duplicate_object then null; end $$;
create index if not exists profiles_school_idx on public.profiles (lower(school));

-- A new account cannot be marked as set up unless it has a name, a state university and a program.
-- Only the moment of finishing setup is checked, so students who were already set up are never locked out.
create or replace function public.profiles_setup_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.bio := left(btrim(coalesce(new.bio, '')), 200);
  new.program := left(btrim(coalesce(new.program, '')), 100);
  new.institute := left(btrim(coalesce(new.institute, '')), 100);
  if coalesce(current_setting('app.bypass_guard', true), '') = '1' or auth.uid() is null then return new; end if;   -- trusted server code / SQL editor
  if not new.onboarded then return new; end if;
  if tg_op = 'UPDATE' then
    if coalesce(old.onboarded, false) then return new; end if;     -- already set up before: never locked out, never re-checked
  end if;
  if btrim(coalesce(new.display_name, '')) = '' then raise exception 'Add your name to finish setting up your account.'; end if;
  if btrim(coalesce(new.school, '')) = '' then raise exception 'Choose your state university to finish setting up your account.'; end if;
  if char_length(new.program) < 2 then raise exception 'Add your program (for example BS Information Technology) to finish setting up your account.'; end if;
  return new;
end $$;
drop trigger if exists profiles_setup_guard_trg on public.profiles;
create trigger profiles_setup_guard_trg before insert or update on public.profiles for each row execute function public.profiles_setup_guard();

-- Nothing can be posted, commented, flagged, requested or followed until the account is set up (checked in the database, not only in the app).
-- These are RESTRICTIVE policies: they are added on top of every existing rule, so nothing else has to change.
create or replace function public.is_onboarded() returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select onboarded from public.profiles where user_id = auth.uid()), false) $$;
revoke all on function public.is_onboarded() from public, anon;
grant execute on function public.is_onboarded() to authenticated;
do $$
declare t text;
begin
  foreach t in array array['posts', 'post_comments', 'post_reactions', 'reviewer_flags', 'reviewer_requests', 'follows', 'personal_events', 'study_log'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "setup first" on public.%I', t);
      execute format('create policy "setup first" on public.%I as restrictive for insert to authenticated with check (public.is_onboarded() or public.is_admin())', t);
    end if;
  end loop;
end $$;

-- ===== v34: ADMIN ANNOUNCEMENTS IN THE FEED (premium post, hidden author, video, pin) =====
-- An announcement is a normal post with is_announcement = true. It is ALSO stored as is_anonymous = true, so the existing
-- anonymity protection hides which admin wrote it (students never get the real user_id, not even through the API).
-- The app shows it as the official "AraLab" account instead of "Anonymous student".
alter table public.posts add column if not exists is_announcement boolean not null default false;
alter table public.posts add column if not exists title text not null default '';
alter table public.posts add column if not exists video_url text;
alter table public.posts add column if not exists is_pinned boolean not null default false;
do $$ begin
  alter table public.posts add constraint posts_title_len check (char_length(title) <= 120) not valid;
exception when duplicate_object then null; end $$;
create index if not exists posts_pinned_idx on public.posts (created_at desc) where is_pinned;

alter table public.posts drop constraint if exists posts_not_empty;
alter table public.posts add constraint posts_not_empty check (
  is_share or stats is not null or cardinality(images) > 0 or video_url is not null
  or char_length(btrim(body, E' \t\r\n')) > 0 or char_length(btrim(title)) > 0) not valid;

-- Guard rails (full replacement of the earlier version, plus the announcement rules):
--  * only admins can create an announcement; it is always anonymous in the database and never a repost or stats post
--  * only announcements can have a title, a video or a pin; the video must be in OUR post-videos bucket, in the admin's own folder
--  * on edit: the kind and the video are locked; the title can change; only the owner admin can pin / unpin
create or replace function public.posts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare root uuid; img text;
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.edited_at := null; new.body := btrim(new.body, E' \t\r\n'); new.title := btrim(coalesce(new.title, ''));
    if new.is_announcement then
      if not public.is_admin() then raise exception 'Only admins can post announcements.'; end if;
      new.is_anonymous := true; new.shared_from := null; new.stats := null;
    else
      new.title := ''; new.video_url := null; new.is_pinned := false;
      if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
        raise exception 'You are posting too fast. Please wait a bit.';
      end if;
    end if;
    foreach img in array new.images loop
      if img !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/post-images/' or position(new.user_id::text in img) = 0 then
        raise exception 'Invalid image.';
      end if;
    end loop;
    if new.video_url is not null and (new.video_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/post-videos/' or position(new.user_id::text in new.video_url) = 0) then
      raise exception 'Invalid video.';
    end if;
    if new.stats is not null then new.stats := public.compute_stats(new.user_id, new.stats ->> 'tz'); end if;
    if new.stats_layout not in ('compact','rings','weekly','subjects') then new.stats_layout := 'compact'; end if;
    if new.shared_from is not null then
      select coalesce(p.shared_from, p.id) into root from public.posts p where p.id = new.shared_from;
      if root is null then raise exception 'That post no longer exists.'; end if;
      new.shared_from := root; new.is_share := true;
    else
      new.is_share := false;
    end if;
  else
    new.user_id := old.user_id; new.stats := old.stats; new.is_share := old.is_share; new.created_at := old.created_at;
    new.is_anonymous := old.is_anonymous; new.stats_layout := old.stats_layout; new.images := old.images;
    new.is_announcement := old.is_announcement; new.video_url := old.video_url;
    new.title := case when old.is_announcement then left(btrim(coalesce(new.title, '')), 120) else '' end;
    new.is_pinned := case when old.is_announcement and public.is_admin() then new.is_pinned else old.is_pinned end;
    new.shared_from := case when new.shared_from is null then null else old.shared_from end;
    new.body := btrim(new.body, E' \t\r\n');
    new.edited_at := case when new.body is distinct from old.body or new.title is distinct from old.title then now() else old.edited_at end;
  end if;
  return new;
end $$;

-- the feed view gets the new columns (added at the end, so the view can be replaced in place)
create or replace view public.posts_feed as
select p.id,
       case when p.is_anonymous and p.user_id <> auth.uid() and not public.is_admin() then null else p.user_id end as user_id,
       p.body, p.stats, p.stats_layout, p.images, p.is_share, p.shared_from, p.is_anonymous, p.created_at, p.edited_at,
       (p.user_id = auth.uid()) as is_mine,
       p.removed_at, p.removed_reason,
       p.is_announcement, p.title, p.video_url, p.is_pinned
from public.posts p
where p.removed_at is null or p.user_id = auth.uid() or public.is_admin();
revoke all on public.posts_feed from public, anon;
grant select on public.posts_feed to authenticated;

-- an announcement tells every set-up student in the bell (no actor, so it never points at the admin)
create or replace function public.trg_post_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_announcement then
    insert into public.notifications (user_id, kind, text, ref, actor_id)
    select p.user_id, 'post', 'New announcement: ' || left(coalesce(nullif(new.title, ''), nullif(new.body, ''), 'see the feed'), 80), new.id::text, null
    from public.profiles p where p.onboarded and p.user_id <> new.user_id;
    return new;
  end if;
  if coalesce(to_jsonb(new)->>'is_anonymous', 'false') = 'true' then return new; end if;
  perform public.notify_many(array(select follower from public.follows where followee = new.user_id), 'post', public.display_of(new.user_id) || ' posted in the feed', new.id::text, new.user_id);
  return new;
end $$;

-- announcement videos: public read, ONLY admins can upload (own folder), mp4 / webm / mov, 50 MB each
-- (Supabase also has a project-wide upload limit under Storage > Settings; the lower of the two applies)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-videos', 'post-videos', true, 52428800, array['video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "postvid public read" on storage.objects;
drop policy if exists "postvid admin insert" on storage.objects;
drop policy if exists "postvid admin delete" on storage.objects;
create policy "postvid public read"   on storage.objects for select using (bucket_id = 'post-videos');
create policy "postvid admin insert"  on storage.objects for insert to authenticated with check (bucket_id = 'post-videos' and public.is_admin() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "postvid admin delete"  on storage.objects for delete to authenticated using (bucket_id = 'post-videos' and public.is_admin());

-- ===== v35: TASK NOTIFICATIONS FOR ADMIN + ASTRA =====
-- Whenever something needs a decision, the people who must act get a bell notification:
--   new reviewer request  -> Astra of the requester's school + admins
--   new flag on a reviewer -> Astra of the flagger's school + admins
--   new Astra application / new ban report -> admins only
-- The writer is never notified about their own action, no actor is stored, and a notification problem can never block the original insert.
create or replace function public.notify_staff(_school text, _kind text, _text text, _ref text, _skip uuid, _admins_only boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, kind, text, ref, actor_id)
  select distinct t.uid, _kind, _text, _ref, null
  from (
    select user_id as uid from public.admins
    union
    select user_id from public.astra_members
    where not _admins_only and lower(btrim(school)) = lower(btrim(coalesce(_school, '')))
  ) t
  join public.profiles p on p.user_id = t.uid
  where t.uid is distinct from _skip;
exception when others then null;
end $$;
revoke all on function public.notify_staff(text, text, text, text, uuid, boolean) from public, anon, authenticated;

create or replace function public.trg_task_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    perform public.notify_staff((select school from public.profiles where user_id = new.user_id), 'task_request',
      'New reviewer request to review: ' || left(new.title, 80), new.id::text, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists task_request_trg on public.reviewer_requests;
create trigger task_request_trg after insert on public.reviewer_requests for each row execute function public.trg_task_request();

create or replace function public.trg_task_flag() returns trigger language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select title into t from public.reviewers where id = new.reviewer_id;
  perform public.notify_staff((select school from public.profiles where user_id = new.user_id), 'task_flag',
    'New flag to check on “' || left(coalesce(t, 'a reviewer'), 70) || '”', new.reviewer_id, new.user_id);
  return new;
end $$;
drop trigger if exists task_flag_trg on public.reviewer_flags;
create trigger task_flag_trg after insert on public.reviewer_flags for each row execute function public.trg_task_flag();

create or replace function public.trg_task_app() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    perform public.notify_staff(new.school, 'task_app', 'New Astra application from ' || coalesce(nullif(public.display_of(new.user_id), ''), 'a student') || ' (' || left(new.school, 50) || ')', new.id::text, new.user_id, true);
  end if;
  return new;
end $$;
drop trigger if exists task_app_trg on public.astra_applications;
create trigger task_app_trg after insert on public.astra_applications for each row execute function public.trg_task_app();

create or replace function public.trg_task_ban() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    perform public.notify_staff(new.school, 'task_ban', 'New ban report waiting for your decision', new.id::text, new.reporter_id, true);
  end if;
  return new;
end $$;
drop trigger if exists task_ban_trg on public.ban_reports;
create trigger task_ban_trg after insert on public.ban_reports for each row execute function public.trg_task_ban();


-- ===== v38: abuse / crash hardening (safe to re-run) =====
-- 1. Length limits in the database (the browser limits alone can be bypassed with the API). NOT VALID = old rows are left alone.
do $$ begin
  alter table public.reviewer_requests add constraint rr_lengths check (char_length(title) <= 120 and char_length(subject) <= 60 and char_length(topic) <= 120 and char_length(coverage) <= 800) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.reviewers add constraint reviewers_lengths check (char_length(title) <= 200 and char_length(subject) <= 60 and char_length(html) <= 5000000) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_lengths check (char_length(display_name) <= 40 and char_length(coalesce(bio, '')) <= 200 and char_length(coalesce(program, '')) <= 100 and char_length(coalesce(institute, '')) <= 100) not valid;
exception when duplicate_object then null; end $$;

-- 2. Private notes bucket: 25 MB per file (was only checked in the browser)
update storage.buckets set file_size_limit = 26214400 where id = 'notes';

-- 3. Rate limits so nobody can spam notifications or the database
create or replace function public.follow_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.follows where follower = new.follower and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'You are following people too fast. Try again later.';
  end if;
  return new;
end $$;
drop trigger if exists follow_guard_trg on public.follows;
create trigger follow_guard_trg before insert on public.follows for each row execute function public.follow_guard();

create or replace function public.reaction_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.post_reactions where user_id = new.user_id and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Too many reactions. Try again later.';
  end if;
  return new;
end $$;
drop trigger if exists reaction_guard_trg on public.post_reactions;
create trigger reaction_guard_trg before insert on public.post_reactions for each row execute function public.reaction_guard();

create or replace function public.pevents_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.personal_events where user_id = new.user_id) >= 300 then
    raise exception 'You reached the limit of 300 events. Delete old ones first.';
  end if;
  return new;
end $$;
drop trigger if exists pevents_guard_trg on public.personal_events;
create trigger pevents_guard_trg before insert on public.personal_events for each row execute function public.pevents_guard();

-- 4. Who spent the AI budget (so one Astra member cannot use up everyone's daily allowance)
alter table public.usage add column if not exists approver_id uuid;
create index if not exists usage_approver_idx on public.usage (approver_id, at);

notify pgrst, 'reload schema';


-- =====================================================================
-- ===== v47: unlimited AI generation + AI scan + staff monitoring  ====
-- =====      (safe to re-run)                                        ====
--  * students generate straight away (no approval); the server scans first:
--    study-related? inappropriate? already in the Library?
--  * Astra (own school) and admins can pause a student's generation, remove a
--    reviewer, or report a student, always with a written reason; the student is notified
-- =====================================================================

-- 1. a student can be paused from generating (set only by pause_generation / resume_generation below)
alter table public.profiles add column if not exists gen_paused_until timestamptz;
alter table public.profiles add column if not exists gen_pause_reason text not null default '';
alter table public.profiles add column if not exists gen_paused_by uuid;

create or replace function public.profiles_gen_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.bypass_guard', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if not public.is_admin() then new.gen_paused_until := null; new.gen_pause_reason := ''; new.gen_paused_by := null; end if;
  elsif not public.is_admin() then
    new.gen_paused_until := old.gen_paused_until; new.gen_pause_reason := old.gen_pause_reason; new.gen_paused_by := old.gen_paused_by;
  end if;
  return new;
end $$;
drop trigger if exists profiles_gen_guard_trg on public.profiles;
create trigger profiles_gen_guard_trg before insert or update on public.profiles for each row execute function public.profiles_gen_guard();

-- 2. a reviewer can be removed (hidden from everyone but its owner and admins) with a reason
alter table public.reviewers add column if not exists removed_at timestamptz;
alter table public.reviewers add column if not exists removed_reason text;
alter table public.reviewers add column if not exists removed_by uuid;

create or replace function public.reviewers_removed_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.bypass_guard', true), '') = '1' or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.removed_at := null; new.removed_reason := null; new.removed_by := null;
  else
    new.removed_at := old.removed_at; new.removed_reason := old.removed_reason; new.removed_by := old.removed_by;
    if old.removed_at is not null then new.is_public := false; end if;      -- an owner cannot un-remove their own reviewer
  end if;
  return new;
end $$;
drop trigger if exists reviewers_removed_guard_trg on public.reviewers;
create trigger reviewers_removed_guard_trg before insert or update on public.reviewers for each row execute function public.reviewers_removed_guard();

-- 3. every generation attempt (written by the server only): what the AI scan decided and why
create table if not exists public.gen_log (
  id bigint generated always as identity primary key,
  user_id uuid not null, request_id uuid, title text not null default '',
  outcome text not null check (outcome in ('generated','blocked','duplicate','failed')),
  category text not null default '', reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists gen_log_user_idx on public.gen_log (user_id, created_at desc);
alter table public.gen_log enable row level security;
drop policy if exists "gen_log own read" on public.gen_log;
drop policy if exists "gen_log staff read" on public.gen_log;
create policy "gen_log own read" on public.gen_log for select to authenticated using (user_id = auth.uid());
create policy "gen_log staff read" on public.gen_log for select to authenticated using (public.is_admin() or public.is_astra_for(user_id));

-- 4. audit log of what staff did (pause, resume, remove, restore, report)
create table if not exists public.mod_actions (
  id bigint generated always as identity primary key,
  actor_id uuid not null, target_id uuid,
  kind text not null check (kind in ('pause','resume','remove_reviewer','restore_reviewer','report')),
  reason text not null default '', ref text, school text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists mod_actions_idx on public.mod_actions (created_at desc);
alter table public.mod_actions enable row level security;
drop policy if exists "mod_actions read" on public.mod_actions;
create policy "mod_actions read" on public.mod_actions for select to authenticated using (public.is_admin() or actor_id = auth.uid());

-- 5. nobody approves requests any more: students generate straight away, so staff are no longer pinged per request.
--    The "pending" cap only guards against spam while a request is being uploaded.
create or replace function public.trg_task_request() returns trigger language plpgsql security definer set search_path = public as $$
begin return new; end $$;
drop policy if exists "own insert max 2 pending" on public.reviewer_requests;
drop policy if exists "own insert max 5 pending" on public.reviewer_requests;
create policy "own insert max 5 pending" on public.reviewer_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and (select count(*) from public.reviewer_requests r where r.user_id = auth.uid() and r.status = 'pending') < 5);

-- 6. staff actions. Every one needs a written reason and notifies the student.
create or replace function public.pause_generation(_uid uuid, _days int, _reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare u timestamptz; r text := btrim(coalesce(_reason, '')); adm boolean := public.is_admin(); sch text;
begin
  if not adm and not public.is_astra_for(_uid) then raise exception 'You can only act on students of your own school.'; end if;
  if _uid = auth.uid() then raise exception 'You cannot pause yourself.'; end if;
  if exists (select 1 from public.admins a where a.user_id = _uid) then raise exception 'You cannot pause an admin.'; end if;
  if char_length(r) < 10 then raise exception 'Write the reason (at least 10 characters). The student will see it.'; end if;
  if adm then
    if _days not in (0, 1, 3, 7, 30) then raise exception 'Pick 1, 3, 7, 30 days or until lifted.'; end if;
  elsif _days not in (1, 3, 7) then raise exception 'Pick 1, 3 or 7 days.'; end if;
  u := case when _days = 0 then now() + interval '10 years' else now() + make_interval(days => _days) end;
  sch := coalesce(public.school_of(_uid), '');
  perform set_config('app.bypass_guard', '1', true);
  update public.profiles set gen_paused_until = u, gen_pause_reason = left(r, 300), gen_paused_by = auth.uid() where user_id = _uid;
  insert into public.mod_actions (actor_id, target_id, kind, reason, ref, school) values (auth.uid(), _uid, 'pause', left(r, 300), u::text, sch);
  insert into public.notifications (user_id, kind, text, ref, actor_id)
    values (_uid, 'gen_pause', 'Your reviewer generation is paused ' || case when _days = 0 then 'until it is lifted' else 'until ' || to_char(u, 'Mon DD') end || '. Reason: ' || left(r, 200), null, null);
  if not adm then perform public.notify_staff(sch, 'task_gen', 'Astra paused a student’s generation: ' || left(r, 120), _uid::text, auth.uid(), true); end if;
  return true;
end $$;
revoke all on function public.pause_generation(uuid, int, text) from public, anon;
grant execute on function public.pause_generation(uuid, int, text) to authenticated;

create or replace function public.resume_generation(_uid uuid, _note text default '') returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and not public.is_astra_for(_uid) then raise exception 'You can only act on students of your own school.'; end if;
  perform set_config('app.bypass_guard', '1', true);
  update public.profiles set gen_paused_until = null, gen_pause_reason = '', gen_paused_by = null where user_id = _uid and gen_paused_until is not null;
  if not found then return false; end if;
  insert into public.mod_actions (actor_id, target_id, kind, reason, school) values (auth.uid(), _uid, 'resume', left(coalesce(_note, ''), 300), coalesce(public.school_of(_uid), ''));
  insert into public.notifications (user_id, kind, text, ref, actor_id) values (_uid, 'gen_resume', 'You can generate reviewers again.', null, null);
  return true;
end $$;
revoke all on function public.resume_generation(uuid, text) from public, anon;
grant execute on function public.resume_generation(uuid, text) to authenticated;

create or replace function public.remove_reviewer(_id text, _reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare o uuid; t text; r text := btrim(coalesce(_reason, '')); adm boolean := public.is_admin(); sch text;
begin
  select owner_id, title into o, t from public.reviewers where id = _id and removed_at is null;
  if t is null then return false; end if;
  if o = auth.uid() then raise exception 'You cannot remove your own reviewer here. Delete it from the Library.'; end if;
  if not adm and (o is null or not public.is_astra_for(o)) then raise exception 'You can only remove reviewers made by students of your own school.'; end if;
  if char_length(r) < 10 then raise exception 'Write the reason (at least 10 characters). The student will see it.'; end if;
  sch := coalesce(public.school_of(o), '');
  perform set_config('app.bypass_guard', '1', true);
  update public.reviewers set is_public = false, removed_at = now(), removed_reason = left(r, 300), removed_by = auth.uid() where id = _id;
  insert into public.mod_actions (actor_id, target_id, kind, reason, ref, school) values (auth.uid(), o, 'remove_reviewer', left(r, 300), _id, sch);
  if o is not null then
    insert into public.notifications (user_id, kind, text, ref, actor_id) values (o, 'reviewer_removed', 'Your reviewer “' || left(t, 70) || '” was removed from the Library. Reason: ' || left(r, 200), _id, null);
  end if;
  if not adm then perform public.notify_staff(sch, 'task_gen', 'Astra removed the reviewer “' || left(t, 60) || '”: ' || left(r, 100), _id, auth.uid(), true); end if;
  return true;
end $$;
revoke all on function public.remove_reviewer(text, text) from public, anon;
grant execute on function public.remove_reviewer(text, text) to authenticated;

create or replace function public.restore_reviewer(_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare o uuid; t text;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select owner_id, title into o, t from public.reviewers where id = _id and removed_at is not null;
  if t is null then return false; end if;
  perform set_config('app.bypass_guard', '1', true);
  update public.reviewers set is_public = true, removed_at = null, removed_reason = null, removed_by = null where id = _id;
  insert into public.mod_actions (actor_id, target_id, kind, ref, school) values (auth.uid(), o, 'restore_reviewer', _id, coalesce(public.school_of(o), ''));
  if o is not null then insert into public.notifications (user_id, kind, text, ref, actor_id) values (o, 'reviewer_restored', 'Your reviewer “' || left(t, 70) || '” is back in the Library.', _id, null); end if;
  return true;
end $$;
revoke all on function public.restore_reviewer(text) from public, anon;
grant execute on function public.restore_reviewer(text) to authenticated;

-- Astra -> admin: report a student's generation behaviour. Reuses the ban report queue (admin decides). The student is NOT told until the admin acts.
create or replace function public.report_generation(_uid uuid, _reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare r text := btrim(coalesce(_reason, '')); ev jsonb; sch text;
begin
  if not public.is_astra_for(_uid) then raise exception 'You can only report students of your own school.'; end if;
  if _uid = auth.uid() then raise exception 'You cannot report yourself.'; end if;
  if exists (select 1 from public.admins a where a.user_id = _uid) then raise exception 'You cannot report an admin.'; end if;
  if char_length(r) < 20 then raise exception 'Explain what happened (at least 20 characters).'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'request', 'text', left(x.title || ' - ' || x.outcome || ': ' || x.reason, 400), 'ref', to_char(x.created_at, 'YYYY-MM-DD HH24:MI'))), '[]'::jsonb)
    into ev from (select * from public.gen_log g where g.user_id = _uid and g.outcome in ('blocked', 'duplicate') order by g.created_at desc limit 8) x;
  if jsonb_array_length(ev) = 0 then ev := jsonb_build_array(jsonb_build_object('kind', 'other', 'text', 'Reported from generation monitoring.', 'ref', '')); end if;
  sch := coalesce(public.school_of(_uid), '');
  insert into public.ban_reports (reporter_id, target_id, school, category, details, evidence) values (auth.uid(), _uid, sch, 'other', left(r, 1500), ev);
  insert into public.mod_actions (actor_id, target_id, kind, reason, school) values (auth.uid(), _uid, 'report', left(r, 300), sch);
  return true;
end $$;
revoke all on function public.report_generation(uuid, text) from public, anon;
grant execute on function public.report_generation(uuid, text) to authenticated;

-- usage monitor: admins see everyone, an Astra member sees the students of their own school
create or replace function public.gen_monitor() returns table (
  user_id uuid, display_name text, student_no text, school text,
  attempts_today int, attempts_week int, generated_week int, blocked_week int, last_at timestamptz, paused_until timestamptz, pause_reason text)
language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  if not public.is_admin() then
    select lower(btrim(m.school)) into s from public.astra_members m where m.user_id = auth.uid();
    if s is null then return; end if;
  end if;
  return query
  select p.user_id, p.display_name, p.student_no, p.school,
    (count(g.id) filter (where g.created_at > now() - interval '1 day'))::int,
    (count(g.id) filter (where g.created_at > now() - interval '7 days'))::int,
    (count(g.id) filter (where g.outcome = 'generated' and g.created_at > now() - interval '7 days'))::int,
    (count(g.id) filter (where g.outcome in ('blocked', 'duplicate') and g.created_at > now() - interval '7 days'))::int,
    max(g.created_at),
    case when p.gen_paused_until > now() then p.gen_paused_until end,
    case when p.gen_paused_until > now() then p.gen_pause_reason else '' end
  from public.profiles p
  left join public.gen_log g on g.user_id = p.user_id and g.created_at > now() - interval '30 days'
  where (s is null or lower(btrim(p.school)) = s)
  group by p.user_id, p.display_name, p.student_no, p.school, p.gen_paused_until, p.gen_pause_reason
  having count(g.id) > 0 or p.gen_paused_until > now()
  order by 8 desc, 5 desc
  limit 300;
end $$;
revoke all on function public.gen_monitor() from public, anon;
grant execute on function public.gen_monitor() to authenticated;

-- ===== v48: visitors + stars on reviewers (safe to re-run) =====
-- One row per student per reviewer (so "visitors" = unique students). The owner's own opens are never counted.
-- Counts are NOT stored on `reviewers`, so an owner cannot edit them through the API: they are computed in the view below.
create table if not exists public.reviewer_visits (
  reviewer_id text not null references public.reviewers(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  visits integer not null default 1, first_at timestamptz not null default now(), last_at timestamptz not null default now(),
  primary key (reviewer_id, user_id)
);
create table if not exists public.reviewer_stars (
  reviewer_id text not null references public.reviewers(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (reviewer_id, user_id)
);
create index if not exists reviewer_stars_user_idx on public.reviewer_stars (user_id);
alter table public.reviewer_visits enable row level security;   -- no policies: written only by record_visit()
alter table public.reviewer_stars enable row level security;
drop policy if exists "own stars read" on public.reviewer_stars;
create policy "own stars read" on public.reviewer_stars for select to authenticated using (user_id = auth.uid());

-- e-mail opt-out (default on) and the milestones waiting to be e-mailed (read/written only by the server with the service key)
alter table public.profiles add column if not exists email_milestones boolean not null default true;
create table if not exists public.reviewer_milestones (
  reviewer_id text not null references public.reviewers(id) on delete cascade,
  milestone integer not null, owner_id uuid not null, title text not null default '',
  created_at timestamptz not null default now(), emailed_at timestamptz,
  primary key (reviewer_id, milestone)
);
alter table public.reviewer_milestones enable row level security;   -- no policies: students cannot read or write it

-- a student opens a reviewer (called once per open by the app). Returns the milestone just reached (10, 25, 50 ... visitors) or 0.
drop function if exists public.record_visit(text);
create or replace function public.record_visit(_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare o uuid; t text; n int; fresh boolean;
begin
  if auth.uid() is null or not public.is_onboarded() then return 0; end if;
  select owner_id, title into o, t from public.reviewers where id = _id and is_public and removed_at is null;
  if not found or o is not distinct from auth.uid() then return 0; end if;
  insert into public.reviewer_visits as rv (reviewer_id, user_id) values (_id, auth.uid())
    on conflict (reviewer_id, user_id) do update set visits = rv.visits + 1, last_at = now()
    returning (xmax = 0) into fresh;
  if fresh and o is not null then
    select count(*) into n from public.reviewer_visits where reviewer_id = _id;
    if n in (10, 25, 50, 100, 250, 500, 1000) then
      perform public.notify_many(array[o], 'visits', n || ' students have studied “' || left(t, 60) || '”', _id, null);
      insert into public.reviewer_milestones (reviewer_id, milestone, owner_id, title) values (_id, n, o, left(t, 160)) on conflict do nothing;
      return n;
    end if;
  end if;
  return 0;
end $$;
revoke all on function public.record_visit(text) from public, anon;
grant execute on function public.record_visit(text) to authenticated;

-- star / un-star; returns true when the reviewer is starred afterwards
create or replace function public.toggle_star(_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare o uuid; t text;
begin
  if auth.uid() is null or not public.is_onboarded() then raise exception 'Finish setting up your account first.'; end if;
  select owner_id, title into o, t from public.reviewers where id = _id and (is_public or owner_id = auth.uid() or public.is_admin());
  if not found then raise exception 'Reviewer not found.'; end if;
  if exists (select 1 from public.reviewer_stars where reviewer_id = _id and user_id = auth.uid()) then
    delete from public.reviewer_stars where reviewer_id = _id and user_id = auth.uid(); return false;
  end if;
  insert into public.reviewer_stars (reviewer_id) values (_id);
  if o is not null and o is distinct from auth.uid() then
    perform public.notify_many(array[o], 'star', public.display_of(auth.uid()) || ' starred “' || left(t, 60) || '”', _id, auth.uid());
  end if;
  return true;
end $$;
revoke all on function public.toggle_star(text) from public, anon;
grant execute on function public.toggle_star(text) to authenticated;

-- counts for the Library (only reviewers the caller may see)
drop view if exists public.reviewer_stats;  -- re-runs: the later v50 definition has an extra column, and CREATE OR REPLACE can't drop it
create or replace view public.reviewer_stats as
  select r.id as reviewer_id,
         coalesce(v.visitors, 0)::int as visitors, coalesce(v.views, 0)::int as views, coalesce(s.stars, 0)::int as stars
  from public.reviewers r
  left join (select reviewer_id, count(*) visitors, sum(visits) views from public.reviewer_visits group by 1) v on v.reviewer_id = r.id
  left join (select reviewer_id, count(*) stars from public.reviewer_stars group by 1) s on s.reviewer_id = r.id
  where r.is_public or r.owner_id = auth.uid() or public.is_admin();
revoke all on public.reviewer_stats from public, anon;
grant select on public.reviewer_stats to authenticated;

notify pgrst, 'reload schema';


-- ===== v50: @MENTIONS, COMMENT REPLIES + REACTIONS, AND ANONYMOUS ALIASES =====
-- Mentions are stored as [{ "id": "<uuid>", "name": "<display name>" }] on posts and comments. The database sends the
-- notifications, so a mention works even if the writer closes the app straight away. Replies use post_comments.parent_id
-- (one level in the UI, like Facebook). Anonymous rows get a random per-student alias ("Anonymous 7K2F9") so readers can
-- tell whether two anonymous messages come from the same person without ever learning who that person is.

-- ---------- 1. columns ----------
alter table public.posts add column if not exists mentions jsonb not null default '[]'::jsonb;
alter table public.post_comments add column if not exists parent_id uuid references public.post_comments(id) on delete cascade;
alter table public.post_comments add column if not exists mentions jsonb not null default '[]'::jsonb;
create index if not exists comments_parent_idx on public.post_comments (parent_id);

-- the random alias is generated here, server-side. It is NOT a hash of the user id, so nobody can turn it back into a name.
-- Aliases live in their own table with RLS on and NO policies, so signed-in users can never read the alias -> real name link.
-- Only the feed views (owned by the database) can see it, and they blank the real author on anonymous rows.
create or replace function public.make_anon_alias() returns text
language sql volatile set search_path = public as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 5)
$$;
create table if not exists public.anon_aliases (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now()
);
alter table public.anon_aliases enable row level security;
revoke all on public.anon_aliases from public, anon, authenticated;

insert into public.anon_aliases (user_id, alias)
select p.user_id, public.make_anon_alias() from public.profiles p
on conflict (user_id) do nothing;

-- every new student gets one alias, made by the database (never by the browser)
create or replace function public.trg_profile_alias() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.anon_aliases (user_id, alias) values (new.user_id, public.make_anon_alias())
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists profile_alias_trg on public.profiles;
create trigger profile_alias_trg after insert on public.profiles for each row execute function public.trg_profile_alias();

-- ---------- 2. comment reactions ----------
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  emoji text not null check (emoji in ('like','love','fire','clap','wow')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)                -- one reaction per person per comment (they can change it)
);
create index if not exists comment_reactions_comment_idx on public.comment_reactions (comment_id);
alter table public.comment_reactions enable row level security;
drop policy if exists "comment reactions read"   on public.comment_reactions;
drop policy if exists "comment reactions insert" on public.comment_reactions;
drop policy if exists "comment reactions update" on public.comment_reactions;
drop policy if exists "comment reactions delete" on public.comment_reactions;
create policy "comment reactions read"   on public.comment_reactions for select to authenticated using (true);
create policy "comment reactions insert" on public.comment_reactions for insert to authenticated with check (user_id = auth.uid());
create policy "comment reactions update" on public.comment_reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "comment reactions delete" on public.comment_reactions for delete to authenticated using (user_id = auth.uid());
drop policy if exists "setup first" on public.comment_reactions;
create policy "setup first" on public.comment_reactions as restrictive for insert to authenticated with check (public.is_onboarded() or public.is_admin());
do $$ begin alter publication supabase_realtime add table public.comment_reactions; exception when others then null; end $$;

-- replies must point at a comment on the same post; the parent can't be moved after the fact
create or replace function public.comments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.edited_at := null; new.body := btrim(new.body, E' \t\r\n');
    if new.parent_id is not null and not exists (select 1 from public.post_comments where id = new.parent_id and post_id = new.post_id) then
      raise exception 'That comment is not on this post.';
    end if;
    if (select count(*) from public.post_comments where user_id = new.user_id and created_at > now() - interval '1 hour') >= 60 then
      raise exception 'You are commenting too fast. Please wait a bit.';
    end if;
  else
    new.post_id := old.post_id; new.user_id := old.user_id; new.parent_id := old.parent_id; new.is_anonymous := old.is_anonymous;
    new.created_at := old.created_at; new.body := btrim(new.body, E' \t\r\n');
    new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  end if;
  return new;
end $$;

-- ---------- 3. views get the new columns at the end ----------
create or replace view public.posts_feed as
select p.id,
       case when p.is_anonymous and p.user_id <> auth.uid() and not public.is_admin() then null else p.user_id end as user_id,
       p.body, p.stats, p.stats_layout, p.images, p.is_share, p.shared_from, p.is_anonymous, p.created_at, p.edited_at,
       (p.user_id = auth.uid()) as is_mine,
       p.removed_at, p.removed_reason,
       p.is_announcement, p.title, p.video_url, p.is_pinned,
       p.mentions,
       (select a.alias from public.anon_aliases a where a.user_id = p.user_id) as anon_alias
from public.posts p
where p.removed_at is null or p.user_id = auth.uid() or public.is_admin();
revoke all on public.posts_feed from public, anon;
grant select on public.posts_feed to authenticated;

create or replace view public.post_comments_feed as
select c.id, c.post_id,
       case when c.is_anonymous and c.user_id <> auth.uid() and not public.is_admin() then null else c.user_id end as user_id,
       c.body, c.is_anonymous, c.created_at, c.edited_at, (c.user_id = auth.uid()) as is_mine,
       c.parent_id, c.mentions,
       (select a.alias from public.anon_aliases a where a.user_id = c.user_id) as anon_alias
from public.post_comments c;
revoke all on public.post_comments_feed from public, anon;
grant select on public.post_comments_feed to authenticated;

-- ---------- 4. notifications ----------
-- pull the valid user ids out of a mentions jsonb array (bad rows are ignored instead of breaking the post)
create or replace function public.mention_ids(_m jsonb) returns uuid[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[])
  from (
    select (e->>'id')::uuid as x
    from jsonb_array_elements(case when jsonb_typeof(_m) = 'array' then _m else '[]'::jsonb end) e
    where (e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) s
$$;

-- someone was @mentioned in a post (on edit, only the newly added names are notified)
create or replace function public.trg_post_mention_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  if tg_op = 'UPDATE' then
    ids := array(select unnest(public.mention_ids(new.mentions)) except select unnest(public.mention_ids(old.mentions)));
  else
    ids := public.mention_ids(new.mentions);
  end if;
  ids := array(select u from unnest(ids) u join public.profiles p on p.user_id = u where u <> new.user_id);
  if coalesce(array_length(ids, 1), 0) = 0 then return new; end if;
  if new.is_anonymous then
    perform public.notify_many(ids, 'mention', 'Someone mentioned you in a post', new.id::text, null);
  else
    perform public.notify_many(ids, 'mention', public.display_of(new.user_id) || ' mentioned you in a post', new.id::text, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists post_mention_notify_trg on public.posts;
create trigger post_mention_notify_trg after insert or update of mentions on public.posts for each row execute function public.trg_post_mention_notify();

-- someone was @mentioned in a comment
create or replace function public.trg_comment_mention_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  if tg_op = 'UPDATE' then
    ids := array(select unnest(public.mention_ids(new.mentions)) except select unnest(public.mention_ids(old.mentions)));
  else
    ids := public.mention_ids(new.mentions);
  end if;
  ids := array(select u from unnest(ids) u join public.profiles p on p.user_id = u where u <> new.user_id);
  if coalesce(array_length(ids, 1), 0) = 0 then return new; end if;
  if new.is_anonymous then
    perform public.notify_many(ids, 'mention', 'Someone mentioned you in a comment', new.post_id::text, null);
  else
    perform public.notify_many(ids, 'mention', public.display_of(new.user_id) || ' mentioned you in a comment', new.post_id::text, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists comment_mention_notify_trg on public.post_comments;
create trigger comment_mention_notify_trg after insert or update of mentions on public.post_comments for each row execute function public.trg_comment_mention_notify();

-- the post owner hears about every comment / reply on their post (anonymous writers stay hidden)
create or replace function public.trg_comment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select user_id into owner from public.posts where id = new.post_id;
  if owner is null or owner = new.user_id then return new; end if;
  if new.is_anonymous then
    perform public.notify_many(array[owner], 'comment', 'Someone commented on your post', new.post_id::text, null);
  else
    perform public.notify_many(array[owner], 'comment', public.display_of(new.user_id) || ' commented on your post', new.post_id::text, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists comment_notify_trg on public.post_comments;
create trigger comment_notify_trg after insert on public.post_comments for each row execute function public.trg_comment_notify();

-- the author of the comment being replied to hears about the reply (the post owner already got the "comment" one)
create or replace function public.trg_comment_reply_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare parent_author uuid; owner uuid;
begin
  if new.parent_id is null then return new; end if;
  select user_id into parent_author from public.post_comments where id = new.parent_id;
  select user_id into owner from public.posts where id = new.post_id;
  if parent_author is null or parent_author = new.user_id or parent_author = owner then return new; end if;
  if new.is_anonymous then
    perform public.notify_many(array[parent_author], 'comment_reply', 'Someone replied to your comment', new.post_id::text, null);
  else
    perform public.notify_many(array[parent_author], 'comment_reply', public.display_of(new.user_id) || ' replied to your comment', new.post_id::text, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists comment_reply_notify_trg on public.post_comments;
create trigger comment_reply_notify_trg after insert on public.post_comments for each row execute function public.trg_comment_reply_notify();

-- the author of a comment hears about a new reaction to it (changing a reaction doesn't notify again)
create or replace function public.trg_comment_reaction_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare author uuid; cpost uuid;
begin
  select user_id, post_id into author, cpost from public.post_comments where id = new.comment_id;
  if author is null or author = new.user_id then return new; end if;
  perform public.notify_many(array[author], 'comment_reaction', public.display_of(new.user_id) || ' reacted to your comment', cpost::text, new.user_id);
  return new;
end $$;
drop trigger if exists comment_reaction_notify_trg on public.comment_reactions;
create trigger comment_reaction_notify_trg after insert on public.comment_reactions for each row execute function public.trg_comment_reaction_notify();

-- ---------- 5. Library: recent visitors' profile circles ----------
-- reviewer_stats gets one extra column at the end: up to 8 recent visitors (name + avatar) per reviewer. The view runs as the
-- database owner, so it can read reviewer_visits (which has RLS and no policies) without exposing the raw table.
create or replace view public.reviewer_stats as
  select r.id as reviewer_id,
         coalesce(v.visitors, 0)::int as visitors, coalesce(v.views, 0)::int as views, coalesce(s.stars, 0)::int as stars,
         coalesce(f.faces, '[]'::jsonb) as visitor_faces
  from public.reviewers r
  left join (select reviewer_id, count(*) visitors, sum(visits) views from public.reviewer_visits group by 1) v on v.reviewer_id = r.id
  left join (select reviewer_id, count(*) stars from public.reviewer_stars group by 1) s on s.reviewer_id = r.id
  left join lateral (
    select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'display_name', x.display_name, 'avatar_url', x.avatar_url) order by x.last_at desc) as faces
    from (
      select vv.user_id, vv.last_at,
             coalesce(nullif(btrim(p.display_name), ''), 'Student') as display_name, p.avatar_url
      from public.reviewer_visits vv
      join public.profiles p on p.user_id = vv.user_id
      where vv.reviewer_id = r.id
      order by vv.last_at desc
      limit 8
    ) x
  ) f on true
  where r.is_public or r.owner_id = auth.uid() or public.is_admin();
revoke all on public.reviewer_stats from public, anon;
grant select on public.reviewer_stats to authenticated;

notify pgrst, 'reload schema';


-- ===== v51: IMAGES IN COMMENTS (safe to re-run) =====
-- Same rules as post photos: the post-images bucket only, inside the author's own folder, max 4.
alter table public.post_comments add column if not exists images text[] not null default '{}';
do $$ begin
  alter table public.post_comments add constraint comments_images_chk check (cardinality(images) <= 4) not valid;
exception when duplicate_object then null; end $$;

-- a comment may now be "photos only": text OR at least one image
alter table public.post_comments drop constraint if exists post_comments_body_check;
alter table public.post_comments drop constraint if exists comments_not_empty;
alter table public.post_comments add constraint comments_not_empty check (
  char_length(btrim(body, E' \t\r\n')) <= 1000 and (cardinality(images) > 0 or char_length(btrim(body, E' \t\r\n')) >= 1)) not valid;

-- the app uploads comment photos to the same post-images bucket as post photos (created in v4), so no new bucket is needed

create or replace function public.comments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare img text;
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.edited_at := null; new.body := btrim(new.body, E' \t\r\n');
    if new.parent_id is not null and not exists (select 1 from public.post_comments where id = new.parent_id and post_id = new.post_id) then
      raise exception 'That comment is not on this post.';
    end if;
    foreach img in array new.images loop
      if img !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/post-images/' or position(new.user_id::text in img) = 0 then
        raise exception 'Invalid image.';
      end if;
    end loop;
    if (select count(*) from public.post_comments where user_id = new.user_id and created_at > now() - interval '1 hour') >= 60 then
      raise exception 'You are commenting too fast. Please wait a bit.';
    end if;
  else
    new.post_id := old.post_id; new.user_id := old.user_id; new.parent_id := old.parent_id; new.is_anonymous := old.is_anonymous; new.images := old.images;
    new.created_at := old.created_at; new.body := btrim(new.body, E' \t\r\n');
    new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  end if;
  return new;
end $$;

drop view if exists public.post_comments_feed;
create view public.post_comments_feed as
select c.id, c.post_id,
       case when c.is_anonymous and c.user_id <> auth.uid() and not public.is_admin() then null else c.user_id end as user_id,
       c.body, c.is_anonymous, c.created_at, c.edited_at, (c.user_id = auth.uid()) as is_mine,
       c.parent_id, c.mentions,
       (select a.alias from public.anon_aliases a where a.user_id = c.user_id) as anon_alias,
       c.images
from public.post_comments c;
revoke all on public.post_comments_feed from public, anon;
grant select on public.post_comments_feed to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- ===== v52: ALL Philippine universities (typed, never listed in full),
-- =====     follow a school + school list with student counts,
-- =====     admin can remove posts / temp-ban like Astra (safe to re-run)
-- =====================================================================

-- ---- 1. universities: state AND private (the table keeps its old name state_universities) ----
-- The weekly API sync (api/universities.js) and Moderation > Universities add more. Students only ever see matches while typing.
insert into public.state_universities (name) values
  ('University of the Philippines Open University'), ('University of Rizal System'), ('Pamantasan ng Lungsod ng Pasig'),
  ('Pamantasan ng Lungsod ng Valenzuela'), ('Pamantasan ng Lungsod ng Muntinlupa'), ('Universidad de Manila'), ('University of Makati'),
  ('Quezon City University'), ('Philippine Merchant Marine Academy'), ('Philippine Military Academy'), ('Philippine National Police Academy'),
  ('Don Honorio Ventura State University'), ('Bataan Peninsula State University'), ('President Ramon Magsaysay State University'),
  ('Nueva Ecija University of Science and Technology'), ('Southern Luzon State University'), ('Partido State University'),
  ('Sorsogon State University'), ('Catanduanes State University'), ('Don Mariano Marcos Memorial State University'),
  ('University of Northern Philippines'), ('Quirino State University'), ('Nueva Vizcaya State University'), ('Ifugao State University'),
  ('Kalinga State University'), ('Romblon State University'), ('Western Philippines University'), ('Aklan State University'),
  ('Capiz State University'), ('Guimaras State University'), ('Carlos Hilado Memorial State University'), ('Negros Oriental State University'),
  ('Cebu Normal University'), ('Bohol Island State University'), ('Eastern Samar State University'), ('Samar State University'),
  ('Northwest Samar State University'), ('Naval State University'), ('Southern Leyte State University'), ('Western Mindanao State University'),
  ('Mindanao State University – Iligan Institute of Technology'), ('Mindanao State University – General Santos'),
  ('University of Southern Mindanao'), ('Sultan Kudarat State University'), ('Cotabato State University'), ('Davao Oriental State University'),
  ('University of Science and Technology of Southern Philippines'), ('Bukidnon State University'), ('Surigao del Sur State University'),
  ('Mindanao University of Science and Technology'),
  -- private
  ('Ateneo de Manila University'), ('De La Salle University'), ('University of Santo Tomas'), ('Far Eastern University'), ('University of the East'),
  ('Adamson University'), ('Mapúa University'), ('National University'), ('Centro Escolar University'), ('Lyceum of the Philippines University'),
  ('Colegio de San Juan de Letran'), ('San Beda University'), ('Arellano University'), ('Jose Rizal University'), ('Manuel L. Quezon University'),
  ('Philippine Christian University'), ('Trinity University of Asia'), ('Technological Institute of the Philippines'), ('AMA University'),
  ('Asia Pacific College'), ('Philippine Women''s University'), ('Miriam College'), ('FEATI University'), ('Our Lady of Fatima University'),
  ('University of Asia and the Pacific'), ('Emilio Aguinaldo College'), ('De La Salle–College of Saint Benilde'),
  ('University of Perpetual Help System DALTA'), ('Adventist University of the Philippines'), ('Holy Angel University'),
  ('Angeles University Foundation'), ('La Consolacion University Philippines'), ('Wesleyan University–Philippines'), ('Saint Mary''s University'),
  ('Saint Louis University'), ('Saint Paul University Philippines'), ('University of Baguio'), ('University of the Cordilleras'),
  ('Lyceum-Northwestern University'), ('University of Batangas'), ('De La Salle Lipa'), ('De La Salle University–Dasmariñas'),
  ('Manuel S. Enverga University Foundation'), ('Aquinas University of Legazpi'), ('Ateneo de Naga University'), ('University of Nueva Caceres'),
  ('Divine Word University of Tacloban'), ('University of San Agustin'), ('Central Philippine University'),
  ('University of Negros Occidental–Recoletos'), ('Silliman University'), ('Foundation University'), ('University of San Carlos'),
  ('University of San Jose–Recoletos'), ('University of the Visayas'), ('University of Cebu'), ('Cebu Doctors'' University'),
  ('Southwestern University'), ('Cebu Institute of Technology – University'), ('Xavier University – Ateneo de Cagayan'),
  ('Ateneo de Davao University'), ('Ateneo de Zamboanga University'), ('Liceo de Cagayan University'), ('Capitol University'),
  ('Misamis University'), ('University of Mindanao'), ('Notre Dame University')
on conflict do nothing;

-- the school of an Astra member / guide must be on the list; it is stored with the list's exact spelling
create or replace function public.school_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare canon text;
begin
  select name into canon from public.state_universities where active and lower(name) = lower(btrim(new.school)) limit 1;
  if canon is null then raise exception 'Choose a university from the list.'; end if;
  new.school := canon;
  return new;
end $$;

-- a student's school must be on the list too (it was only checked in the browser). Checked only when the school changes,
-- so students whose school was valid before are never locked out.
create or replace function public.profiles_school_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare canon text;
begin
  if coalesce(current_setting('app.bypass_guard', true), '') = '1' or auth.uid() is null then return new; end if;   -- trusted server code / SQL editor
  if btrim(coalesce(new.school, '')) = '' then return new; end if;
  if tg_op = 'UPDATE' and lower(btrim(new.school)) = lower(btrim(old.school)) then return new; end if;
  if tg_op = 'INSERT' and exists (select 1 from public.profiles p where p.user_id = new.user_id and lower(btrim(p.school)) = lower(btrim(new.school))) then return new; end if;   -- upsert of an unchanged profile
  select name into canon from public.state_universities where active and lower(name) = lower(btrim(new.school)) limit 1;
  if canon is null then raise exception 'Choose your university from the list.'; end if;
  new.school := canon;
  return new;
end $$;
drop trigger if exists profiles_school_guard_trg on public.profiles;
create trigger profiles_school_guard_trg before insert or update of school on public.profiles for each row execute function public.profiles_school_guard();

-- same rule as v25, only the wording no longer says "state"
create or replace function public.profiles_setup_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.bio := left(btrim(coalesce(new.bio, '')), 200);
  new.program := left(btrim(coalesce(new.program, '')), 100);
  new.institute := left(btrim(coalesce(new.institute, '')), 100);
  if coalesce(current_setting('app.bypass_guard', true), '') = '1' or auth.uid() is null then return new; end if;
  if not new.onboarded then return new; end if;
  if tg_op = 'UPDATE' then
    if coalesce(old.onboarded, false) then return new; end if;
  end if;
  if btrim(coalesce(new.display_name, '')) = '' then raise exception 'Add your name to finish setting up your account.'; end if;
  if btrim(coalesce(new.school, '')) = '' then raise exception 'Choose your university to finish setting up your account.'; end if;
  if char_length(new.program) < 2 then raise exception 'Add your program (for example BS Information Technology) to finish setting up your account.'; end if;
  return new;
end $$;

-- ---- 2. the admin can do what Astra can on ANY school's posts ----
-- Astra: only their own school, and the admin then reviews it. Admin: any student's post (even an anonymous one), decided right away,
-- and it can still be restored or deleted for good from Moderation > Removed posts.
create or replace function public.astra_remove_post(_post uuid, _reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare t uuid; b text; adm boolean := public.is_admin();
begin
  select user_id, body into t, b from public.posts where id = _post and removed_at is null;
  if t is null then raise exception 'Post not found or already removed.'; end if;
  if t = auth.uid() then raise exception 'You cannot remove your own post this way.'; end if;
  if not adm then
    if not public.is_astra_for(t) then raise exception 'You can only act on students of your own school.'; end if;
    if exists (select 1 from public.admins a where a.user_id = t) then raise exception 'You cannot remove an admin''s post.'; end if;
  end if;
  if char_length(btrim(coalesce(_reason, ''))) < 20 then raise exception 'Explain the reason (at least 20 characters).'; end if;
  perform set_config('app.bypass_guard', '1', true);
  update public.posts set removed_at = now(), removed_reason = left(btrim(_reason), 500) where id = _post;
  insert into public.post_removals (post_id, author_id, remover_id, school, reason, body, status, admin_note, decided_at)
  values (_post, t, auth.uid(), coalesce(public.school_of(t), ''), left(btrim(_reason), 500), left(coalesce(b, ''), 2000),
          case when adm then 'confirmed' else 'pending' end, case when adm then 'Removed by admin' else '' end, case when adm then now() end);
  return true;
end $$;
revoke all on function public.astra_remove_post(uuid, text) from public, anon;
grant execute on function public.astra_remove_post(uuid, text) to authenticated;

create or replace function public.astra_temp_ban(_post uuid, _days int, _reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare t uuid; b text; u timestamptz; adm boolean := public.is_admin(); rid uuid;
begin
  select user_id, body into t, b from public.posts where id = _post;
  if t is null then raise exception 'Post not found.'; end if;
  if t = auth.uid() then raise exception 'You cannot ban yourself.'; end if;
  if not adm and not public.is_astra_for(t) then raise exception 'You can only act on students of your own school.'; end if;
  if exists (select 1 from public.admins a where a.user_id = t) then raise exception 'You cannot ban an admin.'; end if;
  if _days not in (1, 3, 7) then raise exception 'Pick 1, 3 or 7 days.'; end if;
  if char_length(btrim(coalesce(_reason, ''))) < 20 then raise exception 'Explain the reason (at least 20 characters).'; end if;
  u := now() + make_interval(days => _days);
  insert into public.ban_reports (reporter_id, target_id, school, category, details, evidence, post_id, temp_until)
  values (auth.uid(), t, coalesce(public.school_of(t), ''), 'other', left(btrim(_reason), 1500),
          jsonb_build_array(jsonb_build_object('kind', 'post', 'text', left(coalesce(b, ''), 500), 'ref', 'post ' || _post::text)), _post, u)
  returning id into rid;
  if adm then   -- the admin's own decision: nothing left to review
    update public.ban_reports set status = 'confirmed', admin_note = 'Set by admin', decided_at = now() where id = rid;
  end if;
  perform set_config('app.bypass_guard', '1', true);
  update public.posts set removed_at = coalesce(removed_at, now()), removed_reason = coalesce(removed_reason, left('Temporary ban: ' || btrim(_reason), 500)) where id = _post;
  update public.profiles set temp_ban_until = u where user_id = t;
  return true;
end $$;
revoke all on function public.astra_temp_ban(uuid, int, text) from public, anon;
grant execute on function public.astra_temp_ban(uuid, int, text) to authenticated;

-- admin: a removal can be restored or deleted for good even after it was kept (before, only pending ones could be decided)
create or replace function public.decide_post_removal(_id uuid, _action text, _note text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if _action not in ('keep', 'restore', 'delete') then raise exception 'Bad action.'; end if;
  update public.post_removals set status = case _action when 'keep' then 'confirmed' when 'restore' then 'restored' else 'deleted' end,
         admin_note = case when btrim(coalesce(_note, '')) = '' then admin_note else left(_note, 300) end, decided_at = now()
   where id = _id and (status = 'pending' or (status = 'confirmed' and _action in ('restore', 'delete'))) returning post_id into pid;
  if pid is null then return false; end if;
  perform set_config('app.bypass_guard', '1', true);
  if _action = 'restore' then update public.posts set removed_at = null, removed_reason = null where id = pid;
  elsif _action = 'delete' then delete from public.posts where id = pid; end if;
  return true;
end $$;
revoke all on function public.decide_post_removal(uuid, text, text) from public, anon;
grant execute on function public.decide_post_removal(uuid, text, text) to authenticated;

-- ---- 3. follow a whole school + the school list with student counts ----
create table if not exists public.school_follows (
  follower uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 3 and 80),
  created_at timestamptz not null default now(),
  primary key (follower, school)
);
create index if not exists school_follows_school_idx on public.school_follows (lower(school));
alter table public.school_follows enable row level security;
drop policy if exists "school follows read"   on public.school_follows;
drop policy if exists "school follows add"    on public.school_follows;
drop policy if exists "school follows remove" on public.school_follows;
create policy "school follows read"   on public.school_follows for select to authenticated using (follower = auth.uid());
create policy "school follows add"    on public.school_follows for insert to authenticated with check (follower = auth.uid() and not public.is_banned());
create policy "school follows remove" on public.school_follows for delete to authenticated using (follower = auth.uid());
drop policy if exists "setup first" on public.school_follows;
create policy "setup first" on public.school_follows as restrictive for insert to authenticated with check (public.is_onboarded() or public.is_admin());

create or replace function public.school_follow_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare canon text;
begin
  select name into canon from public.state_universities where active and lower(name) = lower(btrim(new.school)) limit 1;
  if canon is null then raise exception 'Choose a university from the list.'; end if;
  new.school := canon; new.created_at := now();
  if (select count(*) from public.school_follows where follower = new.follower) >= 50 then raise exception 'You follow too many schools. Unfollow one first.'; end if;
  return new;
end $$;
drop trigger if exists school_follow_guard_trg on public.school_follows;
create trigger school_follow_guard_trg before insert on public.school_follows for each row execute function public.school_follow_guard();

-- What "Other universities" shows. No search: only schools that have students (most first). With a search (2+ letters): every university
-- that matches, even with 0 students. _following: only the schools you follow. At most _limit rows (max 100), never the whole list.
create or replace function public.school_directory(_q text default '', _following boolean default false, _limit int default 40)
returns table (school text, users int, followers int, i_follow boolean)
language plpgsql stable security definer set search_path = public as $$
declare q text := btrim(coalesce(_q, '')); pat text;
begin
  if auth.uid() is null then return; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select u.name,
         coalesce(c.n, 0)::int,
         coalesce(f.n, 0)::int,
         exists (select 1 from public.school_follows m where m.follower = auth.uid() and lower(m.school) = lower(u.name))
    from public.state_universities u
    left join (select lower(btrim(p.school)) as k, count(*) as n from public.profiles p
                where p.onboarded and not p.banned and btrim(p.school) <> '' group by 1) c on c.k = lower(btrim(u.name))
    left join (select lower(sf.school) as k, count(*) as n from public.school_follows sf group by 1) f on f.k = lower(u.name)
   where u.active
     and (q = '' or u.name ilike pat)
     and (case when _following
               then exists (select 1 from public.school_follows m2 where m2.follower = auth.uid() and lower(m2.school) = lower(u.name))
               else (q <> '' or coalesce(c.n, 0) > 0) end)
   order by 2 desc, 1
   limit least(greatest(coalesce(_limit, 40), 1), 100);
end $$;
revoke all on function public.school_directory(text, boolean, int) from public, anon;
grant execute on function public.school_directory(text, boolean, int) to authenticated;

-- a reviewer is published: author's followers, students whose main subject matches (as before) AND, new, followers of the author's school.
-- The school message never names the author (they may have chosen to hide their name).
create or replace function public.trg_reviewer_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare fol uuid[]; fans uuid[]; sfol uuid[]; sch text;
begin
  if not new.is_public then return new; end if;
  select coalesce(array_agg(follower), '{}') into fol from public.follows where followee = new.owner_id;
  select coalesce(array_agg(user_id), '{}') into fans from (
    select user_id, subject, count(*) c, row_number() over (partition by user_id order by count(*) desc, max(at) desc) rn
    from public.study_log where at > now() - interval '60 days' group by user_id, subject) t
    where rn = 1 and c >= 3 and lower(subject) = lower(new.subject);
  perform public.notify_many(fol, 'publish', public.display_of(new.owner_id) || ' published “' || new.title || '”', new.id, new.owner_id);
  perform public.notify_many(array(select unnest(fans) except select unnest(fol)), 'field', 'New in ' || new.subject || ': “' || new.title || '”', new.id, new.owner_id);
  if new.owner_id is not null then
    select btrim(p.school) into sch from public.profiles p where p.user_id = new.owner_id;
    if coalesce(sch, '') <> '' then
      select coalesce(array_agg(f.follower), '{}') into sfol from public.school_follows f where lower(f.school) = lower(sch);
      perform public.notify_many(array(select unnest(sfol) except select unnest(fol) except select unnest(fans) except select new.owner_id),
        'publish', 'New reviewer from ' || left(sch, 60) || ': “' || left(new.title, 70) || '”', new.id, null);
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';

-- ===== v60: student IDs generate again =====
-- Cause: profiles_guard() is defined three times in this file. The first two gave every new profile an ID (S26-000123); the LAST one (the ban-field guard)
-- no longer did, so accounts created since then got no ID. The ID now has its OWN trigger, so a later change to a guard can never switch it off again.
create sequence if not exists public.student_no_seq;
create or replace function public.next_student_no() returns text
language sql volatile set search_path = public
as $$ select 'S' || to_char(now(), 'YY') || '-' || lpad(nextval('public.student_no_seq')::text, 6, '0') $$;
alter table public.profiles add column if not exists student_no text;

create or replace function public.profiles_student_no() returns trigger
language plpgsql security definer set search_path = public as $$
declare keep text;
begin
  if tg_op = 'UPDATE' then
    if nullif(btrim(coalesce(old.student_no, '')), '') is not null then new.student_no := old.student_no; return new; end if;   -- the ID never changes
  else
    select p.student_no into keep from public.profiles p where p.user_id = new.user_id;                                         -- an upsert of an existing profile keeps its ID
    if nullif(btrim(coalesce(keep, '')), '') is not null then new.student_no := keep; return new; end if;
  end if;
  new.student_no := public.next_student_no();                                                                                   -- a typed-in value is never trusted
  return new;
end $$;
drop trigger if exists profiles_student_no_trg on public.profiles;
create trigger profiles_student_no_trg before insert or update on public.profiles for each row execute function public.profiles_student_no();

-- the counter must be ahead of every ID already handed out (so a new ID can never collide with an old one)
do $$
declare m bigint;
begin
  select max((regexp_replace(student_no, '^S\d\d-', ''))::bigint) into m from public.profiles where student_no ~ '^S\d\d-\d+$';
  if m is not null and m >= (select last_value from public.student_no_seq) then perform setval('public.student_no_seq', m, true); end if;
end $$;

-- give an ID to everyone who has none (the trigger above assigns it)
update public.profiles set display_name = display_name where student_no is null or btrim(student_no) = '';
create unique index if not exists profiles_student_no_idx on public.profiles (student_no);

notify pgrst, 'reload schema';

-- ===== v64: Quiz Challenge (timed quiz in every reviewer, points for improving) =====
-- One row per finished run. Students can READ their own rows; nobody can insert directly: rows are written only by submit_quiz_attempt(),
-- which recomputes the score on the server from (correct, total, seconds) and decides how many profile points the run earns.
create table if not exists public.quiz_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reviewer_id text not null references public.reviewers(id) on delete cascade,
  correct integer not null, total integer not null, seconds integer not null,
  score integer not null, points integer not null default 0,
  "at" timestamptz not null default now(),
  constraint quiz_attempts_chk check (total between 4 and 30 and correct between 0 and total and seconds between 1 and 7200 and score between 0 and 100 and points between 0 and 20)
);
create index if not exists quiz_attempts_rv_idx on public.quiz_attempts (reviewer_id, "at" desc);
create index if not exists quiz_attempts_user_idx on public.quiz_attempts (user_id, reviewer_id);
alter table public.quiz_attempts enable row level security;
drop policy if exists "own attempts read" on public.quiz_attempts;
create policy "own attempts read" on public.quiz_attempts for select to authenticated using (user_id = auth.uid());

-- Score = accuracy x (80 + 20 x speed); speed is 1 at an average of 3 s per question or faster and 0 at 20 s (the time limit).
-- Points = 1 per 5 score points ABOVE the student's previous best on this reviewer, max 20 per reviewer and 60 per 24 h.
-- (Same formulas as src/challengeLogic.js. Study time is self-reported too, so this has the same trust level; the caps keep it small.)
create or replace function public.submit_quiz_attempt(_reviewer text, _correct integer, _total integer, _seconds integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t int; c int; secs int; speed numeric; sc int; best int; got int; used int; pts int;
begin
  if auth.uid() is null or not public.is_onboarded() then raise exception 'Finish setting up your account first.'; end if;
  if not exists (select 1 from public.reviewers where id = _reviewer and removed_at is null and (is_public or owner_id = auth.uid() or public.is_admin())) then
    raise exception 'Reviewer not found.';
  end if;
  if _total is null or _total < 4 or _total > 30 or _correct is null or _correct < 0 or _correct > _total then raise exception 'That result is not valid.'; end if;
  if exists (select 1 from public.quiz_attempts where user_id = auth.uid() and "at" > now() - interval '10 seconds') then raise exception 'Please wait a moment before submitting again.'; end if;
  t := _total; c := _correct;
  secs := least(greatest(coalesce(_seconds, 0), ceil(t * 1.5)::int), t * 20);          -- nobody answers faster than 1.5 s each
  speed := least(greatest((20 - secs::numeric / t) / 17, 0), 1);
  sc := round((c::numeric / t) * (80 + 20 * speed));
  select coalesce(max(score), 0), coalesce(sum(points), 0) into best, got from public.quiz_attempts where user_id = auth.uid() and reviewer_id = _reviewer;
  select coalesce(sum(points), 0) into used from public.quiz_attempts where user_id = auth.uid() and "at" > now() - interval '24 hours';
  pts := greatest(0, least(floor((sc - best) / 5.0)::int, 20 - got, 60 - used));
  insert into public.quiz_attempts (user_id, reviewer_id, correct, total, seconds, score, points) values (auth.uid(), _reviewer, c, t, secs, sc, pts);
  return jsonb_build_object('score', sc, 'points', pts, 'best_before', best, 'best', greatest(best, sc), 'seconds', secs);
end $$;
revoke all on function public.submit_quiz_attempt(text, integer, integer, integer) from public, anon;
grant execute on function public.submit_quiz_attempt(text, integer, integer, integer) to authenticated;

-- Leaderboard of ONE reviewer. _period: 'today' | 'month' | 'all' (day and month start in the student's time zone). Each student appears once with their
-- best run in that period (ties: faster wins). Students who turned off "show my contributions" and banned students are hidden, except from themselves.
-- Returns the top _limit plus the caller's own row (with the real rank) when they are further down.
create or replace function public.quiz_leaderboard(_reviewer text, _period text default 'all', _limit integer default 20, _tz text default 'Asia/Manila')
returns table(rank bigint, user_id uuid, display_name text, avatar_url text, school text, score integer, seconds integer, attempts integer, is_me boolean)
language sql stable security definer set search_path = public as $$
  with z as (select case when exists (select 1 from pg_timezone_names where name = _tz) then _tz else 'UTC' end as tz),
  since as (select case _period
      when 'today' then (date_trunc('day', now() at time zone z.tz)) at time zone z.tz
      when 'month' then (date_trunc('month', now() at time zone z.tz)) at time zone z.tz
      else '-infinity'::timestamptz end as t from z),
  mine as (select a.* from public.quiz_attempts a, since s where a.reviewer_id = _reviewer and a."at" >= s.t
            and exists (select 1 from public.reviewers r where r.id = _reviewer and r.removed_at is null and (r.is_public or r.owner_id = auth.uid() or public.is_admin()))),
  best as (select distinct on (m.user_id) m.user_id, m.score, m.seconds from mine m order by m.user_id, m.score desc, m.seconds asc),
  cnt as (select m.user_id, count(*)::int n from mine m group by m.user_id),
  ranked as (
    select row_number() over (order by b.score desc, b.seconds asc, p.display_name) as rk, b.user_id, p.display_name, p.avatar_url, p.school, b.score, b.seconds, c.n
      from best b join cnt c using (user_id) join public.profiles p on p.user_id = b.user_id
     where auth.uid() is not null and (b.user_id = auth.uid() or (coalesce(p.show_contributions, true) and not coalesce(p.banned, false)
           and not exists (select 1 from public.admins a where a.user_id = p.user_id))))
  select rk, user_id, display_name, avatar_url, school, score, seconds, n, user_id = auth.uid()
    from ranked where rk <= least(greatest(coalesce(_limit, 20), 1), 50) or user_id = auth.uid() order by rk
$$;
revoke all on function public.quiz_leaderboard(text, text, integer, text) from public, anon;
grant execute on function public.quiz_leaderboard(text, text, integer, text) to authenticated;

-- Challenge points join the profile total (and so the Ranking tab). They are NOT counted by the Astra requirements (astra_stats), on purpose.
create or replace function public.compute_contributions(_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select count(*)::int n from public.reviewers where owner_id = _uid),
       s as (select coalesce(sum(seconds), 0)::bigint secs from public.study_log where user_id = _uid),
       f as (select count(*)::int n from public.reviewer_flags
              where user_id = _uid and (astra_verdict = 'valid' or (resolved and coalesce(astra_verdict, '') <> 'dismissed'))),
       q as (select coalesce(sum(points), 0)::int pts, count(*)::int n from public.quiz_attempts where user_id = _uid)
  select jsonb_build_object(
    'reviewers', r.n, 'seconds', s.secs, 'flags', f.n,
    'reviewer_points', r.n * 50,
    'study_points', floor(s.secs / 360.0)::int,
    'flag_points', f.n * 25,
    'quiz_points', q.pts, 'quiz_attempts', q.n,
    'points', r.n * 50 + floor(s.secs / 360.0)::int + f.n * 25 + q.pts
  ) from r, s, f, q
$$;
revoke all on function public.compute_contributions(uuid) from public, anon, authenticated;

-- v68: "Add to my collection": a student's own saved reviewers (private to them; nobody else can see what they saved)
create table if not exists public.reviewer_collection (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reviewer_id text not null references public.reviewers(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, reviewer_id)
);
alter table public.reviewer_collection enable row level security;
drop policy if exists "own collection read" on public.reviewer_collection;
drop policy if exists "own collection add" on public.reviewer_collection;
drop policy if exists "own collection remove" on public.reviewer_collection;
create policy "own collection read" on public.reviewer_collection for select to authenticated using (user_id = auth.uid());
create policy "own collection add" on public.reviewer_collection for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.reviewers r where r.id = reviewer_id and r.removed_at is null and (r.is_public or r.owner_id = auth.uid() or public.is_admin())));
create policy "own collection remove" on public.reviewer_collection for delete to authenticated using (user_id = auth.uid());
revoke all on public.reviewer_collection from public, anon;
grant select, insert, delete on public.reviewer_collection to authenticated;

notify pgrst, 'reload schema';


-- ===== v81: reviewer cover picture + delete my account (Facebook data-deletion requirement) =====
alter table public.reviewers add column if not exists thumb text;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth, storage as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  begin delete from public.reviewers where owner_id = uid; exception when others then null; end;
  begin delete from storage.objects where owner = uid; exception when others then null; end;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ===== v82: cover photo on profiles =====
alter table public.profiles add column if not exists cover_url text;


-- ===== v83: reviewer card preview (summary, first topics, counts) filled by the database itself =====
alter table public.reviewers add column if not exists preview jsonb;
create or replace function public.reviewers_preview_fill() returns trigger language plpgsql as $$
declare c jsonb;
begin
  begin
    c := new.content::jsonb;
    if c is not null and jsonb_typeof(c) = 'object' then
      new.preview := jsonb_build_object(
        's', left(coalesce(c->>'summary', ''), 150),
        'min', greatest(1, ceil(length(coalesce(new.text, '')) / 6.0 / 200.0)::int),
        't', coalesce((select jsonb_agg(left(x->>'heading', 36)) from (select x from jsonb_array_elements(case when jsonb_typeof(c->'sections') = 'array' then c->'sections' else '[]'::jsonb end) x limit 3) q), '[]'::jsonb),
        'n', jsonb_build_object(
          'terms', case when jsonb_typeof(c->'terms') = 'array' then jsonb_array_length(c->'terms') else 0 end,
          'cards', case when jsonb_typeof(c->'cards') = 'array' then jsonb_array_length(c->'cards') else 0 end,
          'quiz',  case when jsonb_typeof(c->'quiz')  = 'array' then jsonb_array_length(c->'quiz')  else 0 end));
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists reviewers_preview_trg on public.reviewers;
create trigger reviewers_preview_trg before insert or update of content on public.reviewers for each row execute function public.reviewers_preview_fill();
update public.reviewers set content = content where content is not null and preview is null;

-- v84: re-fill previews so they include the estimated reading time
update public.reviewers set content = content where content is not null;
