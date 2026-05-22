-- baselines ---------------------------------------------------------------
create table baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  name text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

-- baseline_activities (frozen per-activity snapshot) ----------------------
create table baseline_activities (
  id uuid primary key default gen_random_uuid(),
  baseline_id uuid not null references baselines(id),
  activity_id uuid not null references activities(id),
  name text not null,
  planned_start date,
  planned_finish date,
  original_duration integer not null,
  percent_complete numeric(5,2) not null,
  created_at timestamptz not null default now()
);

-- lookaheads --------------------------------------------------------------
create table lookaheads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  name text not null,
  window_start date not null,
  window_end date not null,
  type text,
  source_mode lookahead_source_mode not null default 'from_master',
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- lookahead_tasks ---------------------------------------------------------
create table lookahead_tasks (
  id uuid primary key default gen_random_uuid(),
  lookahead_id uuid not null references lookaheads(id),
  master_activity_id uuid references activities(id),
  name text not null,
  offset_start integer,
  offset_finish integer,
  start_date date,
  finish_date date,
  crew text,
  responsible_company_id uuid references companies(id),
  status text,
  percent_complete numeric(5,2) not null default 0,
  constraints_cleared boolean not null default false,
  readiness_notes text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- comments ----------------------------------------------------------------
create table comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  author_user_id uuid not null references users(id),
  body text not null,
  parent_comment_id uuid references comments(id),
  scope comment_scope not null,
  target_activity_id uuid references activities(id),
  visibility visibility not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check ((scope = 'activity') = (target_activity_id is not null))
);
create index idx_comments_project on comments(project_id);
create index idx_comments_target_activity on comments(target_activity_id);

-- attachments -------------------------------------------------------------
create table attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  comment_id uuid references comments(id),
  activity_id uuid references activities(id),
  storage_path text not null,
  file_name text not null,
  file_size bigint,
  content_type text,
  uploaded_by uuid not null references users(id),
  visibility visibility not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- activity_history (append-only audit log) --------------------------------
create table activity_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  edit_session_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default now(),
  visibility visibility not null,
  session_note text
);
create index idx_activity_history_project_entity on activity_history(project_id, entity_id);
