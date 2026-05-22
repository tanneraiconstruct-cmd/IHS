-- wbs_nodes ---------------------------------------------------------------
create table wbs_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  parent_id uuid references wbs_nodes(id),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- activities (stored inputs + engine-computed cache) ----------------------
create table activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  wbs_node_id uuid references wbs_nodes(id),
  name text not null,
  activity_type activity_type not null default 'task',
  original_duration integer not null default 0,
  remaining_duration integer not null default 0,
  calendar_id uuid references calendars(id),
  actual_start date,
  actual_finish date,
  percent_complete numeric(5,2) not null default 0,
  responsible_company_id uuid references companies(id),
  early_start date,
  early_finish date,
  late_start date,
  late_finish date,
  planned_start date,
  planned_finish date,
  total_float integer,
  free_float integer,
  is_critical boolean not null default false,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_activities_project on activities(project_id);
create index idx_activities_wbs on activities(wbs_node_id);

-- dependencies ------------------------------------------------------------
create table dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  predecessor_id uuid not null references activities(id),
  successor_id uuid not null references activities(id),
  type dependency_type not null,
  lag integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (predecessor_id <> successor_id)
);
create index idx_dependencies_predecessor on dependencies(predecessor_id);
create index idx_dependencies_successor on dependencies(successor_id);

-- activity_constraints (named to avoid the reserved word "constraints") ---
create table activity_constraints (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id),
  type constraint_type not null,
  constraint_date date,
  created_at timestamptz not null default now(),
  unique (activity_id)
);

-- resources ---------------------------------------------------------------
create table resources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  name text not null,
  type resource_type not null,
  unit text,
  calendar_id uuid references calendars(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- resource_assignments ----------------------------------------------------
create table resource_assignments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id),
  resource_id uuid not null references resources(id),
  quantity numeric,
  allocation_percent numeric,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (activity_id, resource_id)
);

-- activity_codes ----------------------------------------------------------
create table activity_codes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  category text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (project_id, category, value)
);

-- activity_code_assignments ----------------------------------------------
create table activity_code_assignments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id),
  activity_code_id uuid not null references activity_codes(id),
  created_at timestamptz not null default now(),
  unique (activity_id, activity_code_id)
);
