-- RLS verification. Run against the hosted DB:
--   psql "<connection-string>" -f supabase/tests/rls_verification.sql
-- A passing run ends with: "ALL RLS VERIFICATION CHECKS PASSED".

\set ON_ERROR_STOP on

-- Check 0: all 23 tables exist and the matrix is fully seeded ------------
do $$
begin
  if (select count(*) from information_schema.tables
        where table_schema = 'public') <> 23 then
    raise exception 'FAIL check 0: expected 23 public tables';
  end if;
  if (select count(*) from role_capabilities) <> 70 then
    raise exception 'FAIL check 0: expected 70 role_capabilities rows';
  end if;
  raise notice 'PASS check 0: schema and capability matrix present';
end $$;

-- Check 1: external Trade Partner Editor sees shared, not internal -------
begin;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"50000000-0000-0000-0000-000000000000","role":"authenticated"}';
  do $$
  begin
    if exists (select 1 from comments where visibility = 'internal') then
      raise exception 'FAIL check 1: external user can read an internal comment';
    end if;
    if not exists (select 1 from comments where visibility = 'shared') then
      raise exception 'FAIL check 1: external user cannot read the shared comment';
    end if;
    raise notice 'PASS check 1: internal comments hidden from external users';
  end $$;
rollback;

-- Check 2: external user reads the FULL schedule (Model A) ---------------
begin;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"50000000-0000-0000-0000-000000000000","role":"authenticated"}';
  do $$
  begin
    if (select count(*) from activities) <> 2 then
      raise exception 'FAIL check 2: external user should see both activities';
    end if;
    raise notice 'PASS check 2: external user reads the full master schedule';
  end $$;
rollback;

-- Check 3: external editor may update progress on a responsible activity,
--          but not its duration, and not a non-responsible activity ------
begin;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"50000000-0000-0000-0000-000000000000","role":"authenticated"}';
  do $$
  begin
    -- 3a: progress update on responsible activity B succeeds
    update activities set percent_complete = 40
      where id = 'b0000000-0000-0000-0000-000000000000';
    if not found then
      raise exception 'FAIL check 3a: external editor blocked from progress on own activity';
    end if;

    -- 3b: duration update on activity B is rejected by the column guard
    begin
      update activities set original_duration = 99
        where id = 'b0000000-0000-0000-0000-000000000000';
      raise exception 'FAIL check 3b: external editor changed a non-progress column';
    exception when others then
      if sqlerrm like 'FAIL check%' then raise; end if;
    end;

    -- 3c: any update on non-responsible activity A affects zero rows
    update activities set percent_complete = 10
      where id = 'a0000000-0000-0000-0000-000000000000';
    if found then
      raise exception 'FAIL check 3c: external editor updated a non-responsible activity';
    end if;

    raise notice 'PASS check 3: external editor scoped to progress on own activities';
  end $$;
rollback;

-- Check 4: Trade Partner Viewer is read-only -----------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"60000000-0000-0000-0000-000000000000","role":"authenticated"}';
  do $$
  begin
    if (select count(*) from activities) <> 2 then
      raise exception 'FAIL check 4: TP viewer should read the schedule';
    end if;
    update activities set percent_complete = 25
      where id = 'b0000000-0000-0000-0000-000000000000';
    if found then
      raise exception 'FAIL check 4: TP viewer was able to update an activity';
    end if;
    raise notice 'PASS check 4: Trade Partner Viewer is read-only';
  end $$;
rollback;

-- Check 5: internal Scheduler may edit logic/durations -------------------
begin;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"40000000-0000-0000-0000-000000000000","role":"authenticated"}';
  do $$
  begin
    update activities set original_duration = 4
      where id = 'a0000000-0000-0000-0000-000000000000';
    if not found then
      raise exception 'FAIL check 5: scheduler blocked from editing duration';
    end if;
    raise notice 'PASS check 5: internal scheduler can edit the schedule';
  end $$;
rollback;

-- Check 6: a non-member sees nothing -------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"f0000000-0000-0000-0000-000000000000","role":"authenticated"}';
  do $$
  begin
    if exists (select 1 from activities) then
      raise exception 'FAIL check 6: a non-member can read activities';
    end if;
    if exists (select 1 from projects) then
      raise exception 'FAIL check 6: a non-member can read projects';
    end if;
    raise notice 'PASS check 6: non-members see no project data';
  end $$;
rollback;

-- Check 7: activity_history rejects UPDATE and DELETE --------------------
begin;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"40000000-0000-0000-0000-000000000000","role":"authenticated"}';
  do $$
  begin
    insert into activity_history
      (project_id, entity_type, entity_id, field, old_value, new_value,
       changed_by, visibility)
    values
      ('70000000-0000-0000-0000-000000000000', 'activity',
       'a0000000-0000-0000-0000-000000000000', 'name', 'Mobilize',
       'Mobilize Crew', '40000000-0000-0000-0000-000000000000', 'shared');

    update activity_history set field = 'tampered'
      where entity_id = 'a0000000-0000-0000-0000-000000000000';
    if found then
      raise exception 'FAIL check 7: activity_history allowed an UPDATE';
    end if;

    delete from activity_history
      where entity_id = 'a0000000-0000-0000-0000-000000000000';
    if found then
      raise exception 'FAIL check 7: activity_history allowed a DELETE';
    end if;

    raise notice 'PASS check 7: activity_history is append-only';
  end $$;
rollback;

do $$ begin raise notice 'ALL RLS VERIFICATION CHECKS PASSED'; end $$;
