-- Phase 3: integer optimistic-concurrency versions for every entity that can be
-- the target of an edit. activities.version already exists from Phase 2.

alter table dependencies          add column version integer not null default 1;
alter table activity_constraints  add column version integer not null default 1;
alter table calendars             add column version integer not null default 1;
alter table wbs_nodes             add column version integer not null default 1;
alter table resources             add column version integer not null default 1;
alter table resource_assignments  add column version integer not null default 1;
alter table projects              add column version integer not null default 1;
