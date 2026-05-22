-- Enums -------------------------------------------------------------------
create type company_type as enum ('internal', 'external');

create type project_role as enum (
  'org_admin', 'project_admin', 'scheduler', 'project_manager',
  'superintendent', 'internal_viewer', 'trade_partner_editor', 'trade_partner_viewer'
);

create type project_status as enum ('planning', 'active', 'on_hold', 'complete', 'archived');
create type activity_type as enum ('task', 'milestone', 'summary', 'level_of_effort');
create type dependency_type as enum ('FS', 'SS', 'FF', 'SF');
create type constraint_type as enum ('SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO', 'ALAP');
create type resource_type as enum ('labor', 'equipment', 'material');
create type comment_scope as enum ('project', 'activity');
create type visibility as enum ('internal', 'shared');
create type lookahead_source_mode as enum ('from_master', 'carry_forward');

-- organizations -----------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- companies ---------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  type company_type not null,
  created_at timestamptz not null default now()
);

-- users (profile row; id equals auth.users.id) ----------------------------
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id),
  full_name text not null,
  email text not null,
  phone text,
  title text,
  created_at timestamptz not null default now()
);

-- projects (default_calendar_id FK added after calendars exists) ----------
create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  number text,
  client text,
  address text,
  status project_status not null default 'planning',
  planned_start date,
  planned_finish date,
  project_start date not null,
  data_date date,
  default_calendar_id uuid,
  critical_float_threshold integer not null default 0,
  comment_visibility_default visibility not null default 'internal',
  change_event_visibility_default visibility not null default 'shared',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- memberships -------------------------------------------------------------
create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  project_id uuid not null references projects(id),
  role project_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, project_id)
);
create index idx_memberships_user_project on memberships(user_id, project_id);

-- calendars ---------------------------------------------------------------
create table calendars (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  name text not null,
  working_weekdays smallint[] not null default '{1,2,3,4,5}',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table projects
  add constraint projects_default_calendar_fk
  foreign key (default_calendar_id) references calendars(id);

-- calendar_exceptions -----------------------------------------------------
create table calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references calendars(id),
  exception_date date not null,
  working boolean not null,
  created_at timestamptz not null default now(),
  unique (calendar_id, exception_date)
);
