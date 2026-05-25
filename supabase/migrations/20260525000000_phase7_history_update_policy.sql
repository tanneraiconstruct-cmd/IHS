-- Phase 7: allow the original author to UPDATE their activity_history rows.
-- Used to backfill session_note on Done-Save. RLS otherwise denies UPDATE
-- by default (only SELECT/INSERT policies exist on activity_history).

create policy activity_history_update on activity_history for update to authenticated
  using (changed_by = auth.uid())
  with check (changed_by = auth.uid());
