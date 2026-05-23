-- Phase 3: history rows distinguish intent ops from engine cascades, and intent
-- rows carry an index into the original ops[] array for UI grouping.

alter table activity_history
  add column op_index integer,
  add column source text not null default 'intent'
    check (source in ('intent', 'engine_cascade'));

-- Engine cascades have null op_index; intent rows must have a non-null index.
alter table activity_history
  add constraint activity_history_op_index_when_intent
  check (
    (source = 'intent' and op_index is not null) or
    (source = 'engine_cascade' and op_index is null)
  );
