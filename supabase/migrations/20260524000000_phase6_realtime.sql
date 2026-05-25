-- Phase 6: Real-time collaboration
-- See docs/superpowers/specs/2026-05-24-phase-6-realtime-design.md

-- 1. Add project_id to activity_constraints so realtime can filter by it.
alter table activity_constraints
  add column project_id uuid references projects(id) on delete cascade;

update activity_constraints ac
  set project_id = a.project_id
  from activities a
  where ac.activity_id = a.id and ac.project_id is null;

alter table activity_constraints
  alter column project_id set not null;

create index activity_constraints_project_id_idx
  on activity_constraints (project_id);

-- 2. SELECT policy for activity_constraints (mirrors other tables — uses is_member).
drop policy if exists activity_constraints_select on activity_constraints;
create policy activity_constraints_select on activity_constraints
  for select to authenticated
  using (is_member(project_id));

-- 3. Replica identity full so DELETE and UPDATE events ship full row data.
alter table activities             replica identity full;
alter table dependencies           replica identity full;
alter table activity_constraints   replica identity full;
alter table wbs_nodes              replica identity full;
alter table comments               replica identity full;
alter table activity_history       replica identity full;

-- 4. Add the six tables to the supabase_realtime publication.
alter publication supabase_realtime add table activities;
alter publication supabase_realtime add table dependencies;
alter publication supabase_realtime add table activity_constraints;
alter publication supabase_realtime add table wbs_nodes;
alter publication supabase_realtime add table comments;
alter publication supabase_realtime add table activity_history;
