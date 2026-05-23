-- Phase 3: idempotency table for apply_schedule_edit. A retry with the same
-- (project_id, request_id) returns the cached response_blob and writes nothing
-- else. Empty response_blob ('{}') means a prior attempt died mid-RPC.

create table applied_edit_requests (
  project_id    uuid not null references projects(id) on delete cascade,
  request_id    uuid not null,
  response_blob jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  primary key (project_id, request_id)
);
create index idx_applied_edit_requests_created_at on applied_edit_requests(created_at);

-- RLS: not exposed to clients; only the apply_schedule_edit RPC reads/writes it.
alter table applied_edit_requests enable row level security;

-- (No policies = nothing is selectable from clients. The RPC runs SECURITY
-- DEFINER as schedule_writer and bypasses RLS.)
