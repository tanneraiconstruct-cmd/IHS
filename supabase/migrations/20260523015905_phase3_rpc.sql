-- Phase 3: apply_schedule_edit — single transactional boundary for every
-- schedule-affecting write. Built in layers: this version implements auth and
-- idempotency only and returns a placeholder success response when the payload
-- carries no writes.

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
begin
  -- 0. ISOLATION  (spec §3.9 — conservative against future in-RPC reads)
  set local transaction isolation level repeatable read;

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

  -- 3..9 placeholder: subsequent tasks add version checks, writes, history.
  v_response := jsonb_build_object(
    'ok', true,
    'applied_at', now(),
    'note', 'placeholder — version-checks/writes not yet implemented'
  );

  update applied_edit_requests
    set response_blob = v_response
    where project_id = v_project_id and request_id = v_request_id;

  return v_response;
end;
$$;

revoke execute on function apply_schedule_edit(jsonb) from public, anon;
grant  execute on function apply_schedule_edit(jsonb) to authenticated;
