import type {
  ActivityType, DependencyType, ConstraintType,
  ActivityResult, Problem, IsoDate,
} from "@/lib/schedule-engine/types";

// -----------------------------------------------------------------------
// Intent op union
// -----------------------------------------------------------------------
export type IntentOp =
  | CreateActivityOp | SoftDeleteActivityOp | SetActivityFieldsOp
  | SetProgressOp
  | AddDependencyOp | DeactivateDependencyOp | ReactivateDependencyOp
  | SoftDeleteDependencyOp
  | SetConstraintOp | ClearConstraintOp
  | SetProjectDataDateOp;

export interface CreateActivityOp {
  type: "createActivity";
  tempId: string;
  wbsNodeId: string;
  name: string;
  activityType: ActivityType;
  originalDuration: number;
  calendarId?: string;
}
export interface SoftDeleteActivityOp { type: "softDeleteActivity"; activityId: string; }
export interface SetActivityFieldsOp {
  type: "setActivityFields";
  activityId: string;
  patch: Partial<{
    name: string;
    originalDuration: number;
    remainingDuration: number;
    wbsNodeId: string;
    calendarId: string;
    activityType: ActivityType;
    responsiblePartyCompanyId: string | null;
  }>;
}
export interface SetProgressOp {
  type: "setProgress";
  activityId: string;
  percentComplete?: number;
  actualStart?: IsoDate;
  actualFinish?: IsoDate;
}
export interface AddDependencyOp {
  type: "addDependency";
  tempId: string;
  predecessorId: string;
  successorId: string;
  relType: DependencyType;
  lag: number;
}
export interface DeactivateDependencyOp { type: "deactivateDependency"; dependencyId: string; }
export interface ReactivateDependencyOp { type: "reactivateDependency"; dependencyId: string; }
export interface SoftDeleteDependencyOp { type: "softDeleteDependency"; dependencyId: string; }
export interface SetConstraintOp {
  type: "setConstraint";
  activityId: string;
  constraintType: ConstraintType;
  date?: IsoDate;
}
export interface ClearConstraintOp { type: "clearConstraint"; activityId: string; }
export interface SetProjectDataDateOp { type: "setProjectDataDate"; dataDate: IsoDate; }

// -----------------------------------------------------------------------
// RPC payload (mirrors spec §3.3)
// -----------------------------------------------------------------------
export interface ApplyScheduleEditPayload {
  project_id: string;
  edit_session_id: string;
  acting_user_id: string;
  request_id: string;
  intent_op_count: number;
  base_versions: {
    project_version: number;
    activities: Record<string, number>;
    dependencies: Record<string, number>;
    constraints: Record<string, number>;
  };
  writes: PayloadWrites;
  history_rows: HistoryRow[];
}

export interface PayloadWrites {
  activity_inserts: ActivityInsertRow[];
  activity_updates: ActivityUpdateRow[];
  activity_soft_deletes: { id: string }[];
  dependency_inserts: DependencyInsertRow[];
  dependency_updates: DependencyUpdateRow[];
  dependency_soft_deletes: { id: string }[];
  constraint_upserts: ConstraintUpsertRow[];
  constraint_deletes: { activity_id: string }[];
  project_patch: { data_date?: IsoDate };
  project_problems: Problem[];
}

export interface ActivityInsertRow {
  temp_id: string;
  wbs_node_id: string;
  name: string;
  activity_type: ActivityType;
  original_duration: number;
  remaining_duration: number;
  calendar_id: string | null;
  early_start: IsoDate | null;
  early_finish: IsoDate | null;
  late_start: IsoDate | null;
  late_finish: IsoDate | null;
  planned_start: IsoDate | null;
  planned_finish: IsoDate | null;
  total_float: number | null;
  free_float: number | null;
  is_critical: boolean;
}
export interface ActivityUpdateRow extends Omit<ActivityInsertRow, "temp_id"> {
  id: string;
  percent_complete?: number;
  actual_start?: IsoDate | null;
  actual_finish?: IsoDate | null;
  responsible_company_id?: string | null;
}
export interface DependencyInsertRow {
  temp_id: string;
  predecessor_id: string;
  successor_id: string;
  type: DependencyType;
  lag: number;
  is_active: boolean;
}
export interface DependencyUpdateRow {
  id: string;
  is_active?: boolean;
  lag?: number;
  type?: DependencyType;
}
export interface ConstraintUpsertRow {
  activity_id: string;
  type: ConstraintType;
  constraint_date: IsoDate | null;
}

export interface HistoryRow {
  entity_type: "activity" | "dependency" | "constraint" | "project";
  entity_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  op_index: number | null;
  source: "intent" | "engine_cascade";
}

// -----------------------------------------------------------------------
// Response union
// -----------------------------------------------------------------------
export type ErrorCode =
  | "UNAUTHENTICATED" | "IDENTITY_MISMATCH" | "FORBIDDEN"
  | "VALIDATION_FAILED" | "ENGINE_CYCLE" | "STALE_STATE"
  | "PAYLOAD_INVALID" | "INTERNAL";

export interface ApplyScheduleEditSuccess {
  applied_at: string;
  project_version: number;
  activities: ActivityResult[];
  dependencies: DependencyUpdateRow[];
  constraints: ConstraintUpsertRow[];
  project: {
    id: string;
    version: number;
    schedule_dirty_at: string | null;
    last_engine_problems: Problem[];
  };
  temp_id_map: Record<string, string>;
  history_ids: string[];
}

export type ApplyScheduleEditResponse =
  | { ok: true;  data: ApplyScheduleEditSuccess }
  | { ok: false; error: ErrorCode; details?: unknown };
