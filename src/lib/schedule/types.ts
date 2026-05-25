import type { Problem, ScheduleResult } from "@/lib/schedule-engine";

export interface DbCalendar {
  id: string;
  project_id: string;
  name: string;
  working_weekdays: number[];
  is_default: boolean;
}

export interface DbCalendarException {
  id: string;
  calendar_id: string;
  exception_date: string;
  working: boolean;
}

export interface DbWbsNode {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  deleted_at: string | null;
}

export interface DbActivity {
  id: string;
  project_id: string;
  wbs_node_id: string | null;
  name: string;
  activity_type: "task" | "milestone" | "summary" | "level_of_effort";
  original_duration: number;
  remaining_duration: number;
  calendar_id: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  percent_complete: number;
  responsible_company_id: string | null;
  early_start: string | null;
  early_finish: string | null;
  late_start: string | null;
  late_finish: string | null;
  planned_start: string | null;
  planned_finish: string | null;
  total_float: number | null;
  free_float: number | null;
  is_critical: boolean;
  version: number;
  deleted_at: string | null;
}

export interface DbDependency {
  id: string;
  project_id: string;
  predecessor_id: string;
  successor_id: string;
  type: "FS" | "SS" | "FF" | "SF";
  lag: number;
  is_active: boolean;
  deleted_at: string | null;
}

export interface DbActivityConstraint {
  id: string;
  project_id: string;
  activity_id: string;
  type: "SNET" | "SNLT" | "FNET" | "FNLT" | "MSO" | "MFO" | "ALAP";
  constraint_date: string | null;
}

export interface DbComment {
  id: string;
  project_id: string;
  author_user_id: string;
  body: string;
  parent_comment_id: string | null;
  scope: "project" | "activity";
  target_activity_id: string | null;
  visibility: "internal" | "shared";
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface DbActivityHistory {
  id: string;
  project_id: string;
  edit_session_id: string | null;
  entity_type: string;
  entity_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  changed_at: string;
  visibility: "internal" | "shared";
  session_note: string | null;
}

export interface DbLookahead {
  id: string;
  project_id: string;
  name: string;
  window_start: string;
  window_end: string;
  type: string | null;
  source_mode: "from_master" | "carry_forward";
  deleted_at: string | null;
}

export interface DbLookaheadTask {
  id: string;
  lookahead_id: string;
  master_activity_id: string | null;
  name: string;
  offset_start: number | null;
  offset_finish: number | null;
  start_date: string | null;
  finish_date: string | null;
  crew: string | null;
  responsible_company_id: string | null;
  status: string | null;
  percent_complete: number;
  constraints_cleared: boolean;
  readiness_notes: string | null;
  deleted_at: string | null;
}

export interface DbProject {
  id: string;
  name: string;
  number: string | null;
  project_start: string;
  data_date: string | null;
  default_calendar_id: string;
  critical_float_threshold: number;
  comment_visibility_default: "internal" | "shared";
}

export interface UserLookupEntry {
  id: string;
  display_name: string;   // mapped from users.full_name in bootstrap
  company_id: string;
  color: string;          // hex from deriveColor(id); pre-computed
}

export interface BootstrapData {
  project: DbProject;
  calendars: DbCalendar[];
  calendarExceptions: DbCalendarException[];
  wbsNodes: DbWbsNode[];
  activities: DbActivity[];
  dependencies: DbDependency[];
  constraints: DbActivityConstraint[];
  comments: DbComment[];
  history: DbActivityHistory[];
  lookaheads: DbLookahead[];
  lookaheadTasks: DbLookaheadTask[];
  users: Record<string, UserLookupEntry>;
}

/** Engine-computed result keyed for fast UI lookup. */
export interface IndexedResult {
  byActivity: Map<string, ScheduleResult["activities"][number]>;
  projectFinish: string | null;
  problems: Problem[];
}
