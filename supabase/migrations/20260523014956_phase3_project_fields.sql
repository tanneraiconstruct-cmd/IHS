-- Phase 3: lazy-recalc dirty flag + persisted engine problems on the project row.

alter table projects
  add column schedule_dirty_at timestamptz,
  add column last_engine_problems jsonb not null default '[]'::jsonb;
