-- supabase/tests/apply_schedule_edit_test.sql
-- Run as: psql "$SUPABASE_SESSION_POOLER_URL" -f supabase/tests/apply_schedule_edit_test.sql

\set ON_ERROR_STOP on
\echo '== apply_schedule_edit tests =='

begin;

-- Fixture (idempotent: nukes the test project rows each run)
do $$
declare
  v_org    uuid;
  v_co_int uuid;
  v_u_sch  uuid := '11111111-1111-1111-1111-111111111111';
  v_u_view uuid := '22222222-2222-2222-2222-222222222222';
  v_proj   uuid := '33333333-3333-3333-3333-333333333333';
  v_cal    uuid := '44444444-4444-4444-4444-444444444444';
begin
  delete from applied_edit_requests where project_id = v_proj;
  delete from memberships where project_id = v_proj;
  delete from projects where id = v_proj;
  delete from calendars where id = v_cal;
  delete from users where id in (v_u_sch, v_u_view);
  delete from companies where name = 'TEST internal co';
  delete from organizations where name = 'TEST org';

  insert into organizations (id, name) values (gen_random_uuid(), 'TEST org')
    returning id into v_org;
  insert into companies (organization_id, name, type)
    values (v_org, 'TEST internal co', 'internal') returning id into v_co_int;

  insert into auth.users (id, email) values
    (v_u_sch,  'sched@test.local'),
    (v_u_view, 'viewer@test.local')
    on conflict (id) do nothing;

  insert into users (id, company_id, full_name, email) values
    (v_u_sch,  v_co_int, 'Test Scheduler', 'sched@test.local'),
    (v_u_view, v_co_int, 'Test Viewer',    'viewer@test.local');

  insert into projects (id, organization_id, name, project_start)
    values (v_proj, v_org, 'TEST proj', '2026-06-01');

  insert into calendars (id, project_id, name, is_default)
    values (v_cal, v_proj, 'TEST cal', true);
  update projects set default_calendar_id = v_cal where id = v_proj;

  insert into memberships (user_id, project_id, role) values
    (v_u_sch,  v_proj, 'scheduler'),
    (v_u_view, v_proj, 'internal_viewer');
end $$;

-- T1: unauthenticated call raises UNAUTHENTICATED
\echo '-- T1: UNAUTHENTICATED'
do $$
begin
  perform set_config('request.jwt.claim.sub', null, true);
  begin
    perform apply_schedule_edit(jsonb_build_object(
      'project_id',      '33333333-3333-3333-3333-333333333333',
      'request_id',      gen_random_uuid(),
      'acting_user_id',  '11111111-1111-1111-1111-111111111111'
    ));
    raise 'TEST FAILED: expected UNAUTHENTICATED';
  exception when sqlstate 'PT001' then
    null;
  end;
end $$;

-- T2: identity mismatch raises IDENTITY_MISMATCH
\echo '-- T2: IDENTITY_MISMATCH'
do $$
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  begin
    perform apply_schedule_edit(jsonb_build_object(
      'project_id',      '33333333-3333-3333-3333-333333333333',
      'request_id',      gen_random_uuid(),
      'acting_user_id',  '22222222-2222-2222-2222-222222222222'
    ));
    raise 'TEST FAILED: expected IDENTITY_MISMATCH';
  exception when sqlstate 'PT002' then
    null;
  end;
end $$;

-- T3: viewer (no edit_schedule) raises FORBIDDEN
\echo '-- T3: FORBIDDEN'
do $$
begin
  perform set_config('request.jwt.claim.sub',
    '22222222-2222-2222-2222-222222222222', true);
  begin
    perform apply_schedule_edit(jsonb_build_object(
      'project_id',      '33333333-3333-3333-3333-333333333333',
      'request_id',      gen_random_uuid(),
      'acting_user_id',  '22222222-2222-2222-2222-222222222222'
    ));
    raise 'TEST FAILED: expected FORBIDDEN';
  exception when sqlstate 'PT003' then
    null;
  end;
end $$;

-- T4: idempotent cache hit
\echo '-- T4: idempotent cache hit'
do $$
declare
  v_req uuid := gen_random_uuid();
  v_r1  jsonb;
  v_r2  jsonb;
  v_rows int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);

  v_r1 := apply_schedule_edit(jsonb_build_object(
    'project_id',      '33333333-3333-3333-3333-333333333333',
    'request_id',      v_req,
    'acting_user_id',  '11111111-1111-1111-1111-111111111111'
  ));

  v_r2 := apply_schedule_edit(jsonb_build_object(
    'project_id',      '33333333-3333-3333-3333-333333333333',
    'request_id',      v_req,
    'acting_user_id',  '11111111-1111-1111-1111-111111111111'
  ));

  if v_r1 is distinct from v_r2 then
    raise 'TEST FAILED: idempotency replay returned a different response';
  end if;

  select count(*) into v_rows from applied_edit_requests
    where project_id = '33333333-3333-3333-3333-333333333333' and request_id = v_req;
  if v_rows <> 1 then
    raise 'TEST FAILED: expected exactly one applied_edit_requests row, got %', v_rows;
  end if;
end $$;

rollback;
\echo '== all tests passed =='
