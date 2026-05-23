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

-- T1-T4 use an empty-writes payload that satisfies the full RPC's
-- PAYLOAD_INVALID check; the assertions exercise auth + idempotency.

-- T1: unauthenticated call raises UNAUTHENTICATED
\echo '-- T1: UNAUTHENTICATED'
do $$
begin
  perform set_config('request.jwt.claim.sub', null, true);
  begin
    perform apply_schedule_edit(jsonb_build_object(
      'project_id',      '33333333-3333-3333-3333-333333333333',
      'request_id',      gen_random_uuid(),
      'acting_user_id',  '11111111-1111-1111-1111-111111111111',
      'edit_session_id', gen_random_uuid(),
      'intent_op_count', 0,
      'base_versions', jsonb_build_object(
        'project_version', 1,
        'activities','{}'::jsonb,'dependencies','{}'::jsonb,'constraints','{}'::jsonb),
      'writes', jsonb_build_object(
        'activity_inserts','[]'::jsonb,'activity_updates','[]'::jsonb,
        'activity_soft_deletes','[]'::jsonb,
        'dependency_inserts','[]'::jsonb,'dependency_updates','[]'::jsonb,
        'dependency_soft_deletes','[]'::jsonb,
        'constraint_upserts','[]'::jsonb,'constraint_deletes','[]'::jsonb,
        'project_patch','{}'::jsonb,'project_problems','[]'::jsonb),
      'history_rows','[]'::jsonb
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
      'acting_user_id',  '22222222-2222-2222-2222-222222222222',
      'edit_session_id', gen_random_uuid(),
      'intent_op_count', 0,
      'base_versions', jsonb_build_object(
        'project_version', 1,
        'activities','{}'::jsonb,'dependencies','{}'::jsonb,'constraints','{}'::jsonb),
      'writes', jsonb_build_object(
        'activity_inserts','[]'::jsonb,'activity_updates','[]'::jsonb,
        'activity_soft_deletes','[]'::jsonb,
        'dependency_inserts','[]'::jsonb,'dependency_updates','[]'::jsonb,
        'dependency_soft_deletes','[]'::jsonb,
        'constraint_upserts','[]'::jsonb,'constraint_deletes','[]'::jsonb,
        'project_patch','{}'::jsonb,'project_problems','[]'::jsonb),
      'history_rows','[]'::jsonb
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
      'acting_user_id',  '22222222-2222-2222-2222-222222222222',
      'edit_session_id', gen_random_uuid(),
      'intent_op_count', 0,
      'base_versions', jsonb_build_object(
        'project_version', 1,
        'activities','{}'::jsonb,'dependencies','{}'::jsonb,'constraints','{}'::jsonb),
      'writes', jsonb_build_object(
        'activity_inserts','[]'::jsonb,'activity_updates','[]'::jsonb,
        'activity_soft_deletes','[]'::jsonb,
        'dependency_inserts','[]'::jsonb,'dependency_updates','[]'::jsonb,
        'dependency_soft_deletes','[]'::jsonb,
        'constraint_upserts','[]'::jsonb,'constraint_deletes','[]'::jsonb,
        'project_patch','{}'::jsonb,'project_problems','[]'::jsonb),
      'history_rows','[]'::jsonb
    ));
    raise 'TEST FAILED: expected FORBIDDEN';
  exception when sqlstate 'PT003' then
    null;
  end;
end $$;

-- T4: idempotent cache hit on a no-op edit
\echo '-- T4: idempotent cache hit'
do $$
declare
  v_req uuid := gen_random_uuid();
  v_r1  jsonb;
  v_r2  jsonb;
  v_rows int;
  v_payload jsonb;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);

  v_payload := jsonb_build_object(
    'project_id',      '33333333-3333-3333-3333-333333333333',
    'request_id',      v_req,
    'acting_user_id',  '11111111-1111-1111-1111-111111111111',
    'edit_session_id', gen_random_uuid(),
    'intent_op_count', 0,
    'base_versions', jsonb_build_object(
      'project_version', 1,
      'activities','{}'::jsonb,'dependencies','{}'::jsonb,'constraints','{}'::jsonb),
    'writes', jsonb_build_object(
      'activity_inserts','[]'::jsonb,'activity_updates','[]'::jsonb,
      'activity_soft_deletes','[]'::jsonb,
      'dependency_inserts','[]'::jsonb,'dependency_updates','[]'::jsonb,
      'dependency_soft_deletes','[]'::jsonb,
      'constraint_upserts','[]'::jsonb,'constraint_deletes','[]'::jsonb,
      'project_patch','{}'::jsonb,'project_problems','[]'::jsonb),
    'history_rows','[]'::jsonb
  );

  v_r1 := apply_schedule_edit(v_payload);
  v_r2 := apply_schedule_edit(v_payload);

  if v_r1 is distinct from v_r2 then
    raise 'TEST FAILED: idempotency replay returned a different response';
  end if;

  select count(*) into v_rows from applied_edit_requests
    where project_id = '33333333-3333-3333-3333-333333333333' and request_id = v_req;
  if v_rows <> 1 then
    raise 'TEST FAILED: expected exactly one applied_edit_requests row, got %', v_rows;
  end if;
end $$;

-- T5: STALE_STATE on version mismatch (no writes occur)
\echo '-- T5: STALE_STATE'
do $$
declare
  v_proj  uuid := '33333333-3333-3333-3333-333333333333';
  v_act   uuid;
  v_resp  jsonb;
  v_count_before int;
  v_count_after  int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);

  insert into wbs_nodes (id, project_id, name)
    values ('55555555-5555-5555-5555-555555555555', v_proj, 'Root')
    on conflict (id) do nothing;
  insert into activities (id, project_id, wbs_node_id, name, original_duration, remaining_duration)
    values (gen_random_uuid(), v_proj, '55555555-5555-5555-5555-555555555555',
            'A', 5, 5)
    returning id into v_act;

  select count(*) into v_count_before from activity_history where entity_id = v_act;

  v_resp := apply_schedule_edit(jsonb_build_object(
    'project_id',      v_proj,
    'request_id',      gen_random_uuid(),
    'acting_user_id',  '11111111-1111-1111-1111-111111111111',
    'edit_session_id', gen_random_uuid(),
    'intent_op_count', 0,
    'base_versions', jsonb_build_object(
      'project_version', 1,
      'activities',      jsonb_build_object(v_act::text, 999),  -- WRONG version
      'dependencies',    '{}'::jsonb,
      'constraints',     '{}'::jsonb
    ),
    'writes', jsonb_build_object(
      'activity_inserts','[]'::jsonb, 'activity_updates','[]'::jsonb,
      'activity_soft_deletes','[]'::jsonb,
      'dependency_inserts','[]'::jsonb, 'dependency_updates','[]'::jsonb,
      'dependency_soft_deletes','[]'::jsonb,
      'constraint_upserts','[]'::jsonb, 'constraint_deletes','[]'::jsonb,
      'project_patch','{}'::jsonb, 'project_problems','[]'::jsonb
    ),
    'history_rows','[]'::jsonb
  ));

  if v_resp->>'error' <> 'STALE_STATE' then
    raise 'TEST FAILED T5: expected STALE_STATE, got %', v_resp;
  end if;

  select count(*) into v_count_after from activity_history where entity_id = v_act;
  if v_count_after <> v_count_before then
    raise 'TEST FAILED T5: history rows changed on STALE_STATE (% -> %)',
          v_count_before, v_count_after;
  end if;
end $$;

-- T6: successful activity update bumps version and writes history
\echo '-- T6: write + history + version bump'
do $$
declare
  v_proj uuid := '33333333-3333-3333-3333-333333333333';
  v_act  uuid;
  v_ver_before int; v_ver_after int;
  v_resp jsonb;
  v_history_count int;
begin
  perform set_config('request.jwt.claim.sub',
    '11111111-1111-1111-1111-111111111111', true);
  select id into v_act from activities where project_id = v_proj limit 1;
  select version into v_ver_before from activities where id = v_act;

  v_resp := apply_schedule_edit(jsonb_build_object(
    'project_id',      v_proj,
    'request_id',      gen_random_uuid(),
    'acting_user_id',  '11111111-1111-1111-1111-111111111111',
    'edit_session_id', gen_random_uuid(),
    'intent_op_count', 1,
    'base_versions', jsonb_build_object(
      'project_version', (select version from projects where id = v_proj),
      'activities',      jsonb_build_object(v_act::text, v_ver_before),
      'dependencies',    '{}'::jsonb,
      'constraints',     '{}'::jsonb
    ),
    'writes', jsonb_build_object(
      'activity_inserts','[]'::jsonb,
      'activity_updates', jsonb_build_array(jsonb_build_object(
        'id', v_act,
        'early_start','2026-06-01','early_finish','2026-06-09',
        'late_start','2026-06-01','late_finish','2026-06-09',
        'planned_start','2026-06-01','planned_finish','2026-06-09',
        'total_float',0,'free_float',0,'is_critical', true
      )),
      'activity_soft_deletes','[]'::jsonb,
      'dependency_inserts','[]'::jsonb, 'dependency_updates','[]'::jsonb,
      'dependency_soft_deletes','[]'::jsonb,
      'constraint_upserts','[]'::jsonb, 'constraint_deletes','[]'::jsonb,
      'project_patch','{}'::jsonb, 'project_problems','[]'::jsonb
    ),
    'history_rows', jsonb_build_array(jsonb_build_object(
      'entity_type','activity','entity_id', v_act,
      'field','original_duration','old_value','5','new_value','7',
      'op_index', 0,'source','intent'
    ))
  ));

  if (v_resp->>'ok')::boolean <> true then
    raise 'TEST FAILED T6: expected ok=true, got %', v_resp;
  end if;
  select version into v_ver_after from activities where id = v_act;
  if v_ver_after <> v_ver_before + 1 then
    raise 'TEST FAILED T6: version did not bump (% -> %)', v_ver_before, v_ver_after;
  end if;
  select count(*) into v_history_count from activity_history
    where entity_id = v_act and source = 'intent';
  if v_history_count = 0 then
    raise 'TEST FAILED T6: no intent history rows written';
  end if;
end $$;

rollback;
\echo '== all tests passed =='
