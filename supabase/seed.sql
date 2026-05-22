-- auth.users rows (required by the public.users FK) -----------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data,
   confirmation_token, email_change, email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000',
   '40000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','scheduler@ihs.test',
   extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}','{}','','','',''),
  ('00000000-0000-0000-0000-000000000000',
   '50000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tp-editor@trade.test',
   extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}','{}','','','',''),
  ('00000000-0000-0000-0000-000000000000',
   '60000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tp-viewer@trade.test',
   extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}','{}','','','','');

-- organization ------------------------------------------------------------
insert into organizations (id, name) values
  ('10000000-0000-0000-0000-000000000000', 'IHS Construction');

-- companies ---------------------------------------------------------------
insert into companies (id, organization_id, name, type) values
  ('20000000-0000-0000-0000-000000000000',
   '10000000-0000-0000-0000-000000000000', 'IHS (Internal)', 'internal'),
  ('30000000-0000-0000-0000-000000000000',
   '10000000-0000-0000-0000-000000000000', 'Ace Concrete (Trade)', 'external');

-- users (profiles) --------------------------------------------------------
insert into users (id, company_id, full_name, email, title) values
  ('40000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000000', 'Sam Scheduler',
   'scheduler@ihs.test', 'Scheduler'),
  ('50000000-0000-0000-0000-000000000000',
   '30000000-0000-0000-0000-000000000000', 'Tina TradeEditor',
   'tp-editor@trade.test', 'Foreman'),
  ('60000000-0000-0000-0000-000000000000',
   '30000000-0000-0000-0000-000000000000', 'Victor TradeViewer',
   'tp-viewer@trade.test', 'Estimator');

-- project -----------------------------------------------------------------
insert into projects (id, organization_id, name, number, project_start, status) values
  ('70000000-0000-0000-0000-000000000000',
   '10000000-0000-0000-0000-000000000000', 'Riverside Office Build',
   'IHS-001', date '2026-06-01', 'active');

-- calendar + one holiday exception ---------------------------------------
insert into calendars (id, project_id, name, working_weekdays, is_default) values
  ('80000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000', 'Standard 5-Day',
   '{1,2,3,4,5}', true);

update projects
  set default_calendar_id = '80000000-0000-0000-0000-000000000000'
  where id = '70000000-0000-0000-0000-000000000000';

insert into calendar_exceptions (calendar_id, exception_date, working) values
  ('80000000-0000-0000-0000-000000000000', date '2026-07-03', false);

-- memberships: internal scheduler, external editor, external viewer ------
insert into memberships (user_id, project_id, role) values
  ('40000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000', 'scheduler'),
  ('50000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000', 'trade_partner_editor'),
  ('60000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000', 'trade_partner_viewer');

-- WBS node ----------------------------------------------------------------
insert into wbs_nodes (id, project_id, name, sort_order) values
  ('90000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000', 'Sitework', 1);

-- activities: A has no responsible company; B is the trade's responsibility
insert into activities
  (id, project_id, wbs_node_id, name, activity_type,
   original_duration, remaining_duration, responsible_company_id) values
  ('a0000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000',
   '90000000-0000-0000-0000-000000000000', 'Mobilize', 'task', 3, 3, null),
  ('b0000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000',
   '90000000-0000-0000-0000-000000000000', 'Pour Foundations', 'task', 5, 5,
   '30000000-0000-0000-0000-000000000000');

-- dependency: Mobilize -> Pour Foundations (FS) ---------------------------
insert into dependencies
  (id, project_id, predecessor_id, successor_id, type, lag) values
  ('c0000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000',
   'a0000000-0000-0000-0000-000000000000',
   'b0000000-0000-0000-0000-000000000000', 'FS', 0);

-- comments: one internal, one shared --------------------------------------
insert into comments
  (id, project_id, author_user_id, body, scope, visibility) values
  ('d0000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000',
   '40000000-0000-0000-0000-000000000000',
   'Internal: confirm crew availability before committing dates.',
   'project', 'internal'),
  ('e0000000-0000-0000-0000-000000000000',
   '70000000-0000-0000-0000-000000000000',
   '40000000-0000-0000-0000-000000000000',
   'Shared: foundation pour scheduled for week of July 6.',
   'project', 'shared');
