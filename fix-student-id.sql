-- Run this ONCE in Supabase > SQL Editor if you do not want to re-run the whole supabase-setup.sql.
-- It is safe to run more than once.

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
