-- Enable RLS on every table ----------------------------------------------
alter table organizations            enable row level security;
alter table companies                enable row level security;
alter table users                    enable row level security;
alter table projects                 enable row level security;
alter table memberships               enable row level security;
alter table calendars                 enable row level security;
alter table calendar_exceptions       enable row level security;
alter table wbs_nodes                 enable row level security;
alter table activities                enable row level security;
alter table dependencies               enable row level security;
alter table activity_constraints      enable row level security;
alter table resources                  enable row level security;
alter table resource_assignments       enable row level security;
alter table activity_codes              enable row level security;
alter table activity_code_assignments  enable row level security;
alter table baselines                  enable row level security;
alter table baseline_activities        enable row level security;
alter table lookaheads                  enable row level security;
alter table lookahead_tasks             enable row level security;
alter table comments                    enable row level security;
alter table attachments                 enable row level security;
alter table activity_history            enable row level security;
alter table role_capabilities           enable row level security;

-- organizations: read your own org ---------------------------------------
create policy organizations_select on organizations for select to authenticated
  using (id in (
    select c.organization_id from companies c
    join users u on u.company_id = c.id
    where u.id = auth.uid()
  ));

-- companies: read companies in your own org ------------------------------
create policy companies_select on companies for select to authenticated
  using (organization_id in (
    select c.organization_id from companies c
    join users u on u.company_id = c.id
    where u.id = auth.uid()
  ));

-- users: read yourself and anyone you share a project with ---------------
create policy users_select on users for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from memberships m1
      join memberships m2 on m1.project_id = m2.project_id
      where m1.user_id = auth.uid() and m2.user_id = users.id
    )
  );

-- projects: members read; admins update ----------------------------------
create policy projects_select on projects for select to authenticated
  using (is_member(id));
create policy projects_update on projects for update to authenticated
  using (has_capability('manage_members', id))
  with check (has_capability('manage_members', id));

-- memberships: read your own or any if you manage members; admins write --
create policy memberships_select on memberships for select to authenticated
  using (user_id = auth.uid() or has_capability('manage_members', project_id));
create policy memberships_insert on memberships for insert to authenticated
  with check (has_capability('manage_members', project_id));
create policy memberships_update on memberships for update to authenticated
  using (has_capability('manage_members', project_id))
  with check (has_capability('manage_members', project_id));
create policy memberships_delete on memberships for delete to authenticated
  using (has_capability('manage_members', project_id));

-- calendars --------------------------------------------------------------
create policy calendars_select on calendars for select to authenticated
  using (is_member(project_id));
create policy calendars_insert on calendars for insert to authenticated
  with check (has_capability('manage_calendars', project_id));
create policy calendars_update on calendars for update to authenticated
  using (has_capability('manage_calendars', project_id))
  with check (has_capability('manage_calendars', project_id));

-- calendar_exceptions (child of calendars) -------------------------------
create policy calendar_exceptions_select on calendar_exceptions for select to authenticated
  using (is_member((select project_id from calendars c where c.id = calendar_id)));
create policy calendar_exceptions_insert on calendar_exceptions for insert to authenticated
  with check (has_capability('manage_calendars',
    (select project_id from calendars c where c.id = calendar_id)));
create policy calendar_exceptions_update on calendar_exceptions for update to authenticated
  using (has_capability('manage_calendars',
    (select project_id from calendars c where c.id = calendar_id)))
  with check (has_capability('manage_calendars',
    (select project_id from calendars c where c.id = calendar_id)));
create policy calendar_exceptions_delete on calendar_exceptions for delete to authenticated
  using (has_capability('manage_calendars',
    (select project_id from calendars c where c.id = calendar_id)));

-- wbs_nodes --------------------------------------------------------------
create policy wbs_nodes_select on wbs_nodes for select to authenticated
  using (is_member(project_id));
create policy wbs_nodes_insert on wbs_nodes for insert to authenticated
  with check (has_capability('edit_schedule', project_id));
create policy wbs_nodes_update on wbs_nodes for update to authenticated
  using (has_capability('edit_schedule', project_id))
  with check (has_capability('edit_schedule', project_id));

-- activities: members read; edit/progress gated; external scoped --------
create policy activities_select on activities for select to authenticated
  using (is_member(project_id));
create policy activities_insert on activities for insert to authenticated
  with check (has_capability('edit_schedule', project_id));
create policy activities_update on activities for update to authenticated
  using (
    has_capability('edit_schedule', project_id, is_responsible(id))
    or has_capability('update_progress', project_id, is_responsible(id))
  )
  with check (
    has_capability('edit_schedule', project_id, is_responsible(id))
    or has_capability('update_progress', project_id, is_responsible(id))
  );

-- dependencies -----------------------------------------------------------
create policy dependencies_select on dependencies for select to authenticated
  using (is_member(project_id));
create policy dependencies_insert on dependencies for insert to authenticated
  with check (has_capability('manage_dependencies', project_id));
create policy dependencies_update on dependencies for update to authenticated
  using (has_capability('manage_dependencies', project_id))
  with check (has_capability('manage_dependencies', project_id));

-- activity_constraints (child of activities) -----------------------------
create policy activity_constraints_select on activity_constraints for select to authenticated
  using (is_member((select project_id from activities a where a.id = activity_id)));
create policy activity_constraints_insert on activity_constraints for insert to authenticated
  with check (has_capability('edit_schedule',
    (select project_id from activities a where a.id = activity_id)));
create policy activity_constraints_update on activity_constraints for update to authenticated
  using (has_capability('edit_schedule',
    (select project_id from activities a where a.id = activity_id)))
  with check (has_capability('edit_schedule',
    (select project_id from activities a where a.id = activity_id)));

-- resources --------------------------------------------------------------
create policy resources_select on resources for select to authenticated
  using (is_member(project_id));
create policy resources_insert on resources for insert to authenticated
  with check (has_capability('edit_schedule', project_id));
create policy resources_update on resources for update to authenticated
  using (has_capability('edit_schedule', project_id))
  with check (has_capability('edit_schedule', project_id));

-- resource_assignments (child of activities) -----------------------------
create policy resource_assignments_select on resource_assignments for select to authenticated
  using (is_member((select project_id from activities a where a.id = activity_id)));
create policy resource_assignments_insert on resource_assignments for insert to authenticated
  with check (has_capability('edit_schedule',
    (select project_id from activities a where a.id = activity_id)));
create policy resource_assignments_update on resource_assignments for update to authenticated
  using (has_capability('edit_schedule',
    (select project_id from activities a where a.id = activity_id)))
  with check (has_capability('edit_schedule',
    (select project_id from activities a where a.id = activity_id)));
create policy resource_assignments_delete on resource_assignments for delete to authenticated
  using (has_capability('edit_schedule',
    (select project_id from activities a where a.id = activity_id)));

-- activity_codes ---------------------------------------------------------
create policy activity_codes_select on activity_codes for select to authenticated
  using (is_member(project_id));
create policy activity_codes_insert on activity_codes for insert to authenticated
  with check (has_capability('edit_schedule', project_id));
create policy activity_codes_update on activity_codes for update to authenticated
  using (has_capability('edit_schedule', project_id))
  with check (has_capability('edit_schedule', project_id));

-- activity_code_assignments (child of activities) ------------------------
create policy activity_code_assignments_select on activity_code_assignments for select to authenticated
  using (is_member((select project_id from activities a where a.id = activity_id)));
create policy activity_code_assignments_insert on activity_code_assignments for insert to authenticated
  with check (has_capability('edit_schedule',
    (select project_id from activities a where a.id = activity_id)));
create policy activity_code_assignments_delete on activity_code_assignments for delete to authenticated
  using (has_capability('edit_schedule',
    (select project_id from activities a where a.id = activity_id)));

-- baselines --------------------------------------------------------------
create policy baselines_select on baselines for select to authenticated
  using (is_member(project_id));
create policy baselines_insert on baselines for insert to authenticated
  with check (has_capability('manage_baselines', project_id));

-- baseline_activities (child of baselines; snapshots are immutable) ------
create policy baseline_activities_select on baseline_activities for select to authenticated
  using (is_member((select project_id from baselines b where b.id = baseline_id)));
create policy baseline_activities_insert on baseline_activities for insert to authenticated
  with check (has_capability('manage_baselines',
    (select project_id from baselines b where b.id = baseline_id)));

-- lookaheads -------------------------------------------------------------
create policy lookaheads_select on lookaheads for select to authenticated
  using (is_member(project_id));
create policy lookaheads_insert on lookaheads for insert to authenticated
  with check (has_capability('create_lookahead', project_id));
create policy lookaheads_update on lookaheads for update to authenticated
  using (has_capability('create_lookahead', project_id))
  with check (has_capability('create_lookahead', project_id));

-- lookahead_tasks (child of lookaheads; external scoped to own company) --
create policy lookahead_tasks_select on lookahead_tasks for select to authenticated
  using (is_member((select project_id from lookaheads l where l.id = lookahead_id)));
create policy lookahead_tasks_insert on lookahead_tasks for insert to authenticated
  with check (has_capability('edit_lookahead_tasks',
    (select project_id from lookaheads l where l.id = lookahead_id),
    responsible_company_id is not null
      and responsible_company_id = (select company_id from users where id = auth.uid())));
create policy lookahead_tasks_update on lookahead_tasks for update to authenticated
  using (has_capability('edit_lookahead_tasks',
    (select project_id from lookaheads l where l.id = lookahead_id),
    responsible_company_id is not null
      and responsible_company_id = (select company_id from users where id = auth.uid())))
  with check (has_capability('edit_lookahead_tasks',
    (select project_id from lookaheads l where l.id = lookahead_id),
    responsible_company_id is not null
      and responsible_company_id = (select company_id from users where id = auth.uid())));

-- comments: internal comments are invisible to external users -----------
create policy comments_select on comments for select to authenticated
  using (is_member(project_id)
    and (visibility = 'shared' or current_company_type() = 'internal'));
create policy comments_insert on comments for insert to authenticated
  with check (is_member(project_id) and (
    (visibility = 'internal' and has_capability('post_internal_comment', project_id))
    or (visibility = 'shared' and has_capability('post_shared_comment', project_id))
  ));
create policy comments_update on comments for update to authenticated
  using (author_user_id = auth.uid())
  with check (author_user_id = auth.uid());

-- attachments: same internal/shared visibility rule ----------------------
create policy attachments_select on attachments for select to authenticated
  using (is_member(project_id)
    and (visibility = 'shared' or current_company_type() = 'internal'));
create policy attachments_insert on attachments for insert to authenticated
  with check (is_member(project_id));

-- activity_history: append-only; same visibility rule -------------------
create policy activity_history_select on activity_history for select to authenticated
  using (is_member(project_id)
    and (visibility = 'shared' or current_company_type() = 'internal'));
create policy activity_history_insert on activity_history for insert to authenticated
  with check (is_member(project_id));

-- role_capabilities: readable reference data ----------------------------
create policy role_capabilities_select on role_capabilities for select to authenticated
  using (true);

-- Attach the external column-level guard ---------------------------------
create trigger activities_external_progress_guard
  before update on activities
  for each row execute function enforce_external_progress_only();

-- Restrict the SECURITY DEFINER helper functions. They are internal RLS
-- plumbing, not client API. RLS policy expressions require the querying
-- role to hold EXECUTE, so authenticated must keep it (policies above call
-- these); revoking from public removes the unauthenticated RPC surface.
revoke execute on function
  current_company_type(), is_member(uuid), role_on(uuid),
  has_capability(text, uuid, boolean), is_responsible(uuid)
  from public;
grant execute on function
  current_company_type(), is_member(uuid), role_on(uuid),
  has_capability(text, uuid, boolean), is_responsible(uuid)
  to authenticated;
