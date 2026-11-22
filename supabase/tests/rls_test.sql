-- Security tests for the Refute schema.
-- Run against a throwaway Postgres after supabase_shim.sql and the migration:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supabase_shim.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261122000000_initial_schema.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- Any failed check raises an error and stops the script.

\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema if not exists test;

create or replace function test.login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p)::text, false);
end $$;

create or replace function test.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise warning 'ok: %', label;
end $$;

create or replace function test.rejects(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise warning 'ok: % (%)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (statement was allowed)', label;
end $$;

grant usage on schema test to anon, authenticated;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'teacher@example.edu'),
  ('00000000-0000-0000-0000-00000000000b', 'stranger@example.edu');

-- ── Claiming the installation ───────────────────────────────────────
set role anon;
select test.login(null);
select test.ok((public.get_site()->>'has_owner')::boolean = false, 'a new installation has no teacher');
select test.rejects($$select public.claim_site('x')$$, 'signed-out visitors cannot claim the installation');

set role authenticated;
select test.login('00000000-0000-0000-0000-00000000000a');
select test.ok(public.claim_site('Musabbir Hasan'), 'the first account becomes the teacher');
select test.ok((public.get_site()->>'is_owner')::boolean, 'the teacher is recognised');
select test.ok(public.get_site()->>'teacher_name' = 'Musabbir Hasan', 'the teacher name is saved');

select test.login('00000000-0000-0000-0000-00000000000b');
select test.ok(public.claim_site('Intruder') = false, 'a second account cannot take over');
select test.ok(public.get_site()->>'teacher_name' = 'Musabbir Hasan', 'the name is unchanged');
select test.ok((select count(*) from public.courses) = 0, 'other accounts see no courses');
select test.rejects($$insert into public.courses (title) values ('x')$$, 'other accounts cannot create courses');
select test.rejects($$select public.update_site('x', 'y')$$, 'other accounts cannot rename the installation');
select test.rejects($$select public.start_preview(gen_random_uuid())$$, 'other accounts cannot preview');

-- ── The teacher sets up a course and tasks ──────────────────────────
select test.login('00000000-0000-0000-0000-00000000000a');
insert into public.courses (id, title, roster) values
  ('10000000-0000-0000-0000-000000000001', 'Statistics 101', array['221-35-1', ' 221-35-2 ', '221-35-1', '', 'ab-3']),
  ('10000000-0000-0000-0000-000000000002', 'Open course', '{}');
select test.ok((select roster from public.courses where id = '10000000-0000-0000-0000-000000000001') = array['221-35-1', '221-35-2', 'AB-3'],
  'class lists are trimmed, upper-cased and de-duplicated');
insert into public.tasks (id, course_id, title, claim, opening, criteria, allow_retry, reveal_criteria) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Sampling', 'Big n fixes bias', '', '[{"text":"secret point","required":true,"weight":50}]', false, true),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Open task', 'Claim two', 'Hello!', '[{"text":"p","required":true,"weight":10}]', true, false);
select test.ok(public.update_site('Musabbir Hasan Sammak', 'DIU')->>'institution' = 'DIU', 'the teacher can update their details');
select test.rejects($$select * from public.ai_settings$$, 'even the teacher cannot read the stored AI key');
select test.ok((public.start_preview('20000000-0000-0000-0000-000000000001')->>'attempt_id') is not null, 'the teacher can preview');
select test.ok((public.start_preview('20000000-0000-0000-0000-000000000001')->>'attempt_id') is not null, 'a second preview works');
select test.ok((select count(*) from public.attempts where is_preview) = 1, 'old previews are removed');

-- ── A student (no account) ───────────────────────────────────────────
reset role;
set role anon;
select test.login(null);
select test.rejects($$select count(*) from public.tasks$$, 'students cannot read tables');
select test.rejects($$select count(*) from public.attempts$$, 'students cannot read attempts');
select test.rejects($$select public.start_preview('20000000-0000-0000-0000-000000000001')$$, 'students cannot preview');
select test.ok(public.get_task_public('20000000-0000-0000-0000-000000000001')->>'title' = 'Sampling', 'students can open a task by its link');
select test.ok(public.get_task_public('20000000-0000-0000-0000-000000000001')::text not like '%secret point%'
  and public.get_task_public('20000000-0000-0000-0000-000000000001')::text not like '%Big n fixes bias%', 'the task page never contains the claim or the points');
select test.ok((public.get_task_public('20000000-0000-0000-0000-000000000001')->>'has_roster')::boolean, 'students learn that a class list applies');
select test.ok(public.start_attempt('20000000-0000-0000-0000-000000000001', '221-35-1', 'not-an-email')->>'error' = 'bad_email', 'a bad email is refused');
select test.ok(public.start_attempt('20000000-0000-0000-0000-000000000001', '  ', 'a@b.co')->>'error' = 'bad_code', 'an empty ID is refused');
select test.ok(public.start_attempt('20000000-0000-0000-0000-000000000001', '999-99-9', 'a@b.co')->>'error' = 'not_on_list', 'an ID not on the class list is refused');
create temp table t_ids as select public.start_attempt('20000000-0000-0000-0000-000000000001', ' 221-35-1 ', 'Ayesha@Example.EDU') as r;
select test.ok((select (r->>'resumed')::boolean = false from t_ids), 'an ID on the list starts a new attempt');
select test.ok((select public.start_attempt('20000000-0000-0000-0000-000000000001', '221-35-1', 'x@y.zz')->>'attempt_id' = r->>'attempt_id' from t_ids),
  'the same ID reopens the unfinished attempt');
select test.ok((select public.get_attempt_public((r->>'attempt_id')::uuid, 'wrong') is null from t_ids), 'a wrong token shows nothing');
select test.ok((select public.get_attempt_public((r->>'attempt_id')::uuid, r->>'token')->>'student_code' = '221-35-1' from t_ids), 'the right token shows the attempt');
select test.ok((select json_array_length(public.get_attempt_public((r->>'attempt_id')::uuid, r->>'token')->'messages') = 1 from t_ids), 'the attempt starts with the opening message');
select test.ok((select public.get_attempt_public((r->>'attempt_id')::uuid, r->>'token')->>'criteria' is null from t_ids), 'the points stay hidden during the debate');
select test.ok((select public.get_attempt_public((r->>'attempt_id')::uuid, r->>'token')::text not like '%secret point%' from t_ids), 'the points never reach the student during the debate');
select test.rejects($$update public.attempts set score = 100$$, 'students cannot change attempts directly');

-- The debate ends (the server function does this with the service role)
reset role;
update public.attempts set status = 'conceded', score = 85, criteria_met = '[0]', finished_at = now()
 where id = (select (r->>'attempt_id')::uuid from t_ids);
select test.ok((select email from (select student_email as email from public.attempts where id = (select (r->>'attempt_id')::uuid from t_ids)) x) = 'ayesha@example.edu', 'emails are stored in lower case');
set role anon;
select test.ok((select (public.get_attempt_public((r->>'attempt_id')::uuid, r->>'token')->>'score')::int = 85 from t_ids), 'the finished result shows the score');
select test.ok((select public.get_attempt_public((r->>'attempt_id')::uuid, r->>'token')->'criteria'->0->>'text' = 'secret point' from t_ids), 'the points appear after the debate when allowed');
select test.ok(public.start_attempt('20000000-0000-0000-0000-000000000001', '221-35-1', 'a@b.co')->>'error' = 'done', 'no retry when the task allows one attempt');

-- An open course, retries allowed, points hidden afterwards
create temp table t_open as select public.start_attempt('20000000-0000-0000-0000-000000000002', 'anyone-1', 'a@b.co') as r;
select test.ok((select r->>'attempt_id' is not null from t_open), 'with no class list, any ID can start');
reset role;
update public.attempts set status = 'gave_up', score = 0, finished_at = now() where id = (select (r->>'attempt_id')::uuid from t_open);
set role anon;
select test.ok((select public.get_attempt_public((r->>'attempt_id')::uuid, r->>'token')->>'criteria' is null from t_open), 'points stay hidden when the teacher hides them');
select test.ok((select public.start_attempt('20000000-0000-0000-0000-000000000002', 'anyone-1', 'a@b.co')->>'attempt_id' <> r->>'attempt_id' from t_open), 'retries start a new attempt');

-- Closing the link stops new and unfinished attempts
reset role;
update public.tasks set is_open = false where id = '20000000-0000-0000-0000-000000000002';
set role anon;
select test.ok(public.start_attempt('20000000-0000-0000-0000-000000000002', 'anyone-1', 'a@b.co')->>'error' = 'closed', 'a closed link reopens nothing');
select test.ok(public.start_attempt('20000000-0000-0000-0000-000000000002', 'anyone-2', 'a@b.co')->>'error' = 'closed', 'a closed link starts nothing');
select test.rejects($$select * from public.ai_settings$$, 'students cannot read the AI key');

-- ── Clean-up rules ───────────────────────────────────────────────────
reset role;
delete from public.courses where id = '10000000-0000-0000-0000-000000000001';
select test.ok((select count(*) from public.tasks where id = '20000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.attempts a join public.tasks t on t.id = a.task_id where t.course_id = '10000000-0000-0000-0000-000000000001') = 0,
  'deleting a course removes its tasks and results');

\echo 'All security tests passed.'
