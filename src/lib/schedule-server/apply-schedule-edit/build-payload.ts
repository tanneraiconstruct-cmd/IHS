import type {
  ApplyScheduleEditPayload, HistoryRow, IntentOp,
  ActivityInsertRow, ActivityUpdateRow,
} from "../shared/types";
import type { ActivityResult, Problem } from "@/lib/schedule-engine/types";

export interface BuildPayloadInput {
  projectId: string;
  editSessionId: string;
  actingUserId: string;
  requestId: string;
  ops: IntentOp[];
  tempIdMap: Record<string, string>;
  preEngineActivities: Array<{
    id: string; original_duration: number;
    planned_start: string | null; planned_finish: string | null;
  }>;
  postEngineActivities: ActivityResult[];
  preEngineDependencies: Array<{ id: string; is_active: boolean; lag: number; type: string }>;
  preEngineConstraints: Array<{ activity_id: string; type: string; constraint_date: string | null }>;
  baseVersions: ApplyScheduleEditPayload["base_versions"];
  softDeleted: { activityIds: string[]; dependencyIds: string[] };
  projectPatch: { data_date?: string };
  engineProblems: Problem[];
  /** Fields the engine doesn't carry but the DB row needs (name, wbs_node_id, …). */
  originalActivityInputs: Record<string, { name: string; wbs_node_id: string; activity_type: string }>;
}

export interface BuildPayloadResult {
  payload: ApplyScheduleEditPayload;
  intentOpCount: number;
}

const NULLABLE_DATE = (v: string | null) => (v == null ? null : v);

const camelToSnake = (s: string) =>
  s.replace(/[A-Z]/g, c => "_" + c.toLowerCase());

export function buildPayload(b: BuildPayloadInput): BuildPayloadResult {
  const history: HistoryRow[] = [];

  // 1. INTENT history rows (one per op that touches a stored input column)
  b.ops.forEach((op, opIndex) => {
    const push = (
      entity_type: HistoryRow["entity_type"],
      entity_id: string, field: string,
      oldV: unknown, newV: unknown,
    ) => history.push({
      entity_type, entity_id, field,
      old_value: oldV === undefined ? null : JSON.stringify(oldV),
      new_value: newV === undefined ? null : JSON.stringify(newV),
      op_index: opIndex, source: "intent",
    });

    switch (op.type) {
      case "createActivity":
        push("activity", b.tempIdMap[op.tempId], "created", null,
             { name: op.name, originalDuration: op.originalDuration });
        break;
      case "softDeleteActivity":
        push("activity", op.activityId, "deleted_at", null, "now()");
        break;
      case "setActivityFields":
        for (const [k, v] of Object.entries(op.patch))
          push("activity", op.activityId, camelToSnake(k), undefined, v);
        break;
      case "setProgress":
        if (op.percentComplete !== undefined)
          push("activity", op.activityId, "percent_complete", undefined, op.percentComplete);
        if (op.actualStart !== undefined)
          push("activity", op.activityId, "actual_start", undefined, op.actualStart);
        if (op.actualFinish !== undefined)
          push("activity", op.activityId, "actual_finish", undefined, op.actualFinish);
        break;
      case "addDependency":
        push("dependency", b.tempIdMap[op.tempId], "created", null,
             { predecessorId: op.predecessorId, successorId: op.successorId,
               relType: op.relType, lag: op.lag });
        break;
      case "deactivateDependency":
        push("dependency", op.dependencyId, "is_active", true, false); break;
      case "reactivateDependency":
        push("dependency", op.dependencyId, "is_active", false, true); break;
      case "softDeleteDependency":
        push("dependency", op.dependencyId, "deleted_at", null, "now()"); break;
      case "setConstraint":
        push("constraint", op.activityId, "type", undefined, op.constraintType);
        if (op.date) push("constraint", op.activityId, "date", undefined, op.date);
        break;
      case "clearConstraint":
        push("constraint", op.activityId, "deleted", null, true); break;
      case "setProjectDataDate":
        push("project", b.projectId, "data_date", undefined, op.dataDate); break;
    }
  });

  // 2. ENGINE CASCADE history rows (computed-column diffs)
  const preById = new Map(b.preEngineActivities.map(a => [a.id, a]));
  for (const post of b.postEngineActivities) {
    const pre = preById.get(post.id);
    if (!pre) continue;  // newly created; engine wrote everything
    if (pre.planned_start !== post.plannedStart)
      history.push({
        entity_type: "activity", entity_id: post.id, field: "planned_start",
        old_value: JSON.stringify(pre.planned_start),
        new_value: JSON.stringify(post.plannedStart),
        op_index: null, source: "engine_cascade",
      });
    if (pre.planned_finish !== post.plannedFinish)
      history.push({
        entity_type: "activity", entity_id: post.id, field: "planned_finish",
        old_value: JSON.stringify(pre.planned_finish),
        new_value: JSON.stringify(post.plannedFinish),
        op_index: null, source: "engine_cascade",
      });
  }

  // 3. WRITES — turn post-engine activities + original op effects into row writes.
  const inserts: ActivityInsertRow[] = [];
  const updates: ActivityUpdateRow[] = [];
  const tempIdsValues = new Set(Object.values(b.tempIdMap));

  for (const post of b.postEngineActivities) {
    const meta = b.originalActivityInputs[post.id] ?? { name: "", wbs_node_id: "", activity_type: "task" };
    const row = {
      wbs_node_id: meta.wbs_node_id,
      name: meta.name,
      activity_type: meta.activity_type as ActivityInsertRow["activity_type"],
      original_duration: 0,
      remaining_duration: 0,
      calendar_id: null,
      early_start:   NULLABLE_DATE(post.earlyStart),
      early_finish:  NULLABLE_DATE(post.earlyFinish),
      late_start:    NULLABLE_DATE(post.lateStart),
      late_finish:   NULLABLE_DATE(post.lateFinish),
      planned_start: NULLABLE_DATE(post.plannedStart),
      planned_finish:NULLABLE_DATE(post.plannedFinish),
      total_float:   post.totalFloat,
      free_float:    post.freeFloat,
      is_critical:   post.isCritical,
    } satisfies Omit<ActivityInsertRow, "temp_id">;
    if (tempIdsValues.has(post.id)) {
      const tempId = Object.entries(b.tempIdMap).find(([, v]) => v === post.id)![0];
      inserts.push({ temp_id: tempId, ...row });
    } else {
      updates.push({ id: post.id, ...row });
    }
  }

  const payload: ApplyScheduleEditPayload = {
    project_id: b.projectId,
    edit_session_id: b.editSessionId,
    acting_user_id: b.actingUserId,
    request_id: b.requestId,
    intent_op_count: b.ops.length,
    base_versions: b.baseVersions,
    writes: {
      activity_inserts: inserts,
      activity_updates: updates,
      activity_soft_deletes: b.softDeleted.activityIds.map(id => ({ id })),
      dependency_inserts: [],
      dependency_updates: [],
      dependency_soft_deletes: b.softDeleted.dependencyIds.map(id => ({ id })),
      constraint_upserts: [],
      constraint_deletes: [],
      project_patch: b.projectPatch,
      project_problems: b.engineProblems,
    },
    history_rows: history,
  };

  for (const op of b.ops) {
    if (op.type === "addDependency") {
      payload.writes.dependency_inserts.push({
        temp_id: op.tempId,
        predecessor_id: op.predecessorId,
        successor_id: op.successorId,
        type: op.relType, lag: op.lag, is_active: true,
      });
    } else if (op.type === "deactivateDependency") {
      payload.writes.dependency_updates.push({ id: op.dependencyId, is_active: false });
    } else if (op.type === "reactivateDependency") {
      payload.writes.dependency_updates.push({ id: op.dependencyId, is_active: true });
    } else if (op.type === "setConstraint") {
      payload.writes.constraint_upserts.push({
        activity_id: op.activityId,
        type: op.constraintType,
        constraint_date: op.date ?? null,
      });
    } else if (op.type === "clearConstraint") {
      payload.writes.constraint_deletes.push({ activity_id: op.activityId });
    }
  }

  return { payload, intentOpCount: b.ops.length };
}
