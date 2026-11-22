-- =====================================================================
-- Refute: database schema for Supabase (free tier)
-- One installation belongs to one teacher. Students don't have accounts:
-- they enter a student ID and email on the task link.
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run,
-- or apply it with the Supabase CLI: supabase db push
-- It is safe to run again.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- One row: who owns this installation, and the name students see.
create table if not exists public.app_settings (
  id           boolean primary key default true check (id),
  owner_id     uuid references auth.users(id) on delete set null,
  teacher_name text not null default '' check (length(teacher_name) <= 120),
  institution  text not null default '' check (length(institution) <= 200),
  created_at   timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- One row: the teacher's AI provider, model and key. No browser can read
-- this table; only the refute-ai Edge Function does, with the service role.
create table if not exists public.ai_settings (
  id         boolean primary key default true check (id),
  provider   text not null check (provider in ('gemini', 'groq')),
  model      text not null check (length(model) between 1 and 200),
  api_key    text not null check (length(api_key) between 10 and 500),
  updated_at timestamptz not null default now()
);
-- When true, students must use their own AI key (the teacher's key is used only for previews).
alter table public.ai_settings add column if not exists require_student_keys boolean not null default false;

create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(title) between 1 and 200),
  code        text,
  description text,
  -- Optional class list. Empty = anyone with a task link can join.
  roster      text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses(id) on delete cascade,
  title           text not null check (length(title) between 1 and 200),
  brief           text not null default '',
  persona         text not null default '',
  opening         text not null default '',
  claim           text not null default '',
  defenses        text not null default '',
  explanation     text not null default '',
  criteria        jsonb not null default '[]'::jsonb,
  stubbornness    text not null default 'firm' check (stubbornness in ('gentle', 'firm', 'tough')),
  language        text not null default 'en' check (language in ('en', 'bn', 'match')),
  max_turns       int  not null default 15 check (max_turns between 3 and 60),
  is_open         boolean not null default true,
  reveal_criteria boolean not null default true,
  allow_retry     boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.attempts (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks(id) on delete cascade,
  student_code  text not null check (length(student_code) between 1 and 64),
  student_email text not null default '' check (length(student_email) <= 200),
  -- Secret that lets the student's browser continue this attempt.
  token         text not null default encode(gen_random_bytes(18), 'hex'),
  is_preview    boolean not null default false,
  status        text not null default 'in_progress'
                check (status in ('in_progress', 'conceded', 'gave_up', 'max_turns')),
  messages      jsonb not null default '[]'::jsonb,
  criteria_met  jsonb not null default '[]'::jsonb,
  judge_log     jsonb not null default '[]'::jsonb,
  score         int check (score between 0 and 100),
  turns         int not null default 0,
  model         text,
  debrief       text,
  task_snapshot jsonb not null default '{}'::jsonb,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists tasks_course_idx    on public.tasks(course_id);
create index if not exists attempts_task_idx   on public.attempts(task_id);
create index if not exists attempts_student_idx on public.attempts(task_id, student_code);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------

-- Class lists are stored trimmed, upper-case and without duplicates.
create or replace function public.normalize_roster()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.roster := coalesce(array(
    select distinct upper(trim(x)) from unnest(new.roster) as x where trim(x) <> '' order by 1
  ), '{}');
  return new;
end;
$$;

drop trigger if exists normalize_roster on public.courses;
create trigger normalize_roster
  before insert or update of roster on public.courses
  for each row execute function public.normalize_roster();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_tasks on public.tasks;
create trigger touch_tasks before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Helper and public functions (security definer)
-- ---------------------------------------------------------------------

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_settings where owner_id = auth.uid() and auth.uid() is not null);
$$;

-- Name and status of this installation, for every visitor.
create or replace function public.get_site()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'teacher_name', s.teacher_name,
    'institution', s.institution,
    'has_owner', s.owner_id is not null,
    'is_owner', s.owner_id is not null and s.owner_id = auth.uid(),
    'ai_ready', exists (select 1 from public.ai_settings),
    'ai_provider', (select a.provider from public.ai_settings a limit 1),
    'ai_model', (select a.model from public.ai_settings a limit 1),
    'student_keys_required', coalesce((select a.require_student_keys from public.ai_settings a limit 1), false)
  )
  from public.app_settings s;
$$;

-- The first signed-in account becomes the teacher. Later accounts get nothing.
create or replace function public.claim_site(p_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  claimed int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  update public.app_settings
     set owner_id = auth.uid(), teacher_name = left(trim(coalesce(p_name, '')), 120)
   where owner_id is null;
  get diagnostics claimed = row_count;
  return claimed = 1 or public.is_owner();
end;
$$;

create or replace function public.update_site(p_name text, p_institution text)
returns json language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then
    raise exception 'Only the teacher can change these settings.';
  end if;
  update public.app_settings
     set teacher_name = left(trim(coalesce(p_name, '')), 120),
         institution = left(trim(coalesce(p_institution, '')), 200)
   where id = true;
  return public.get_site();
end;
$$;

-- What a student sees before starting: no claim, no points, no answer.
create or replace function public.get_task_public(p_task uuid)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'id', t.id,
    'title', t.title,
    'brief', t.brief,
    'persona', t.persona,
    'max_turns', t.max_turns,
    'is_open', t.is_open,
    'course_title', c.title,
    'course_code', c.code,
    'has_roster', cardinality(c.roster) > 0,
    'teacher_name', s.teacher_name
  )
  from public.tasks t
  join public.courses c on c.id = t.course_id
  cross join public.app_settings s
  where t.id = p_task;
$$;

-- A student enters their ID and email. Returns the attempt to open: their
-- unfinished one if there is one, otherwise a new one. Or an error code:
-- not_found | closed | not_on_list | done (with their last result).
create or replace function public.start_attempt(p_task uuid, p_code text, p_email text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  c public.courses;
  a public.attempts;
  code text := upper(trim(coalesce(p_code, '')));
  email text := lower(trim(coalesce(p_email, '')));
begin
  if code = '' or length(code) > 64 then
    return json_build_object('error', 'bad_code');
  end if;
  if email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(email) > 200 then
    return json_build_object('error', 'bad_email');
  end if;
  select * into t from public.tasks where id = p_task;
  if not found then
    return json_build_object('error', 'not_found');
  end if;
  select * into c from public.courses where id = t.course_id;

  -- An unfinished attempt with this ID reopens, even if the class list changed.
  select * into a from public.attempts
   where task_id = t.id and student_code = code and status = 'in_progress' and not is_preview
   order by started_at desc limit 1;
  if found then
    if not t.is_open then
      return json_build_object('error', 'closed');
    end if;
    return json_build_object('attempt_id', a.id, 'token', a.token, 'resumed', true);
  end if;

  if not t.is_open then
    return json_build_object('error', 'closed');
  end if;
  if cardinality(c.roster) > 0 and not (code = any (c.roster)) then
    return json_build_object('error', 'not_on_list');
  end if;
  if not t.allow_retry then
    select * into a from public.attempts
     where task_id = t.id and student_code = code and status <> 'in_progress' and not is_preview
     order by finished_at desc nulls last limit 1;
    if found then
      return json_build_object('error', 'done', 'attempt_id', a.id, 'token', a.token);
    end if;
  end if;

  insert into public.attempts (task_id, student_code, student_email, messages, task_snapshot)
  values (
    t.id, code, email,
    jsonb_build_array(jsonb_build_object(
      'role', 'assistant',
      'content', coalesce(nullif(trim(t.opening), ''), t.claim),
      'at', now())),
    jsonb_build_object(
      'title', t.title, 'course_title', c.title, 'persona', t.persona,
      'criteria', t.criteria, 'reveal_criteria', t.reveal_criteria,
      'max_turns', t.max_turns, 'language', t.language, 'allow_retry', t.allow_retry)
  )
  returning * into a;
  return json_build_object('attempt_id', a.id, 'token', a.token, 'resumed', false);
end;
$$;

-- The teacher tries a task. Old previews of that task are removed first.
create or replace function public.start_preview(p_task uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  c public.courses;
  a public.attempts;
begin
  if not public.is_owner() then
    raise exception 'Only the teacher can preview tasks.';
  end if;
  select * into t from public.tasks where id = p_task;
  if not found then
    return json_build_object('error', 'not_found');
  end if;
  select * into c from public.courses where id = t.course_id;
  delete from public.attempts where task_id = t.id and is_preview;
  insert into public.attempts (task_id, student_code, student_email, is_preview, messages, task_snapshot)
  values (
    t.id, 'PREVIEW', '', true,
    jsonb_build_array(jsonb_build_object(
      'role', 'assistant', 'content', coalesce(nullif(trim(t.opening), ''), t.claim), 'at', now())),
    jsonb_build_object(
      'title', t.title, 'course_title', c.title, 'persona', t.persona,
      'criteria', t.criteria, 'reveal_criteria', true,
      'max_turns', t.max_turns, 'language', t.language, 'allow_retry', true)
  )
  returning * into a;
  return json_build_object('attempt_id', a.id, 'token', a.token, 'resumed', false);
end;
$$;

-- What the student's browser may see of an attempt, given its secret token.
-- The points to make are shown only after the debate ends, and only if the
-- teacher allows it.
create or replace function public.get_attempt_public(p_id uuid, p_token text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'id', a.id,
    'task_id', a.task_id,
    'status', a.status,
    'student_code', a.student_code,
    'is_preview', a.is_preview,
    'messages', a.messages,
    'turns', a.turns,
    'max_turns', coalesce((a.task_snapshot->>'max_turns')::int, t.max_turns),
    'met_count', jsonb_array_length(a.criteria_met),
    'criteria_count', jsonb_array_length(coalesce(a.task_snapshot->'criteria', '[]'::jsonb)),
    'score', case when a.status <> 'in_progress' then a.score end,
    'debrief', case when a.status <> 'in_progress' then a.debrief end,
    'criteria', case
      when a.status <> 'in_progress' and coalesce((a.task_snapshot->>'reveal_criteria')::boolean, true)
      then a.task_snapshot->'criteria' end,
    'criteria_met', case
      when a.status <> 'in_progress' and coalesce((a.task_snapshot->>'reveal_criteria')::boolean, true)
      then a.criteria_met end,
    'allow_retry', coalesce((a.task_snapshot->>'allow_retry')::boolean, t.allow_retry) and t.is_open,
    'model', a.model,
    'started_at', a.started_at,
    'finished_at', a.finished_at,
    'task', json_build_object(
      'id', t.id, 'title', t.title, 'brief', t.brief, 'persona', t.persona,
      'course_title', c.title, 'teacher_name', s.teacher_name)
  )
  from public.attempts a
  join public.tasks t on t.id = a.task_id
  join public.courses c on c.id = t.course_id
  cross join public.app_settings s
  where a.id = p_id and a.token = p_token;
$$;

-- ---------------------------------------------------------------------
-- Row-level security: only the teacher touches tables directly
-- ---------------------------------------------------------------------

alter table public.app_settings enable row level security;
alter table public.ai_settings  enable row level security;
alter table public.courses      enable row level security;
alter table public.tasks        enable row level security;
alter table public.attempts     enable row level security;

drop policy if exists "courses: teacher" on public.courses;
create policy "courses: teacher" on public.courses
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "tasks: teacher" on public.tasks;
create policy "tasks: teacher" on public.tasks
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "attempts: teacher" on public.attempts;
create policy "attempts: teacher" on public.attempts
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- app_settings and ai_settings have no policies: only security definer
-- functions and the service role can use them.

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------

revoke all on table public.app_settings, public.ai_settings, public.courses, public.tasks, public.attempts from anon, authenticated;
grant select, insert, update, delete on table public.courses, public.tasks, public.attempts to authenticated;
grant all on table public.app_settings, public.ai_settings, public.courses, public.tasks, public.attempts to service_role;

revoke execute on function public.is_owner()                          from public, anon;
revoke execute on function public.claim_site(text)                    from public, anon;
revoke execute on function public.update_site(text, text)             from public, anon;
revoke execute on function public.start_preview(uuid)                 from public, anon;
revoke execute on function public.get_site()                          from public;
revoke execute on function public.get_task_public(uuid)               from public;
revoke execute on function public.start_attempt(uuid, text, text)     from public;
revoke execute on function public.get_attempt_public(uuid, text)      from public;
revoke execute on function public.normalize_roster()                  from public, anon, authenticated;
revoke execute on function public.touch_updated_at()                  from public, anon, authenticated;

grant execute on function public.is_owner()                       to authenticated;
grant execute on function public.claim_site(text)                 to authenticated;
grant execute on function public.update_site(text, text)          to authenticated;
grant execute on function public.start_preview(uuid)              to authenticated;
grant execute on function public.get_site()                       to anon, authenticated;
grant execute on function public.get_task_public(uuid)            to anon, authenticated;
grant execute on function public.start_attempt(uuid, text, text)  to anon, authenticated;
grant execute on function public.get_attempt_public(uuid, text)   to anon, authenticated, service_role;
