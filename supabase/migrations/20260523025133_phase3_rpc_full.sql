-- Phase 3 (Task 15): replace the apply_schedule_edit placeholder body with the
-- full version-check + writes + history implementation. Forward-only via
-- `create or replace function` — no data loss vs. a `db reset --linked`.

create or replace function apply_schedule_edit(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id      uuid := (p_payload->>'project_id')::uuid;
  v_request_id      uuid := (p_payload->>'request_id')::uuid;
  v_acting_user_id  uuid := (p_payload->>'acting_user_id')::uuid;
  v_existing        jsonb;
  v_response        jsonb;
  v_temp_id_map     jsonb := '{}'::jsonb;
begin
  -- 1. AUTH ----------------------------------------------------------------
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'PT001';
  end if;
  if v_acting_user_id is null or v_acting_user_id <> auth.uid() then
    raise exception 'IDENTITY_MISMATCH' using errcode = 'PT002';
  end if;
  if not has_capability('edit_schedule', v_project_id) then
    raise exception 'FORBIDDEN' using errcode = 'PT003';
  end if;

  -- 2. IDEMPOTENCY (upsert-then-lock; race-safe) ---------------------------
  insert into applied_edit_requests (project_id, request_id, response_blob, created_at)
    values (v_project_id, v_request_id, '{}'::jsonb, now())
    on conflict (project_id, request_id) do nothing;

  select response_blob into v_existing
    from applied_edit_requests
    where project_id = v_project_id and request_id = v_request_id
    for update;

  if v_existing is not null and v_existing <> '{}'::jsonb then
    return v_existing;  -- cached prior result
  end if;

  -- 3. PAYLOAD SANITY ------------------------------------------------------
  if (p_payload->'writes') is null then
    raise exception 'PAYLOAD_INVALID' using errcode = 'PT004';
  end if;

  -- 4. VERSION CHECKS ------------------------------------------------------
  declare
    v_stale_activities   uuid[] := '{}';
    v_stale_dependencies uuid[] := '{}';
    v_stale_constraints  uuid[] := '{}';
    v_stale_project      boolean := false;
    v_id   uuid;
    v_ver  integer;
    v_cur  integer;
  begin
    for v_id, v_ver in
      select key::uuid, value::int
        from jsonb_each_text(p_payload->'base_versions'->'activities')
    loop
      select version into v_cur from activities where id = v_id;
      if v_cur is distinct from v_ver then
        v_stale_activities := v_stale_activities || v_id;
      end if;
    end loop;

    for v_id, v_ver in
      select key::uuid, value::int
        from jsonb_each_text(p_payload->'base_versions'->'dependencies')
    loop
      select version into v_cur from dependencies where id = v_id;
      if v_cur is distinct from v_ver then
        v_stale_dependencies := v_stale_dependencies || v_id;
      end if;
    end loop;

    for v_id, v_ver in
      select key::uuid, value::int
        from jsonb_each_text(p_payload->'base_versions'->'constraints')
    loop
      select version into v_cur from activity_constraints where activity_id = v_id;
      if v_cur is distinct from v_ver then
        v_stale_constraints := v_stale_constraints || v_id;
      end if;
    end loop;

    select version into v_cur from projects where id = v_project_id;
    if v_cur is distinct from (p_payload->'base_versions'->>'project_version')::int then
      v_stale_project := true;
    end if;

    if array_length(v_stale_activities,1)   is not null
      or array_length(v_stale_dependencies,1) is not null
      or array_length(v_stale_constraints,1)  is not null
      or v_stale_project then
      v_response := jsonb_build_object(
        'ok', false,
        'error', 'STALE_STATE',
        'stale', jsonb_build_object(
          'activities',   to_jsonb(v_stale_activities),
          'dependencies', to_jsonb(v_stale_dependencies),
          'constraints',  to_jsonb(v_stale_constraints),
          'project',      v_stale_project
        )
      );
      update applied_edit_requests
        set response_blob = v_response
        where project_id = v_project_id and request_id = v_request_id;
      return v_response;
    end if;
  end;

  -- 5. ACTIVITY + DEPENDENCY INSERTS ---------------------------------------
  declare
    v_row jsonb;
    v_new_id uuid;
  begin
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'activity_inserts') loop
      insert into activities (
        project_id, wbs_node_id, name, activity_type,
        original_duration, remaining_duration, calendar_id,
        early_start, early_finish, late_start, late_finish,
        planned_start, planned_finish, total_float, free_float, is_critical,
        version
      ) values (
        v_project_id,
        (v_row->>'wbs_node_id')::uuid,
        v_row->>'name',
        (v_row->>'activity_type')::activity_type,
        (v_row->>'original_duration')::int,
        (v_row->>'remaining_duration')::int,
        nullif(v_row->>'calendar_id','')::uuid,
        nullif(v_row->>'early_start','')::date,
        nullif(v_row->>'early_finish','')::date,
        nullif(v_row->>'late_start','')::date,
        nullif(v_row->>'late_finish','')::date,
        nullif(v_row->>'planned_start','')::date,
        nullif(v_row->>'planned_finish','')::date,
        (v_row->>'total_float')::int,
        (v_row->>'free_float')::int,
        (v_row->>'is_critical')::boolean,
        1
      ) returning id into v_new_id;
      v_temp_id_map := v_temp_id_map || jsonb_build_object(v_row->>'temp_id', v_new_id);
    end loop;

    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'dependency_inserts') loop
      insert into dependencies (
        project_id, predecessor_id, successor_id, type, lag, is_active, version
      ) values (
        v_project_id,
        coalesce((v_temp_id_map->>(v_row->>'predecessor_id'))::uuid,
                 (v_row->>'predecessor_id')::uuid),
        coalesce((v_temp_id_map->>(v_row->>'successor_id'))::uuid,
                 (v_row->>'successor_id')::uuid),
        (v_row->>'type')::dependency_type,
        (v_row->>'lag')::int,
        true, 1
      ) returning id into v_new_id;
      v_temp_id_map := v_temp_id_map || jsonb_build_object(v_row->>'temp_id', v_new_id);
    end loop;

    -- 6. ACTIVITY + DEPENDENCY UPDATES
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'activity_updates') loop
      update activities set
        early_start    = nullif(v_row->>'early_start','')::date,
        early_finish   = nullif(v_row->>'early_finish','')::date,
        late_start     = nullif(v_row->>'late_start','')::date,
        late_finish    = nullif(v_row->>'late_finish','')::date,
        planned_start  = nullif(v_row->>'planned_start','')::date,
        planned_finish = nullif(v_row->>'planned_finish','')::date,
        total_float    = (v_row->>'total_float')::int,
        free_float     = (v_row->>'free_float')::int,
        is_critical    = (v_row->>'is_critical')::boolean,
        version        = version + 1,
        updated_at     = now()
      where id = (v_row->>'id')::uuid;
    end loop;

    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'dependency_updates') loop
      update dependencies set
        is_active = coalesce((v_row->>'is_active')::boolean, is_active),
        lag       = coalesce((v_row->>'lag')::int, lag),
        version   = version + 1
      where id = (v_row->>'id')::uuid;
    end loop;

    -- 7. SOFT DELETES + CONSTRAINT UPSERTS/DELETES
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'activity_soft_deletes') loop
      update activities set deleted_at = now(), version = version + 1
        where id = (v_row->>'id')::uuid;
    end loop;
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'dependency_soft_deletes') loop
      update dependencies set deleted_at = now(), version = version + 1
        where id = (v_row->>'id')::uuid;
    end loop;

    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'constraint_upserts') loop
      insert into activity_constraints (activity_id, type, constraint_date, version)
        values (
          (v_row->>'activity_id')::uuid,
          (v_row->>'type')::constraint_type,
          nullif(v_row->>'constraint_date','')::date,
          1
        )
        on conflict (activity_id) do update set
          type            = excluded.type,
          constraint_date = excluded.constraint_date,
          version         = activity_constraints.version + 1;
    end loop;
    for v_row in select * from jsonb_array_elements(p_payload->'writes'->'constraint_deletes') loop
      delete from activity_constraints where activity_id = (v_row->>'activity_id')::uuid;
    end loop;
  end;

  -- 8. PROJECT PATCH -------------------------------------------------------
  update projects set
    data_date            = coalesce(
      nullif(p_payload->'writes'->'project_patch'->>'data_date','')::date,
      data_date),
    schedule_dirty_at    = null,
    last_engine_problems = coalesce(p_payload->'writes'->'project_problems', '[]'::jsonb),
    version              = version + 1
  where id = v_project_id;

  -- 9. HISTORY ROWS --------------------------------------------------------
  declare
    v_hist_row jsonb;
    v_hist_ids uuid[] := '{}';
    v_hist_id  uuid;
  begin
    for v_hist_row in select * from jsonb_array_elements(p_payload->'history_rows') loop
      insert into activity_history (
        project_id, edit_session_id, entity_type, entity_id, field,
        old_value, new_value, changed_by, op_index, source, visibility
      ) values (
        v_project_id,
        (p_payload->>'edit_session_id')::uuid,
        v_hist_row->>'entity_type',
        (v_hist_row->>'entity_id')::uuid,
        v_hist_row->>'field',
        v_hist_row->>'old_value',
        v_hist_row->>'new_value',
        v_acting_user_id,
        nullif(v_hist_row->>'op_index','')::int,
        v_hist_row->>'source',
        'shared'
      ) returning id into v_hist_id;
      v_hist_ids := v_hist_ids || v_hist_id;
    end loop;

    -- 10. RESPONSE
    v_response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'applied_at',      now(),
        'project_version', (select version from projects where id = v_project_id),
        'temp_id_map',     v_temp_id_map,
        'history_ids',     to_jsonb(v_hist_ids)
      )
    );
  end;

  update applied_edit_requests
    set response_blob = v_response
    where project_id = v_project_id and request_id = v_request_id;

  return v_response;
end;
$$;

revoke execute on function apply_schedule_edit(jsonb) from public, anon;
grant  execute on function apply_schedule_edit(jsonb) to authenticated;
