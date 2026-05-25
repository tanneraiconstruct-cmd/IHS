import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveColor } from "@/lib/realtime/presence";
import type {
  BootstrapData,
  DbActivity,
  DbActivityConstraint,
  DbActivityHistory,
  DbCalendar,
  DbCalendarException,
  DbComment,
  DbDependency,
  DbLookahead,
  DbLookaheadTask,
  DbProject,
  DbWbsNode,
  UserLookupEntry,
} from "./types";

interface UserRow {
  id: string;
  company_id: string;
  full_name: string;
}

export function buildUserLookup(rows: UserRow[]): Record<string, UserLookupEntry> {
  const out: Record<string, UserLookupEntry> = {};
  for (const r of rows) {
    out[r.id] = {
      id: r.id,
      display_name: r.full_name,
      company_id: r.company_id,
      color: deriveColor(r.id),
    };
  }
  return out;
}

const ACTIVITY_FIELDS =
  "id, project_id, wbs_node_id, name, activity_type, original_duration, remaining_duration, " +
  "calendar_id, actual_start, actual_finish, percent_complete, responsible_company_id, " +
  "early_start, early_finish, late_start, late_finish, planned_start, planned_finish, " +
  "total_float, free_float, is_critical, version, deleted_at";

export async function fetchBootstrap(
  projectId: string,
  supabase: SupabaseClient,
): Promise<BootstrapData> {
  const [
    projectRes,
    calendarsRes,
    wbsRes,
    activitiesRes,
    dependenciesRes,
    constraintsRes,
    commentsRes,
    historyRes,
    lookaheadsRes,
    lookaheadTasksRes,
    usersRes,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, number, project_start, data_date, default_calendar_id, critical_float_threshold, comment_visibility_default",
      )
      .eq("id", projectId)
      .single(),
    supabase
      .from("calendars")
      .select("id, project_id, name, working_weekdays, is_default")
      .eq("project_id", projectId),
    supabase
      .from("wbs_nodes")
      .select("id, project_id, parent_id, name, sort_order, deleted_at")
      .eq("project_id", projectId),
    supabase.from("activities").select(ACTIVITY_FIELDS).eq("project_id", projectId),
    supabase
      .from("dependencies")
      .select(
        "id, project_id, predecessor_id, successor_id, type, lag, is_active, deleted_at",
      )
      .eq("project_id", projectId),
    supabase
      .from("activity_constraints")
      .select("id, project_id, activity_id, type, constraint_date")
      .eq("project_id", projectId),
    supabase
      .from("comments")
      .select(
        "id, project_id, author_user_id, body, parent_comment_id, scope, target_activity_id, visibility, created_at, edited_at, deleted_at",
      )
      .eq("project_id", projectId),
    supabase
      .from("activity_history")
      .select(
        "id, project_id, edit_session_id, entity_type, entity_id, field, old_value, new_value, changed_by, changed_at, visibility, session_note",
      )
      .eq("project_id", projectId)
      .order("changed_at", { ascending: false })
      .limit(500),
    supabase
      .from("lookaheads")
      .select(
        "id, project_id, name, window_start, window_end, type, source_mode, deleted_at",
      )
      .eq("project_id", projectId),
    supabase
      .from("lookahead_tasks")
      .select(
        "id, lookahead_id, master_activity_id, name, offset_start, offset_finish, start_date, finish_date, crew, responsible_company_id, status, percent_complete, constraints_cleared, readiness_notes, deleted_at",
      ),
    supabase.from("users").select("id, company_id, full_name"),
  ]);

  for (const r of [
    projectRes,
    calendarsRes,
    wbsRes,
    activitiesRes,
    dependenciesRes,
    constraintsRes,
    commentsRes,
    historyRes,
    lookaheadsRes,
    lookaheadTasksRes,
    usersRes,
  ]) {
    if (r.error) throw r.error;
  }

  if (!projectRes.data) throw new Error("Project not found");

  const calendars = (calendarsRes.data ?? []) as unknown as DbCalendar[];
  const calendarIds = calendars.map((c) => c.id);
  const exceptionsRes = calendarIds.length
    ? await supabase
        .from("calendar_exceptions")
        .select("id, calendar_id, exception_date, working")
        .in("calendar_id", calendarIds)
    : { data: [], error: null };
  if (exceptionsRes.error) throw exceptionsRes.error;

  return {
    project: projectRes.data as unknown as DbProject,
    calendars,
    calendarExceptions: (exceptionsRes.data ?? []) as unknown as DbCalendarException[],
    wbsNodes: (wbsRes.data ?? []) as unknown as DbWbsNode[],
    activities: (activitiesRes.data ?? []) as unknown as DbActivity[],
    dependencies: (dependenciesRes.data ?? []) as unknown as DbDependency[],
    constraints: (constraintsRes.data ?? []) as unknown as DbActivityConstraint[],
    comments: (commentsRes.data ?? []) as unknown as DbComment[],
    history: (historyRes.data ?? []) as unknown as DbActivityHistory[],
    lookaheads: (lookaheadsRes.data ?? []) as unknown as DbLookahead[],
    lookaheadTasks: (lookaheadTasksRes.data ?? []) as unknown as DbLookaheadTask[],
    users: buildUserLookup((usersRes.data ?? []) as unknown as UserRow[]),
  };
}
