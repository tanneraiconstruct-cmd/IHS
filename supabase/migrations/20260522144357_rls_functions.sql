-- role_capabilities: the data-driven role -> capability matrix ------------
create table role_capabilities (
  role project_role not null,
  capability text not null,
  scope text not null default 'all',
  primary key (role, capability),
  check (scope in ('all', 'responsible'))
);

-- Seed the matrix from spec section 4.3.
-- A row's presence = granted. scope 'responsible' = the limited/scoped cells.
insert into role_capabilities (role, capability, scope) values
  ('org_admin','view_schedule','all'),
  ('project_admin','view_schedule','all'),
  ('scheduler','view_schedule','all'),
  ('project_manager','view_schedule','all'),
  ('superintendent','view_schedule','all'),
  ('internal_viewer','view_schedule','all'),
  ('trade_partner_editor','view_schedule','all'),
  ('trade_partner_viewer','view_schedule','all'),
  ('org_admin','edit_schedule','all'),
  ('project_admin','edit_schedule','all'),
  ('scheduler','edit_schedule','all'),
  ('project_manager','edit_schedule','all'),
  ('superintendent','edit_schedule','responsible'),
  ('org_admin','update_progress','all'),
  ('project_admin','update_progress','all'),
  ('scheduler','update_progress','all'),
  ('project_manager','update_progress','all'),
  ('superintendent','update_progress','all'),
  ('trade_partner_editor','update_progress','responsible'),
  ('org_admin','manage_dependencies','all'),
  ('project_admin','manage_dependencies','all'),
  ('scheduler','manage_dependencies','all'),
  ('project_manager','manage_dependencies','all'),
  ('org_admin','manage_baselines','all'),
  ('project_admin','manage_baselines','all'),
  ('scheduler','manage_baselines','all'),
  ('org_admin','create_lookahead','all'),
  ('project_admin','create_lookahead','all'),
  ('scheduler','create_lookahead','all'),
  ('project_manager','create_lookahead','all'),
  ('superintendent','create_lookahead','all'),
  ('org_admin','edit_lookahead_tasks','all'),
  ('project_admin','edit_lookahead_tasks','all'),
  ('scheduler','edit_lookahead_tasks','all'),
  ('project_manager','edit_lookahead_tasks','all'),
  ('superintendent','edit_lookahead_tasks','all'),
  ('trade_partner_editor','edit_lookahead_tasks','responsible'),
  ('org_admin','post_internal_comment','all'),
  ('project_admin','post_internal_comment','all'),
  ('scheduler','post_internal_comment','all'),
  ('project_manager','post_internal_comment','all'),
  ('superintendent','post_internal_comment','all'),
  ('internal_viewer','post_internal_comment','all'),
  ('org_admin','post_shared_comment','all'),
  ('project_admin','post_shared_comment','all'),
  ('scheduler','post_shared_comment','all'),
  ('project_manager','post_shared_comment','all'),
  ('superintendent','post_shared_comment','all'),
  ('internal_viewer','post_shared_comment','all'),
  ('trade_partner_editor','post_shared_comment','all'),
  ('org_admin','view_internal_comments','all'),
  ('project_admin','view_internal_comments','all'),
  ('scheduler','view_internal_comments','all'),
  ('project_manager','view_internal_comments','all'),
  ('superintendent','view_internal_comments','all'),
  ('internal_viewer','view_internal_comments','all'),
  ('org_admin','enter_edit_mode','all'),
  ('project_admin','enter_edit_mode','all'),
  ('scheduler','enter_edit_mode','all'),
  ('project_manager','enter_edit_mode','all'),
  ('superintendent','enter_edit_mode','responsible'),
  ('trade_partner_editor','enter_edit_mode','responsible'),
  ('org_admin','manage_members','all'),
  ('project_admin','manage_members','all'),
  ('org_admin','manage_calendars','all'),
  ('project_admin','manage_calendars','all'),
  ('scheduler','manage_calendars','all'),
  ('org_admin','soft_delete_activities','all'),
  ('project_admin','soft_delete_activities','all'),
  ('scheduler','soft_delete_activities','all');

-- Helper functions. SECURITY DEFINER so policies stay thin and reads of
-- memberships/role_capabilities inside them are not re-filtered by RLS
-- (which would recurse). All set an explicit search_path.

create or replace function current_company_type()
returns company_type
language sql stable security definer set search_path = public
as $$
  select c.type
  from users u
  join companies c on c.id = u.company_id
  where u.id = auth.uid();
$$;

create or replace function is_member(p_project uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.project_id = p_project
  );
$$;

create or replace function role_on(p_project uuid)
returns project_role
language sql stable security definer set search_path = public
as $$
  select m.role from memberships m
  where m.user_id = auth.uid() and m.project_id = p_project;
$$;

-- Returns true only if the caller's project role grants the capability AND
-- the grant's scope is satisfied: scope 'all' always; scope 'responsible'
-- only when p_is_responsible is true. No matching row -> false (least
-- privilege). This single function replaces the spec's can()/cap_scope().
create or replace function has_capability(
  p_capability text, p_project uuid, p_is_responsible boolean default false)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from role_capabilities rc
    where rc.role = role_on(p_project)
      and rc.capability = p_capability
      and (rc.scope = 'all' or (rc.scope = 'responsible' and p_is_responsible))
  );
$$;

create or replace function is_responsible(p_activity uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from activities a
    join users u on u.id = auth.uid()
    where a.id = p_activity
      and a.responsible_company_id = u.company_id
  );
$$;

-- Column-level guard: an external user may change progress fields only.
-- Compares old/new as jsonb so any future column is locked by default.
create or replace function enforce_external_progress_only()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  allowed text[] := array[
    'percent_complete','actual_start','actual_finish',
    'remaining_duration','version','updated_at'];
  old_j jsonb := to_jsonb(old);
  new_j jsonb := to_jsonb(new);
  k text;
begin
  if current_company_type() = 'external' then
    for k in select jsonb_object_keys(old_j) loop
      if not (k = any(allowed))
         and (old_j -> k) is distinct from (new_j -> k) then
        raise exception
          'External users may update progress fields only (column %)', k;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
